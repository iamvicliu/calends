import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'oxc-transform-react';
import * as billing from './billing.ts';
import * as format from './format.ts';
import * as fx from './fx.ts';
import * as reports from './scope-report.ts';
import * as metrics from './metrics.ts';
import * as carpool from './carpool.ts';
import { DEFAULT_SETTINGS, type AppState, type Subscription } from './types.ts';

// Execute component event handlers in the existing JSX harness, retaining pure financial builders.
type Node = { type: string; props: Record<string, any>; children: unknown[] };
const all = (n: unknown): Node[] =>
  Array.isArray(n) ? n.flatMap(all) : n && typeof n === 'object' && 'type' in n ? [n as Node, ...all((n as Node).children)] : [];
const st: AppState = { subscriptions: [], methods: [], settings: DEFAULT_SETTINGS, fx: billing.FALLBACK_FX };
const today = '2026-10-22';
function harness(file: string, names: string, prefs: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replace(/^export \{.*\};\n/gm, '');
  const result = transformSync(file, source, { lang: 'tsx', jsx: { runtime: 'classic' }, reactCompiler: false });
  assert.equal(result.fatal, false);
  const values: unknown[] = [];
  let cursor = 0;
  const keys: Record<string, (e: any) => void> = {};
  const deps = {
    React: { Fragment: 'Fragment', createElement: (type: string, props: Node['props'], ...children: unknown[]) => ({ type, props: props ?? {}, children }) },
    ...billing,
    ...format,
    ...fx,
    ...reports,
    ...metrics,
    locale: () => 'en',
    useOrig: () => false,
    categories: () => [],
    Picker: 'Picker',
    t: (key: string) => key,
    useMemo: (fn: () => unknown) => fn(),
    useEffect: (fn: () => unknown) => fn(),
    useState(initial: unknown) {
      const i = cursor++;
      if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
      return [
        values[i],
        (next: unknown) => {
          values[i] = typeof next === 'function' ? next(values[i]) : next;
        },
      ];
    },
    usePref: (key: string, fallback: string) => [
      prefs[key] ?? fallback,
      (v: string) => {
        prefs[key] = v;
      },
    ],
    useMoneyPair: () => () => ({ main: '' }),
    useWidth: () => [null, 700],
    allCharges: () => [],
    sumBase: () => 0,
    document: {
      addEventListener: (name: string, fn: (e: any) => void) => {
        keys[name] = fn;
      },
      removeEventListener() {},
      querySelector: () => null,
    },
    Cell: 'Cell',
    Group: 'Group',
    Icon: 'Icon',
    Hint: 'Hint',
    PayBadge: 'PayBadge',
    Seg: 'Seg',
    SubIcon: 'SubIcon',
    CatIcon: 'CatIcon',
    MethodMark: 'MethodMark',
    catColor: (cat: string) => `color-${cat}`,
    Toolbar: 'Toolbar',
    ScopeReport: 'ScopeReport',
    useCallback: (fn: unknown) => fn,
    Fragment: 'Fragment',
    Timeline: 'Timeline',
    Amount: 'Amount',
    Maximize2: 'Maximize2',
    ChevronUp: 'ChevronUp',
    SpendingDelta: 'SpendingDelta',
    ...extra,
  };
  const exports = new Function(...Object.keys(deps), `${result.code.replace(/export /g, '')}; return {${names}};`)(...Object.values(deps));
  return {
    prefs,
    keys,
    call: (name: string, ...args: unknown[]) => exports[name](...args),
    render: (name: string, props: unknown) => {
      cursor = 0;
      return all(exports[name](props));
    },
  };
}

