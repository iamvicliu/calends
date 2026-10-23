import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectionAnchor, collectionDates, collectionPeriod, memberCollection, memberDues, memberUnpaidFrom } from './billing.ts';
import type { ShareMember, Subscription } from './types.ts';

const newcomer = (extra: Partial<ShareMember> = {}): ShareMember => ({
  id: 'jj',
  name: 'JJ朋友',
  share: 10,
  fee: 60,
  feeCurrency: 'CNY',
  billEvery: 6,
  joined: '2026-10-20',
  ...extra,
});
const sub = (m = newcomer()): Subscription => ({
  id: 'test-share',
  name: '测试·半年合租',
  category: 'Tools',
  tags: [],
  price: 60,
  currency: 'CNY',
  cycle: { unit: 'month', every: 1 },
  start: '2025-01-01',
  status: 'active',
  share: {
    role: 'owner',
    seats: 4,
    since: '2026-01-17',
    members: [{ id: 'old', name: 'Existing', share: 10, fee: 60, billEvery: 6, joined: '2026-01-17', paidUntil: '2026-07-16' }, m],
  },
});

test('半年合租：中途加入只收到共同期末，之后与原成员同日收款', () => {
  const m = newcomer();
  const s = sub(m);
  assert.deepEqual(memberCollection(s, m, m.joined!), {
    from: '2026-10-20',
    until: '2027-01-16',
    next: '2027-01-17',
    amount: 29.02,
    currency: 'CNY',
    partial: true,
  });
  const dues = memberDues(s, '2026-10-22');
  assert.equal(dues[0].owed, 60);
  assert.equal(dues[1].owed, 29.02);
  assert.equal(dues[1].dueFor, '2026-10-20');
  const paid = { ...m, paidUntil: '2027-01-16' };
  assert.equal(memberUnpaidFrom(s, paid), '2027-01-17');
  assert.deepEqual(memberCollection(s, paid, memberUnpaidFrom(s, paid)), {
    from: '2027-01-17',
    until: '2027-07-16',
    next: '2027-07-17',
    amount: 60,
    currency: 'CNY',
    partial: false,
  });
  assert.equal(memberDues(sub(paid), '2027-01-16')[1].owed, 0);
  assert.equal(memberDues(sub(paid), '2027-01-17')[1].owed, 60);
  assert.equal(memberDues(s, '2027-07-17')[1].owed, 149.02);
});

test('月、季、半年、年对齐：月末、闰日及原始日号不会累积漂移', () => {
  const s = sub();
  s.share!.collectFrom = '2024-01-31';
  for (const [billEvery, day, from, until, next] of [
    [1, '2024-02-29', '2024-02-29', '2024-03-30', '2024-03-31'],
    [3, '2024-04-30', '2024-04-30', '2024-07-30', '2024-07-31'],
    [6, '2024-08-01', '2024-07-31', '2025-01-30', '2025-01-31'],
    [12, '2025-01-31', '2025-01-31', '2026-01-30', '2026-01-31'],
  ] as const)
    assert.deepEqual(collectionPeriod(s, newcomer({ billEvery }), day), { from, until, next });
  s.share!.collectFrom = '2024-02-29';
  assert.deepEqual(collectionPeriod(s, newcomer({ billEvery: 12 }), '2028-02-29'), { from: '2028-02-29', until: '2029-02-27', next: '2029-02-28' });
  assert.deepEqual(collectionPeriod(s, newcomer({ billEvery: 6 }), '2023-02-28'), { from: '2023-02-28', until: '2023-08-28', next: '2023-08-29' });
  assert.deepEqual(collectionDates(sub(), newcomer(), '2026'), ['2026-10-20']);
});

