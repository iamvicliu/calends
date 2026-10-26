import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monthlyMine, totals } from './billing.ts';
import { contributionOn, mrrOn, mrrSeries } from './metrics.ts';
import { DEFAULT_SETTINGS, type AppState, type Subscription } from './types.ts';

test('missing monthly FX propagates through per-subscription, totals and historical MRR', () => {
  const s: Subscription = {
    id: 'xcd',
    name: 'Fictional XCD',
    tags: [],
    category: 'Test',
    price: 27,
    currency: 'XCD',
    start: '2026-01-01',
    cycle: { unit: 'month', every: 1 },
    status: 'active',
  };
  const st: AppState = {
    subscriptions: [s],
    methods: [],
    settings: { ...DEFAULT_SETTINGS, baseCurrency: 'CNY' },
    fx: { base: 'USD', rates: { USD: 1, CNY: 1 }, fetchedAt: '2026-10-25T00:00:00Z' },
    fxHistory: {},
    prefs: {},
  };
  const day = '2026-10-25';
  assert.ok(Number.isNaN(monthlyMine(st, s, day)));
  assert.ok(Number.isNaN(contributionOn(st, s, day)));
  assert.ok(Number.isNaN(mrrOn(st, day)));
  assert.ok(Number.isNaN(mrrSeries(st, day, 2)[0].mrr));
  const total = totals(st, day);
  assert.ok(Number.isNaN(total.mrr));
  assert.equal(total.activeCount, 1);
  assert.equal(total.incomplete, true);
  st.fx.rates.XCD = 2;
  assert.ok(Number.isFinite(totals(st, day).mrr));
  assert.equal(totals(st, day).incomplete, false);
});

test('proxy missing FX cannot make personal MRR incomplete', () => {
  const st = {
    subscriptions: [
      {
        id: 'p',
        name: 'Fictional proxy',
        start: '2026-01-01',
        price: 27,
        currency: 'XCD',
        cycle: { unit: 'month', every: 1 },
        status: 'active',
        proxy: { forName: 'Fictional person' },
      },
    ],
    methods: [],
    settings: DEFAULT_SETTINGS,
    fx: { base: 'USD', rates: { USD: 1 }, fetchedAt: '' },
  } as AppState;
  assert.equal(mrrOn(st, '2026-10-25'), 0);
});
