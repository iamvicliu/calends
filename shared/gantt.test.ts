import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'oxc-transform-react';
import * as billing from './billing.ts';
import * as format from './format.ts';
import * as gantt from './gantt.ts';
import { LOCALES, flatten, intlLocale, setLocale, t } from './i18n.ts';
import { DEFAULT_SETTINGS, type Subscription } from './types.ts';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('时间窗口保留过去与未来空间，兼容月末、闰年和跨年', () => {
  assert.deepEqual(gantt.ganttWindow('3m', '2026-10-21'), { start: '2026-08-21', end: '2026-11-21' });
  assert.deepEqual(gantt.ganttWindow('6m', '2026-10-21'), { start: '2026-06-06', end: '2026-12-06' });
  assert.deepEqual(gantt.ganttWindow('1y', '2026-10-21'), { start: '2026-01-21', end: '2027-01-21' });
  assert.deepEqual(gantt.ganttWindow('3y', '2026-10-21'), { start: '2024-04-21', end: '2027-04-21' });
  assert.deepEqual(gantt.ganttWindow('all', '2026-10-21', '2021-07-18'), { start: '2021-07-01', end: '2027-04-21' });
  assert.deepEqual(gantt.ganttWindow('all', '2026-10-21'), { start: '2026-10-01', end: '2027-04-21' });
  assert.deepEqual(gantt.ganttWindow('3m', '2024-01-31'), { start: '2023-11-30', end: '2024-02-29' });
  for (const today of ['2024-02-29', '2025-01-31', '2026-08-31', '2026-12-31']) {
    for (const zoom of ['3m', '6m', '1y', '3y'] as const) {
      const { start, end } = gantt.ganttWindow(zoom, today);
      for (const d of [start, end]) assert.equal(billing.addDays(d, 0), d);
      const ratio = billing.diffDays(start, today) / billing.diffDays(start, end);
      assert.ok(ratio > 0.6 && ratio < 0.88, `${zoom} ${today}: ${ratio}`);
    }
    const half = gantt.ganttWindow('6m', today);
    assert.ok(billing.diffDays(half.start, half.end) >= 181 && billing.diffDays(half.start, half.end) <= 184);
  }
});

test('拖动吸附和翻页保留月份锚点，月末往返无漂移', () => {
  for (const base of ['2024-01-31', '2025-01-31', '2026-08-21', '2026-06-06']) {
    assert.equal(gantt.snapGanttPan(base, 0), 0);
    for (const raw of [-400, -48, -17, -5.2, 5.2, 17, 33, 390]) {
      const pan = gantt.snapGanttPan(base, raw);
      assert.ok(Math.abs(pan - raw) <= 16);
      assert.equal(gantt.snapGanttPan(base, pan), pan);
      assert.equal(billing.addDays(billing.addDays(base, pan), -pan), base);
    }
    for (const months of Object.values(gantt.GANTT_STEP)) {
      const next = gantt.stepGanttPan(base, 0, months);
      assert.equal(billing.addDays(base, next), billing.addMonths(base, months));
      assert.equal(gantt.stepGanttPan(base, next, -months), 0);
      const prev = gantt.stepGanttPan(base, 0, -months);
      assert.equal(gantt.stepGanttPan(base, prev, months), 0);
    }
  }
  assert.equal(billing.addDays('2024-01-31', gantt.snapGanttPan('2024-01-31', 28)), '2024-02-29');
  assert.equal(billing.addDays('2025-01-31', gantt.snapGanttPan('2025-01-31', 28)), '2025-02-28');
});

test('14 种语言的短窗口有周/半月网格及日期标签，窄轨道标签不重叠、不越界', () => {
  for (const { code } of LOCALES) {
    const list = JSON.parse(read(`./locales/${code}/list.json`));
    assert.equal(list.gantt.zoomYear, undefined, code);
    for (const key of ['zoom3m', 'zoom6m', 'zoom1y', 'zoom3y']) assert.ok(list.gantt[key], `${code} ${key}`);
    for (const zoom of ['3m', '6m'] as const) {
      for (const today of ['2026-10-21', '2024-01-31']) {
        const { start, end } = gantt.ganttWindow(zoom, today);
        // 390px 屏宽扣除页面留白、名称列和轨道右边距；另覆盖桌面宽轨道。
        for (const width of [180, 214, 900]) {
          const ticks = gantt.ganttTicks(zoom, start, end, width, code);
          assert.ok(ticks.length >= 11 && ticks.length <= 14, `${code} ${zoom}`);
          assert.equal(new Set(ticks.map((tick) => tick.d)).size, ticks.length);
          if (zoom === '3m') {
            for (let i = 1; i < ticks.length; i++) assert.equal(billing.diffDays(ticks[i - 1].d, ticks[i].d), 7);
          } else assert.ok(ticks.every((tick) => ['01', '15'].includes(tick.d.slice(8))));
          const labels = ticks.filter((tick) => tick.label);
          assert.ok(labels.length >= 2, `${code} ${zoom} ${width}`);
          const fmt = new Intl.DateTimeFormat(code, { timeZone: 'UTC', month: 'numeric', day: 'numeric' });
          let right = -8;
          for (const tick of labels) {
            assert.equal(tick.label, fmt.format(new Date(billing.parseDay(tick.d))));
            // 独立用 11px 字体较保守的实际文字占宽验算。
            const size = Array.from(tick.label).reduce((n, c) => n + (c.codePointAt(0)! > 0x024f ? 11 : 7), 0);
            const left = tick.labelX - size / 2;
            assert.ok(left >= right + 8 && left >= 0, `${code} ${zoom} ${width}: ${tick.label}`);
            right = tick.labelX + size / 2;
            assert.ok(right <= width);
          }
        }
      }
    }
  }
  assert.deepEqual(gantt.ganttTicks('3m', '2026-01-01', '2026-04-01', 0, 'en'), []);
});

