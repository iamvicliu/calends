// 分类注册表：名称、图标、颜色、排列顺序。前端、公开页、MCP 共用。
// - 存在 settings.categories 里，顺序即显示顺序；没存过时按内置预设 + 订阅里用到的分类推导，旧数据显示与以前一致。
// - 订阅仍只存分类名（category 字符串）；改名、删除时由服务端一次改写所有相关订阅。
// - 内置分类带 preset 代码：改了名也认得出「域名」等有特殊行为的分类。
import { t } from './i18n.ts';
import type { Settings, Subscription } from './types.ts';
import { CATEGORY_ALIASES } from './locales/categories.gen.ts';

export interface Category {
  name: string;
  /** Lucide 图标名（如 bot、gamepad-2）或任意 emoji；缺省为标签图标 */
  icon?: string;
  /** 调色板色号 c1…c10（随浅色 / 深色主题变化）或 #rrggbb；缺省按名称散列取色 */
  color?: string;
  /** 内置分类代码（tools、domains…）：改名后仍保留域名打码等特殊行为 */
  preset?: string;
}

/** 调色板：对应 CSS 变量 --c1 … --c10 */
export const CAT_COLORS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10'] as const;

interface Preset {
  code: string;
  icon: string;
  color?: string;
  /** 旧版本写进订阅里的名称 */
  legacy?: string[];
}

/**
 * 内置预设，顺序即默认显示顺序。
 * 早期就有的分类沿用当时的图标与颜色（社交、服务器当时没有固定颜色，按名称散列，这里也不指定）。
 */
export const PRESETS: Preset[] = [
  { code: 'ai', icon: 'bot', color: 'c8', legacy: ['AI'] },
  { code: 'tools', icon: 'wrench', color: 'c1', legacy: ['工具'] },
  { code: 'productivity', icon: 'zap', color: 'c3', legacy: ['效率'] },
  { code: 'media', icon: 'square-play', color: 'c2', legacy: ['影音'] },
  { code: 'music', icon: 'music', color: 'c4', legacy: ['音乐'] },
  { code: 'games', icon: 'gamepad', color: 'c9', legacy: ['游戏'] },
  { code: 'cloud', icon: 'server', legacy: ['服务器'] },
  { code: 'storage', icon: 'hard-drive', color: 'c6' },
  { code: 'domains', icon: 'globe', color: 'c10', legacy: ['域名'] },
  { code: 'vpn', icon: 'shield-check', color: 'c4', legacy: ['VPN·네트워크'] },
  { code: 'developer', icon: 'code', color: 'c8' },
  { code: 'design', icon: 'palette', color: 'c7' },
  { code: 'education', icon: 'book', color: 'c6', legacy: ['教育'] },
  { code: 'news', icon: 'newspaper', color: 'c5', legacy: ['뉴스·읽기'] },
  { code: 'social', icon: 'user', legacy: ['社交'] },
  { code: 'shopping', icon: 'shopping-bag', color: 'c7', legacy: ['购物'] },
  { code: 'finance', icon: 'landmark', color: 'c4' },
  { code: 'insurance', icon: 'umbrella', color: 'c6' },
  { code: 'health', icon: 'heart-pulse', color: 'c2', legacy: ['건강·피트니스'] },
  { code: 'phone', icon: 'smartphone', color: 'c1' },
  { code: 'daily', icon: 'house', color: 'c5', legacy: ['日用'] },
];

export type PresetName = (code: string) => string;
/** 内置分类在当前语言下的名称；只在调用时取文案（模块加载时语言包还没就绪） */
const presetName: PresetName = (code) => t(`core.category.${code}`);

/** 分类名对应哪个内置预设：当前语言的名称或早期中文原名 */
export function presetOf(name: string, nameOf: PresetName = presetName): Preset | undefined {
  return PRESETS.find((p) => nameOf(p.code) === name || p.legacy?.includes(name) || CATEGORY_ALIASES[p.code]?.includes(name));
}

function fromPreset(name: string, p: Preset | undefined): Category {
  return p ? { name, icon: p.icon, ...(p.color ? { color: p.color } : {}), preset: p.code } : { name };
}

/**
 * 实际生效的分类列表（按显示顺序）。
 * 存过：用存的列表，订阅里用到但不在列表里的（如 MCP、CSV 导入新建的）追加在后面。
 * 没存过：内置预设（已在用的沿用订阅里的写法，如「工具」），再加上其余用到的分类。
 */
