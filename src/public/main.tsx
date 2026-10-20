import { render } from 'preact';
import './index.css';
import { PublicPage } from './page.tsx';

render(<PublicPage />, document.getElementById('app')!);