test('calendar selects today, toggles off, clears on month navigation, and Today/T restore it', () => {
  const r = harness('../app/src/views/Calendar.tsx', 'Calendar');
  const render = () => r.render('Calendar', { state: st, today, onOpen() {}, onIcs() {} });
  let nodes = render();
  assert.equal(nodes.find((n) => n.props['aria-current'] === 'date')!.props['aria-pressed'], true);
  nodes.find((n) => n.props['aria-current'] === 'date')!.props.onClick();
  nodes = render();
  assert.equal(
    nodes.some((n) => n.props['aria-pressed']),
    false,
  );
  assert.ok(nodes.some((n) => n.children.includes('calendar.pickDay')));
  nodes.find((n) => n.props['aria-label'] === 'calendar.next')!.props.onClick();
  nodes = render();
  assert.equal(
    nodes.some((n) => n.props['aria-pressed']),
    false,
  );
  assert.equal(
    nodes.some((n) => n.type === 'ScopeReport'),
    false,
  );
  nodes.find((n) => n.type === 'button' && n.children.includes('calendar.today'))!.props.onClick();
  nodes = render();
  assert.equal(nodes.find((n) => n.props['aria-current'] === 'date')!.props['aria-pressed'], true);
  r.keys.keydown({ target: { tagName: 'BODY' }, key: 'ArrowRight', preventDefault() {} });
  assert.equal(
    render().some((n) => n.props['aria-pressed']),
    false,
  );
  r.keys.keydown({ target: { tagName: 'BODY' }, key: 't' });
  assert.equal(render().find((n) => n.props['aria-current'] === 'date')!.props['aria-pressed'], true);
});

test('calendar full report collapses locally to its title line, reopens, resets on month navigation, and stays absent in year view', () => {
  const r = harness('../app/src/views/Calendar.tsx', 'Calendar', { 'cal-report-mode': 'full' });
  const render = () => r.render('Calendar', { state: st, today, onOpen() {}, onIcs() {} });
  let nodes = render();
  const full = nodes.find((n) => n.type === 'ScopeReport')!;
  assert.ok(full);
  assert.equal(
    nodes.some((n) => typeof n.type === 'function' && n.type.name === 'MiniReport'),
    false,
  );
  full.props.onToggle();
  nodes = render();
  assert.equal(r.prefs['cal-report-mode'], 'full');
  assert.equal(nodes.find((n) => n.type === 'ScopeReport')!.props.open, false);
  assert.equal(
    nodes.some((n) => typeof n.type === 'function' && n.type.name === 'MiniReport'),
    false,
  );
  nodes.find((n) => n.type === 'ScopeReport')!.props.onToggle();
  assert.equal(render().find((n) => n.type === 'ScopeReport')!.props.open, true);
  render()
    .find((n) => n.type === 'ScopeReport')!
    .props.onToggle();
  render()
    .find((n) => n.props['aria-label'] === 'calendar.next')!
    .props.onClick();
  assert.equal(render().find((n) => n.type === 'ScopeReport')!.props.open, true);
  r.prefs['cal-mode'] = 'year';
  nodes = render();
  assert.equal(
    nodes.some((n) => n.type === 'ScopeReport' || (typeof n.type === 'function' && n.type.name === 'MiniReport')),
    false,
  );
});

test('list report restores matching preferences without animation and requires generation for a different scope', () => {
  const r = harness('../app/src/views/List.tsx', 'ListReport', { 'list-report': JSON.stringify({ key: 'AI', open: false }) });
  const props = { reportKey: 'AI', state: st, rows: [], today, onOpen() {}, title: 'AI' };
  let nodes = r.render('ListReport', props);
  assert.equal(nodes.find((n) => n.type === 'ScopeReport')!.props.open, false);
  assert.equal(nodes.find((n) => n.type === 'ScopeReport')!.props.animate, false);
  nodes = r.render('ListReport', { ...props, reportKey: 'VPS' });
  assert.equal(
    nodes.some((n) => n.type === 'ScopeReport'),
    false,
  );
  nodes.find((n) => n.type === 'button')!.props.onClick();
  nodes = r.render('ListReport', { ...props, reportKey: 'VPS' });
  assert.equal(nodes.find((n) => n.type === 'ScopeReport')!.props.open, true);
  assert.equal(JSON.parse(r.prefs['list-report']).key, 'VPS');
});

