import { browserSupportsWebAuthnAutofill, startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import { beginPasskeyAutofill } from './passkey-autofill.ts';
import { BASE_PATH, base, storageKey } from './base.ts';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { todayIn } from '../../shared/billing.ts';
import type { AppState, PaymentMethod, Person, Settings, Subscription } from '../../shared/types.ts';
import { mergePeople, syncPerson } from '../../shared/people.ts';
import { locale, t } from '../../shared/i18n.ts';
import { renameInSubs, type Category } from '../../shared/categories.ts';
import { resyncShares } from '../../shared/carpool.ts';
import { PREF_KEYS, type PrefKey } from '../../shared/prefs.ts';
import { toast as sonner } from 'sonner';
import { advanceRevision, canApplySnapshot, CHECK_THROTTLE, shouldCheck, shouldPoll, syncedPrefs, SYNC_INTERVAL } from '../../shared/live-sync.ts';

const CACHE_KEY = storageKey('ledger:state:v1');

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
  updatePolling();
}

export function useStore(): Store {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
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

/**
 * 只换偏好，不换账本对象：视图、缩放这类界面偏好变化时，依赖 state 的账务派生（React Compiler 与 useMemo 以 state 为键）不必重算。
 * 偏好的订阅者经 usePref 按值更新；服务端同步时 replaceSyncedState 仍整体替换。
 */
function replacePrefs(prefs: NonNullable<AppState['prefs']>) {
  const st = store.state!;
  st.prefs = prefs;
  set({});
  // 整本账本序列化写缓存约十几毫秒：挪到空闲时，不和切换视图的渲染、动画抢主线程
  cacheSoon();
}
let cacheTimer: number | undefined;
function cacheSoon() {
  if (cacheTimer !== undefined) return;
  const flush = () => {
    cacheTimer = undefined;
    if (store.state) cache(store.state);
  };
  cacheTimer = typeof requestIdleCallback === 'function' ? requestIdleCallback(flush, { timeout: 2000 }) : (setTimeout(flush, 300) as unknown as number);
}

let knownRev: number | undefined;
let ownRevisions: Array<{ from: number; rev: number }> = [];
const prefEdits = new Map<string, number>();
let forceSnapshot = false;
let prefRetry: ReturnType<typeof setTimeout> | undefined;

function replaceSyncedState(state: AppState) {
  const merged = syncedPrefs(state.prefs ?? {}, store.state?.prefs ?? {}, prefEdits, prefQueue, Date.now());
  forceSnapshot = merged.retryAt > 0;
  clearTimeout(prefRetry);
  if (forceSnapshot) prefRetry = setTimeout(() => void refresh(), Math.max(CHECK_THROTTLE, merged.retryAt - Date.now()));
  knownRev = state.rev;
  ownRevisions = ownRevisions.filter((r) => knownRev === undefined || r.rev > knownRev);
  replaceState({ ...state, prefs: merged.prefs });
  mirrorPrefs();
}

function acknowledgeWrite(res: Response) {
  const rawRev = res.headers.get('x-calends-rev');
  if (rawRev === null) return;
  const rev = Number(rawRev);
  if (!Number.isSafeInteger(rev) || rev < 0) return;
  const rawFrom = res.headers.get('x-calends-rev-from');
  if (rawFrom !== null) {
    const from = Number(rawFrom);
    if (Number.isSafeInteger(from) && from >= 0 && from <= rev) ownRevisions.push({ from, rev });
    knownRev = advanceRevision(knownRev, ownRevisions);
    ownRevisions = ownRevisions.filter((r) => knownRev === undefined || r.rev > knownRev);
    if (store.state) patchState((s) => ({ ...s, rev: knownRev }));
  }
  // A gap may be another device's write; a hint-only response (FX/assistant) needs reconciliation.
  if (rev !== knownRev) checkAgain = true;
  try {
    // BroadcastChannel is origin-scoped and has no targetOrigin parameter.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    channel?.postMessage({ rev });
  } catch {
    /* BroadcastChannel may be disabled by browser policy. */
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const writing = !!init.method && init.method !== 'GET';
  if (writing) {
    writes++;
    writeSeq++;
  }
  try {
    const res = await fetch(base(path), {
      ...init,
      credentials: 'same-origin',
      // 服务端按当前界面语言返回错误等文案
      headers: { 'content-type': 'application/json', 'x-locale': locale(), ...init.headers },
    });
    if (res.status === 401 && path !== '/api/login' && !path.startsWith('/api/auth/')) {
      knownRev = undefined;
      ownRevisions = [];
      try {
        localStorage.removeItem(CACHE_KEY);
      } catch {
        /* ignore */
      }
      await globalThis.caches?.delete(`calends:${base('/')}:data-v5`).catch(() => false);
      set({ phase: 'login', state: undefined });
      throw new Error(t('ui.error.loginRequired'));
    }
    const body = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
    if (!res.ok) throw Object.assign(new Error(body.error ?? t('ui.error.requestFailed', { status: res.status })), { code: body.code });
    if (writing) acknowledgeWrite(res);
    return body;
  } finally {
    if (writing) {
      writes--;
      writeSeq++;
      resumeSync();
    }
  }
}

export async function boot(): Promise<void> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const state = JSON.parse(raw) as AppState;
      knownRev = state.rev;
      set({ phase: 'ready', state });
    }
  } catch {
    /* ignore */
  }
  try {
    const seq = writeSeq;
    const startWrites = writes;
    const state = await api<AppState>('/api/state');
    if (!state.readonly && !canApplySnapshot(startWrites, writes, seq, writeSeq, state.rev, knownRev)) {
      checkAgain = true;
      resumeSync();
      return;
    }
    knownRev = state.rev;
    ownRevisions = [];
    cache(state);
    set({ phase: 'ready', state });
    if (!state.readonly) {
      void syncFx();
      migratePrefs();
      mirrorPrefs();
    }
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
  const startWrites = writes;
  const state = await api<AppState>('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  return canApplySnapshot(startWrites, writes, seq, writeSeq, state.rev, knownRev) ? state : undefined;
}

let lastCheck = -Infinity;
let checking: Promise<void> | undefined;
let checkAgain = false;
let poll: ReturnType<typeof setInterval> | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let channel: BroadcastChannel | undefined;

function visible() {
  return typeof document !== 'undefined' && document.visibilityState === 'visible';
}

function active() {
  return !!store.state && shouldPoll(store.phase, store.state.readonly, visible());
}

function updatePolling() {
  if (active()) poll ??= setInterval(() => void refresh(), SYNC_INTERVAL);
  else {
    clearInterval(poll);
    poll = undefined;
    clearTimeout(retry);
    retry = undefined;
  }
}

function resumeSync() {
  if (checkAgain && !writes && !checking && active() && !retry) {
    retry = setTimeout(
      () => {
        retry = undefined;
        void refresh();
      },
      Math.max(0, CHECK_THROTTLE - (Date.now() - lastCheck)),
    );
  }
}

/** Visible clients check a tiny revision first; only changed snapshots replace the store. */
export function refresh(): Promise<void> {
  if (!active() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return Promise.resolve();
  if (checking) {
    checkAgain = true;
    return checking;
  }
  if (!shouldCheck(Date.now(), lastCheck, writes, true)) {
    checkAgain = true;
    resumeSync();
    return Promise.resolve();
  }
  checkAgain = false;
  lastCheck = Date.now();
  checking = (async () => {
    // Retry unsent preferences before comparing revisions after reconnecting.
    if (Object.keys(prefQueue).length && !prefTimer) {
      queuePrefs({});
      checkAgain = true;
      return;
    }
    const { rev } = await api<{ rev: number }>('/api/rev', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    // 版本号变小：服务端数据被重建或恢复过（新数据卷、备份恢复等），旧版本号不再可比，按新库重新拉取
    if (knownRev !== undefined && rev < knownRev && writes === 0) {
      knownRev = undefined;
      ownRevisions = [];
    }
    if (rev !== knownRev || forceSnapshot) {
      const state = await freshState();
      if (state) {
        replaceSyncedState(state);
        set({ phase: 'ready', error: undefined });
      } else checkAgain = true;
    } else if (store.phase === 'offline') set({ phase: 'ready', error: undefined });
  })()
    .catch(() => {
      /* Offline or expired login: retain data for offline use; api handles 401. */
    })
    .finally(() => {
      checking = undefined;
      resumeSync();
    });
  return checking;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    updatePolling();
    if (visible()) void refresh();
  });
  window.addEventListener('focus', () => void refresh());
  window.addEventListener('online', () => {
    if (store.phase === 'offline' && !store.state) void boot();
    else void refresh();
  });
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(`calends:sync:${BASE_PATH || '/'}`);
      channel.onmessage = (event: MessageEvent<{ rev?: number }>) => {
        if (Number.isSafeInteger(event.data?.rev) && event.data.rev !== knownRev) void refresh();
      };
    }
  } catch {
    /* Polling also works without BroadcastChannel. */
  }
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
      if (state) replaceSyncedState(state);
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

