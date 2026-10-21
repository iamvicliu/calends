import { base } from './base.ts';
// /public 是对外公开的只读页（不出现任何登录入口），其余地址都是需要登录的应用。
// 两边各自按需加载，样式互不影响。
if (location.pathname.replace(/\/+$/, '') === base('/public')) import('./public/main.tsx');
else import('./app.tsx');

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(base('/sw.js'), { scope: base('/') }).catch(() => {});
}
