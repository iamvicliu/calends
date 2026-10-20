// MCP 工具：查询订阅、扣款、统计，以及新增 / 维护订阅。全部复用 shared/ 里的计费与统计逻辑，和后台界面算出来的数一致。
import { addDays, addMonths, chargesBetween, currentPhase, cycleLabel, effectiveStatus, lastCharge, memberDues, monthlyGross, myShareFactor, nextCharge, phaseSubs, priceAt, runwayFor, subError, todayIn, totals, uid, type Charge } from '../shared/billing.ts';
import { chargeValue, toBaseAt } from '../shared/fx.ts';
import { cancelSavings, cashVsAccrual, events, insights, movement, mrrSeries, prepaidValue, topUpPlan, yearReview } from '../shared/metrics.ts';
import { changePrice, confirmPlan, deletePayment, dropPlan, resume, savePayment, switchPlan, syncPhase, toEditForm } from '../shared/phases.ts';
import { matchEntries } from '../shared/proxy.ts';
import { normName, peopleLedger, type PersonLedger } from '../shared/people.ts';
import type { AppState, Payment, Person, Subscription } from '../shared/types.ts';
import type { Env } from './env.ts';
import { loadState, upsert } from './store.ts';
import { t } from '../shared/i18n.ts';

export interface ToolCtx {
  env: Env;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  write?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown>;
}

// ---------- 公共小工具 ----------

export async function state(ctx: ToolCtx): Promise<{ st: AppState; today: string }> {
  const st = await loadState(ctx.env);
  return { st, today: todayIn(st.settings.timezone) };
}

/** 金额：原币 + 折算成目标币种（默认本位币） */
export function money(st: AppState, amount: number, currency: string, date?: string, to = st.settings.baseCurrency) {
  const conv = currency === to ? amount : toBaseAt(st, amount, currency, date, to);
  return { amount: round(amount), currency, converted: round(conv), convertedCurrency: to };
}
export const round = (n: number) => Math.round(n * 100) / 100;

/** 工具的显示名（随语言变化，所以不写在 TOOLS 里） */
export const toolTitle = (name: string) => t(`mcp.tool.${name}`);

/** 候选列表：「名称（id）、名称（id）」 */
const candidates = (xs: Array<{ name: string; id: string }>) => xs.map((x) => t('mcp.item', { name: x.name, id: x.id })).join(t('mcp.sep'));

/** 按 id 或名称找订阅；名称模糊匹配到多个时报错并列出候选，让 AI 选 */
export function findSub(st: AppState, ref: unknown): Subscription {
  const q = String(ref ?? '').trim();
  if (!q) throw new Error(t('mcp.error.needSub'));
  const byId = st.subscriptions.find((s) => s.id === q);
  if (byId) return byId;
  const k = q.toLowerCase();
  const exact = st.subscriptions.filter((s) => s.name.toLowerCase() === k);
  if (exact.length === 1) return exact[0];
  const fuzzy = (exact.length ? exact : st.subscriptions.filter((s) => s.name.toLowerCase().includes(k)));
  if (fuzzy.length === 1) return fuzzy[0];
  if (!fuzzy.length) throw new Error(t('mcp.error.subNotFound', { q }));
  throw new Error(t('mcp.error.subAmbiguous', { q, count: fuzzy.length, list: candidates(fuzzy) }));
}

/** 按 id 或称呼找人；称呼模糊匹配到多个时报错并列出候选 */
export function findPerson(st: AppState, ref: unknown): Person {
  const q = String(ref ?? '').trim();
  const people = st.people ?? [];
  const byId = people.find((p) => p.id === q);
  if (byId) return byId;
  const k = normName(q);
  const exact = people.filter((p) => normName(p.name) === k);
  if (exact.length === 1) return exact[0];
  const fuzzy = exact.length ? exact : k ? people.filter((p) => normName(p.name).includes(k)) : [];
  if (fuzzy.length === 1) return fuzzy[0];
  if (!fuzzy.length) throw new Error(t('mcp.error.personNotFound', { q }));
  throw new Error(t('mcp.error.personAmbiguous', { q, count: fuzzy.length, list: candidates(fuzzy) }));
}

/** 联系方式的一行文字（MCP 用，不翻译渠道名） */
const contactLine = (p: Pick<Person, 'contactVia' | 'contact'>) => (p.contact ? `${p.contactVia && p.contactVia !== '其他' ? `${p.contactVia} ` : ''}${p.contact}` : null);

/** 一个人的应收：在哪些合租 / 代付里、欠多少、收回多少 */
function personRow(st: AppState, l: PersonLedger, out: string, today: string) {
  const conv = (v: number) => round(toBaseAt(st, v, st.settings.baseCurrency, undefined, out));
  return {
    person_id: l.person.id || null,
    name: l.person.name,
    contact: contactLine(l.person),
    note: l.person.note ?? null,
    owed: conv(l.owed),
    periods_owed: l.periodsOwed,
    received: conv(l.received),
    last_paid: l.lastPaid ?? null,
    in: l.items.map((i) => ({
      subscription_id: i.sub.id,
      name: i.sub.name,
      kind: i.kind,
      member_id: i.member?.id ?? null,
      active: i.active,
      left: i.member?.left && i.member.left <= today ? i.member.left : null,
      owed: conv(i.owed),
      periods_owed: i.periodsOwed,
      received: conv(i.received),
      last_paid: i.lastPaid ?? null,
      paid_until: i.paidUntil ?? null,
    })),
  };
}

