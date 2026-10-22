import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'oxc-transform-react';
import * as billing from './billing.ts';
import * as phases from './phases.ts';
import * as format from './format.ts';
import * as gantt from './gantt.ts';
import * as metrics from './metrics.ts';
import { flatten, intlLocale, setLocale, t } from './i18n.ts';
import { DEFAULT_SETTINGS, type Subscription } from './types.ts';

const messages = {};
for (const ns of ['core', 'common', 'editor', 'list', 'detail', 'overview', 'report'])
  flatten(ns, JSON.parse(readFileSync(new URL(`./locales/en/${ns}.json`, import.meta.url), 'utf8')), messages);
setLocale('en', [messages]);
const today = '2026-10-19';
const sub: Subscription = {
  id: 's',
  name: 'Service',
  category: 'tools',
  tags: [],
  price: 31,
  currency: 'USD',
  start: '2026-10-05',
  cycle: { unit: 'month', every: 1 },
  status: 'active',
};
type Element = { type: string; props: Record<string, any>; children: unknown[] };
const all = (node: unknown): Element[] =>
  Array.isArray(node) ? node.flatMap(all) : node && typeof node === 'object' && 'type' in node ? [node as Element, ...all((node as Element).children)] : [];
const React = {
  Fragment: 'Fragment',
  createElement(type: string, props: Element['props'], ...children: unknown[]) {
    return { type, props: props ?? {}, children };
  },
};
function runtime(file: string, extra: Record<string, unknown>, names = file.includes('StopPanel') ? 'StopPanel, stopLabel, stopDescription' : 'Gantt') {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replace(/^export \{.*\};\n/gm, '');
  const result = transformSync(file, source, { lang: 'tsx', jsx: { runtime: 'classic' }, reactCompiler: false });
  assert.equal(result.fatal, false);
  const values: unknown[] = [];
  let cursor = 0;
  const deps = {
    React,
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
    useRef(initial: unknown) {
      return { current: initial };
    },
    useMemo(fn: () => unknown) {
      return fn();
    },
    useEffect() {},
    useLayoutEffect() {},
    useSyncExternalStore: (_subscribe: unknown, _get: unknown, server: () => unknown) => server(),
    useEffectEvent: (fn: unknown) => fn,
    ...billing,
    ...phases,
    ...format,
    ...gantt,
    ...metrics,
    t,
    intlLocale,
    Cell: 'Cell',
    Picker: 'Picker',
    CurrencySelect: 'CurrencySelect',
    DatePicker: 'DatePicker',
    Fragment: 'Fragment',
    Seg: 'Seg',
    Icon: 'Icon',
    Hint: 'Hint',
    SubIcon: 'SubIcon',
    FlagImg: 'FlagImg',
    ...extra,
  };
  const exports = new Function(...Object.keys(deps), `${result.code.replace(/export /g, '')}; return {${names}};`)(...Object.values(deps));
  return {
    exports,
    render(name: string, props: unknown) {
      cursor = 0;
      return exports[name](props);
    },
  };
}

