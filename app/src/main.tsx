import { base } from './base.ts';
// /public 是对外公开的只读页（不出现任何登录入口），其余地址都是需要登录的应用。
// 两边各自按需加载，样式互不影响。
if (location.pathname.replace(/\/+$/, '') === base('/public')) import('./public/main.tsx');
else import('./app.tsx');

// 记录最近一次是鼠标/触摸还是键盘操作：弹层关闭后焦点会回到触发它的按钮，
// 鼠标操作时不该因此出现聚焦框（样式见 styles.css 的 [data-input='pointer']）
const setInput = (v: string) => (document.documentElement.dataset.input = v);
addEventListener('pointerdown', () => setInput('pointer'), true);
addEventListener('keydown', (e) => !e.metaKey && !e.ctrlKey && setInput('keyboard'), true);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(base('/sw.js'), { scope: base('/') }).catch(() => {});
}
