import assert from 'node:assert/strict';
import { numberFormat } from './intl.ts';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { transformSync } from 'oxc-transform-react';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { currencyDecimals, moneyDecimals, flow, flowSign, setSignedAmounts, symbol, relDays, money, cnDateFull } from './format.ts';
import { intlLocale, locale, setLocale } from './i18n.ts';
import { chargeValue } from './fx.ts';
import { FALLBACK_FX, phaseSubs, diffDays } from './billing.ts';
import { DEFAULT_SETTINGS } from './types.ts';
import * as billing from './billing.ts';
import { colorFor } from './people.ts';
import { detailChargeHistory, detailForecast } from '../app/src/views/detail-data.ts';
import type { AppState, Subscription } from './types.ts';

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
  const Amount = load(file, 'Amount', `function Amount(${source}`, { React, moneyDecimals, flowSign, symbol, intlLocale, numberFormat });
  for (const on of [true, false]) {
    setSignedAmounts(on);
    const render = (value: number, plain = false) => renderToStaticMarkup(React.createElement(Amount, { value, ccy: 'CNY', plain }));
    assert.equal(text(render(-66.94)), `${on ? '−' : ''}¥66.94`);
    assert.equal(text(render(10)), `${on ? '+' : ''}¥10.00`);
    assert.ok(render(10).includes('color:var(--green)'));
    for (const value of [198.65, -198.65, 0]) {
      assert.match(render(value), /class="amt-fraction" style="color:inherit;opacity:0.72"/);
    }
    assert.ok(!render(198.65, true).includes('--green'));
    const whole = renderToStaticMarkup(React.createElement(Amount, { value: 198.65, ccy: 'CNY', decimals: 0 }));
    assert.equal(text(whole), `${on ? '+' : ''}¥199`);
    assert.ok(!whole.includes('amt-fraction'));
    assert.equal(text(render(0)), '¥0.00');
    assert.equal(text(render(-0)), '¥0.00');
    assert.equal(text(render(NaN)), '—');
    assert.equal(text(render(70.02, true)), '¥70.02');
    assert.equal(text(render(1000, true)), '¥1,000.00');
    assert.equal(text(render(-10, true)), '−¥10.00'); // A balance's mathematical sign is independent of cash flow notation.
    assert.ok(!render(1000, true).includes('--green'));
  }
});