test('真实停止表单：三种模式、日期默认值、币种锁定、按天预填、超额拒绝、实退和恢复权限', () => {
  const applied: Subscription[] = [];
  const errors: string[] = [];
  const r = runtime('../app/src/components/StopPanel.tsx', { toast: (message: string) => errors.push(message) });
  const render = (s = sub) => all(r.render('StopPanel', { sub: s, today, onApply: (value: Subscription) => applied.push(value) }));
  let nodes = render();
  const mode = nodes.find((e) => e.type === 'Picker' && e.props.ariaLabel === t('core.stop.title'))!;
  assert.equal(mode.props.options.length, 3);
  assert.equal(nodes.find((e) => e.type === 'DatePicker')!.props.value, '2026-11-04');
  mode.props.onChange('terminate');
  nodes = render();
  assert.equal(nodes.find((e) => e.type === 'DatePicker')!.props.value, today);
  const cell = (label: string) => nodes.find((e) => e.type === 'Cell' && e.props.label === label)!;
  all(cell(t('core.stop.reason')))[1].props.onChange({ target: { value: 'abuse' } });
  nodes.find((e) => e.type === 'Picker' && e.props.ariaLabel === t('editor.payment.kind.refund'))!.props.onChange('yes');
  nodes = render();
  const amount = all(cell(`${t('core.stop.refundAmount')} · USD`)).find((e) => e.type === 'input')!;
  assert.equal(amount.props.value, '16');
  // 唯一可选币种属于卡上实退，订阅退款币种没有选择器。
  assert.equal(nodes.filter((e) => e.type === 'CurrencySelect').length, 1);
  amount.props.onChange({ target: { value: '32' } });
  nodes = render();
  nodes.find((e) => e.type === 'button' && e.children.includes(t('common.apply')))!.props.onClick();
  assert.equal(applied.length, 0);
  assert.equal(errors.at(-1), t('mcp.error.refundExceedsPaid'));
  amount.props.onChange({ target: { value: '6' } });
  all(cell(t('editor.payment.settledAmount')))
    .find((e) => e.type === 'input')!
    .props.onChange({ target: { value: '40' } });
  nodes.find((e) => e.type === 'CurrencySelect')!.props.onChange('CNY');
  nodes = render();
  nodes.find((e) => e.type === 'button' && e.children.includes(t('common.apply')))!.props.onClick();
  const saved = applied[0];
  assert.equal(saved.stop!.reason, 'abuse');
  assert.equal(saved.payments!.at(-1)!.amount, -6);
  assert.deepEqual(saved.payments!.at(-1)!.settled, { amount: -40, currency: 'CNY' });
  assert.ok(!render(saved).some((e) => e.type === 'button' && e.children.includes(t('core.stop.restore'))));
  const cancelled = phases.stopSubscription(sub, today, 'cancel');
  const restore = render(cancelled).find((e) => e.type === 'button' && e.children.includes(t('core.stop.restore')))!;
  restore.props.onClick();
  assert.equal(applied.at(-1)!.stop, undefined);
  assert.equal(applied.at(-1)!.end, undefined);
});

test('真实甘特结构：未退款段接在实线后、红色停用标记、退款点与公开视图', () => {
  const stop = runtime('../app/src/components/StopPanel.tsx', { toast() {} }).exports;
  const r = runtime('../app/src/views/Gantt.tsx', {
    usePref: (_key: string, initial: unknown) => [initial, () => {}],
    useWidth: () => [() => {}, 600],
    perLabel: () => 'mo',
    stopDescription: stop.stopDescription,
  });
  const render = (s: Subscription, readonly = false) =>
    all(
      r.render('Gantt', {
        rows: [s],
        state: { subscriptions: [s], methods: [], settings: DEFAULT_SETTINGS, fx: billing.FALLBACK_FX, readonly },
        today,
        onOpen() {},
      }),
    );
  const withClass = (nodes: Element[], cls: string) =>
    nodes.filter((e) =>
      String(e.props.className ?? '')
        .split(' ')
        .includes(cls),
    );
  for (const amount of [undefined, 6, 31]) {
    const stopped = phases.stopSubscription(sub, today, 'terminate', today, 'abuse', amount == null ? undefined : { amount });
    const nodes = render(stopped);
    assert.equal(withClass(nodes, 'gt-unused').length, amount === 31 ? 0 : 1);
    assert.equal(withClass(nodes, 'gt-stop').length, 1);
    if (amount !== 31) {
      const unused = withClass(nodes, 'gt-unused')[0];
      assert.equal(unused.props.style.top, withClass(nodes, 'gt-seg')[0].props.style.top);
      // 被服务方停用：实线末端是与条同高的停用标志（圆形端头），灰段起点藏在标志下半个圆
      assert.equal(withClass(nodes, 'joined').length, 0);
      const stop = withClass(nodes, 'gt-stop')[0];
      assert.equal(stop.props.style.top, unused.props.style.top);
      assert.equal(unused.props.style.left, stop.props.style.left + 9);
      assert.ok(unused.props.style.width > 0);
      assert.ok(unused.props.title.includes('abuse'));
    }
    assert.equal(withClass(nodes, 'refund').length, amount == null ? 0 : 1);
    assert.equal(withClass(render(stopped, true), 'gt-unused').length, 0);
  }
  const cancelled = render(phases.stopSubscription(sub, today, 'cancel'));
  // 主动退订不加额外标记，只有服务方停用才有禁止标志
  assert.equal(withClass(cancelled, 'gt-stop').length, 0);
  assert.equal(withClass(cancelled, 'gt-unused').length, 1);
  // 主动退订：实线最后一截改直角，与未退款段拼成一根
  assert.equal(withClass(cancelled, 'joined').length, 1);
});

