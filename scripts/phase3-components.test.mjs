import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transformSync } from 'oxc-transform-react';
import { extractUiFunction } from './ui-test-source.ts';
import { currentPhase } from '../shared/billing.ts';

const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'fragment' };
function component(file, name, deps) {
  const code = transformSync(name + '.tsx', extractUiFunction(new URL('../app/src/views/' + file, import.meta.url), name), { lang: 'tsx', jsx: { runtime: 'classic' }, reactCompiler: false }).code.replace(/export /g, '');
  return new Function('React', ...Object.keys(deps), code + ';return ' + name)(React, ...Object.values(deps));
}

test('proxy card price stays in the current phase when a future plan is scheduled', () => {
  const amounts = [];
  const noop = () => null;
  const deps = { currentPhase, useState: (v) => [v, noop], todayIn: () => '2026-10-25', rows: () => [], proxyAhead: noop, nextCharge: noop, addDays: noop, proxyTotals: () => ({ charged: 0, received: 0 }), effectiveStatus: () => 'active', isStopped: () => false, proxyStatus: () => ['', ''], money: (v, c) => { amounts.push([v, c]); return String(v); }, flow: String, cycleLabel: () => '', copyParts: String, cnDate: String, t: String, personFor: noop, contactText: noop };
  for (const key of ['SubIcon','NameLink','StatusPill','PersonAvatar','PayBadge','MetricCards','Metric','OwedOrNet','LedgerSheet']) deps[key] = key;
  const ProxyCard = component('Proxy.tsx', 'ProxyCard', deps);
  ProxyCard({ state: { settings: { baseCurrency: 'CNY' }, methods: [] }, s: { id: 's', name: 'Fictional future plan', start: '2026-01-01', price: 999, currency: 'EUR', cycle: { unit: 'month', every: 1 }, proxy: {}, phases: [{ start: '2026-01-01', price: 10, currency: 'USD', cycle: { unit: 'month', every: 1 } }, { start: '2026-12-01', price: 999, currency: 'EUR', cycle: { unit: 'month', every: 1 }, planned: true }] } });
  assert.deepEqual(amounts, [[10, 'USD']]);
});
