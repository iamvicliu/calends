import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, chargesBetween, effectiveStatus, monthlyGross, nextCharge, runwayFor, memberDues, advancePaid, totals, FALLBACK_FX } from './billing.ts';
import { DEFAULT_SETTINGS, type AppState, type Subscription } from './types.ts';

const base = (o: Partial<Subscription>): Subscription => ({
  id: 'x',
  name: 'X',
  category: '工具',
  tags: [],
  price: 10,
  currency: 'USD',
  cycle: { unit: 'month', every: 1 },
  start: '2026-01-31',
  status: 'active',
  ...o,
});

test('月末夹紧且不漂移', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-01-31', 2), '2026-03-31');
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28');
});

test('下次扣款与到期', () => {
  const s = base({});
  assert.equal(nextCharge(s, '2026-10-19'), '2026-10-31');
  const ended = base({ end: '2026-05-01' });
  assert.equal(nextCharge(ended, '2026-10-19'), undefined);
  assert.equal(chargesBetween(ended, '2026-01-01', '2026-12-31', '2026-10-19').length, 4);
});

test('试用期不计费', () => {
  const s = base({ status: 'trial', start: '2026-10-01', trialEnd: '2026-10-15' });
  assert.deepEqual(
    chargesBetween(s, '2026-10-01', '2026-10-31', '2026-10-19').map((c) => c.date),
    ['2026-10-15'],
  );
});

test('余额续航', () => {
  const state: AppState = {
    subscriptions: [base({ price: 100, currency: 'TRY', start: '2026-01-05', methodId: 'tr' })],
    methods: [{ id: 'tr', name: 'TR', kind: 'appstore', currency: 'TRY', balance: 350, balanceAsOf: '2026-10-01' }],
    settings: DEFAULT_SETTINGS,
    fx: FALLBACK_FX,
  };
  const r = runwayFor(state.methods[0], state, '2026-10-19')!;
  assert.equal(r.current, 250); // 10-05 已扣
  assert.equal(r.coveredCharges, 2); // 11-05、12-05
  assert.equal(r.runsOutOn, '2027-01-05');
});

test('合租', () => {
  const s = base({
    price: 60,
    start: '2026-01-10',
    share: {
      role: 'owner',
      seats: 6,
      members: [
        { id: 'a', name: 'A', share: 10, paidUntil: '2026-11-09' },
        { id: 'b', name: 'B', share: 10 },
      ],
    },
  });
  const d = memberDues(s, '2026-10-19');
  // 已付至 11 月 9 日：还没到期，不欠
  assert.equal(d[0].periodsOwed, 0);
  assert.equal(d[1].owed, 100);
  // 按半年收、已付至 7 月 16 日：10 月 20 日欠一期（7 月 17 日那期），金额 = 每期份额 × 6
  const half = base({
    price: 60,
    start: '2021-04-14',
    share: { role: 'owner', seats: 6, members: [{ id: 'c', name: 'C', share: 10, billEvery: 6, paidUntil: '2026-07-16' }] },
  });
  const h = memberDues(half, '2026-10-20');
  assert.equal(h[0].periodsOwed, 1);
  assert.equal(Math.round(h[0].owed), 60);
  assert.equal(advancePaid(s, '2026-11-09', '2026-10-19'), '2026-12-09');
  const state: AppState = { subscriptions: [s], methods: [], settings: DEFAULT_SETTINGS, fx: FALLBACK_FX };
  const t = totals({ ...state, settings: { ...DEFAULT_SETTINGS, baseCurrency: 'USD' } }, '2026-10-19');
  assert.equal(Math.round(t.mrr), 40);
});

test('实际扣款记录 + 下次扣款日', () => {
  // 一次付两年：2026-08-19 付 20.92，下一笔 2028-07-20
  const s = base({
    price: 10.46,
    cycle: { unit: 'year', every: 1 },
    start: '2026-08-19',
    payments: [{ date: '2026-08-19', amount: 20.92 }],
    nextDue: '2028-07-20',
  });
  const cs = chargesBetween(s, '2026-01-01', '2029-12-31', '2026-10-19');
  assert.deepEqual(
    cs.map((c) => [c.date, c.amount]),
    [
      ['2026-08-19', 20.92],
      ['2028-07-20', 10.46],
      ['2029-07-20', 10.46],
    ],
  );
  // 提前续费：最后一笔之后才开始推算
  const f = base({
    price: 10.46,
    cycle: { unit: 'year', every: 1 },
    start: '2025-11-07',
    payments: [
      { date: '2025-11-07', amount: 10.46 },
      { date: '2026-10-08', amount: 10.46 },
    ],
    nextDue: '2027-10-08',
  });
  assert.equal(nextCharge(f, '2026-10-19'), '2027-10-08');
});

