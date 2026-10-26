import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberCollection, memberDues, memberPeriods } from './billing.ts';
import { nextCollectionDay } from './carpool.ts';
import { migrateReceivables } from './receivables-legacy.ts';
import type { ShareMember, Subscription } from './types.ts';

const member = (overrides: Partial<ShareMember> = {}): ShareMember => ({
  id: 'member',
  name: 'Fictional member',
  joined: '2026-01-31',
  share: 10,
  fee: 10,
  feeCurrency: 'CNY',
  billEvery: 1,
  ...overrides,
});
const plan = (m = member(), anchor = '2026-01-31'): Subscription => ({
  id: 'fictional-plan',
  name: 'Fictional shared plan',
  category: 'Test',
  tags: [],
  price: 30,
  currency: 'CNY',
  cycle: { unit: 'month', every: 1 },
  start: '2026-01-01',
  status: 'active',
  share: { role: 'owner', seats: 3, collectFrom: anchor, members: [m] },
});
const starts = (s: Subscription, through: string) => memberPeriods(s, s.share!.members[0], through, 'CNY').map((p) => p.from);

test('month-end monthly periods return to the 31st after short months and agree with the next collection day', () => {
  const s = plan();
  const dates = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'];
  assert.deepEqual(starts(s, dates.at(-1)!), dates);
  for (let i = 0; i < dates.length - 1; i++) {
    assert.equal(memberCollection(s, s.share!.members[0], dates[i], 'CNY').next, dates[i + 1]);
    assert.equal(nextCollectionDay(s, 1, dates[i]), dates[i + 1]);
  }
});

test('quarterly periods retain the original 30th', () => {
  const s = plan(member({ joined: '2026-01-30', billEvery: 3 }), '2026-01-30');
  assert.deepEqual(starts(s, '2026-10-30'), ['2026-01-30', '2026-04-30', '2026-07-30', '2026-10-30']);
  assert.equal(nextCollectionDay(s, 3, '2026-04-30'), '2026-07-30');
});

test('a restart sets the subsequent collection day, overriding both the plan and member anchors', () => {
  const s = plan(member({ restarts: ['2026-03-15'] }));
  assert.deepEqual(starts(s, '2026-05-15'), ['2026-01-31', '2026-02-28', '2026-03-15', '2026-04-15', '2026-05-15']);
  const pinned = plan(member({ anchor: '2026-01-30', joined: '2026-01-30' }));
  assert.deepEqual(starts(pinned, '2026-05-30'), ['2026-01-30', '2026-02-28', '2026-03-30', '2026-04-30', '2026-05-30']);
  const restarted = plan(member({ anchor: '2026-01-30', joined: '2026-01-30', restarts: ['2026-03-15'] }));
  assert.deepEqual(starts(restarted, '2026-05-15'), ['2026-01-30', '2026-02-28', '2026-03-15', '2026-04-15', '2026-05-15']);
});

test('migration aligns receipt, waiver and opening keys by period and is idempotent', () => {
  const old = ['2026-01-31', '2026-02-28', '2026-03-28', '2026-04-28'];
  const aligned = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'];
  const s = plan(
    member({
      receipts: [
        { id: 'receipt', date: '2026-01-31', amount: 40, currency: 'CNY', periods: old },
        { id: 'opening', date: '2026-01-31', amount: 0, currency: 'CNY', periods: old, opening: true },
      ],
      waivers: [{ id: 'waiver', date: '2026-01-31', periods: old }],
    }),
  );
  const migrated = migrateReceivables(s, 'CNY');
  const m = migrated.share!.members[0];
  assert.notEqual(migrated, s);
  for (const record of [...m.receipts!, ...m.waivers!]) assert.deepEqual(record.periods, aligned);
  assert.deepEqual(s.share!.members[0].receipts![0].periods, old);
  assert.equal(m.receipts![0].amount, 40);
  assert.equal(m.receipts![1].opening, true);
  assert.equal(migrateReceivables(migrated, 'CNY'), migrated);
});

test('migration restores settled dues instead of leaving a drifted paid period outstanding', () => {
  const s = plan(
    member({
      receipts: [{ id: 'receipt', date: '2026-01-31', amount: 30, currency: 'CNY', periods: ['2026-01-31', '2026-02-28', '2026-03-28'] }],
    }),
  );
  const before = memberDues(s, '2026-04-01', 'CNY')[0];
  assert.equal(before.owed, 10);
  assert.equal(before.periodsOwed, 1);
  const after = memberDues(migrateReceivables(s, 'CNY'), '2026-04-01', 'CNY')[0];
  assert.equal(after.owed, 0);
  assert.equal(after.periodsOwed, 0);
  assert.equal(after.dueFor, '2026-04-30');
});

test('unmatched keys, non-owner plans and anchors on days 1–28 retain object identity', () => {
  const receipt = { id: 'receipt', date: '2026-01-31', amount: 10, currency: 'CNY', periods: ['2026-03-27', '2026-04-29'] };
  const unmatched = plan(member({ receipts: [receipt] }));
  assert.equal(migrateReceivables(unmatched, 'CNY'), unmatched);
  const joined = { ...unmatched, share: { ...unmatched.share!, role: 'member' as const } };
  assert.equal(migrateReceivables(joined, 'CNY'), joined);
  for (let day = 1; day <= 28; day++) {
    const anchor = `2026-01-${String(day).padStart(2, '0')}`;
    const s = plan(member({ joined: anchor, receipts: [receipt] }), anchor);
    assert.equal(migrateReceivables(s, 'CNY'), s);
  }
});

test('migration does not move an old period key more than three days when restart splits change period ordinals', () => {
  const s = plan(
    member({
      restarts: ['2026-03-30'],
      receipts: [{ id: 'receipt', date: '2027-03-28', amount: 10, currency: 'CNY', periods: ['2027-03-28'] }],
    }),
  );
  const m = s.share!.members[0];
  const old = memberPeriods(s, m, '2027-04-30', 'CNY', true);
  const index = old.findIndex((p) => p.key === '2027-03-28');
  assert.ok(index >= 0);
  assert.equal(memberPeriods(s, m, '2027-04-30', 'CNY')[index].key, '2027-04-30');
  assert.equal(migrateReceivables(s, 'CNY'), s);
});
