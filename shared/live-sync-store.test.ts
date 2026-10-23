import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test, type TestContext } from 'node:test';
import { DEFAULT_SETTINGS, type AppState } from './types.ts';
import { FALLBACK_FX } from './billing.ts';

let instance = 0;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Exercise the real store with controlled events, time and network, without a browser. */
async function client(t: TestContext, broadcast = true, boot = true) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 100_000 });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = new EventTarget();
  const navigator = { onLine: true };
  const values = new Map<string, string>();
  const posted: number[] = [];
  const channels: FakeChannel[] = [];
  class FakeChannel {
    name: string;
    onmessage?: (e: { data: { rev: number } }) => void;
    constructor(name: string) {
      this.name = name;
      channels.push(this);
    }
    postMessage(data: { rev: number }) {
      posted.push(data.rev);
    }
  }
  const prefSnapshots: Array<{ value: unknown; unsubscribe: () => void }> = [];
  t.after(() => prefSnapshots.forEach((snapshot) => snapshot.unsubscribe()));
  const globals = {
    __calendsPrefSnapshots: prefSnapshots,
    document,
    window,
    navigator,
    BroadcastChannel: broadcast ? FakeChannel : undefined,
    localStorage: {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const prev = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (prev) Object.defineProperty(globalThis, key, prev);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const hook = registerHooks({
    resolve(specifier, ctx, next) {
      // Hooks are irrelevant to lifecycle tests; this also allows reading usePref's value.
      if (specifier === 'react')
        return {
          url: 'data:text/javascript,export const useState=()=>[0,()=>{}];export const useEffect=()=>{};export const useSyncExternalStore=(subscribe,get)=>{const row={value:get()};row.unsubscribe=subscribe(()=>{row.value=get()});globalThis.__calendsPrefSnapshots.push(row);return row.value};',
          shortCircuit: true,
        };
      if (specifier === 'sonner') return { url: 'data:text/javascript,export const toast={};', shortCircuit: true };
      return next(specifier, ctx);
    },
    load(url, ctx, next) {
      if (url.endsWith('/app/src/base.ts'))
        return {
          format: 'module',
          shortCircuit: true,
          source: "export const BASE_PATH='/ledger'; export const base=p=>'/ledger'+p; export const storageKey=k=>k+':/ledger';",
        };
      return next(url, ctx);
    },
  });
  t.after(() => hook.deregister());
  const state: AppState = { rev: 0, subscriptions: [], methods: [], settings: DEFAULT_SETTINGS, fx: FALLBACK_FX, prefs: {} };
  const requests: string[] = [];
  let expired = false;
  let nextState: (() => Promise<Response>) | undefined;
  let nextWrite: (() => Promise<Response>) | undefined;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const path = url.replace('/ledger/api/', '');
    requests.push(path);
    if (expired) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (path === 'state') {
      if (nextState) {
        const fn = nextState;
        nextState = undefined;
        return fn();
      }
      return Response.json(state);
    }
    if (path === 'rev') return Response.json({ rev: state.rev });
    if (path === 'fx/backfill') return Response.json({ filled: 0, remaining: 0 });
    if (path === 'logout') return Response.json({ ok: true });
    if (nextWrite) {
      const fn = nextWrite;
      nextWrite = undefined;
      return fn();
    }
    const from = state.rev!;
    if (path === 'prefs') {
      const patch = JSON.parse(init.body as string);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete state.prefs![key];
        else state.prefs![key] = value as string;
      }
    }
    if (path.startsWith('methods/')) state.methods.push(JSON.parse(init.body as string));
    state.rev!++;
    return Response.json(path === 'prefs' ? state.prefs : {}, { headers: { 'x-calends-rev-from': String(from), 'x-calends-rev': String(state.rev) } });
  });
  const store = await import(`../app/src/store.ts?sync-test=${instance++}`);
  if (boot) {
    await store.boot();
    await store.syncFx();
  }
  const tick = async (ms: number) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  return {
    store,
    prefSnapshots,
    state,
    requests,
    values,
    posted,
    channels,
    document,
    window,
    navigator,
    tick,
    expire() {
      expired = true;
    },
    remote(prefs = state.prefs) {
      state.rev!++;
      state.prefs = prefs;
    },
    delayState(fn: () => Promise<Response>) {
      nextState = fn;
    },
    delayWrite(fn: () => Promise<Response>) {
      nextWrite = fn;
    },
  };
}

