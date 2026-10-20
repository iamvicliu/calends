import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { addDays, diffDays, effectiveStatus, nextCharge } from '../shared/billing.ts';
import { cnDate, money } from '../shared/format.ts';
import type { AppState, Subscription } from '../shared/types.ts';
import { Icon, Sheet, SubIcon, TipLayer, Toasts } from './components/ui.tsx';
import { boot, login, run, saveSettings, today, useStore } from './store.ts';
import { HIDDEN_CCY, setOrig, useOrig } from './display.ts';
import { CurrencyPicker } from './components/CurrencyPicker.tsx';
import { THEME_LABEL, ThemeIcon, useThemeMode, type ThemeMode } from './theme.tsx';
import './styles.css';
import { Calendar } from './views/Calendar.tsx';
import { Carpool } from './views/Carpool.tsx';
import { ProxyPage } from './views/Proxy.tsx';
import { Ai } from './views/Ai.tsx';
import { Detail } from './views/Detail.tsx';
import { Editor, newSub } from './views/Editor.tsx';
import { List } from './views/List.tsx';
import { Overview } from './views/Overview.tsx';
import { Report } from './views/Report.tsx';
import { Review } from './views/Review.tsx';
import { IcsSheet, Settings } from './views/Settings.tsx';
import { Wallet } from './views/Wallet.tsx';
import { currentRoute, go as navigate, href, initRouter, onRoute, replaceRoute } from './router.ts';

const NAV = [
  { path: '', label: '概览', icon: 'home' },
  { path: 'list', label: '订阅', icon: 'list' },
  { path: 'calendar', label: '日历', icon: 'cal' },
  { path: 'report', label: '报告', icon: 'chart' },
  { path: 'wallet', label: '钱包', icon: 'wallet' },
  { path: 'family', label: '合租', icon: 'users' },
  { path: 'behalf', label: '代付', icon: 'swap' },
  { path: 'ai', label: 'AI 接入', icon: 'bot' },
];

/** 侧边栏实际显示的模块：去掉设置里隐藏的；AI 接入关掉时也不显示 */
export function navOf(st: AppState['settings']) {
  return NAV.filter((n) => !(st.hiddenNav ?? []).includes(n.path) && (n.path !== 'ai' || st.aiEnabled !== false));
}

