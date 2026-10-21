import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'oxc-transform-react';
import { DEFAULT_SETTINGS } from './types.ts';
import { FALLBACK_FX, todayIn, addDays } from './billing.ts';
import { LOCALES } from './i18n.ts';
import { buildIcs } from '../worker/ics.ts';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const locale = (loc: string, ns: string) => JSON.parse(read(`./locales/${loc}/${ns}.json`));

test('14. 真实 Ai 组件创建令牌后仅弹层可见，关闭和“已保存”都清空令牌', () => {
  // 在 Node 中执行真实组件的事件，不加载浏览器或其他页面；只替换 React 宿主与外部依赖。
  const source = read('../app/src/views/Ai.tsx').replace(/^import .*;\n/gm, '');
  const result = transformSync('Ai.tsx', source, { lang: 'tsx', jsx: { runtime: 'classic' }, reactCompiler: false });
  assert.equal(result.fatal, false);
  type Element = { type: string | { name: string }; props: Record<string, unknown>; children: Element[] };
  const values: unknown[] = [];
  let cursor = 0;
  const useState = (initial: unknown) => {
    const i = cursor++;
    if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
    return [
      values[i],
      (next: unknown) => {
        values[i] = typeof next === 'function' ? next(values[i]) : next;
      },
    ];
  };
  const React = {
    Fragment: 'Fragment',
    createElement(type: Element['type'], props: Element['props'], ...children: Element[]) {
      return { type, props: props ?? {}, children };
    },
  };
  const deps = {
    React,
    useState,
    useEffect() {},
    base: (s: string) => s,
    t: (s: string) => s,
    Icon: 'Icon',
    Sheet: 'Sheet',
    Toggle: 'Toggle',
    Toolbar: 'Toolbar',
    api: async () => [],
    run() {},
    saveSettings() {},
    toast() {},
    confirmDelete() {},
    localTime() {},
    location: { origin: 'https://example.test' },
  };
  const Ai = new Function(...Object.keys(deps), `${result.code.replace('export function Ai', 'function Ai')}; return Ai;`)(...Object.values(deps));
  const render = (): Element => {
    cursor = 0;
    return Ai({ state: { subscriptions: [], methods: [], fx: FALLBACK_FX, settings: DEFAULT_SETTINGS } });
  };
  const all = (node: unknown): Element[] => {
    if (Array.isArray(node)) return node.flatMap(all);
    if (!node || typeof node !== 'object' || !('type' in node)) return [];
    const e = node as Element;
    return [e, ...all(e.children)];
  };
  const named = (e: Element, name: string) => (typeof e.type === 'object' || typeof e.type === 'function' ? e.type.name === name : e.type === name);
  for (const close of ['onClose', 'saved']) {
    let nodes = all(render());
    const createButton = nodes.find((e) => e.type === 'button' && e.props.className === 'btn primary')!;
    (createButton.props.onClick as () => void)();
    nodes = all(render());
    const create = nodes.find((e) => named(e, 'NewToken'))!;
    const secret = 'secret-token-never-persist';
    (create.props.onCreated as (r: unknown) => void)({ token: secret, item: { id: 'new', name: 'New', scope: 'write' } });
    nodes = all(render());
    const connections = nodes.filter((e) => named(e, 'Connect'));
    assert.equal(connections.length, 2);
    assert.equal(connections[0].props.token, undefined); // 主页面始终使用占位符
    assert.equal((connections[1].props.token as { token: string }).token, secret);
    const sheet = nodes.find((e) => e.type === 'Sheet')!;
    if (close === 'onClose') (sheet.props.onClose as () => void)();
    else {
      const button = all(sheet.props.foot).find((e) => e.type === 'button')!;
      (button.props.onClick as () => void)();
    }
    nodes = all(render());
    assert.equal(
      nodes.some((e) => e.type === 'Sheet'),
      false,
    );
    assert.equal(
      values.some((v) => typeof v === 'object' && v && 'token' in v),
      false,
    );
    assert.equal(nodes.filter((e) => named(e, 'Connect')).length, 1);
    assert.equal(nodes.find((e) => named(e, 'Connect'))!.props.token, undefined);
  }
});

