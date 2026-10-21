import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { demoState } from './demo.ts';
import { subError } from './billing.ts';
import { ensureDemo, resetDemo } from '../worker/demo.ts';
import { loadState } from '../worker/store.ts';
import { MIGRATIONS } from '../worker/migrations.gen.ts';
import type { Env } from '../worker/env.ts';

// Worker 由 Wrangler 加载 JSON 文案；Node 测试使用同一份文案，不另造响应替身。
registerHooks({
  load(url, context, next) {
    if (url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
    return next(url, context);
  },
});
const { default: worker } = await import('../worker/index.ts');
const { sendDigest, runScheduled } = await import('../worker/notify.ts');

/** 用内存 SQLite 执行真实 SQL，batch 与 D1 一样整体提交或回滚。 */
function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const m of MIGRATIONS) for (const sql of m.statements) db.exec(sql);
  db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE)');
  for (const m of MIGRATIONS) db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(m.name);
  const prepare = (sql: string) => {
    let args: Array<string | number | null> = [];
    const stmt = {
      bind(...values: typeof args) {
        args = values;
        return stmt;
      },
      async first() {
        return db.prepare(sql).get(...args) ?? null;
      },
      async all() {
        return { results: db.prepare(sql).all(...args) };
      },
      async run() {
        return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } };
      },
    };
    return stmt;
  };
  const env = {
    DEMO_MODE: '1',
    ASSETS: { fetch: () => new Response('assets') },
    DB: {
      prepare,
      async batch(stmts: Array<ReturnType<typeof prepare>>) {
        db.exec('BEGIN');
        try {
          const results = [];
          for (const s of stmts) results.push(await s.run());
          db.exec('COMMIT');
          return results;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
    },
  } as unknown as Env;
  return { db, env };
}
const ctx = { waitUntil() {} } as unknown as ExecutionContext;
const request = (env: Env, path: string, method = 'GET', body?: unknown, lang = 'zh-CN') =>
  worker.fetch(
    new Request(`https://demo.example${path}`, {
      method,
      headers: { origin: 'https://demo.example', 'content-type': 'application/json', 'x-locale': lang },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
  );

test('演示数据在月末、闰日与跨年均合法、稳定且引用完整', () => {
  for (const day of ['2024-02-29', '2026-01-01', '2026-10-31', '2027-12-31']) {
    const state = demoState(day);
    assert.deepEqual(state, demoState(day));
    assert.equal(state.subscriptions.length, 41);
    assert.equal(new Set(state.subscriptions.map((s) => s.category)).size, 20);
    assert.equal(state.settings.language, undefined);
    assert.equal(state.settings.baseCurrency, 'USD');
    for (const s of state.subscriptions) {
      assert.equal(subError(s), undefined, `${s.name}: ${subError(s)}`);
      if (s.methodId) assert.ok(state.methods.some((m) => m.id === s.methodId));
      if (s.proxy) assert.ok(state.people.some((p) => p.id === s.proxy?.personId));
      for (const m of s.share?.members ?? []) assert.ok(state.people.some((p) => p.id === m.personId));
    }
    state.subscriptions.pop();
    assert.equal(demoState(day).subscriptions.length, 41);
  }
});

test('真实 SQLite 复原清除偏好、聊天、安全与通知记录，完整恢复生成数据并保留汇率', async () => {
  const { db, env } = fixture();
  try {
    await resetDemo(env, '2026-10-20');
    db.exec(`INSERT INTO kv (key,value) VALUES ('prefs','{}'),('assistant','{}'),('auth','{}'),('mcpTokens','[]'),('fx','{"base":"USD","rates":{"USD":1},"fetchedAt":"2026-10-21"}');
      INSERT INTO chats (id,data) VALUES ('chat','{}');
      INSERT INTO sessions (token_hash,expires_at) VALUES ('token',1);
      INSERT INTO passkeys (id,public_key,name) VALUES ('key','pk','test');
      INSERT INTO auth_challenges (id,challenge,kind,expires_at) VALUES ('c','c','login',1);
      INSERT INTO login_attempts (ip,fails,window_start) VALUES ('test',1,1);
      INSERT INTO notify_log (dedupe_key,kind,subject,status) VALUES ('test','test','test','sent');
      INSERT INTO fx_daily (date,rates,source) VALUES ('2026-10-20','{"USD":1}','test');
      DELETE FROM subscriptions; DELETE FROM methods;`);
    await resetDemo(env, '2026-10-21');
    const state = await loadState(env);
    const expected = JSON.parse(JSON.stringify(demoState('2026-10-21')));
    for (const key of ['subscriptions', 'methods', 'people', 'settings'] as const) assert.deepEqual(state[key], expected[key]);
    assert.deepEqual(state.prefs, {});
    for (const table of ['chats', 'sessions', 'passkeys', 'auth_challenges', 'login_attempts', 'notify_log'])
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fx_daily').get()?.n, 1);
    assert.deepEqual(
      db
        .prepare('SELECT key FROM kv ORDER BY key')
        .all()
        .map((r) => r.key),
      ['demo:reset', 'fx', 'people', 'settings'],
    );
  } finally {
    db.close();
  }
});

test('首次空库初始化；删空不提前复原；仅 UTC 零点任务复原且同日幂等', async () => {
  const { db, env } = fixture();
  try {
    await Promise.all([ensureDemo(env, Date.parse('2026-10-20T12:00Z')), ensureDemo(env, Date.parse('2026-10-20T12:00Z'))]);
    assert.equal((await loadState(env)).subscriptions.length, 41);
    db.exec('DELETE FROM subscriptions');
    await ensureDemo(env, Date.parse('2026-10-20T13:00Z'));
    assert.equal((await loadState(env)).subscriptions.length, 0);
    await worker.scheduled({ scheduledTime: Date.parse('2026-10-20T23:05Z') } as ScheduledController, env, ctx);
    assert.equal((await loadState(env)).subscriptions.length, 0);
    await worker.scheduled({ scheduledTime: Date.parse('2026-10-21T00:05Z') } as ScheduledController, env, ctx);
    assert.deepEqual((await loadState(env)).subscriptions, JSON.parse(JSON.stringify(demoState('2026-10-21').subscriptions)));
    db.exec('DELETE FROM subscriptions');
    await worker.scheduled({ scheduledTime: Date.parse('2026-10-21T00:15Z') } as ScheduledController, env, ctx);
    assert.equal((await loadState(env)).subscriptions.length, 0);
  } finally {
    db.close();
  }
});

test('演示站敏感接口返回本地化 403，入口免登录，账本和显示设置可写', async () => {
  const { db, env } = fixture();
  try {
    const routes = [
      ['/api/auth/password', 'POST'],
      ['/api/auth/setup', 'POST'],
      ['/api/auth/security', 'GET'],
      ['/api/auth/passkey/register/options', 'POST'],
      ['/api/auth/passkey/register', 'POST'],
      ['/api/auth/passkey/login', 'POST'],
      ['/api/auth/sessions/id', 'DELETE'],
      ['/api/auth/logout-others', 'POST'],
      ['/api/auth/passkey/id', 'DELETE'],
      ['/api/notify/test', 'POST'],
      ['/api/assistant/config', 'PUT'],
      ['/api/assistant/test', 'POST'],
      ['/api/assistant/chat', 'POST'],
      ['/api/assistant/apply', 'POST'],
      ['/api/assistant/chats/id', 'PUT'],
      ['/api/ics/rotate', 'POST'],
      ['/api/backup', 'POST'],
      ['/api/import', 'POST'],
      ['/cal/01234567890123456789012345678901.ics', 'GET'],
      ['/api/public', 'GET'],
    ];
    for (const [path, method] of routes) {
      const r = await request(env, path, method);
      assert.equal(r.status, 403, path);
      assert.equal((await r.json()).error, '演示站不可用', path);
    }
    assert.equal((await (await request(env, '/api/import', 'POST', undefined, 'en')).json()).error, 'Unavailable on the demo site');
    const root = await request(env, '/');
    assert.equal(root.headers.get('location'), 'https://demo.example/admin');
    assert.equal((await request(env, '/admin')).status, 200);
    assert.deepEqual(await (await request(env, '/api/auth/status')).json(), { needsSetup: false, passkeys: 0 });
    const state = await (await request(env, '/api/state')).json();
    assert.equal(state.demo, true);
    assert.equal(state.readonly, undefined);
    const s = { ...state.subscriptions[0], name: 'Edited' };
    assert.equal((await request(env, `/api/subscriptions/${s.id}`, 'PUT', s)).status, 200);
    assert.equal((await request(env, '/api/settings', 'PUT', { ...state.settings, baseCurrency: 'EUR', language: 'ja' })).status, 200);
    for (const patch of [
      { channels: [] },
      { notifyEmail: 'demo@example.com' },
      { publicView: true },
      { aiEnabled: false },
      { icsToken: 'token' },
      { maxSessions: 1 },
    ])
      assert.equal((await request(env, '/api/settings', 'PUT', patch)).status, 403);
    assert.equal((await request(env, '/api/prefs', 'PATCH', { 'sidebar-collapsed': '1' })).status, 200);
    assert.equal((await request(env, `/api/subscriptions/${s.id}`, 'DELETE')).status, 200);
    const method = { id: 'm-demo', name: 'Demo card', kind: 'debit', currency: 'USD' };
    assert.equal((await request(env, '/api/methods/m-demo', 'PUT', method)).status, 200);
    assert.equal((await request(env, '/api/methods/m-demo', 'DELETE')).status, 200);
    assert.equal((await request(env, '/api/people/p-demo', 'PUT', { name: 'Taylor' })).status, 200);
    assert.equal((await request(env, '/api/people/p-demo', 'DELETE')).status, 200);
    env.DEMO_MODE = undefined;
    assert.equal((await request(env, '/api/state')).status, 401);
    env.DEV_BYPASS_AUTH = '1';
    assert.equal((await request(env, '/api/settings', 'PUT', { publicView: true, aiEnabled: true })).status, 200);
    assert.equal((await request(env, '/api/ics/rotate', 'POST')).status, 200);
  } finally {
    db.close();
  }
});

test('演示模式连直接调用通知发送也不会访问外部渠道或写发送记录', async () => {
  const { db, env } = fixture();
  try {
    const state = { ...demoState('2026-10-21'), fx: { base: 'USD' as const, rates: { USD: 1 }, fetchedAt: '2026-10-21' } };
    state.settings.channels = [{ id: 'webhook', kind: 'webhook', name: 'test', enabled: true, config: { url: 'https://invalid.example' } }];
    const result = await sendDigest(env, state, { key: 'demo', kind: 'test', subject: 'test', intro: '', sections: [], date: '2026-10-21' }, { force: true });
    assert.equal(result.sent, false);
    assert.ok(result.reason);
    assert.deepEqual(await runScheduled(env, state), []);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notify_log').get()?.n, 0);
  } finally {
    db.close();
  }
});
