import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetOf, categoryColor, categoryList, cleanCategories, isDomainCategory, isIconName, PRESETS, presetCategory, renameInSubs } from './categories.ts';
import { FALLBACK_FX } from './billing.ts';
import { maskForPublic } from './mask.ts';
import { DEFAULT_SETTINGS, type AppState, type Subscription } from './types.ts';

// 测试里没有加载语言包：按英文名模拟当前语言
const EN: Record<string, string> = { ai: 'AI', tools: 'Tools', domains: 'Domains', media: 'Video', games: 'Games' };
const nameOf = (code: string) => EN[code] ?? `#${code}`;
const subs = (...cats: string[]) => cats.map((category) => ({ category }));

test('没存过分类表：内置预设 + 用到的分类，旧数据沿用原名与图标颜色', () => {
  const list = categoryList({}, subs('工具', '域名', '播客', '工具'), nameOf);
  assert.equal(list.length, PRESETS.length + 1);
  // 「工具」占住 tools 预设的位置，不再出现英文的 Tools
  const tools = list.find((c) => c.preset === 'tools')!;
  assert.deepEqual(tools, { name: '工具', icon: 'wrench', color: 'c1', preset: 'tools' });
  assert.ok(!list.some((c) => c.name === 'Tools'));
  assert.equal(list.find((c) => c.preset === 'domains')!.name, '域名');
  // 没用到的预设按当前语言命名
  assert.equal(list.find((c) => c.preset === 'games')!.name, 'Games');
  // 自定义分类排在最后，没有图标颜色
  assert.deepEqual(list.at(-1), { name: '播客' });
});

test('同一个预设既有中文原名又有当前语言名：都保留，各自一行', () => {
  const list = categoryList({}, subs('工具', 'Tools'), nameOf);
  assert.equal(list.filter((c) => c.preset === 'tools').length, 2);
  assert.equal(new Set(list.map((c) => c.name)).size, list.length);
});

test('存过分类表：按存的顺序，用到但不在表里的追加；preset 不重复占用', () => {
  const stored = [
    { name: '网址', icon: 'globe', preset: 'domains' },
    { name: '影音', icon: '🎬', color: 'c2' },
  ];
  const list = categoryList({ categories: stored }, subs('影音', '域名', '新分类'), nameOf);
  assert.deepEqual(
    list.map((c) => c.name),
    ['网址', '影音', '域名', '新分类'],
  );
  // 改名后的「网址」仍是域名分类；后来又出现的「域名」沿用图标，但不再抢 domains 标记
  assert.ok(isDomainCategory(list, '网址'));
  assert.equal(list[2].icon, 'globe');
  assert.equal(list[2].preset, undefined);
  assert.equal(presetCategory(list, 'domains', nameOf), '网址');
  assert.equal(presetCategory(list, 'tools', nameOf), 'Tools');
});

test('颜色：色号、十六进制、散列兜底且稳定', () => {
  assert.equal(categoryColor({ name: 'x', color: 'c3' }, 'x'), 'var(--c3)');
  assert.equal(categoryColor({ name: 'x', color: '#ff0000' }, 'x'), '#ff0000');
  assert.equal(categoryColor(undefined, '播客'), categoryColor({ name: '播客' }, '播客'));
  assert.match(categoryColor(undefined, '播客'), /^var\(--c\d+\)$/);
});

test('图标值：Lucide 名与 emoji 区分', () => {
  assert.ok(isIconName('gamepad-2'));
  assert.ok(isIconName('bot'));
  assert.ok(!isIconName('🎮'));
  assert.ok(!isIconName('Bot'));
});

test('改名表只改相关订阅、不连锁', () => {
  const list = [
    { id: 'a', category: 'A' },
    { id: 'b', category: 'B' },
    { id: 'c', category: 'C' },
  ];
  const out = renameInSubs(list, { A: 'B', B: 'C' });
  assert.deepEqual(out, [
    { id: 'a', category: 'B' },
    { id: 'b', category: 'C' },
  ]);
  // 原数组不被修改；原型上的键（toString 等）不当作改名
  assert.equal(list[0].category, 'A');
  assert.deepEqual(renameInSubs([{ category: 'toString' }], {}), []);
});

test('保存前校验：去空白、拒绝空名与重名、丢掉非法字段', () => {
  const ok = cleanCategories([
    { name: ' AI ', icon: 'bot', color: 'c8', preset: 'ai', extra: 1 },
    { name: '影音', color: 'red' },
  ]);
  assert.ok('list' in ok);
  assert.deepEqual(ok.list, [{ name: 'AI', icon: 'bot', color: 'c8', preset: 'ai' }, { name: '影音' }]);
  assert.ok('error' in cleanCategories([{ name: 'A' }, { name: 'A ' }]));
  assert.ok('error' in cleanCategories([{ name: '  ' }]));
  assert.ok('error' in cleanCategories('nope'));
});

test('公开页：只下发公开订阅用到的分类；改了名的域名分类照样打码', () => {
  const sub = (o: Partial<Subscription>): Subscription => ({
    id: Math.random().toString(36).slice(2),
    name: 'X',
    category: '工具',
    tags: [],
    price: 1,
    currency: 'USD',
    cycle: { unit: 'month', every: 1 },
    start: '2026-01-01',
    status: 'active',
    ...o,
  });
  const state: AppState = {
    subscriptions: [
      sub({ name: 'secret-project', category: '网址', url: 'https://secret.dev' }),
      sub({ category: '影音' }),
      sub({ category: '代付专用', proxy: { forName: '小王', entries: [] } }),
    ],
    methods: [],
    settings: {
      ...DEFAULT_SETTINGS,
      categories: [
        { name: '网址', icon: 'globe', preset: 'domains' },
        { name: '影音', icon: '🎬', color: 'c2', preset: 'media' },
        { name: '没用到', icon: 'bot' },
        { name: '代付专用' },
      ],
    },
    fx: FALLBACK_FX,
  };
  const pub = maskForPublic(state);
  assert.deepEqual(pub.settings.categories, [
    { name: '网址', icon: 'globe', color: undefined, preset: 'domains' },
    { name: '影音', icon: '🎬', color: 'c2', preset: undefined },
  ]);
  const domain = pub.subscriptions.find((s) => s.category === '网址')!;
  assert.equal(domain.url, undefined);
  assert.ok(domain.id.startsWith('d-'));
});

test('内置分类在任何语言下的名字都认回同一个预设，公开页的域名打码不依赖访客语言', async () => {
  const { presetOf } = await import('./categories.ts');
  const { isDomainSub } = await import('./mask.ts');
  for (const name of ['域名', 'Domains', 'Dominios', 'ドメイン', 'Домены', '網域']) {
    assert.equal(presetOf(name)?.code, 'domains', name);
    assert.ok(isDomainSub({ name: 'my site', category: name, tags: [] }), name);
  }
  assert.equal(presetOf('Spiele')?.code, 'games');
});

test('旧韩语分类名称保留识别与存储原名', () => {
  for (const [name, code] of [
    ['VPN·네트워크', 'vpn'],
    ['뉴스·읽기', 'news'],
    ['건강·피트니스', 'health'],
  ]) {
    assert.equal(presetOf(name, nameOf)?.code, code);
    const category = categoryList({}, subs(name), nameOf).find((c) => c.name === name);
    assert.equal(category?.preset, code);
    assert.equal(category?.name, name);
  }
});
