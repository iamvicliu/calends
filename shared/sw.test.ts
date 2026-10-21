import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function sw(root: string) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const deleted: string[] = [];
  const precached: string[][] = [];
  const pending: Promise<unknown>[] = [];
  let response: Promise<Response> | undefined;
  const keys = ['calends:/:shell-v5', 'calends:/:data-v5', 'calends:/claude/:shell-v4', 'calends:/claude/:data-v5', 'unrelated'];
  runInNewContext(readFileSync(new URL('../app/public/sw.js', import.meta.url), 'utf8'), {
    URL,
    Response,
    location: { origin: 'https://demo.example' },
    self: {
      registration: { scope: `https://demo.example${root}` },
      addEventListener: (key: string, handler: (event: unknown) => void) => {
        listeners[key] = handler;
      },
      skipWaiting() {},
      clients: { claim() {} },
    },
    caches: {
      keys: async () => keys,
      delete: async (key: string) => {
        deleted.push(key);
      },
      open: async () => ({
        addAll: async (urls: string[]) => {
          precached.push([...urls]);
        },
        match: async () => undefined,
        put: async () => {},
        delete: async () => {},
      }),
    },
    fetch: async () => new Response('online'),
  });
  const event = {
    waitUntil(p: Promise<unknown>) {
      pending.push(p);
    },
  };
  return {
    listeners,
    pending,
    deleted,
    precached,
    event,
    getResponse: () => response,
    request(path: string, mode = 'cors') {
      response = undefined;
      listeners.fetch({
        ...event,
        request: { url: `https://demo.example${path}`, method: 'GET', mode },
        respondWith(p: Promise<Response>) {
          response = p;
        },
      });
    },
  };
}

test('子路径 SW 的预缓存、旧缓存清理和 API 请求不跨安装作用域', async () => {
  const worker = sw('/claude/');
  worker.listeners.install(worker.event);
  worker.listeners.activate(worker.event);
  await Promise.all(worker.pending);
  assert.deepEqual(worker.precached[0], ['/claude/', '/claude/manifest.webmanifest', '/claude/icons/icon-192.png']);
  assert.deepEqual(worker.deleted, ['calends:/claude/:shell-v4']);
  worker.request('/api/state');
  assert.equal(worker.getResponse(), undefined);
  worker.request('/claude/api/assistant/chat');
  assert.equal(worker.getResponse(), undefined);
  worker.request('/claude/api/state');
  assert.equal((await worker.getResponse())?.status, 200);
  await Promise.all(worker.pending);
  const root = sw('/');
  root.request('/claude/api/state');
  assert.equal(root.getResponse(), undefined);
  root.request('/claude/list', 'navigate');
  assert.equal(root.getResponse(), undefined);
  for (const page of ['/', '/connect', '/cat/AI', '/login']) {
    root.request(page, 'navigate');
    assert.ok(root.getResponse(), page);
  }
  worker.request('/claude/settings', 'navigate');
  assert.ok(worker.getResponse());
});
