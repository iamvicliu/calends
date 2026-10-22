import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_FX } from './billing.ts';
import { toBaseAt } from './fx.ts';
import { applyCarRule, carRule, followCarRule, followsCar, refreshReceiptDraft, resyncShares } from './carpool.ts';
import { memberRate } from './billing.ts';
import { DEFAULT_SETTINGS, type AppState, type Subscription } from './types.ts';

const sub = (o: Partial<Subscription> = {}): Subscription => ({
  id: 's',
  name: 'Surge Mac',
  category: '工具',
  tags: [],
  price: 329,
  currency: 'CNY',
  cycle: { unit: 'year', every: 1 },
  start: '2025-10-28',
  status: 'active',
  share: {
    role: 'owner',
    seats: 5,
    members: [
      { id: 'a', name: 'A', share: 60, fee: 60, feeCurrency: 'CNY', billEvery: 12 },
      { id: 'b', name: '自己 · 第 2 台', share: 0, exempt: true },
      { id: 'c', name: 'C', share: 30 },
    ],
  },
  ...o,
});
const state: AppState = { subscriptions: [], methods: [], settings: { ...DEFAULT_SETTINGS, baseCurrency: 'CNY' }, fx: FALLBACK_FX };

test('订阅改成美元后，成员份额按收费标准重新折算，不把 ¥60 当成 $60', () => {
  const prev = sub();
  const next = resyncShares(state, prev, { ...prev, price: 45.99, currency: 'USD' });
  const usd = Math.round(toBaseAt(state, 60, 'CNY', undefined, 'USD') * 100) / 100;
  assert.equal(next.share!.members[0].share, usd);
  assert.ok(usd < 15);
  // 不分摊的、没有收费标准的保持原样
  assert.equal(next.share!.members[1].share, 0);
  assert.equal(next.share!.members[2].share, 30);
});

test('币种和周期都没变时不动', () => {
  const prev = sub();
  const next = { ...prev, price: 300 };
  assert.equal(resyncShares(state, prev, next), next);
  assert.equal(resyncShares(state, undefined, next), next);
});

test('年付改成月付：每期份额变成一个月的', () => {
  const prev = sub();
  const next = resyncShares(state, prev, { ...prev, price: 30, cycle: { unit: 'month', every: 1 } });
  assert.equal(next.share!.members[0].share, 5);
});

test('收费周期变化只更新覆盖期，保留手改金额、币种、备注和收款日', () => {
  const draft = { amount: 12.34, currency: 'USD', note: '审查草稿', date: '2026-10-21', from: '2026-10-14', until: '2027-04-13' };
  const next = { amount: 37.39, currency: 'CNY', date: '2026-10-22', from: '2026-10-14', until: '2027-01-13' };
  assert.deepEqual(refreshReceiptDraft(draft, next, true), { ...draft, until: next.until });
  assert.deepEqual(refreshReceiptDraft(draft, next, false), { ...draft, amount: 37.39, currency: 'CNY', until: next.until });
  // 手填 0 或恰好等于默认金额仍是明确的用户输入。
  for (const amount of [0, next.amount]) {
    assert.equal(refreshReceiptDraft({ ...draft, amount }, { ...next, amount: 75 }, true).amount, amount);
  }
  const refreshed = refreshReceiptDraft(draft, next, true);
  assert.equal(refreshReceiptDraft(refreshed, { ...next, until: '2026-11-13' }, true).note, draft.note);
  assert.deepEqual(draft, { amount: 12.34, currency: 'USD', note: '审查草稿', date: '2026-10-21', from: '2026-10-14', until: '2027-04-13' });
});

const ruleCar = (): Subscription => ({
  ...sub({ price: 279, currency: 'CNY', cycle: { unit: 'month', every: 1 }, start: '2021-04-14' }),
  share: {
    role: 'owner',
    seats: 6,
    collectFrom: '2026-01-17',
    members: [
      {
        id: 'a',
        name: 'A',
        share: 7.33,
        fee: 44,
        feeCurrency: 'CNY',
        billEvery: 6,
        paidUntil: '2026-07-16',
        payments: [{ date: '2026-01-17', amount: 44, currency: 'CNY', from: '2026-01-17', until: '2026-07-16' }],
      },
      { id: 'b', name: 'B', share: 7.33, fee: 44, feeCurrency: 'CNY', billEvery: 6 },
      { id: 'c', name: 'C', share: 10, fee: 120, feeCurrency: 'CNY', billEvery: 12, custom: true },
      { id: 'd', name: '自己', share: 0, exempt: true },
    ],
  },
});
const today = '2026-10-22';

test('车的收款规则缺省取在车成员里最常见的收费标准，自定义与不分摊的不跟随', () => {
  const s = ruleCar();
  assert.deepEqual(carRule(state, s, today), { billEvery: 6, fee: 44, currency: 'CNY' });
  assert.equal(followsCar(state, s, s.share!.members[0], today), true);
  assert.equal(followsCar(state, s, s.share!.members[2], today), false);
  assert.equal(followsCar(state, s, s.share!.members[3], today), false);
});

test('改车的规则：跟随车的成员从生效日起调价，历史收款与自定义成员不变', () => {
  const s = ruleCar();
  const next = applyCarRule(state, s, { billEvery: 12, fee: 80, currency: 'CNY' }, '2027-01-17', today);
  assert.deepEqual(next.share!.rule, { billEvery: 12, fee: 80, currency: 'CNY' });
  const [a, b, c, d] = next.share!.members;
  // 生效前仍按旧标准，生效后按新标准
  assert.equal(memberRate(next, a, '2026-12-01', 'CNY').amount, 44);
  assert.equal(memberRate(next, a, '2027-02-01', 'CNY').amount, 80);
  assert.equal(memberRate(next, b, '2027-02-01', 'CNY').billEvery, 12);
  assert.deepEqual(a.payments, s.share!.members[0].payments);
  assert.equal(c, s.share!.members[2]);
  assert.equal(d, s.share!.members[3]);
});

test('成员改回跟随车：去掉自定义标记，并从生效日起套用车的规则', () => {
  const s = ruleCar();
  const m = followCarRule(state, s, s.share!.members[2], '2026-11-01', today);
  assert.equal(m.custom, undefined);
  assert.equal(memberRate(s, m, '2026-12-01', 'CNY').amount, 44);
  assert.equal(memberRate(s, m, '2026-12-01', 'CNY').billEvery, 6);
});

test('老车第一次存规则时，与规则不一致的成员标为自定义，之后不会被误当成跟随车', () => {
  const s = ruleCar();
  s.share!.members[2] = { ...s.share!.members[2], custom: undefined };
  const next = applyCarRule(state, s, { billEvery: 6, fee: 44, currency: 'CNY' }, '2026-11-01', today);
  assert.equal(next.share!.members[2].custom, true);
  assert.equal(followsCar(state, next, next.share!.members[2], today), false);
  assert.equal(followsCar(state, next, next.share!.members[0], today), true);
});
