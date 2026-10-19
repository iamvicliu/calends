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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (res.status === 401 && path !== '/api/login') {
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

export async function login(passcode: string): Promise<void> {
  await api('/api/login', { method: 'POST', body: JSON.stringify({ passcode }) });
  set({ phase: 'loading' });
  await boot();
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
  const next = fn(store.state!);
  cache(next);
  set({ state: next });
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
  return optimistic(
    (s) => ({ ...s, subscriptions: s.subscriptions.some((x) => x.id === sub.id) ? s.subscriptions.map((x) => (x.id === sub.id ? sub : x)) : [...s.subscriptions, sub] }),
    () => api(`/api/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify(sub) }),
  );
}

export function deleteSub(id: string) {
  return optimistic((s) => ({ ...s, subscriptions: s.subscriptions.filter((x) => x.id !== id) }), () => api(`/api/subscriptions/${id}`, { method: 'DELETE' }));
}

export function saveMethod(m: PaymentMethod) {
  return optimistic(
    (s) => ({ ...s, methods: s.methods.some((x) => x.id === m.id) ? s.methods.map((x) => (x.id === m.id ? m : x)) : [...s.methods, m] }),
    () => api(`/api/methods/${m.id}`, { method: 'PUT', body: JSON.stringify(m) }),
  );
}

export async function deleteMethod(id: string) {
  const linked = store.state!.subscriptions.filter((s) => s.methodId === id);
  await optimistic((s) => ({ ...s, methods: s.methods.filter((x) => x.id !== id) }), () => api(`/api/methods/${id}`, { method: 'DELETE' }));
  for (const s of linked) await saveSub({ ...s, methodId: undefined });
}

export function saveSettings(patch: Partial<Settings>) {
  return optimistic(
    (s) => ({ ...s, settings: { ...s.settings, ...patch } }),
    async () => {
      const settings = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify({ ...store.state!.settings, ...patch }) });
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
  const state = await api<AppState>('/api/import', { method: 'POST', body: JSON.stringify(body) });
  cache(state);
  set({ state });
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