test('overview upcoming excludes today, refunds and failed charges; timeline owns the past including today', () => {
  const sub = (id: string, start: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    start,
    price: 10,
    currency: 'USD',
    category: 'Tools',
    tags: [],
    cycle: { unit: 'month' as const, every: 1 },
    status: 'active' as const,
    ...extra,
  });
  const state = {
    ...st,
    subscriptions: [
      sub('today', today),
      sub('future', '2026-10-25'),
      sub('refund', '2026-01-01', { cycle: { unit: 'lifetime', every: 1 }, payments: [{ date: '2026-10-24', amount: -10, kind: 'refund' }] }),
      sub('failed', '2026-01-01', { cycle: { unit: 'lifetime', every: 1 }, payments: [{ date: '2026-10-24', amount: 10, kind: 'failed' }] }),
    ],
  };
  const calls: string[][] = [];
  const r = harness(
    '../app/src/views/Overview.tsx',
    'DueSoon, ChargeTimeline',
    {},
    {
      allCharges: (s: AppState, from: string, to: string, at: string) => {
        calls.push([from, to]);
        return s.subscriptions.flatMap((sub) => billing.chargesBetween(sub, from, to, at));
      },
      sumBase: (s: AppState, charges: billing.Charge[]) => charges.reduce((n, c) => n + fx.chargeValue(s, c), 0),
    },
  );
  const nodes = r.render('DueSoon', { state, today, onOpen() {} });
  const rows = nodes.filter((n) => n.props.className === 'due-row');
  assert.equal(rows.length, 1);
  assert.equal(
    all(rows[0]).some((n) => n.children.includes('future')),
    true,
  );
  assert.deepEqual(calls[0], ['2026-10-23', '2026-11-21']);
  r.render('ChargeTimeline', { state, today, onOpen() {} });
  assert.deepEqual(calls.at(-1), ['2026-09-23', today]);
  const publicView = harness(
    '../app/src/public/page.tsx',
    'derive',
    {},
    {
      syncCategories: () => [],
      periodRange: () => ['2026-10-01', '2026-10-31'],
      allCharges: (s: AppState, from: string, to: string, at: string) => s.subscriptions.flatMap((sub) => billing.chargesBetween(sub, from, to, at)),
      sumBase: (s: AppState, rows: billing.Charge[]) => rows.reduce((n, c) => n + fx.chargeValue(s, c), 0),
    },
  );
  const derived = publicView.call('derive', state, today);
  assert.deepEqual(
    derived.upcoming.map((c: billing.Charge) => c.sub.id),
    ['future'],
  );
});

test('report changes use unsigned spending direction and omit the current total already owned by the hero', () => {
  const r = harness(
    '../app/src/views/Report.tsx',
    'Waterfall',
    {},
    {
      movement: () => ({ from: 100, to: 80, fx: 0, added: 0, expansion: 0, contraction: 0, churned: 20, items: [] }),
    },
  );
  const nodes = r.render('Waterfall', { state: st, today, onOpen() {} });
  const delta = nodes.find((n) => n.type === 'SpendingDelta')!;
  assert.deepEqual(delta.props.value, { amount: -20, percent: -0.2 });
  assert.equal(
    nodes.some((n) => n.children.includes('−$80.00')),
    false,
  );
  assert.equal(
    nodes.some((n) => n.props.className === 'mv-row down'),
    false,
    'a single driver must not repeat the overall delta',
  );
  const mixed = harness(
    '../app/src/views/Report.tsx',
    'Waterfall',
    {},
    {
      movement: () => ({ from: 100, to: 110, fx: 0, added: 30, expansion: 0, contraction: 0, churned: 20, items: [] }),
    },
  );
  const mixedNodes = mixed.render('Waterfall', { state: st, today, onOpen() {} });
  const driver = mixedNodes.find((n) => n.props.className === 'mv-row down')!;
  assert.equal(
    all(driver).some((n) => n.children.includes('↓')),
    true,
  );
  assert.equal(
    all(driver).some((n) => n.children.includes('+')),
    false,
  );
});

