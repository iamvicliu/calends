import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { effectiveStatus, nextCharge, totals } from '../shared/billing.ts';
import { cnDate, money } from '../shared/format.ts';
import type { AppState, Subscription } from '../shared/types.ts';
import { Icon, Sheet, SubIcon, TipLayer, Toasts } from './components/ui.tsx';
import { boot, login, today, useStore } from './store.ts';
import './styles.css';
import { Calendar } from './views/Calendar.tsx';
import { Carpool } from './views/Carpool.tsx';
import { Detail } from './views/Detail.tsx';
import { Editor, newSub } from './views/Editor.tsx';
import { List } from './views/List.tsx';
import { Overview } from './views/Overview.tsx';
import { Receipt } from './views/Receipt.tsx';
import { IcsSheet, Settings } from './views/Settings.tsx';
import { Wallet } from './views/Wallet.tsx';

const NAV = [
  { path: '', label: '仪表板', icon: 'chart' },
  { path: 'calendar', label: '日历', icon: 'cal' },
  { path: 'list', label: '全部订阅', short: '订阅', icon: 'list' },
  { path: 'wallet', label: '钱包', icon: 'wallet' },
  { path: 'carpool', label: '拼车', icon: 'car' },
] as const;

function useRoute() {
  const get = () => decodeURIComponent(location.hash.replace(/^#\/?/, ''));
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
      <form class="login-card fade-in" onSubmit={submit}>
        <img src="/icons/icon-192.png" alt="" />
        <h1>订阅账本</h1>
        <p>每一笔订阅、每一张卡、每一辆车。</p>
        <input type="password" autoFocus autoComplete="current-password" placeholder="口令" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
        {err && <div class="red" style={{ fontSize: 13 }}>{err}</div>}
        <button class="btn primary lg" disabled={!code || busy}>
          {busy ? '验证中…' : '进入'}
        </button>
      </form>
    </div>
  );
}

function Sidebar({ state, route, d, theme, toggleTheme, onOpen }: { state: AppState; route: string; d: string; theme: string; toggleTheme: () => void; onOpen: (s: Subscription) => void }) {
  const live = state.subscriptions.filter((s) => ['active', 'trial', 'ending', 'paused'].includes(effectiveStatus(s, d)));
  const owned = state.subscriptions.filter((s) => s.share && ['active', 'trial', 'ending', 'paused'].includes(effectiveStatus(s, d)));
  const counts: Record<string, number> = { list: live.length, wallet: state.methods.length, carpool: owned.length };
  const cats = new Map<string, Subscription[]>();
  for (const s of [...state.subscriptions].sort((a, b) => a.name.localeCompare(b.name, 'zh'))) cats.set(s.category, [...(cats.get(s.category) ?? []), s]);
  const catList = [...cats.entries()].sort((a, b) => b[1].length - a[1].length);
  return (
    <aside class="sidebar">
      <div class="side-brand">
        <img src="/icons/icon-192.png" alt="" />
        <div>
          <b>订阅账本</b>
          <span>{state.settings.displayName}</span>
        </div>
      </div>
      <div class="side-scroll">
        {NAV.map((n) => (
          <a key={n.path} class={`side-item ${route === n.path ? 'active' : ''}`} href={`#/${n.path}`}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
            {counts[n.path] != null && <span class="n">{counts[n.path]}</span>}
          </a>
        ))}
        <div class="side-label">分类</div>
        {catList.map(([cat, subs]) => {
          const active = route === `cat/${cat}`;
          const nLive = subs.filter((s) => live.includes(s)).length;
          return (
            <details key={cat} class="side-group" open={active || undefined}>
              <summary class={`side-item ${active ? 'active' : ''}`} onClick={() => (location.hash = `#/cat/${encodeURIComponent(cat)}`)}>
                <Icon name="down" />
                <Icon name="tag" />
                <span>{cat}</span>
                <span class="n">{nLive}</span>
              </summary>
              <div class="side-sub">
                {subs.map((s) => {
                  const st = effectiveStatus(s, d);
                  return (
                    <button key={s.id} class={`side-item ${st === 'ended' ? 'ended' : ''}`} onClick={() => onOpen(s)}>
                      <SubIcon sub={s} size={18} />
                      <span>{s.name}</span>
                      {s.intro && s.intro.until > d && <Icon name="leaf" />}
                    </button>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
      <div class="side-foot">
        {!state.readonly && (
          <a class={`side-item ${route === 'settings' ? 'active' : ''}`} href="#/settings">
            <Icon name="gear" />
            <span>设置</span>
          </a>
        )}
        <button class="side-item" onClick={toggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          <span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
        </button>
      </div>
    </aside>
  );
}

function StatusBar({ state, d }: { state: AppState; d: string }) {
  const t = totals(state, d);
  const base = state.settings.baseCurrency;
  let next: { s: Subscription; n: string } | undefined;
  for (const s of state.subscriptions) {
    const n = nextCharge(s, d);
    if (n && (!next || n < next.n)) next = { s, n };
  }
  return (
    <footer class="statusbar">
      <span>
        订阅 <b>{t.activeCount}</b>
      </span>
      <span>
        每月合计 <b>{money(t.mrr, base)}</b>
      </span>
      <span>
        每年 <b>{money(t.mrr * 12, base, { compact: true })}</b>
      </span>
      {next && (
        <span>
          下次扣款 <b>{next.s.name}</b> · {cnDate(next.n)}
        </span>
      )}
      <span style={{ marginLeft: 'auto' }}>汇率 {state.fx.fetchedAt.slice(0, 10)}</span>
    </footer>
  );
}

function App() {
  const { phase, state, error } = useStore();
  const route = useRoute();
  const [theme, toggleTheme] = useTheme();
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState(false);
  const [ics, setIcs] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey) return;
      if (e.key === 'n' && state && !state.readonly) setEditing(newSub(today()));
      const idx = Number(e.key);
      if (idx >= 1 && idx <= NAV.length) location.hash = '#/' + NAV[idx - 1].path;
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state]);

  if (phase === 'loading') return <div class="login" />;
  if (phase === 'login' || !state) return <Login error={phase === 'offline' ? `无法连接：${error ?? ''}` : undefined} />;

  const d = today();
  const ro = !!state.readonly;
  const open = (s: Subscription) => setViewId(s.id);
  const edit = (s: Subscription) => {
    setViewId(null);
    setEditing(s);
  };
  const add = () => setEditing(newSub(d));
  const viewing = state.subscriptions.find((s) => s.id === viewId);

  let view;
  if (route.startsWith('cat/')) view = <List key={route} state={state} today={d} onOpen={open} onEdit={edit} onAdd={add} category={route.slice(4)} />;
  else
    switch (route) {
      case 'calendar':
        view = <Calendar state={state} today={d} onOpen={open} onIcs={() => setIcs(true)} />;
        break;
      case 'list':
        view = <List key="all" state={state} today={d} onOpen={open} onEdit={edit} onAdd={add} />;
        break;
      case 'wallet':
        view = <Wallet state={state} today={d} onOpen={open} />;
        break;
      case 'carpool':
        view = <Carpool state={state} today={d} onOpen={open} onEdit={edit} />;
        break;
      case 'settings':
        view = ro ? null : <Settings state={state} today={d} />;
        break;
      default:
        view = <Overview state={state} today={d} onOpen={open} onReceipt={() => setReceipt(true)} onAdd={add} />;
    }

  const tabs = [...NAV.slice(0, 4), { path: 'settings', label: '设置', icon: 'gear' }].filter((t) => !(ro && t.path === 'settings'));
  return (
    <>
      <Sidebar state={state} route={route} d={d} theme={theme} toggleTheme={toggleTheme} onOpen={open} />
      <div class="main">
        {phase === 'offline' && (
          <div class="badge orange" style={{ position: 'fixed', top: 10, right: 10, zIndex: 50 }}>
            离线
          </div>
        )}
        {view}
        <StatusBar state={state} d={d} />
      </div>

      <nav class="tabbar">
        {tabs.map((r) => (
          <a key={r.path} class={`tab ${route === r.path || (r.path === 'list' && route.startsWith('cat/')) ? 'active' : ''}`} href={`#/${r.path}`}>
            <Icon name={r.icon} />
            {'short' in r ? r.short : r.label}
          </a>
        ))}
      </nav>
      {!ro && (
        <button class="fab" onClick={add} aria-label="添加订阅">
          <Icon name="plus" />
        </button>
      )}

      {viewing && (
        <Sheet bare onClose={() => setViewId(null)}>
          <Detail sub={viewing} state={state} today={d} onEdit={() => edit(viewing)} />
        </Sheet>
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
