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
import { PERSON_COLORS, DEFAULT_SETTINGS, type AppState, type Subscription } from './types.ts';

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
    PersonAvatar: 'PersonAvatar',
    personFor: (state: AppState, id: string, name: string) => state.people?.find((p) => p.id === id) ?? { id, name },
    t: (key: string) => key,
    tipProps: () => ({}),
    useMemo: (fn: () => unknown) => fn(),
    useRef: () => ({ current: null }),
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
    IconButton: 'button',
    CardTitle: 'h3',
    Hint: 'Hint',
    PayBadge: 'PayBadge',
    Seg: 'Seg',
    SubIcon: 'SubIcon',
    CatIcon: 'CatIcon',
    BarLine: 'BarLine',
    MethodMark: 'MethodMark',
    bankOf: () => undefined,
    brandOf: () => undefined,
    methodLogo: (m: { logo?: string }) => m.logo,
    catColor: (cat: string) => `color-${cat}`,
    Toolbar: 'Toolbar',
    ScopeReport: 'ScopeReport',
    useCallback: (fn: unknown) => fn,
    Fragment: 'Fragment',
    Timeline: 'Timeline',
    Amount: 'Amount',
    Maximize2: 'Maximize2',
    Minimize2: 'Minimize2',
    Layers: 'Layers',
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

