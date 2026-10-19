import { FALLBACK_FX } from '../shared/billing.ts';
import { DEFAULT_SETTINGS, type AppState, type FxTable, type PaymentMethod, type Settings, type Subscription } from '../shared/types.ts';
import type { Env } from './env.ts';

async function getKv<T>(env: Env, key: string): Promise<T | undefined> {
  const row = await env.DB.prepare('SELECT value FROM kv WHERE key = ?1').bind(key).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export async function putKv(env: Env, key: string, value: unknown): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(key, JSON.stringify(value))
    .run();
}

export async function getSettings(env: Env): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await getKv<Settings>(env, 'settings')) ?? {}) };
}

export async function getFx(env: Env): Promise<FxTable> {
  return (await getKv<FxTable>(env, 'fx')) ?? FALLBACK_FX;
}

export async function loadState(env: Env): Promise<AppState> {
  const [subs, methods, settings, fx] = await Promise.all([
    env.DB.prepare('SELECT data FROM subscriptions').all<{ data: string }>(),
    env.DB.prepare('SELECT data FROM methods').all<{ data: string }>(),
    getSettings(env),
    getFx(env),
  ]);
  return {
    subscriptions: subs.results.map((r) => JSON.parse(r.data) as Subscription),
    methods: methods.results.map((r) => JSON.parse(r.data) as PaymentMethod),
    settings,
    fx,
  };
}

/** 匿名公开视图：去掉备注、联系人、卡号尾号、通知邮箱与日历令牌 */
export function sanitize(state: AppState): AppState {
  return {
    readonly: true,
    fx: state.fx,
    settings: { ...state.settings, notifyEmail: '', icsToken: undefined },
    methods: state.methods.map(({ notes: _n, last4: _l, ...m }) => m),
    subscriptions: state.subscriptions.map(({ notes: _n, ...s }) => ({
      ...s,
      share: s.share && {
        ...s.share,
        ownerName: s.share.ownerName ? '车主' : undefined,
        members: s.share.members.map((m, i) => ({ id: m.id, name: `成员 ${i + 1}`, share: m.share, paidUntil: m.paidUntil })),
      },
    })),
  };
}

export async function upsert(env: Env, table: 'subscriptions' | 'methods', id: string, data: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ${table} (id, data, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  )
    .bind(id, JSON.stringify(data))
    .run();
}

export async function remove(env: Env, table: 'subscriptions' | 'methods', id: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?1`).bind(id).run();
}

export async function replaceAll(env: Env, subs: Subscription[], methods: PaymentMethod[], mode: 'merge' | 'replace'): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  if (mode === 'replace') {
    stmts.push(env.DB.prepare('DELETE FROM subscriptions'), env.DB.prepare('DELETE FROM methods'));
  }
  const ins = (t: string) =>
    env.DB.prepare(
      `INSERT INTO ${t} (id, data, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    );
  for (const m of methods) stmts.push(ins('methods').bind(m.id, JSON.stringify(m)));
  for (const s of subs) stmts.push(ins('subscriptions').bind(s.id, JSON.stringify(s)));
  await env.DB.batch(stmts);
}
