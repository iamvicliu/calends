// 后台路由：地址形如 /admin/list、/admin/cat/AI，用 History API 切换，不带 #
const BASE = '/admin';
const EVENT = 'routechange';

/** 连接页的地址从 ai 改成了 mcp：旧设置里隐藏的 ai 按 mcp 算 */
export const navKey = (k: string) => (k === 'ai' ? 'mcp' : k);

/** 当前路由（/admin 之后的部分，不含开头的 /） */
export const currentRoute = () => decodeURIComponent(location.pathname.slice(BASE.length).replace(/^\/+|\/+$/g, ''));

/** 某个路由的完整地址，用于 <a href> */
export const href = (path: string) => (path ? `${BASE}/${path}` : BASE);

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

/** 旧链接 /admin#/list 换成 /admin/list；后台内的普通链接点击时不整页刷新 */
export function initRouter() {
  if (location.hash.startsWith('#/')) history.replaceState(null, '', href(decodeURIComponent(location.hash.slice(2))));
  // 连接页的地址从 /admin/ai 改成了 /admin/mcp
  if (currentRoute() === 'ai') history.replaceState(null, '', href('mcp'));
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.('a');
    if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin) return;
    if (a.pathname !== BASE && !a.pathname.startsWith(`${BASE}/`)) return;
    e.preventDefault();
    go(decodeURIComponent(a.pathname.slice(BASE.length).replace(/^\/+/, '')));
  });
}
