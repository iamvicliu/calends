import { validatePeopleAvatars } from '../shared/avatar.ts';
import { FALLBACK_FX, migrateRenewalRules } from '../shared/billing.ts';
import { DEFAULT_SETTINGS, type AppState, type FxTable, type PaymentMethod, type Person, type Settings, type Subscription } from '../shared/types.ts';
import { linkPeople } from '../shared/people.ts';
import type { Prefs } from '../shared/prefs.ts';
import type { Env } from './env.ts';
import { keepSet, slimFxHistory } from './fx.ts';

const revSql = "SELECT CAST(value AS INTEGER) AS rev FROM kv WHERE key = 'rev'";

export async function getRev(env: Env): Promise<number> {
  const row = await env.DB.prepare(revSql).first<{ rev: number }>();
  if (!row) throw new Error('Missing ledger revision');
  return row.rev;
}

/** Return the revision in the same transaction as the writes (triggers increment it). */
export interface Revision {
  from: number;
  rev: number;
}

async function mutate(env: Env, stmts: D1PreparedStatement[]): Promise<Revision> {
  const results = await env.DB.batch<{ rev: number }>([env.DB.prepare(revSql), ...stmts, env.DB.prepare(revSql)]);
  return { from: results[0].results[0].rev, rev: results[results.length - 1].results[0].rev };
}

export async function getKv<T>(env: Env, key: string): Promise<T | undefined> {
  const row = await env.DB.prepare('SELECT value FROM kv WHERE key = ?1').bind(key).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : undefined;
}

function putKvStmt(env: Env, key: string, value: unknown): D1PreparedStatement {
  if (key === 'people') validatePeopleAvatars(value as Person[]);
  return env.DB.prepare(
    "INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).bind(key, JSON.stringify(value));
}

export async function putKv(env: Env, key: string, value: unknown): Promise<Revision | undefined> {
  if (['settings', 'people', 'prefs', 'fx'].includes(key)) return mutate(env, [putKvStmt(env, key, value)]);
  await putKvStmt(env, key, value).run();
}

export async function getSettings(env: Env): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await getKv<Settings>(env, 'settings')) };
}

export async function getFx(env: Env): Promise<FxTable> {
  return (await getKv<FxTable>(env, 'fx')) ?? FALLBACK_FX;
}

/** 人的名册：存成 kv 里的一个数组（单用户、量小，不必单独建表，也省掉一次迁移） */
export async function getPeople(env: Env): Promise<Person[]> {
  return (await getKv<Person[]>(env, 'people')) ?? [];
}

const putPeopleStmt = (env: Env, people: Person[]): D1PreparedStatement =>
  env.DB.prepare(
    "INSERT INTO kv (key, value, updated_at) VALUES ('people', ?1, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).bind(JSON.stringify(people));

/** 把名册和改动过的订阅一起写入（分批，D1 一次 batch 的语句数有限） */
export async function writePeople(env: Env, people: Person[] | undefined, subs: Subscription[]): Promise<Revision | undefined> {
  if (people) validatePeopleAvatars(people);
  const stmts = [...(people ? [putPeopleStmt(env, people)] : []), ...subs.map((s) => upsertStmt(env, 'subscriptions', s.id, s))];
  let revision: Revision | undefined;
  for (let i = 0; i < stmts.length; i += 50) {
    const next = await mutate(env, stmts.slice(i, i + 50));
    // Only acknowledge a contiguous series; interleaved remote writes require a reload.
    revision = { from: revision && revision.rev === next.from ? revision.from : next.from, rev: next.rev };
  }
  return revision;
}

/**
 * 自动建档（一次性迁移，可重复执行）：老数据里的合租成员、代付对象还没有 personId 时，按称呼 + 联系方式归并成人并写回。
 * 全部关联后这里不再写库；导入、恢复了旧备份时会再补一次。id 由数据算出，同时打开两个标签页也不会重复建档。
 */
async function ensurePeople(env: Env, state: AppState): Promise<boolean> {
  const r = linkPeople(state.people ?? [], state.subscriptions);
  if (!r.created.length && !r.subs.length) return false;
  await writePeople(env, r.created.length ? r.people : undefined, r.subs);
  state.people = r.people;
  return true;
}

export async function loadState(env: Env, migratePeople = true): Promise<AppState> {
  // D1 batch reads one transactional snapshot: never pair stale data with a newer rev.
  const rows = await env.DB.batch([
    env.DB.prepare('SELECT data FROM subscriptions'),
    env.DB.prepare('SELECT data FROM methods'),
    env.DB.prepare("SELECT key, value FROM kv WHERE key IN ('settings', 'fx', 'people', 'prefs', 'rev')"),
    env.DB.prepare('SELECT date, rates FROM fx_daily'),
  ]);
  const subs = rows[0] as D1Result<{ data: string }>;
  const methods = rows[1] as D1Result<{ data: string }>;
  const kv = Object.fromEntries((rows[2] as D1Result<{ key: string; value: string }>).results.map((r) => [r.key, JSON.parse(r.value)]));
  if (typeof kv.rev !== 'number') throw new Error('Missing ledger revision');
  const state: AppState = {
    rev: kv.rev,
    subscriptions: subs.results.map((r) => migrateRenewalRules(JSON.parse(r.data) as Subscription)),
    // 按用户在钱包里拖出来的顺序；没排过的保持原有先后
    methods: methods.results
      .map((r) => JSON.parse(r.data) as PaymentMethod)
      .map((m, i) => ({ m, i }))
      .sort((a, b) => (a.m.order ?? 1e9) - (b.m.order ?? 1e9) || a.i - b.i)
      .map((x) => x.m),
    people: kv.people ?? [],
    settings: { ...DEFAULT_SETTINGS, ...kv.settings },
    fx: kv.fx ?? FALLBACK_FX,
    prefs: (kv.prefs as Prefs | undefined) ?? {},
  };
  if (migratePeople && (await ensurePeople(env, state))) return loadState(env);
  state.fxHistory = slimFxHistory((rows[3] as D1Result<{ date: string; rates: string }>).results, keepSet(state));
  return state;
}

type Table = 'subscriptions' | 'methods';

function upsertStmt(env: Env, table: Table, id: string, data: unknown): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO ${table} (id, data, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).bind(id, JSON.stringify(data));
}

