import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { addDays, addMonths, todayIn } from './billing.ts';
import { flatten, setLocale, t } from './i18n.ts';
import { inListScope, listWords } from './list-scope.ts';
import { monthReport, scopeReport, type Block, type ScopeReport } from './scope-report.ts';
import { DEFAULT_SETTINGS, type PaymentMethod, type Subscription } from './types.ts';
import { TOOLS } from '../worker/ai/mcp-tools.ts';
import { state, type ToolCtx } from '../worker/ai/tool-kit.ts';
import { MIGRATIONS } from '../worker/migrations.gen.ts';
import type { Env } from '../worker/env.ts';

const messages = {};
for (const ns of ['core', 'common', 'mcp']) flatten(ns, JSON.parse(readFileSync(new URL(`./locales/en/${ns}.json`, import.meta.url), 'utf8')), messages);
setLocale('en', [messages]);

const today = todayIn('UTC');
const month = today.slice(0, 7);
const first = `${month}-01`;
const sub = (id: string, extra: Partial<Subscription> = {}): Subscription => ({
  id,
  name: id,
  category: 'Tools',
  tags: [],
  price: 10,
  currency: 'USD',
  cycle: { unit: 'month', every: 1 },
  start: addMonths(first, -14),
  status: 'active',
  ...extra,
});
const methods: PaymentMethod[] = [
  { id: 'card', name: 'Visa Card', kind: 'card', currency: 'USD' } as PaymentMethod,
  { id: 'wallet', name: 'Wallet', kind: 'balance', currency: 'EUR' } as PaymentMethod,
];
// 虚构账本：两条在订（不同分类与支付方式）、一条已结束、一条二手转让、一条代付
const ledger = (): Subscription[] => [
  sub('Editor', { tags: ['Work'], methodId: 'card', region: 'US', notes: 'design tool' }),
  sub('Music', { category: 'Media', price: 120, currency: 'EUR', cycle: { unit: 'year', every: 1 }, start: addMonths(first, -6), methodId: 'wallet' }),
  sub('OldTool', { start: addMonths(first, -20), end: addMonths(first, -3), status: 'cancelled', methodId: 'card' }),
  sub('Secondhand', {
    category: 'Media',
    price: 4,
    start: addMonths(first, -2),
    transfers: [
      { kind: 'buy', date: addMonths(first, -2), amount: 50, currency: 'USD' },
      { kind: 'sell', date: first, amount: 30, currency: 'USD' },
    ],
  }),
  sub('ForMom', { proxy: { forName: 'Mom' } as Subscription['proxy'] }),
];

/** 真 SQLite（内存）+ 迁移，读工具只读，不发外部请求。 */
function fixture(subs = ledger()) {
  const db = new DatabaseSync(':memory:');
  for (const m of MIGRATIONS) for (const sql of m.statements) db.exec(sql);
  for (const s of subs) db.prepare('INSERT INTO subscriptions (id, data) VALUES (?, ?)').run(s.id, JSON.stringify(s));
  for (const m of methods) db.prepare('INSERT INTO methods (id, data) VALUES (?, ?)').run(m.id, JSON.stringify(m));
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('settings', JSON.stringify({ ...DEFAULT_SETTINGS, baseCurrency: 'USD', timezone: 'UTC' }));
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
        const query = db.prepare(sql);
        if (query.columns().length) return { results: query.all(...args) };
        return { results: [], meta: { changes: Number(query.run(...args).changes) } };
      },
    };
    return stmt;
  };
  const ctx: ToolCtx = {
    env: { DB: { prepare, batch: (stmts: Array<ReturnType<typeof prepare>>) => Promise.all(stmts.map((s) => s.run())) } } as unknown as Env,
    access: { client: 'mcp', scope: 'read' },
  };
  const run = (name: string, args: Record<string, unknown> = {}) => TOOLS.find((x) => x.name === name)!.run(args, ctx) as Promise<Record<string, any>>;
  return { db, ctx, run };
}