test('scope presentation gives single refunds/receipts one numeric owner and avoids repeated upcoming/top charge rows', () => {
  const r = harness(
    '../app/src/components/ScopeReport.tsx',
    'ScopeReport',
    {},
    {
      useId: () => 'scope',
      useRef: () => ({ current: null }),
      intlLocale: () => 'en-US',
      BarLine: 'BarLine',
      Copy: 'Copy',
    },
  );
  const subscription = {
    id: 'service',
    name: 'Service',
    category: 'Tools',
    tags: [],
    price: 120,
    currency: 'USD',
    cycle: { unit: 'year' as const, every: 1 },
    start: '2026-01-01',
    status: 'cancelled' as const,
    end: '2026-10-12',
    stop: { kind: 'cancel' as const, date: '2026-10-12', paidThrough: '2026-12-31' },
    payments: [
      { date: '2026-01-01', amount: 120 },
      { date: '2026-10-22', amount: -10, kind: 'refund' as const },
    ],
  };
  const state = { ...st, subscriptions: [subscription] };
  const render = (report: reports.ScopeReport) =>
    r.render('ScopeReport', { report, state, today, onOpen() {}, title: 'Scope', animate: false, open: true, onToggle() {} });
  let nodes = render(reports.monthReport(state, '2026-10', today));
  const loss = nodes.find((n) => String(n.props.className).includes('scope-block scope-losses'))!;
  assert.equal(all(loss).filter((n) => n.children.includes('+$10.00')).length, 1);
  const mv = {
    from: 100,
    to: 80,
    fx: 0,
    added: 0,
    expansion: 0,
    contraction: 0,
    churned: 20,
    items: [{ sub: subscription, kind: 'churned' as const, delta: -20, from: 20, to: 0 }],
  };
  const trendNodes = render({ blocks: [{ type: 'trend', mode: 'month', month: '2026-10', movement: mv }] });
  assert.equal(
    trendNodes.some((n) => typeof n.type === 'function' && n.type.name === 'SpendingDelta'),
    false,
    'one driver owns the total, without repeating it in summary or single-item rows',
  );
  const root = subscription;
  nodes = render({ blocks: [{ type: 'sharing', rows: [{ sub: root, received: 10, owed: 0 }], received: 10, owed: 0 }] });
  assert.equal(
    nodes.some((n) => n.props.className === 'hero-facts scope-facts'),
    false,
  );
  const upcoming = {
    ...subscription,
    id: 'next',
    status: 'active' as const,
    stop: undefined,
    end: undefined,
    start: '2026-10-25',
    cycle: { unit: 'month' as const, every: 1 },
    payments: undefined,
  };
  nodes = render(reports.monthReport({ ...st, subscriptions: [upcoming] }, '2026-10', today));
  assert.equal(
    nodes.some((n) => String(n.props.className).includes('scope-block scope-top')),
    true,
  );
  assert.equal(
    nodes.some((n) => String(n.props.className).includes('scope-block scope-upcoming')),
    false,
  );
});

test('member with a receipt and no paid-through date never claims no receipts and omits a duplicate singleton total', () => {
  const member = {
    id: 'member',
    name: 'Member',
    share: 10,
    fee: 10,
    feeCurrency: 'USD',
    payments: [{ date: today, amount: 10, currency: 'USD', until: '2026-10-31' }],
  };
  const sub = {
    id: 'owner',
    name: 'Owner',
    category: 'Tools',
    tags: [],
    price: 30,
    currency: 'USD',
    start: '2026-01-01',
    cycle: { unit: 'month' as const, every: 1 },
    status: 'active' as const,
    share: { role: 'owner' as const, seats: 3, members: [member] },
  };
  const r = harness(
    '../app/src/views/Members.tsx',
    'MemberSheet',
    {},
    { ...carpool, Sheet: 'Sheet', DatePicker: 'DatePicker', Toggle: 'Toggle', CurrencySelect: 'CurrencySelect', NumInput: 'NumInput', Picker: 'Picker' },
  );
  const nodes = r.render('MemberSheet', { state: { ...st, subscriptions: [sub] }, s: sub, member, onClose() {} });
  const date = nodes.find((n) => n.type === 'DatePicker' && n.props.placeholder === 'family.member.notSet');
  assert.ok(date);
  assert.equal(date.props.value, undefined, 'display correction does not invent a paid-through date');
  const receipts = nodes.find((n) => n.type === 'Group' && String(n.props.title).startsWith('family.member.payments'))!;
  assert.equal(receipts.props.foot, undefined);
  assert.equal(
    nodes.some((n) => n.type === 'DatePicker' && n.props.placeholder === 'family.member.paidUntilPh'),
    false,
  );
});

