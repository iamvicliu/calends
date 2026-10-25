import { base } from './base.ts';
// /public 是对外公开的只读页（不出现任何登录入口），其余地址都是需要登录的应用。
// 两边各自按需加载，样式互不影响。
if (location.pathname.replace(/\/+$/, '') === base('/public')) import('./public/main.tsx');
else import('./app.tsx');

// 记录最近一次是指针还是键盘导航：弹层关闭后焦点会回到触发它的按钮，非键盘导航时不该因此出现聚焦框
// （样式见 styles.css 的 [data-input='pointer']）。只有 Tab 和不在输入框里的方向键算键盘导航；
// 打字、Esc 关弹层、回车保存、快捷键都不算，否则填完表单关掉弹层就会冒出聚焦框
const setInput = (v: string) => (document.documentElement.dataset.input = v);
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
setInput('pointer');
addEventListener('pointerdown', () => setInput('pointer'), true);
addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Tab' || (e.key.startsWith('Arrow') && !typing(e.target))) setInput('keyboard');
  },
  true,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(base('/sw.js'), { scope: base('/') }).catch(() => {});
}