export const authStatus = () => api<{ needsSetup: boolean; passkeys: number; publicView: boolean }>('/api/auth/status');

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

export async function loginPasskey(useBrowserAutofill = false, signal?: AbortSignal): Promise<void> {
  const { options, challengeId } = await api<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON']; challengeId: string }>(
    '/api/auth/passkey/login/options',
    { method: 'POST', signal },
  );
  signal?.throwIfAborted();
  const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill });
  signal?.throwIfAborted();
  await api('/api/auth/passkey/login', { method: 'POST', body: JSON.stringify({ challengeId, response }), signal });
  signal?.throwIfAborted();
  set({ phase: 'loading' });
  await boot();
}

/** 条件式登录与按钮登录各取独立挑战；停止时也取消尚未返回的网络请求。 */
export function startPasskeyAutofill(): () => void {
  return beginPasskeyAutofill({
    supports: browserSupportsWebAuthnAutofill,
    login: (signal) => loginPasskey(true, signal),
    cancel: () => WebAuthnAbortService.cancelCeremony(),
  });
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
  await globalThis.caches?.delete(`calends:${base('/')}:data-v5`).catch(() => false);
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
  knownRev = undefined;
  ownRevisions = [];
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
    if (store.phase !== 'login') patchState(() => ({ ...prev, rev: knownRev }));
    throw e;
  } finally {
    writes--;
    writeSeq++;
    resumeSync();
  }
}