const get = <T extends Block['type']>(r: ScopeReport, type: T) => r.blocks.find((b): b is Extract<Block, { type: T }> => b.type === type);
const block = (r: Record<string, any>, type: string) => r.blocks.find((b: { type: string }) => b.type === type);
const r2 = (n: number) => Math.round(n * 100) / 100;

test('month_report 与日历 monthReport() 同一口径，含转让收付，排除代付', async () => {
  const f = fixture();
  try {
    const { st } = await state(f.ctx);
    const expected = monthReport(st, month, today);
    const out = await f.run('get_insights', { section: 'month_report' });
    assert.equal(out.month, month);
    assert.equal(out.incomplete, false);
    const head = get(expected, 'headline')!;
    assert.equal(head.mode, 'month');
    const h = block(out, 'headline');
    assert.equal(h.total, r2(head.total));
    assert.equal(h.paid, r2(head.paid));
    assert.equal(h.pending, r2(head.pending));
    assert.equal(h.count, head.count);
    assert.equal(h.vs_previous_month.amount, r2(head.previous.amount));
    assert.deepEqual(
      out.months,
      expected.months.map((m) => ({ month: m.month, total: r2(m.total), paid: r2(m.paid), pending: r2(m.pending) })),
    );
    assert.deepEqual(
      out.blocks.map((b: { type: string }) => b.type),
      expected.blocks.map((b) => b.type),
    );
    // 本月卖出 30：现金合计 = 扣款 − 30；笔数不含转让，代付不计
    assert.deepEqual(
      out.transfers.map((x: Record<string, unknown>) => [x.name, x.kind, x.amount]),
      [['Secondhand', 'sell', -30]],
    );
    const top = block(out, 'top');
    assert.ok(!top.rows.some((r: { name: string }) => r.name === 'ForMom'));
    const charges = top.rows.reduce((a: number, r: { amount: number }) => a + r.amount, 0);
    assert.equal(r2(charges - 30), h.total);
    assert.ok(top.rows.every((r: Record<string, any>) => r.bill.currency && typeof r.bill.amount === 'number'));
    // 与网页同口径：spending_stats 本月加转让后等于月报合计，不加则差 30
    const withTransfers = await f.run('spending_stats', { period: 'this_month', group_by: 'none', include_transfers: true });
    assert.equal(withTransfers.total, h.total);
    assert.equal(withTransfers.transfer_total, -30);
    const plain = await f.run('spending_stats', { period: 'this_month', group_by: 'none' });
    assert.equal(r2(plain.total - 30), h.total);
    // 上个月：两月前的买入不在，前一月无转让
    const prev = await f.run('get_insights', { section: 'month_report', month: addMonths(first, -2).slice(0, 7) });
    assert.deepEqual(
      prev.transfers.map((x: Record<string, unknown>) => x.amount),
      [50],
    );
    await assert.rejects(f.run('get_insights', { section: 'month_report', month: '2026-13' }), { message: t('mcp.error.badMonth', { month: '2026-13' }) });
  } finally {
    f.db.close();
  }
});

