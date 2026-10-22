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
    CardTitle: 'h3',
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
  const { cnDate, flow, money } = await import('./format.ts');
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
    flow,
    cnDate,
    useMemo: (f: () => unknown) => f(),
    cancelSavings,
    stopLosses,
    tipProps: () => ({}),
    SubIcon: 'SubIcon',
    Amount: 'Amount',
    CardTitle: 'h3',
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
    assert.ok(text(terminated).includes(t('core.stop.partial', { money: flow(6, 'USD') })));
    assert.ok(text(terminated).includes(money(10, 'USD')));
    assert.ok(text(terminated).includes(t('core.stop.lossDays', { count: 10 })));
    assert.ok(text(terminated).includes('−'));
    assert.ok(text(tree).includes(t('core.stop.lossTitle')));
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
      m: (n: number) => flow(n, 'USD'),
      pct: () => '50%',
      byMethod: [],
      tip: 'Tip',
      today,
      mrr: 0,
      saved: '',
    };
    for (const style of [Receipt, Poster, Card, Stars]) {
      const line = t('review.stopLoss', { amount: flow(-26, 'USD') });
      assert.ok(text(style({ ...ctx, hide: false })).includes(line));
      assert.ok(!text(style({ ...ctx, hide: true })).includes(line));
      assert.ok(text(style({ ...ctx, r: { ...r, stopLoss: NaN }, hide: false })).includes(t('core.stop.fxMissing')));
      assert.equal(all(style({ ...ctx, r: { ...r, stopLoss: 0 }, hide: false })).filter((e) => e.props.className === 'review-loss').length, 0);
    }
  }
  setLocale('en', []);
});

test('14 种语言统一未退款损失语义，金额标签取代未用天数，预付余值保持独立', () => {
  for (const { code } of LOCALES) {
    const core = locale(code, 'core').stop;
    const report = locale(code, 'report');
    const overview = locale(code, 'overview').stmt;
    const review = locale(code, 'review');
    const detail = locale(code, 'detail').stop;
    assert.equal(report.stops.loss, core.lossTitle, code);
    assert.ok(core.unused.includes(core.lossTitle), code);
    assert.ok(overview.loss.toLocaleLowerCase(code).includes(core.lossTitle.toLocaleLowerCase(code)), code);
    assert.ok(review.stopLoss.toLocaleLowerCase(code).includes(core.lossTitle.toLocaleLowerCase(code)), code);
    assert.ok(core.unrefunded.includes('{money}'), code);
    assert.ok(!core.unrefunded.includes('{days}'), code);
    assert.ok(detail.loss.includes('{money}') && detail.loss.includes('{days}'), code);
    assert.ok(report.stops.lossHint && core.fullyRefunded && detail.title, code);
    assert.notEqual(core.unusedTitle, core.lossTitle, code); // 图例只写“未退款”。
    assert.notEqual(report.cash.prepaidSub, report.stops.lossHint, code);
  }
  assert.equal(locale('zh-CN', 'report').cash.prepaidSub, '{count} 项已付未用完');
  assert.equal(locale('zh-CN', 'core').stop.lossTitle, '未退款损失');
  assert.equal(locale('en', 'core').stop.lossTitle, 'Unrefunded loss');
  assert.equal(locale('zh-CN', 'report').stops.lossHint, '服务提前终止、没有退回的费用');
  assert.equal(locale('en', 'report').stops.lossHint, 'Paid for service that ended early and was not refunded');
});

test('登录与首次设置表单为密码管理器提供同一账号和正确的 autocomplete、无障碍标签', () => {
  const source = read('../app/src/app.tsx');
  const login = source.slice(source.indexOf('function Login('), source.indexOf('function Sidebar('));
  const result = transformSync('Login.tsx', login, { lang: 'tsx', jsx: { runtime: 'classic' }, reactCompiler: false });
  assert.equal(result.fatal, false);
  type Element = { type: string; props: Record<string, any>; children: unknown[] };
  const React = { createElement: (type: string, props: Record<string, any> | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }) };
  const all = (node: unknown): Element[] => {
    if (Array.isArray(node)) return node.flatMap(all);
    if (!node || typeof node !== 'object' || !('type' in node)) return [];
    const e = node as Element;
    return [e, ...all(e.children)];
  };
  for (const needsSetup of [false, true]) {
    let cursor = 0;
    const deps = {
      React,
      useState: (v: unknown) => [cursor++ === 0 ? { needsSetup, passkeys: 1 } : v, () => {}],
      useRef: () => ({ current: undefined }),
      useEffect() {},
      location: { hostname: 'ledger.example.test' },
      window: { PublicKeyCredential: function () {} },
      Icon: 'Icon',
      t: (key: string) => key,
      base: (path: string) => path,
    };
    const Login = new Function(...Object.keys(deps), `${result.code}; return Login;`)(...Object.values(deps));
    const nodes = all(Login({}));
    const username = nodes.find((e) => e.type === 'input' && e.props.name === 'username')!;
    assert.equal(username.props.value, 'owner@ledger.example.test');
    assert.equal(username.props.autoComplete, needsSetup ? 'username' : 'username webauthn');
    assert.equal(username.props.readOnly, true);
    const label = nodes.find((e) => e.type === 'label' && e.props.htmlFor === username.props.id)!;
    assert.ok(JSON.stringify(label.children).includes('app.login.username'));
    const password = nodes.find((e) => e.type === 'input' && e.props.name === 'password')!;
    assert.equal(password.props.type, 'password');
    assert.equal(password.props.autoComplete, needsSetup ? 'new-password' : 'current-password webauthn');
    assert.equal(password.props['aria-label'], needsSetup ? 'app.login.newPassword' : 'app.login.password');
    for (const { code } of LOCALES) assert.ok(locale(code, 'app').login.username, code);
  }
  assert.ok(login.includes('autofill.current?.();')); // 密码提交和 Passkey 按钮共用 go() 的同步取消
  assert.ok(login.includes('return stop;')); // 卸载时清理条件式请求
});
