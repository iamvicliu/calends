import { render } from 'preact';
import './index.css';
import { PublicPage } from './page.tsx';
import { loadLocale, preferredLocale } from '../i18n.ts';

// 公开页给访客看：按访客的浏览器语言显示
void loadLocale(preferredLocale()).then(() => render(<PublicPage />, document.getElementById('app')!));
