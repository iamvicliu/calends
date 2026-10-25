import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmInOrder, remainingFailures, writeMismatches, type ToolFailure } from './assistant-result.ts';
import { DEFAULT_SETTINGS, type AppState, type Subscription } from './types.ts';
import { FALLBACK_FX } from './billing.ts';

const sub = (id: string, price = 10): Subscription => ({
  id,
  name: id,
  price,
  currency: 'USD',
  cycle: { unit: 'month', every: 1 },
  start: '2026-01-01',
  status: 'active',
  tags: [],
  category: 'Tools',
});
const ledger = (subscriptions: Subscription[]): AppState => ({
  subscriptions,
  methods: [],
  people: [],
  prefs: {},
  settings: { ...DEFAULT_SETTINGS },
  fx: FALLBACK_FX,
});

test('read-back verifies intended entities/deletions, preserves financial dates, ignores unrelated edits and timestamps', () => {
  const before = ledger([sub('s'), sub('other')]);
  const expected = ledger([{ ...sub('s', 12), end: '2026-07-17' }, sub('other')]);
  const actual = ledger([{ ...sub('s', 12), end: '2026-07-17', updatedAt: 'different' }, sub('other', 99)]);
  assert.deepEqual(writeMismatches(before, expected, actual), []);
  actual.subscriptions[0].end = '2026-07-16';
  assert.deepEqual(writeMismatches(before, expected, actual), ['subscriptions.s']);
  assert.deepEqual(writeMismatches(before, ledger([sub('other')]), before), ['subscriptions.s']);
  const wanted = { ...before, settings: { ...before.settings, remindDays: 5 } };
  assert.deepEqual(writeMismatches(before, wanted, before), ['settings.remindDays']);
});

test('confirm all stops on a failed/unverified write instead of applying dependent drafts', async () => {
  const called: number[] = [];
  await confirmInOrder([1, 2, 3], async (n) => {
    called.push(n);
    return n !== 2;
  });
  assert.deepEqual(called, [1, 2]);
});

test('a recovered tool clears its failure without clearing another target or date', () => {
  const f = (id: string, subscription: string, date: string): ToolFailure => ({
    id,
    name: 'record_payment',
    args: { subscription, date },
    error: 'bad currency',
  });
  const failures = [f('a', 's', '2026-01-01'), f('b', 'other', '2026-01-01'), f('c', 's', '2026-02-01')];
  assert.deepEqual(
    remainingFailures(failures, 'record_payment', { subscription: 's', date: '2026-01-01', currency: 'USD' }, { subscription: { id: 's' } }).map((f) => f.id),
    ['b', 'c'],
  );
});