test('15. 14 种语言的合租空状态指向编辑器真实分组及发起选项', () => {
  for (const { code } of LOCALES) {
    const editor = locale(code, 'editor');
    const copy = locale(code, 'family').pool.emptyBody;
    assert.ok(copy.includes(editor.group.who), code);
    assert.ok(copy.includes(editor.share.owner), code);
  }
  assert.ok(locale('en', 'family').pool.emptyBody.includes('I host'));
});

test('16. 14 种语言的代付空状态指向编辑器真实分组及代付选项', () => {
  for (const { code } of LOCALES) {
    const editor = locale(code, 'editor');
    const copy = locale(code, 'proxy').page.emptyBody;
    assert.ok(copy.includes(editor.group.who), code);
    assert.ok(copy.includes(editor.share.proxy), code);
  }
  assert.ok(locale('zh-CN', 'proxy').page.emptyBody.includes('谁在用'));
});

test('9/17. 所有语言说明全额实付和日历客户端边界；ICS 仍声明建议周期与相对闹钟', () => {
  const clientTerms: Record<string, string> = {
    en: 'client',
    'zh-CN': '客户端',
    'zh-TW': '用戶端',
    'zh-HK': '用戶端',
    ja: 'アプリ',
    ko: '앱',
    es: 'cliente',
    fr: 'client',
    de: 'Kalenderprogramm',
    'pt-BR': 'aplicativo',
    ru: 'клиента',
    tr: 'uygulamasına',
    id: 'aplikasi',
    vi: 'ứng dụng',
  };
  for (const { code } of LOCALES) {
    const report = locale(code, 'report').cash.fullPaidHint;
    const review = locale(code, 'review').spendBasis;
    assert.ok(report && report === review, code);
    const intro = locale(code, 'app').ics.intro;
    assert.ok(intro.includes('6'), code);
    assert.ok(intro.includes(clientTerms[code]), code);
  }
  const today = todayIn('UTC');
  const ics = buildIcs(
    {
      subscriptions: [
        {
          id: 's',
          name: 'Plan',
          category: 'Tools',
          tags: [],
          price: 10,
          currency: 'USD',
          cycle: { unit: 'month', every: 1 },
          start: addDays(today, 3),
          status: 'active',
        },
      ],
      methods: [],
      settings: DEFAULT_SETTINGS,
      fx: FALLBACK_FX,
    },
    'https://example.test',
  );
  assert.ok(ics.includes('REFRESH-INTERVAL;VALUE=DURATION:PT6H'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:'));
  assert.ok(ics.includes('TRIGGER:-P2DT15H'));
  assert.ok(!ics.includes('TRIGGER;VALUE=DATE-TIME'));
});

test('报告损失明细可打开原订阅；四种年度分享在非零且未隐藏时展示损失', async () => {
  const { cancelSavings, stopLosses, yearReview } = await import('./metrics.ts');
  const { stopSubscription } = await import('./phases.ts');
  const { cnDate, money } = await import('./format.ts');
  const { flatten, setLocale, t } = await import('./i18n.ts');
  type Element = { type: string; props: Record<string, any>; children: unknown[] };
  const React = {
    createElement(type: string | ((p: any) => unknown), props: Record<string, any> | null, ...children: unknown[]) {
      return typeof type === 'function' ? type({ ...props, children }) : { type, props: props ?? {}, children };
    },
  };
  const load = (file: string, names: string[], deps: Record<string, unknown>) => {
    const source = read(file)
      .replace(/^import [\s\S]*?;\n/gm, '')
      .replace(/export function /g, 'function ');
    const result = transformSync(file, source, { lang: 'tsx', jsx: { runtime: 'classic' }, reactCompiler: false });
    assert.equal(result.fatal, false);
    return new Function(...Object.keys(deps), `${result.code}; return { ${names.join(', ')} };`)(...Object.values(deps));
  };
  const all = (node: unknown): Element[] => {
    if (Array.isArray(node)) return node.flatMap(all);
    if (!node || typeof node !== 'object' || !('type' in node)) return [];
    const e = node as Element;
    return [e, ...all(e.children)];
  };
  const text = (node: unknown): string => {
    if (Array.isArray(node)) return node.map(text).join('');
    if (node == null || typeof node === 'boolean') return '';
    return typeof node === 'object' ? text((node as Element).children) : String(node);
  };
  const deps = {
    React,
    t,
    money,
    cnDate,
    useMemo: (f: () => unknown) => f(),
    cancelSavings,
    stopLosses,
    tipProps: () => ({}),
    SubIcon: 'SubIcon',
    Amount: 'Amount',
  };
  const { StopsCard } = load('../app/src/views/Report.tsx', ['StopsCard'], deps);
  const { Receipt, Poster, Card, Stars } = load('../app/src/views/Review.tsx', ['Receipt', 'Poster', 'Card', 'Stars'], {
    React,
    t,
    SubIcon: 'SubIcon',
    catColor: () => '#777',
    monthLabel: () => 'October',
    packCircles: () => [],
    location: { host: 'example.test' },
  });
  const today = '2026-10-19';
  const original = {
    id: 'fictional',
    name: 'Fictional Service',
    category: 'tools',
    tags: [],
    price: 31,
    currency: 'USD',
    cycle: { unit: 'month' as const, every: 1 },
    start: '2026-10-05',
    status: 'active' as const,
  };
  const stopped = stopSubscription(original, today, 'terminate', today, 'abuse', { amount: 6 });
  const cancelled = stopSubscription({ ...original, id: 'cancelled' }, today, 'cancel');
  const st = { subscriptions: [stopped, cancelled], methods: [], settings: DEFAULT_SETTINGS, fx: FALLBACK_FX };
  for (const lang of ['en', 'zh-CN']) {
    const messages = {};
    for (const ns of ['common', 'core', 'report', 'review']) flatten(ns, locale(lang, ns), messages);
    setLocale(lang as 'en' | 'zh-CN', [messages]);
    let opened: unknown;
    const tree = StopsCard({
      state: st,
      today,
      onOpen: (s: unknown) => {
        opened = s;
      },
    });
    const rows = all(tree).filter((e) => e.props.className === 'stop-row');
    assert.equal(rows.length, 2);
    const terminated = rows.find((e) => text(e).includes('abuse'))!;
    assert.ok(text(terminated).includes(t('core.stop.partial', { money: money(6, 'USD') })));
    assert.ok(text(terminated).includes(money(10, 'USD')));
    assert.ok(text(tree).includes(t('report.stops.cancel')));
    assert.ok(text(tree).includes(t('core.stop.refundNo')));
    terminated.props.onClick();
    assert.equal(opened, stopped);
    const empty = StopsCard({ state: { ...st, subscriptions: [] }, today, onOpen() {} });
    assert.ok(text(empty).includes(t('report.stops.empty')));
    assert.equal(all(empty).filter((e) => e.props.className === 'stop-row').length, 0);
    const unknown = stopSubscription({ ...original, currency: 'XYZ' }, today, 'terminate');
    const unknownTree = StopsCard({ state: { ...st, subscriptions: [unknown] }, today, onOpen() {} });
    assert.ok(text(unknownTree).includes(t('core.stop.fxMissing')));
    assert.ok(!text(unknownTree).includes(t('report.stops.empty')));
    const r = yearReview(st, today);
    const ctx = {
      r,
      year: '2026',
      name: 'Alex',
      whose: 'Alex',
      ongoing: true,
      m: (n: number) => money(n, 'USD'),
      pct: () => '50%',
      byMethod: [],
      tip: 'Tip',
      today,
      mrr: 0,
      saved: 0,
    };
    for (const style of [Receipt, Poster, Card, Stars]) {
      const line = t('review.stopLoss', { amount: money(26, 'USD') });
      assert.ok(text(style({ ...ctx, hide: false })).includes(line));
      assert.ok(!text(style({ ...ctx, hide: true })).includes(line));
      assert.ok(text(style({ ...ctx, r: { ...r, stopLoss: NaN }, hide: false })).includes(t('core.stop.fxMissing')));
      assert.equal(all(style({ ...ctx, r: { ...r, stopLoss: 0 }, hide: false })).filter((e) => e.props.className === 'review-loss').length, 0);
    }
  }
  setLocale('en', []);
});
