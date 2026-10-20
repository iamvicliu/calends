import { useEffect, useState } from 'preact/hooks';
import { todayIn } from '../shared/billing.ts';
import type { AppState, PaymentMethod, Person, Settings, Subscription } from '../shared/types.ts';
import { mergePeople, syncPerson } from '../shared/people.ts';
import { locale, t } from '../shared/i18n.ts';
import { renameInSubs, type Category } from '../shared/categories.ts';

const CACHE_KEY = 'ledger:state:v1';

type Phase = 'loading' | 'login' | 'ready' | 'offline';

interface Store {
  phase: Phase;
  state?: AppState;
  error?: string;
}

let store: Store = { phase: 'loading' };
const listeners = new Set<() => void>();

function set(patch: Partial<Store>) {
  store = { ...store, ...patch };
  listeners.forEach((l) => l());
}

export function useStore(): Store {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return store;
}

export function getState(): AppState {
  return store.state!;
}

export function today(): string {
  return todayIn(store.state?.settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
}

function cache(state: AppState) {
  try {
    if (!state.readonly) localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {
    /* 隐私模式等 */
  }
}

/** 换上服务端返回的最新数据，并写入本地缓存 */
function replaceState(state: AppState) {
  cache(state);
  set({ state });
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    // 服务端按当前界面语言返回错误等文案
    headers: { 'content-type': 'application/json', 'x-locale': locale(), ...init.headers },
  });
  if (res.status === 401 && path !== '/api/login' && !path.startsWith('/api/auth/')) {
    set({ phase: 'login' });
    throw new Error(t('ui.error.loginRequired'));
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? t('ui.error.requestFailed', { status: res.status }));
  return body;
}

