import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Subscription } from '../shared/types.ts';
import { Icon, TipLayer, Toasts } from './components/ui.tsx';
import { boot, login, today, useStore } from './store.ts';
import './styles.css';
import { Calendar } from './views/Calendar.tsx';
import { Carpool } from './views/Carpool.tsx';
import { Editor, newSub } from './views/Editor.tsx';
import { List } from './views/List.tsx';
import { Overview } from './views/Overview.tsx';
import { Receipt } from './views/Receipt.tsx';
import { IcsSheet, Settings } from './views/Settings.tsx';
import { Wallet } from './views/Wallet.tsx';

const ROUTES = [
  { path: '', label: '总览', icon: 'home' },
  { path: 'calendar', label: '日历', icon: 'cal' },
  { path: 'list', label: '订阅', icon: 'list' },
  { path: 'wallet', label: '钱包', icon: 'wallet' },
  { path: 'carpool', label: '拼车', icon: 'car' },
  { path: 'settings', label: '设置', icon: 'gear' },
] as const;

function useRoute() {
  const get = () => location.hash.replace(/^#\/?/, '');
  const [r, setR] = useState(get());
  useEffect(() => {
    const on = () => {
      setR(get());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

function useTheme(): [string, () => void] {
  const sys = () => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [t, setT] = useState(document.documentElement.dataset.theme ?? sys());
  return [
    t,
    () => {
      const next = t === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem('ledger:theme', next);
      } catch {
        /* ignore */
      }
      setT(next);
    },
  ];
}

function Login({ error }: { error?: string }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState(error);
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setErr(undefined);
    try {
      await login(code);
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="login">
      <form class="card fade-in" onSubmit={submit}>
        <div class="eyebrow">Subscription Ledger</div>
        <h1 class="h1" style={{ fontSize: 40, margin: '16px 0 8px' }}>
          订阅账本
        </h1>
        <p class="muted" style={{ margin: '0 0 24px', fontSize: 14 }}>
          负 MRR、扣款日历、余额续航与拼车分摊。这是私人账本，请输入口令。
        </p>
        <input class="input" type="password" autoFocus autoComplete="current-password" placeholder="口令" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
        {err && <div class="warn" style={{ fontSize: 13, marginTop: 10 }}>{err}</div>}
        <button class="btn primary" style={{ width: '100%', marginTop: 16 }} disabled={!code || busy}>
          {busy ? '验证中…' : '进入'}
        </button>
      </form>
    </div>
  );
}

function App() {
  const { phase, state, error } = useStore();
  const route = useRoute();
  const [theme, toggleTheme] = useTheme();
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [receipt, setReceipt] = useState(false);
  const [ics, setIcs] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey) return;
      if (e.key === 'n' && state && !state.readonly) setEditing(newSub(today()));
      const idx = Number(e.key);
      if (idx >= 1 && idx <= ROUTES.length) location.hash = '#/' + ROUTES[idx - 1].path;
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state]);

  if (phase === 'loading')
    return (
      <div class="login">
        <div class="eyebrow">Loading ledger…</div>
      </div>
    );
  if (phase === 'login' || !state) return <Login error={phase === 'offline' ? `无法连接：${error ?? ''}` : undefined} />;

  const d = today();
  const ro = !!state.readonly;
  const open = (s: Subscription) => setEditing(s);
  const add = () => setEditing(newSub(d));
  const current = ROUTES.find((r) => r.path === route) ?? ROUTES[0];

  let view;
  switch (current.path) {
    case 'calendar':
      view = <Calendar state={state} today={d} onOpen={open} onIcs={() => setIcs(true)} />;
      break;
    case 'list':
      view = <List state={state} today={d} onOpen={open} />;
      break;
    case 'wallet':
      view = <Wallet state={state} today={d} onOpen={open} />;
      break;
    case 'carpool':
      view = <Carpool state={state} today={d} onOpen={open} onNew={add} />;
      break;
    case 'settings':
      view = ro ? <List state={state} today={d} onOpen={open} /> : <Settings state={state} today={d} />;
      break;
    default:
      view = <Overview state={state} today={d} onOpen={open} onReceipt={() => setReceipt(true)} />;
  }

  return (
    <>
      <nav class="nav">
        <a class="brand" href="#/">
          <span class="brand-mark">订</span>
          <span class="brand-name">订阅账本</span>
        </a>
        <div class="nav-links">
          {ROUTES.filter((r) => !(ro && r.path === 'settings')).map((r) => (
            <a key={r.path} class={`nav-link ${current === r ? 'active' : ''}`} href={`#/${r.path}`}>
              {r.label}
            </a>
          ))}
        </div>
        <div class="nav-actions">
          {phase === 'offline' && (
            <span class="badge warn" style={{ alignSelf: 'center' }}>
              离线
            </span>
          )}
          <button class="icon-btn" onClick={toggleTheme} aria-label="切换主题">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          {!ro && (
            <button class="icon-btn solid add-desktop" onClick={add} aria-label="添加订阅" title="添加订阅（N）">
              <Icon name="plus" />
            </button>
          )}
          {!ro && (
            <a class="icon-btn mobile-only" href="#/settings" aria-label="设置">
              <Icon name="gear" />
            </a>
          )}
        </div>
      </nav>

      <main>{view}</main>

      <nav class="tabbar">
        {ROUTES.filter((r) => r.path !== 'settings').map((r) => (
            <a key={r.path} class={`tab ${current === r ? 'active' : ''}`} href={`#/${r.path}`}>
              <Icon name={r.icon} />
              {r.label}
            </a>
        ))}
      </nav>
      {!ro && (
        <button class="fab" onClick={add} aria-label="添加订阅">
          <Icon name="plus" />
        </button>
      )}

      {editing && <Editor key={editing.id} sub={editing} state={state} today={d} onClose={() => setEditing(null)} />}
      {receipt && <Receipt state={state} today={d} onClose={() => setReceipt(false)} />}
      {ics && <IcsSheet state={state} onClose={() => setIcs(false)} />}
      <Toasts />
      <TipLayer />
    </>
  );
}

render(<App />, document.getElementById('app')!);
boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
