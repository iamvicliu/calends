import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detailForecast, detailHistoryEnd } from '../app/src/views/detail-data.ts';
import type { Cycle, Subscription } from './types.ts';

const today = '2026-10-22';
const subscription = (cycle: Cycle, overrides: Partial<Subscription> = {}): Subscription => ({
  id: 'fictional',
  name: 'Fictional forecast',
  price: 120,
  currency: 'EUR',
  cycle,
  start: '2020-12-15',
  status: 'active',
  category: 'tools',
  tags: [],
  ...overrides,
});

test('monthly and quarterly details retain their complete twelve-month billing rhythm', () => {
  for (const [months, count] of [
    [1, 12],
    [3, 4],
  ]) {
    const result = detailForecast(subscription({ unit: 'month', every: months }), today);
    assert.equal(result.sparse, false);
    assert.equal(result.charges.length, count);
    assert.ok(result.charges.every((c) => c.date > today && c.date <= '2027-10-22'));
  }
});

test('annual, multi-year and sparse forecasts show only the next charge, including beyond a year', () => {
  for (const cycle of [
    { unit: 'year', every: 1 },
    { unit: 'year', every: 3 },
    { unit: 'month', every: 24 },
    { unit: 'month', every: 6 },
  ] as Cycle[]) {
    const result = detailForecast(subscription(cycle, { start: '2025-12-15' }), today);
    assert.equal(result.sparse, true);
    assert.equal(result.charges.length, 1);
    assert.equal(result.charges[0].currency, 'EUR');
    assert.equal(result.charges[0].amount, 120);
  }
  assert.equal(detailForecast(subscription({ unit: 'year', every: 3 }, { start: '2025-12-15' }), today).charges[0].date, '2028-12-15');
  assert.equal(detailForecast(subscription({ unit: 'month', every: 24 }, { start: '2025-12-15' }), today).charges[0].date, '2027-12-15');
});

test('sparse monthly ending plans and future phase changes use the actual scheduled phase', () => {
  const ending = subscription({ unit: 'month', every: 1 }, { end: '2026-12-31' });
  assert.equal(detailForecast(ending, today).sparse, true);
  assert.equal(detailForecast(ending, today).charges[0].date, '2026-11-15');
  const switched = subscription(
    { unit: 'year', every: 3 },
    {
      phases: [
        { start: '2020-12-15', end: '2026-10-31', price: 12, currency: 'USD', cycle: { unit: 'month', every: 1 } },
        { start: '2026-11-01', price: 360, currency: 'EUR', cycle: { unit: 'year', every: 3 }, planned: true },
      ],
    },
  );
  const result = detailForecast(switched, today);
  assert.equal(result.sparse, true);
  assert.equal(result.charges[0].date, '2026-11-01');
  assert.equal(result.charges[0].amount, 360);
  assert.equal(result.charges[0].sub.planned, true);
});

test('lifetime, paused and ended subscriptions have no renewal forecast; zero-price charges remain zero', () => {
  for (const sub of [
    subscription({ unit: 'lifetime', every: 1 }),
    subscription({ unit: 'lifetime', every: 1 }, { start: '2027-01-01' }),
    subscription({ unit: 'month', every: 1 }, { status: 'paused', pausedAt: today }),
    subscription({ unit: 'year', every: 1 }, { end: '2025-12-31' }),
  ]) {
    assert.equal(detailForecast(sub, today).charges.length, 0);
  }
  const free = detailForecast(subscription({ unit: 'year', every: 1 }, { price: 0 }), today);
  assert.equal(free.charges[0].amount, 0);
});

test('stopped detail histories end at their actual stop, not today or the unused prepaid expiry', () => {
  const stopped = subscription(
    { unit: 'year', every: 1 },
    {
      status: 'cancelled',
      end: '2026-07-17',
      stop: { kind: 'cancel', date: '2026-07-17', paidThrough: '2027-02-05' },
      payments: [{ date: '2026-02-06', amount: 120 }],
    },
  );
  assert.deepEqual(detailHistoryEnd(stopped, today), { date: '2026-07-17', unknown: false });
  assert.deepEqual(detailHistoryEnd(subscription({ unit: 'month', every: 1 }, { status: 'paused', pausedAt: '2025-08-15' }), today), {
    date: '2025-08-14',
    unknown: false,
  });
});

test('unknown stop dates bound the chart to the last recorded paid period without inventing an end date', () => {
  const stopped = subscription(
    { unit: 'month', every: 3 },
    {
      status: 'cancelled',
      start: '2021-10-30',
      payments: [
        { date: '2021-10-30', amount: 120 },
        { date: '2023-07-30', amount: 120 },
        { date: '2024-01-01', amount: -20, kind: 'refund' },
      ],
    },
  );
  const original = JSON.stringify(stopped);
  assert.deepEqual(detailHistoryEnd(stopped, today), { date: '2023-10-29', unknown: true });
  assert.deepEqual(detailHistoryEnd(stopped, '2028-10-22'), { date: '2023-10-29', unknown: true });
  assert.equal(JSON.stringify(stopped), original);
});

test('unknown early stops never extend paid coverage into today or future ownership', () => {
  const stopped = subscription({ unit: 'year', every: 1 }, { status: 'cancelled', payments: [{ date: '2026-02-06', amount: 120 }] });
  assert.deepEqual(detailHistoryEnd(stopped, today), { date: '2026-02-06', unknown: true });
  const zero = subscription({ unit: 'month', every: 1 }, { status: 'cancelled', start: '2024-01-31', payments: [{ date: '2024-01-31', amount: 0 }] });
  assert.deepEqual(detailHistoryEnd(zero, today), { date: '2024-02-28', unknown: true });
});

test('phase history keeps overlaps and known ends while identifying an undated final stop', () => {
  const sub = subscription(
    { unit: 'month', every: 1 },
    {
      status: 'cancelled',
      phases: [
        { start: '2020-12-15', end: '2024-06-30', price: 120, currency: 'EUR', cycle: { unit: 'year', every: 1 } },
        { start: '2024-03-01', price: 10, currency: 'EUR', cycle: { unit: 'month', every: 1 }, payments: [{ date: '2024-04-01', amount: 10 }] },
      ],
    },
  );
  assert.deepEqual(detailHistoryEnd(sub, today), { date: '2024-06-30', unknown: true });
  for (const live of [subscription({ unit: 'month', every: 1 }), subscription({ unit: 'lifetime', every: 1 })]) {
    assert.deepEqual(detailHistoryEnd(live, today), { date: undefined, unknown: false });
  }
});
