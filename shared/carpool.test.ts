import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_FX } from './billing.ts';
import { toBaseAt } from './fx.ts';
import { resyncShares } from './carpool.ts';
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
