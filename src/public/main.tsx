import { createRoot } from 'react-dom/client';
import './index.css';
import { PublicPage } from './page.tsx';
import { loadLocale, preferredLocale } from '../i18n.ts';

// 公开页给访客看：按访客的浏览器语言显示
void loadLocale(preferredLocale()).then(() => createRoot(document.getElementById('app')!).render(<PublicPage />));