const text = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node == null || typeof node === 'boolean') return '';
  return typeof node === 'object' ? text((node as Element).children) : String(node);
};
const renderedReact = {
  ...React,
  createElement(type: string | ((props: any) => unknown), props: Element['props'], ...children: unknown[]) {
    return typeof type === 'function' ? type({ ...props, children }) : React.createElement(type, props, ...children);
  },
};
const withClass = (node: unknown, cls: string) =>
  all(node).filter((e) =>
    String(e.props.className ?? '')
      .split(' ')
      .includes(cls),
  );

// 使用真实 Outcome / Statement，执行组件树；仅替换宿主、Hooks 和不相关的可视化。
test('详情停止卡片：无 stop 完全不渲染；仅正损失显示红色金额；全额退款、零损失和公开视图隐藏损失', () => {
  const r = runtime(
    '../app/src/views/Detail.tsx',
    {
      React: renderedReact,
      catColor: () => '#777',
      CatIcon: 'CatIcon',
      PayBadge: 'PayBadge',
    },
    'Outcome',
  );
  const render = (s: Subscription, readonly = false) =>
    r.render('Outcome', {
      sub: s,
      today,
      state: { subscriptions: [s], methods: [], settings: DEFAULT_SETTINGS, fx: billing.FALLBACK_FX, readonly },
    });
  for (const s of [sub, { ...sub, status: 'cancelled' as const, end: today }]) {
    assert.equal(withClass(render(s), 'dt-outcome').length, 0);
  }
  for (const kind of ['cancel', 'terminate'] as const) {
    for (const amount of [undefined, 6, 16, 31]) {
      const s = phases.stopSubscription(
        sub,
        today,
        kind,
        today,
        kind === 'terminate' ? 'Provider closure' : undefined,
        amount == null ? undefined : { amount },
      );
      const tree = render(s);
      const section = withClass(tree, 'dt-outcome');
      assert.equal(section.length, 1);
      const summary = billing.stopSummary(s, today)!;
      assert.ok(text(section).includes(format.cnDateFull(today)));
      assert.ok(text(section).includes(format.cnDateFull(summary.paidThrough)));
      assert.ok(text(section).includes(t(kind === 'terminate' ? 'core.stop.terminate' : 'report.stops.cancel')));
      assert.equal(text(section).includes('Provider closure'), kind === 'terminate');
      assert.equal(withClass(section, 'dt-oc-loss').length, summary.unusedValue > 0 ? 1 : 0);
      if (summary.unusedValue > 0) {
        assert.ok(text(section).includes(t('core.stop.lossTitle')));
        assert.ok(text(section).includes(`−${format.money(summary.unusedValue, 'USD')}`));
        assert.ok(text(section).includes(t('core.stop.lossDays', { count: summary.wastedDays })));
      } else {
        assert.ok(text(section).includes(t('core.stop.fullyRefunded')));
        assert.ok(!text(section).includes(t('core.stop.lossTitle')));
      }
      if (amount == null) assert.ok(text(section).includes(t('core.stop.refundNo')));
      else {
        assert.ok(text(section).includes(t(summary.refundStatus === 'full' ? 'core.stop.fullyRefunded' : 'core.stop.partial', { money: '' }).trim()));
        assert.ok(!text(section).includes(format.flow(amount, 'USD')), 'a single refund amount is owned by the charge record');
      }
      assert.equal(withClass(render(s, true), 'dt-outcome').length, 0);
    }
  }
  const free = phases.stopSubscription({ ...sub, price: 0 }, today, 'cancel');
  assert.equal(withClass(render(free), 'dt-outcome').length, 1);
  assert.equal(withClass(render(free), 'dt-oc-loss').length, 0);
  assert.ok(!text(render(free)).includes(t('core.stop.fullyRefunded')));
});

