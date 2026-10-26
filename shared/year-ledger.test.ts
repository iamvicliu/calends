import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldGroupYears } from '../app/src/components/year-ledger.ts';
const dateOf = (x: { date: string }) => x.date;
const rows = (...dates: string[]) => dates.map((date) => ({ date }));

test('empty, singleton and one record per year render flat even across nonadjacent years', () => {
  for (const list of [[], rows('2026-01-01'), rows('2026-01-01', '2025-12-31'), rows('2022-06-01', '2026-02-01', '2024-01-01')])
    assert.equal(shouldGroupYears(list, dateOf), false);
});
test('any year with two records groups all years, including a single populated year and unsorted rows', () => {
  for (const list of [rows('2026-01-01', '2026-12-31'), rows('2025-01-01', '2026-01-01', '2025-12-31'), rows('2024-01-01', '2026-01-01', '2026-01-01')])
    assert.equal(shouldGroupYears(list, dateOf), true);
});
test('predicate reads the supplied date accessor and preserves source ordering and records', () => {
  const input = Object.freeze([Object.freeze({ receipt: { date: '2026-01-01' } }), Object.freeze({ receipt: { date: '2026-02-01' } })]);
  assert.equal(
    shouldGroupYears(input, (r) => r.receipt.date),
    true,
  );
  assert.deepEqual(
    input.map((r) => r.receipt.date),
    ['2026-01-01', '2026-02-01'],
  );
});