export async function boot(): Promise<void> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) set({ phase: 'ready', state: JSON.parse(raw) });
  } catch {
    /* ignore */
  }
  try {
    const state = await api<AppState>('/api/state');
    cache(state);
    set({ phase: 'ready', state });
    if (!state.readonly) void syncFx();
  } catch (e) {
    if (store.phase === 'login') {
      // 401 时丢弃旧缓存，避免他人设备残留数据
      try {
        localStorage.removeItem(CACHE_KEY);
      } catch {
        /* ignore */
      }
      set({ state: undefined });
      return;
    }
    if (store.state) set({ phase: 'offline' });
    else set({ phase: 'offline', error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * 只把这次表单里真正改动的字段合并到最新数据上：
 * 打开表单期间别处（另一个标签页、同步脚本）改过的其他字段不会被旧数据覆盖。
 */
export function mergeEdits<T extends { id: string }>(original: T, edited: T, latest: T | undefined): T {
  if (!latest) return edited;
  const out: Record<string, unknown> = { ...latest };
  const keys = new Set([...Object.keys(original), ...Object.keys(edited)]);
  for (const k of keys) {
    const a = (original as Record<string, unknown>)[k];
    const b = (edited as Record<string, unknown>)[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = b;
  }
  return out as T;
}

/**
 * 写操作计数：读取整份状态的请求如果发出时或返回前有写操作在进行，返回的就是旧数据，不能拿来覆盖本地。
 * 典型场景：点「暂停」的同一次点击让窗口获得焦点触发刷新，GET 先于 PUT 返回。
 */
let writes = 0;
let writeSeq = 0;
async function freshState(): Promise<AppState | undefined> {
  const seq = writeSeq;
  const state = await api<AppState>('/api/state');
  return writes > 0 || seq !== writeSeq ? undefined : state;
}

/** 回到页面时拉一次最新数据，避免长时间开着的标签页拿旧数据保存 */
let lastRefresh = 0;
export async function refresh(): Promise<void> {
  if (store.phase !== 'ready' || Date.now() - lastRefresh < 5000) return;
  lastRefresh = Date.now();
  try {
    const state = await freshState();
    if (state) replaceState(state);
  } catch {
    /* 离线时保留当前数据 */
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void refresh());
  window.addEventListener('focus', () => void refresh());
}

let syncing: Promise<void> | undefined;

/** 补齐扣款日的历史汇率：后台分批，补到新数据后刷新一次 */
export function syncFx(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    let filled = 0;
    for (let i = 0; i < 30; i++) {
      const r = await api<{ filled: number; remaining: number }>('/api/fx/backfill', { method: 'POST' }).catch(() => undefined);
      if (!r) break;
      filled += r.filled;
      if (r.remaining <= 0 || r.filled === 0) break;
    }
    if (filled > 0) {
      const state = await freshState().catch(() => undefined);
      if (state) replaceState(state);
    }
  })().finally(() => {
    syncing = undefined;
  });
  return syncing;
}

export async function login(password: string): Promise<void> {
  await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
  set({ phase: 'loading' });
  await boot();
}

export const authStatus = () => api<{ needsSetup: boolean; passkeys: number }>('/api/auth/status');

/** 首次设置密码（需要部署时配置的初始化令牌） */
export async function setupPassword(setupToken: string, password: string): Promise<void> {
  await api('/api/auth/setup', { method: 'POST', body: JSON.stringify({ setupToken, password }) });
  set({ phase: 'loading' });
  await boot();
  // 新部署：按浏览器的时区和地区猜好本位币，之后可在设置里改
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const ccy = guessCurrency();
  if (store.state) await saveSettings({ ...(tz ? { timezone: tz } : {}), ...(ccy ? { baseCurrency: ccy } : {}) }).catch(() => {});
}

/** 按浏览器语言里的地区猜本位币，例如 zh-CN → CNY、en-GB → GBP；猜不出时返回 undefined */
function guessCurrency(): string | undefined {
  const MAP: Record<string, string> = {
    CN: 'CNY',
    US: 'USD',
    GB: 'GBP',
    HK: 'HKD',
    TW: 'TWD',
    JP: 'JPY',
    KR: 'KRW',
    SG: 'SGD',
    AU: 'AUD',
    CA: 'CAD',
    IN: 'INR',
    TR: 'TRY',
    RU: 'RUB',
    BR: 'BRL',
    ID: 'IDR',
    VN: 'VND',
    PH: 'PHP',
    TH: 'THB',
    MY: 'MYR',
    NG: 'NGN',
    CH: 'CHF',
    UA: 'UAH',
    KZ: 'KZT',
    PK: 'PKR',
    EG: 'EGP',
    AR: 'ARS',
    DE: 'EUR',
    FR: 'EUR',
    ES: 'EUR',
    IT: 'EUR',
    NL: 'EUR',
    PT: 'EUR',
    AT: 'EUR',
    BE: 'EUR',
    IE: 'EUR',
    FI: 'EUR',
    GR: 'EUR',
  };
  for (const l of navigator.languages ?? [navigator.language]) {
    try {
      const region = new Intl.Locale(l).maximize().region;
      if (region && MAP[region]) return MAP[region];
    } catch {
      /* 非法的语言标签 */
    }
  }
  return undefined;
}

export async function loginPasskey(): Promise<void> {
  const { startAuthentication } = await import('@simplewebauthn/browser');
  const { options, challengeId } = await api<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON']; challengeId: string }>(
    '/api/auth/passkey/login/options',
    { method: 'POST' },
  );
  const response = await startAuthentication({ optionsJSON: options });
  await api('/api/auth/passkey/login', { method: 'POST', body: JSON.stringify({ challengeId, response }) });
  set({ phase: 'loading' });
  await boot();
}

export async function registerPasskey(name: string): Promise<void> {
  const { startRegistration } = await import('@simplewebauthn/browser');
  const { options, challengeId } = await api<{ options: Parameters<typeof startRegistration>[0]['optionsJSON']; challengeId: string }>(
    '/api/auth/passkey/register/options',
    { method: 'POST' },
  );
  const response = await startRegistration({ optionsJSON: options });
  await api('/api/auth/passkey/register', { method: 'POST', body: JSON.stringify({ challengeId, response, name }) });
}

export async function logout(): Promise<void> {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  await globalThis.caches?.delete('data-v1').catch(() => false);
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
  set({ phase: 'login', state: undefined });
}

function patchState(fn: (s: AppState) => AppState) {
  replaceState(fn(store.state!));
}

/** 按 id 替换列表里的一项，没有就追加 */
function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
}

