// Worker / MCP 审查修复的回归用例：真 Worker 入口 + 内存 SQLite（事务语义与 D1 batch 一致），全部虚构数据，不访问网络。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { MIGRATIONS } from '../worker/migrations.gen.ts';
import { getKv, loadState, putKv, upsert } from '../worker/store.ts';
import type { Env } from '../worker/env.ts';
import { createToken, listTokens } from '../worker/ai/mcp.ts';
import { DEFAULT_SETTINGS, type Subscription } from './types.ts';
import { todayIn } from './billing.ts';

const hook = registerHooks({
  load(url, ctx, next) {
    if (url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
    return next(url, ctx);
  },
});
const { default: worker } = await import('../worker/index.ts');
const { saveChat } = await import('../worker/ai/assistant.ts');
const { toolContent } = await import('../worker/ai/assistant.ts');
hook.deregister();

globalThis.fetch = (() => {
  throw new Error('External network disabled in tests');
}) as typeof fetch;

function fixture(extra: Partial<Env> = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE)');
  for (const m of MIGRATIONS) {
    for (const sql of m.statements) db.exec(sql);
    db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(m.name);
  }
  const writes: string[] = [];
  const prepare = (sql: string) => {
    let args: Array<string | number | null> = [];
    const stmt = {
      sql,
      bind(...values: typeof args) {
        args = values;
        return stmt;
      },
      async first() {
        if (!/^\s*SELECT/i.test(sql)) writes.push(sql);
        return db.prepare(sql).get(...args) ?? null;
      },
      async all() {
        return { results: db.prepare(sql).all(...args) };
      },
      async run() {
        if (!/^\s*SELECT/i.test(sql)) writes.push(sql);
        const query = db.prepare(sql);
        if (query.columns().length) return { results: query.all(...args) };
        return { results: [], meta: { changes: Number(query.run(...args).changes) } };
      },
    };
    return stmt;
  };
  const env = {
    DB: {
      prepare,
      async batch(stmts: Array<ReturnType<typeof prepare>>) {
        db.exec('BEGIN');
        try {
          const results = [];
          for (const stmt of stmts) results.push(await stmt.run());
          db.exec('COMMIT');
          return results;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
    },
    DEV_BYPASS_AUTH: '1',
    ...extra,
  } as unknown as Env;
  const request = (path: string, init: RequestInit = {}, e: Env = env) =>
    worker.fetch(new Request(`https://example.test${path}`, { headers: { 'content-type': 'application/json' }, ...init }), e);
  return { db, env, request, writes };
}

const today = todayIn('UTC');
const sub = (id: string, name: string, extra: Partial<Subscription> = {}): Subscription => ({
  id,
  name,
  category: 'Test',
  tags: [],
  price: 10,
  currency: 'USD',
  start: today,
  cycle: { unit: 'month', every: 1 },
  status: 'active',
  ...extra,
});

async function ledger(extra: Partial<Env> = {}) {
  const f = fixture(extra);
  await putKv(f.env, 'settings', { ...DEFAULT_SETTINGS, categories: [{ name: 'Test' }] });
  const write = (await createToken(f.env, 'Fictional writer', 'write')).token;
  const rpc = async (body: unknown, token = write) => {
    const res = await worker.fetch(
      new Request('https://example.test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
      f.env,
    );
    return res.json();
  };
  const call = async (name: string, args: object) => {
    const r = (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })) as {
      result: { isError?: boolean; content: Array<{ text: string }>; structuredContent?: unknown };
    };
    return r.result;
  };
  return { ...f, write, rpc, call };
}

test('W-2 MCP 鉴权只单独记最后使用时间，不重写令牌列表（吊销的令牌不会被并发请求写回）', async () => {
  const f = await ledger();
  const before = await getKv(f.env, 'mcpTokens');
  const other = await createToken(f.env, 'Second', 'read');
  const listed = await getKv(f.env, 'mcpTokens');
  await f.rpc({ jsonrpc: '2.0', id: 1, method: 'ping' });
  // 列表只因管理接口变化
  assert.deepEqual(await getKv(f.env, 'mcpTokens'), listed);
  assert.notDeepEqual(before, listed);
  const tokens = await listTokens(f.env);
  assert.ok(tokens.find((x) => x.name === 'Fictional writer')?.lastUsedAt);
  assert.equal(tokens.find((x) => x.id === other.item.id)?.lastUsedAt, undefined);
  // 吊销后用旧令牌请求：被拒绝，也不会把它写回列表
  const { revokeToken } = await import('../worker/ai/mcp.ts');
  await revokeToken(f.env, tokens.find((x) => x.name === 'Fictional writer')!.id);
  const r = await worker.fetch(
    new Request('https://example.test/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${f.write}` },
      body: '{"jsonrpc":"2.0","id":1,"method":"ping"}',
    }),
    f.env,
  );
  assert.equal(r.status, 401);
  assert.deepEqual(
    (await listTokens(f.env)).map((x) => x.id),
    [other.item.id],
  );
});

