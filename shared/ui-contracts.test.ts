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
  const source = read('../src/views/Ai.tsx').replace(/^import .*;\n/gm, '');
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