test('public rows keep the amount once for an ordinary monthly plan and distinguish trials and sharing', () => {
  const r = harness(
    '../app/src/public/page.tsx',
    'Row',
    {},
    {
      AppIcon: 'AppIcon',
      Badge: 'Badge',
      cn: (...s: string[]) => s.filter(Boolean).join(' '),
      t: (key: string, params?: { date?: string }) => (params?.date ? `${key} ${params.date}` : key),
    },
  );
  const s = {
    id: 'service',
    name: 'Service',
    category: 'Tools',
    tags: [],
    price: 10,
    currency: 'USD',
    start: '2026-01-01',
    cycle: { unit: 'month' as const, every: 1 },
    status: 'active' as const,
  };
  const render = (sub: Subscription, v: number) => r.render('Row', { s: sub, v, today, ccy: 'USD', k: 1, fmt: (n: number) => format.money(n, 'USD') });
  let nodes = render(s, 10);
  const todayNodes = render({ ...s, start: today }, 10);
  assert.ok(
    todayNodes.some((n) => n.children.includes(`public.row.renews ${format.cnDate('2026-11-22')}`)),
    'next charge starts after the already-charged day',
  );
  assert.equal(nodes.filter((n) => n.children.includes('$10.00')).length, 1);
  assert.equal(
    nodes.some((n) => n.children.includes(' $10.00')),
    false,
  );
  nodes = render({ ...s, status: 'trial', trialEnd: '2026-11-01' }, 0);
  assert.equal(
    nodes.some((n) => n.children.includes('list.status.trial')),
    true,
  );
  assert.equal(
    nodes.some((n) => n.children.includes(' $10.00')),
    true,
    'future list price remains separate from zero trial MRR',
  );
  for (const stopped of [
    { ...s, end: '2026-11-01', status: 'cancelled' as const },
    { ...s, status: 'terminated' as const, stop: { kind: 'terminate' as const, date: today, paidThrough: '2026-11-01' } },
  ]) {
    const ended = render(stopped, 0);
    assert.ok(ended.some((n) => n.children.some((child) => String(child).startsWith('public.row.ends'))));
    assert.ok(!ended.some((n) => n.children.some((child) => String(child).startsWith('public.row.renews'))));
  }
  nodes = render(s, 6);
  assert.equal(
    nodes.some((n) => n.children.includes(' $10.00')),
    true,
    'full plan price remains when my share differs',
  );
  assert.equal(
    nodes.some((n) => n.children.includes('$6.00')),
    true,
  );
});

test('a single charge owns its amount instead of repeating an identical cumulative-spend KPI', () => {
  const r = harness('../app/src/views/Detail.tsx', 'Kpis', {}, { toBase: (s: AppState, n: number, ccy: string) => fx.toBaseAt(s, n, ccy) });
  const sub = {
    id: 'service',
    name: 'Service',
    category: 'Tools',
    tags: [],
    price: 120,
    currency: 'USD',
    start: '2026-01-01',
    cycle: { unit: 'year' as const, every: 1 },
    status: 'active' as const,
  };
  const history = billing.chargesBetween(sub, sub.start, today, today);
  assert.equal(history.length, 1);
  const nodes = r.render('Kpis', { sub, state: { ...st, subscriptions: [sub] }, today, history });
  assert.equal(
    nodes.some((n) => n.children.includes('detail.stats.spent')),
    false,
  );
  assert.equal(nodes.filter((n) => n.props.className === 'dt-panel dt-kpi').length, 2);
});

test('same-currency cash pairs retain a distinct actual settlement and never hide fees behind the list price', () => {
  for (const orig of [false, true]) {
    const r = harness('../app/src/components/MoneyPair.tsx', 'useMoneyPair', {}, { useOrig: () => orig });
    const pair = r.call('useMoneyPair', st);
    const same = pair(-12, 'USD', { value: -12 });
    assert.equal(same.alt, undefined);
    const actual = pair(-12, 'USD', { value: -14 });
    assert.equal(actual.main.props.value, orig ? -12 : -14);
    assert.equal(actual.alt, orig ? '≈ −$14' : '−$12.00');
    const unknown = pair(-12, 'USD', { value: NaN });
    assert.equal(orig ? unknown.alt : format.flow(unknown.main.props.value, 'USD'), orig ? '≈ —' : '—');
  }
});