test('W-4 MCP 批量请求按顺序执行：后一个写入能看到前一个的结果', async () => {
  const f = await ledger();
  const out = (await f.rpc([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'create_subscription',
        arguments: { id: 'batch1', name: 'Fictional batch', category: 'Test', price: 5, currency: 'USD', cycle: { unit: 'month' } },
      },
    },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'update_subscription', arguments: { subscription: 'batch1', set: { notes: 'second' } } } },
  ])) as Array<{ id: number; result: { isError?: boolean; content: Array<{ text: string }> } }>;
  assert.deepEqual(
    out.map((x) => [x.id, !!x.result.isError]),
    [
      [1, false],
      [2, false],
    ],
  );
  assert.equal((await loadState(f.env, false)).subscriptions.find((s) => s.id === 'batch1')?.notes, 'second');
});

test('W-5 破坏性工具只认 id 或完整名称；成员查找重名时报错而不是挑第一个', async () => {
  const f = await ledger();
  await upsert(f.env, 'subscriptions', 'n1', sub('n1', 'Fictional Netflix Premium'));
  await upsert(
    f.env,
    'subscriptions',
    'c1',
    sub('c1', 'Fictional Car', {
      share: {
        role: 'owner',
        seats: 5,
        members: [
          { id: 'm1', name: 'Alex', share: 2, fee: 2, feeCurrency: 'USD' },
          { id: 'm2', name: 'alex', share: 2, fee: 2, feeCurrency: 'USD' },
          { id: 'm3', name: 'Alexandra', share: 2, fee: 2, feeCurrency: 'USD' },
        ],
      },
    }),
  );
  // 子串唯一命中：读工具照常可用，删除被拒绝
  assert.ok(!(await f.call('get_subscription', { subscription: 'netflix' })).isError);
  const del = await f.call('delete_subscription', { subscription: 'netflix' });
  assert.equal(del.isError, true);
  assert.match(del.content[0].text, /netflix/);
  assert.ok((await loadState(f.env, false)).subscriptions.some((s) => s.id === 'n1'));
  for (const [name, args] of [
    ['set_share', { subscription: 'Car', role: 'none', dry_run: true }],
    ['change_plan', { subscription: 'netflix', action: 'remove', at: today, dry_run: true }],
    ['delete_payment', { subscription: 'netflix', date: today, dry_run: true }],
    ['set_proxy', { subscription: 'netflix', action: 'remove', dry_run: true }],
  ] as const) {
    const r = await f.call(name, args);
    assert.equal(r.isError, true, `${name}: ${JSON.stringify(r).slice(0, 300)}`);
  }
  // 完整名称（不分大小写）可以
  assert.ok(!(await f.call('delete_subscription', { subscription: 'fictional netflix premium', dry_run: true })).isError);
  // 成员：完整名称重名 → 报错；id → 精确
  const amb = await f.call('remove_share_member', { subscription: 'c1', member: 'ALEX', dry_run: true });
  assert.equal(amb.isError, true);
  assert.ok(!(await f.call('remove_share_member', { subscription: 'c1', member: 'm2', dry_run: true })).isError);
  assert.equal((await f.call('remove_share_member', { subscription: 'c1', member: 'Alexa', dry_run: true })).isError, true);
  assert.equal((await f.call('save_share_member', { subscription: 'c1', member: 'alex', note: 'x', dry_run: true })).isError, true);
});
