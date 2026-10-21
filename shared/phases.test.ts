// 阶段并行：换区后旧区域预付到期前仍在跑，两边都在付钱
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activePhases,
  chargesBetween,
  convert,
  currentPhase,
  effectiveStatus,
  FALLBACK_FX,
  monthlyGross,
  monthlyMine,
  nextCharge,
  phaseAt,
  phaseLanes,
  phaseSubs,
  servedTime,
  totals,
} from './billing.ts';
import { contributionOn, events, prepaidValue } from './metrics.ts';
import { deletePayment, dropPlan, prependPlan, removePhase, savePayment, setPhaseEnd, switchPlan, syncPhase, toEditForm } from './phases.ts';
import { DEFAULT_SETTINGS, type AppState, type Subscription } from './types.ts';

const base = (o: Partial<Subscription> = {}): Subscription => ({
  id: 'x',
  name: 'X',
  category: '工具',
  tags: [],
  price: 10,
  currency: 'USD',
  cycle: { unit: 'month', every: 1 },
  start: '2026-01-15',
  status: 'active',
  region: 'US',
  methodId: 'us',
  ...o,
});
const TR = { price: 100, currency: 'TRY', cycle: { unit: 'month' as const, every: 1 }, region: 'TR', methodId: 'tr' };
/** 美区月付 $10，6/1 起换土区 ₺100，美区继续跑到 8/15 */
const overlap = () => switchPlan(base(), '2026-06-01', TR, '2026-08-15');
const stateOf = (subs: Subscription[]): AppState => ({
  subscriptions: subs,
  methods: [],
  settings: { ...DEFAULT_SETTINGS, baseCurrency: 'CNY' },
  fx: FALLBACK_FX,
});
const dates = (s: Subscription, from: string, to: string) => chargesBetween(s, from, to, '2026-07-01').map((c) => `${c.date} ${c.currency}`);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≈ ${b}`);

test('换区时选择继续跑：旧阶段的结束日晚于新阶段开始日，订阅本身没有结束日', () => {
  const s = overlap();
  assert.equal(s.phases!.length, 2);
  assert.equal(s.phases![0].end, '2026-08-15');
  assert.equal(s.phases![1].end, undefined);
  assert.equal(s.end, undefined);
  assert.equal(s.currency, 'TRY');
  assert.throws(() => switchPlan(base(), '2026-06-01', TR, '2026-06-01'));
  // 默认（不选）仍是无缝切换
  assert.equal(switchPlan(base(), '2026-06-01', TR).phases![0].end, '2026-06-01');
});

test('并行期间两边的扣款都在，旧阶段到期当天不再扣', () => {
  assert.deepEqual(dates(overlap(), '2026-05-01', '2026-09-30'), [
    '2026-05-15 USD',
    '2026-06-01 TRY',
    '2026-06-15 USD',
    '2026-07-01 TRY',
    '2026-07-15 USD',
    '2026-08-01 TRY',
    '2026-09-01 TRY',
  ]);
  assert.equal(nextCharge(overlap(), '2026-07-02'), '2026-07-15');
});

test('并行期间：当前阶段取最晚开始的那段，activePhases 列出两段', () => {
  const s = overlap();
  assert.deepEqual(
    activePhases(s, '2026-07-01').map((v) => v.region),
    ['US', 'TR'],
  );
  assert.equal(phaseAt(s, '2026-07-01')!.region, 'TR');
  assert.equal(currentPhase(s, '2026-07-01').region, 'TR');
  assert.deepEqual(
    activePhases(s, '2026-08-15').map((v) => v.region),
    ['TR'],
  );
  assert.deepEqual(
    activePhases(s, '2026-05-01').map((v) => v.region),
    ['US'],
  );
  assert.equal(effectiveStatus(s, '2026-07-01'), 'active');
  assert.equal(effectiveStatus(s, '2026-09-01'), 'active');
  assert.deepEqual(phaseLanes(phaseSubs(s)), [0, 1]);
  assert.deepEqual(phaseLanes(phaseSubs(switchPlan(base(), '2026-06-01', TR))), [0, 0]);
});

test('并行期间的月成本是两段之和', () => {
  const s = overlap();
  const st = stateOf([s]);
  near(monthlyGross(s, '2026-07-01'), 100 + convert(10, 'USD', 'TRY', FALLBACK_FX));
  near(monthlyGross(s, '2026-09-01'), 100);
  const cny = convert(10, 'USD', 'CNY', FALLBACK_FX) + convert(100, 'TRY', 'CNY', FALLBACK_FX);
  near(monthlyMine(st, s, '2026-07-01'), cny);
  near(monthlyMine(st, s, '2026-07-01', 'us'), convert(10, 'USD', 'CNY', FALLBACK_FX));
  near(totals(st, '2026-07-01').mrr, cny);
  near(totals(st, '2026-09-01').mrr, convert(100, 'TRY', 'CNY', FALLBACK_FX));
  near(contributionOn(st, s, '2026-07-01'), cny);
  near(contributionOn(st, s, '2026-09-01'), convert(100, 'TRY', 'CNY', FALLBACK_FX));
});

test('变更日志：新段整份计入，旧段到期另记一笔结束', () => {
  const st = stateOf([overlap()]);
  const evs = events(st, '2026-10-01');
  const sw = evs.find((e) => e.kind === 'switch')!;
  assert.equal(sw.date, '2026-06-01');
  near(sw.delta, convert(100, 'TRY', 'CNY', FALLBACK_FX));
  const end = evs.find((e) => e.kind === 'end')!;
  assert.equal(end.date, '2026-08-15');
  near(end.delta, -convert(10, 'USD', 'CNY', FALLBACK_FX));
});

test('退订对并行的两段都生效', () => {
  const s = overlap();
  const form = toEditForm(s, '2026-07-01');
  const cancelled = syncPhase({ ...form, status: 'cancelled', end: '2026-07-10' }, '2026-07-01');
  assert.equal(cancelled.end, '2026-07-10');
  assert.equal(cancelled.phases![0].end, '2026-08-15'); // 旧段自己的到期日保留，由订阅结束日封顶
  assert.deepEqual(dates(cancelled, '2026-07-02', '2026-12-31'), []);
  assert.deepEqual(
    phaseSubs(cancelled).map((v) => v.end),
    ['2026-07-10', '2026-07-10'],
  );
  assert.equal(effectiveStatus(cancelled, '2026-07-05'), 'ending');
  assert.equal(effectiveStatus(cancelled, '2026-07-20'), 'ended');
  assert.equal(totals(stateOf([cancelled]), '2026-07-20').mrr, 0);
  // 没写结束日的退订：并行的旧段也视为退订
  const noEnd = { ...s, status: 'cancelled' as const };
  assert.equal(phaseSubs(noEnd)[0].status, 'cancelled');
});

test('暂停对并行的两段都生效', () => {
  const paused = { ...overlap(), status: 'paused' as const, pausedAt: '2026-07-05' };
  assert.deepEqual(dates(paused, '2026-07-02', '2026-12-31'), []);
  assert.equal(phaseSubs(paused)[0].status, 'paused');
  assert.equal(contributionOn(stateOf([paused]), paused, '2026-07-10'), 0);
  // 暂停日在旧段到期之后：旧段照常到期，不受影响
  const later = { ...overlap(), status: 'paused' as const, pausedAt: '2026-09-10' };
  assert.equal(phaseSubs(later)[0].status, 'active');
  assert.deepEqual(dates(later, '2026-08-01', '2026-12-31'), ['2026-08-01 TRY', '2026-09-01 TRY']);
});

test('撤回换区：去掉新阶段，旧阶段恢复为进行中', () => {
  const back = removePhase(overlap(), 1);
  assert.equal(back.phases, undefined);
  assert.equal(back.end, undefined);
  assert.equal(back.currency, 'USD');
  assert.deepEqual(dates(back, '2026-08-01', '2026-09-30'), ['2026-08-15 USD', '2026-09-15 USD']);
});

test('删掉并行中的旧阶段：只剩新阶段', () => {
  const only = removePhase(overlap(), 0);
  assert.equal(only.phases, undefined);
  assert.equal(only.start, '2026-06-01');
  assert.equal(only.currency, 'TRY');
});

test('取消计划中的换区：原本打算并行跑到的日期保留', () => {
  const planned = switchPlan(base(), '2026-11-01', { ...TR, planned: true }, '2026-12-15');
  const dropped = dropPlan(planned, '2026-11-01');
  assert.equal(dropped.phases, undefined);
  assert.equal(dropped.end, '2026-12-15');
});

test('编辑表单对应并行中最晚开始的那段，保存不动旧段', () => {
  const s = overlap();
  const form = toEditForm(s, '2026-07-01');
  assert.equal(form.currency, 'TRY');
  assert.equal(form.region, 'TR');
  const saved = syncPhase({ ...form, methodId: 'card', price: 120 }, '2026-07-01');
  assert.equal(saved.phases![1].methodId, 'card');
  assert.equal(saved.phases![1].price, 120);
  assert.equal(saved.phases![0].methodId, 'us');
  assert.equal(saved.phases![0].price, 10);
  assert.equal(saved.phases![0].end, '2026-08-15');
  assert.equal(saved.phases![1].end, undefined);
  // 新段尚未开始（计划）时，表单是旧段
  const pl = switchPlan(base(), '2026-11-01', { ...TR, planned: true }, '2026-12-15');
  assert.equal(toEditForm(pl, '2026-10-20').currency, 'USD');
});

test('改阶段结束日：晚于下一段开始即并行，留空回到缺省', () => {
  const seq = switchPlan(base(), '2026-06-01', TR);
  const par = setPhaseEnd(seq, '2026-01-15', '2026-07-15');
  assert.equal(activePhases(par, '2026-06-20').length, 2);
  assert.equal(par.end, undefined);
  const cleared = setPhaseEnd(par, '2026-01-15', undefined);
  assert.equal(phaseSubs(cleared)[0].end, '2026-06-01');
  assert.equal(activePhases(cleared, '2026-06-20').length, 1);
  // 最后一段的结束日就是订阅的结束日
  assert.equal(setPhaseEnd(par, '2026-06-01', '2026-10-01').end, '2026-10-01');
  assert.throws(() => setPhaseEnd(par, '2026-06-01', '2026-05-01'));
});

test('并行期间实际在订的天数不重复计，没有断档', () => {
  const r = servedTime(overlap(), '2026-07-15');
  assert.equal(r.days, 181); // 1/15 → 7/15
  assert.equal(r.gaps.length, 0);
  const gap = setPhaseEnd(switchPlan(base(), '2026-06-01', TR), '2026-01-15', '2026-04-15');
  assert.deepEqual(
    servedTime(gap, '2026-07-15').gaps.map((g) => g.days),
    [47],
  );
});

test('预付余值：并行中旧区域没用完的部分也算', () => {
  const yearly = switchPlan(base({ price: 120, cycle: { unit: 'year', every: 1 } }), '2026-06-01', TR, '2027-01-15');
  const st = stateOf([yearly]);
  const r = prepaidValue(st, '2026-07-15');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].until, '2027-01-15');
  // 美区 120 USD 剩一半多（184/365），土区 7/1 那笔剩一半（17/31）
  near(r.total, convert(120, 'USD', 'CNY', FALLBACK_FX) * (184 / 365) + convert(100, 'TRY', 'CNY', FALLBACK_FX) * (17 / 31));
});

test('并行期间记一笔扣款：可指定阶段，缺省记到最晚开始的那段；改删旧段的扣款能找到旧段', () => {
  const s = overlap();
  const toTr = savePayment(s, '2026-07-20', { date: '2026-07-20', amount: 5 });
  assert.ok(toTr.phases![1].payments!.some((p) => p.date === '2026-07-20'));
  const toUs = savePayment(s, '2026-07-20', { date: '2026-07-20', amount: 5 }, undefined, '2026-01-15');
  assert.ok(toUs.phases![0].payments!.some((p) => p.date === '2026-07-20'));
  assert.ok(!toUs.phases![1].payments?.length);
  // 删掉美区 7/15 那笔（推算出来的）：不指定阶段也能找到美区
  const del = deletePayment(s, '2026-07-20', '2026-07-15', 0);
  assert.deepEqual(dates(del, '2026-07-01', '2026-07-31'), ['2026-07-01 TRY']);
  // 修改美区那笔的金额：留在美区
  const edited = savePayment(s, '2026-07-20', { date: '2026-07-15', amount: 12 }, { date: '2026-07-15', index: 0 }, '2026-01-15');
  assert.deepEqual(
    chargesBetween(edited, '2026-07-15', '2026-07-15', '2026-07-20').map((c) => `${c.amount} ${c.currency}`),
    ['12 USD'],
  );
});

test('补一段更早的买断：插在最前面，开始日前移，之后的年付照旧', () => {
  const yearly = base({ price: 14.99, cycle: { unit: 'year', every: 1 }, start: '2024-07-05' });
  const s = prependPlan(yearly, '2022-01-01', { price: 39.99, currency: 'USD', cycle: { unit: 'lifetime', every: 1 }, region: 'US' });
  assert.equal(s.start, '2022-01-01');
  assert.deepEqual(
    s.phases!.map((p) => [p.start, p.end, p.cycle.unit]),
    [
      ['2022-01-01', '2024-07-05', 'lifetime'],
      ['2024-07-05', undefined, 'year'],
    ],
  );
  // 顶层仍镜像最后一段（年付）
  assert.equal(s.price, 14.99);
  const cs = chargesBetween(s, '2021-01-01', '2025-12-31', '2025-12-31').map((c) => [c.date, c.amount]);
  assert.deepEqual(cs, [
    ['2022-01-01', 39.99],
    ['2024-07-05', 14.99],
    ['2025-07-05', 14.99],
  ]);
  // 有断档：买断那段早早结束
  assert.equal(
    prependPlan(yearly, '2022-01-01', { price: 39.99, currency: 'USD', cycle: { unit: 'lifetime', every: 1 } }, '2023-01-01').phases![0].end,
    '2023-01-01',
  );
  assert.throws(() => prependPlan(yearly, '2024-07-05', TR));
  assert.throws(() => prependPlan(yearly, '2022-01-01', TR, '2025-01-01'));
});