/** 时间范围：today / next_3_days / next_7_days / next_30_days / this_month / next_month / last_30_days / this_year / custom */
export function rangeOf(period: unknown, today: string, from?: unknown, to?: unknown): [string, string] {
  const p = String(period ?? 'next_30_days');
  const ym = today.slice(0, 7);
  switch (p) {
    case 'today':
      return [today, today];
    case 'next_3_days':
      return [today, addDays(today, 2)];
    case 'next_7_days':
      return [today, addDays(today, 6)];
    case 'next_30_days':
      return [today, addDays(today, 29)];
    case 'this_month':
      return [`${ym}-01`, addDays(addMonths(`${ym}-01`, 1), -1)];
    case 'next_month': {
      const n = addMonths(`${ym}-01`, 1);
      return [n, addDays(addMonths(n, 1), -1)];
    }
    case 'last_30_days':
      return [addDays(today, -29), today];
    case 'this_year':
      return [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`];
    case 'custom': {
      const re = /^\d{4}-\d{2}-\d{2}$/;
      if (!re.test(String(from)) || !re.test(String(to))) throw new Error(t('mcp.error.customRange'));
      return [String(from), String(to)];
    }
    default:
      throw new Error(t('mcp.error.unknownPeriod', { period: p }));
  }
}

export const PERIODS = ['today', 'next_3_days', 'next_7_days', 'next_30_days', 'this_month', 'next_month', 'last_30_days', 'this_year', 'custom'];


// ---------- 订阅的统一表示 ----------

type Scope = 'mine' | 'share_owner' | 'share_member' | 'proxy';
const kindOf = (s: Subscription): Scope => (s.proxy ? 'proxy' : s.share?.role === 'owner' ? 'share_owner' : s.share?.role === 'member' ? 'share_member' : 'mine');

/** 列表里的一行：当前生效的那一段 + 状态 + 下次扣款 + 每月成本 */
function row(st: AppState, s: Subscription, today: string, out?: string) {
  const cur = currentPhase(s, today);
  const next = nextCharge(s, today);
  const monthly = monthlyGross(cur, today);
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    tags: s.tags,
    status: effectiveStatus(s, today),
    kind: kindOf(s),
    price: money(st, next && (!cur.end || next < cur.end) ? priceAt(s, next) : cur.price, cur.currency, undefined, out),
    cycle: cycleLabel(cur.cycle),
    monthly: money(st, monthly, cur.currency, undefined, out),
    my_share_factor: round(myShareFactor(s)),
    next_charge: next ?? null,
    last_charge: lastCharge(s, today) ?? null,
    method: st.methods.find((m) => m.id === cur.methodId)?.name ?? null,
    method_id: cur.methodId ?? null,
    region: cur.region ?? null,
    start: s.start,
    end: s.end ?? null,
    has_planned_change: !!s.phases?.some((p) => p.planned),
  };
}

/** 一笔扣款：原币 + 折算；scope=mine 时 my_amount 只算我承担的部分 */
function chargeRow(st: AppState, c: Charge, out?: string) {
  const sub = st.subscriptions.find((x) => x.id === c.sub.id) ?? c.sub;
  const v = chargeValue(st, c, out ?? st.settings.baseCurrency);
  return {
    date: c.date,
    subscription_id: c.sub.id,
    name: sub.name,
    amount: { amount: round(c.amount), currency: c.currency, converted: round(v), convertedCurrency: out ?? st.settings.baseCurrency },
    my_amount: round(v * myShareFactor(sub)),
    projected: c.projected,
    kind: c.kind ?? 'charge',
    method: st.methods.find((m) => m.id === c.sub.methodId)?.name ?? null,
    ...(c.settled ? { settled: c.settled } : {}),
    ...(c.note ? { note: c.note } : {}),
  };
}

function chargesIn(st: AppState, from: string, to: string, today: string, scope: string) {
  return st.subscriptions
    .filter((s) => (scope === 'proxy' ? !!s.proxy : scope === 'all' || scope === 'gross' ? true : !s.proxy))
    .flatMap((s) => chargesBetween(s, from, to, today))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const outCcy = (st: AppState, a: Record<string, unknown>) => {
  const c = a.currency_out ? String(a.currency_out).toUpperCase() : undefined;
  if (c && !st.fx.rates[c]) throw new Error(t('mcp.error.unsupportedCurrency', { code: c }));
  return c;
};

const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' };
const SUBREF = { type: 'string', description: 'Subscription id, or its name (fuzzy match; ambiguous names return candidates).' };
const CURRENCY_OUT = { type: 'string', description: 'Convert amounts into this currency (ISO code). Defaults to the ledger base currency.' };
const PERIOD = { type: 'string', enum: PERIODS, description: 'Time window. custom requires from/to.' };
const CYCLE = {
  type: 'object',
  properties: { unit: { type: 'string', enum: ['day', 'week', 'month', 'year', 'lifetime'] }, every: { type: 'integer', minimum: 1, default: 1 } },
  required: ['unit'],
  description: 'Billing cycle, e.g. {"unit":"month","every":1}; lifetime = one-time purchase.',
};
const DRY = { type: 'boolean', default: false, description: 'Preview the result without saving.' };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

/** 写入：dry_run 只返回预览；否则保存并返回最新一行 + 接下来几笔扣款 */
async function commit(ctx: ToolCtx, st: AppState, today: string, after: Subscription, dry: unknown, changed: string[]) {
  const errs = subError(after);
  if (errs) throw new Error(errs);
  const preview = { subscription: row(st, after, today), changed, next_charges: chargesBetween(after, today, addMonths(today, 13), today).slice(0, 3).map((c) => ({ date: c.date, amount: round(c.amount), currency: c.currency })) };
  if (dry) return { dry_run: true, ...preview };
  const saved = { ...after, updatedAt: new Date().toISOString() };
  await upsert(ctx.env, 'subscriptions', saved.id, saved);
  return { ok: true, ...preview };
}

const str = (v: unknown) => (v == null || v === '' ? undefined : String(v));
const num = (v: unknown, what: string) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(t('mcp.error.notNumber', { what }));
  return n;
};
const date = (v: unknown, what: string, fallback?: string) => {
  const d = v == null ? fallback : String(v);
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(t('mcp.error.notDate', { what }));
  return d;
};
const methodRef = (st: AppState, v: unknown) => {
  const q = str(v);
  if (!q) return undefined;
  const m = st.methods.find((x) => x.id === q) ?? st.methods.find((x) => x.name === q) ?? st.methods.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()))[0];
  if (!m) throw new Error(t('mcp.error.noMethod', { q, list: candidates(st.methods) }));
  return m.id;
};

// ---------- 工具 ----------

export const TOOLS: Tool[] = [
  {
    name: 'get_overview',
    description:
      'Snapshot of the subscription ledger: today, base currency, my monthly recurring spend (MRR — excludes proxy payments made on behalf of others, counts only my share of shared plans), active count, payment methods (ids), categories and regions in use, top insights. Call this first to learn ids and categories.',
    inputSchema: obj({ currency_out: CURRENCY_OUT }),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const out = outCcy(st, a) ?? st.settings.baseCurrency;
      const t = totals(st, today);
      const conv = (v: number) => round(toBaseAt(st, v, st.settings.baseCurrency, undefined, out));
      return {
        today,
        base_currency: st.settings.baseCurrency,
        currency_out: out,
        mrr: conv(t.mrr),
        yearly: conv(t.mrr * 12),
        gross_mrr: conv(t.grossMrr),
        share_recovered_mrr: conv(t.recoverMrr),
        active_count: t.activeCount,
        subscription_count: st.subscriptions.length,
        methods: st.methods.map((m) => ({ id: m.id, name: m.name, kind: m.kind, currency: m.currency, region: m.region ?? null, balance: m.balance ?? null })),
        categories: [...new Set(st.subscriptions.map((s) => s.category))],
        regions: [...new Set(st.subscriptions.flatMap((s) => phaseSubs(s).map((v) => v.region)).filter(Boolean))],
        insights: insights(st, today).slice(0, 5).map((i) => ({ tone: i.tone, title: i.title, body: i.body })),
      };
    },
  },
  {
    name: 'list_subscriptions',
    description:
      'List subscriptions with status, current price, monthly cost, next/last charge, payment method and region. Filter by fuzzy name query, status, kind (mine / share_owner = shared plan I organize / share_member = shared plan I joined / proxy = paid on behalf of someone), category, method or region. Use query to find a subscription id.',
    inputSchema: obj({
      query: { type: 'string', description: 'Fuzzy match on name, tags, notes, category.' },
      status: { type: 'string', enum: ['active', 'trial', 'paused', 'ending', 'ended', 'upcoming', 'lifetime', 'live', 'all'], default: 'live', description: 'live = active+trial+ending+paused.' },
      kind: { type: 'string', enum: ['mine', 'share_owner', 'share_member', 'proxy', 'all'], default: 'all' },
      category: { type: 'string' },
      method: { type: 'string', description: 'Payment method id or name.' },
      region: { type: 'string', description: 'ISO country code, e.g. TR.' },
      sort: { type: 'string', enum: ['next_charge', 'monthly_cost', 'name', 'start'], default: 'next_charge' },
      limit: { type: 'integer', default: 100 },
      currency_out: CURRENCY_OUT,
    }),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const out = outCcy(st, a);
      const q = str(a.query)?.toLowerCase();
      const status = str(a.status) ?? 'live';
      const method = a.method ? methodRef(st, a.method) : undefined;
      let rows = st.subscriptions
        .filter((s) => !q || `${s.name} ${s.tags.join(' ')} ${s.notes ?? ''} ${s.category}`.toLowerCase().includes(q))
        .map((s) => row(st, s, today, out))
        .filter((r) => status === 'all' || (status === 'live' ? ['active', 'trial', 'ending', 'paused'].includes(r.status) : r.status === status))
        .filter((r) => !a.kind || a.kind === 'all' || r.kind === a.kind)
        .filter((r) => !a.category || r.category === a.category)
        .filter((r) => !method || r.method_id === method)
        .filter((r) => !a.region || r.region === String(a.region).toUpperCase());
      const sort = str(a.sort) ?? 'next_charge';
      rows.sort((x, y) => (sort === 'monthly_cost' ? y.monthly.converted - x.monthly.converted : sort === 'name' ? x.name.localeCompare(y.name) : sort === 'start' ? y.start.localeCompare(x.start) : (x.next_charge ?? '9').localeCompare(y.next_charge ?? '9')));
      rows = rows.slice(0, Number(a.limit ?? 100));
      return { count: rows.length, items: rows };
    },
  },
  {
    name: 'get_subscription',
    description:
      'Full detail of one subscription: every phase (region or plan switches, gaps = lapses), price history, intro/bonus periods, recent and upcoming charges, shared-plan member dues, proxy repayments, and totals spent so far.',
    inputSchema: obj({ subscription: SUBREF, months_back: { type: 'integer', default: 12 }, months_forward: { type: 'integer', default: 6 }, currency_out: CURRENCY_OUT }, ['subscription']),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const out = outCcy(st, a);
      const s = findSub(st, a.subscription);
      const all = chargesBetween(s, s.start, today, today);
      const spent = all.reduce((t, c) => t + chargeValue(st, c, out ?? st.settings.baseCurrency), 0);
      const from = addMonths(today, -Number(a.months_back ?? 12));
      const to = addMonths(today, Number(a.months_forward ?? 6));
      const px = s.proxy;
      const matched = px ? matchEntries(px.entries, all.map((c) => c.date)) : undefined;
      return {
        ...row(st, s, today, out),
        notes: s.notes ?? null,
        url: s.url ?? null,
        intro: s.intro ?? null,
        bonus: s.bonus ?? null,
        expires: s.expires ?? null,
        spent_total: { amount: round(spent), currency: out ?? st.settings.baseCurrency, charges: all.length },
        phases: phaseSubs(s).map((v) => ({ start: v.start, end: v.end ?? null, price: v.price, currency: v.currency, cycle: cycleLabel(v.cycle), region: v.region ?? null, method: st.methods.find((m) => m.id === v.methodId)?.name ?? null, price_history: v.priceHistory ?? null, planned: !!v.planned })),
        charges: chargesBetween(s, from, to, today).map((c) => chargeRow(st, c, out)),
        share: s.share
          ? {
              role: s.share.role,
              seats: s.share.seats,
              members: s.share.members.map((m) => ({ id: m.id, name: m.name, paid_until: m.paidUntil ?? null, joined: m.joined ?? null, left: m.left ?? null, exempt: !!m.exempt })),
              dues: memberDues(s, today).filter((d) => d.periodsOwed > 0).map((d) => ({ member: d.member.name, periods_owed: d.periodsOwed, owed: money(st, d.owed, s.currency, undefined, out) })),
            }
          : null,
        proxy: px
          ? { for: px.forName, entries: all.map((c) => ({ charge: c.date, received: matched!.get(c.date)?.received ?? null, received_currency: matched!.get(c.date)?.receivedCurrency ?? null })) }
          : null,
      };
    },
  },
  {
    name: 'list_charges',
    description:
      'Charges (actual and projected) in a period: today, next 3 days, next 7/30 days, this or next month, last 30 days, this year, or custom from/to. scope=mine excludes proxy payments and reports my_amount as my share for shared plans; gross = full card charges incl. proxy payments; proxy = only proxy payments.',
    inputSchema: obj({
      period: { ...PERIOD, default: 'next_30_days' },
      from: DATE,
      to: DATE,
      scope: { type: 'string', enum: ['mine', 'gross', 'proxy'], default: 'mine' },
      subscription: SUBREF,
      method: { type: 'string', description: 'Payment method id or name.' },
      include_projected: { type: 'boolean', default: true },
      currency_out: CURRENCY_OUT,
    }),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const out = outCcy(st, a);
      const [from, to] = rangeOf(a.period ?? 'next_30_days', today, a.from, a.to);
      const sub = a.subscription ? findSub(st, a.subscription) : undefined;
      const method = a.method ? methodRef(st, a.method) : undefined;
      const scope = str(a.scope) ?? 'mine';
      const items = (sub ? chargesBetween(sub, from, to, today) : chargesIn(st, from, to, today, scope))
        .filter((c) => !method || c.sub.methodId === method)
        .filter((c) => a.include_projected !== false || !c.projected)
        .map((c) => chargeRow(st, c, out));
      const sum = (k: 'converted' | 'my') => round(items.reduce((t, i) => t + (k === 'my' ? i.my_amount : i.amount.converted), 0));
      return { from, to, today, currency: out ?? st.settings.baseCurrency, count: items.length, total: sum('converted'), my_total: sum('my'), items };
    },
  },
  {
    name: 'spending_stats',
    description:
      'Aggregate spending over a period, grouped by month, year, category, payment method, currency, region or subscription. Cash basis: each past charge converted at its own day’s FX rate. scope=mine (default) excludes proxy payments and counts my share of shared plans.',
    inputSchema: obj({
      period: { ...PERIOD, default: 'this_year' },
      from: DATE,
      to: DATE,
      group_by: { type: 'string', enum: ['month', 'year', 'category', 'method', 'currency', 'region', 'subscription', 'none'], default: 'category' },
      scope: { type: 'string', enum: ['mine', 'gross', 'proxy'], default: 'mine' },
      include_projected: { type: 'boolean', default: true, description: 'Include projected (future) charges inside the period.' },
      top: { type: 'integer', default: 30 },
      currency_out: CURRENCY_OUT,
    }),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const out = outCcy(st, a) ?? st.settings.baseCurrency;
      const [from, to] = rangeOf(a.period ?? 'this_year', today, a.from, a.to);
      const scope = str(a.scope) ?? 'mine';
      const by = str(a.group_by) ?? 'category';
      const groups = new Map<string, { key: string; label: string; total: number; count: number }>();
      let total = 0;
      for (const c of chargesIn(st, from, to, today, scope)) {
        if (a.include_projected === false && c.projected) continue;
        const sub = st.subscriptions.find((x) => x.id === c.sub.id) ?? c.sub;
        const v = chargeValue(st, c, out) * (scope === 'mine' ? myShareFactor(sub) : 1);
        const m = st.methods.find((x) => x.id === c.sub.methodId);
        const [key, label] =
          by === 'month' ? [c.date.slice(0, 7), c.date.slice(0, 7)]
          : by === 'year' ? [c.date.slice(0, 4), c.date.slice(0, 4)]
          : by === 'category' ? [sub.category, sub.category]
          : by === 'method' ? [m?.id ?? 'none', m?.name ?? t('mcp.label.unassigned')]
          : by === 'currency' ? [c.currency, c.currency]
          : by === 'region' ? [c.sub.region ?? '—', c.sub.region ?? t('mcp.label.anyRegion')]
          : by === 'subscription' ? [sub.id, sub.name]
          : ['all', t('mcp.label.total')];
        const g = groups.get(key) ?? { key, label, total: 0, count: 0 };
        g.total += v;
        g.count++;
        groups.set(key, g);
        total += v;
      }
      const list = [...groups.values()].sort((x, y) => (by === 'month' || by === 'year' ? x.key.localeCompare(y.key) : y.total - x.total));
      return {
        from,
        to,
        currency: out,
        scope,
        total: round(total),
        groups: list.slice(0, Number(a.top ?? 30)).map((g) => ({ ...g, total: round(g.total), share_pct: total > 0 ? Math.round((g.total / total) * 1000) / 10 : 0 })),
      };
    },
  },
  {
    name: 'get_trends',
    description:
      'Time series: monthly MRR history, cash-vs-accrual by month (cash = what was charged; accrual = cost spread over the period it covers), or MRR movement between two dates (added / expansion / contraction / churn / FX effect).',
    inputSchema: obj({
      metric: { type: 'string', enum: ['mrr', 'cash_vs_accrual', 'movement'], default: 'mrr' },
      months_back: { type: 'integer', default: 12 },
      months_forward: { type: 'integer', default: 3, description: 'cash_vs_accrual only.' },
      from: { ...DATE, description: 'movement only: start date (default: one month ago).' },
      to: { ...DATE, description: 'movement only: end date (default: today).' },
    }),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const metric = str(a.metric) ?? 'mrr';
      if (metric === 'mrr') return { currency: st.settings.baseCurrency, points: mrrSeries(st, today, Number(a.months_back ?? 12)).map((p) => roundAll(p)) };
      if (metric === 'cash_vs_accrual') return { currency: st.settings.baseCurrency, points: cashVsAccrual(st, today, Number(a.months_back ?? 12), Number(a.months_forward ?? 3)).map((p) => roundAll(p)) };
      const mv = movement(st, date(a.from, 'from', addMonths(today, -1)), date(a.to, 'to', today));
      return { currency: st.settings.baseCurrency, ...roundAll({ ...mv, items: undefined }), items: mv.items.map((i) => ({ name: i.sub.name, kind: i.kind, delta: round(i.delta) })) };
    },
  },
  {
    name: 'list_payment_methods',
    description:
      'Payment methods (bank cards, App Store region balances, crypto cards, prepaid balances…) with current estimated balance, monthly drain, runway (how long the balance lasts, first shortfall) and a top-up suggestion.',
    inputSchema: obj({ topup_months: { type: 'integer', default: 6 } }),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const plans = topUpPlan(st, today, Number(a.topup_months ?? 6));
      return {
        items: st.methods.map((m) => {
          const r = runwayFor(m, st, today);
          const p = plans.find((x) => x.method.id === m.id);
          return {
            id: m.id,
            name: m.name,
            kind: m.kind,
            currency: m.currency,
            region: m.region ?? null,
            balance: r ? round(r.current) : (m.balance ?? null),
            balance_as_of: m.balanceAsOf ?? null,
            subscriptions: st.subscriptions.filter((s) => currentPhase(s, today).methodId === m.id && ['active', 'trial', 'ending'].includes(effectiveStatus(s, today))).map((s) => s.name),
            runway: r ? { monthly_drain: round(r.monthlyDrain), covered_charges: r.coveredCharges, runs_out_on: r.runsOutOn ?? null, shortfall: r.shortfall ? { date: r.shortfall.date, name: r.shortfall.sub.name, amount: round(r.shortfall.amount) } : null } : null,
            topup: p && p.need > 0 ? { need: round(p.need), min_need: round(p.minNeed), deadline: p.deadline ?? null } : null,
          };
        }),
      };
    },
  },
  {
    name: 'list_people',
    description: 'People in the ledger (shared-plan members and people I pay on behalf of, each listed once): contact, which shared plans / proxy payments they are in, how much they owe me now, how much they have paid so far and when they last paid. Use query to find someone by name.',
    inputSchema: obj({ query: { type: 'string', description: 'Fuzzy name filter.' }, owing_only: { type: 'boolean', default: false }, currency_out: CURRENCY_OUT }),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const out = outCcy(st, a) ?? st.settings.baseCurrency;
      const q = normName(str(a.query));
      const list = peopleLedger(st, today).filter((l) => (!q || normName(l.person.name).includes(q)) && (!a.owing_only || l.periodsOwed > 0));
      const rows = list.map((l) => personRow(st, l, out, today));
      return { currency: out, count: rows.length, total_owed: round(rows.reduce((x, r) => x + r.owed, 0)), people: rows };
    },
  },
  {
    name: 'get_receivables',
    description: 'Money others owe me: by_person totals each person across all their shared plans and proxy payments; share lists shared-plan members whose payment is due/overdue; proxy lists charges paid on behalf of someone not yet repaid.',
    inputSchema: obj({ kind: { type: 'string', enum: ['share', 'proxy', 'all'], default: 'all' }, currency_out: CURRENCY_OUT }),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const out = outCcy(st, a) ?? st.settings.baseCurrency;
      const kind = str(a.kind) ?? 'all';
      const share =
        kind === 'proxy'
          ? []
          : st.subscriptions.flatMap((s) =>
              memberDues(s, today)
                .filter((d) => d.periodsOwed > 0)
                .map((d) => ({ subscription_id: s.id, name: s.name, person_id: d.member.personId ?? null, member: d.member.name, contact: d.member.contact ?? null, periods_owed: d.periodsOwed, paid_until: d.member.paidUntil ?? null, owed: money(st, d.owed, s.currency, undefined, out) })),
            );
      const proxy =
        kind === 'share'
          ? []
          : st.subscriptions
              .filter((s) => s.proxy)
              .flatMap((s) => {
                const cs = chargesBetween(s, s.start, today, today);
                const m = matchEntries(s.proxy!.entries, cs.map((c) => c.date));
                return cs
                  .filter((c) => m.get(c.date)?.received == null)
                  .map((c) => {
                    const e = m.get(c.date);
                    const charged = e?.charged ?? c.amount;
                    const ccy = e?.chargedCurrency ?? c.currency;
                    return { subscription_id: s.id, name: s.name, person_id: s.proxy!.personId ?? null, for: s.proxy!.forName, charge: c.date, charged: money(st, charged, ccy, c.date, out) };
                  });
              });
      const total = share.reduce((t, x) => t + x.owed.converted, 0) + proxy.reduce((t, x) => t + x.charged.converted, 0);
      // 按人汇总：只列现在欠钱的人，金额与下面的明细同源（memberDues / 代付逐期对账）
      const by_person = peopleLedger(st, today)
        .map((l) => ({ ...l, items: l.items.filter((i) => i.periodsOwed > 0 && (kind === 'all' || i.kind === kind)) }))
        .filter((l) => l.items.length)
        .map((l) => ({ ...l, owed: l.items.reduce((a, i) => a + i.owed, 0), periodsOwed: l.items.reduce((a, i) => a + i.periodsOwed, 0) }))
        .map((l) => personRow(st, l, out, today))
        .sort((a, b) => b.owed - a.owed);
      return { currency: out, total_outstanding: round(total), by_person, share, proxy };
    },
  },
  {
    name: 'get_insights',
    description: 'Health check and reports: insights (renewals coming up, price hikes, low balances, possible duplicates), year_review (total, top subscriptions, busiest month), prepaid (paid-but-unused value) or cancel_savings (money saved by cancelling).',
    inputSchema: obj({ section: { type: 'string', enum: ['insights', 'year_review', 'prepaid', 'cancel_savings'], default: 'insights' }, year: { type: 'string', description: 'year_review only, e.g. 2025.' } }),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const sec = str(a.section) ?? 'insights';
      const base = st.settings.baseCurrency;
      if (sec === 'insights') return { items: insights(st, today).map((i) => ({ tone: i.tone, title: i.title, body: i.body, subscriptions: i.subs?.map((s) => s.name) ?? [] })) };
      if (sec === 'year_review') {
        const r = yearReview(st, today, str(a.year) ?? today.slice(0, 4));
        return { currency: base, year: r.year, total: round(r.total), charges: r.charges, per_day: round(r.perDay), currencies: r.currencies, top: r.items.slice(0, 10).map((x) => ({ name: x.sub.name, total: round(x.sum) })), longest: r.longest ? { name: r.longest.sub.name, days: r.longest.days } : null, busiest_month: r.busiestMonth ? { month: r.busiestMonth.month, total: round(r.busiestMonth.sum) } : null, new: r.newSubs.map((s) => s.name), ended: r.ended.map((s) => s.name) };
      }
      if (sec === 'prepaid') {
        const p = prepaidValue(st, today);
        return { currency: base, total: round(p.total), items: p.items.map((i) => ({ name: i.sub.name, value: round(i.value), until: i.until })) };
      }
      const c = cancelSavings(st, today);
      return { currency: base, total: round(c.total), items: c.items.map((i) => ({ name: i.sub.name, saved: round(i.saved), since: i.since, monthly: round(i.monthly) })) };
    },
  },
  {
    name: 'list_events',
    description: 'Changelog of spending decisions: subscriptions started, ended, paused, resumed, price changes and plan/region switches, each with its effect on monthly spend (base currency).',
    inputSchema: obj({ since: DATE, until: DATE, subscription: SUBREF, limit: { type: 'integer', default: 50 } }),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const sub = a.subscription ? findSub(st, a.subscription) : undefined;
      const items = events(st, today)
        .filter((e) => (!a.since || e.date >= String(a.since)) && (!a.until || e.date <= String(a.until)) && (!sub || e.sub.id === sub.id))
        .slice(0, Number(a.limit ?? 50))
        .map((e) => ({ date: e.date, subscription_id: e.sub.id, name: e.sub.name, kind: e.kind, monthly_delta: round(e.delta), note: e.note ?? null }));
      return { currency: st.settings.baseCurrency, count: items.length, items };
    },
  },

  // ---------- 写入 ----------
  {
    name: 'create_subscription',
    description:
      'Create a subscription. price is per cycle in the given currency. Rejects a duplicate (same name and start date) unless force=true. Use dry_run=true to preview first. category: reuse one from get_overview when possible.',
    write: true,
    inputSchema: obj(
      {
        name: { type: 'string' },
        price: { type: 'number', minimum: 0 },
        currency: { type: 'string', description: 'ISO code, e.g. USD, CNY, TRY.' },
        cycle: CYCLE,
        start: { ...DATE, description: 'First charge / purchase date. Defaults to today.' },
        category: { type: 'string', description: 'Defaults to the Tools category.' },
        tags: { type: 'array', items: { type: 'string' } },
        method: { type: 'string', description: 'Payment method id or name.' },
        region: { type: 'string', description: 'ISO country code for region-priced stores (App Store TR, NG…).' },
        url: { type: 'string' },
        notes: { type: 'string' },
        status: { type: 'string', enum: ['active', 'trial'], default: 'active' },
        trial_end: DATE,
        end: { ...DATE, description: 'Will not renew after this date.' },
        intro: { type: 'object', properties: { price: { type: 'number' }, until: DATE }, required: ['price', 'until'], description: 'Intro price until a date.' },
        force: { type: 'boolean', default: false },
        dry_run: DRY,
      },
      ['name', 'price', 'currency', 'cycle'],
    ),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const name = String(a.name ?? '').trim();
      const start = date(a.start, 'start', today);
      const currency = String(a.currency ?? '').toUpperCase();
      if (!st.fx.rates[currency]) throw new Error(t('mcp.error.unsupportedCurrency', { code: currency }));
      if (!a.force && st.subscriptions.some((s) => s.name.toLowerCase() === name.toLowerCase() && s.start === start)) throw new Error(t('mcp.error.duplicateSub', { name }));
      const cyc = a.cycle as { unit: Subscription['cycle']['unit']; every?: number };
      const sub: Subscription = {
        id: uid(),
        name,
        category: str(a.category) ?? t('mcp.defaultCategory'),
        tags: Array.isArray(a.tags) ? a.tags.map(String) : [],
        price: num(a.price, 'price'),
        currency,
        cycle: { unit: cyc?.unit, every: Math.max(1, Number(cyc?.every ?? 1)) },
        start,
        status: a.status === 'trial' ? 'trial' : 'active',
        methodId: methodRef(st, a.method) ?? st.settings.defaultMethodId,
        region: str(a.region)?.toUpperCase(),
        url: str(a.url),
        notes: str(a.notes),
        trialEnd: a.trial_end ? date(a.trial_end, 'trial_end') : undefined,
        end: a.end ? date(a.end, 'end') : undefined,
        intro: a.intro ? { price: num((a.intro as { price: unknown }).price, 'intro.price'), until: date((a.intro as { until: unknown }).until, 'intro.until') } : undefined,
        createdAt: today,
      };
      return commit(ctx, st, today, sub, a.dry_run, ['created']);
    },
  },
  {
    name: 'update_subscription',
    description:
      'Change descriptive fields and settings of a subscription (name, category, tags, url, notes, payment method, region, reminder days, end date (no renewal after it), next due date, trial end). Only provided keys change. For price changes use change_price; for plan/region switches use change_plan.',
    write: true,
    inputSchema: obj(
      {
        subscription: SUBREF,
        set: obj({
          name: { type: 'string' },
          category: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          url: { type: 'string' },
          manage_url: { type: 'string' },
          notes: { type: 'string' },
          method: { type: 'string', description: 'Payment method id or name.' },
          region: { type: 'string' },
          remind_days: { type: 'integer', description: '-1 = no reminder.' },
          end: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null to clear (will renew again).' },
          next_due: { type: ['string', 'null'] },
          trial_end: { type: ['string', 'null'] },
          expires: { type: ['string', 'null'] },
        }),
        dry_run: DRY,
      },
      ['subscription', 'set'],
    ),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const s = findSub(st, a.subscription);
      const set = (a.set ?? {}) as Record<string, unknown>;
      // 多段订阅：顶层字段先换成今天所在的那段，改完再同步回去
      const next: Subscription = toEditForm({ ...s }, today);
      const changed: string[] = [];
      const put = <K extends keyof Subscription>(k: K, v: Subscription[K], label = String(k)) => {
        next[k] = v;
        changed.push(label);
      };
      if ('name' in set) put('name', String(set.name).trim());
      if ('category' in set) put('category', String(set.category));
      if ('tags' in set) put('tags', Array.isArray(set.tags) ? set.tags.map(String) : []);
      if ('url' in set) put('url', str(set.url));
      if ('manage_url' in set) put('manageUrl', str(set.manage_url), 'manage_url');
      if ('notes' in set) put('notes', str(set.notes));
      if ('method' in set) put('methodId', methodRef(st, set.method), 'method');
      if ('region' in set) put('region', str(set.region)?.toUpperCase());
      if ('remind_days' in set) put('remindDays', set.remind_days == null ? undefined : Number(set.remind_days), 'remind_days');
      for (const [k, f] of [['end', 'end'], ['next_due', 'nextDue'], ['trial_end', 'trialEnd'], ['expires', 'expires']] as const) {
        if (k in set) put(f, set[k] == null ? undefined : date(set[k], k), k);
      }
      if (!changed.length) throw new Error(t('mcp.error.noFields'));
      return commit(ctx, st, today, syncPhase(next, today), a.dry_run, changed);
    },
  },
  {
    name: 'change_price',
    description: 'Record a price change for the current plan, effective from a date (vendor raised/lowered the price). Past charges keep the old price.',
    write: true,
    inputSchema: obj({ subscription: SUBREF, amount: { type: 'number', minimum: 0 }, from: { ...DATE, description: 'Effective date; defaults to today.' }, dry_run: DRY }, ['subscription', 'amount']),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const s = findSub(st, a.subscription);
      return commit(ctx, st, today, changePrice(s, date(a.from, 'from', today), num(a.amount, 'amount')), a.dry_run, ['price']);
    },
  },
  {
    name: 'change_plan',
    description:
      'Start a new phase of the same subscription: switch plan, region, currency or payment method from a date (action=switch), resubscribe after a gap (action=resume), or confirm / drop a planned future phase (action=confirm|drop, at = that phase’s start). Set plan.planned=true for an uncertain future switch.',
    write: true,
    inputSchema: obj(
      {
        subscription: SUBREF,
        action: { type: 'string', enum: ['switch', 'resume', 'confirm', 'drop'] },
        at: DATE,
        plan: obj({ price: { type: 'number' }, currency: { type: 'string' }, cycle: CYCLE, method: { type: 'string' }, region: { type: 'string' }, note: { type: 'string' }, planned: { type: 'boolean' } }, ['price', 'currency', 'cycle']),
        dry_run: DRY,
      },
      ['subscription', 'action', 'at'],
    ),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const s = findSub(st, a.subscription);
      const at = date(a.at, 'at');
      const act = String(a.action);
      if (act === 'confirm') return commit(ctx, st, today, confirmPlan(s, at), a.dry_run, ['confirm_plan']);
      if (act === 'drop') return commit(ctx, st, today, dropPlan(s, at), a.dry_run, ['drop_plan']);
      const p = a.plan as Record<string, unknown> | undefined;
      if (!p) throw new Error(t('mcp.error.needPlan'));
      const cyc = p.cycle as { unit: Subscription['cycle']['unit']; every?: number };
      const plan = { price: num(p.price, 'plan.price'), currency: String(p.currency).toUpperCase(), cycle: { unit: cyc.unit, every: Math.max(1, Number(cyc.every ?? 1)) }, methodId: methodRef(st, p.method) ?? currentPhase(s, today).methodId, region: str(p.region)?.toUpperCase(), note: str(p.note), planned: p.planned ? true : undefined };
      if (!st.fx.rates[plan.currency]) throw new Error(t('mcp.error.unsupportedCurrency', { code: plan.currency }));
      return commit(ctx, st, today, act === 'resume' ? resume(s, at, plan) : switchPlan(s, at, plan), a.dry_run, [act]);
    },
  },
  {
    name: 'set_status',
    description: 'Pause a subscription (stop projecting charges), cancel it (no renewal after a date), or reactivate it (clear pause / end date).',
    write: true,
    inputSchema: obj({ subscription: SUBREF, action: { type: 'string', enum: ['pause', 'cancel', 'reactivate'] }, at: { ...DATE, description: 'Defaults to today. For cancel: last day of service / no renewal from this date.' }, dry_run: DRY }, ['subscription', 'action']),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const s = findSub(st, a.subscription);
      const at = date(a.at, 'at', today);
      const act = String(a.action);
      let next: Subscription;
      if (act === 'pause') next = { ...s, status: 'paused', pausedAt: at };
      else if (act === 'cancel') {
        // 退订日之后排好的阶段（包括计划中的换套餐）一并取消，再给生效的那段设上结束日
        let c = s;
        for (const ph of (s.phases ?? []).filter((x) => x.start >= at && x.start > s.start).sort((x, y) => y.start.localeCompare(x.start))) c = dropPlan(c, ph.start);
        next = syncPhase({ ...toEditForm(c, today), status: 'cancelled', end: at }, today);
      } else next = syncPhase({ ...toEditForm(s, today), status: 'active', pausedAt: undefined, end: undefined }, today);
      return commit(ctx, st, today, next, a.dry_run, [act]);
    },
  },
  {
    name: 'record_payment',
    description:
      'Record an actual charge, refund (positive amount — stored negative), adjustment or failed charge for a subscription, in the subscription’s currency. settled = what the card was actually charged in another currency (e.g. TRY subscription billed in USD). Rejects same-day same-amount duplicates unless allow_duplicate.',
    write: true,
    inputSchema: obj(
      {
        subscription: SUBREF,
        date: { ...DATE, description: 'Defaults to today.' },
        amount: { type: 'number', minimum: 0 },
        kind: { type: 'string', enum: ['charge', 'refund', 'adjust', 'failed'], default: 'charge' },
        settled: obj({ amount: { type: 'number' }, currency: { type: 'string' } }, ['amount', 'currency']),
        note: { type: 'string' },
        allow_duplicate: { type: 'boolean', default: false },
        dry_run: DRY,
      },
      ['subscription', 'amount'],
    ),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const s = findSub(st, a.subscription);
      const d = date(a.date, 'date', today);
      const kind = str(a.kind) ?? 'charge';
      const sign = kind === 'refund' ? -1 : 1;
      const amount = sign * Math.abs(num(a.amount, 'amount'));
      const existing = chargesBetween(s, d, d, today).filter((c) => !c.projected && Math.abs(c.amount - amount) < 0.005);
      const isRecorded = [...(s.payments ?? []), ...(s.phases ?? []).flatMap((p) => p.payments ?? [])].some((p) => p.date === d && Math.abs(p.amount - amount) < 0.005);
      if (isRecorded && existing.length && !a.allow_duplicate) throw new Error(t('mcp.error.duplicatePayment', { date: d, amount }));
      const st2 = a.settled as { amount: unknown; currency: unknown } | undefined;
      const pay: Payment = { date: d, amount, kind: kind === 'charge' ? undefined : (kind as Payment['kind']), settled: st2 ? { amount: sign * Math.abs(num(st2.amount, 'settled.amount')), currency: String(st2.currency).toUpperCase() } : undefined, note: str(a.note) };
      return commit(ctx, st, today, savePayment(s, today, pay), a.dry_run, ['payment']);
    },
  },
  {
    name: 'delete_payment',
    description: 'Delete one recorded payment of a subscription by date (index picks among several on the same day, 0-based).',
    write: true,
    destructive: true,
    inputSchema: obj({ subscription: SUBREF, date: DATE, index: { type: 'integer', default: 0 }, dry_run: DRY }, ['subscription', 'date']),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const s = findSub(st, a.subscription);
      return commit(ctx, st, today, deletePayment(s, today, date(a.date, 'date'), Number(a.index ?? 0)), a.dry_run, ['delete_payment']);
    },
  },
  {
    name: 'record_receivable',
    description:
      'Mark money received from others: a shared-plan member paid their share (kind=share; advances their paid-until date by their billing cycle unless until is given), or a proxy charge was repaid (kind=proxy; charge = the charge date being repaid). Pass person (name or id) instead of subscription/member/kind to record it for that person: their only open item is picked (pass subscription when they owe on several).',
    write: true,
    inputSchema: obj(
      {
        subscription: { ...SUBREF, description: 'Subscription id or name. Optional when person is given and only one of their plans / proxy payments matches.' },
        person: { type: 'string', description: 'Person id or name (see list_people). Picks the matching member or proxy payment automatically.' },
        kind: { type: 'string', enum: ['share', 'proxy'], description: 'Inferred when person is given.' },
        member: { type: 'string', description: 'share: member id or name.' },
        charge: { ...DATE, description: 'proxy: which charge date is being repaid (defaults to the oldest unpaid).' },
        amount: { type: 'number', minimum: 0 },
        currency: { type: 'string', description: 'Defaults to the collection currency setting.' },
        date: { ...DATE, description: 'When the money arrived; defaults to today.' },
        until: { ...DATE, description: 'share: paid through this date (overrides automatic advance).' },
        note: { type: 'string' },
        dry_run: DRY,
      },
      ['amount'],
    ),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      if (a.person != null && String(a.person).trim()) a = { ...a, ...personTarget(st, a, today) };
      if (!a.subscription) throw new Error(t('mcp.error.needSubOrPerson'));
      if (a.kind !== 'share' && a.kind !== 'proxy') throw new Error(t('mcp.error.needKind'));
      const s = findSub(st, a.subscription);
      const on = date(a.date, 'date', today);
      const ccy = (str(a.currency) ?? st.settings.collectCurrency ?? st.settings.baseCurrency).toUpperCase();
      const amount = num(a.amount, 'amount');
      if (a.kind === 'share') {
        if (!s.share || s.share.role !== 'owner') throw new Error(t('mcp.error.notShareOwner', { name: s.name }));
        const q = String(a.member ?? '').trim().toLowerCase();
        const ms = s.share.members.filter((m) => m.id === q || m.name.toLowerCase() === q || (q && m.name.toLowerCase().includes(q)));
        if (ms.length !== 1) throw new Error(ms.length ? t('mcp.error.memberAmbiguous', { q: String(a.member), list: candidates(ms) }) : t('mcp.error.noMember', { list: candidates(s.share.members) }));
        const m = ms[0];
        const months = m.billEvery ?? 1;
        const from = m.paidUntil ? addDays(m.paidUntil, 1) : (m.joined ?? s.share.since ?? on);
        const until = a.until ? date(a.until, 'until') : addDays(addMonths(from, months), -1);
        const members = s.share.members.map((x) => (x.id === m.id ? { ...x, paidUntil: until, payments: [...(x.payments ?? []), { date: on, amount, currency: ccy, from, until, note: str(a.note) }] } : x));
        return commit(ctx, st, today, { ...s, share: { ...s.share, members } }, a.dry_run, [`share_payment:${m.name}`]);
      }
      if (!s.proxy) throw new Error(t('mcp.error.notProxy', { name: s.name }));
      const cs = chargesBetween(s, s.start, today, today);
      const matched = matchEntries(s.proxy.entries, cs.map((c) => c.date));
      const charge = a.charge ? date(a.charge, 'charge') : cs.find((c) => matched.get(c.date)?.received == null)?.date;
      if (!charge) throw new Error(t('mcp.error.noPendingProxy'));
      const old = matched.get(charge);
      const entry = { ...(old ?? { charge }), charge, received: amount, receivedCurrency: ccy, receivedOn: on, note: str(a.note) ?? old?.note };
      const entries = [...s.proxy.entries.filter((e) => e !== old), entry].sort((x, y) => x.charge.localeCompare(y.charge));
      return commit(ctx, st, today, { ...s, proxy: { ...s.proxy, entries } }, a.dry_run, [`proxy_received:${charge}`]);
    },
  },
  {
    name: 'update_payment_method',
    description: 'Update a payment method: set its current balance (recalibrate), record a top-up (optionally with what it actually cost in another currency, e.g. a gift card bought with CNY), or edit name/region.',
    write: true,
    inputSchema: obj(
      {
        method: { type: 'string', description: 'Payment method id or name.' },
        balance: { type: 'number', description: 'Actual balance now (in the method currency).' },
        top_up: obj({ amount: { type: 'number' }, date: DATE, cost: { type: 'number' }, cost_currency: { type: 'string' }, note: { type: 'string' } }, ['amount']),
        name: { type: 'string' },
        region: { type: 'string' },
        dry_run: DRY,
      },
      ['method'],
    ),
    async run(a, ctx) {
      const { st, today } = await state(ctx);
      const id = methodRef(st, a.method)!;
      const m = st.methods.find((x) => x.id === id)!;
      const r = runwayFor(m, st, today);
      const next = { ...m };
      const changed: string[] = [];
      if (a.balance != null) {
        next.balance = num(a.balance, 'balance');
        next.balanceAsOf = today;
        changed.push('balance');
      }
      if (a.top_up) {
        const t = a.top_up as Record<string, unknown>;
        const amt = num(t.amount, 'top_up.amount');
        next.topUps = [...(m.topUps ?? []), { date: date(t.date, 'top_up.date', today), amount: amt, cost: t.cost == null ? undefined : num(t.cost, 'top_up.cost'), costCurrency: str(t.cost_currency)?.toUpperCase(), note: str(t.note) }];
        if (a.balance == null && m.balance != null) {
          next.balance = round((r?.current ?? m.balance) + amt);
          next.balanceAsOf = today;
        }
        changed.push('top_up');
      }
      if (a.name) (next.name = String(a.name)), changed.push('name');
      if (a.region !== undefined) (next.region = str(a.region)?.toUpperCase()), changed.push('region');
      if (!changed.length) throw new Error(t('mcp.error.nothingToChange'));
      const after = { id: next.id, name: next.name, currency: next.currency, balance: next.balance ?? null, balance_as_of: next.balanceAsOf ?? null, top_ups: next.topUps?.length ?? 0 };
      if (a.dry_run) return { dry_run: true, changed, method: after };
      await upsert(ctx.env, 'methods', next.id, next);
      const r2 = runwayFor(next, { ...st, methods: st.methods.map((x) => (x.id === next.id ? next : x)) }, today);
      return { ok: true, changed, method: after, runway: r2 ? { monthly_drain: round(r2.monthlyDrain), runs_out_on: r2.runsOutOn ?? null } : null };
    },
  },
];

/** record_receivable 按人记账：在这个人的合租、代付里找出要记的那一笔（优先现在欠钱的） */
function personTarget(st: AppState, a: Record<string, unknown>, today: string): { subscription: string; kind: 'share' | 'proxy'; member?: string } {
  const p = findPerson(st, a.person);
  const sub = a.subscription ? findSub(st, a.subscription) : undefined;
  const items = (peopleLedger(st, today).find((l) => l.person.id === p.id)?.items ?? []).filter((i) => (!sub || i.sub.id === sub.id) && (!a.kind || i.kind === a.kind));
  const open = items.filter((i) => i.periodsOwed > 0);
  const live = items.filter((i) => i.active);
  const pick = open.length ? open : live.length === 1 ? live : items;
  if (!pick.length) throw new Error(t('mcp.error.personNoItems', { name: p.name }));
  if (pick.length > 1) throw new Error(t('mcp.error.personItemsAmbiguous', { name: p.name, list: candidates(pick.map((i) => ({ name: i.sub.name, id: i.sub.id }))) }));
  const i = pick[0];
  return { subscription: i.sub.id, kind: i.kind, member: i.member?.id };
}

function roundAll<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v])) as T;
}
