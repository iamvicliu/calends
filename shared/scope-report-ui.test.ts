import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'oxc-transform-react';
import * as billing from './billing.ts';
import * as format from './format.ts';
import * as fx from './fx.ts';
import * as reports from './scope-report.ts';
import { cancelSavings } from './metrics.ts';
import { DEFAULT_SETTINGS, type AppState } from './types.ts';

// Execute component event handlers in the existing JSX harness, retaining pure financial builders.
type Node = { type: string; props: Record<string, any>; children: unknown[] };
const all = (n: unknown): Node[] =>
  Array.isArray(n) ? n.flatMap(all) : n && typeof n === 'object' && 'type' in n ? [n as Node, ...all((n as Node).children)] : [];
const st: AppState = { subscriptions: [], methods: [], settings: DEFAULT_SETTINGS, fx: billing.FALLBACK_FX };
const today = '2026-10-22';
function harness(file: string, names: string, prefs: Record<string, string> = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/^import[\s\S]*?;\n/gm, '');
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
    cancelSavings,
    locale: () => 'en',
    useOrig: () => false,
    categories: () => [],
    Picker: 'Picker',
    t: (key: string) => key,
    useMemo: (fn: () => unknown) => fn(),
    useEffect: (fn: () => unknown) => fn(),
    useState(initial: unknown) {
      const i = cursor++;
      if (!(i in values)) values[i] = initial;
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
    Toolbar: 'Toolbar',
    ScopeReport: 'ScopeReport',
    Maximize2: 'Maximize2',
    SpendingDelta: 'SpendingDelta',
  };
  const exports = new Function(...Object.keys(deps), `${result.code.replace(/export /g, '')}; return {${names}};`)(...Object.values(deps));
  return {
    prefs,
    keys,
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