test('store checks lightweight rev every 30s, stops hidden, resumes on foreground/focus/online, and follows preferences', async (t) => {
  const c = await client(t);
  c.requests.length = 0;
  await c.tick(30_000);
  assert.deepEqual(c.requests, ['rev']);
  c.remote({ 'list-view': 'table', 'list-sort': 'name' });
  await c.tick(30_000);
  assert.equal(c.store.usePref('list-view', 'grid')[0], 'table');
  assert.deepEqual(c.requests, ['rev', 'rev', 'state']);
  c.document.visibilityState = 'hidden';
  c.document.dispatchEvent(new Event('visibilitychange'));
  const count = c.requests.length;
  await c.tick(90_000);
  assert.equal(c.requests.length, count);
  c.remote({});
  c.document.visibilityState = 'visible';
  c.document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(c.store.usePref('list-view', 'grid')[0], 'grid');
  assert.equal(c.values.has('ledger:list-view:/ledger'), false);
  await c.tick(1000);
  c.window.dispatchEvent(new Event('focus'));
  await settle();
  assert.equal(c.requests.at(-1), 'rev');
  c.navigator.onLine = false;
  c.remote({ theme: 'dark' });
  const offlineCount = c.requests.length;
  await c.tick(30_000);
  assert.equal(c.requests.length, offlineCount);
  c.navigator.onLine = true;
  c.window.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(c.store.getState().prefs?.theme, 'dark');
  await c.store.logout();
});

test('store broadcasts exact own revisions without refetch; remote hints reload immediately; no BroadcastChannel still polls', async (t) => {
  const c = await client(t);
  c.requests.length = 0;
  await c.store.saveMethod({ id: 'm', name: 'Fictional card', currency: 'USD', kind: 'bank' });
  assert.equal(c.store.getState().rev, 1);
  assert.deepEqual(c.posted, [1]);
  assert.equal(c.channels[0].name, 'calends:sync:/ledger');
  await c.store.refresh();
  assert.deepEqual(c.requests, ['methods/m', 'rev']);
  c.remote({ theme: 'dark' });
  await c.tick(1000);
  c.channels[0].onmessage!({ data: { rev: c.state.rev! } });
  await settle();
  assert.equal(c.store.getState().prefs?.theme, 'dark');
  assert.equal(c.requests.at(-1), 'state');
  await c.store.logout();
});

test('store degrades to polling when BroadcastChannel is unavailable', async (t) => {
  const c = await client(t, false);
  c.remote({ theme: 'dark' });
  await c.tick(30_000);
  assert.equal(c.store.getState().prefs?.theme, 'dark');
  await c.store.logout();
});

test('store discards a response overlapping a local write and retries; recent preferences eventually follow remote values', async (t) => {
  const c = await client(t);
  c.remote({ theme: 'dark' });
  let complete!: (response: Response) => void;
  const stale = Response.json(c.state);
  c.delayState(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const refreshing = c.store.refresh();
  await settle();
  await c.store.saveMethod({ id: 'm', name: 'Local card', currency: 'USD', kind: 'bank' });
  complete(stale);
  await refreshing;
  assert.equal(c.store.getState().methods[0].name, 'Local card');
  await c.tick(1000);
  assert.equal(c.store.getState().prefs?.theme, 'dark');
  c.store.writePref('list-view', 'grid');
  await c.tick(400);
  c.remote({ 'list-view': 'table', theme: 'light' });
  await c.tick(1000);
  await c.store.refresh();
  assert.equal(c.store.usePref('list-view', 'grid')[0], 'grid');
  assert.equal(c.store.getState().prefs?.theme, 'light');
  await c.tick(5000);
  assert.equal(c.store.usePref('list-view', 'grid')[0], 'table');
  await c.store.logout();
});

test('401 clears private state/cache and failed optimistic writes cannot restore it', async (t) => {
  const c = await client(t);
  c.expire();
  await assert.rejects(() => c.store.saveMethod({ id: 'm', name: 'Local card', currency: 'USD', kind: 'bank' }));
  assert.equal(c.store.getState(), undefined);
  assert.equal(c.values.has('ledger:state:v1:/ledger'), false);
  const count = c.requests.length;
  await c.tick(90_000);
  assert.equal(c.requests.length, count);
});

test('公开页没有认证 state 时，主题偏好快照立即更新且不发送同步写入', async (t) => {
  const c = await client(t, true, false);
  assert.equal(c.store.usePref('theme', 'system')[0], 'system');
  const snapshot = c.prefSnapshots.at(-1)!;
  c.store.writePref('theme', 'dark');
  assert.equal(snapshot.value, 'dark');
  assert.equal(c.store.usePref('theme', 'system')[0], 'dark');
  c.store.writePref('theme', null);
  assert.equal(snapshot.value, null);
  assert.equal(c.store.usePref('theme', 'system')[0], 'system');
  await c.tick(1_000);
  assert.deepEqual(c.requests, []);
});

test('改界面偏好只换偏好，不换账本对象，依赖账本的派生计算不失效', async (t) => {
  const c = await client(t);
  const before = c.store.getState();
  const snapshot = (c.store.usePref('list-view', 'grid'), c.prefSnapshots.at(-1)!);
  c.store.writePref('list-view', 'table');
  assert.equal(c.store.getState(), before, '账本对象引用不变');
  assert.equal(snapshot.value, 'table', '偏好订阅者拿到新值');
  assert.equal(c.store.getState().prefs?.['list-view'], 'table');
  await c.tick(400);
  assert.ok(c.requests.includes('prefs'), '偏好照常同步到服务端');
  await c.store.logout();
});