export function saveSub(next: Subscription) {
  // 改了开始日期或周期后，新的扣款日需要补汇率
  setTimeout(() => void syncFx(), 500);
  const st = getState();
  const sub = resyncShares(
    st,
    st.subscriptions.find((x) => x.id === next.id),
    next,
  );
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
  replaceSyncedState(await api<AppState>('/api/import', { method: 'POST', body: JSON.stringify(body) }));
}

export async function refreshFx() {
  const fx = await api<AppState['fx']>('/api/fx/refresh', { method: 'POST' });
  patchState((s) => ({ ...s, fx }));
}

// ---------- toast ----------
// 统一走 Sonner：成功、失败、提示、警告、进行中五种状态，可叠放、滑动关闭，可带「撤销」等操作按钮

export type ToastKind = 'success' | 'error' | 'info' | 'warning';
export interface ToastOptions {
  kind?: ToastKind;
  /** 第二行的补充说明 */
  description?: string;
  /** 例如「撤销」 */
  action?: { label: string; onClick: () => void };
  /** 替换已有的那条（例如把「进行中」换成结果） */
  id?: string | number;
}

export function toast(text: string, err = false, opts: ToastOptions = {}): string | number {
  const kind = err ? 'error' : (opts.kind ?? 'success');
  return sonner[kind](text, { id: opts.id, description: opts.description, action: opts.action, duration: kind === 'error' ? 5000 : 2800 });
}

/**
 * 执行一个操作并给出反馈：超过 400ms 还没完成就先显示「处理中」，完成后原地换成成功或失败。
 * ok 也可以是 ToastOptions（带撤销按钮等）。
 */
