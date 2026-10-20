import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { addDays, diffDays, effectiveStatus, nextCharge } from '../shared/billing.ts';
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
import { Report } from './views/Report.tsx';
import { PublicPage } from './views/Public.tsx';
import { Review } from './views/Review.tsx';
import { IcsSheet, Settings } from './views/Settings.tsx';
import { Wallet } from './views/Wallet.tsx';

const NAV = [
  { path: '', label: '概览', icon: 'home' },
  { path: 'list', label: '订阅', icon: 'list' },
  { path: 'calendar', label: '日历', icon: 'cal' },
  { path: 'report', label: '报告', icon: 'chart' },
  { path: 'wallet', label: '钱包', icon: 'wallet' },
  { path: 'carpool', label: '拼车', icon: 'car' },
];

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

function Sidebar({ state, route, d, theme, toggleTheme, onOpen, onAdd, onSearch, onCollapse }: { state: AppState; route: string; d: string; theme: string; toggleTheme: () => void; onOpen: (s: Subscription) => void; onAdd: () => void; onSearch: () => void; onCollapse: () => void }) {
  // 即将扣款：像聊天记录一样列在导航下方
  const upcoming = state.subscriptions
    .map((s) => ({ s, n: nextCharge(s, d) }))
    .filter((x) => x.n && x.n <= addDays(d, 45))
    .sort((a, b) => a.n!.localeCompare(b.n!))
    .slice(0, 12);
  return (
    <aside class="sidebar">
      <div class="sb-top">
        <a class="sb-mark" href="#/">
          <img src="/icons/icon-192.png" alt="" />
          订阅账本
        </a>
        <button class="sb-btn" onClick={onCollapse} title="收起侧边栏" aria-label="收起侧边栏">
          <Icon name="sidebar" />
        </button>
      </div>
      {!state.readonly && (
        <button class="side-item" onClick={onAdd}>
          <Icon name="compose" />
          <span>新建订阅</span>
          <kbd>N</kbd>
        </button>
      )}
      <button class="side-item" onClick={onSearch}>
        <Icon name="search" />
        <span>搜索</span>
        <kbd>⌘K</kbd>
      </button>
      <div class="side-gap" />
      {NAV.map((n) => (
        <a key={n.path} class={`side-item ${route === n.path || (n.path === 'list' && route.startsWith('cat/')) ? 'active' : ''}`} href={`#/${n.path}`}>
          <Icon name={n.icon} />
          <span>{n.label}</span>
        </a>
      ))}
      <div class="side-scroll side-recent">
        {upcoming.length > 0 && <div class="side-label">即将扣款</div>}
        {upcoming.map(({ s, n }) => {
          const days = diffDays(d, n!);
          return (
            <button key={s.id} class={`side-item ${days <= 3 ? 'soon' : ''}`} onClick={() => onOpen(s)}>
              <SubIcon sub={s} size={18} />
              <span>{s.name}</span>
              <small>{days === 0 ? '今天' : days === 1 ? '明天' : days < 7 ? `${days} 天后` : cnDate(n!)}</small>
            </button>
          );
        })}
      </div>
      <div class="side-foot">
        <button class="side-item" onClick={toggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          <span>{theme === 'dark' ? '浅色' : '深色'}外观</span>
        </button>
        {!state.readonly && (
          <a class="me" href="#/settings">
            <span class="avatar">{[...state.settings.displayName][0]?.toUpperCase()}</span>
            <span class="who">
              <b>{state.settings.displayName}</b>
              <small>设置与提醒</small>
            </span>
          </a>
        )}
      </div>
    </aside>
  );
}

/** ⌘K 搜索：订阅、页面、操作 */
function Palette({ state, d, onClose, onOpen, onAdd }: { state: AppState; d: string; onClose: () => void; onOpen: (s: Subscription) => void; onAdd: () => void }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const lower = q.trim().toLowerCase();
  const subs = state.subscriptions
    .filter((s) => !lower || `${s.name} ${s.category} ${s.tags.join(' ')}`.toLowerCase().includes(lower))
    .sort((a, b) => (effectiveStatus(a, d) === 'ended' ? 1 : 0) - (effectiveStatus(b, d) === 'ended' ? 1 : 0))
    .slice(0, 8);
  const pages = [...NAV, { path: 'settings', label: '设置', icon: 'gear' }].filter((n) => !lower || n.label.includes(lower));
  const items: Array<{ key: string; run: () => void; el: preact.JSX.Element }> = [
    ...subs.map((s) => ({
      key: s.id,
      run: () => onOpen(s),
      el: (
        <>
          <SubIcon sub={s} size={24} />
          {s.name}
          <small>{money(s.price, s.currency)}</small>
        </>
      ),
    })),
    ...pages.map((n) => ({
      key: n.path,
      run: () => (location.hash = `#/${n.path}`),
      el: (
        <>
          <Icon name={n.icon} />
          {n.label}
          <small>页面</small>
        </>
      ),
    })),
    ...(!state.readonly && (!lower || '新建添加'.includes(lower))
      ? [
          {
            key: 'add',
            run: onAdd,
            el: (
              <>
                <Icon name="compose" />
                新建订阅
                <small>N</small>
              </>
            ),
          },
        ]
      : []),
  ];
  const go = (k: number) => {
    items[k]?.run();
    onClose();
  };
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="palette" role="dialog" aria-modal="true">
        <input
          autoFocus
          placeholder="搜索订阅或页面…"
          value={q}
          onInput={(e) => {
            setQ((e.target as HTMLInputElement).value);
            setI(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setI(Math.min(items.length - 1, i + 1)));
            if (e.key === 'ArrowUp') (e.preventDefault(), setI(Math.max(0, i - 1)));
            if (e.key === 'Enter') go(i);
            if (e.key === 'Escape') onClose();
          }}
        />
        <div class="palette-list">
          {items.length === 0 && <div class="pal-group">没有结果</div>}
          {items.map((it, k) => (
            <button key={it.key} class={`pal-item ${k === i ? 'on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => go(k)}>
              {it.el}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function useLocalFlag(key: string): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  return [
    v,
    (nv: boolean) => {
      setV(nv);
      try {
        localStorage.setItem(key, nv ? '1' : '0');
      } catch {
        /* ignore */
      }
    },
  ];
}

function App() {
  const { phase, state, error } = useStore();
  const route = useRoute();
  const [theme, toggleTheme] = useTheme();
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [ics, setIcs] = useState(false);
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsed] = useLocalFlag('ledger:sidebar-collapsed');
  const [drawer, setDrawer] = useState(false);

  useEffect(() => setDrawer(false), [route]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setCollapsed(!collapsed);
        return;
      }
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey) return;
      if (e.key === 'n' && state && !state.readonly) setEditing(newSub(today()));
      const idx = Number(e.key);
      if (idx >= 1 && idx <= NAV.length) location.hash = '#/' + NAV[idx - 1].path;
    };
    const onDrawer = () => (matchMedia('(max-width: 860px)').matches ? setDrawer(true) : setCollapsed(false));
    const onAdd = () => state && !state.readonly && setEditing(newSub(today()));
    document.addEventListener('keydown', onKey);
    window.addEventListener('ledger:drawer', onDrawer);
    window.addEventListener('ledger:add', onAdd);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('ledger:drawer', onDrawer);
      window.removeEventListener('ledger:add', onAdd);
    };
  }, [state, collapsed]);

  if (phase === 'loading') return <div class="login" />;
  if (phase === 'login' || !state) return <Login error={phase === 'offline' ? `无法连接：${error ?? ''}` : undefined} />;

  const d = today();
  const ro = !!state.readonly;
  const open = (s: Subscription) => {
    setDrawer(false);
    setViewId(s.id);
  };
  const edit = (s: Subscription) => {
    setViewId(null);
    setEditing(s);
  };
  const add = () => {
    setDrawer(false);
    setEditing(newSub(d));
  };
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
      case 'report':
        view = <Report state={state} today={d} onOpen={open} onReview={() => setReview(true)} />;
        break;
      case 'settings':
        view = ro ? null : <Settings state={state} today={d} />;
        break;
      default:
        view = <Overview state={state} today={d} onOpen={open} onAdd={add} />;
    }

  return (
    <div class={`app ${collapsed ? 'collapsed' : ''} ${drawer ? 'drawer' : ''}`}>
      <Sidebar
        state={state}
        route={route}
        d={d}
        theme={theme}
        toggleTheme={toggleTheme}
        onOpen={open}
        onAdd={add}
        onSearch={() => {
          setDrawer(false);
          setPalette(true);
        }}
        onCollapse={() => (drawer ? setDrawer(false) : setCollapsed(true))}
      />
      <div class="drawer-scrim" onClick={() => setDrawer(false)} />
      <div class="main">
        {phase === 'offline' && (
          <div class="badge orange" style={{ position: 'fixed', top: 10, right: 10, zIndex: 50 }}>
            离线
          </div>
        )}
        {collapsed && (
          <button class="sb-btn reopen" onClick={() => setCollapsed(false)} title="展开侧边栏" aria-label="展开侧边栏">
            <Icon name="sidebar" />
          </button>
        )}
        {view}
      </div>

      {viewing && (
        <Sheet bare onClose={() => setViewId(null)}>
          <Detail sub={viewing} state={state} today={d} onEdit={() => edit(viewing)} />
        </Sheet>
      )}
      {editing && <Editor key={editing.id} sub={editing} state={state} today={d} onClose={() => setEditing(null)} />}
      {review && <Review state={state} today={d} onClose={() => setReview(false)} />}
      {ics && <IcsSheet state={state} onClose={() => setIcs(false)} />}
      {palette && <Palette state={state} d={d} onClose={() => setPalette(false)} onOpen={open} onAdd={add} />}
      <Toasts />
      <TipLayer />
    </div>
  );
}

// 根路径是对外公开的只读页（不出现任何登录入口）；/admin 才是需要登录的后台
if (location.pathname.startsWith('/admin')) {
  render(<App />, document.getElementById('app')!);
  boot();
} else {
  if (location.pathname !== '/') history.replaceState(null, '', '/');
  render(<PublicPage />, document.getElementById('app')!);
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