test('详情历史阶段：各停止阶段使用自己的退款、币种、停止日期，当前未停止的阶段不混入', () => {
  const r = runtime('../app/src/views/Detail.tsx', { React: renderedReact }, 'Outcome');
  const first = phases.stopSubscription(sub, today, 'terminate', today, 'Provider closure', { amount: 6 });
  const second = phases.stopSubscription({ ...sub, start: '2026-11-05', currency: 'EUR', price: 60 }, '2026-11-19', 'cancel', '2026-11-19', undefined, {
    amount: 32,
  });
  const multi = { ...sub, phases: [first, second, { ...sub, start: '2026-12-05', currency: 'JPY', price: 3000 }] };
  const tree = r.render('Outcome', {
    sub: multi,
    today: '2026-12-10',
    state: { subscriptions: [multi], methods: [], settings: DEFAULT_SETTINGS, fx: billing.FALLBACK_FX },
  });
  assert.equal(withClass(tree, 'dt-outcome').length, 2);
  assert.equal(withClass(tree, 'dt-oc-loss').length, 1);
  assert.ok(text(tree).includes(`−${format.money(10, 'USD')}`));
  assert.ok(!text(tree).includes(format.flow(32, 'EUR')), 'a single historical refund is not repeated in the outcome card');
  assert.ok(text(tree).includes(t('core.stop.fullyRefunded')));
  assert.ok(text(tree).includes(format.cnDateFull('2026-11-19')));
  assert.ok(!text(tree).includes(format.cnDateFull('2026-12-05')));
});

