import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detailForecast } from '../app/src/views/detail-data.ts';
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