test('赠送时长：买一年送一年', () => {
  const s = base({ price: 120, cycle: { unit: 'year', every: 1 }, start: '2026-01-01', bonus: { from: '2027-01-01', until: '2028-01-01' } });
  const cs = chargesBetween(s, '2025-01-01', '2029-06-30', '2026-10-19');
  assert.deepEqual(
    cs.map((c) => c.date),
    ['2026-01-01', '2028-01-01', '2029-01-01'],
  );
  assert.equal(Math.round(monthlyGross(s, '2026-10-19') * 100) / 100, 5); // 120 摊到 24 个月
  assert.equal(Math.round(monthlyGross(s, '2028-03-01')), 10); // 赠送结束后恢复
  // 不整周期的赠送：送 45 天，下一笔顺延到赠送结束那天
  const m = base({ price: 10, start: '2026-01-10', bonus: { from: '2026-03-10', until: '2026-04-24' } });
  assert.deepEqual(
    chargesBetween(m, '2026-01-01', '2026-06-30', '2026-01-01').map((c) => c.date),
    ['2026-01-10', '2026-02-10', '2026-04-24', '2026-05-24', '2026-06-24'],
  );
});

test('手动记一笔：推算的历史先固化，未来照旧', async () => {
  const { savePayment, deletePayment } = await import('./phases.ts');
  const s = base({ price: 10, start: '2026-01-10' });
  const r = savePayment(s, '2026-04-01', { date: '2026-03-15', amount: -4, kind: 'refund' });
  const cs = chargesBetween(r, '2026-01-01', '2026-06-30', '2026-04-01');
  assert.deepEqual(
    cs.map((c) => [c.date, c.amount]),
    [
      ['2026-01-10', 10],
      ['2026-02-10', 10],
      ['2026-03-10', 10],
      ['2026-03-15', -4],
      ['2026-04-10', 10],
      ['2026-05-10', 10],
      ['2026-06-10', 10],
    ],
  );
  // 改成「扣款失败」：不计金额
  const f = savePayment(r, '2026-04-01', { date: '2026-03-10', amount: 10, kind: 'failed' }, { date: '2026-03-10', index: 0 });
  assert.equal(chargesBetween(f, '2026-03-10', '2026-03-10', '2026-04-01')[0].amount, 0);
  const d = deletePayment(f, '2026-04-01', '2026-03-15', 0);
  assert.equal(chargesBetween(d, '2026-03-11', '2026-03-31', '2026-04-01').length, 0);
});

test('有计划阶段时取消、暂停对当前阶段生效', () => {
  const phases = [
    { start: '2026-01-10', price: 10, currency: 'USD', cycle: { unit: 'month' as const, every: 1 } },
    { start: '2026-10-28', price: 100, currency: 'USD', cycle: { unit: 'year' as const, every: 1 } },
  ];
  const cancelled = base({ start: '2026-01-10', phases, status: 'cancelled', end: '2026-10-20' });
  assert.equal(nextCharge(cancelled, '2026-10-21'), undefined);
  assert.equal(effectiveStatus(cancelled, '2026-10-21'), effectiveStatus(base({ status: 'cancelled', end: '2026-10-20' }), '2026-10-21'));
  const paused = base({ start: '2026-01-10', phases, status: 'paused', pausedAt: '2026-10-20' });
  assert.equal(nextCharge(paused, '2026-10-21'), undefined);
  assert.equal(chargesBetween(paused, '2026-10-21', '2027-12-31', '2026-10-21').length, 0);
});

test('编辑表单对应当前阶段，保存后计划阶段不变', async () => {
  const { switchPlan, toEditForm, syncPhase } = await import('./phases.ts');
  const s = switchPlan(base({ start: '2026-01-10', price: 10, currency: 'TRY' }), '2026-10-28', {
    price: 100,
    currency: 'USD',
    cycle: { unit: 'year', every: 1 },
    planned: true,
  });
  const form = toEditForm(s, '2026-10-20');
  assert.equal(form.currency, 'TRY');
  const saved = syncPhase({ ...form, methodId: 'card' }, '2026-10-20');
  assert.equal(saved.phases![0].methodId, 'card');
  assert.equal(saved.phases![1].currency, 'USD');
  assert.equal(saved.phases![1].price, 100);
  assert.equal(saved.phases![0].end, '2026-10-27');
});
