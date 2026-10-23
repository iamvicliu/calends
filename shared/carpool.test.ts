import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_FX } from './billing.ts';
import { toBaseAt } from './fx.ts';
import {
  applyCarRule,
  carRule,
  followCarRule,
  followsCar,
  refreshReceiptDraft,
  resyncShares,
  suggestedLeaveRefund,
  carLedger,
  memberCashFlows,
  updateMemberLeave,
} from './carpool.ts';
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

test('已退出成员在首次存规则和追溯调价时保持原样', () => {
  for (const fee of [44, 99]) {
    const s = ruleCar();
    s.share!.members[0] = { ...s.share!.members[0], fee, left: '2026-09-01' };
    for (const from of ['2026-08-01', '2026-11-01']) {
      const next = applyCarRule(state, s, { billEvery: 3, fee: 30, currency: 'CNY' }, from, today);
      assert.deepEqual(next.share!.members[0], s.share!.members[0]);
    }
  }
});

test('下车建议逐笔按实际实收日单价折算，跨两笔、跨币种并保留原币明细', () => {
  const s = ruleCar();
  const m = {
    ...s.share!.members[0],
    joined: '2026-01-01',
    left: '2026-01-16',
    payments: [
      { date: '2026-01-01', from: '2026-01-01', until: '2026-01-31', amount: 31, currency: 'USD' },
      { date: '2026-01-15', from: '2026-02-01', until: '2026-02-28', amount: 56, currency: 'CNY' },
    ],
  };
  const fx = { ...state, fxHistory: { '2026-01-16': { USD: 1, CNY: 7 } } };
  const before = structuredClone(m);
  const r = suggestedLeaveRefund(fx, s, m);
  assert.equal(r.currency, 'USD');
  assert.equal(r.amount, 24); // USD16 + CNY56 / 7
  assert.equal(r.unusedDays, 44);
  assert.deepEqual(
    r.parts.map((p) => [p.amount, p.currency]),
    [
      [16, 'USD'],
      [56, 'CNY'],
    ],
  );
  assert.deepEqual(m, before);
  assert.equal(suggestedLeaveRefund(fx, s, m, 'CNY').amount, 168);
  assert.equal(suggestedLeaveRefund(fx, s, { ...m, left: '2026-03-01' }).amount, 0);
  assert.equal(suggestedLeaveRefund(fx, s, { ...m, left: undefined }).amount, 0);
  assert.equal(suggestedLeaveRefund(fx, s, { ...m, payments: [] }).amount, 0);
  const missing = { ...fx, fxHistory: undefined, fx: { ...fx.fx, rates: { USD: 1 } } };
  assert.ok(Number.isNaN(suggestedLeaveRefund(missing, s, m).amount));
});

test('旧收款无覆盖起点按周期和加入日推断，退出当日也属未用，零位币种建议不带小数', () => {
  const s = ruleCar();
  const m = {
    ...s.share!.members[0],
    billEvery: 1,
    joined: '2026-01-10',
    left: '2026-01-31',
    payments: [{ date: '2026-01-10', until: '2026-01-31', amount: 100, currency: 'JPY' }],
  };
  assert.equal(suggestedLeaveRefund(state, s, m).amount, 5);
  assert.equal(suggestedLeaveRefund(state, s, m).unusedDays, 1);
});

test('账本和现金流按退款日汇率扣实际退款，年度净额包含本年已退，历史完整保留', () => {
  const s = ruleCar();
  const m = { ...s.share!.members[0], left: '2026-10-01', leaveRefund: { amount: 2, currency: 'USD', date: '2026-10-02', note: 'Actual refund' } };
  s.share!.members = [m];
  const st = { ...state, fxHistory: { '2026-10-02': { USD: 1, CNY: 8 } } };
  const before = structuredClone(s);
  const book = carLedger(st, s, '2026-10-23');
  assert.equal(book.received, 28); // CNY44 - USD2 × 8
  assert.equal(book.yearRefunded, 16);
  assert.equal(book.yearIncome, -16);
  assert.equal(book.yearNet, book.yearCost + 16);
  assert.equal(book.net, book.paid - 28);
  assert.equal(memberCashFlows(m).at(-1)!.amount, -2);
  assert.deepEqual(s, before);
  assert.equal(carLedger(st, s, '2027-01-01').yearRefunded, 0);
  assert.equal(
    carLedger(st, { ...s, share: { ...s.share!, members: [{ ...m, leaveRefund: { ...m.leaveRefund, currency: 'ZZZ' } }] } }, '2026-10-23').received,
    NaN,
  );
  const cleared = updateMemberLeave(m, { left: undefined });
  assert.equal(cleared.leaveRefund, undefined);
  assert.deepEqual(cleared.payments, m.payments);
  assert.equal(cleared.paidUntil, m.paidUntil);
});
