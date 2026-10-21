// 演示环境的能力边界与复原入口。数据库 batch 是事务，访客不会读到只清了一半的账本。
import { demoState } from '../shared/demo.ts';
import type { Env } from './env.ts';
import { getKv } from './store.ts';

export function demoBlocked(path: string, method: string): boolean {
  return (
    path === '/mcp' ||
    path.startsWith('/cal/') ||
    path === '/api/public' ||
    (path.startsWith('/api/auth/') && path !== '/api/auth/status') ||
    path === '/api/login' ||
    path === '/api/logout' ||
    path.startsWith('/api/mcp/') ||
    path.startsWith('/api/assistant/') ||
    path === '/api/notify/test' ||
    path.startsWith('/api/ics/') ||
    (method === 'POST' && (path === '/api/backup' || path === '/api/import'))
  );
}

export async function resetDemo(env: Env, today: string): Promise<void> {
  const state = demoState(today);
  const stmts = ['subscriptions', 'methods', 'sessions', 'passkeys', 'auth_challenges', 'login_attempts', 'notify_log', 'chats'].map((table) =>
    env.DB.prepare(`DELETE FROM ${table}`),
  );
  // 当前汇率、历史汇率与迁移记录保留，其他键（密码、令牌、偏好、AI Key 等）全部清空。
  stmts.push(env.DB.prepare("DELETE FROM kv WHERE key != 'fx'"));
  for (const table of ['subscriptions', 'methods'] as const)
    for (const row of state[table]) stmts.push(env.DB.prepare(`INSERT INTO ${table} (id, data) VALUES (?1, ?2)`).bind(row.id, JSON.stringify(row)));
  for (const [key, value] of Object.entries({ settings: state.settings, people: state.people, 'demo:reset': today }))
    stmts.push(env.DB.prepare('INSERT INTO kv (key, value) VALUES (?1, ?2)').bind(key, JSON.stringify(value)));
  await env.DB.batch(stmts);
}

// 同一实例并发首访、定时触发共用一条队列；初始化标记避免访客删空订阅时马上被复原。
const pending = new WeakMap<D1Database, Promise<void>>();
export function ensureDemo(env: Env, time = Date.now(), scheduled = false): Promise<void> {
  const prev = pending.get(env.DB) ?? Promise.resolve();
  const next = prev.then(async () => {
    const now = new Date(time);
    const today = now.toISOString().slice(0, 10);
    const last = await getKv<string>(env, 'demo:reset');
    if (scheduled && now.getUTCHours() === 0 && last !== today) return resetDemo(env, today);
    if (last) return;
    const row = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM subscriptions) + (SELECT COUNT(*) FROM methods) + (SELECT COUNT(*) FROM kv WHERE key != 'fx') AS count",
    ).first<{ count: number }>();
    if (row?.count === 0) await resetDemo(env, today);
  });
  pending.set(
    env.DB,
    next.catch(() => {}),
  );
  return next;
}
