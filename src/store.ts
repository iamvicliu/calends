import { useEffect, useState } from 'preact/hooks';
import { todayIn } from '../shared/billing.ts';
import type { AppState, PaymentMethod, Settings, Subscription } from '../shared/types.ts';

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
  return todayIn(store.state?.settings.timezone ?? 'Asia/Shanghai');
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
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (res.status === 401 && path !== '/api/login' && !path.startsWith('/api/auth/')) {
    set({ phase: 'login' });
    throw new Error('请先登录');
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `请求失败 ${res.status}`);
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

/** 回到页面时拉一次最新数据，避免长时间开着的标签页拿旧数据保存 */
let lastRefresh = 0;
export async function refresh(): Promise<void> {
  if (store.phase !== 'ready' || Date.now() - lastRefresh < 5000) return;
  lastRefresh = Date.now();
  try {
    replaceState(await api<AppState>('/api/state'));
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
      const state = await api<AppState>('/api/state').catch(() => undefined);
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
}

export async function loginPasskey(): Promise<void> {
  const { startAuthentication } = await import('@simplewebauthn/browser');
  const { options, challengeId } = await api<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON']; challengeId: string }>('/api/auth/passkey/login/options', { method: 'POST' });
  const response = await startAuthentication({ optionsJSON: options });
  await api('/api/auth/passkey/login', { method: 'POST', body: JSON.stringify({ challengeId, response }) });
  set({ phase: 'loading' });
  await boot();
}

export async function registerPasskey(name: string): Promise<void> {
  const { startRegistration } = await import('@simplewebauthn/browser');
  const { options, challengeId } = await api<{ options: Parameters<typeof startRegistration>[0]['optionsJSON']; challengeId: string }>('/api/auth/passkey/register/options', { method: 'POST' });
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
  try {
    return await req();
  } catch (e) {
    patchState(() => prev);
    throw e;
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
  return optimistic((s) => ({ ...s, subscriptions: s.subscriptions.filter((x) => x.id !== id) }), () => api(`/api/subscriptions/${id}`, { method: 'DELETE' }));
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
  await optimistic((s) => ({ ...s, methods: s.methods.filter((x) => x.id !== id) }), () => api(`/api/methods/${id}`, { method: 'DELETE' }));
  for (const s of linked)
    await saveSub({ ...s, methodId: s.methodId === id ? undefined : s.methodId, phases: s.phases?.map((p) => (p.methodId === id ? { ...p, methodId: undefined } : p)) });
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
  const t = { id: Date.now() + Math.random(), text, err };
  toasts = [...toasts, t];
  toastListeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((x) => x !== t);
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