type Element = { type: string; props: Record<string, any>; children: unknown[] };
const all = (node: unknown): Element[] => {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!node || typeof node !== 'object' || !('type' in node)) return [];
  const el = node as Element;
  return [el, ...all(el.children)];
};

// 与现有 ui-contracts 相同：执行真实组件和事件，只替换 React 宿主，不启动浏览器。
function mount(rawZoom?: string, width = 214, today = '2026-10-21') {
  const values: any[] = [];
  let cursor = 0;
  const prefs: Record<string, string | undefined> = { 'gantt-zoom': rawZoom };
  const prefCalls: Array<{ key: string; fallback: string; valid: (v: string) => boolean }> = [];
  const pendingEffects: Array<() => void> = [];
  const listeners: Record<string, (event: unknown) => void> = {};
  const timers = new Map<number, () => void>();
  let timerId = 0;
  let opened = 0;
  const useState = (initial: unknown) => {
    const i = cursor++;
    if (!(i in values)) values[i] = initial;
    return [values[i], (v: any) => (values[i] = typeof v === 'function' ? v(values[i]) : v)];
  };
  const useRef = (current: unknown) => useState({ current })[0];
  const deps = {
    ...billing,
    ...format,
    ...gantt,
    t,
    intlLocale,
    React: { createElement: (type: string, props: object, ...children: unknown[]) => ({ type, props: props ?? {}, children }) },
    Fragment: 'Fragment',
    useState,
    useRef,
    useMemo: (fn: () => unknown) => fn(),
    useEffect: (fn: () => void) => {
      const i = cursor++;
      if (!(i in values)) {
        values[i] = true;
        pendingEffects.push(fn);
      }
    },
    useLayoutEffect() {},
    useSyncExternalStore: (_subscribe: unknown, _get: unknown, server: () => unknown) => server(),
    useEffectEvent: (fn: (...args: unknown[]) => unknown) => {
      const ref = useRef(fn);
      ref.current = fn;
      return (...args: unknown[]) => ref.current(...args);
    },
    usePref: (key: string, fallback: string, valid: (v: string) => boolean) => {
      prefCalls.push({ key, fallback, valid });
      const raw = prefs[key];
      return [raw != null && valid(raw) ? raw : fallback, (v: string) => (prefs[key] = v)];
    },
    FlagImg: 'FlagImg',
    Icon: 'Icon',
    Seg: 'Seg',
    SubIcon: 'SubIcon',
    useWidth: () => [null, width],
    perLabel: () => 'mo',
    stopDescription: () => '',
    clearTimeout: (id: number) => timers.delete(id),
    window: { setTimeout: (fn: () => void) => (timers.set(++timerId, fn), timerId) },
  };
  const source = read('../app/src/views/Gantt.tsx').replace(/^import[\s\S]*?;\n/gm, '');
  const result = transformSync('Gantt.tsx', source, { lang: 'tsx', jsx: { runtime: 'classic' }, reactCompiler: false });
  assert.equal(result.fatal, false);
  const Gantt = new Function(...Object.keys(deps), `${result.code.replace('export function Gantt', 'function Gantt')}; return Gantt;`)(...Object.values(deps));
  const sub: Subscription = {
    id: 'monthly',
    name: 'Monthly',
    category: 'Tools',
    tags: [],
    price: 10,
    currency: 'USD',
    cycle: { unit: 'month', every: 1 },
    start: '2025-01-01',
    status: 'active',
  };
  const render = (rows: Subscription[] = [sub]) => {
    cursor = 0;
    const nodes = all(
      Gantt({ rows, today, state: { subscriptions: rows, methods: [], fx: billing.FALLBACK_FX, settings: DEFAULT_SETTINGS }, onOpen: () => opened++ }),
    );
    const track = nodes.find((el) => el.type === 'div' && el.props.className?.split(' ').includes('gt'))!;
    track.props.ref.current = {
      addEventListener: (name: string, fn: (event: unknown) => void) => (listeners[name] = fn),
      removeEventListener: (name: string) => delete listeners[name],
    };
    pendingEffects.splice(0).forEach((fn) => fn());
    return nodes;
  };
  return { render, prefs, prefCalls, listeners, timers, sub, opened: () => opened };
}