test('calendar full report collapses to persisted mini with day details, expands again, and stays absent in year view', () => {
  const r = harness('../app/src/views/Calendar.tsx', 'Calendar', { 'cal-report-mode': 'full' });
  const render = () => r.render('Calendar', { state: st, today, onOpen() {}, onIcs() {} });
  const mini = (nodes: Node[]) => nodes.find((n) => typeof n.type === 'function' && n.type.name === 'MiniReport');
  let nodes = render();
  assert.equal(nodes.find((n) => n.type === 'ScopeReport')!.props.open, true);
  assert.equal(mini(nodes), undefined);
  nodes.find((n) => n.type === 'ScopeReport')!.props.onToggle();
  nodes = render();
  assert.equal(r.prefs['cal-report-mode'], 'mini');
  assert.ok(mini(nodes));
  assert.equal(
    nodes.some((n) => n.props.className === 'cal-dayhead'),
    false,
    'empty days have no block in mini mode either',
  );
  assert.equal(
    nodes.find((n) => n.type === 'ScopeReport'),
    undefined,
  );
  mini(nodes)!.props.onExpand();
  assert.equal(render().find((n) => n.type === 'ScopeReport')!.props.open, true);
  render()
    .find((n) => n.type === 'ScopeReport')!
    .props.onToggle();
  render()
    .find((n) => n.props['aria-label'] === 'calendar.next')!
    .props.onClick();
  assert.ok(mini(render()));
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
      monthMovement: () => ({ from: 100, to: 80, fx: 0, added: 0, expansion: 0, contraction: 0, churned: 20, items: [] }),
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
      monthMovement: () => ({ from: 100, to: 110, fx: 0, added: 30, expansion: 0, contraction: 0, churned: 20, items: [] }),
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
    items: [{ sub: subscription, kind: 'churned' as const, delta: -20, from: 20, to: 0, since: '2026-10-12', until: '2026-10-12' }],
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
      movement: {
        from: 0,
        to: 10,
        fx: 0,
        added: 10,
        expansion: 0,
        contraction: 0,
        churned: 0,
        items: [{ sub, kind: 'added', delta: 10, from: 0, to: 10, since: '2026-01-01', until: '2026-01-01' }],
      },
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
    {
      useId: () => 'scope',
      useRef: () => ({ current: null }),
      intlLocale: () => 'en-US',
      bankOf: () => undefined,
      brandOf: () => undefined,
      methodLogo: (m: { logo?: string }) => m.logo,
    },
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

test('收款只显示实收表单；编辑成员后切周期仍保留实际草稿，默认覆盖按成员周期顺延', () => {
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
    assert.equal(
      render().some((n) => n.type === 'Seg'),
      false,
    );
    assert.equal(
      render().some((n) => n.type === 'Cell' && n.props.label === 'family.member.name'),
      false,
    );
    render()
      .find((n) => n.type === 'button' && n.children.includes('family.collect.editMember'))!
      .props.onClick();
    const before = input('family.member.amount', 'NumInput').props.value;
    input('family.collect.feeFrom', 'DatePicker').props.onChange('2026-10-14');
    // 成员默认跟随车的规则；要单独改周期先切到自定义
    render()
      .find((n) => n.type === 'Seg' && n.props.value === 'follow')
      ?.props.onChange('custom');
    for (const months of [1, 3, 6]) {
      render()
        .find((n) => n.type === 'Seg' && n.props.value !== 'custom')!
        .props.onChange(String(months));
      assert.equal(input('family.member.note', 'input').props.value, '审查草稿');
      assert.equal(input('family.member.receivedOn', 'DatePicker').props.value, '2026-10-21');
      const dates = render()
        .filter((n) => n.type === 'DatePicker')
        .map((n) => n.props.value);
      assert.ok(dates.includes(billing.memberCollection(sub, { ...member, billEvery: months }, '2026-10-14', 'USD').until));
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

test('公开页时间线的支出和退款使用同一收支格式，关闭符号后同时移除', () => {
  let load: (from: string, to: string) => any[];
  const captured = new Error('timeline captured');
  const r = harness(
    '../app/src/public/page.tsx',
    'Ledger',
    {},
    {
      syncCategories: () => [],
      periodRange: () => ['2026-10-01', '2026-10-31'],
      AppIcon: 'AppIcon',
      useCallback: (fn: typeof load) => {
        load = fn;
        throw captured;
      },
      allCharges: () => [
        { sub: { id: 's', name: 'Service' }, date: today, amount: 10, currency: 'USD', projected: false },
        { sub: { id: 's', name: 'Service' }, date: today, amount: -3, currency: 'USD', projected: false, kind: 'refund' },
      ],
    },
  );
  try {
    for (const on of [true, false]) {
      format.setSignedAmounts(on);
      assert.throws(() => r.render('Ledger', { state: st }), captured);
      const items = load!(today, today)[0].items;
      assert.equal(items[0].tip, `Service · ${on ? '−' : ''}$10.00`);
      assert.equal(items[1].tip, `Service · ${on ? '+' : ''}$3.00`);
    }
  } finally {
    format.setSignedAmounts(true);
  }
});

test('小票结束语按实际状态显示停止日、到期日或下期见', () => {
  const r = harness(
    '../app/src/views/SubShare.tsx',
    'SReceipt, story',
    {},
    { location: { host: 'example.test' }, t: (key: string, p?: { date?: string }) => (p?.date ? `${key} ${p.date}` : key) },
  );
  const base: Subscription = {
    id: 's',
    name: 'Plan',
    category: 'Tools',
    tags: [],
    price: 10,
    currency: 'USD',
    start: '2026-10-01',
    cycle: { unit: 'month', every: 1 },
    status: 'active',
  };
  for (const [sub, key, date] of [
    [base, 'share.thanks', undefined],
    [{ ...base, status: 'cancelled', end: '2026-11-01' }, 'share.endsOn', '2026-11-01'],
    ...(['cancel', 'terminate'] as const).map((kind) => [
      { ...base, status: kind === 'cancel' ? 'cancelled' : 'terminated', end: today, stop: { kind, date: today, paidThrough: '2026-10-31' } },
      'share.stoppedOn',
      today,
    ]),
  ] as Array<[Subscription, string, string | undefined]>) {
    const story = r.call('story', { ...st, subscriptions: [sub] }, sub, today);
    const nodes = r.render('SReceipt', { sub, st: story, today, hide: false, m: (n: number) => format.flow(n, 'USD') });
    assert.deepEqual(nodes.find((n) => n.props.className === 'rc-thanks')!.children, [date ? `${key} ${format.cnDateFull(date)}` : key]);
  }
});

test('report layout keeps compact composition, five distinct upcoming rows and a monthly minimize action', () => {
  let toggles = 0;
  const r = harness(
    '../app/src/components/ScopeReport.tsx',
    'ScopeReport',
    {},
    {
      useId: () => 'scope',
      useRef: () => ({ current: null }),
      intlLocale: () => 'en-US',
      BarLine: 'BarLine',
    },
  );
  const subscriptions: Subscription[] = Array.from({ length: 12 }, (_, i) => ({
    id: String(i),
    name: `Sample ${i}`,
    category: `Category ${i}`,
    tags: [],
    price: 100 - i,
    currency: 'USD',
    cycle: { unit: 'month', every: 1 },
    start: '2026-10-25',
    status: 'active',
    methodId: String(i),
  }));
  const state = { ...st, subscriptions };
  const render = (report: reports.ScopeReport) =>
    r.render('ScopeReport', {
      report,
      state,
      today,
      onOpen() {},
      title: 'Report',
      animate: false,
      open: true,
      onToggle() {
        toggles++;
      },
    });
  const nodes = render(reports.monthReport(state, '2026-10', today));
  const minimize = nodes.find((n) => n.props['aria-label'] === 'scope.minimize')!;
  assert.equal(minimize.props.title, 'scope.minimize');
  assert.ok(all(minimize).some((n) => n.type === 'Minimize2'));
  minimize.props.onClick();
  assert.equal(toggles, 1);
  const card = (type: string) => nodes.find((n) => String(n.props.className).includes(`scope-block scope-${type}`))!;
  const rows = (node: Node) => all(node).filter((n) => n.type === 'button' && n.props.className === 'scope-row scope-tap');
  const top = rows(card('top'));
  const upcoming = rows(card('upcoming'));
  assert.equal(top.length, 5);
  assert.equal(upcoming.length, 5);
  const ids = (rows: Node[]) => rows.map((row) => all(row).find((n) => n.type === 'SubIcon')!.props.sub.id);
  assert.deepEqual(ids(upcoming), ['10', '11', '5', '6', '7']);
  assert.ok(ids(upcoming).every((id) => !ids(top).includes(id)));
  const comp = all(card('composition'));
  assert.equal(comp.filter((n) => n.props.className === 'scope-share').length, 12);
  assert.equal(comp.filter((n) => n.children.includes('scope.other')).length, 2);
  assert.equal(comp.filter((n) => n.type === 'button').length, 0);
  assert.ok(render(reports.scopeReport(state, subscriptions, today)).some((n) => n.props['aria-label'] === 'scope.collapse'));
});

test('monthly movement subtitles own unsigned before/after costs without a duplicate event card', () => {
  const r = harness(
    '../app/src/components/ScopeReport.tsx',
    'ScopeReport',
    {},
    {
      useId: () => 'scope',
      useRef: () => ({ current: null }),
      intlLocale: () => 'en-US',
    },
  );
  const state: AppState = {
    ...st,
    subscriptions: [
      {
        id: 'new',
        name: 'New',
        category: 'Tools',
        tags: [],
        price: 10,
        currency: 'USD',
        cycle: { unit: 'month', every: 1 },
        start: '2026-10-03',
        status: 'active',
      },
    ],
  };
  const nodes = r.render('ScopeReport', {
    report: reports.monthReport(state, '2026-10', today),
    state,
    today,
    onOpen() {},
    title: 'Month',
    animate: false,
    open: true,
    onToggle() {},
  });
  const movement = nodes.find((n) => n.props.className === 'scope-movements')!;
  assert.ok(all(movement).some((n) => n.children.includes('scope.added')));
  assert.ok(all(movement).some((n) => n.children.includes('$0.00') && n.children.includes('$10.00')));
  assert.ok(all(movement).some((n) => n.props.className === 'scope-movement-date' && n.children.includes(format.cnDateAuto('2026-10-03', today))));
  assert.equal(
    nodes.some((n) => String(n.props.className).includes('scope-block scope-events')),
    false,
  );
});

test('calendar full report keeps only populated selected-day details above its divider and updates on selection', () => {
  const sub: Subscription = {
    id: 'calendar-plan',
    name: 'Fictional plan',
    category: 'Tools',
    tags: [],
    price: 10,
    currency: 'USD',
    cycle: { unit: 'month', every: 1 },
    start: '2025-01-09',
    status: 'active',
  };
  const state = { ...st, readonly: true, subscriptions: [sub] };
  const opened: Subscription[] = [];
  const r = harness(
    '../app/src/views/Calendar.tsx',
    'Calendar',
    { 'cal-report-mode': 'full' },
    {
      allCharges: (s: AppState, from: string, to: string, at: string) => s.subscriptions.flatMap((sub) => billing.chargesBetween(sub, from, to, at)),
    },
  );
  const render = () => r.render('Calendar', { state, today, onOpen: (s: Subscription) => opened.push(s), onIcs() {} });
  const pick = (day: string) =>
    render()
      .find((n) => n.props['aria-label'] === format.cnDate(day, true))!
      .props.onClick();
  const details = (nodes: Node[]) => nodes.filter((n) => n.props.className === 'card cal-daycard');
  assert.equal(
    render().some((n) => n.props.className === 'stack cal-selection'),
    false,
    'empty today has no block in full mode',
  );
  pick('2026-10-09');
  let nodes = render();
  assert.equal(details(nodes).length, 1);
  assert.ok(nodes.indexOf(details(nodes)[0]) < nodes.findIndex((n) => n.type === 'ScopeReport'));
  assert.equal(nodes.find((n) => n.type === 'ScopeReport')!.props.selectedChargeDate, '2026-10-09');
  details(nodes)[0].props.onClick();
  assert.equal(opened[0], sub);
  pick('2026-10-10');
  assert.equal(
    render().some((n) => n.props.className === 'stack cal-selection'),
    false,
  );
  pick('2026-10-09');
  assert.equal(details(render()).length, 1);
  pick('2026-10-09');
  assert.equal(details(render()).length, 0, 'second click removes the selected block');
  assert.equal(render().find((n) => n.type === 'ScopeReport')!.props.selectedChargeDate, undefined);
  pick('2026-10-09');
  render()
    .find((n) => n.props['aria-label'] === 'calendar.next')!
    .props.onClick();
  assert.equal(details(render()).length, 0, 'month navigation clears selection');
});

test('calendar full selection scrolls into view only when needed and respects reduced motion', () => {
  for (const [top, bottom, reduced, expected] of [
    [100, 250, false, undefined],
    [600, 850, false, 'smooth'],
    [30, 170, true, 'instant'],
  ] as const) {
    const scrolls: unknown[] = [];
    const element = {
      querySelector: () => null,
      style: { scrollMarginTop: '' },
      getBoundingClientRect: () => ({ top, bottom }),
      scrollIntoView: (opts: unknown) => scrolls.push(opts),
    };
    const r = harness(
      '../app/src/views/Calendar.tsx',
      'Calendar',
      { 'cal-report-mode': 'full' },
      {
        allCharges: () => [
          {
            date: today,
            amount: 10,
            currency: 'USD',
            sub: { id: 's', name: 'Fictional', start: today, price: 10, currency: 'USD', status: 'active', cycle: { unit: 'month', every: 1 } },
          },
        ],
        useRef: () => ({ current: element }),
        window: { innerHeight: 700 },
        matchMedia: () => ({ matches: reduced }),
        document: { addEventListener() {}, removeEventListener() {}, querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 60 }) }) },
        stopLabel: () => undefined,
      },
    );
    r.render('Calendar', { state: { ...st, readonly: true }, today, onOpen() {}, onIcs() {} });
    assert.deepEqual(scrolls, expected ? [{ block: 'nearest', behavior: expected }] : []);
    assert.equal(element.style.scrollMarginTop, '60px');
  }
});

test('monthly report hides selected-day charge/refund rows, restores them on deselection and keeps complete totals', () => {
  const sub: Subscription = {
    id: 's',
    name: 'Fictional',
    category: 'Tools',
    tags: [],
    price: 10,
    currency: 'USD',
    cycle: { unit: 'month', every: 1 },
    start: '2025-01-09',
    status: 'active',
  };
  const state = { ...st, subscriptions: [sub] };
  const row = (date: string, amount = 10): reports.ChargeRow => ({ sub, date, amount, original: { sub, date, amount, currency: 'USD', projected: false } });
  const selected = row('2026-10-26'),
    other = row('2026-10-28'),
    refund = row('2026-10-26', -3);
  const report: reports.ScopeReport = {
    blocks: [
      { type: 'headline', mode: 'month', month: '2026-10', total: 27, paid: 7, pending: 20, count: 3, previous: { amount: 0 } },
      { type: 'top', mode: 'month', rows: [selected, other] },
      { type: 'upcoming', rows: [selected, other, row('2026-10-26', 20)], total: 40 },
      { type: 'losses', rows: [], refunds: [refund], refunded: 3, loss: 0, incomplete: false },
    ],
  };
  const r = harness('../app/src/components/ScopeReport.tsx', 'ScopeReport', {}, { useId: () => 'scope', intlLocale: () => 'en-US' });
  const render = (selectedChargeDate?: string) =>
    r.render('ScopeReport', { report, state, today, selectedChargeDate, onOpen() {}, title: 'Month', open: true, animate: false, onToggle() {} });
  const rows = (nodes: Node[]) => nodes.filter((n) => n.props.className === 'scope-row scope-tap');
  const selectedNodes = render('2026-10-26');
  assert.equal(rows(selectedNodes).length, 1, 'only the other day remains, without an empty upcoming/refund card');
  assert.ok(rows(selectedNodes)[0].children.some((n) => all(n).some((n) => n.children.includes(format.cnDateAuto(other.date, today)))));
  assert.ok(
    selectedNodes.some((n) => n.children.includes(format.flow(-27, 'USD'))),
    'headline still contains selected charges and refund',
  );
  assert.equal(rows(render()).length, 4, 'deselection restores all distinct top/upcoming/refund rows');
  const copying = harness(
    '../app/src/components/ScopeReport.tsx',
    'ScopeReport',
    {},
    {
      useId: () => 'copy',
      intlLocale: () => 'en-US',
      useState: () => ['copying', () => {}],
    },
  );
  const copied = copying.render('ScopeReport', {
    report,
    state,
    today,
    selectedChargeDate: '2026-10-26',
    onOpen() {},
    title: 'Month',
    open: true,
    animate: false,
    onToggle() {},
  });
  assert.equal(rows(copied).length, 4, 'PNG capture retains every report row, including the selected day');
});

test('monthly movement preserves provider termination, stop reason, multi-event and zero-net history in one card', () => {
  const base: Subscription = {
    id: 'stopped',
    name: 'Fictional stopped plan',
    category: 'Tools',
    tags: [],
    price: 10,
    currency: 'USD',
    cycle: { unit: 'month', every: 1 },
    start: '2025-01-01',
    status: 'terminated',
    end: '2026-10-10',
    stop: { kind: 'terminate', date: '2026-10-10', paidThrough: '2026-10-31', reason: 'Fictional provider closure' },
  };
  const price = (id: string, amounts: number[]): Subscription => ({
    ...base,
    id,
    name: id,
    status: 'active',
    end: undefined,
    stop: undefined,
    price: amounts.at(-1)!,
    priceHistory: amounts.map((amount, i) => ({ from: ['2025-01-01', '2026-10-03', '2026-10-12'][i], amount })),
  });
  const state = { ...st, subscriptions: [base, price('multi', [10, 20, 30]), price('zero-net', [10, 20, 10])] };
  const opened: Subscription[] = [];
  const r = harness('../app/src/components/ScopeReport.tsx', 'ScopeReport', {}, { useId: () => 'scope', intlLocale: () => 'en-US' });
  const nodes = r.render('ScopeReport', {
    report: reports.monthReport(state, '2026-10', today),
    state,
    today,
    onOpen: (s: Subscription) => opened.push(s),
    title: 'Month',
    animate: false,
    open: true,
    onToggle() {},
  });
  assert.equal(
    nodes.some((n) => String(n.props.className).includes('scope-block scope-events')),
    false,
  );
  const movement = nodes.find((n) => n.props.className === 'scope-movements')!;
  const rows = all(movement).filter((n) => n.type === 'button');
  assert.equal(rows.length, 4, 'two net movements plus the two zero-net price events');
  const text = JSON.stringify(movement.children);
  assert.ok(text.includes('scope.event.terminate'));
  assert.ok(text.includes('Fictional provider closure'));
  const losses = nodes.find((n) => String(n.props.className).includes('scope-block scope-losses'))!;
  assert.equal(JSON.stringify(losses.children).includes('scope.event.terminate'), false, 'stop context is already owned by the movement row');
  assert.ok(text.includes(format.cnDateAuto('2026-10-03', today)));
  assert.ok(text.includes(format.cnDateAuto('2026-10-12', today)));
  rows.find((n) => all(n).some((c) => c.children.includes(base.name)))!.props.onClick();
  assert.equal(opened.at(-1), base);
});

test('scope history remains visible without monthly movement; unbranded payment methods use a wallet glyph', () => {
  const sub: Subscription = {
    id: 'new',
    name: 'Fictional plan',
    category: 'Tools',
    tags: [],
    price: 10,
    currency: 'USD',
    cycle: { unit: 'month', every: 1 },
    start: '2026-10-03',
    status: 'active',
  };
  const state = { ...st, subscriptions: [sub], methods: [{ id: 'plain', name: 'Demo Card 1', kind: 'card' as const, currency: 'USD' }] };
  const r = harness(
    '../app/src/components/ScopeReport.tsx',
    'ScopeReport',
    {},
    {
      useId: () => 'scope',
      intlLocale: () => 'en-US',
      bankOf: () => undefined,
      brandOf: () => undefined,
      methodLogo: () => undefined,
    },
  );
  const props = { state, today, onOpen() {}, title: 'Scope', animate: false, open: true, onToggle() {} };
  const nodes = r.render('ScopeReport', { ...props, report: reports.scopeReport(state, [sub], today) });
  const event = nodes.find((n) => String(n.props.className).includes('scope-block scope-events'))!;
  assert.ok(all(event).some((n) => n.children.includes('scope.event.start')));
  const marks = r.render('ScopeReport', {
    ...props,
    report: { blocks: [{ type: 'composition', categories: [], methods: [{ key: 'plain', amount: 10, share: 1 }] }] },
  });
  assert.ok(marks.some((n) => n.type === 'Icon' && n.props.name === 'wallet' && n.props.size === 18));
  assert.equal(
    marks.some((n) => n.type === 'MethodMark'),
    false,
  );
});

test('calendar groups dates chronologically, follows the currency preference and retains whole-row detail actions', () => {
  const subscriptions = ['Long fictional subscription name', 'Same day EUR', 'Refund'].map((name, i) => ({
    id: String(i),
    name,
    category: 'Tools',
    tags: [],
    price: 10,
    currency: i === 1 ? 'EUR' : 'USD',
    start: '2026-09-22',
    status: 'active',
    cycle: { unit: 'month', every: 1 },
  })) as Subscription[];
  const charges = [
    { sub: subscriptions[0], date: today, amount: 10, currency: 'USD', projected: false },
    { sub: subscriptions[1], date: today, amount: 5, currency: 'EUR', projected: false },
    { sub: subscriptions[2], date: '2026-10-16', amount: -3, currency: 'USD', projected: false, kind: 'refund' },
  ];
  const state = {
    ...st,
    readonly: true,
    subscriptions,
    settings: { ...DEFAULT_SETTINGS, baseCurrency: 'CNY' },
    fx: { base: 'USD' as const, rates: { USD: 1, CNY: 7, EUR: 0.9 }, fetchedAt: today },
  };
  for (const orig of [false, true]) {
    const money = harness('../app/src/components/MoneyPair.tsx', 'useMoneyPair', {}, { useOrig: () => orig });
    const opened: Subscription[] = [];
    const r = harness(
      '../app/src/views/Calendar.tsx',
      'Calendar',
      {},
      {
        allCharges: () => charges,
        sumBase: (s: AppState, rows: billing.Charge[]) => rows.reduce((n, c) => n + fx.chargeValue(s, c), 0),
        useMoneyPair: () => money.call('useMoneyPair', state),
      },
    );
    const render = () => r.render('Calendar', { state, today, onOpen: (sub: Subscription) => opened.push(sub), onIcs() {} });
    let nodes = render();
    assert.deepEqual(
      nodes.filter((n) => n.props['data-date']).map((n) => n.props['data-date']),
      ['2026-10-16', today],
    );
    const timeline = nodes.find((n) => n.props.className === 'cal-charge-list')!;
    const rows = all(timeline).filter((n) => n.props.className === 'cal-charge-row');
    assert.equal(rows.length, 3);
    const amounts = rows.map((n) => all(n).find((n) => n.type === 'Amount')!.props);
    assert.deepEqual(
      amounts.map((n) => n.ccy),
      orig ? ['USD', 'USD', 'EUR'] : ['CNY', 'CNY', 'CNY'],
    );
    assert.equal(amounts[0].value, orig ? 3 : 21);
    assert.equal(amounts[1].value, orig ? -10 : -70);
    const refundGrid = nodes.find((n) => n.props['aria-label'] === format.cnDate('2026-10-16', true))!;
    const gridAmount = all(refundGrid).find((n) => n.type === 'Amount')!;
    assert.equal(gridAmount.props.ccy, 'CNY');
    assert.equal(gridAmount.props.value, 21);
    assert.equal(gridAmount.props.decimals, 0);
    assert.equal(all(timeline).filter((n) => n.props.className === 'cal-charge-day today').length, 1);
    assert.ok(nodes.some((n) => n.props['data-date'] === today));
    rows[1].props.onClick();
    assert.equal(opened[0], subscriptions[0]);
    const details = nodes.filter((n) => n.props.className === 'card cal-daycard');
    assert.equal(all(details[0]).find((n) => n.type === 'Amount')!.props.ccy, orig ? 'USD' : 'CNY');
    nodes.find((n) => n.props['aria-label'] === format.cnDate('2026-10-17', true))!.props.onClick();
    nodes = render();
    assert.equal(
      nodes.some((n) => n.props.className === 'stack cal-selection' || n.props.className === 'cal-none'),
      false,
    );
    nodes.find((n) => n.props['aria-label'] === 'calendar.next')!.props.onClick();
    assert.equal(
      render().some((n) => n.props.className === 'cal-charge-day today'),
      false,
    );
  }
});

test('calendar day cards show charged coverage and real stop/pause dates without a missing next-charge placeholder', () => {
  for (const paused of [false, true]) {
    const sub: Subscription = {
      id: 's',
      name: 'Fictional',
      category: 'Tools',
      tags: [],
      price: 20,
      currency: 'USD',
      start: '2026-07-06',
      cycle: { unit: 'month', every: 1 },
      status: paused ? 'paused' : 'cancelled',
      ...(paused ? { pausedAt: '2026-10-18' } : { end: '2026-10-16', stop: { kind: 'cancel', date: '2026-10-16', paidThrough: '2026-11-05' } }),
    };
    const r = harness(
      '../app/src/views/Calendar.tsx',
      'Calendar',
      {},
      {
        allCharges: () => [{ sub, date: '2026-10-06', amount: 20, currency: 'USD', projected: false }],
        t: (key: string, args: Record<string, unknown> = {}) => `${key} ${Object.values(args).join(' ')}`,
      },
    );
    const render = () => r.render('Calendar', { state: { ...st, readonly: true, subscriptions: [sub] }, today, onOpen() {}, onIcs() {} });
    render()
      .find((n) => n.props['aria-label'] === format.cnDate('2026-10-06', true))!
      .props.onClick();
    const card = render().find((n) => n.props.className === 'card cal-daycard')!;
    const content = all(card)
      .flatMap((n) => n.children)
      .filter((n) => typeof n === 'string')
      .join(' ');
    assert.ok(content.includes(format.cnDateAuto('2026-10-06', today)) && content.includes(format.cnDateAuto('2026-11-05', today)));
    assert.ok(content.includes(format.cnDateAuto(paused ? '2026-10-18' : '2026-10-16', today)));
    assert.ok(!content.includes('calendar.nextCharge') && !content.includes('—'));
    assert.equal(all(card).find((n) => n.type === 'SubIcon')!.props.size, 48);
  }
});

test('calendar keeps a long month complete and selection never scrolls a nested list', () => {
  for (const reduced of [false, true]) {
    const scrolls: unknown[] = [];
    let refs = 0;
    const group = { getBoundingClientRect: () => ({ top: 720, bottom: 850 }) };
    const list = {
      querySelector: () => group,
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 20,
      getBoundingClientRect: () => ({ top: 100, bottom: 500 }),
      scrollTo: (opts: unknown) => scrolls.push(opts),
    };
    const r = harness(
      '../app/src/views/Calendar.tsx',
      'Calendar',
      {},
      {
        useRef: () => ({ current: refs++ === 0 ? null : list }),
        matchMedia: () => ({ matches: reduced }),
        allCharges: (state: AppState, from: string, to: string, day: string) =>
          state.subscriptions.flatMap((sub) => billing.chargesBetween(sub, from, to, day)),
      },
    );
    const subscriptions: Subscription[] = Array.from({ length: 24 }, (_, i) => ({
      id: `long-month-${i}`,
      name: `Fictional subscription ${i}`,
      category: 'Tools',
      tags: [],
      price: 10,
      currency: 'USD',
      cycle: { unit: 'month', every: 1 },
      start: `2022-10-${String(i + 1).padStart(2, '0')}`,
      status: 'active',
    }));
    const props = { state: { ...st, subscriptions, readonly: true }, today, onOpen() {}, onIcs() {} };
    let nodes = r.render('Calendar', props);
    assert.deepEqual(scrolls, [], 'initial selection leaves the full month in page flow');
    const rows = () => nodes.filter((n) => n.props.className === 'cal-charge-row');
    assert.equal(rows().length, 24);
    nodes.find((n) => n.props['aria-label'] === format.cnDate('2026-10-24', true))!.props.onClick();
    nodes = r.render('Calendar', props);
    assert.deepEqual(scrolls, [], 'changing the selected date never scrolls a nested list');
    assert.equal(rows().length, 24);
    assert.ok(nodes.some((n) => n.props['data-date'] === '2026-10-24'));
    assert.equal(nodes.filter((n) => n.props.className === 'cal-charge-day today').length, 1, 'today stays red independently of selection');
  }
});

test('member rows show one dynamic due date instead of claiming no receipts', () => {
  const member = { id: 'm', name: 'Fictional member', share: 5, payments: [{ date: today, amount: 5, currency: 'USD', until: '2026-10-31' }] };
  const sub: Subscription = {
    id: 'shared',
    name: 'Shared plan',
    category: 'Tools',
    tags: [],
    price: 10,
    currency: 'USD',
    cycle: { unit: 'month', every: 1 },
    start: '2026-10-01',
    status: 'active',
    share: { role: 'owner', seats: 2, members: [member] },
  };
  const r = harness('../app/src/views/Carpool.tsx', 'MemberRows', {}, { ...carpool, contactText: () => '', perBill: () => '' });
  const render = () => JSON.stringify(r.render('MemberRows', { state: { ...st, subscriptions: [sub] }, s: sub, today, ro: false, onMember() {} }));
  // 成员行只写一条日期：欠款「应收 某日」，结清「下次应收 某日」；有收款记录时不再出现「尚未收款」
  const rendered = render();
  assert.ok(rendered.includes('family.pool.dueOn') || rendered.includes('family.pool.nextDueOn'));
  assert.ok(!rendered.includes('family.pool.noPay'));
  sub.share!.members = [{ ...member, payments: [] }];
  assert.ok(render().includes('family.pool.dueOn'));
  assert.ok(!render().includes('family.pool.noPay'));
});

test('calendar lifetime charge has one lifetime label and a purchase date beside recurring coverage', () => {
  const subscriptions: Subscription[] = ['month', 'lifetime'].map((unit, i) => ({
    id: String(i),
    name: `Fictional ${unit}`,
    category: 'Tools',
    tags: [],
    price: 20,
    currency: 'USD',
    start: today,
    cycle: { unit: unit as 'month' | 'lifetime', every: 1 },
    status: 'active',
  }));
  const r = harness(
    '../app/src/views/Calendar.tsx',
    'Calendar',
    {},
    {
      allCharges: () => subscriptions.map((sub) => ({ sub, date: today, amount: 20, currency: 'USD', projected: false })),
    },
  );
  const nodes = r.render('Calendar', { state: { ...st, readonly: true, subscriptions }, today, onOpen() {}, onIcs() {} });
  const cards = nodes.filter((n) => n.props.className === 'card cal-daycard');
  assert.equal(cards.length, 2);
  const lifetime = all(cards[1]);
  assert.equal(
    lifetime.some((n) => n.children.includes('list.status.lifetime')),
    false,
    'cycle already identifies lifetime',
  );
  const info = lifetime.find((n) => n.props.className === 'cal-dc-info')!;
  assert.ok(all(info).some((n) => n.children.includes('editor.field.purchased') && n.children.includes(format.cnDateAuto(today, today))));
  assert.ok(
    all(cards[0]).some((n) => n.children.includes(format.cnDateAuto('2026-11-21', today))),
    'recurring coverage remains visible',
  );
});

test('payment marks fall back for missing, legacy and failed logos and recover when the logo changes', () => {
  const r = harness(
    '../app/src/components/ui.tsx',
    'MethodMark',
    {},
    {
      base: (s: string) => s,
      methodRegion: () => undefined,
      BRANDS: [],
      KIND_BG: { credit: '#222', other: '#444' },
      paletteColor: (value: string | undefined, fallback: string) => value ?? fallback,
    },
  );
  const render = (logo?: string, kind?: string) => r.render('MethodMark', { m: { id: 'm', name: 'Fictional Visa', currency: 'USD', kind, logo } });
  const glyph = (nodes: Node[]) => nodes.some((n) => typeof n.type === 'function' && n.type.name === 'Icon' && n.props.name === 'wallet');
  assert.ok(glyph(render(undefined, 'credit')));
  let nodes = render();
  assert.ok(glyph(nodes), 'legacy method without kind gets a visible glyph');
  assert.equal(nodes[0].props.style.background, '#444');
  nodes = render('/missing-logo.svg', 'credit');
  nodes.find((n) => n.type === 'img')!.props.onError();
  assert.ok(glyph(render('/missing-logo.svg', 'credit')));
  nodes = render('/replacement.svg', 'credit');
  assert.equal(glyph(nodes), false);
  assert.equal(nodes.find((n) => n.type === 'img')!.props.src, '/replacement.svg');
});

test('收款保存失败保留草稿且不关闭；重试成功只增加一条并关闭', async () => {
  const member = { id: 'm', name: 'Member', share: 7, fee: 44, feeCurrency: 'CNY', billEvery: 6, joined: '2025-10-14', paidUntil: '2026-07-16' };
  const sub: Subscription = {
    id: 's',
    name: 'Plan',
    category: 'Tools',
    tags: [],
    price: 15,
    currency: 'USD',
    start: '2025-10-14',
    cycle: { unit: 'month', every: 1 },
    status: 'active',
    share: { role: 'owner', seats: 6, collectFrom: '2025-10-14', members: [member] },
  };
  let fail = true,
    closed = 0;
  let saved: Subscription | undefined;
  const r = harness(
    '../app/src/views/Members.tsx',
    'MemberSheet',
    {},
    {
      ...carpool,
      Sheet: 'Sheet',
      DatePicker: 'DatePicker',
      Toggle: 'Toggle',
      CurrencySelect: 'CurrencySelect',
      NumInput: 'NumInput',
      getState: () => ({ ...st, subscriptions: [sub] }),
      run: async (fn: () => Promise<unknown>) => {
        try {
          await fn();
        } catch {
          /* Matches run's toast-and-retain behavior. */
        }
      },
      saveSub: async (s: Subscription) => {
        if (fail) throw Error('offline');
        saved = s;
      },
    },
  );
  const render = () =>
    r.render('MemberSheet', {
      state: st,
      s: sub,
      member,
      collect: true,
      onClose() {
        closed++;
      },
    });
  render()
    .find((n) => n.type === 'input' && n.props.placeholder === 'family.member.notePh')!
    .props.onChange({ target: { value: 'keep draft' } });
  const record = () =>
    all(render().find((n) => n.type === 'Sheet')!.props.foot)
      .find((n) => n.type === 'button' && n.children.includes('family.member.record'))!
      .props.onClick();
  await record();
  assert.equal(closed, 0);
  assert.equal(saved, undefined);
  assert.equal(render().find((n) => n.type === 'input')!.props.value, 'keep draft');
  fail = false;
  await record();
  assert.equal(closed, 1);
  assert.equal(saved!.share!.members[0].payments!.length, 1);
  assert.equal(saved!.share!.members[0].paidUntil, '2027-01-16');
});

test('成员先改收费再改生效日只留下一个调整，今天标准与旧收款保持', async () => {
  const member = { id: 'm', name: 'Member', share: 6.67, fee: 40, feeCurrency: 'CNY', billEvery: 6, joined: '2025-10-14', paidUntil: '2026-07-16' };
  const sub: Subscription = {
    id: 's',
    name: 'Plan',
    category: 'Tools',
    tags: [],
    price: 15,
    currency: 'USD',
    start: '2025-10-14',
    cycle: { unit: 'month', every: 1 },
    status: 'active',
    share: { role: 'owner', seats: 6, collectFrom: '2025-10-14', members: [member] },
  };
  let saved: Subscription | undefined;
  const r = harness(
    '../app/src/views/Members.tsx',
    'MemberSheet',
    {},
    {
      ...carpool,
      Sheet: 'Sheet',
      DatePicker: 'DatePicker',
      Toggle: 'Toggle',
      CurrencySelect: 'CurrencySelect',
      NumInput: 'NumInput',
      getState: () => ({ ...st, subscriptions: [sub] }),
      linkPerson: async () => ({ id: 'p' }),
      run: (fn: () => Promise<unknown>) => fn(),
      saveSub: async (s: Subscription) => {
        saved = s;
      },
    },
  );
  const render = () => r.render('MemberSheet', { state: st, s: sub, member, onClose() {} });
  render()
    .find((n) => n.type === 'Seg' && n.props.value === 'follow')
    ?.props.onChange('custom');
  render()
    .find((n) => n.type === 'NumInput' && n.props.value === 40)!
    .props.onValue(44);
  const dateCell = render().find((n) => n.type === 'Cell' && n.props.label === 'family.collect.feeFrom')!;
  all(dateCell)
    .find((n) => n.type === 'DatePicker')!
    .props.onChange('2026-11-01');
  await all(render().find((n) => n.type === 'Sheet')!.props.foot)
    .find((n) => n.type === 'button' && n.children.includes('family.member.save'))!
    .props.onClick();
  assert.equal(saved!.share!.members[0].fee, 40);
  assert.deepEqual(
    saved!.share!.members[0].feeHistory!.map((p) => [p.from, p.fee]),
    [
      ['2025-10-14', 40],
      ['2026-11-01', 44],
    ],
  );
});

test('删除最后一笔收款清除对应覆盖；更晚的独立已付至继续保留', async () => {
  for (const paidUntil of ['2026-08-02', '2026-11-10']) {
    const member = {
      id: 'm',
      name: 'Member',
      share: 7,
      fee: 44,
      feeCurrency: 'CNY',
      billEvery: 6,
      joined: '2025-10-14',
      paidUntil,
      payments: [{ date: '2026-02-03', amount: 44, currency: 'CNY', from: '2026-02-03', until: '2026-08-02' }],
    };
    const sub: Subscription = {
      id: 's',
      name: 'Plan',
      category: 'Tools',
      tags: [],
      price: 15,
      currency: 'USD',
      start: '2025-10-14',
      cycle: { unit: 'month', every: 1 },
      status: 'active',
      share: { role: 'owner', seats: 6, collectFrom: '2025-10-14', members: [member] },
    };
    let saved: Subscription | undefined;
    const r = harness(
      '../app/src/views/Members.tsx',
      'MemberSheet',
      {},
      {
        ...carpool,
        Sheet: 'Sheet',
        DatePicker: 'DatePicker',
        Toggle: 'Toggle',
        CurrencySelect: 'CurrencySelect',
        NumInput: 'NumInput',
        getState: () => ({ ...st, subscriptions: [sub] }),
        run: (fn: () => Promise<unknown>) => fn(),
        saveSub: async (s: Subscription) => {
          saved = s;
        },
      },
    );
    r.render('MemberSheet', { state: st, s: sub, member, onClose() {} })
      .find((n) => n.type === 'button' && n.props['aria-label'] === 'family.member.removePayAria')!
      .props.onClick();
    await Promise.resolve();
    assert.equal(saved!.share!.members[0].payments!.length, 0);
    assert.equal(saved!.share!.members[0].paidUntil, paidUntil === '2026-11-10' ? paidUntil : undefined);
  }
});

test('合租备注仅上移共有次数/周期，保留不同次数、周期、自由备注和缺失备注', () => {
  const r = harness('../app/src/views/Carpool.tsx', 'receiptNotes');
  const split = (...notes: (string | undefined)[]) => r.call('receiptNotes', notes);
  assert.deepEqual(split('第12次收款（半年）', '第12次收款（半年）'), { common: '第12次收款 · 半年', rows: ['', ''] });
  assert.deepEqual(split('第12次收款（半年）· 银行转账', '第12次收款（季度）· 现金'), {
    common: '第12次收款',
    rows: ['半年 · 银行转账', '季度 · 现金'],
  });
  assert.deepEqual(split('第12次收款（半年）', '第3次收款（半年）'), { common: '半年', rows: ['第12次收款', '第3次收款'] });
  assert.deepEqual(split('第12次收款（半年）', undefined), { common: '', rows: ['第12次收款（半年）', ''] });
  // 备注用中文分号接在次数后面时，上移共有部分后不留前导分号
  assert.deepEqual(split('第12次收款（半年）；实收待核对', '第12次收款（半年）'), { common: '第12次收款 · 半年', rows: ['实收待核对', ''] });
  assert.deepEqual(split('第12次收款（半年）', '第3次收款（季度）'), { common: '', rows: ['第12次收款（半年）', '第3次收款（季度）'] });
  assert.deepEqual(split('Collection #12 (6 months): bank', 'Collection #12 (6 months): cash'), {
    common: 'Collection #12 · 6 months',
    rows: ['bank', 'cash'],
  });
  assert.deepEqual(split('银行转账', '已抵扣优惠'), { common: '', rows: ['银行转账', '已抵扣优惠'] });
});

test('合租收付款默认折叠，分组独立切换，表头在部分展开时全部展开并可全部收起', () => {
  const sub: Subscription = {
    id: 'car',
    name: 'Fictional six-seat plan',
    category: 'Tools',
    tags: [],
    start: '2024-01-17',
    status: 'active',
    price: 240,
    currency: 'CNY',
    cycle: { unit: 'month', every: 6 },
    share: {
      role: 'owner',
      seats: 6,
      since: '2024-01-17',
      members: [
        {
          id: 'a',
          name: 'A',
          share: 40,
          billEvery: 6,
          payments: [
            { date: '2026-01-17', from: '2026-01-17', until: '2026-07-16', amount: 40, currency: 'CNY', note: '第5次收款（半年）' },
            { date: '2025-07-17', from: '2025-07-17', until: '2026-01-16', amount: 0, currency: 'CNY', note: '第4次收款（半年）' },
          ],
        },
        {
          id: 'b',
          name: 'B',
          share: 40,
          billEvery: 3,
          joined: '2025-03-01',
          payments: [{ date: '2026-01-18', from: '2026-01-17', until: '2026-07-16', amount: -5, currency: 'USD', note: '第5次收款（季度）' }],
        },
      ],
    },
  };
  const state = { ...st, subscriptions: [sub] };
  const r = harness(
    '../app/src/views/Carpool.tsx',
    'CarSheet',
    {},
    { ...carpool, Sheet: 'Sheet', NameLink: 'NameLink', StatusPill: 'StatusPill', perBill: () => '', createPortal: () => null },
  );
  const props = { state, s: sub, today, ro: false, book: carpool.carLedger(state, sub, today), onClose() {}, onOpenSub() {}, onMember() {} };
  const render = () => r.render('CarSheet', props);
  const groups = (nodes: Node[]) => nodes.filter((n) => n.props.className === 'ld-row car-period');
  const head = (nodes: Node[]) => nodes.find((n) => n.props.className === 'ld-row ld-th car-ledger-head')!;
  const details = (nodes: Node[]) => nodes.filter((n) => n.props.className === 'ld-row');
  let nodes = render();
  assert.equal(groups(nodes).length, 2);
  assert.ok(groups(nodes).every((g) => g.type === 'button' && g.props['aria-expanded'] === false));
  assert.equal(head(nodes).props['aria-expanded'], false);
  assert.equal(head(nodes).props['aria-label'], 'family.sheet.member · family.sheet.date · family.sheet.amount · family.sheet.expandAll');
  assert.equal(all(head(nodes).children).filter((n) => n.type === 'small').length, 0);
  assert.equal(all(head(nodes).children).filter((n) => n.type === 'Icon').length, 0);
  assert.ok(groups(nodes).every((g) => g.props['aria-label'] && !all(g.children).some((n) => n.type === 'Icon')));
  assert.deepEqual(
    head(nodes).children.map((n: Node) => n.children.join('')),
    ['family.sheet.member', 'family.sheet.date', 'family.sheet.amount'],
  );
  assert.equal(details(nodes).length, 0);
  groups(nodes)[0].props.onClick();
  nodes = render();
  assert.deepEqual(
    groups(nodes).map((g) => g.props['aria-expanded']),
    [true, false],
  );
  assert.equal(details(nodes).length, 2);
  assert.ok(nodes.some((n) => n.children.includes('半年')));
  assert.ok(nodes.some((n) => n.children.includes('季度')));
  assert.equal(nodes.filter((n) => n.children.includes('第5次收款')).length, 1);
  head(nodes).props.onClick();
  nodes = render();
  assert.equal(details(nodes).length, 3);
  assert.equal(head(nodes).props['aria-expanded'], true);
  assert.ok(head(nodes).props['aria-label'].endsWith('family.sheet.collapseAll'));
  assert.equal(all(head(nodes).children).filter((n) => n.type === 'Icon').length, 0);
  head(nodes).props.onClick();
  nodes = render();
  assert.equal(details(nodes).length, 0);
  nodes.find((n) => n.type === 'Seg')!.props.onChange('out');
  nodes = render();
  assert.equal(groups(nodes).length, 3);
  assert.ok(groups(nodes).every((g) => g.props['aria-label'] && !all(g.children).some((n) => n.type === 'Icon')));
  assert.deepEqual(
    head(nodes).children.map((n: Node) => n.children.join('')),
    ['family.sheet.chargeDate', 'proxy.table.charged', 'proxy.table.cost'],
  );
  assert.equal(details(nodes).length, 0);
  groups(nodes)[1].props.onClick();
  nodes = render();
  assert.deepEqual(
    groups(nodes).map((g) => g.props['aria-expanded']),
    [false, true, false],
  );
  head(nodes).props.onClick();
  nodes = render();
  assert.equal(details(nodes).length, 6);
  assert.equal(head(nodes).props['aria-expanded'], true);
  head(nodes).props.onClick();
  assert.equal(details(render()).length, 0);
  // 单组也折叠；只读状态不阻止查看历史，空记录不提供无效的全部展开操作。
  const single = {
    ...sub,
    start: '2026-01-17',
    share: { ...sub.share!, members: [{ ...sub.share!.members[0], payments: [sub.share!.members[0].payments![0]] }] },
  };
  const fresh = harness(
    '../app/src/views/Carpool.tsx',
    'CarSheet',
    {},
    { ...carpool, Sheet: 'Sheet', NameLink: 'NameLink', StatusPill: 'StatusPill', perBill: () => '', createPortal: () => null },
  );
  nodes = fresh.render('CarSheet', { ...props, s: single, ro: true });
  assert.equal(groups(nodes).length, 1);
  assert.ok(groups(nodes).every((g) => g.props['aria-expanded'] === false && !g.props.disabled));
  nodes = fresh.render('CarSheet', { ...props, s: { ...single, share: { ...single.share!, members: [] } } });
  assert.equal(head(nodes).props.disabled, true);
  assert.equal(head(nodes).props['aria-expanded'], false);
});

test('合租分组以覆盖区间为主标题，共有信息为可选副标题，差异信息留在行内', () => {
  for (const { notes, common, rows } of [
    { notes: ['第6次收款（半年）', '第6次收款（半年）'], common: '第6次收款 · 半年', rows: ['', ''] },
    { notes: ['第6次收款（半年）', '第2次收款（半年）· 抵扣调整'], common: '半年', rows: ['第6次收款', '第2次收款 · 抵扣调整'] },
    { notes: ['第6次收款（半年）', undefined], common: '', rows: ['第6次收款（半年）', ''] },
  ]) {
    const sub: Subscription = {
      id: 'car',
      name: 'Fictional plan',
      category: 'Tools',
      tags: [],
      start: '2026-01-17',
      status: 'active',
      price: 240,
      currency: 'CNY',
      cycle: { unit: 'month', every: 6 },
      share: {
        role: 'owner',
        seats: 3,
        members: notes.map((note, i) => ({
          id: String(i),
          name: `Member ${i}`,
          share: 40,
          billEvery: 6,
          payments: [{ date: '2026-07-17', from: '2026-07-17', until: '2027-01-16', amount: 40, currency: 'CNY', note }],
        })),
      },
    };
    const state = { ...st, subscriptions: [sub] };
    const r = harness(
      '../app/src/views/Carpool.tsx',
      'CarSheet',
      {},
      { ...carpool, Sheet: 'Sheet', NameLink: 'NameLink', StatusPill: 'StatusPill', perBill: () => '', createPortal: () => null },
    );
    const props = { state, s: sub, today, ro: true, book: carpool.carLedger(state, sub, today), onClose() {}, onOpenSub() {}, onMember() {} };
    let nodes = r.render('CarSheet', props);
    const title = nodes.find((n) => n.props.className === 'car-period-title')!;
    assert.deepEqual(
      all(title.children)
        .filter((n) => n.type === 'b')
        .map((n) => n.children.join('')),
      [`${format.cnDateFull('2026-07-17')} – ${format.cnDateFull('2027-01-16')}`],
    );
    assert.deepEqual(
      all(title.children)
        .filter((n) => n.type === 'small')
        .map((n) => n.children.join('')),
      common ? [common] : [],
    );
    nodes.find((n) => n.props.className === 'ld-row car-period')!.props.onClick();
    nodes = r.render('CarSheet', props);
    assert.deepEqual(
      nodes
        .filter((n) => n.props.className === 'ld-row')
        .map((n) =>
          all(n.children[0])
            .filter((child) => child.type === 'small')
            .map((child) => child.children.join(''))
            .join(''),
        ),
      rows,
    );
    nodes.find((n) => n.type === 'Seg')!.props.onChange('out');
    nodes = r.render('CarSheet', props);
    const yearTitle = nodes.find((n) => n.props.className === 'car-period-title')!;
    assert.equal(all(yearTitle.children).filter((n) => n.type === 'b').length, 1);
    assert.equal(all(yearTitle.children).filter((n) => n.type === 'small').length, 0);
  }
});

test('person avatar drafts remain unsaved until Save; server field order does not leave Save enabled', async () => {
  const people = await import('./people.ts');
  const state = { ...st, people: [{ id: 'person', name: 'Fictional person', color: 'blue' as const }] };
  const avatar = 'data:image/webp;base64,fixture';
  let writes = 0;
  const r = harness(
    '../app/src/views/People.tsx',
    'PersonSheet',
    {},
    {
      ...people,
      PERSON_COLORS,
      Sheet: 'Sheet',
      ContactField: 'ContactField',
      contactText: () => '',
      compressAvatar: async () => avatar,
      ask: async () => true,
      run: (fn: () => Promise<unknown>) => fn(),
      savePerson: async (p: (typeof state.people)[number]) => {
        writes++;
        // Simulate normalized server field order and an added timestamp.
        const saved = { name: p.name, createdAt: '2026-10-22', ...p };
        state.people = [saved];
        return saved;
      },
    },
  );
  const render = () => r.render('PersonSheet', { state, today, l: { person: state.people[0], items: [], owed: 0, received: 0 }, onClose() {}, onOpen() {} });
  const walkFoot = (n: Node): Node[] => all(n.props.foot);
  const save = () =>
    render()
      .filter((n) => n.type === 'Sheet')
      .flatMap(walkFoot)
      .find((n) => n.type === 'button' && n.props.className === 'btn primary')!;
  assert.equal(save().props.disabled, true);
  render()
    .find((n) => n.type === 'input' && n.props.type === 'file')!
    .props.onChange({ target: { files: [{}], value: '' } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(writes, 0);
  assert.equal(save().props.disabled, false);
  await save().props.onClick();
  assert.equal(writes, 1);
  assert.equal(save().props.disabled, true);
  const remove = render().find((n) => n.type === 'button' && n.children.includes('people.avatar.remove'))!;
  await remove.props.onClick();
  assert.equal(writes, 1);
  assert.equal(save().props.disabled, false);
  await save().props.onClick();
  assert.equal(writes, 2);
  assert.equal(save().props.disabled, true);
});

test('合租表格的收费弹窗：已付期按开始日自动算结束日；改自定义收费从生效日起记调价', async () => {
  const member = { id: 'm', name: 'Member', share: 7, fee: 44, feeCurrency: 'CNY', billEvery: 6, joined: '2025-01-17', paidUntil: '2026-07-16' };
  const sub: Subscription = {
    id: 's',
    name: 'Plan',
    category: 'Tools',
    tags: [],
    price: 15,
    currency: 'USD',
    start: '2025-01-17',
    cycle: { unit: 'month', every: 1 },
    status: 'active',
    share: { role: 'owner', seats: 6, collectFrom: '2025-01-17', members: [member] },
  };
  let saved: Subscription | undefined;
  const r = harness(
    '../app/src/views/Members.tsx',
    'MemberBillingSheet',
    {},
    {
      ...carpool,
      Sheet: 'Sheet',
      DatePicker: 'DatePicker',
      CurrencySelect: 'CurrencySelect',
      NumInput: 'NumInput',
      PersonAvatar: 'PersonAvatar',
      personFor: () => undefined,
      todayIn: () => today,
      getState: () => ({ ...st, subscriptions: [sub] }),
      run: (fn: () => Promise<unknown>) => fn(),
      saveSub: async (s: Subscription) => {
        saved = s;
      },
    },
  );
  const render = () => r.render('MemberBillingSheet', { state: st, s: sub, member, onClose() {}, onMore() {} });
  const save = async () =>
    all(render().find((n) => n.type === 'Sheet')!.props.foot)
      .find((n) => n.type === 'button' && n.children.includes('family.member.save'))!
      .props.onClick();
  // 跟随车，已付期从已付至倒推：2026-01-17 起
  assert.equal(render().find((n) => n.type === 'DatePicker' && n.props.value === '2026-01-17') != null, true);
  render()
    .find((n) => n.type === 'DatePicker' && n.props.value === '2026-01-17')!
    .props.onChange('2026-07-17');
  assert.ok(
    all(render().find((n) => n.type === 'Cell' && n.props.label === 'family.quick.paidTo')!).some((n) => n.children.includes(format.cnDateFull('2027-01-16'))),
  );
  await save();
  assert.equal(saved!.share!.members[0].paidUntil, '2027-01-16');

  render()
    .find((n) => n.type === 'Seg' && n.props.value === 'follow')!
    .props.onChange('custom');
  render()
    .find((n) => n.type === 'NumInput' && n.props.value === 44)!
    .props.onValue(50);
  await save();
  const m = saved!.share!.members[0];
  assert.equal(m.custom, true);
  assert.equal(m.fee, 50);
  assert.deepEqual(m.feeHistory!.at(-1)!.from, today);
});

test('行尾删除需二次确认：第一次点只展开「确认」，第二次才删除；未保存条目直接删除', async () => {
  const g = globalThis as { matchMedia?: unknown };
  const had = g.matchMedia;
  g.matchMedia = () => ({ matches: true });
  try {
    let removed = 0;
    const r = harness('../app/src/components/RowActions.tsx', 'RowActions', {}, { IconButton: 'IconButton', useEffect() {} });
    const props = { onEdit() {}, editLabel: 'edit', removeLabel: 'remove', confirmLabel: 'confirm', onRemove: () => removed++ };
    const button = () =>
      all(r.render('RowActions', props))
        .filter((n) => n.type === 'IconButton')
        .at(-1)!;
    assert.equal(button().props['aria-label'], 'remove');
    button().props.onClick();
    assert.equal(removed, 0);
    assert.equal(button().props['aria-label'], 'confirm');
    // 失焦收回
    button().props.onBlur();
    assert.equal(button().props['aria-label'], 'remove');
    button().props.onClick();
    button().props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(removed, 1);

    let direct = 0;
    const single = harness('../app/src/components/RowActions.tsx', 'RowActions', {}, { IconButton: 'IconButton', useEffect() {} });
    all(single.render('RowActions', { removeLabel: 'remove', confirmLabel: 'confirm', onRemove: () => direct++ }))
      .find((n) => n.type === 'IconButton')!
      .props.onClick();
    assert.equal(direct, 1);
  } finally {
    g.matchMedia = had;
  }
});

test('停用说明里的金额单独着色：未退款损失为红色，已退款为绿色，无金额时只有文字', () => {
  const render = (summary: unknown) => {
    const r = harness(
      '../app/src/components/StopPanel.tsx',
      'StopText',
      {},
      { stopSummary: () => summary, t: (key: string, p?: { money?: string }) => (p?.money ? `${key}[${p.money}]` : key) },
    );
    return r.render('StopText', { sub: { currency: 'USD' }, today });
  };
  const money = (nodes: Node[]) => all(nodes).find((n) => n.type === 'b');
  const loss = money(render({ date: '2026-10-01', refunded: 0, unusedValue: 0.67 }));
  assert.equal(loss!.props.className, 'stop-money loss');
  assert.deepEqual(loss!.children, ['−$0.67']);
  const gain = money(render({ date: '2026-10-01', refunded: 5, refundStatus: 'full', unusedValue: 0 }));
  assert.equal(gain!.props.className, 'stop-money gain');
  assert.equal(money(render({ date: '2026-10-01', refunded: 0, unusedValue: 0 })), undefined);
  assert.deepEqual(all(render({ date: '2099-01-01', refunded: 0, unusedValue: 1 })), []);
});
