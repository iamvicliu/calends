import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { addDays, diffDays, effectiveStatus, nextCharge } from '../shared/billing.ts';
import { cnDate, money } from '../shared/format.ts';
import type { AppState, Subscription } from '../shared/types.ts';
import { Icon, Sheet, SubIcon, TipLayer, Toasts } from './components/ui.tsx';
import { authStatus, boot, login, loginPasskey, run, saveSettings, setupPassword, today, useStore } from './store.ts';
import { HIDDEN_CCY, setOrig, useOrig } from './display.ts';
import { syncCategories } from './derive.ts';
import { CurrencyPicker } from './components/CurrencyPicker.tsx';
import { THEME_LABEL, ThemeIcon, useThemeMode, type ThemeMode } from './theme.tsx';
import './styles.css';
import { Calendar } from './views/Calendar.tsx';
import { Carpool } from './views/Carpool.tsx';
import { ProxyPage } from './views/Proxy.tsx';
import { PeopleView } from './views/People.tsx';
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
import { locale, t } from '../shared/i18n.ts';
import { initialLocale, loadLocale, preferredLocale } from './i18n.ts';

/** label 是 app.nav.* 的键，取用时再翻译 */
const NAV = [
  { path: '', label: 'overview', icon: 'home' },
  { path: 'list', label: 'list', icon: 'list' },
  { path: 'calendar', label: 'calendar', icon: 'cal' },
  { path: 'report', label: 'report', icon: 'chart' },
  { path: 'wallet', label: 'wallet', icon: 'wallet' },
  { path: 'family', label: 'family', icon: 'users' },
  { path: 'behalf', label: 'behalf', icon: 'swap' },
  { path: 'ai', label: 'ai', icon: 'bot' },
];

