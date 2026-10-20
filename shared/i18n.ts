// 多语言：前端、Worker、邮件、MCP 共用一套。
// - 文案放在 shared/locales/<语言>/<命名空间>.json，键名形如 editor.save；zh-CN 与 en 是源语言，其余由它们翻译而来。
// - t('ns.key', { name }) 取文案，{name} 为占位符；值写成 { "one": …, "other": … } 时按 count 选复数形式。
// - 当前语言是模块级状态：浏览器里全局只有一种；Worker 每个请求开始时按请求头或设置切换（单用户，不会互相串）。

export const LOCALES = [
  { code: 'en', name: 'English', flag: 'us' },
  { code: 'zh-CN', name: '简体中文', flag: 'cn' },
  { code: 'zh-TW', name: '繁體中文（台灣）', flag: 'tw' },
  { code: 'zh-HK', name: '繁體中文（香港）', flag: 'hk' },
  { code: 'ja', name: '日本語', flag: 'jp' },
  { code: 'ko', name: '한국어', flag: 'kr' },
  { code: 'es', name: 'Español', flag: 'es' },
  { code: 'fr', name: 'Français', flag: 'fr' },
  { code: 'de', name: 'Deutsch', flag: 'de' },
  { code: 'pt-BR', name: 'Português (Brasil)', flag: 'br' },
  { code: 'ru', name: 'Русский', flag: 'ru' },
  { code: 'tr', name: 'Türkçe', flag: 'tr' },
  { code: 'id', name: 'Bahasa Indonesia', flag: 'id' },
  { code: 'vi', name: 'Tiếng Việt', flag: 'vn' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];
const DEFAULT_LOCALE: Locale = 'en';

/** 一个命名空间的文案：值是字符串、复数对象，或者再嵌套一层 */
export type MessageTree = { [key: string]: string | MessageTree };
/** 展平后的文案表：'editor.save' → '保存' */
export type Messages = Record<string, string | Record<string, string>>;

const CODES = new Set<string>(LOCALES.map((l) => l.code));
export const isLocale = (s: unknown): s is Locale => typeof s === 'string' && CODES.has(s);

/** 缺失的键依次回退：港繁 → 台繁 → 简体 → 英文 */
export function fallbackChain(locale: Locale): Locale[] {
  const chain: Locale[] = [locale];
  if (locale === 'zh-HK') chain.push('zh-TW');
  if (locale === 'zh-HK' || locale === 'zh-TW') chain.push('zh-CN');
  if (locale !== 'en') chain.push('en');
  return chain;
}

/** 浏览器语言（navigator.languages、Accept-Language）里挑出最接近的一种 */
export function matchLocale(prefs: readonly string[]): Locale {
  for (const raw of prefs) {
    const p = raw.trim().split(';')[0];
    if (!p) continue;
    const lower = p.toLowerCase();
    if (lower.startsWith('zh')) {
      if (/hk|mo/.test(lower)) return 'zh-HK';
      if (/tw|hant/.test(lower)) return 'zh-TW';
      return 'zh-CN';
    }
    if (lower.startsWith('pt')) return 'pt-BR';
    const exact = LOCALES.find((l) => l.code.toLowerCase() === lower);
    if (exact) return exact.code;
    const base = LOCALES.find((l) => l.code.split('-')[0] === lower.split('-')[0]);
    if (base) return base.code;
  }
  return DEFAULT_LOCALE;
}

/** 嵌套的 JSON 展平成 ns.a.b；只有 zero/one/two/few/many/other 键的对象视为复数形式 */
const PLURAL_KEYS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
export function flatten(ns: string, tree: MessageTree, out: Messages = {}): Messages {
  for (const [k, v] of Object.entries(tree)) {
    const key = `${ns}.${k}`;
    if (typeof v === 'string') out[key] = v;
    else if (Object.keys(v).every((x) => PLURAL_KEYS.has(x))) out[key] = v as Record<string, string>;
    else flatten(key, v, out);
  }
  return out;
}

let current: Locale = DEFAULT_LOCALE;
/** 按回退顺序排好的文案表 */
let tables: Messages[] = [];
let plural = new Intl.PluralRules(current);

/** 切换语言；messages 是按回退顺序排列的各语言文案（第一个是目标语言） */
export function setLocale(locale: Locale, messages: Messages[]): void {
  current = locale;
  tables = messages;
  plural = new Intl.PluralRules(locale);
}

export const locale = (): Locale => current;

export type Params = Record<string, string | number | undefined | null>;

/** 取文案并填入参数；找不到时返回键名，方便发现漏翻 */
export function t(key: string, params?: Params): string {
  let v: string | Record<string, string> | undefined;
  for (const tb of tables) {
    v = tb[key];
    if (v !== undefined) break;
  }
  if (v === undefined) return key;
  let s: string;
  if (typeof v === 'string') s = v;
  else {
    const n = Number(params?.count ?? 0);
    s = v[n === 0 && v.zero ? 'zero' : plural.select(n)] ?? v.other ?? '';
  }
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] == null ? m : String(params[k]))) : s;
}

/** 当前语言下的 Intl 标签；pt-BR 等直接可用 */
export const intlLocale = (): string => current;
