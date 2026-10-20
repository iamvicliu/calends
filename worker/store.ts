import { FALLBACK_FX } from '../shared/billing.ts';
import { DEFAULT_SETTINGS, type AppState, type FxTable, type PaymentMethod, type Person, type Settings, type Subscription } from '../shared/types.ts';
import { linkPeople } from '../shared/people.ts';
import type { Env } from './env.ts';
import { keepSet, loadFxHistory } from './fx.ts';

export async function getKv<T>(env: Env, key: string): Promise<T | undefined> {
  const row = await env.DB.prepare('SELECT value FROM kv WHERE key = ?1').bind(key).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : undefined;
}

function putKvStmt(env: Env, key: string, value: unknown): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).bind(key, JSON.stringify(value));
}

export async function putKv(env: Env, key: string, value: unknown): Promise<void> {
  await putKvStmt(env, key, value).run();
}

export async function getSettings(env: Env): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await getKv<Settings>(env, 'settings')) ?? {}) };
}

export async function getFx(env: Env): Promise<FxTable> {
  return (await getKv<FxTable>(env, 'fx')) ?? FALLBACK_FX;
}

/** 人的名册：存成 kv 里的一个数组（单用户、量小，不必单独建表，也省掉一次迁移） */
export async function getPeople(env: Env): Promise<Person[]> {
  return (await getKv<Person[]>(env, 'people')) ?? [];
}

export const putPeopleStmt = (env: Env, people: Person[]): D1PreparedStatement =>
  env.DB.prepare("INSERT INTO kv (key, value, updated_at) VALUES ('people', ?1, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(JSON.stringify(people));

/** 把名册和改动过的订阅一起写入（分批，D1 一次 batch 的语句数有限） */
export async function writePeople(env: Env, people: Person[] | undefined, subs: Subscription[]): Promise<void> {
  const stmts = [...(people ? [putPeopleStmt(env, people)] : []), ...subs.map((s) => upsertStmt(env, 'subscriptions', s.id, s))];
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

/**
 * 自动建档（一次性迁移，可重复执行）：老数据里的合租成员、代付对象还没有 personId 时，按称呼 + 联系方式归并成人并写回。
 * 全部关联后这里不再写库；导入、恢复了旧备份时会再补一次。id 由数据算出，同时打开两个标签页也不会重复建档。
 */
async function ensurePeople(env: Env, state: AppState): Promise<void> {
  const r = linkPeople(state.people ?? [], state.subscriptions);
  if (!r.created.length && !r.subs.length) return;
  await writePeople(env, r.created.length ? r.people : undefined, r.subs);
  state.people = r.people;
  state.subscriptions = state.subscriptions.map((s) => r.subs.find((x) => x.id === s.id) ?? s);
}

export async function loadState(env: Env): Promise<AppState> {
  const [subs, methods, settings, fx, people] = await Promise.all([
    env.DB.prepare('SELECT data FROM subscriptions').all<{ data: string }>(),
    env.DB.prepare('SELECT data FROM methods').all<{ data: string }>(),
    getSettings(env),
    getFx(env),
    getPeople(env),
  ]);
  const state: AppState = {
    subscriptions: subs.results.map((r) => JSON.parse(r.data) as Subscription),
    // 按用户在钱包里拖出来的顺序；没排过的保持原有先后
    methods: methods.results
      .map((r) => JSON.parse(r.data) as PaymentMethod)
      .map((m, i) => ({ m, i }))
      .sort((a, b) => (a.m.order ?? 1e9) - (b.m.order ?? 1e9) || a.i - b.i)
      .map((x) => x.m),
    people,
    settings,
    fx,
  };
  await ensurePeople(env, state);
  state.fxHistory = await loadFxHistory(env, keepSet(state));
  return state;
}

type Table = 'subscriptions' | 'methods';

function upsertStmt(env: Env, table: Table, id: string, data: unknown): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO ${table} (id, data, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).bind(id, JSON.stringify(data));
}

export async function upsert(env: Env, table: Table, id: string, data: unknown): Promise<void> {
  await upsertStmt(env, table, id, data).run();
}

export async function remove(env: Env, table: Table, id: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?1`).bind(id).run();
}

export async function replaceAll(env: Env, subs: Subscription[], methods: PaymentMethod[], mode: 'merge' | 'replace'): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  if (mode === 'replace') {
    stmts.push(env.DB.prepare('DELETE FROM subscriptions'), env.DB.prepare('DELETE FROM methods'));
  }
  for (const m of methods) stmts.push(upsertStmt(env, 'methods', m.id, m));
  for (const s of subs) stmts.push(upsertStmt(env, 'subscriptions', s.id, s));
  await env.DB.batch(stmts);
}

export async function loadSubs(env: Env): Promise<Subscription[]> {
  return (await env.DB.prepare('SELECT data FROM subscriptions').all<{ data: string }>()).results.map((r) => JSON.parse(r.data) as Subscription);
}

/** 设置和改动的订阅在同一个 batch 里写入（D1 batch 是一个事务）：分类改名时不会只改了一半 */
export async function saveSettingsWithSubs(env: Env, settings: Settings, subs: Subscription[]): Promise<void> {
  await env.DB.batch([putKvStmt(env, 'settings', settings), ...subs.map((s) => upsertStmt(env, 'subscriptions', s.id, s))]);
}