test('概览今年已付附注：只计今年停止的损失；零、全退和只读隐藏，预留位置且可点按跳报告', () => {
  const navigations: string[] = [];
  let scrolls = 0;
  const r = runtime(
    '../app/src/views/Overview.tsx',
    {
      React: renderedReact,
      // 这两项只影响已付总额，损失筛选仍使用真实 stopLosses。
      allCharges: () => [],
      sumBase: () => 0,
      packCircles: () => [],
      Amount: 'Amount',
      go: (route: string) => navigations.push(route),
      requestAnimationFrame: (cb: () => void) => cb(),
      document: { getElementById: () => ({ scrollIntoView: () => scrolls++ }) },
    },
    'Statement',
  );
  const old = phases.stopSubscription({ ...sub, id: 'old', start: '2025-10-05' }, '2025-10-19', 'cancel');
  const current = phases.stopSubscription({ ...sub, id: 'current' }, today, 'terminate', today, 'Provider closure', { amount: 6 });
  const full = phases.stopSubscription(sub, today, 'cancel', today, undefined, { amount: 16 });
  const future = phases.stopSubscription({ ...sub, id: 'future' }, '2026-10-25', 'cancel');
  const render = (subscriptions: Subscription[], readonly = false) =>
    r.render('Statement', {
      state: { subscriptions, methods: [], settings: DEFAULT_SETTINGS, fx: billing.FALLBACK_FX, readonly },
      today,
      onOpen() {},
    });
  for (const subscriptions of [[old], [], [full], [future], [old, full, future]]) {
    const tree = render(subscriptions);
    assert.equal(withClass(tree, 'stmt-loss-note').length, 0);
    assert.ok(!text(tree).includes(t('overview.stmt.loss')));
    assert.equal(withClass(tree, 'stmt-paid-note').length, 1);
  }
  const tree = render([old, current, future]);
  const note = withClass(tree, 'stmt-loss-note')[0];
  assert.ok(text(note).includes(t('overview.stmt.loss')));
  assert.ok(
    text(note).includes(
      format.money(
        metrics.stopLosses({ subscriptions: [current], methods: [], settings: DEFAULT_SETTINGS, fx: billing.FALLBACK_FX }, today).total,
        DEFAULT_SETTINGS.baseCurrency,
        { compact: true },
      ),
    ),
  );
  const facts = withClass(tree, 'stmt-facts')[0];
  assert.equal((facts.children.filter((n) => n && typeof n === 'object') as Element[]).length, 4);
  const paid = (facts.children.filter((n) => n && typeof n === 'object') as Element[])[1];
  assert.ok(text(paid).includes(t('overview.stmt.ytd', { year: '2026' })));
  assert.equal(withClass(paid, 'stmt-loss-note').length, 1);
  assert.equal(note.type, 'button');
  assert.equal(note.props.type, 'button');
  note.props.onClick();
  assert.deepEqual(navigations, ['report']);
  assert.equal(scrolls, 1);
  assert.equal(withClass(render([current], true), 'stmt-loss-note').length, 0);
  const missing = render([phases.stopSubscription({ ...sub, currency: 'XYZ' }, today, 'cancel')]);
  assert.equal(withClass(missing, 'stmt-loss-note')[0].props.title, t('core.stop.fxMissing'));
});

test('时间轴金额：宽段显示紧凑负金额，窄段仅保留悬停说明，停用半圆避让且公开隐藏', () => {
  let width = 600;
  const stop = runtime('../app/src/components/StopPanel.tsx', { toast() {} }).exports;
  const r = runtime('../app/src/views/Gantt.tsx', {
    usePref: (_key: string, initial: unknown) => [initial, () => {}],
    useWidth: () => [() => {}, width],
    perLabel: () => 'mo',
    stopDescription: stop.stopDescription,
  });
  const render = (s: Subscription, readonly = false) =>
    r.render('Gantt', {
      rows: [s],
      state: { subscriptions: [s], methods: [], settings: DEFAULT_SETTINGS, fx: billing.FALLBACK_FX, readonly },
      today,
      onOpen() {},
    });
  for (const kind of ['cancel', 'terminate'] as const) {
    const s = phases.stopSubscription(sub, today, kind, today, kind === 'terminate' ? 'Provider closure' : undefined);
    width = 390;
    let tree = render(s);
    assert.equal(withClass(tree, 'gt-unused-amount').length, 0);
    assert.ok(withClass(tree, 'gt-unused')[0].props.title.includes(t('core.stop.lossTitle')));
    width = 2000;
    tree = render(s);
    assert.equal(withClass(tree, 'gt-unused-amount').length, 1);
    assert.equal(text(withClass(tree, 'gt-unused-amount')), `−${format.money(16, 'USD', { compact: true })}`);
    assert.equal(withClass(tree, 'gt-unused')[0].props.style.paddingLeft, kind === 'terminate' ? 9 : 0);
    assert.equal(withClass(render(s, true), 'gt-unused-amount').length, 0);
    // 同样宽度下，超长金额仍应隐藏而不是压到标志或被裁掉。
    assert.equal(withClass(render(phases.stopSubscription({ ...sub, price: 1234567890123 }, today, kind)), 'gt-unused-amount').length, 0);
    const full = phases.stopSubscription(sub, today, kind, today, undefined, { amount: 16 });
    assert.equal(withClass(render(full), 'gt-unused-amount').length, 0);
  }
  assert.ok(text(render(phases.stopSubscription(sub, today, 'cancel'))).includes(t('core.stop.unusedTitle')));
});
