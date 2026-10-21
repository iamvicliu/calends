// 订阅账本 Service Worker：每个安装前缀有独立作用域和缓存。
const VERSION = 'v5';
const ROOT = new URL(self.registration.scope).pathname;
const path = (value) => ROOT + value.replace(/^\//, '');
const PREFIX = `calends:${ROOT}:`;
const SHELL = `${PREFIX}shell-${VERSION}`;
const DATA = `${PREFIX}data-${VERSION}`;
// 与 app/src/app.tsx 的路由一致
const PAGES = /^(|login|public|overview|list|calendar|report|wallet|family|family\/people|behalf|assistant|connect|settings|cat\/[^/]+)\/?$/;
const match = async (name, request) => (await caches.open(name)).match(request);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll([ROOT, path('/manifest.webmanifest'), path('/icons/icon-192.png')])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) =>
      (k.startsWith(PREFIX) || (ROOT === '/' && /^(shell|data)-v\d+$/.test(k))) && ![SHELL, DATA].includes(k),
    ).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin) {
    // 即使根目录的旧 SW 控制了页面，也不拦截别的安装前缀的 API。
    if (!url.pathname.startsWith(ROOT)) return;
    const relative = url.pathname.slice(ROOT.length);
    if (relative.startsWith('api/')) {
      if (relative !== 'api/state') return;
      e.respondWith(
        fetch(req)
          .then((res) => {
            const copy = res.clone();
            e.waitUntil(caches.open(DATA).then((c) => res.ok ? c.put(req, copy) : res.status === 401 ? c.delete(req) : undefined));
            return res;
          })
          .catch(async () => (await match(DATA, req)) || Response.json({ error: 'offline' }, { status: 503 })),
      );
      return;
    }
    if (relative.startsWith('cal/') || relative === 'mcp' || /(?:^|\/)(api|cal|mcp)(?:\/|$)/.test(relative)) return;
  }
  if (req.mode === 'navigate') {
    // 只接管本安装的页面路由；根目录的 SW 不碰别的安装前缀（如 /claude/list）
    if (url.origin !== location.origin || !url.pathname.startsWith(ROOT) || !PAGES.test(url.pathname.slice(ROOT.length))) return;
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) e.waitUntil(caches.open(SHELL).then((c) => c.put(ROOT, copy)));
          return res;
        })
        .catch(() => match(SHELL, ROOT)),
    );
    return;
  }
  if (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com|icons\.duckduckgo\.com/.test(url.host)) {
    e.respondWith(
      match(SHELL, req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          e.waitUntil(caches.open(SHELL).then((c) => c.put(req, copy)));
        }
        return res;
      })),
    );
  }
});
