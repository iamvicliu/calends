import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { MIGRATIONS } from '../worker/migrations.gen.ts';
import { getRev, loadState, putKv, upsert } from '../worker/store.ts';
import type { Env } from '../worker/env.ts';
import { TOOLS, type ToolCtx } from '../worker/ai/mcp-tools.ts';
import { createToken } from '../worker/ai/mcp.ts';
import { ASSISTANT_TOOLS, apply, chat, enrichDraft } from '../worker/ai/assistant.ts';
import { DEFAULT_SETTINGS, type AppState, type Subscription } from './types.ts';
import { addDays, memberRate, todayIn } from './billing.ts';
const hook = registerHooks({
  load(url, ctx, next) {
    if (url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
    return next(url, ctx);
  },
});
const { default: worker } = await import('../worker/index.ts');
hook.deregister();
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE)');
  for (const m of MIGRATIONS) {
    for (const sql of m.statements) db.exec(sql);
    db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(m.name);
  }
  const queries: string[] = [];
  const prepare = (sql: string) => {
    let args: Array<string | number | null> = [];
    const stmt = {
      bind(...values: typeof args) {
        args = values;
        return stmt;
      },
      async first() {
        queries.push(sql);
        return db.prepare(sql).get(...args) ?? null;
      },
      async all() {
        queries.push(sql);
        return { results: db.prepare(sql).all(...args) };
      },
      async run() {
        queries.push(sql);
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
    BASE_PATH: '/ledger',
  } as unknown as Env;
  const request = (path: string, method = 'GET', body?: unknown, auth = true) =>
    worker.fetch(
      new Request(`https://example.test/ledger/api/${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      auth ? env : { ...env, DEV_BYPASS_AUTH: undefined },
    );
  return { db, env, queries, request };
}

const sub = (): Subscription => ({
  id: 's',
  name: 'Fictional subscription',
  category: 'Test',
  tags: [],
  price: 10,
  currency: 'USD',
  start: todayIn('UTC'),
  cycle: { unit: 'month', every: 1 },
  status: 'active',
  methodId: 'wallet',
  share: {
    role: 'owner',
    seats: 4,
    members: [
      {
        id: 'member',
        personId: 'person',
        name: 'Fictional person',
        share: 3,
        fee: 3,
        feeCurrency: 'USD',
        payments: [{ date: todayIn('UTC'), from: todayIn('UTC'), until: '2026-12-31', amount: 3, currency: 'USD' }],
        paidUntil: '2026-12-31',
      },
    ],
  },
  proxy: { personId: 'person', forName: 'Fictional person', entries: [{ charge: todayIn('UTC'), charged: 10, received: 9, receivedCurrency: 'USD' }] },
});
async function setup() {
  const f = fixture();
  await putKv(f.env, 'settings', {
    ...DEFAULT_SETTINGS,
    categories: [{ name: 'Test' }, { name: 'Other' }],
    channels: [{ id: 'channel', name: 'Fictional channel', kind: 'webhook', enabled: false, config: { token: 'SECRET', url: 'https://private.example.test' } }],
    icsToken: 'SECRET',
  });
  await upsert(f.env, 'methods', 'wallet', {
    id: 'wallet',
    name: 'Fictional wallet',
    kind: 'prepaid',
    currency: 'USD',
    balance: 100,
    balanceAsOf: todayIn('UTC'),
    topUps: [{ date: todayIn('UTC'), amount: 100, cost: 95, costCurrency: 'USD' }],
  });
  await upsert(f.env, 'methods', 'target', { id: 'target', name: 'Target wallet', kind: 'credit', currency: 'USD' });
  await putKv(f.env, 'people', [
    { id: 'person', name: 'Fictional person' },
    { id: 'target', name: 'Target person' },
  ]);
  await upsert(f.env, 'subscriptions', 's', sub());
  const write = (await createToken(f.env, 'Fictional writer', 'write')).token;
  const read = (await createToken(f.env, 'Fictional reader', 'read')).token;
  const rpc = async (method: string, params: object, token = write) => {
    const response = await worker.fetch(
      new Request('https://example.test/ledger/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
      f.env,
    );
    assert.equal(response.status, 200);
    return (await response.json()).result;
  };
  await rpc('ping', {}, write);
  await rpc('ping', {}, read);
  const call = (name: string, args: object, token = write) => rpc('tools/call', { name, arguments: args }, token);
  return { ...f, write, read, call, rpc, snapshot: () => loadState(f.env, false) };
}

const mutations: Array<[string, object, (st: AppState) => unknown]> = [
  [
    'update_subscription',
    { subscription: 's', set: { remind_days: null, method: null } },
    (st) => st.subscriptions[0].remindDays === undefined && st.subscriptions[0].methodId === undefined,
  ],
  ['save_share_member', { subscription: 's', member: 'member', fee_currency: 'CNY' }, (st) => st.subscriptions[0].share?.members[0].feeCurrency === 'CNY'],
  [
    'set_share',
    { subscription: 's', role: 'owner', collect_from: null, since: null },
    (st) => st.subscriptions[0].share?.collectFrom === undefined && st.subscriptions[0].share?.since === undefined,
  ],
  [
    'set_status',
    { subscription: 's', action: 'trial', trial_end: '2026-12-01' },
    (st) => st.subscriptions[0].status === 'trial' && st.subscriptions[0].trialEnd === '2026-12-01',
  ],
  [
    'record_payment',
    { subscription: 's', date: todayIn('UTC'), amount: 11, replace: { date: todayIn('UTC'), index: 0 } },
    (st) => st.subscriptions[0].payments?.length === 1 && st.subscriptions[0].payments[0].amount === 11,
  ],
  [
    'update_payment_method',
    { action: 'create', id: 'new', set: { name: 'New wallet', kind: 'appstore', currency: 'USD', balance: 0 } },
    (st) => st.methods.find((m) => m.id === 'new')?.balance === 0,
  ],
  [
    'update_payment_method',
    { method: 'wallet', set: { kind: 'phone', logo: 'https://example.test/logo.png', notes: 'Revised', currency: 'CNY', phone: '+1000', order: 2 } },
    (st) => st.methods.find((m) => m.id === 'wallet')?.currency === 'CNY',
  ],
  [
    'update_payment_method',
    { method: 'wallet', top_up_action: 'update', top_up_index: 0, top_up: { amount: 120, note: 'Revised' } },
    (st) => st.methods.find((m) => m.id === 'wallet')?.topUps?.[0].amount === 120 && st.methods.find((m) => m.id === 'wallet')?.balance === 100,
  ],
  [
    'update_payment_method',
    { method: 'wallet', top_up_action: 'delete', top_up_index: 0 },
    (st) => st.methods.find((m) => m.id === 'wallet')?.topUps?.length === 0,
  ],
  [
    'update_payment_method',
    { method: 'wallet', action: 'delete', migrate_to: 'target' },
    (st) => !st.methods.some((m) => m.id === 'wallet') && st.subscriptions[0].methodId === 'target',
  ],
  [
    'save_category',
    { action: 'create', set: { name: 'Created', icon: 'bot', color: 'c1' } },
    (st) => st.settings.categories?.some((c) => c.name === 'Created'),
  ],
  [
    'save_category',
    { action: 'update', category: 'Test', set: { name: 'Renamed', icon: 'wrench', color: '#123456' } },
    (st) => st.subscriptions[0].category === 'Renamed',
  ],
  ['save_category', { action: 'delete', category: 'Test', migrate_to: 'Other' }, (st) => st.subscriptions[0].category === 'Other'],
  ['save_person', { action: 'create', id: 'new', set: { name: 'New person', color: 'green' } }, (st) => st.people?.some((p) => p.id === 'new')],
  [
    'save_person',
    { action: 'update', person: 'person', set: { name: 'Renamed', contactVia: 'Email', contact: 'fiction@example.test' } },
    (st) => st.subscriptions[0].proxy?.forName === 'Renamed' && st.subscriptions[0].share?.members[0].name === 'Renamed',
  ],
  [
    'save_person',
    { action: 'delete', person: 'person', migrate_to: 'target' },
    (st) => !st.people?.some((p) => p.id === 'person') && st.subscriptions[0].proxy?.personId === 'target',
  ],
  ['set_proxy', { subscription: 's', person: 'target', note: 'Revised' }, (st) => st.subscriptions[0].proxy?.personId === 'target'],
  ['set_proxy', { subscription: 's', action: 'remove' }, (st) => !st.subscriptions[0].proxy],
  [
    'update_settings',
    {
      set: { baseCurrency: 'CNY', signedAmounts: false, remindDays: 7, publicView: true, publicHidden: ['s'] },
      channel_enabled: [{ id: 'channel', enabled: true }],
      prefs: { theme: 'dark' },
    },
    (st) => st.settings.baseCurrency === 'CNY' && st.settings.channels?.[0].config.token === 'SECRET' && st.prefs?.theme === 'dark',
  ],
  [
    'record_receivable',
    { action: 'update', subscription: 's', kind: 'share', member: 'member', index: 0, receipt: { amount: 0, until: '2026-11-30' } },
    (st) => st.subscriptions[0].share?.members[0].paidUntil === '2026-11-30',
  ],
  [
    'record_receivable',
    { action: 'delete', subscription: 's', kind: 'share', member: 'member', index: 0 },
    (st) => !st.subscriptions[0].share?.members[0].paidUntil && st.subscriptions[0].share?.members[0].payments?.length === 0,
  ],
  [
    'record_receivable',
    {
      action: 'update',
      subscription: 's',
      kind: 'proxy',
      charge: todayIn('UTC'),
      entry: { charged: 12, chargedCurrency: 'USD', received: null, receivedCurrency: null },
    },
    (st) => st.subscriptions[0].proxy?.entries[0].charged === 12 && st.subscriptions[0].proxy?.entries[0].received === undefined,
  ],
  [
    'record_receivable',
    { action: 'delete', subscription: 's', kind: 'proxy', charge: todayIn('UTC') },
    (st) => st.subscriptions[0].proxy?.entries.length === 0,
  ],
  [
    'record_receivable',
    { subscription: 's', kind: 'proxy', charge: '2026-01-01', entry: { charged: 5, chargedCurrency: 'USD' } },
    (st) => st.subscriptions[0].proxy?.entries.some((e) => e.charge === '2026-01-01' && e.charged === 5),
  ],
  [
    'update_subscription',
    { subscription: 's', set: { icon: '🌱', show_on_public: true, bonus: { from: '2026-11-01', until: '2026-11-10' } } },
    (st) => st.subscriptions[0].showOnPublic === true,
  ],
  [
    'change_plan',
    { subscription: 's', action: 'edit', at: todayIn('UTC'), set: { price: 15, priceHistory: [{ from: todayIn('UTC'), amount: 15 }], nextDue: '2026-12-01' } },
    (st) => st.subscriptions[0].phases?.[0].price === 15,
  ],
];
for (const [name, args, verify] of mutations)
  test(`${name} ${JSON.stringify(args)}: MCP preview, permission denial, save and reread`, async (t) => {
    const f = await setup();
    t.after(() => f.db.close());
    const before = await f.snapshot();
    const preview = await f.call(name, { ...args, dry_run: true });
    assert.equal(preview.isError, undefined, JSON.stringify(preview));
    assert.equal(preview.structuredContent.dry_run, true);
    assert.deepEqual(await f.snapshot(), before);
    const denied = await f.call(name, args, f.read);
    assert.equal(denied.isError, true);
    assert.deepEqual(await f.snapshot(), before);
    const saved = await f.call(name, args);
    assert.equal(saved.isError, undefined, JSON.stringify(saved));
    const after = await f.snapshot();
    assert.ok(verify(after), JSON.stringify(after));
    assert.ok(after.rev! > before.rev!);
  });

test('every new read tool and connection catalogue: read token visibility, titles, secrets, all writes denied', async (t) => {
  const f = await setup();
  t.after(() => f.db.close());
  const before = await f.snapshot();
  const listed = await f.rpc('tools/list', {}, f.read);
  assert.equal(listed.tools.length, TOOLS.filter((x) => !x.write).length);
  assert.equal(TOOLS.length, 32);
  assert.deepEqual(
    ASSISTANT_TOOLS.map((x) => x.name),
    TOOLS.map((x) => x.name),
  );
  for (const tool of TOOLS.filter((x) => x.write)) {
    assert.equal((await f.call(tool.name, {}, f.read)).isError, true);
    assert.ok((tool.inputSchema.properties as object).hasOwnProperty('dry_run'));
  }
  const settings = await f.call('get_settings', {}, f.read);
  assert.equal(settings.isError, undefined);
  assert.doesNotMatch(JSON.stringify(settings), /SECRET|private.example/);
  for (const name of ['save_category', 'save_person', 'get_settings', 'update_settings', 'set_proxy']) {
    const response = await f.request('mcp/tools');
    const metadata = (await response.json()).find((x: { name: string }) => x.name === name);
    assert.ok(metadata.title && metadata.title !== `mcp.tool.${name}`);
  }
  assert.deepEqual(await f.snapshot(), before);
});

test('delete references block and report exact links; missing indices/unknown security fields never write', async (t) => {
  const f = await setup();
  t.after(() => f.db.close());
  const before = await f.snapshot();
  for (const [name, args] of [
    ['update_payment_method', { action: 'delete', method: 'wallet' }],
    ['save_category', { action: 'delete', category: 'Test' }],
    ['save_person', { action: 'delete', person: 'person' }],
  ] as const) {
    const r = await f.call(name, args);
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /s|Fictional/);
  }
  for (const [name, args] of [
    ['record_receivable', { action: 'delete', subscription: 's', kind: 'share', member: 'member', index: 88 }],
    ['record_receivable', { action: 'delete', subscription: 's', kind: 'proxy', charge: '2000-01-01' }],
    ['update_payment_method', { method: 'wallet', top_up_action: 'delete', top_up_index: 100 }],
    ['update_settings', { set: { maxSessions: 1 } }],
    ['update_settings', { set: { aiEnabled: false } }],
    ['update_settings', { set: { channels: [] } }],
    ['update_settings', { channel_enabled: [{ id: 'channel', enabled: true, config: { token: 'overwrite' } }] }],
    ['save_person', { action: 'create', set: { name: '' } }],
    ['update_payment_method', { action: 'create', set: { name: 'Invalid', kind: 'prepaid', currency: 'ZZZ' } }],
    ['save_category', { action: 'create', set: { name: 'Test' } }],
    ['update_settings', { set: { remindDays: null } }],
  ] as const) {
    const r = await f.call(name, args);
    assert.equal(r.isError, true, JSON.stringify([name, args, r]));
  }
  assert.deepEqual(await f.snapshot(), before);
});

test('legacy people read during dry_run cannot write an implicit migration; a failed read never replaces state', async (t) => {
  const f = await setup();
  t.after(() => f.db.close());
  const legacy = sub();
  delete legacy.share!.members[0].personId;
  delete legacy.proxy!.personId;
  await upsert(f.env, 'subscriptions', 's', legacy);
  await putKv(f.env, 'people', []);
  const revision = await getRev(f.env);
  assert.equal((await f.call('update_settings', { set: { remindDays: 5 }, dry_run: true })).isError, undefined);
  assert.equal(await getRev(f.env), revision);
  const before = await f.snapshot();
  const original = f.env.DB.batch;
  f.env.DB.batch = async () => {
    throw new Error('Fictional read failure');
  };
  assert.equal((await f.call('save_category', { action: 'create', set: { name: 'Unsafe replacement' } })).isError, true);
  f.env.DB.batch = original;
  assert.deepEqual(await f.snapshot(), before);
});

test('multi-entity migrations roll back atomically when a later write fails', async (t) => {
  const f = await setup();
  t.after(() => f.db.close());
  const before = await f.snapshot();
  f.db.exec("CREATE TRIGGER fictional_fail BEFORE DELETE ON methods BEGIN SELECT RAISE(ABORT, 'Fictional write failure'); END");
  assert.equal((await f.call('update_payment_method', { action: 'delete', method: 'wallet', migrate_to: 'target' })).isError, true);
  assert.deepEqual(await f.snapshot(), before);
});

const categoryWrite = (tool: string, category: string, extra: object = {}) =>
  tool === 'create_subscription'
    ? { name: 'New fictional subscription', price: 12, currency: 'USD', cycle: { unit: 'month' }, category, ...extra }
    : { subscription: 's', set: { category }, ...extra };

for (const tool of ['create_subscription', 'update_subscription']) {
  test(`strict category references: ${tool} rejects unknown names without any writes`, async (t) => {
    const f = await setup();
    t.after(() => f.db.close());
    const before = await f.snapshot();
    for (const dry_run of [false, true]) {
      for (const category of ['Typo category', 'Tes', '']) {
        const r = await f.call(tool, categoryWrite(tool, category, { dry_run }));
        assert.equal(r.isError, true, JSON.stringify(r));
        assert.match(r.content[0].text, /Test/);
        assert.match(r.content[0].text, /Other/);
        assert.deepEqual(await f.snapshot(), before);
      }
    }
  });

  test(`strict category references: ${tool} explicitly creates and references a validated category atomically`, async (t) => {
    const f = await setup();
    t.after(() => f.db.close());
    const before = await f.snapshot();
    const args = categoryWrite(tool, 'New category', { create_category: true, category_icon: 'book', category_color: '#aabbcc' });
    const ctx: ToolCtx = { env: f.env, overlay: new Map() };
    const preview = (await TOOLS.find((x) => x.name === tool)!.run({ ...args, dry_run: true }, ctx)) as any;
    assert.deepEqual(preview.created_category, { name: 'New category', icon: 'book', color: '#aabbcc' });
    assert.match(preview.category_notice, /New category/);
    assert.equal(preview.after.category, 'New category');
    assert.deepEqual(await f.snapshot(), before);
    const rpcPreview = await f.call(tool, { ...args, dry_run: true });
    assert.equal(rpcPreview.isError, undefined, JSON.stringify(rpcPreview));
    assert.deepEqual(rpcPreview.structuredContent.created_category, preview.created_category);
    assert.equal((await f.call(tool, args, f.read)).isError, true);
    assert.deepEqual(await f.snapshot(), before);
    const later = await TOOLS.find((x) => x.name === 'update_subscription')!.run({ subscription: 's', set: { category: 'NEW CATEGORY' }, dry_run: true }, ctx);
    assert.equal((later as any).after.category, 'New category');
    assert.deepEqual(await f.snapshot(), before);

    // Settings are written after subscriptions in saveLedgerEdit: both must roll back.
    f.db.exec("CREATE TRIGGER fictional_category_fail BEFORE UPDATE ON kv WHEN NEW.key = 'settings' BEGIN SELECT RAISE(ABORT, 'Fictional write failure'); END");
    assert.equal((await f.call(tool, args)).isError, true);
    assert.deepEqual(await f.snapshot(), before);
    f.db.exec('DROP TRIGGER fictional_category_fail');
    const result = await f.call(tool, args);
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.deepEqual(result.structuredContent.created_category, preview.created_category);
    const saved = await f.snapshot();
    assert.deepEqual(saved.settings.categories?.at(-1), preview.created_category);
    assert.equal(saved.subscriptions.find((s) => s.id === result.structuredContent.after.id)?.category, 'New category');
    assert.equal((await f.call('list_categories', {})).structuredContent.items.filter((c: any) => c.name === 'New category').length, 1);
  });

  test(`strict category references: ${tool} matches codes, case and localized aliases while retaining historical names`, async (t) => {
    const f = await setup();
    t.after(() => f.db.close());
    const st = await f.snapshot();
    await putKv(f.env, 'settings', { ...st.settings, categories: [{ name: 'Renamed tools', preset: 'tools' }, { name: 'Custom' }] });
    // Test is now a historical subscription category absent from the registry.
    const before = await f.snapshot();
    for (const [category, expected] of [
      ['tools', 'Renamed tools'],
      ['rEnAmEd ToOlS', 'Renamed tools'],
      ['tOoLs', 'Renamed tools'],
      ['工具', 'Renamed tools'],
      ['oUtIlS', 'Renamed tools'],
      ['ツール', 'Renamed tools'],
      ['custom', 'Custom'],
      ['TEST', 'Test'],
    ]) {
      const r = await f.call(tool, categoryWrite(tool, category, { create_category: true, dry_run: true }));
      assert.equal(r.isError, undefined, JSON.stringify(r));
      assert.equal(r.structuredContent.after.category, expected);
      assert.equal(r.structuredContent.created_category, undefined);
      assert.deepEqual(await f.snapshot(), before);
    }
    const saved = await f.call(tool, categoryWrite(tool, 'TEST'));
    assert.equal(saved.isError, undefined, JSON.stringify(saved));
    assert.equal(saved.structuredContent.after.category, 'Test');
    assert.deepEqual((await f.snapshot()).settings.categories, before.settings.categories);
  });

  test(`strict category references: ${tool} rejects ambiguity even with explicit creation`, async (t) => {
    const f = await setup();
    t.after(() => f.db.close());
    const st = await f.snapshot();
    await putKv(f.env, 'settings', {
      ...st.settings,
      categories: [{ name: 'Mixed' }, { name: 'MIXED' }, { name: 'First', preset: 'tools' }, { name: 'Second', preset: 'tools' }],
    });
    const before = await f.snapshot();
    for (const category of ['mixed', 'tools', 'OUTILS']) {
      for (const create_category of [false, true]) {
        const r = await f.call(tool, categoryWrite(tool, category, { create_category }));
        assert.equal(r.isError, true);
        assert.match(r.content[0].text, category === 'mixed' ? /Mixed.*MIXED/ : /First.*Second/);
        assert.deepEqual(await f.snapshot(), before);
      }
    }
    const exact = await f.call(tool, categoryWrite(tool, 'Mixed', { dry_run: true }));
    assert.equal(exact.isError, undefined, JSON.stringify(exact));
    assert.equal(exact.structuredContent.after.category, 'Mixed');
  });

  test(`strict category references: ${tool} shares save_category validation and leaves no failed drafts`, async (t) => {
    const f = await setup();
    t.after(() => f.db.close());
    const before = await f.snapshot();
    for (const name of [' ', 'x'.repeat(41)]) {
      assert.equal((await f.call(tool, categoryWrite(tool, name, { create_category: true }))).isError, true);
      assert.deepEqual(await f.snapshot(), before);
    }
    const ctx: ToolCtx = { env: f.env, overlay: new Map() };
    const invalid = tool === 'create_subscription' ? { method: 'Missing wallet' } : { set: { category: 'New category', method: 'Missing wallet' } };
    await assert.rejects(() =>
      TOOLS.find((x) => x.name === tool)!.run(categoryWrite(tool, 'New category', { create_category: true, dry_run: true, ...invalid }), ctx),
    );
    assert.equal(ctx.draftState, undefined);
    assert.equal(ctx.overlay!.size, 0);
    // Existing save_category drops invalid optional icon/color values; inline creation must do the same.
    const fields = { name: 'Cleaned category', icon: 'x'.repeat(33), color: 'invalid' };
    const registry = await f.call('save_category', { action: 'create', set: fields, dry_run: true });
    const inline = await f.call(
      tool,
      categoryWrite(tool, fields.name, { create_category: true, category_icon: fields.icon, category_color: fields.color, dry_run: true }),
    );
    assert.equal(inline.isError, undefined, JSON.stringify(inline));
    assert.deepEqual(inline.structuredContent.created_category, registry.structuredContent.after.at(-1));
    assert.deepEqual(await f.snapshot(), before);
  });
}

test('strict category references: assistant enrichment preserves unknown/localized inputs and confirmation creates only on apply', async (t) => {
  const f = await setup();
  t.after(() => f.db.close());
  const before = await f.snapshot();
  for (const category of ['Typo category', '工具']) {
    const args = categoryWrite('create_subscription', category, { icon: 'https://example.test/icon.png', url: 'https://example.test' });
    assert.equal((await enrichDraft(args)).args.category, category);
    const enriched = await enrichDraft({ set: { category } });
    assert.equal((enriched.args.set as any).category, category);
  }
  await putKv(f.env, 'assistant', { apiKey: 'fictional', baseUrl: 'https://fictional.example.test', model: 'fictional' });
  const args = categoryWrite('create_subscription', 'Assistant category', {
    create_category: true,
    category_icon: 'book',
    category_color: 'c3',
    icon: 'https://example.test/icon.png',
    url: 'https://example.test',
    dry_run: false,
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    const delta =
      calls++ === 0
        ? { tool_calls: [{ index: 0, id: 'category-call', type: 'function', function: { name: 'create_subscription', arguments: JSON.stringify(args) } }] }
        : { content: 'Draft ready.' };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  const stream = await (await chat(f.env, { text: 'Create a subscription and category', history: [] }, new AbortController().signal)).text();
  const proposal = stream
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
    .find((e) => e.type === 'proposal');
  assert.ok(proposal, stream);
  assert.equal(proposal.preview.created_category.name, 'Assistant category');
  assert.equal(proposal.args.create_category, true);
  assert.deepEqual(await f.snapshot(), before);
  await apply(f.env, { tool: proposal.tool, args: proposal.args });
  const after = await f.snapshot();
  assert.ok(after.settings.categories?.some((c) => c.name === 'Assistant category' && c.icon === 'book' && c.color === 'c3'));
  assert.equal(after.subscriptions.find((s) => s.id === proposal.args.id)?.category, 'Assistant category');
});

test('strict category references: omitted category uses an existing Tools category and never recreates a removed default', async (t) => {
  const f = await setup();
  t.after(() => f.db.close());
  const args = { name: 'Fictional default category', price: 12, currency: 'USD', cycle: { unit: 'month' }, dry_run: true };
  const before = await f.snapshot();
  assert.equal((await f.call('create_subscription', args)).isError, true);
  assert.equal((await f.call('create_subscription', { ...args, create_category: true })).isError, true);
  assert.deepEqual(await f.snapshot(), before);
  await putKv(f.env, 'settings', { ...before.settings, categories: [{ name: 'Renamed tools', preset: 'tools' }] });
  const withDefault = await f.snapshot();
  const preview = await f.call('create_subscription', args);
  assert.equal(preview.isError, undefined, JSON.stringify(preview));
  assert.equal(preview.structuredContent.after.category, 'Renamed tools');
  assert.deepEqual(await f.snapshot(), withDefault);
});

test('assistant draft dependencies cover wallets/categories/people/settings; stable ids apply in order', async (t) => {
  const f = await setup();
  t.after(() => f.db.close());
  const ctx: ToolCtx = { env: f.env, overlay: new Map() };
  const before = await f.snapshot();
  const tool = (name: string) => TOOLS.find((x) => x.name === name)!;
  const wallet = (await tool('update_payment_method').run(
    { action: 'create', set: { name: 'Draft wallet', kind: 'credit', currency: 'USD' }, dry_run: true },
    ctx,
  )) as any;
  const person = (await tool('save_person').run({ action: 'create', set: { name: 'Draft person' }, dry_run: true }, ctx)) as any;
  await tool('save_category').run({ action: 'create', set: { name: 'Draft category' }, dry_run: true }, ctx);
  const create = {
    id: 'draftsub',
    name: 'Draft subscription',
    price: 10,
    currency: 'USD',
    cycle: { unit: 'month', every: 1 },
    start: todayIn('UTC'),
    method: wallet.created.id,
    category: 'Draft category',
  };
  await tool('create_subscription').run({ ...create, dry_run: true }, ctx);
  await tool('set_proxy').run({ subscription: 'draftsub', person: person.created.id, dry_run: true }, ctx);
  assert.equal(ctx.overlay!.get('draftsub')!.proxy!.personId, person.created.id);
  assert.deepEqual(await f.snapshot(), before);
  await apply(f.env, {
    tool: 'update_payment_method',
    args: { action: 'create', id: wallet.created.id, set: { name: 'Draft wallet', kind: 'credit', currency: 'USD' } },
  });
  await apply(f.env, { tool: 'save_person', args: { action: 'create', id: person.created.id, set: { name: 'Draft person' } } });
  await apply(f.env, { tool: 'save_category', args: { action: 'create', set: { name: 'Draft category' } } });
  await apply(f.env, { tool: 'create_subscription', args: create });
  await apply(f.env, { tool: 'set_proxy', args: { subscription: 'draftsub', person: person.created.id } });
  assert.equal((await f.snapshot()).subscriptions.find((s) => s.id === 'draftsub')?.proxy?.personId, person.created.id);
});

// Provider is fictional and intercepted; no external AI or notification endpoint is used.
test('actual assistant chat forces new writes to proposals; only confirmed apply mutates', async (t) => {
  const f = await setup();
  t.after(() => f.db.close());
  await putKv(f.env, 'assistant', { apiKey: 'fictional', baseUrl: 'https://fictional.example.test', model: 'fictional' });
  const before = await f.snapshot();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    const delta =
      calls++ === 0
        ? {
            tool_calls: [
              {
                index: 0,
                id: 'call1',
                type: 'function',
                function: { name: 'update_settings', arguments: JSON.stringify({ set: { signedAmounts: false }, dry_run: false }) },
              },
            ],
          }
        : { content: 'Draft ready.' };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  const response = await chat(f.env, { text: 'Change signs', history: [] }, new AbortController().signal);
  const stream = await response.text();
  assert.match(stream, /proposal/);
  assert.deepEqual(await f.snapshot(), before);
  await apply(f.env, { tool: 'update_settings', args: { set: { signedAmounts: false } } });
  assert.equal((await f.snapshot()).settings.signedAmounts, false);
});

test('assistant pins member id when adding by person without a name; later receipt applies to that same member', async (t) => {
  const f = await setup();
  t.after(() => f.db.close());
  await putKv(f.env, 'assistant', { apiKey: 'fictional', baseUrl: 'https://fictional.example.test', model: 'fictional' });
  const before = await f.snapshot();
  let round = 0;
  let memberId = '';
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    let delta: object;
    if (round++ === 0)
      delta = {
        tool_calls: [
          {
            index: 0,
            id: 'member-call',
            type: 'function',
            function: { name: 'save_share_member', arguments: JSON.stringify({ subscription: 's', person: 'target', fee: 2, bill_every: 1 }) },
          },
        ],
      };
    else if (round === 2) {
      const result = JSON.parse(request.messages.at(-1).content);
      memberId = result.preview.member.id;
      delta = {
        tool_calls: [
          {
            index: 0,
            id: 'receipt-call',
            type: 'function',
            function: { name: 'record_receivable', arguments: JSON.stringify({ subscription: 's', kind: 'share', member: memberId, amount: 2 }) },
          },
        ],
      };
    } else delta = { content: 'Drafts ready.' };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  const stream = await chat(f.env, { text: 'Add the target person and record their payment' }, new AbortController().signal).text();
  const proposals = stream
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
    .filter((e) => e.type === 'proposal');
  assert.equal(proposals.length, 2, stream);
  assert.equal(proposals[0].args.id, memberId);
  assert.deepEqual(await f.snapshot(), before);
  for (const p of proposals) await apply(f.env, p);
  const member = (await f.snapshot()).subscriptions[0].share!.members.find((m) => m.id === memberId)!;
  assert.equal(member.personId, 'target');
  assert.equal(member.payments?.[0].amount, 2);
});

test('价格历史 MCP：编辑、删除、起始价保护、预览及只读权限', async (t) => {
  const f = await setup();
  t.after(() => f.db.close());
  const s: Subscription = {
    ...sub(),
    start: '2022-01-15',
    price: 15,
    currency: 'USD',
    share: undefined,
    proxy: undefined,
    phases: [
      {
        start: '2022-01-15',
        end: '2025-12-31',
        price: 200,
        currency: 'TRY',
        cycle: { unit: 'month', every: 1 },
        region: 'TR',
        priceHistory: [
          { from: '2022-01-15', amount: 40 },
          { from: '2023-01-15', amount: 60 },
          { from: '2024-01-15', amount: 120 },
          { from: '2025-01-15', amount: 200 },
        ],
        payments: [{ date: '2022-01-15', amount: 39, note: 'Actual' }],
      },
      { start: '2026-01-01', price: 15, currency: 'USD', cycle: { unit: 'month', every: 1 }, region: 'US' },
    ],
  };
  await upsert(f.env, 'subscriptions', 's', s);
  const phases = s.phases!;
  for (const args of [
    { action: 'edit', phase: s.start, original_from: '2024-01-15', from: '2024-02-15', amount: 130 },
    { action: 'remove', phase: s.start, original_from: '2023-01-15' },
    { action: 'edit', phase: s.start, original_from: s.start, amount: 35 },
  ]) {
    const before = await f.snapshot();
    const preview = await f.call('change_price', { subscription: 's', ...args, dry_run: true });
    assert.equal(preview.isError, undefined, JSON.stringify(preview));
    assert.ok(preview.structuredContent.affected_estimated_charges > 0);
    assert.deepEqual(await f.snapshot(), before);
    const denied = await f.call('change_price', { subscription: 's', ...args }, f.read);
    assert.equal(denied.isError, true);
    assert.deepEqual(await f.snapshot(), before);
    const saved = await f.call('change_price', { subscription: 's', ...args });
    assert.equal(saved.isError, undefined, JSON.stringify(saved));
    const actual = (await f.snapshot()).subscriptions[0];
    assert.deepEqual(actual.phases![0].payments, phases[0].payments);
    assert.deepEqual(actual.phases![1], phases[1]);
    assert.equal(actual.price, 15);
  }
  const revised = (await f.snapshot()).subscriptions[0];
  assert.deepEqual(revised.phases![0].priceHistory, [
    { from: '2022-01-15', amount: 35 },
    { from: '2024-02-15', amount: 130 },
    { from: '2025-01-15', amount: 200 },
  ]);
  const before = await f.snapshot();
  for (const args of [
    { action: 'remove', phase: s.start, original_from: s.start },
    { action: 'edit', phase: s.start, original_from: '2025-01-15', from: '2024-02-15', amount: 90 },
    { action: 'edit', phase: s.start, original_from: '2025-01-15', from: '2026-01-01', amount: 90 },
    { action: 'edit', original_from: '2025-01-15', amount: 90 },
  ]) {
    const failed = await f.call('change_price', { subscription: 's', ...args });
    assert.equal(failed.isError, true, JSON.stringify(failed));
    assert.deepEqual(await f.snapshot(), before);
  }
  const planArgs = {
    subscription: 's',
    action: 'edit',
    at: s.start,
    set: {
      priceHistory: [
        { from: '2025-01-15', amount: 180 },
        { from: s.start, amount: 32 },
      ],
    },
  };
  const preview = await f.call('change_plan', { ...planArgs, dry_run: true });
  assert.equal(preview.isError, undefined, JSON.stringify(preview));
  assert.ok(preview.structuredContent.affected_estimated_charges > 0);
  assert.deepEqual(await f.snapshot(), before);
  assert.equal((await f.call('change_plan', planArgs, f.read)).isError, true);
  assert.deepEqual(await f.snapshot(), before);
  assert.equal((await f.call('change_plan', planArgs)).isError, undefined);
  const after = (await f.snapshot()).subscriptions[0];
  assert.equal(after.phases![0].price, 180);
  assert.deepEqual(after.phases![0].priceHistory, [
    { from: s.start, amount: 32 },
    { from: '2025-01-15', amount: 180 },
  ]);
  assert.deepEqual(after.phases![0].payments, phases[0].payments);
  assert.deepEqual(after.phases![1], phases[1]);
});

test('renewal rules: MCP create/update preview, read scope, dates, validation and API history', async (t) => {
  const f = await setup();
  t.after(() => f.db.close());
  const before = await f.snapshot();
  const args = {
    name: 'Fictional domain',
    category: 'Test',
    price: 12,
    currency: 'USD',
    start: '2026-01-01',
    cycle: { unit: 'year', every: 1 },
    chargeLeadDays: 30,
    cancelLeadDays: 1,
  };
  const preview = await f.call('create_subscription', { ...args, dry_run: true });
  assert.equal(preview.isError, undefined, JSON.stringify(preview));
  assert.deepEqual(await f.snapshot(), before);
  assert.equal((await f.call('create_subscription', args, f.read)).isError, true);
  const saved = await f.call('create_subscription', args);
  assert.equal(saved.isError, undefined, JSON.stringify(saved));
  const domain = (await f.snapshot()).subscriptions.find((s) => s.name === args.name)!;
  const detail = await f.call('get_subscription', { subscription: domain.id }, f.read);
  assert.equal(detail.structuredContent.next_charge, '2026-12-02');
  assert.equal(detail.structuredContent.service_expires, '2027-01-01');
  assert.equal(detail.structuredContent.cancel_by, '2026-12-01');
  const patch = { subscription: domain.id, set: { chargeLeadDays: 10, cancelLeadDays: 2 } };
  const original = await f.snapshot();
  assert.equal((await f.call('update_subscription', { ...patch, dry_run: true })).isError, undefined);
  assert.deepEqual(await f.snapshot(), original);
  assert.equal((await f.call('update_subscription', patch, f.read)).isError, true);
  assert.equal((await f.call('update_subscription', patch)).isError, undefined);
  const updated = (await f.snapshot()).subscriptions.find((s) => s.id === domain.id)!;
  assert.equal(updated.renewalHistory?.[0].chargeLeadDays, 30);
  assert.equal(updated.renewalHistory?.at(-1)?.chargeLeadDays, 10);
  for (const value of [-1, 1.5, 3661]) {
    assert.equal((await f.call('update_subscription', { subscription: domain.id, set: { chargeLeadDays: value } })).isError, true);
    assert.equal((await f.call('create_subscription', { ...args, name: `Invalid ${value}`, chargeLeadDays: value })).isError, true);
  }
  const response = await f.request(`subscriptions/${domain.id}`, 'PUT', { ...updated, cancelLeadDays: 7, renewalHistory: undefined });
  assert.equal(response.status, 200, await response.clone().text());
  const apiRecord = await response.json();
  assert.equal(apiRecord.renewalHistory[0].chargeLeadDays, 30);
  assert.equal(apiRecord.renewalHistory.at(-1).cancelLeadDays, 7);
  const denied = await f.request(`subscriptions/${domain.id}`, 'PUT', updated, false);
  assert.equal(denied.status, 401);
});

const avatarPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

test('private person avatar: authenticated API, MCP permissions/preview/removal, masking and backup round-trip', async () => {
  const f = await setup();
  try {
    const avatar = avatarPng;
    const args = { action: 'update', person: 'person', avatar_base64: avatar.split(',')[1], mime: 'image/png' };
    const rev = await getRev(f.env);
    const snapshot = JSON.stringify(await f.snapshot());
    assert.equal((await f.call('save_person', { ...args, dry_run: true })).isError, undefined);
    assert.equal(await getRev(f.env), rev);
    assert.equal(JSON.stringify(await f.snapshot()), snapshot);
    assert.equal((await f.call('save_person', args, f.read)).isError, true);
    assert.equal((await f.call('save_person', args)).isError, undefined);
    assert.equal((await f.snapshot()).people?.find((p) => p.id === 'person')?.avatar, avatar);
    const rows = await f.call('list_people', {});
    assert.ok(JSON.stringify(rows).includes('has_avatar'));
    assert.ok(!JSON.stringify(rows).includes('data:image'));
    assert.ok(!JSON.stringify(rows).includes(args.avatar_base64));
    const changedRev = await getRev(f.env);
    for (const invalid of [
      { avatar_url: 'http://example.test/a.png' },
      { avatar_url: 'https://example.test/a.png' },
      { avatar_url: 'file:///a.png' },
      { avatar_base64: 'A'.repeat(90_000), mime: 'image/png' },
      { avatar_base64: args.avatar_base64, mime: 'image/svg+xml' },
      { avatar: null, avatar_base64: args.avatar_base64, mime: 'image/png' },
      { mime: 'image/png' },
    ])
      assert.equal((await f.call('save_person', { action: 'update', person: 'person', ...invalid })).isError, true);
    assert.equal(await getRev(f.env), changedRev);
    assert.equal((await f.request('people/person', 'PUT', { id: 'person', name: 'Fictional person', avatar }, false)).status, 401);
    assert.equal((await f.request('people/person', 'PUT', { id: 'person', name: 'Fictional person', avatar: 'https://example.test/a.png' })).status, 400);
    assert.equal((await f.request('people/person', 'PUT', { id: 'person', name: 'Fictional person', avatar })).status, 200);
    await putKv(f.env, 'settings', { ...(await f.snapshot()).settings, publicView: true });
    await upsert(f.env, 'subscriptions', 'public-sharing', { ...sub(), id: 'public-sharing', proxy: undefined });
    const publicResponse = await f.request('public', 'GET', undefined, false);
    assert.equal(publicResponse.status, 200);
    const publicState = await publicResponse.json();
    assert.equal(publicState.people, undefined);
    assert.equal(publicState.subscriptions.length, 1);
    assert.equal(publicState.subscriptions[0].share.members.length, 1);
    assert.ok(!JSON.stringify(publicState).includes(avatar));
    assert.ok(!JSON.stringify(publicState).includes('personId'));
    const backup = await (await f.request('backup')).json();
    assert.equal(backup.people.find((p: { id: string }) => p.id === 'person').avatar, avatar);
    const { parseBackup } = await import('../worker/backup.ts');
    assert.equal(parseBackup({ subscriptions: [], version: 2 }).people.length, 0);
    const malformed = structuredClone(backup);
    malformed.people[0].avatar = 'http://example.test/a.png';
    assert.equal((await f.request('backup', 'POST', malformed)).status, 400);
    assert.equal((await f.call('save_person', { action: 'update', person: 'person', avatar: null, dry_run: true })).isError, undefined);
    assert.equal((await f.snapshot()).people?.find((p) => p.id === 'person')?.avatar, avatar);
    assert.equal((await f.call('save_person', { action: 'update', person: 'person', avatar: null })).isError, undefined);
    assert.equal((await f.snapshot()).people?.find((p) => p.id === 'person')?.avatar, undefined);
    assert.equal((await f.request('backup', 'POST', backup)).status, 200);
    assert.equal((await f.snapshot()).people?.find((p) => p.id === 'person')?.avatar, avatar);
    assert.equal((await f.request('people/person', 'PUT', { id: 'person', name: 'Fictional person' })).status, 200);
    assert.equal((await f.snapshot()).people?.find((p) => p.id === 'person')?.avatar, undefined);
    await apply(f.env, { tool: 'save_person', args });
    assert.equal((await f.snapshot()).people?.find((p) => p.id === 'person')?.avatar, avatar);
  } finally {
    f.db.close();
  }
});

test('accounts belong to person × plan: API/MCP persistence, independent updates, preview, permissions and public privacy', async () => {
  const f = await setup();
  try {
    const make = (id: string, name: string, account: string): Subscription => ({
      ...sub(),
      id,
      name,
      proxy: undefined,
      share: { ...sub().share!, members: [{ ...sub().share!.members[0], account }] },
    });
    for (const s of [make('youtube', 'YouTube', 'alex@example.test'), make('spotify', 'Spotify', '+65 8000 0000')]) {
      assert.equal((await f.request(`subscriptions/${s.id}`, 'PUT', s, false)).status, 401);
      assert.equal((await f.request(`subscriptions/${s.id}`, 'PUT', s)).status, 200);
    }
    const accounts = async () => {
      const result = await f.call('list_people', {}, f.read);
      assert.equal(result.isError, undefined);
      const person = result.structuredContent.people.find((p: { person_id: string }) => p.person_id === 'person');
      assert.ok(!('account' in person.record));
      assert.ok(!('account' in person.in.find((i: { kind: string }) => i.kind === 'proxy')));
      return Object.fromEntries(
        person.in.filter((i: { kind: string }) => i.kind === 'share').map((i: { subscription_id: string; account?: string }) => [i.subscription_id, i.account]),
      );
    };
    assert.deepEqual(await accounts(), { s: null, youtube: 'alex@example.test', spotify: '+65 8000 0000' });
    // The fixture also has a share membership and a proxy relationship on s.
    const patch = { subscription: 'youtube', member: 'member', account: '  user / arbitrary ID #42  ' };
    const before = await f.snapshot();
    const rev = await getRev(f.env);
    assert.equal((await f.call('save_share_member', { ...patch, dry_run: true })).isError, undefined);
    assert.deepEqual(await f.snapshot(), before);
    assert.equal(await getRev(f.env), rev);
    assert.equal((await f.call('save_share_member', patch, f.read)).isError, true);
    assert.equal((await f.call('save_share_member', patch)).isError, undefined);
    assert.equal((await accounts()).youtube, 'user / arbitrary ID #42');
    assert.equal((await accounts()).spotify, '+65 8000 0000');
    assert.equal(
      (await f.call('save_person', { action: 'update', person: 'person', set: { name: 'Alex', contact: 'alex-contact@example.test', contactVia: '邮箱' } }))
        .isError,
      undefined,
    );
    assert.equal((await accounts()).youtube, 'user / arbitrary ID #42');
    assert.equal((await accounts()).spotify, '+65 8000 0000');
    assert.equal((await f.call('save_person', { action: 'update', person: 'person', set: { account: 'wrong scope' } })).isError, true);
    await putKv(f.env, 'settings', { ...(await f.snapshot()).settings, publicView: true });
    const response = await f.request('public', 'GET', undefined, false);
    assert.equal(response.status, 200);
    const publicState = await response.json();
    assert.equal(publicState.subscriptions.length, 2);
    for (const s of publicState.subscriptions) {
      assert.equal(s.account, undefined);
      assert.equal(s.share.members.length, 1);
      assert.ok(!('account' in s.share.members[0]));
    }
    const serialized = JSON.stringify(publicState);
    for (const secret of ['alex@example.test', '+65 8000 0000', 'user / arbitrary ID #42', 'alex-contact@example.test'])
      assert.ok(!serialized.includes(secret));
    assert.equal((await f.call('save_share_member', { ...patch, account: '  ' })).isError, undefined);
    const cleared = (await f.snapshot()).subscriptions.find((s) => s.id === 'youtube')!.share!.members[0];
    assert.equal(cleared.account, undefined);
    assert.equal((await accounts()).youtube, null);
    assert.equal((await accounts()).spotify, '+65 8000 0000');
  } finally {
    f.db.close();
  }
});

test('carpool collection rule: MCP reads, sets, follows and customizes member fees', async () => {
  const f = await setup();
  try {
    const plan = async () => (await f.call('get_carpool', { subscription: 's' }, f.read)).structuredContent.plans[0];
    const member = async (id: string) =>
      (await f.snapshot()).subscriptions.find((s) => s.id === 's')!.share!.members.find((m) => m.id === id || m.name === id)!;
    let p = await plan();
    assert.deepEqual(p.rule, { fee: 3, currency: 'USD', every_months: 1, stored: false });
    assert.equal(p.members[0].follows_rule, true);
    assert.equal(p.members[0].overdue_days, 0);

    // 新成员没给收费标准时按车的规则
    assert.equal((await f.call('save_share_member', { subscription: 's', name: 'Newcomer' })).isError, undefined);
    assert.equal((await member('Newcomer')).fee, 3);
    assert.equal((await member('Newcomer')).feeCurrency, 'USD');

    // 预览不写入
    const before = await f.snapshot();
    assert.equal((await f.call('set_share', { subscription: 's', role: 'owner', rule: { fee: 4 }, dry_run: true })).isError, undefined);
    assert.deepEqual(await f.snapshot(), before);

    const set = await f.call('set_share', { subscription: 's', role: 'owner', rule: { fee: 4 } });
    assert.equal(set.isError, undefined);
    assert.deepEqual(set.structuredContent.rule, { fee: 4, currency: 'USD', every_months: 1, stored: true });
    assert.equal((await member('member')).fee, 4);
    assert.equal((await member('Newcomer')).fee, 4);
    // 收款记录不受改规则影响
    assert.equal((await member('member')).payments?.length, 1);

    // 单独改收费 → 自定义，之后改车的规则不再影响他
    const custom = await f.call('save_share_member', { subscription: 's', member: 'member', fee: 5 });
    assert.equal(custom.structuredContent.member.custom, true);
    assert.equal(custom.structuredContent.member.follows_rule, false);
    assert.equal((await f.call('set_share', { subscription: 's', role: 'owner', rule: { fee: 6, bill_every: 3 } })).isError, undefined);
    assert.equal((await member('member')).fee, 5);
    assert.equal((await member('Newcomer')).fee, 6);
    assert.equal((await member('Newcomer')).billEvery, 3);

    // 改回跟随车
    const follow = await f.call('save_share_member', { subscription: 's', member: 'member', follow_rule: true });
    assert.equal(follow.structuredContent.member.follows_rule, true);
    assert.equal((await member('member')).fee, 6);
    assert.equal((await member('member')).custom, undefined);
    p = await plan();
    assert.ok(p.members.every((m: { follows_rule: boolean }) => m.follows_rule));

    // 只读令牌不能改规则；非法周期报错
    assert.equal((await f.call('set_share', { subscription: 's', role: 'owner', rule: { fee: 1 } }, f.read)).isError, true);
    assert.equal((await f.call('set_share', { subscription: 's', role: 'owner', rule: { bill_every: 5 } })).isError, true);
  } finally {
    f.db.close();
  }
});

test('future custom fees are classified at their effective date, before later car-rule edits', async (t) => {
  const f = await setup();
  t.after(() => f.db.close());
  const today = todayIn('UTC');
  const from = addDays(today, 40);
  const s = { ...sub(), start: '2025-01-01', share: { ...sub().share!, rule: { fee: 3, currency: 'USD', billEvery: 1 } } };
  await upsert(f.env, 'subscriptions', 's', s);
  const edit = { subscription: 's', member: 'member', fee: 100, bill_every: 12, fee_from: from };
  const before = await f.snapshot();
  assert.equal((await f.call('save_share_member', { ...edit, dry_run: true })).isError, undefined);
  assert.deepEqual(await f.snapshot(), before);
  assert.equal((await f.call('save_share_member', edit, f.read)).isError, true);
  assert.equal((await f.call('save_share_member', edit)).isError, undefined);
  let saved = (await f.snapshot()).subscriptions[0];
  assert.equal(saved.share!.members[0].custom, true);
  assert.equal(memberRate(saved, saved.share!.members[0], today).amount, 3);
  assert.equal(memberRate(saved, saved.share!.members[0], from).amount, 100);
  const custom = structuredClone(saved.share!.members[0]);
  assert.equal((await f.call('set_share', { subscription: 's', role: 'owner', rule: { fee: 4 } })).isError, undefined);
  saved = (await f.snapshot()).subscriptions[0];
  assert.deepEqual(saved.share!.members[0], custom);
  assert.equal((await f.call('save_share_member', { subscription: 's', member: 'member', fee: 4, bill_every: 1, fee_from: from })).isError, undefined);
  assert.equal((await f.snapshot()).subscriptions[0].share!.members[0].custom, undefined);
});

test('follow_rule ignores explicit fee fields without losing the old fee baseline or receipts', async (t) => {
  const f = await setup();
  t.after(() => f.db.close());
  const today = todayIn('UTC');
  const s = { ...sub(), start: '2025-01-01', share: { ...sub().share!, rule: { fee: 6, currency: 'USD', billEvery: 3 } } };
  await upsert(f.env, 'subscriptions', 's', s);
  assert.equal((await f.call('save_share_member', { subscription: 's', member: 'member', follow_rule: true, fee: 6, bill_every: 3 })).isError, undefined);
  const saved = (await f.snapshot()).subscriptions[0];
  const m = saved.share!.members[0];
  assert.deepEqual(memberRate(saved, m, addDays(today, -1)), { amount: 3, currency: 'USD', billEvery: 1 });
  assert.deepEqual(memberRate(saved, m, today), { amount: 6, currency: 'USD', billEvery: 3 });
  assert.deepEqual(m.payments, s.share.members[0].payments);
  assert.equal(m.paidUntil, s.share.members[0].paidUntil);
});

test('MCP overdue days match the UI for exempt and departed members with no unpaid periods', async (t) => {
  const f = await setup();
  t.after(() => f.db.close());
  const s = sub();
  s.start = '2025-01-01';
  s.share!.members = [
    { id: 'exempt', name: 'Exempt', share: 0, fee: 0, exempt: true, joined: '2025-01-01' },
    { id: 'left', name: 'Departed settled', share: 3, fee: 3, left: '2025-06-01', paidUntil: '2025-05-31', joined: '2025-01-01' },
    { id: 'arrears', name: 'Departed owing', share: 3, fee: 3, left: '2025-06-01', joined: '2025-01-01' },
  ];
  await upsert(f.env, 'subscriptions', 's', s);
  const result = await f.call('get_carpool', { subscription: 's' });
  const rows = result.structuredContent.plans[0].members;
  assert.equal(rows.find((m: { id: string }) => m.id === 'exempt').overdue_days, 0);
  assert.equal(rows.find((m: { id: string }) => m.id === 'left').overdue_days, 0);
  assert.ok(rows.find((m: { id: string }) => m.id === 'arrears').overdue_days > 0);
});

test('assistant car-rule and member drafts compose without saving; confirmation preserves dates and receipts', async (t) => {
  const f = await setup();
  t.after(() => f.db.close());
  await putKv(f.env, 'assistant', { apiKey: 'fictional', baseUrl: 'https://fictional.example.test' });
  const before = await f.snapshot();
  const today = todayIn('UTC');
  const from = addDays(today, 40);
  const edits = [
    { name: 'set_share', args: { subscription: 's', role: 'owner', rule: { fee: 6, bill_every: 3 }, rule_from: from } },
    { name: 'save_share_member', args: { subscription: 's', member: 'member', fee: 100, bill_every: 12, follow_rule: false } },
    { name: 'save_share_member', args: { subscription: 's', member: 'member', fee: 100, bill_every: 12, follow_rule: false, fee_from: from } },
    { name: 'save_share_member', args: { subscription: 's', name: 'Carol' } },
  ];
  let round = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    const delta =
      round++ === 0
        ? {
            tool_calls: edits.map((e, index) => ({
              index,
              id: `car-${index}`,
              type: 'function',
              function: { name: e.name, arguments: JSON.stringify({ ...e.args, dry_run: false }) },
            })),
          }
        : { content: 'Drafts ready.' };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  const stream = await chat(f.env, { text: 'Change the rule, customize a member, and add Carol' }, new AbortController().signal).text();
  const proposals = stream
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
    .filter((e) => e.type === 'proposal');
  assert.equal(proposals.length, 4, stream);
  assert.ok(proposals.every((p) => p.preview.dry_run === true));
  assert.deepEqual(await f.snapshot(), before);
  for (const p of proposals) {
    const response = await f.request('assistant/apply', 'POST', p);
    assert.equal(response.status, 200);
  }
  const s = (await f.snapshot()).subscriptions[0];
  const m = s.share!.members.find((m) => m.id === 'member')!;
  assert.deepEqual(memberRate(s, m, today), { amount: 100, currency: 'USD', billEvery: 12 });
  assert.deepEqual(memberRate(s, m, from), { amount: 100, currency: 'USD', billEvery: 12 });
  assert.equal(m.custom, true);
  assert.deepEqual(m.payments, before.subscriptions[0].share!.members[0].payments);
  assert.equal(m.paidUntil, before.subscriptions[0].share!.members[0].paidUntil);
  const carol = s.share!.members.find((m) => m.name === 'Carol')!;
  assert.equal(carol.id, proposals[3].args.id);
  assert.deepEqual(memberRate(s, carol, today), { amount: 6, currency: 'USD', billEvery: 3 });
});

test('下车退款 MCP：预览无写入、读令牌拒绝写、实际退款保留收款、查询与清除一致', async () => {
  const f = await setup();
  try {
    const s = sub();
    s.proxy = undefined;
    s.start = '2026-01-01';
    const m = s.share!.members[0];
    Object.assign(m, {
      joined: '2026-01-01',
      paidUntil: '2026-01-31',
      payments: [{ date: '2026-01-01', from: '2026-01-01', until: '2026-01-31', amount: 31, currency: 'USD' }],
    });
    await upsert(f.env, 'subscriptions', s.id, s);
    const args = { subscription: 's', member: 'member', left: '2026-01-16', leave_refund: { amount: 12.34, note: 'Private actual settlement' } };
    const before = await f.snapshot();
    const rev = await getRev(f.env);
    const preview = await f.call('save_share_member', { ...args, dry_run: true });
    assert.equal(preview.isError, undefined);
    assert.equal(preview.structuredContent.suggested_refund.amount, 16);
    assert.equal(preview.structuredContent.unused_days, 16);
    assert.deepEqual(preview.structuredContent.member.leave_refund, { amount: 12.34, currency: 'USD', date: args.left, note: args.leave_refund.note });
    assert.deepEqual(await f.snapshot(), before);
    assert.equal(await getRev(f.env), rev);
    assert.equal((await f.call('save_share_member', args, f.read)).isError, true);
    assert.equal((await f.call('save_share_member', args)).isError, undefined);
    const saved = (await f.snapshot()).subscriptions[0];
    assert.deepEqual(saved.share!.members[0].payments, m.payments);
    assert.equal(saved.share!.members[0].paidUntil, m.paidUntil);
    const car = (await f.call('get_carpool', { subscription: 's' }, f.read)).structuredContent.plans[0];
    assert.equal(car.to_date.received, 18.66);
    assert.equal(car.members[0].leave_refund.amount, 12.34);
    assert.equal((await f.call('get_subscription', { subscription: 's' }, f.read)).structuredContent.share.members[0].leave_refund.amount, 12.34);
    const people = (await f.call('list_people', {}, f.read)).structuredContent.people;
    assert.equal(people.find((p: { person_id: string }) => p.person_id === 'person').in[0].leave_refund.amount, 12.34);
    await putKv(f.env, 'settings', { ...(await f.snapshot()).settings, publicView: true });
    const pub = await (await f.request('public', 'GET', undefined, false)).json();
    assert.ok(!JSON.stringify(pub).includes('Private actual settlement'));
    assert.ok(!('leaveRefund' in pub.subscriptions[0].share.members[0]));
    const backup = await (await f.request('backup')).json();
    assert.equal(backup.subscriptions[0].share.members[0].leaveRefund.amount, 12.34);
    assert.equal((await f.request('backup', 'POST', backup)).status, 200);
    assert.deepEqual((await f.snapshot()).subscriptions[0].share!.members[0].leaveRefund, saved.share!.members[0].leaveRefund);
    assert.equal((await f.call('save_share_member', { subscription: 's', member: 'member', leave_refund: null })).isError, undefined);
    assert.equal((await f.snapshot()).subscriptions[0].share!.members[0].leaveRefund, undefined);
    assert.equal((await f.call('save_share_member', args)).isError, undefined);
    assert.equal((await f.call('save_share_member', { subscription: 's', member: 'member', left: null })).isError, undefined);
    const cleared = (await f.snapshot()).subscriptions[0].share!.members[0];
    assert.equal(cleared.left, undefined);
    assert.equal(cleared.leaveRefund, undefined);
    assert.deepEqual(cleared.payments, m.payments);
    // HTTP save clears an existing leave settlement as well.
    assert.equal((await f.call('save_share_member', args)).isError, undefined);
    const http = (await f.snapshot()).subscriptions[0];
    delete http.share!.members[0].left;
    assert.equal((await f.request('subscriptions/s', 'PUT', http)).status, 200);
    assert.equal((await f.snapshot()).subscriptions[0].share!.members[0].leaveRefund, undefined);
  } finally {
    f.db.close();
  }
});

test('退款校验贯穿 MCP、HTTP 和备份导入：正金额、有效币种日期、先设退出且不早于加入', async () => {
  const f = await setup();
  try {
    const s = sub();
    s.start = '2026-01-01';
    s.share!.members[0].joined = '2026-01-01';
    await upsert(f.env, 'subscriptions', s.id, s);
    const before = await f.snapshot();
    for (const patch of [
      { leave_refund: { amount: 1 } },
      { left: '2026-01-16', leave_refund: { amount: 0 } },
      { left: '2026-01-16', leave_refund: { amount: -1 } },
      { left: '2026-01-16', leave_refund: { amount: 1, date: '2025-12-31' } },
      { left: '2026-01-16', leave_refund: { amount: 1, date: '2026-02-30' } },
      { left: '2026-01-16', leave_refund: { amount: 1, currency: 'ZZZ' } },
      { left: null, leave_refund: { amount: 1 } },
    ]) {
      const r = await f.call('save_share_member', { subscription: 's', member: 'member', ...patch, dry_run: true });
      assert.equal(r.isError, true, JSON.stringify(patch));
      assert.ok(!JSON.stringify(r).includes('core.subError.refund'), 'refund errors must be translated in the Worker bundle');
      assert.deepEqual(await f.snapshot(), before);
    }
    for (const r of [
      { amount: 0, date: '2026-01-16', currency: 'USD' },
      { amount: 1, date: '2025-01-01', currency: 'USD' },
      { amount: 1, date: 'wrong', currency: 'USD' },
    ]) {
      const invalid = structuredClone(s);
      Object.assign(invalid.share!.members[0], { left: '2026-01-16', leaveRefund: r });
      assert.equal((await f.request('subscriptions/s', 'PUT', invalid)).status, 400);
      assert.equal((await f.request('backup', 'POST', { subscriptions: [invalid] })).status, 400);
    }
  } finally {
    f.db.close();
  }
});

test('助手下车退款必须确认，确认参数固定预览日期币种并保留实际金额', async (t) => {
  const f = await setup();
  t.after(() => f.db.close());
  const s = sub();
  s.start = '2026-01-01';
  s.share!.members[0].joined = '2026-01-01';
  s.share!.members[0].left = '2026-10-01';
  await upsert(f.env, 'subscriptions', s.id, s);
  await putKv(f.env, 'assistant', { apiKey: 'fictional', baseUrl: 'https://fictional.example.test', model: 'fictional' });
  const before = await f.snapshot();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    const delta =
      calls++ === 0
        ? {
            tool_calls: [
              {
                index: 0,
                id: 'refund-call',
                type: 'function',
                function: {
                  name: 'save_share_member',
                  arguments: JSON.stringify({ subscription: 's', member: 'member', leave_refund: { amount: 1.23 }, dry_run: false }),
                },
              },
            ],
          }
        : { content: 'Draft ready.' };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  const stream = await chat(f.env, { text: 'Record the actual refund' }, new AbortController().signal).text();
  const proposal = stream
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
    .find((e) => e.type === 'proposal');
  assert.ok(proposal, stream);
  assert.deepEqual(proposal.args.leave_refund, { amount: 1.23, date: '2026-10-01', currency: 'USD' });
  assert.deepEqual(await f.snapshot(), before);
  await apply(f.env, proposal);
  assert.deepEqual((await f.snapshot()).subscriptions[0].share!.members[0].leaveRefund, proposal.args.leave_refund);
});
