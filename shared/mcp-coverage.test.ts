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
import { ASSISTANT_TOOLS, apply, chat } from '../worker/ai/assistant.ts';
import { DEFAULT_SETTINGS, type AppState, type Subscription } from './types.ts';
import { todayIn } from './billing.ts';
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