test('订阅筛选默认全部时无清空按钮，任一条件变化后清空恢复当前路由默认值', () => {
  for (const category of [undefined, 'Tools']) {
    for (const field of ['status', 'category', 'pay', 'search']) {
      const r = harness('../app/src/views/List.tsx', 'List');
      const render = () => r.render('List', { state: st, today, category, onOpen() {}, onAdd() {} });
      const clear = (nodes: Node[]) => nodes.find((n) => n.props.className === 'facet-clear');
      let nodes = render();
      assert.equal(clear(nodes), undefined, '默认全部不显示清空');
      if (field === 'search') nodes.find((n) => n.type === 'input')!.props.onChange({ target: { value: 'sample' } });
      else nodes.find((n) => n.props.label === `list.facet.${field}`)!.props.onChange(field === 'status' ? 'live' : field === 'category' ? 'Other' : 'none');
      nodes = render();
      assert.ok(clear(nodes), `${category ?? 'all'} ${field} 显示清空`);
      clear(nodes)!.props.onClick();
      nodes = render();
      assert.equal(clear(nodes), undefined);
      assert.equal(nodes.find((n) => n.props.label === 'list.facet.status')!.props.value, 'all');
      assert.equal(nodes.find((n) => n.props.label === 'list.facet.category')!.props.value, category ?? 'all');
      assert.equal(nodes.find((n) => n.props.label === 'list.facet.pay')!.props.value, 'all');
      assert.equal(nodes.find((n) => n.type === 'input')!.props.value, '');
    }
  }
});

test('calendar monthly list owns its heading inside the card in mini and full modes', () => {
  for (const mode of ['mini', 'full']) {
    const r = harness('../app/src/views/Calendar.tsx', 'Calendar', { 'cal-report-mode': mode });
    const nodes = r.render('Calendar', { state: st, today, onOpen() {}, onIcs() {} });
    const card = nodes.find((n) => n.props.className === 'card cal-charges')!;
    assert.ok(card);
    assert.ok(all(card).some((n) => n.type === 'h3' && n.children.includes('calendar.monthAll')));
    assert.equal(
      all(card).some((n) => n.type === 'Group'),
      false,
    );
    assert.equal(
      all(card).some((n) => n.props.className === 'cal-stat-big'),
      false,
    );
  }
});

test('scope subscription rows show exportable 24px icons and open details from every block', () => {
  const opened: Subscription[] = [];
  const r = harness(
    '../app/src/components/ScopeReport.tsx',
    'ScopeReport',
    {},
    {
      useId: () => 'scope',
      useRef: () => ({ current: null }),
      intlLocale: () => 'en-US',
      BarLine: 'BarLine',
      t: (key: string, params?: { count?: number }) => (params?.count == null ? key : `${key} ${params.count}`),
    },
  );
  const sub: Subscription = {
    id: 's',
    name: 'Sample',
    category: 'Tools',
    price: 10,
    currency: 'USD',
    cycle: { unit: 'month', every: 1 },
    start: '2026-01-01',
    status: 'active',
    tags: [],
  };
  const charge = { sub, date: today, amount: 10, original: billing.chargesBetween(sub, today.slice(0, 8) + '01', today, today)[0] };
  const stopped: Subscription = { ...sub, status: 'cancelled', end: today, stop: { kind: 'cancel', date: today, paidThrough: '2026-10-31' } };
  const loss = metrics.stopLosses({ ...st, subscriptions: [stopped] }, today).items[0];
  const blocks: reports.Block[] = [
    { type: 'top', mode: 'scope', rows: [charge, { ...charge, sub: { ...sub, id: 's2' } }] },
    { type: 'upcoming', rows: [charge], total: 10 },
    { type: 'events', rows: [{ ...charge, kind: 'start', delta: 10 }] },
    {
      type: 'losses',
      rows: [loss],
      loss: 10,
      incomplete: false,
      refunds: [charge],
      refunded: -10,
    },
    { type: 'sharing', rows: [{ sub, received: 10, owed: 2 }], received: 10, owed: 2 },
    {
      type: 'trend',
      mode: 'month',
      month: '2026-10',
      movement: { from: 0, to: 10, fx: 0, added: 10, expansion: 0, contraction: 0, churned: 0, items: [{ sub, kind: 'added', delta: 10 }] },
    },
  ];
  const nodes = r.render('ScopeReport', {
    report: { blocks },
    state: st,
    today,
    onOpen: (sub: Subscription) => opened.push(sub),
    title: 'Scope',
    open: true,
    animate: false,
    onToggle() {},
  });
  const rows = nodes.filter((n) => n.props.className === 'scope-row scope-tap');
  assert.equal(rows.length, 8);
  for (const row of rows) {
    assert.equal(row.type, 'button');
    const icon = all(row).find((n) => n.type === 'SubIcon')!;
    assert.equal(icon.props.size, 24);
    assert.equal(icon.props.proxied, true);
    row.props.onClick();
    assert.equal(opened.at(-1), icon.props.sub);
    assert.equal(all(row).filter((n) => n.type === 'button').length, 1);
  }
  assert.ok(nodes.some((n) => n.type === 'h3' && n.children.includes('scope.topMonthly 2')));
});

