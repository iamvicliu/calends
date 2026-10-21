import { base } from './base.ts';
// 根路径是对外公开的只读页（不出现任何登录入口）；/admin 才是需要登录的后台。
// 两边各自按需加载，样式互不影响。
if (location.pathname === base('/admin') || location.pathname.startsWith(base('/admin/'))) {
  import('./admin.tsx');
} else {
  if (location.pathname !== base('/')) history.replaceState(null, '', base('/'));
  import('./public/main.tsx');
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(base('/sw.js'), { scope: base('/') }).catch(() => {});
}
