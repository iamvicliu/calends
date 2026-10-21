import { BASE_PATH as BASE } from './base.ts';
// 应用路由：地址形如 /list、/cat/AI，用 History API 切换，不带 #
const EVENT = 'routechange';

/** 按设置里的顺序排侧边栏模块；没出现在设置里的（比如以后新增的模块）按默认位置排在后面 */
export function sortNav<T>(items: T[], keyOf: (x: T) => string, order: string[] | undefined): T[] {
  const o = order ?? [];
  const rank = (x: T, i: number) => {
    const at = o.indexOf(keyOf(x));
    return at < 0 ? 1000 + i : at;
  };
  return items
    .map((x, i) => ({ x, r: rank(x, i) }))
    .sort((a, b) => a.r - b.r)
    .map((a) => a.x);
}

/** 不归前端路由管的地址：公开页单独打包，接口、MCP、日历订阅和静态文件由服务端处理 */
const isAppPath = (path: string) => !/^(public|mcp)$|^(api|cal)\//.test(path) && !/\.[\w]+$/.test(path);

/** 当前路由（部署前缀之后的部分，不含开头的 /） */
export const currentRoute = () => decodeURIComponent(location.pathname.slice(BASE.length).replace(/^\/+|\/+$/g, ''));

/** 某个路由的完整地址，用于 <a href>；可以带查询串 */
export const href = (path: string) => `${BASE}/${path}`;

/** 登录后要回到的路由：只取站内路由，防止被用来跳到别的网站 */
export const loginNext = () => {
  const next = (new URLSearchParams(location.search).get('next') ?? '').replace(/^\/+/, '');
  return next !== 'login' && isAppPath(next) ? next : '';
};

/** 替换当前地址（不留历史记录），用于启动页跳转 */
export function replaceRoute(path: string) {
  history.replaceState(null, '', href(path));
  window.dispatchEvent(new Event(EVENT));
}

export function go(path: string) {
  const url = href(path);
  if (url !== location.pathname) history.pushState(null, '', url);
  window.dispatchEvent(new Event(EVENT));
}

/** 监听路由变化：前进后退、go()；返回取消函数 */
export function onRoute(fn: () => void) {
  window.addEventListener('popstate', fn);
  window.addEventListener(EVENT, fn);
  return () => {
    window.removeEventListener('popstate', fn);
    window.removeEventListener(EVENT, fn);
  };
}

/** 应用内的普通链接点击时不整页刷新 */
export function initRouter() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.('a');
    if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin) return;
    if (a.pathname !== BASE && !a.pathname.startsWith(`${BASE}/`)) return;
    const path = decodeURIComponent(a.pathname.slice(BASE.length).replace(/^\/+|\/+$/g, ''));
    if (!isAppPath(path)) return;
    e.preventDefault();
    go(path);
  });
}