test('真实时间轴的默认/旧偏好回退为 1 年，五档按顺序保存且翻页、拖动、滚轮可用', () => {
  setLocale('en', [flatten('list', JSON.parse(read('./locales/en/list.json')))]);
  for (const raw of [undefined, 'year', 'unknown', '3m', '6m', '1y', '3y', 'all']) {
    const host = mount(raw);
    const range = host.render().find((el) => el.type === 'Seg')!;
    assert.equal(host.prefCalls[0].fallback, '1y');
    assert.equal(host.prefCalls[0].valid('year'), false);
    assert.equal(host.prefCalls[0].valid('unknown'), false);
    assert.equal(range.props.value, raw && gantt.isGanttZoom(raw) ? raw : '1y');
    assert.deepEqual(range.props.options, [
      ['3m', '3M'],
      ['6m', '6M'],
      ['1y', '1Y'],
      ['3y', '3Y'],
      ['all', 'All'],
    ]);
  }
  for (const zoom of ['3m', '6m', '1y', '3y'] as const) {
    const host = mount(zoom);
    const find = (cls: string) => host.render().find((el) => el.props.className?.split(' ').includes(cls))!;
    let nodes = host.render();
    nodes.find((el) => el.props['aria-label'] === 'Later')!.props.onClick();
    assert.ok(find('gt-range').props.className.includes('moved'));
    assert.equal(
      host.render().some((el) => el.props.className === 'gt-today'),
      false,
    );
    assert.ok(
      host.render().some((el) => el.props.className?.startsWith('gt-seg ')),
      '持续订阅翻到未来仍有条段',
    );
    nodes = host.render();
    nodes.find((el) => el.props['aria-label'] === 'Earlier')!.props.onClick();
    assert.ok(!find('gt-range').props.className.includes('moved'));
    const track = find('gt');
    track.props.onPointerDown({ button: 0, clientX: 100 });
    track.props.onPointerMove({ clientX: 10, pointerId: 1, currentTarget: { setPointerCapture() {} } });
    find('gt').props.onPointerUp();
    assert.ok(find('gt-range').props.className.includes('moved'));
    find('gt-row').props.onClick();
    assert.equal(host.opened(), 0, '拖动不会打开详情');
    find('gt-range').props.onClick();
    let prevented = false;
    host.listeners.wheel({ deltaX: 90, deltaY: 0, preventDefault: () => (prevented = true) });
    assert.equal(prevented, true);
    assert.equal(host.timers.size, 1);
    const range = host.render().find((el) => el.type === 'Seg')!;
    range.props.onChange('6m');
    assert.equal(host.prefs['gantt-zoom'], '6m');
    assert.equal(host.timers.size, 0, '切换范围取消旧的滚轮吸附');
    assert.ok(!find('gt-range').props.className.includes('moved'));
    host
      .render()
      .find((el) => el.type === 'Seg')!
      .props.onChange('all');
    assert.equal(
      host.render().some((el) => el.props.className === 'gt-nav'),
      false,
    );
    prevented = false;
    host.listeners.wheel({ deltaX: 90, deltaY: 0, preventDefault: () => (prevented = true) });
    assert.equal(prevented, false);
  }
});

test('短窗口在窄/宽轨道中绘出价格、扣款、试用、首期优惠和计划阶段', () => {
  for (const zoom of ['3m', '6m']) {
    for (const width of [214, 900]) {
      const host = mount(zoom, width);
      const trial = {
        ...host.sub,
        id: 'trial',
        start: '2026-10-01',
        trialEnd: '2026-11-01',
        status: 'trial' as const,
        priceHistory: [{ from: '2026-10-10', amount: 12 }],
      };
      const plan = { ...host.sub, id: 'planned', start: '2026-11-01', planned: true };
      const intro = { ...host.sub, id: 'intro', intro: { until: '2026-11-01', price: 5 } };
      const nodes = host.render([host.sub, trial, plan, intro]);
      const rows = nodes.filter((el) => el.props.className === 'gt-row');
      const monthly = all(rows[0]);
      assert.ok(
        monthly.some((el) => el.type === 'em'),
        `${zoom} ${width}: 价格`,
      );
      assert.ok(
        monthly.some((el) => el.props.className?.startsWith('gt-charge ')),
        `${zoom} ${width}: 扣款`,
      );
      const trialParts = all(rows[1]).filter((el) => el.props.className === 'gt-trial');
      assert.ok(trialParts.length >= 2, '试用跨过调价切点仍完整显示');
      assert.ok(trialParts.every((el) => el.props.style.width > 0 && el.props.style.width <= width));
      assert.ok(all(rows[2]).some((el) => el.props.className?.split(' ').includes('planned')));
      assert.ok(all(rows[3]).some((el) => el.props.className?.split(' ').includes('intro')));
      for (const el of nodes.filter((el) => el.props.className?.startsWith('gt-seg '))) {
        assert.ok(Number.isFinite(el.props.style.left) && el.props.style.left >= 0 && el.props.style.left <= width);
        assert.ok(el.props.style.width > 0 && el.props.style.width <= width);
      }
    }
  }
});