export async function upsert(env: Env, table: Table, id: string, data: unknown): Promise<Revision> {
  return mutate(env, [upsertStmt(env, table, id, data)]);
}

export async function remove(env: Env, table: Table, id: string): Promise<Revision> {
  return mutate(env, [env.DB.prepare(`DELETE FROM ${table} WHERE id = ?1`).bind(id)]);
}

export async function replaceAll(env: Env, subs: Subscription[], methods: PaymentMethod[], mode: 'merge' | 'replace'): Promise<Revision> {
  const stmts: D1PreparedStatement[] = [];
  if (mode === 'replace') {
    stmts.push(env.DB.prepare('DELETE FROM subscriptions'), env.DB.prepare('DELETE FROM methods'));
  }
  for (const m of methods) stmts.push(upsertStmt(env, 'methods', m.id, m));
  for (const s of subs) stmts.push(upsertStmt(env, 'subscriptions', s.id, s));
  return mutate(env, stmts);
}

export async function loadSubs(env: Env): Promise<Subscription[]> {
  return (await env.DB.prepare('SELECT data FROM subscriptions').all<{ data: string }>()).results.map((r) =>
    migrateRenewalRules(JSON.parse(r.data) as Subscription),
  );
}

/** 设置和改动的订阅在同一个 batch 里写入（D1 batch 是一个事务）：分类改名时不会只改了一半 */
export async function saveSettingsWithSubs(env: Env, settings: Settings, subs: Subscription[]): Promise<Revision> {
  return mutate(env, [putKvStmt(env, 'settings', settings), ...subs.map((s) => upsertStmt(env, 'subscriptions', s.id, s))]);
}

/** Atomic multi-entity tool write: never leave a migration or settings/prefs edit half-applied. */
export async function saveLedgerEdit(
  env: Env,
  patch: Partial<AppState>,
  deletedMethods: string[] = [],
  deletedSubscriptions: string[] = [],
): Promise<Revision> {
  const stmts = [
    ...(patch.subscriptions ?? []).map((s) => upsertStmt(env, 'subscriptions', s.id, s)),
    ...(patch.methods ?? []).map((m) => upsertStmt(env, 'methods', m.id, m)),
    ...deletedMethods.map((id) => env.DB.prepare('DELETE FROM methods WHERE id = ?1').bind(id)),
    ...deletedSubscriptions.map((id) => env.DB.prepare('DELETE FROM subscriptions WHERE id = ?1').bind(id)),
    ...(['settings', 'people', 'prefs'] as const).filter((k) => patch[k] !== undefined).map((k) => putKvStmt(env, k, patch[k])),
  ];
  return mutate(env, stmts);
}
