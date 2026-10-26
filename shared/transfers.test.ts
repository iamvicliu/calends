import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAYS_PER_MONTH, FALLBACK_FX, subError } from './billing.ts';
import { stopSubscription } from './phases.ts';
import { mrrOn, stopLosses, yearReview } from './metrics.ts';
import { monthReport } from './scope-report.ts';
import { maskForPublic } from './mask.ts';
import { holdingPeriod, netCost, transferredStop } from './transfers.ts';
import { DEFAULT_SETTINGS, type AppState, type Subscription, type Transfer } from './types.ts';

// 虚构场景：从别人手里接手一台月付 ¥100 的 VPS（付给原主 ¥1000），后来停用并转手卖了 ¥3500
const today = '2025-10-25';
const vps = (transfers?: Transfer[]): Subscription =>
  stopSubscription(
    {
      id: 'vps',
      name: 'Fictional VPS',
      category: 'tools',
      tags: [],
      price: 100,
      currency: 'CNY',
      cycle: { unit: 'month', every: 1 },
      start: '2025-01-10',
      status: 'active',
      transfers,
    },
    today,
    'cancel',
    '2025-06-20',
  );
const buy: Transfer = { kind: 'buy', date: '2025-01-10', amount: 1000, currency: 'CNY', note: 'premium' };
const sell: Transfer = { kind: 'sell', date: '2025-06-20', amount: 3500, currency: 'CNY' };
const state = (...subs: Subscription[]): AppState => ({
  subscriptions: subs,
  methods: [],
  settings: { ...DEFAULT_SETTINGS, baseCurrency: 'CNY' },
  fx: FALLBACK_FX,
});
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.005, `${actual} ≈ ${expected}`);

test('净成本 = 服务付款 + 转入 − 转出，月均、日均按持有期摊', () => {
  const s = vps([buy, sell]);
  const c = netCost(state(s), s, today);
  near(c.service, 600);
  near(c.bought, 1000);
  near(c.sold, 3500);
  near(c.net, -1900);
  assert.equal(c.charges, 6);
  // 持有期从接手到转出那天（不含），不是到今天
  assert.deepEqual([c.from, c.until, c.days], ['2025-01-10', '2025-06-20', 161]);
  near(c.perMonth, -1900 / (161 / DAYS_PER_MONTH));
  near(c.perDay, c.perMonth / DAYS_PER_MONTH);
  assert.equal(c.incomplete, false);
  // 没有转让时与原来的累计一致
  const plain = vps();
  near(netCost(state(plain), plain, today).net, 600);
});

test('持有期起点取早于开始日的转入；今天之后的转让不计', () => {
  const s = vps([
    { ...buy, date: '2025-01-01' },
    { ...sell, date: '2025-12-01' },
  ]);
  const held = holdingPeriod(s, today);
  assert.equal(held.from, '2025-01-01');
  assert.equal(held.until, today);
  const c = netCost(state(s), s, today);
  near(c.sold, 0);
  near(c.net, 1600);
});

test('有转出的停止不计已付未用损失，没有转出照常计', () => {
  const sold = vps([buy, sell]);
  assert.equal(transferredStop(sold)?.date, '2025-06-20');
  assert.equal(stopLosses(state(sold), today).items.length, 0);
  const kept = vps([buy]);
  assert.equal(transferredStop(kept), undefined);
  assert.ok(stopLosses(state(kept), today).total > 0);
  // 转出早于停用阶段（不在已付期内）不抑制
  const early = vps([{ ...sell, date: '2024-12-01' }]);
  assert.ok(stopLosses(state(early), today).total > 0);
});

test('转让缺汇率时净成本不可用，不当成 0', () => {
  const s = vps([{ ...buy, currency: 'XYZ' }, sell]);
  const c = netCost(state(s), s, today);
  assert.ok(Number.isNaN(c.net));
  assert.ok(Number.isNaN(c.perDay));
  assert.equal(c.incomplete, true);
});

test('年度回顾与月报现金流计入转让；MRR、扣款笔数不计', () => {
  const s = vps([buy, sell]);
  const plain = vps();
  const review = yearReview(state(s), today, '2025');
  near(review.total, -1900);
  assert.equal(review.charges, yearReview(state(plain), today, '2025').charges);
  near(mrrOn(state(s), '2025-03-01'), mrrOn(state(plain), '2025-03-01'));
  const june = monthReport(state(s), '2025-06', today);
  const head = june.blocks[0];
  assert.ok(head.type === 'headline' && head.mode === 'month');
  near(head.total, 100 - 3500);
  assert.equal(head.count, 1);
  near(june.months.at(-1)!.total, -3400);
  const jan = monthReport(state(s), '2025-01', today).blocks[0];
  assert.ok(jan.type === 'headline' && jan.mode === 'month');
  near(jan.total, 1100);
});

test('公开页不下发转让及备注', () => {
  const pub = maskForPublic({ ...state(vps([buy, sell])), settings: { ...DEFAULT_SETTINGS, baseCurrency: 'CNY', publicView: true } });
  assert.equal(pub.subscriptions[0].transfers, undefined);
  assert.doesNotMatch(JSON.stringify(pub), /premium|3500/);
});

test('保存校验转让：种类、日期、正数金额、大写币种', () => {
  const ok = vps([buy, sell]);
  assert.equal(subError(ok), undefined);
  for (const bad of [
    { ...buy, amount: 0 },
    { ...buy, amount: -5 },
    { ...buy, kind: 'gift' },
    { ...buy, date: '2025-02-30' },
    { ...buy, currency: 'cny' },
    { ...buy, note: 3 },
  ])
    assert.ok(subError({ ...ok, transfers: [bad as Transfer] }), JSON.stringify(bad));
  assert.ok(subError({ ...ok, transfers: 'x' as unknown as Transfer[] }));
});