export function categoryList(settings: Pick<Settings, 'categories'>, subs: Array<Pick<Subscription, 'category'>>, nameOf: PresetName = presetName): Category[] {
  const used = [...new Set(subs.map((s) => s.category).filter(Boolean))];
  const out: Category[] = [];
  const seen = new Set<string>();
  const add = (c: Category) => {
    if (!c.name || seen.has(c.name)) return;
    seen.add(c.name);
    out.push(c);
  };
  if (settings.categories) {
    for (const c of settings.categories) add(c);
  } else {
    for (const p of PRESETS) add(fromPreset(used.find((n) => presetOf(n, nameOf) === p) ?? nameOf(p.code), p));
  }
  // 其余用到的分类：认得出是内置分类的沿用它的图标和颜色；preset 只给还没被占用的，避免两个「域名」
  for (const n of used) {
    if (seen.has(n)) continue;
    const p = presetOf(n, nameOf);
    const c = fromPreset(n, p);
    if (settings.categories && out.some((x) => x.preset === c.preset)) delete c.preset;
    add(c);
  }
  return out;
}

export function findCategory(list: Category[], name: string): Category | undefined {
  return list.find((c) => c.name === name);
}

/** 某个内置分类现在叫什么（用户可能改过名）；找不到就用当前语言的默认名 */
export function presetCategory(list: Category[], code: string, nameOf: PresetName = presetName): string {
  return list.find((c) => c.preset === code)?.name ?? nameOf(code);
}

/** 是否「域名」分类：认 preset，也认旧数据里的中文原名 */
export function isDomainCategory(list: Category[], name: string): boolean {
  const c = findCategory(list, name);
  return c ? c.preset === 'domains' : presetOf(name)?.code === 'domains';
}

/** 图标值是 Lucide 图标名还是 emoji */
export const isIconName = (v: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v);

/** 色号 → CSS 颜色；没设颜色的按名称散列，同名分类颜色总是一样 */
export function categoryColor(c: Pick<Category, 'name' | 'color'> | undefined, name: string): string {
  const v = c?.color;
  if (v && /^c\d{1,2}$/.test(v)) return `var(--${v})`;
  if (v && /^#[0-9a-f]{6}$/i.test(v)) return v;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `var(--${CAT_COLORS[h % CAT_COLORS.length]})`;
}

const MAX_NAME = 40;

/** 校验并整理要保存的分类列表；返回错误文案或整理后的列表 */
export function cleanCategories(raw: unknown): { error: string } | { list: Category[] } {
  if (!Array.isArray(raw) || raw.length > 200) return { error: t('server.category.invalid') };
  const list: Category[] = [];
  const names = new Set<string>();
  for (const x of raw as Array<Partial<Category>>) {
    const name = typeof x?.name === 'string' ? x.name.trim() : '';
    if (!name || name.length > MAX_NAME) return { error: t('server.category.invalid') };
    if (names.has(name)) return { error: t('server.category.duplicate', { name }) };
    names.add(name);
    const c: Category = { name };
    if (typeof x.icon === 'string' && x.icon.trim() && x.icon.length <= 32) c.icon = x.icon.trim();
    if (typeof x.color === 'string' && /^(c\d{1,2}|#[0-9a-f]{6})$/i.test(x.color)) c.color = x.color;
    if (typeof x.preset === 'string' && /^[a-z]+$/.test(x.preset)) c.preset = x.preset;
    list.push(c);
  }
  return { list };
}

/** 按改名表改写订阅的分类；只返回实际改动的订阅。改名表是旧名 → 新名，不连锁（A→B、B→C 时 A 只到 B） */
export function renameInSubs<T extends Pick<Subscription, 'category'>>(subs: T[], renames: Record<string, string>): T[] {
  const out: T[] = [];
  for (const s of subs) {
    const to = Object.hasOwn(renames, s.category) ? renames[s.category] : undefined;
    if (to !== undefined && to !== s.category) out.push({ ...s, category: to });
  }
  return out;
}

/** 每个分类下有几个订阅 */
export function categoryCounts(subs: Array<Pick<Subscription, 'category'>>): Map<string, number> {
  const n = new Map<string, number>();
  for (const s of subs) n.set(s.category, (n.get(s.category) ?? 0) + 1);
  return n;
}