test('scope_report 与网页列表筛选同一判定与 scopeReport() 结果', async () => {
  const f = fixture();
  try {
    const { st } = await state(f.ctx);
    const web = (scope: Parameters<typeof inListScope>[3]) => st.subscriptions.filter((s) => inListScope(st, s, today, scope));
    const ids = (r: Record<string, any>) => r.subscriptions.map((s: { id: string }) => s.id);
    // 分类 + 状态 + 支付方式 + 搜索：与网页 List 传入的 scope 一致
    const out = await f.run('get_insights', { section: 'scope_report', filter: { category: 'Tools', status: 'live', method: 'Visa', query: 'DESIGN work' } });
    const rows = web({ status: 'live', category: 'Tools', method: 'card', words: listWords('DESIGN work') });
    assert.deepEqual(ids(out), ['Editor']);
    assert.deepEqual(
      rows.map((s) => s.id),
      ['Editor'],
    );
    const expected = get(scopeReport(st, rows, today), 'headline')!;
    assert.equal(expected.mode, 'scope');
    const h = block(out, 'headline');
    assert.equal(h.mrr, r2(expected.mrr));
    assert.equal(h.paid_this_year, r2(expected.paid));
    assert.equal(out.incomplete, false);
    // 无筛选 = 全部非代付订阅
    assert.deepEqual((await f.run('get_insights', { section: 'scope_report' })).count, 4);
    // 已结束 / 未指定支付方式 / 标签 / 地区 / 指定订阅
    assert.deepEqual(ids(await f.run('get_insights', { section: 'scope_report', filter: { status: 'ended' } })), ['OldTool']);
    assert.deepEqual(ids(await f.run('get_insights', { section: 'scope_report', filter: { method: 'none' } })), ['Secondhand']);
    assert.deepEqual(ids(await f.run('get_insights', { section: 'scope_report', filter: { tag: 'work' } })), ['Editor']);
    assert.deepEqual(ids(await f.run('get_insights', { section: 'scope_report', filter: { region: 'us' } })), ['Editor']);
    assert.deepEqual(ids(await f.run('get_insights', { section: 'scope_report', filter: { subscriptions: ['Music', 'OldTool'], status: 'live' } })), ['Music']);
    // 代付永远不在列表范围内
    const none = await f.run('get_insights', { section: 'scope_report', filter: { subscriptions: ['ForMom'] } });
    assert.equal(none.count, 0);
    assert.deepEqual(none.blocks, []);
    await assert.rejects(f.run('get_insights', { section: 'scope_report', filter: { category: 'Nope' } }));
    await assert.rejects(f.run('get_insights', { section: 'scope_report', filter: { colour: 'red' } }));
    // spending_stats 用同一套子集：Media 只含 Music 与 Secondhand
    const media = await f.run('spending_stats', { period: 'this_year', group_by: 'subscription', filter: { category: 'Media' } });
    assert.ok(media.groups.length > 0 && media.groups.every((g: { key: string }) => ['Music', 'Secondhand'].includes(g.key)));
  } finally {
    f.db.close();
  }
});

test('缺汇率：月报、选区报告与 spending_stats 标记不完整，金额为 null 而非 0', async () => {
  const odd = sub('Odd', { currency: 'XYZ', price: 99, start: addMonths(first, -1) });
  const f = fixture([...ledger(), odd]);
  try {
    const out = await f.run('get_insights', { section: 'month_report' });
    assert.equal(out.incomplete, true);
    assert.deepEqual(out.fx_missing, ['XYZ']);
    const h = block(out, 'headline');
    assert.equal(h.total, null);
    assert.equal(h.paid, null);
    assert.equal(out.months.at(-1).total, null);
    // 共享报告把折算不了的扣款当 0、排行里看不到；MCP 另列原币明细，不让它悄悄消失
    assert.ok(!block(out, 'top').rows.some((r: { name: string; amount: number }) => r.name === 'Odd' && r.amount === 0));
    assert.deepEqual(
      out.unconverted.map((r: Record<string, unknown>) => [r.name, r.original]),
      [['Odd', { amount: 99, currency: 'XYZ' }]],
    );
    const scope = await f.run('get_insights', { section: 'scope_report', filter: { subscriptions: ['Odd'] } });
    assert.equal(scope.incomplete, true);
    const sh = block(scope, 'headline');
    // MRR 折算为 0 时共享报告会切到累计视角；无论哪种视角，本位币金额都是 null
    for (const k of ['mrr', 'annual', 'total', 'average', 'paid_this_year']) if (k in sh) assert.equal(sh[k], null, k);
    // 不含 Odd 的子集仍完整
    const clean = await f.run('get_insights', { section: 'scope_report', filter: { category: 'Media' } });
    assert.equal(clean.incomplete, false);
    assert.equal(typeof block(clean, 'headline').mrr, 'number');
    const stats = await f.run('spending_stats', { period: 'custom', from: addDays(first, -40), to: today, group_by: 'subscription' });
    assert.equal(stats.total, null);
    assert.equal(stats.incomplete, true);
    assert.equal(stats.groups.find((g: { key: string }) => g.key === 'Odd').total, null);
    assert.equal(typeof stats.groups.find((g: { key: string }) => g.key === 'Editor').total, 'number');
  } finally {
    f.db.close();
  }
});