export async function run(fn: () => Promise<unknown>, ok?: string | (ToastOptions & { text: string })) {
  let pending: string | number | undefined;
  const timer = setTimeout(() => (pending = sonner.loading(t('ui.working'))), 400);
  try {
    await fn();
    clearTimeout(timer);
    if (ok) {
      const o = typeof ok === 'string' ? { text: ok } : ok;
      toast(o.text, false, { ...o, id: pending });
    } else if (pending !== undefined) sonner.dismiss(pending);
  } catch (e) {
    clearTimeout(timer);
    toast(e instanceof Error ? e.message : String(e), true, { id: pending });
  }
}

// ---------- 界面配置：服务端为准，本机留一份副本供首屏和离线用 ----------

const PREF_LS = (k: string) => storageKey(`ledger:${k}`);
const PREF_MIGRATED = storageKey('ledger:prefs:migrated');

function mirrorPrefs() {
  if (!store.state || store.state.readonly) return;
  try {
    for (const key of PREF_KEYS) {
      const value = store.state.prefs?.[key];
      if (value == null) localStorage.removeItem(PREF_LS(key));
      else localStorage.setItem(PREF_LS(key), value);
    }
  } catch {
    /* Private browsing. */
  }
}

function localPref(key: PrefKey): string | null {
  try {
    return localStorage.getItem(PREF_LS(key));
  } catch {
    return null;
  }
}

let prefQueue: Record<string, string | null> = {};
let prefTimer: ReturnType<typeof setTimeout> | undefined;

/** 改一项配置：立即生效，短暂合并后发给服务端；离线失败的留到下次一起发 */
export function writePref(key: PrefKey, value: string | null) {
  prefEdits.set(key, Date.now());
  try {
    if (value == null) localStorage.removeItem(PREF_LS(key));
    else localStorage.setItem(PREF_LS(key), value);
  } catch {
    /* 隐私模式等 */
  }
  const st = store.state;
  if (!st) return set({});
  const prefs = { ...st.prefs };
  if (value == null) delete prefs[key];
  else prefs[key] = value;
  replacePrefs(prefs);
  if (!st.readonly) queuePrefs({ [key]: value });
}

function queuePrefs(patch: Record<string, string | null>) {
  Object.assign(prefQueue, patch);
  // 等待发送期间算作写操作，期间拉回来的旧数据不覆盖本地
  if (!prefTimer) {
    writes++;
    writeSeq++;
  }
  clearTimeout(prefTimer);
  prefTimer = setTimeout(() => void flushPrefs(), 400);
}

async function flushPrefs() {
  const body = prefQueue;
  prefQueue = {};
  prefTimer = undefined;
  try {
    await api('/api/prefs', { method: 'PATCH', body: JSON.stringify(body) });
  } catch {
    prefQueue = { ...body, ...prefQueue };
    checkAgain = false; // Retry on the next poll/online event, not in a tight offline loop.
  } finally {
    writes--;
    writeSeq++;
    resumeSync();
  }
}

/** 老版本只存在本机的配置：服务端还没有的，上传一次 */
function migratePrefs() {
  try {
    if (localStorage.getItem(PREF_MIGRATED)) return;
    localStorage.setItem(PREF_MIGRATED, '1');
  } catch {
    /* Private browsing. */
  }
  const patch: Record<string, string> = {};
  for (const k of PREF_KEYS) {
    if (store.state?.prefs?.[k] != null) continue;
    try {
      const v = localStorage.getItem(PREF_LS(k));
      if (v != null) patch[k] = v;
    } catch {
      return;
    }
  }
  if (!Object.keys(patch).length) return;
  replacePrefs({ ...store.state!.prefs, ...patch });
  queuePrefs(patch);
}

/** 组件里用：值变了（本机改、别的设备改后刷新）会重新渲染 */
export function usePref<T extends string>(key: PrefKey, fallback: T, valid?: (v: string) => v is T): [T, (v: T | null) => void] {
  // 订阅实际偏好值；公开页没有 state 时，本机值变化也必须提供新的快照。
  const raw = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => (store.state ? (store.state.prefs?.[key] ?? null) : localPref(key)),
  );
  const value = raw != null && (!valid || valid(raw)) ? (raw as T) : fallback;
  return [value, (v) => writePref(key, v)];
}
