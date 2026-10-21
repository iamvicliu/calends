// 订阅账本 Service Worker：静态资源缓存优先，数据走网络、失败回退缓存，保证离线可读。
const VERSION = 'v3';
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    // 只缓存账本状态，其它接口直连
    if (url.pathname !== '/api/state') return;
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(DATA).then((c) => c.put(req, copy));
          else if (res.status === 401) caches.open(DATA).then((c) => c.delete(req));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || Response.json({ error: 'offline' }, { status: 503 }))),
    );
    return;
  }
  if (url.pathname.startsWith('/cal/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(SHELL).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }
  // 静态资源与字体、站点图标：缓存优先
  if (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com|icons\.duckduckgo\.com/.test(url.host)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok || res.type === 'opaque') {
              const copy = res.clone();
              caches.open(SHELL).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