test('Amount never renders fractional markup for zero-decimal currencies, including compact/explicit precision', () => {
  const file = '../app/src/components/ui.tsx';
  const source = read(file).split('export function Amount(')[1].split('/** 分段控件')[0];
  const Amount = load(file, 'Amount', `function Amount(${source}`, { React, moneyDecimals, flowSign, symbol, intlLocale, numberFormat });
  for (const ccy of ['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'HUF', 'TWD', 'PYG', 'MGA', 'BIF', 'USD', 'CNY', 'NGN', 'TRY']) {
    for (const value of [0, 19.8, -19.8, 1234567.89]) {
      for (const opts of [{}, { compact: true }, { decimals: 2 }, { plain: true }]) {
        const html = renderToStaticMarkup(React.createElement(Amount, { value, ccy, ...opts }));
        const expected = opts.plain ? money(value, ccy, opts) : flow(value, ccy, opts);
        assert.equal(text(html), expected.replace(symbol(ccy), symbol(ccy).trim()));
        if (currencyDecimals(ccy) === 0) assert.ok(!html.includes('amt-fraction'), `${ccy}: ${html}`);
      }
    }
  }
});

test('MoneyPair formats both original and converted currencies with the shared precision', () => {
  const file = '../app/src/components/ui.tsx';
  const source = read(file).split('export function Amount(')[1].split('/** 分段控件')[0];
  const Amount = load(file, 'Amount', `function Amount(${source}`, { React, moneyDecimals, flowSign, symbol, intlLocale, numberFormat });
  let orig = true;
  const useMoneyPair = load(
    'MoneyPair.tsx',
    'useMoneyPair',
    read('../app/src/components/MoneyPair.tsx').split('export function useMoneyPair')[1].replace(/^/, 'function useMoneyPair'),
    {
      React,
      Amount,
      flow,
      money,
      useOrig: () => orig,
      convert: () => 1234.56,
      toBaseAt: () => 1234.56,
    },
  );
  const state = { settings: { baseCurrency: 'JPY' } };
  for (const plain of [true, false]) {
    orig = true;
    let pair = useMoneyPair(state)(1470.07, 'TRY', { plain });
    assert.ok(text(renderToStaticMarkup(pair.main)).includes('₺1,470.07'));
    assert.ok(pair.alt.includes('JP¥1,235'));
    orig = false;
    pair = useMoneyPair(state)(1470.07, 'TRY', { plain });
    assert.ok(text(renderToStaticMarkup(pair.main)).includes('JP¥1,235'));
    assert.ok(!renderToStaticMarkup(pair.main).includes('amt-fraction'));
    assert.ok(pair.alt.includes('₺1,470.07'));
  }
});

test('currency-aware inputs reject fractional drafts with a translated hint without rounding stored values', () => {
  const file = '../app/src/components/ui.tsx';
  const source = read(file).split('export function acceptCurrencyInput(')[1].split('/** 保留字符串')[0];
  const hints: string[] = [];
  const accept = load(file, 'acceptCurrencyInput', `function acceptCurrencyInput(${source}`, {
    currencyDecimals,
    toNum: (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v)),
    notify: { error: (hint: string) => hints.push(hint) },
    t: (key: string, args: { currency: string }) => `${key}:${args.currency}`,
  });
  assert.equal(accept('19.8', 'JPY'), false);
  assert.equal(accept('-19.8', 'TWD'), false);
  assert.equal(accept('1e-1', 'HUF'), false);
  assert.equal(hints.length, 3);
  assert.equal(hints[0], 'ui.error.wholeCurrency:JPY');
  for (const text of ['', '-', '19.', '1900', '-19', '19.00']) assert.equal(accept(text, 'JPY'), true);
  assert.equal(accept('19.8', 'USD'), true);
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
    detailChargeHistory,
    chargeValue,
    diffDays,
    relDays,
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
    const html = renderToStaticMarkup(React.createElement(Charges, { sub, state, today: '2026-10-22', history, onRow() {} }));
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

test('Detail defaults to the current charge year, falls back to the latest populated year and toggles the full history', () => {
  const file = '../app/src/views/Detail.tsx';
  const source = read(file).split('function Charges(')[1];
  let all = false;
  const Charges = load(file, 'Charges', `function Charges(${source}`, {
    React,
    Fragment: React.Fragment,
    useState: () => [
      all,
      (value: boolean) => {
        all = value;
      },
    ],
    phaseSubs,
    detailChargeHistory,
    chargeValue,
    diffDays,
    relDays,
    flow,
    t: (key: string, args?: { count: number }) => `${key}:${args?.count ?? ''}`,
    Panel: ({ children, title }: { children: React.ReactNode; title: string }) => React.createElement('section', null, title, children),
  });
  const sub = {
    id: 'fictional-history',
    name: 'Fictional monthly',
    price: 12,
    currency: 'USD',
    start: '2020-01-15',
    cycle: { unit: 'month', every: 1 },
    status: 'active',
    tags: [],
    category: 'tools',
  };
  const state = { settings: DEFAULT_SETTINGS, fx: FALLBACK_FX, methods: [], subscriptions: [sub] };
  const history = Array.from({ length: 82 }, (_, i) => ({
    sub,
    date: `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-15`,
    amount: 12,
    currency: 'USD',
  }));
  const render = (rows = history, today = '2026-10-22') => renderToStaticMarkup(React.createElement(Charges, { sub, state, today, history: rows }));
  const count = (html: string) => (html.match(/class="dt-tr dt-row/g) ?? []).length;
  let html = render();
  assert.equal(count(html), 10);
  assert.ok(text(html).includes('detail.charges.title:82'));
  assert.ok(text(html).includes('2026'));
  assert.ok(!text(html).includes('2025'));
  assert.ok(html.includes('aria-expanded="false"'));
  // Exercise the actual disclosure handler, then render its resulting state.
  const findToggle = (node: React.ReactNode): React.ReactElement<{ onClick: () => void }> | undefined => {
    if (!React.isValidElement(node)) return;
    const props = node.props as { children?: React.ReactNode; 'aria-expanded'?: boolean };
    if (props['aria-expanded'] !== undefined) return node as React.ReactElement<{ onClick: () => void }>;
    for (const child of React.Children.toArray(props.children)) {
      const found = findToggle(child);
      if (found) return found;
    }
  };
  const toggle = () => findToggle(Charges({ sub, state, today: '2026-10-22', history }))!.props.onClick();
  toggle();
  html = render();
  assert.equal(count(html), 82);
  assert.ok(text(html).includes('2020'));
  assert.ok(html.includes('aria-expanded="true"'));
  toggle();
  assert.equal(count(render()), 10);
  const old = history.filter((c) => c.date < '2025');
  html = render(old);
  assert.equal(count(html), 12);
  assert.ok(text(html).includes('2024'));
  assert.ok(!text(html).includes('2023'));
  // A single year is complete even with more than 24 entries; no disclosure.
  const daily = Array.from({ length: 30 }, (_, i) => ({ ...history[0], date: `2024-06-${String(i + 1).padStart(2, '0')}` }));
  html = render(daily);
  assert.equal(count(html), 30);
  assert.ok(!html.includes('aria-expanded'));
  assert.ok(text(html).includes('2024-06-30'));
  assert.equal(count(render([])), 0);
  assert.ok(!render([]).includes('aria-expanded'));
});

test('shared-plan avatars retain owner images, initials, dues colors and overflow in both sizes', async () => {
  const { memberAboard, memberDues } = await import('./billing.ts');
  const file = '../app/src/components/ShareAvatars.tsx';
  const source = read(file).split('export function ShareAvatars(')[1];
  const PersonAvatar = load(
    '../app/src/components/PersonAvatar.tsx',
    'PersonAvatar',
    read('../app/src/components/PersonAvatar.tsx').split('/** Shared private-person')[1].split('*/')[1],
    { React, useState: React.useState, colorFor },
  );
  const ShareAvatars = load(file, 'ShareAvatars', `function ShareAvatars(${source}`, {
    React,
    memberAboard,
    memberDues,
    PersonAvatar,
    personFor: (state: AppState, id: string, name: string) => state.people?.find((p) => p.id === id) ?? { id, name },
    base: (path: string) => path,
    t: (key: string) => key,
  });
  const sub = {
    id: 'fictional-sharing',
    name: 'Fictional sharing',
    price: 12,
    currency: 'USD',
    start: '2026-01-01',
    cycle: { unit: 'month', every: 1 },
    status: 'active',
    tags: [],
    category: 'tools',
    share: {
      role: 'owner',
      seats: 12,
      since: '2026-01-01',
      members: Array.from({ length: 9 }, (_, i) => ({
        id: `member-${i}`,
        name: i === 0 ? '' : `Name ${i}`,
        share: 1,
        exempt: i === 2,
        paidUntil: i === 1 ? '2027-12-31' : undefined,
        left: i === 8 ? '2026-02-01' : undefined,
      })),
    },
  };
  const state = { settings: { ...DEFAULT_SETTINGS, avatar: 'https://example.invalid/fictional.png' }, fx: FALLBACK_FX, methods: [], subscriptions: [sub] };
  const render = (size: number, overlap: number, onMember?: () => void) =>
    renderToStaticMarkup(React.createElement(ShareAvatars, { sub, state, today: '2026-10-22', size, overlap, onMember }));
  const card = render(20, 3, () => {});
  const detail = render(36, 2);
  assert.equal(text(card), text(detail));
  assert.ok(text(card).endsWith('+4'));
  assert.ok(text(card).includes('?'));
  assert.ok(card.includes('seat on'));
  assert.ok(card.includes('seat owe'));
  assert.ok(card.includes('seat free'));
  assert.ok(card.includes('fictional.png'));
  assert.ok(!card.includes('Name 8'));
  assert.ok(card.includes('<button'));
  assert.ok(!detail.includes('<button'));
  state.settings.avatar = '';
  assert.ok(render(36, 2).includes('/icons/avatar.png'));
  const avatar = 'data:image/png;base64,iVBORw0KGgo=';
  const linked = { ...sub, share: { ...sub.share, members: sub.share.members.map((m, i) => (i === 1 ? { ...m, personId: 'person' } : m)) } };
  const linkedState = { ...state, people: [{ id: 'person', name: 'Linked person', avatar }] };
  const linkedHtml = renderToStaticMarkup(React.createElement(ShareAvatars, { sub: linked, state: linkedState, today: '2026-10-22' }));
  assert.ok(linkedHtml.includes(avatar));
  linkedState.people[0].avatar = 'https://tracking.invalid/avatar.png';
  const remoteHtml = renderToStaticMarkup(React.createElement(ShareAvatars, { sub: linked, state: linkedState, today: '2026-10-22' }));
  assert.ok(!remoteHtml.includes('tracking.invalid'));
});

test('Detail keeps renewal context and places only short default histories in the sidebar', () => {
  const file = '../app/src/views/Detail.tsx';
  const source = read(file);
  const empty = () => null;
  const Panel = ({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) =>
    React.createElement('section', { className }, title, children);
  const deps = {
    React,
    Fragment: React.Fragment,
    ...billing,
    detailForecast,
    detailChargeHistory,
    money,
    cnDateFull,
    relDays,
    flow,
    chargeValue,
    t: (key: string) => key,
    useState: (initial: unknown) => [initial, empty],
    useRef: () => ({ current: null }),
    useMoneyPair: () => (amount: number, currency: string) => ({ main: money(amount, currency), alt: '≈ ¥766.18' }),
    TONE: {},
    methodOf: empty,
    presetCat: () => 'phone',
    Panel,
    Prop: ({ k, children, hint }: { k: string; children: React.ReactNode; hint?: string }) => React.createElement('div', null, k, children, hint),
    Act: empty,
    CopyImageButton: empty,
    Sheet: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    IconButton: empty,
    regular: (h: { kind?: string; amount: number }[]) => h.filter((c) => !c.kind && c.amount > 0),
    SubIcon: empty,
    CatTag: empty,
    Region: empty,
    X: empty,
    Pencil: empty,
    Pause: empty,
    Play: empty,
    Plus: empty,
    Share: empty,
    Kpis: empty,
    Trendline: empty,
    Charges: empty,
    Outcome: empty,
    Details: empty,
    Events: empty,
    PayBadge: empty,
    RegionTag: empty,
    subRegion: (s: { region?: string }) => s.region,
  };
  const Upcoming = load(file, 'Upcoming', `function Upcoming(${source.split('function Upcoming(')[1].split('type Unit =')[0]}`, deps);
  const Details = load(file, 'Details', `function Details(${source.split('function Details(')[1].split('/** 扣款记录')[0]}`, deps);
  const Charges = load(file, 'Charges', `function Charges(${source.split('function Charges(')[1]}`, deps);
  const Detail = load(file, 'Detail', `function Detail(${source.split('export function Detail(')[1].split('/** 正常扣款')[0]}`, {
    ...deps,
    Upcoming,
    Details,
    Charges,
  });
  for (const [unit, end] of [['year'], ['month'], ['lifetime'], ['month', '2026-07-01']] as const) {
    const sub: Subscription = {
      id: 'fictional-renewal',
      name: 'Fictional plan',
      price: 99,
      currency: 'EUR',
      cycle: { unit, every: 1 },
      start: '2025-12-15',
      end,
      status: 'active',
      category: 'tools',
      tags: [],
    };
    const state: AppState = { settings: DEFAULT_SETTINGS, fx: FALLBACK_FX, methods: [], subscriptions: [sub] };
    const props = { sub, state, today: '2026-10-22', onEdit: empty, onClose: empty, onCar: empty };
    const html = renderToStaticMarkup(React.createElement(Detail, props));
    const header = html.split('class="dt-meta"')[1].split('</header>')[0];
    assert.ok(text(header).includes('€99.00'));
    assert.ok(text(header).includes('≈ ¥766.18'));
    const summary = text(renderToStaticMarkup(React.createElement(Details, props)));
    if (unit === 'lifetime' || end) {
      assert.ok(!summary.includes('detail.ev.next'));
    } else {
      const next = detailForecast(sub, props.today).charges[0].date;
      assert.ok(summary.includes('detail.ev.next'));
      assert.ok(summary.includes(cnDateFull(next)));
      assert.ok(summary.includes(relDays(diffDays(props.today, next))));
      assert.ok(!summary.includes('€99.00'));
    }
    assert.equal(html.includes('dt-upcoming'), unit === 'month' && !end);
    assert.ok(!html.includes('dt-renewal'));
    assert.equal((html.match(/class="dt-charges"/g) ?? []).length, 1);
    const [main, side] = html.split('class="dt-side');
    // 只扣过一笔的年付和买断一样内容少，改用窄单列，扣款记录留在主栏
    const inSidebar = false;
    assert.equal(main.includes('class="dt-charges"'), !inSidebar);
    assert.equal(side.includes('class="dt-charges"'), inSidebar);
    if (inSidebar) assert.ok(side.indexOf('detail.summary') < side.indexOf('class="dt-charges"'));
    assert.equal(html.includes('dt compact'), unit === 'lifetime' || unit === 'year');
  }
  // Fictional annual plans: ordinary renewals plus commissions recorded as negative charges.
  const annual: Subscription = {
    id: 'fictional-annual-commissions',
    name: 'Fictional annual with credits',
    price: 120,
    currency: 'EUR',
    cycle: { unit: 'year', every: 1 },
    start: '2020-01-15',
    status: 'active',
    category: 'tools',
    tags: [],
  };
  for (const [count, start, today, inSidebar] of [
    [3, '2020-01-15', '2026-10-22', true], // Four charges + year heading = five rows.
    [4, '2020-01-15', '2026-10-22', false], // Five charges + year heading = six rows.
    [8, '2020-01-15', '2026-10-22', false], // Reported case: nine charges, mostly commissions.
    [4, '2026-01-15', '2026-10-22', false], // Only one renewal: no trend line, compact single column keeps charges in the main flow.
    [5, '2026-01-15', '2026-10-22', false],
    [3, '2020-01-15', '2027-01-01', true], // Latest populated year is the default after ending.
    [4, '2020-01-15', '2027-01-01', false],
  ] as const) {
    const sub: Subscription = {
      ...annual,
      start,
      end: '2026-12-31',
      payments: [
        ...Array.from({ length: 2027 - Number(start.slice(0, 4)) }, (_, i) => ({ date: `${Number(start.slice(0, 4)) + i}-01-15`, amount: 120 })),
        ...Array.from({ length: count }, (_, i) => ({ date: `2026-${String(i + 2).padStart(2, '0')}-02`, amount: -5 })),
      ],
    };
    const state: AppState = { settings: DEFAULT_SETTINGS, fx: FALLBACK_FX, methods: [], subscriptions: [sub] };
    const html = renderToStaticMarkup(React.createElement(Detail, { sub, state, today, onEdit: empty, onClose: empty }));
    const [main, side] = html.split('class="dt-side');
    assert.equal(main.includes('class="dt-charges"'), !inSidebar, `${count} credits from ${start} at ${today}`);
    assert.equal(side.includes('class="dt-charges"'), inSidebar);
    assert.equal((html.match(/class="dt-tr dt-row/g) ?? []).length, count + 1);
    assert.ok(text(html).includes('+$5.00') || text(html).includes('+€5.00'));
    assert.equal(html.includes('dt-upcoming'), false);
  }
});
