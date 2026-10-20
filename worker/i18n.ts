// Worker 端的语言：接口按请求头 x-locale（后台当前语言）返回文案；提醒邮件、MCP 等没有浏览器的场景按设置
import { fallbackChain, flatten, isLocale, matchLocale, setLocale, type Locale, type Messages } from '../shared/i18n.ts';
import { SERVER_MESSAGES } from '../shared/locales/server.gen.ts';
import type { Settings } from '../shared/types.ts';

const cache = new Map<Locale, Messages>();
function pack(loc: Locale): Messages {
  let m = cache.get(loc);
  if (!m) {
    m = {};
    for (const [ns, tree] of Object.entries(SERVER_MESSAGES[loc] ?? {})) flatten(ns, tree, m);
    cache.set(loc, m);
  }
  return m;
}

export function applyLocale(loc: Locale): void {
  setLocale(loc, fallbackChain(loc).map(pack));
}

/** 设置里的语言；跟随浏览器时用后台最近一次的语言 */
export function settingsLocale(s: Pick<Settings, 'language' | 'languageSeen'>): Locale {
  return isLocale(s.language) ? s.language : isLocale(s.languageSeen) ? s.languageSeen : 'en';
}

/** 请求的语言：后台请求带 x-locale；其他（公开接口、日历订阅）看 Accept-Language，再退回设置 */
export function requestLocale(req: Request, s: Pick<Settings, 'language' | 'languageSeen'>): Locale {
  const h = req.headers.get('x-locale');
  if (isLocale(h)) return h;
  const accept = req.headers.get('accept-language');
  return accept ? matchLocale(accept.split(',')) : settingsLocale(s);
}