test('scope composition uses category colors for both marks and bars and exports method images through the proxy', () => {
  const r = harness(
    '../app/src/components/ScopeReport.tsx',
    'ScopeReport',
    {},
    { useId: () => 'scope', useRef: () => ({ current: null }), intlLocale: () => 'en-US' },
  );
  const method = { id: 'm', name: 'Sample card', kind: 'card', currency: 'USD', logo: 'https://example.test/card.png' };
  const report = { blocks: [{ type: 'composition', categories: [{ key: 'Tools', amount: 10, share: 1 }], methods: [{ key: 'm', amount: 10, share: 1 }] }] };
  const nodes = r.render('ScopeReport', {
    report,
    state: { ...st, methods: [method] },
    today,
    onOpen() {},
    title: 'Scope',
    open: true,
    animate: false,
    onToggle() {},
  });
  assert.ok(nodes.some((n) => n.type === 'CatIcon' && n.props.cat === 'Tools'));
  assert.ok(nodes.some((n) => n.props.className === 'scope-cat' && n.props.style.color === 'color-Tools'));
  assert.ok(nodes.some((n) => n.type === 'i' && n.props.style.background === 'color-Tools'));
  assert.ok(nodes.some((n) => n.type === 'MethodMark' && n.props.m === method && n.props.proxied));
});

test('单项停止损失只显示明细；多项和零损失保留汇总', () => {
  const sub: Subscription = {
    id: 's',
    name: 'Stopped',
    category: 'Tools',
    tags: [],
    price: 31,
    currency: 'USD',
    start: '2026-10-05',
    cycle: { unit: 'month', every: 1 },
    status: 'cancelled',
    end: '2026-10-19',
    stop: { kind: 'cancel', date: '2026-10-19', paidThrough: '2026-11-04' },
  };
  const r = harness('../app/src/views/Report.tsx', 'StopsCard', {}, { tipProps: () => ({}) });
  for (const count of [0, 1, 2]) {
    const state = { ...st, subscriptions: Array.from({ length: count }, (_, i) => ({ ...sub, id: String(i) })) };
    const nodes = r.render('StopsCard', { state, today, onOpen() {} });
    assert.equal(nodes.filter((n) => n.props.className === 'stop-row').length, count);
    assert.equal(nodes.filter((n) => n.children.includes('report.stops.loss')).length, count === 1 ? 0 : 1);
  }
});

test('钱包续航列表不重复卡面余额和月扣；单年度分享用时长替代重复总额', () => {
  const wallet = harness('../app/src/views/Wallet.tsx', 'RunwayCard', {}, { tx: (key: string) => key });
  const method = { id: 'w', name: 'Wallet', kind: 'debit' as const, currency: 'USD', balance: 30, balanceAsOf: today };
  const sub: Subscription = {
    id: 's',
    name: 'Plan',
    category: 'Tools',
    tags: [],
    price: 10,
    currency: 'USD',
    start: today,
    cycle: { unit: 'month', every: 1 },
    status: 'active',
    methodId: 'w',
  };
  const state = { ...st, methods: [method], subscriptions: [sub] };
  const r = billing.runwayFor(method, state, today);
  const render = (detailsOnly: boolean) => wallet.render('RunwayCard', { r, today, state, flat: true, detailsOnly });
  assert.equal(
    render(true).find((n) => n.props.className === 'rw-bal'),
    undefined,
  );
  assert.ok(render(false).find((n) => n.props.className === 'rw-bal'));
  const share = harness('../app/src/views/SubShare.tsx', 'SYears', {}, { location: { host: 'example.test' } });
  for (const years of [
    [['2026', 10]],
    [
      ['2025', 4],
      ['2026', 6],
    ],
  ] as Array<Array<[string, number]>>) {
    const nodes = share.render('SYears', {
      sub,
      st: { years, total: 10, duration: '20 days', charges: [], vs: [sub], change: 0 },
      hide: false,
      m: (n: number) => format.flow(n, 'USD'),
    });
    assert.deepEqual(nodes.find((n) => n.props.className === 'sy-big')!.children, [years.length === 1 ? '20 days' : '−$10.00']);
  }
});

