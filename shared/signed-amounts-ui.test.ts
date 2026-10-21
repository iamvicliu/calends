import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { transformSync } from 'oxc-transform-react';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { flow, flowSign, setSignedAmounts, symbol } from './format.ts';
import { intlLocale, locale, setLocale } from './i18n.ts';
import { chargeValue } from './fx.ts';
import { FALLBACK_FX, phaseSubs } from './billing.ts';
import { DEFAULT_SETTINGS } from './types.ts';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
function load(file: string, name: string, source: string, deps: Record<string, unknown>) {
  const result = transformSync(file, source.replace(/export function /g, 'function '), {
    lang: 'tsx',
    jsx: { runtime: 'classic' },
    reactCompiler: false,
  });
  assert.equal(result.fatal, false);
  return new Function(...Object.keys(deps), `${result.code}; return ${name};`)(...Object.values(deps));
}
const text = (html: string) => html.replace(/<[^>]*>/g, '');
afterEach(() => {
  setSignedAmounts(true);
  setLocale('en', []);
});

test('Amount renders directed flows, zero, unavailable values and neutral prices/balances with both settings', () => {
  const file = '../app/src/components/ui.tsx';
  const source = read(file).split('export function Amount(')[1].split('/** 分段控件')[0];
  const Amount = load(file, 'Amount', `function Amount(${source}`, { React, flowSign, symbol, intlLocale });
  for (const on of [true, false]) {
    setSignedAmounts(on);
    const render = (value: number, plain = false) => renderToStaticMarkup(React.createElement(Amount, { value, ccy: 'CNY', plain }));
    assert.equal(text(render(-66.94)), `${on ? '−' : ''}¥66.94`);
    assert.equal(text(render(10)), `${on ? '+' : ''}¥10.00`);
    assert.ok(render(10).includes('color:var(--green)'));
    assert.equal(text(render(0)), '¥0.00');
    assert.equal(text(render(-0)), '¥0.00');
    assert.equal(text(render(NaN)), '—');
    assert.equal(text(render(70.02, true)), '¥70.02');
    assert.equal(text(render(1000, true)), '¥1,000.00');
    assert.equal(text(render(-10, true)), '−¥10.00'); // A balance's mathematical sign is independent of cash flow notation.
    assert.ok(!render(1000, true).includes('--green'));
  }
});

test('Root applies loaded/changed signed settings before rendering and changes the app key for cached children', () => {
  const file = '../app/src/app.tsx';
  const source = read(file).split('function Root()')[1].split('initRouter();')[0];
  let state = { settings: { ...DEFAULT_SETTINGS } };
  const Root = load(file, 'Root', `function Root()${source}`, {
    React,
    useStore: () => ({ state }),
    useState: (value: unknown) => [value, () => {}],
    useEffect() {},
    locale,
    preferredLocale: () => 'en',
    setSignedAmounts,
    App: 'App',
  });
  const first = Root();
  assert.equal(flow(-10, 'USD'), '−$10.00');
  state = { settings: { ...DEFAULT_SETTINGS, signedAmounts: false } };
  const disabled = Root();
  assert.notEqual(disabled.key, first.key);
  assert.equal(flow(-10, 'USD'), '$10.00');
  assert.equal(flow(10, 'USD'), '$10.00');
  state = { settings: { ...DEFAULT_SETTINGS, signedAmounts: true } };
  assert.equal(Root().key, first.key);
  assert.equal(flow(10, 'USD'), '+$10.00');
});

test('Detail charge rows and annual totals show expenses/refunds consistently, including after disabling signs', () => {
  const file = '../app/src/views/Detail.tsx';
  const source = read(file).split('function Charges(')[1];
  const Charges = load(file, 'Charges', `function Charges(${source}`, {
    React,
    Fragment: React.Fragment,
    useState: () => [true, () => {}],
    phaseSubs,
    chargeValue,
    flow,
    t: (key: string) => key,
    Panel: ({ children }: { children: React.ReactNode }) => React.createElement('section', null, children),
  });
  const sub = {
    id: 'fictional',
    name: 'Test',
    price: 20,
    currency: 'USD',
    start: '2025-01-01',
    cycle: { unit: 'month', every: 1 },
    status: 'active',
    tags: [],
    category: 'tools',
  };
  const state = { settings: DEFAULT_SETTINGS, fx: FALLBACK_FX, methods: [], subscriptions: [sub] };
  const history = [
    { sub, date: '2025-01-01', amount: 20, currency: 'USD' },
    { sub, date: '2026-01-01', amount: 10, currency: 'USD' },
    { sub, date: '2026-01-02', amount: -15, currency: 'USD', kind: 'refund' },
  ];
  for (const on of [true, false]) {
    setSignedAmounts(on);
    const html = renderToStaticMarkup(React.createElement(Charges, { sub, state, history, onRow() {} }));
    assert.ok(html.includes('dt-row '));
    assert.ok(html.includes('refund'));
    const content = text(html);
    assert.ok(content.includes(`${on ? '−' : ''}$20.00`));
    assert.ok(content.includes(`${on ? '+' : ''}$15.00`));
    assert.ok(content.includes(`${on ? '+' : ''}$5.00`));
    if (!on) assert.ok(!/[+−]/.test(content));
    assert.ok(html.includes('dt-in')); // Net-refund annual subtotal stays green with signs off.
  }
});