test('首期按天、整期、免费、自定义；边界加入不折算、零元标准可用', () => {
  for (const [firstPeriod, owed] of [
    ['prorate', 29.02],
    ['full', 60],
    ['free', 0],
  ] as const) {
    const m = newcomer({ firstPeriod });
    const s = sub(m);
    assert.equal(memberCollection(s, m, m.joined!).amount, owed);
    assert.equal(memberDues(s, '2026-10-22')[1].owed, owed);
    assert.equal(memberDues(s, '2027-01-17')[1].owed, owed + 60);
    assert.equal(memberUnpaidFrom(s, m), firstPeriod === 'free' ? '2027-01-17' : m.joined);
  }
  for (const firstPeriod of ['prorate', 'full', 'free'] as const) {
    const m = newcomer({ firstPeriod, firstAmount: 18.88 });
    assert.equal(memberDues(sub(m), '2026-10-22')[1].owed, firstPeriod === 'free' ? 0 : 18.88);
  }
  const aligned = newcomer({ joined: '2026-07-17', firstPeriod: 'free' });
  assert.equal(memberDues(sub(aligned), '2026-07-17')[1].owed, 60);
  assert.equal(memberDues(sub(newcomer({ fee: 0 })), '2027-01-17')[1].owed, 0);
  const s = sub();
  assert.equal(memberDues(s, '2026-10-19')[1].owed, 0);
  assert.equal(memberDues(s, '2026-10-19')[1].dueFor, '2026-10-20');
  assert.equal(memberDues(sub(newcomer({ exempt: true })), '2026-10-22')[1].owed, 0);
});

test('旧数据推断起点，原成员应收不变；JSON 往返保留可选字段', () => {
  const s = sub();
  delete s.share!.since;
  const existing = s.share!.members[0];
  existing.payments = [{ date: '2026-01-16', amount: 60, currency: 'CNY', from: '2026-01-17', until: '2026-07-16' }];
  assert.equal(collectionAnchor(s), '2026-01-17');
  assert.equal(memberDues(s, '2026-10-22')[0].owed, 60);
  delete existing.payments;
  assert.equal(collectionAnchor(s), '2026-01-17');
  assert.equal(memberDues(s, '2026-10-22')[0].owed, 60);
  delete existing.paidUntil;
  assert.equal(collectionAnchor(s), s.start);
  s.share!.since = '2026-01-17';
  s.share!.collectFrom = '2026-01-31';
  s.share!.members[1] = newcomer({ firstPeriod: 'full', firstAmount: 22.5 });
  const roundTrip = JSON.parse(JSON.stringify(s));
  assert.equal(collectionAnchor(roundTrip), '2026-01-31');
  assert.equal(memberDues(roundTrip, '2026-10-22')[1].owed, 22.5);
  assert.deepEqual(roundTrip, s);
});

test('首期内退出：退出日不计，按天分母仍为整期天数，之后不再收费', () => {
  for (const [firstPeriod, amount] of [
    ['prorate', 3.59],
    ['full', 60],
    ['free', 0],
  ] as const) {
    const m = newcomer({ firstPeriod, left: '2026-10-31' });
    const s = sub(m);
    assert.equal(memberCollection(s, m, m.joined!).until, '2026-10-30');
    assert.equal(memberDues(s, '2028-01-01')[1].owed, amount);
    assert.equal(memberDues(s, '2026-10-22')[1].owed, amount);
    m.paidUntil = '2026-10-30';
    assert.equal(memberDues(s, '2028-01-01')[1].owed, 0);
  }
  const m = newcomer({ left: '2026-10-20' });
  assert.equal(memberDues(sub(m), '2028-01-01')[1].owed, 0);
});

test('常规收款独立于统一日：7月16日已付至，下一期完整收44并覆盖半年', () => {
  const m = newcomer({ joined: '2025-10-14', paidUntil: '2026-07-16', fee: 44 });
  const s = sub(m);
  s.share!.collectFrom = '2025-10-14';
  const from = memberUnpaidFrom(s, m);
  assert.deepEqual(memberCollection(s, m, from), { from: '2026-07-17', until: '2027-01-16', next: '2027-01-17', amount: 44, currency: 'CNY', partial: false });
  assert.equal(memberDues(s, '2026-10-22')[1].owed, 44);
  // 已补记了较短的加入首期，随后即使仍在统一周期内也收完整一期。
  const shortenedFirst = {
    ...m,
    joined: '2026-06-01',
    payments: [{ date: '2026-06-01', amount: 40, currency: 'CNY', from: '2026-06-01', until: '2026-07-16' }],
  };
  assert.equal(memberCollection(s, shortenedFirst, memberUnpaidFrom(s, shortenedFirst)).amount, 44);
  assert.equal(memberCollection(s, shortenedFirst, memberUnpaidFrom(s, shortenedFirst)).partial, false);
  const customized = { ...m, paidUntil: '2027-02-03' };
  assert.equal(memberCollection(s, customized, memberUnpaidFrom(s, customized)).until, '2027-08-03');
  assert.deepEqual(collectionDates(s, customized, '2027'), ['2027-02-04', '2027-08-04']);
});
