import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, chargesBetween, nextCharge, runwayFor, memberDues, advancePaid, totals, FALLBACK_FX } from './billing.ts';
import { DEFAULT_SETTINGS, type AppState, type Subscription } from './types.ts';

const base = (o: Partial<Subscription>): Subscription => ({
  id: 'x', name: 'X', category: '工具', tags: [], price: 10, currency: 'USD',
  cycle: { unit: 'month', every: 1 }, start: '2026-01-31', status: 'active', ...o,
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
  assert.equal(chargesBetween(s, '2026-10-01', '2026-10-31', '2026-10-19').length, 0);
});

test('余额续航', () => {
  const state: AppState = {
    subscriptions: [base({ price: 100, currency: 'TRY', start: '2026-01-05', methodId: 'tr' })],
    methods: [{ id: 'tr', name: 'TR', kind: 'appstore', currency: 'TRY', balance: 350, balanceAsOf: '2026-10-01' }],
    settings: DEFAULT_SETTINGS, fx: FALLBACK_FX,
  };
  const r = runwayFor(state.methods[0], state, '2026-10-19')!;
  assert.equal(r.current, 250); // 10-05 已扣
  assert.equal(r.coveredCharges, 2); // 11-05、12-05
  assert.equal(r.runsOutOn, '2027-01-05');
});

test('拼车', () => {
  const s = base({ price: 60, start: '2026-01-10', share: { role: 'owner', seats: 6, members: [{ id: 'a', name: 'A', share: 10, paidUntil: '2026-11-09' }, { id: 'b', name: 'B', share: 10 }] } });
  const d = memberDues(s, '2026-10-19');
  assert.equal(d[0].periodsOwed, 1);
  assert.equal(d[1].owed, 10);
  assert.equal(advancePaid(s, '2026-11-09', '2026-10-19'), '2026-12-09');
  const state: AppState = { subscriptions: [s], methods: [], settings: DEFAULT_SETTINGS, fx: FALLBACK_FX };
  const t = totals({ ...state, settings: { ...DEFAULT_SETTINGS, baseCurrency: 'USD' } }, '2026-10-19');
  assert.equal(Math.round(t.mrr), 40);
});

test('实际扣款记录 + 下次扣款日', () => {
  // 一次付两年：2026-08-19 付 20.92，下一笔 2028-07-20
  const s = base({ price: 10.46, cycle: { unit: 'year', every: 1 }, start: '2026-08-19', payments: [{ date: '2026-08-19', amount: 20.92 }], nextDue: '2028-07-20' });
  const cs = chargesBetween(s, '2026-01-01', '2029-12-31', '2026-10-19');
  assert.deepEqual(cs.map((c) => [c.date, c.amount]), [['2026-08-19', 20.92], ['2028-07-20', 10.46], ['2029-07-20', 10.46]]);
  // 提前续费：最后一笔之后才开始推算
  const f = base({ price: 10.46, cycle: { unit: 'year', every: 1 }, start: '2025-11-07', payments: [{ date: '2025-11-07', amount: 10.46 }, { date: '2026-10-08', amount: 10.46 }], nextDue: '2027-10-08' });
  assert.equal(nextCharge(f, '2026-10-19'), '2027-10-08');
});
