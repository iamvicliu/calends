import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'oxc-transform-react';
import * as billing from './billing.ts';
import * as phases from './phases.ts';
import * as format from './format.ts';
import { flatten, setLocale, t } from './i18n.ts';
import { DEFAULT_SETTINGS, type Subscription } from './types.ts';

const messages = {};
for (const ns of ['core', 'common', 'editor', 'list'])
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
function runtime(file: string, extra: Record<string, unknown>) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/^import[\s\S]*?;\n/gm, '');
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
    useEffectEvent: (fn: unknown) => fn,
    ...billing,
    ...phases,
    ...format,
    t,
    Cell: 'Cell',
    Picker: 'Picker',
    CurrencySelect: 'CurrencySelect',
    DatePicker: 'DatePicker',
    Fragment: 'Fragment',
    Seg: 'Seg',
    Icon: 'Icon',
    SubIcon: 'SubIcon',
    FlagImg: 'FlagImg',
    ...extra,
  };
  const exports = new Function(
    ...Object.keys(deps),
    `${result.code.replace(/export /g, '')}; return ${file.includes('StopPanel') ? '{StopPanel, stopLabel, stopDescription}' : '{Gantt}'};`,
  )(...Object.values(deps));
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

test('真实甘特结构：同高灰色虚线、停用标记、主动结束标记、退款点与公开视图', () => {
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
    assert.equal(withClass(nodes, 'gt-stop-end').length, 0);
    if (amount !== 31) {
      const unused = withClass(nodes, 'gt-unused')[0];
      assert.equal(unused.props.style.top, withClass(nodes, 'gt-seg')[0].props.style.top);
      assert.ok(unused.props.style.width > 0);
      assert.ok(unused.props.title.includes('abuse'));
    }
    assert.equal(withClass(nodes, 'refund').length, amount == null ? 0 : 1);
    assert.equal(withClass(render(stopped, true), 'gt-unused').length, 0);
  }
  const cancelled = render(phases.stopSubscription(sub, today, 'cancel'));
  assert.equal(withClass(cancelled, 'gt-stop-end').length, 1);
  assert.equal(withClass(cancelled, 'gt-stop').length, 0);
});