/** 侧边栏实际显示的模块：去掉设置里隐藏的；AI 接入关掉时也不显示 */
export function navOf(st: AppState['settings']) {
  return NAV.filter((n) => !(st.hiddenNav ?? []).includes(n.path) && (n.path !== 'ai' || st.aiEnabled !== false)).map((n) => ({ ...n, label: t(`app.nav.${n.label}`) }));
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
  const [status, setStatus] = useState<{ needsSetup: boolean; passkeys: number }>();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [token, setToken] = useState('');
  const [err, setErr] = useState(error);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    authStatus().then(setStatus, () => setStatus({ needsSetup: false, passkeys: 0 }));
  }, []);
  const go = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(undefined);
    try {
      await fn();
    } catch (x) {
      // 用户在系统弹窗里取消 Passkey 不算错误
      if (!(x instanceof Error && x.name === 'NotAllowedError')) setErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  };
  const setupMode = status?.needsSetup;
  const mismatch = setupMode && pw2 !== '' && pw !== pw2;
  const submit = (e: Event) => {
    e.preventDefault();
    void go(() => (setupMode ? setupPassword(token.trim(), pw) : login(pw)));
  };
  const canPasskey = !setupMode && !!status?.passkeys && typeof window.PublicKeyCredential === 'function';
  return (
    <div class="login">
      <form class="login-card fade-in" onSubmit={submit}>
        <img src="/icons/icon-192.png" alt="" />
        <h1>{t('app.name')}</h1>
        <p>{setupMode ? t('app.login.setupHint') : t('app.login.tagline')}</p>
        {setupMode && <input type="password" autoComplete="off" placeholder={t('app.login.setupToken')} value={token} onInput={(e) => setToken((e.target as HTMLInputElement).value)} />}
        <input type="password" autoFocus autoComplete={setupMode ? 'new-password' : 'current-password'} placeholder={setupMode ? t('app.login.newPassword') : t('app.login.password')} value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} />
        {setupMode && <input type="password" autoComplete="new-password" placeholder={t('app.login.again')} value={pw2} onInput={(e) => setPw2((e.target as HTMLInputElement).value)} />}
        {(err || mismatch) && <div class="red" style={{ fontSize: 13 }}>{mismatch ? t('app.login.mismatch') : err}</div>}
        <button class="btn primary lg" disabled={!status || !pw || busy || (setupMode && (!token || pw.length < 8 || pw !== pw2))}>
          {busy ? t('app.login.verifying') : setupMode ? t('app.login.setupEnter') : t('app.login.enter')}
        </button>
        {canPasskey && (
          <button type="button" class="btn lg" disabled={busy} onClick={() => go(loginPasskey)}>
            <Icon name="key" /> {t('app.login.passkey')}
          </button>
        )}
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
          {t('app.name')}
        </a>
        <button class="sb-btn" onClick={onCollapse} title={t('app.sidebar.collapse')} aria-label={t('app.sidebar.collapse')}>
          <Icon name="sidebar" />
        </button>
      </div>
      {!state.readonly && (
        <button class="side-item" onClick={onAdd}>
          <Icon name="compose" />
          <span>{t('app.sidebar.new')}</span>
          <kbd>N</kbd>
        </button>
      )}
      <button class="side-item" onClick={onSearch}>
        <Icon name="search" />
        <span>{t('app.sidebar.search')}</span>
        <kbd>⌘K</kbd>
      </button>
      <div class="side-gap" />
      {navOf(state.settings).map((n) => (
        <a key={n.path} class={`side-item ${route === n.path || (n.path === 'list' && route.startsWith('cat/')) || (n.path === 'family' && route === 'family/people') ? 'active' : ''}`} href={href(n.path)}>
          <Icon name={n.icon} />
          <span>{n.label}</span>
        </a>
      ))}
      <div class="side-scroll side-recent">
        {showUpcoming && upcoming.length > 0 && <div class="side-label">{t('app.sidebar.upcoming')}</div>}
        {showUpcoming && upcoming.map(({ s, n }) => {
          const days = diffDays(d, n!);
          return (
            <button key={s.id} class={`side-item ${days <= 3 ? 'soon' : ''}`} onClick={() => onOpen(s)}>
              <SubIcon sub={s} size={18} />
              <span>{s.name}</span>
              <small>{days === 0 ? t('app.sidebar.today') : days === 1 ? t('app.sidebar.tomorrow') : days < 7 ? t('app.sidebar.inDays', { count: days }) : cnDate(n!)}</small>
            </button>
          );
        })}
      </div>
      <div class="side-foot">
        <CurrencyItem state={state} />
        <button class="side-item theme-item" onClick={toggleTheme} title={t('app.sidebar.themeHint')}>
          <ThemeIcon mode={theme} size={17} />
          <span>{t('app.sidebar.theme')}</span>
          <small>{THEME_LABEL[theme]}</small>
        </button>
        {!state.readonly && (
          <a class={`side-item ${route === 'settings' ? 'active' : ''}`} href={href('settings')}>
            <Icon name="gear" />
            <span>{t('app.nav.settings')}</span>
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
  const pages = [...navOf(state.settings), { path: 'settings', label: t('app.nav.settings'), icon: 'gear' }].filter((n) => !lower || n.label.toLowerCase().includes(lower));
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
          <small>{t('app.palette.page')}</small>
        </>
      ),
    })),
    ...(!state.readonly && (!lower || t('app.palette.addKeywords').toLowerCase().includes(lower))
      ? [
          {
            key: 'add',
            run: onAdd,
            el: (
              <>
                <Icon name="compose" />
                {t('app.palette.add')}
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
  // autoFocus 只在首次挂载可靠，第二次打开时手动聚焦
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div class="palette" role="dialog" aria-modal="true">
        <input
          ref={input}
          placeholder={t('app.palette.placeholder')}
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
          {items.length === 0 && <div class="pal-group">{t('app.palette.empty')}</div>}
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
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      // 有弹层（编辑器、详情、搜索等）打开时，单键快捷键不生效
      if (editing || viewId || review || ics || palette || document.querySelector('[aria-modal="true"]')) return;
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
  }, [state, collapsed, editing, viewId, review, ics, palette]);

  if (phase === 'loading') return <div class="login" />;
  if (phase === 'login' || !state) return <Login error={phase === 'offline' ? t('app.offlineError', { error: error ?? '' }) : undefined} />;
  // 分类表（图标、颜色、顺序）先于各页面同步，页面里按分类名直接查
  syncCategories(state);

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
  if (route.startsWith('cat/')) view = <List key={route} state={state} today={d} onOpen={open} onAdd={add} category={route.slice(4)} />;
  else
    switch (route) {
      case 'calendar':
        view = <Calendar state={state} today={d} onOpen={open} onIcs={() => setIcs(true)} />;
        break;
      case 'list':
        view = <List key="all" state={state} today={d} onOpen={open} onAdd={add} />;
        break;
      case 'wallet':
        view = <Wallet state={state} today={d} onOpen={open} />;
        break;
      case 'family':
        view = <Carpool state={state} today={d} onOpen={open} />;
        break;
      case 'family/people':
        view = ro ? <Carpool state={state} today={d} onOpen={open} /> : <PeopleView state={state} today={d} onOpen={open} />;
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
            {t('app.offline')}
          </div>
        )}
        {collapsed && (
          <button class="sb-btn reopen" onClick={() => setCollapsed(false)} title={t('app.sidebar.expand')} aria-label={t('app.sidebar.expand')}>
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

/** 语言跟着设置走：设置变了就加载新语言包，并整棵树重新挂载 */
function Root() {
  const { state } = useStore();
  const [loc, setLoc] = useState(locale());
  const want = state ? preferredLocale(state.settings.language) : loc;
  useEffect(() => {
    if (want !== loc) void loadLocale(want).then(() => setLoc(want));
    document.title = t('app.name');
    // 跟随浏览器时，把实际用的语言记到设置里，提醒邮件和 MCP 用同一种
    if (state && !state.readonly && !state.settings.language && state.settings.languageSeen !== want) void saveSettings({ languageSeen: want }).catch(() => {});
    // 记下站点地址，定时提醒里的链接要用（本地开发不记）
    if (state && !state.readonly && state.settings.siteUrl !== location.origin && !/^http:\/\/(localhost|127\.)/.test(location.origin)) void saveSettings({ siteUrl: location.origin }).catch(() => {});
  }, [want, loc]);
  return <App key={loc} />;
}

initRouter();
void loadLocale(initialLocale()).then(() => {
  render(<Root />, document.getElementById('app')!);
  boot();
});
