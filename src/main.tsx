// 根路径是对外公开的只读页（不出现任何登录入口）；/admin 才是需要登录的后台。
// 两边各自按需加载，样式互不影响。
if (location.pathname.startsWith('/admin')) {
  import('./admin.tsx');
} else {
  if (location.pathname !== '/') history.replaceState(null, '', '/');
  import('./public/main.tsx');
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
