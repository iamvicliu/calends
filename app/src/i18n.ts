// 浏览器端加载语言包：每种语言打成一个独立的 chunk，用到才下载
import { createElement, Fragment } from 'react';
import { fallbackChain, flatten, isLocale, matchLocale, setLocale, t, type Locale, type MessageTree, type Messages } from '../../shared/i18n.ts';

const PACKS = import.meta.glob<{ default: Record<string, { default: MessageTree }> }>('./locales/*.ts');
const KEY = 'ledger:locale';

async function pack(loc: Locale): Promise<Messages> {
  const mod = await PACKS[`./locales/${loc}.ts`]?.();
  const out: Messages = {};
  for (const [path, file] of Object.entries(mod?.default ?? {}))
    flatten(
      path
        .split('/')
        .pop()!
        .replace(/\.json$/, ''),
      file.default,
      out,
    );
  return out;
}

/** 加载并切换到某种语言（连同回退语言） */
export async function loadLocale(loc: Locale): Promise<void> {
  const chain = fallbackChain(loc);
  setLocale(loc, await Promise.all(chain.map(pack)));
  document.documentElement.lang = loc;
  try {
    localStorage.setItem(KEY, loc);
  } catch {
    /* 隐私模式等 */
  }
}

/** 首屏先用上次的语言或浏览器语言，拿到设置后再校正 */
export function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* ignore */
  }
  return matchLocale(navigator.languages ?? [navigator.language]);
}

/** 设置里没选语言（跟随系统）时用浏览器语言 */
export const preferredLocale = (setting?: string): Locale => (isLocale(setting) ? setting : matchLocale(navigator.languages ?? [navigator.language]));

/**
 * 文案里要嵌元素时用：tx('wallet.runout', { date: <b>{d}</b> }) 把 {date} 换成 JSX 节点；
 * 只是文字的参数直接写在 params 里也行。
 */
export function tx(key: string, parts: Record<string, React.ReactNode>): React.ReactNode[] {
  const s = t(key);
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(/\{(\w+)\}/g)) {
    out.push(s.slice(last, m.index));
    out.push(m[1] in parts ? parts[m[1]] : m[0]);
    last = m.index! + m[0].length;
  }
  out.push(s.slice(last));
  // React 要求数组里的每个子节点都有 key
  return out.map((node, i) => createElement(Fragment, { key: i }, node));
}