/** 乐观更新：先改本地，失败回滚 */
async function optimistic<T>(fn: (s: AppState) => AppState, req: () => Promise<T>): Promise<T> {
  const prev = store.state!;
  patchState(fn);
  writes++;
  writeSeq++;
  try {
    return await req();
  } catch (e) {
    patchState(() => prev);
    throw e;
  } finally {
    writes--;
    writeSeq++;
  }
}

export function saveSub(sub: Subscription) {
  // 改了开始日期或周期后，新的扣款日需要补汇率
  setTimeout(() => void syncFx(), 500);
  return optimistic(
    (s) => ({ ...s, subscriptions: upsertById(s.subscriptions, sub) }),
    () => api(`/api/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify(sub) }),
  );
}

export function deleteSub(id: string) {
  return optimistic(
    (s) => ({ ...s, subscriptions: s.subscriptions.filter((x) => x.id !== id) }),
    () => api(`/api/subscriptions/${id}`, { method: 'DELETE' }),
  );
}

/** 钱包卡片换顺序：按新顺序重写每张卡的 order */
export function reorderMethods(ids: string[]) {
  const prev = store.state!.methods;
  const next = ids.map((id, i) => ({ ...prev.find((m) => m.id === id)!, order: i }));
  // 全部重写，避免本地数据过期时出现重复的序号
  return optimistic(
    (s) => ({ ...s, methods: next }),
    () => Promise.all(next.map((m) => api(`/api/methods/${m.id}`, { method: 'PUT', body: JSON.stringify(m) }))),
  );
}

export function saveMethod(m: PaymentMethod) {
  return optimistic(
    (s) => ({ ...s, methods: upsertById(s.methods, m) }),
    () => api(`/api/methods/${m.id}`, { method: 'PUT', body: JSON.stringify(m) }),
  );
}

export async function deleteMethod(id: string) {
  // 订阅本身和它的各个阶段都可能引用这张卡，一并清掉
  const linked = store.state!.subscriptions.filter((s) => s.methodId === id || s.phases?.some((p) => p.methodId === id));
  await optimistic(
    (s) => ({ ...s, methods: s.methods.filter((x) => x.id !== id) }),
    () => api(`/api/methods/${id}`, { method: 'DELETE' }),
  );
  for (const s of linked)
    await saveSub({
      ...s,
      methodId: s.methodId === id ? undefined : s.methodId,
      phases: s.phases?.map((p) => (p.methodId === id ? { ...p, methodId: undefined } : p)),
    });
}

/** 换上服务端改过的订阅（同步人的资料、合并时一次改好几条） */
const withSubs = (s: AppState, subs: Subscription[]): AppState => ({ ...s, subscriptions: s.subscriptions.map((x) => subs.find((y) => y.id === x.id) ?? x) });

/** 保存一个人：称呼、联系方式同步到所有引用他的成员、代付上（本地先同步，服务端再同步一遍并返回结果） */
export async function savePerson(p: Person) {
  const r = await optimistic(
    (s) => withSubs({ ...s, people: upsertById(s.people ?? [], p) }, syncPerson(s.subscriptions, p)),
    () => api<{ person: Person; subscriptions: Subscription[] }>(`/api/people/${p.id}`, { method: 'PUT', body: JSON.stringify(p) }),
  );
  patchState((s) => withSubs({ ...s, people: upsertById(s.people ?? [], r.person) }, r.subscriptions));
  return r.person;
}

/** 删除一个人：只能删没有被任何合租、代付引用的（服务端会再检查一次） */
export function deletePerson(id: string) {
  return optimistic(
    (s) => ({ ...s, people: (s.people ?? []).filter((x) => x.id !== id) }),
    () => api(`/api/people/${id}`, { method: 'DELETE' }),
  );
}

/** 把 from 合并到 into：引用全部改指向 into，from 从名册里去掉 */
export async function mergePerson(from: string, into: string) {
  const r = await optimistic(
    (s) => {
      const m = mergePeople(s.people ?? [], s.subscriptions, from, into);
      return withSubs({ ...s, people: m.people }, m.subs);
    },
    () => api<{ people: Person[]; subscriptions: Subscription[] }>(`/api/people/${from}/merge`, { method: 'POST', body: JSON.stringify({ into }) }),
  );
  patchState((s) => withSubs({ ...s, people: r.people }, r.subscriptions));
}

export function saveSettings(patch: Partial<Settings>) {
  return optimistic(
    (s) => ({ ...s, settings: { ...s.settings, ...patch } }),
    async () => {
      // 清空的字段（undefined）以 null 传给服务端，否则 JSON 会丢掉这个键，旧值留在库里
      const body = JSON.stringify(Object.fromEntries(Object.entries({ ...store.state!.settings, ...patch }).map(([k, v]) => [k, v === undefined ? null : v])));
      const settings = await api<Settings>('/api/settings', { method: 'PUT', body });
      patchState((s) => ({ ...s, settings }));
      return settings;
    },
  );
}

/**
 * 保存分类表（顺序即显示顺序）。renames 是旧名 → 新名：改名、删除分类时把订阅移过去，服务端一次改写所有相关订阅。
 * 返回改动了几个订阅。
 */
export function saveCategories(categories: Category[], renames: Record<string, string> = {}) {
  const swap = (subs: Subscription[], changed: Subscription[]) => {
    const by = new Map(changed.map((x) => [x.id, x]));
    return subs.map((x) => by.get(x.id) ?? x);
  };
  return optimistic(
    (s) => ({ ...s, settings: { ...s.settings, categories }, subscriptions: swap(s.subscriptions, renameInSubs(s.subscriptions, renames)) }),
    async () => {
      const r = await api<{ settings: Settings; subscriptions: Subscription[] }>('/api/categories', {
        method: 'PUT',
        body: JSON.stringify({ categories, renames }),
      });
      patchState((s) => ({ ...s, settings: r.settings, subscriptions: swap(s.subscriptions, r.subscriptions) }));
      return r.subscriptions.length;
    },
  );
}

export async function rotateIcs() {
  const settings = await api<Settings>('/api/ics/rotate', { method: 'POST' });
  patchState((s) => ({ ...s, settings }));
}

export async function importData(body: { subscriptions: Subscription[]; methods: PaymentMethod[]; mode: 'merge' | 'replace' }) {
  replaceState(await api<AppState>('/api/import', { method: 'POST', body: JSON.stringify(body) }));
}

export async function refreshFx() {
  const fx = await api<AppState['fx']>('/api/fx/refresh', { method: 'POST' });
  patchState((s) => ({ ...s, fx }));
}

// ---------- toast ----------

export interface Toast {
  id: number;
  text: string;
  err?: boolean;
}
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
export function toast(text: string, err = false) {
  const item = { id: Date.now() + Math.random(), text, err };
  toasts = [...toasts, item];
  toastListeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((x) => x !== item);
    toastListeners.forEach((l) => l());
  }, 2600);
}
export function useToasts(): Toast[] {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    toastListeners.add(l);
    return () => toastListeners.delete(l);
  }, []);
  return toasts;
}

export async function run(fn: () => Promise<unknown>, ok?: string) {
  try {
    await fn();
    if (ok) toast(ok);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), true);
  }
}