function useRoute() {
  const [r, setR] = useState(currentRoute());
  useEffect(
    () =>
      onRoute(() => {
        setR(currentRoute());
        window.scrollTo({ top: 0 });
      }),
    [],
  );
  return r;
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

function Sidebar({ state, route, d, theme, toggleTheme, onOpen, onAdd, onSearch, onCollapse }: { state: AppState; route: string; d: string; theme: ThemeMode; toggleTheme: () => void; onOpen: (s: Subscription) => void; onAdd: () => void; onSearch: () => void; onCollapse: () => void }) {
  // 即将扣款：像聊天记录一样列在导航下方
  const upcoming = state.subscriptions
    .filter((s) => !s.proxy) // 代付在「代付」页单独管
    .map((s) => ({ s, n: nextCharge(s, d) }))
    .filter((x) => x.n && x.n <= addDays(d, state.settings.upcomingDays ?? 45))
    .sort((a, b) => a.n!.localeCompare(b.n!))
    .slice(0, 12);
  const showUpcoming = state.settings.sidebarUpcoming !== false;
  return (
    <aside class="sidebar">
      <div class="sb-top">
        <a class="sb-mark" href={href('')}>
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
          <span>新建</span>
          <kbd>N</kbd>
        </button>
      )}
      <button class="side-item" onClick={onSearch}>
        <Icon name="search" />
        <span>搜索</span>
        <kbd>⌘K</kbd>
      </button>
      <div class="side-gap" />
      {navOf(state.settings).map((n) => (
        <a key={n.path} class={`side-item ${route === n.path || (n.path === 'list' && route.startsWith('cat/')) ? 'active' : ''}`} href={href(n.path)}>
          <Icon name={n.icon} />
          <span>{n.label}</span>
        </a>
      ))}
      <div class="side-scroll side-recent">
        {showUpcoming && upcoming.length > 0 && <div class="side-label">即将扣款</div>}
        {showUpcoming && upcoming.map(({ s, n }) => {
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
        <CurrencyItem state={state} />
        <button class="side-item theme-item" onClick={toggleTheme} title="点击切换：亮色 → 暗色 → 跟随系统">
          <ThemeIcon mode={theme} size={17} />
          <span>主题</span>
          <small>{THEME_LABEL[theme]}</small>
        </button>
        {!state.readonly && (
          <a class={`side-item ${route === 'settings' ? 'active' : ''}`} href={href('settings')}>
            <Icon name="gear" />
            <span>设置</span>
          </a>
        )}
      </div>
    </aside>
  );
}

/**
 * 侧边栏「货币」：点开直接是下拉。原币 = 列表按各自币种显示；选一种货币 = 全站统计按它折算，列表也换成它。
 * 原币只影响显示，统计仍沿用上次选的货币。
 */
function CurrencyItem({ state }: { state: AppState }) {
  const orig = useOrig();
  const base = state.settings.baseCurrency;
  const value = orig ? 'orig' : base;
  // 常用：美元、人民币，再加订阅里实际用到的币种（含各个分段），按出现次数排；其余按代码排序，汇率接口支持的全部列出
  const count = new Map<string, number>();
  for (const s of state.subscriptions) for (const c of new Set([s.currency, ...(s.phases ?? []).map((p) => p.currency)])) count.set(c, (count.get(c) ?? 0) + 1);
  const used = [...new Set(['USD', 'CNY', ...[...count].sort((a, b) => b[1] - a[1]).map(([c]) => c)])].filter((c) => state.fx.rates[c]);
  const rest = Object.keys(state.fx.rates)
    .filter((c) => !used.includes(c) && !HIDDEN_CCY.has(c))
    .sort();
  const pick = (v: string) => {
    if (v === 'orig') return setOrig(true);
    setOrig(false);
    if (v !== base && !state.readonly) run(() => saveSettings({ baseCurrency: v }));
  };
  return <CurrencyPicker value={value} used={used} all={rest} onChange={pick} />;
}

/** ⌘K 搜索：订阅、页面、操作 */
function Palette({ state, d, onClose, onOpen, onAdd }: { state: AppState; d: string; onClose: () => void; onOpen: (s: Subscription) => void; onAdd: () => void }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const lower = q.trim().toLowerCase();
  const subs = state.subscriptions
    .filter((s) => {
      if (!lower) return true;
      // 名称、分类、标签、支付方式、地区、备注、代付对象都能搜；多个词需同时命中
      const m = state.methods.find((x) => x.id === s.methodId)?.name ?? '';
      const hay = `${s.name} ${s.category} ${s.tags.join(' ')} ${m} ${s.region ?? ''} ${s.notes ?? ''} ${s.proxy?.forName ?? ''}`.toLowerCase();
      return lower.split(/\s+/).every((w) => hay.includes(w));
    })
    .sort((a, b) => (effectiveStatus(a, d) === 'ended' ? 1 : 0) - (effectiveStatus(b, d) === 'ended' ? 1 : 0))
    .slice(0, 8);
  const pages = [...navOf(state.settings), { path: 'settings', label: '设置', icon: 'gear' }].filter((n) => !lower || n.label.includes(lower));
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
      run: () => navigate(n.path),
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
  const [theme, toggleTheme] = useThemeMode();
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [ics, setIcs] = useState(false);
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsed] = useLocalFlag('ledger:sidebar-collapsed');
  const [drawer, setDrawer] = useState(false);

  useEffect(() => setDrawer(false), [route]);
  // 启动页：打开 /admin 时按设置跳到指定页面（只在首次加载时）
  const started = useRef(false);
  useEffect(() => {
    if (!state || started.current) return;
    started.current = true;
    const sp = state.settings.startPage;
    if (sp && currentRoute() === '' && navOf(state.settings).some((n) => n.path === sp)) replaceRoute(sp);
  }, [state]);
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
      if (e.key === 'n' && state && !state.readonly) setEditing(newSub(today(), state?.settings.defaultMethodId));
      const idx = Number(e.key);
      if (state && idx >= 1 && idx <= navOf(state.settings).length) navigate(navOf(state.settings)[idx - 1].path);
    };
    const onDrawer = () => (matchMedia('(max-width: 860px)').matches ? setDrawer(true) : setCollapsed(false));
    const onAdd = () => state && !state.readonly && setEditing(newSub(today(), state?.settings.defaultMethodId));
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
    setEditing(newSub(d, state?.settings.defaultMethodId));
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
      case 'family':
        view = <Carpool state={state} today={d} onOpen={open} onEdit={edit} />;
        break;
      case 'behalf':
        view = <ProxyPage state={state} today={d} onOpen={open} />;
        break;
      case 'ai':
        view = <Ai state={state} />;
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

document.title = '订阅账本';
initRouter();
render(<App />, document.getElementById('app')!);
boot();