test('收款草稿切周期：手改金额或币种后保留，备注和收款日始终保留；未手改金额跟随默认', () => {
  for (const edit of ['none', 'amount', 'zero', 'currency']) {
    const member = { id: 'm', name: 'Member', share: 7.5, fee: 150, feeCurrency: 'CNY', billEvery: 6, joined: '2026-10-14' };
    const sub: Subscription = {
      id: 's',
      name: 'Plan',
      category: 'Tools',
      tags: [],
      price: 15,
      currency: 'USD',
      start: '2026-01-14',
      cycle: { unit: 'month', every: 1 },
      status: 'active',
      share: { role: 'owner', seats: 2, since: '2026-01-14', members: [member] },
    };
    const r = harness(
      '../app/src/views/Members.tsx',
      'MemberSheet',
      {},
      { ...carpool, Sheet: 'Sheet', DatePicker: 'DatePicker', Toggle: 'Toggle', CurrencySelect: 'CurrencySelect', NumInput: 'NumInput', Picker: 'Picker' },
    );
    const render = () => r.render('MemberSheet', { state: st, s: sub, member, collect: true, onClose() {} });
    const cell = (label: string) => render().find((n) => n.type === 'Cell' && n.props.label === label)!;
    const input = (label: string, type: string) => all(cell(label)).find((n) => n.type === type)!;
    input('family.member.note', 'input').props.onChange({ target: { value: '审查草稿' } });
    input('family.member.receivedOn', 'DatePicker').props.onChange('2026-10-21');
    if (edit === 'amount' || edit === 'zero') input('family.member.amount', 'NumInput').props.onValue(edit === 'zero' ? 0 : 12.34);
    if (edit === 'currency') input('family.member.currency', 'CurrencySelect').props.onChange('EUR');
    const before = input('family.member.amount', 'NumInput').props.value;
    for (const months of [1, 3, 6]) {
      render()
        .find((n) => n.type === 'Seg')!
        .props.onChange(String(months));
      assert.equal(input('family.member.note', 'input').props.value, '审查草稿');
      assert.equal(input('family.member.receivedOn', 'DatePicker').props.value, '2026-10-21');
      const dates = render()
        .filter((n) => n.type === 'DatePicker')
        .map((n) => n.props.value);
      assert.ok(dates.includes(months === 1 ? '2026-11-13' : '2027-01-13'));
      if (edit !== 'none') assert.equal(input('family.member.amount', 'NumInput').props.value, before);
      else
        assert.equal(
          input('family.member.amount', 'NumInput').props.value,
          billing.memberCollection(sub, { ...member, billEvery: months }, '2026-10-14', 'USD').amount,
        );
      assert.equal(input('family.member.currency', 'CurrencySelect').props.value, edit === 'currency' ? 'EUR' : 'CNY');
    }
  }
});

test('提醒预览按所有者时区分出今天与最近发送，空预览不显示分组', () => {
  const r = harness('../app/src/views/Settings.tsx', 'ReminderPreview');
  const preview = {
    day: today,
    digests: [],
    log: [
      { dedupe_key: 'today', subject: 'Sent today', status: 'sent', sent_at: '2026-10-21 18:00:00' },
      { dedupe_key: 'yesterday', subject: 'Sent yesterday', status: 'sent', sent_at: '2026-10-21 04:01:00' },
    ],
  };
  const nodes = r.render('ReminderPreview', { preview, timezone: 'Asia/Shanghai' });
  const groups = nodes.filter((n) => n.type === 'Group');
  assert.deepEqual(
    groups.map((n) => n.props.title),
    ['settings.today.title', 'settings.today.recent'],
  );
  assert.deepEqual(
    all(groups[0])
      .filter((n) => n.type === 'Cell')
      .map((n) => all(n.props.label).flatMap((n) => n.children)),
    [['Sent today']],
  );
  assert.ok(all(groups[0]).some((n) => n.children.includes('02:00')));
  assert.ok(all(groups[1]).some((n) => n.children.includes('2026-10-21 12:01')));
  assert.equal(r.render('ReminderPreview', { preview: { ...preview, log: [] }, timezone: 'UTC' }).filter((n) => n.type === 'Group').length, 0);
  assert.equal(r.render('ReminderPreview', { preview: null, timezone: 'UTC' }).length, 0);
});
