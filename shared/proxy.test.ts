import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_FX } from './billing.ts';
import { proxyAhead, proxyOpenPeriods, proxyRows, proxyTotals, recordProxyReceipt, removeProxyBatch } from './proxy.ts';
import { DEFAULT_SETTINGS, type AppState, type ProxyEntry, type Subscription } from './types.ts';

const sub = (entries: ProxyEntry[], o: Partial<Subscription> = {}): Subscription => ({
  id: 'p1',
  name: 'Fictional Music',
  category: '娱乐',
  tags: [],
  price: 10,
  currency: 'USD',
  cycle: { unit: 'month', every: 1 },
  start: '2026-01-05',
  status: 'active',
  proxy: { forName: 'Alex', entries },
  ...o,
});
const state = (s: Subscription): AppState => ({ subscriptions: [s], methods: [], settings: { ...DEFAULT_SETTINGS, baseCurrency: 'USD' }, fx: FALLBACK_FX });
const today = '2026-03-20';
const receipt = { id: 'b1', date: '2026-03-18', currency: 'USD' };

test('提前一个月收下一期：到扣款日前是预收，不算待收', () => {
  const s0 = sub([]);
  const { entries, covered } = recordProxyReceipt(s0, { ...receipt, amount: 10, from: '2026-04-01', periods: 1 }, today);
  assert.deepEqual(covered, ['2026-04-05']);
  assert.equal(entries[0].batch!.periods, 1);
  const s = sub(entries);
  assert.equal(proxyRows(state(s), s, today).length, 3);
  assert.equal(proxyTotals(proxyRows(state(s), s, today)).open.length, 3);
  assert.deepEqual(
    proxyAhead(state(s), s, today).map((r) => r.date),
    ['2026-04-05'],
  );
  // 到了扣款日，这期就是已收
  const later = proxyRows(state(s), s, '2026-04-06');
  assert.equal(later[0].date, '2026-04-05');
  assert.equal(later[0].receivedBase, 10);
  assert.deepEqual(proxyAhead(state(s), s, '2026-04-06'), []);
});

test('一笔收 12 期：从最早没收的那期起按期均摊，盈亏按各自一份算', () => {
  const s0 = sub([{ charge: '2026-01-05', received: 10, receivedCurrency: 'USD', receivedOn: '2026-01-05' }]);
  const { entries, covered } = recordProxyReceipt(s0, { ...receipt, amount: 114, from: '2026-01-01', periods: 12 }, today);
  assert.equal(covered.length, 12);
  assert.equal(covered[0], '2026-02-05');
  assert.equal(covered[11], '2027-01-05');
  const s = sub(entries);
  const rows = proxyRows(state(s), s, today);
  const totals = proxyTotals(rows);
  assert.equal(totals.open.length, 0);
  assert.ok(Math.abs(totals.diff - 2 * -0.5) < 1e-9);
  const ahead = proxyAhead(state(s), s, today);
  assert.equal(ahead.length, 10);
  assert.ok(Math.abs(ahead.reduce((a, r) => a + r.receivedBase!, 0) - 95) < 1e-9);
  // 撤销整笔：各期恢复待收，第一期的单独收款不受影响
  const undone = sub(removeProxyBatch(entries, 'b1'));
  assert.equal(undone.proxy!.entries.length, 1);
  assert.equal(proxyTotals(proxyRows(state(undone), undone, today)).open.length, 2);
});

test('一笔多期跳过已收的期，保留实扣修正；订阅提前结束凑不够期数时报错', () => {
  const s0 = sub([
    { charge: '2026-02-05', charged: 11 },
    { charge: '2026-04-05', received: 10, receivedCurrency: 'USD', receivedOn: '2026-03-01' },
  ]);
  const { entries, covered } = recordProxyReceipt(s0, { ...receipt, amount: 30, from: '2026-02-01', periods: 3 }, today);
  assert.deepEqual(covered, ['2026-02-05', '2026-03-05', '2026-05-05']);
  assert.equal(entries.find((e) => e.charge === '2026-02-05')!.charged, 11);
  assert.equal(proxyOpenPeriods(sub([], { end: '2026-06-01' }), '2026-04-01', 5, today).length, 2);
  assert.throws(() => recordProxyReceipt(sub([], { end: '2026-06-01' }), { ...receipt, amount: 50, from: '2026-04-01', periods: 5 }, today));
});

test('预收的下一期不会按相近日期挪去抵眼前没收的这期', () => {
  const s0 = sub([], { cycle: { unit: 'week', every: 1 }, start: '2026-03-02' });
  const { entries } = recordProxyReceipt(s0, { ...receipt, amount: 10, from: '2026-03-21', periods: 1 }, today);
  const s = sub(entries, { cycle: { unit: 'week', every: 1 }, start: '2026-03-02' });
  assert.equal(proxyTotals(proxyRows(state(s), s, today)).open.length, 3);
  assert.equal(proxyAhead(state(s), s, today).length, 1);
});
