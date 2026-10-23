import { memberCashFlows, memberFlowValue } from './carpool.ts';
import { addDays, addMonths, chargesBetween, memberDues, myShareFactor, phaseSubs, totals, type Charge } from './billing.ts';
import { chargeValue, toBaseAt } from './fx.ts';
import {
  cashVsAccrual,
  contributionOn,
  events,
  monthEnd,
  movement,
  mrrChangeSinceLastMonth,
  mrrOn,
  stopLosses,
  type CashAccrual,
  type LedgerEvent,
  type Movement,
  type StopLoss,
} from './metrics.ts';
import type { AppState, Subscription } from './types.ts';

export interface Comparison {
  amount: number;
  /** Undefined when the comparison period has zero or negative net cash. */
  percent?: number;
}

export interface ChargeRow {
  sub: Subscription;
  date: string;
  /** Base currency, my share; refunds are negative. */
  amount: number;
  original: Charge;
}

export interface CompositionRow {
  key: string;
  amount: number;
  share: number;
  other?: true;
}

export type MovementRow = Movement['items'][number] & {
  from: number;
  to: number;
  /** One event date, or the span of events contributing to this net change. */
  since: string;
  until: string;
};

export type ReportEvent = Pick<LedgerEvent, 'date' | 'sub' | 'delta'> & { kind: LedgerEvent['kind'] | 'trial' | 'cancel' };

export type Block =
  | { type: 'headline'; mode: 'scope'; mrr: number; annual: number; activeCount: number; paid: number; loss: number; change: Comparison }
  | { type: 'headline'; mode: 'total'; total: number; count: number; average: number; yearPaid: number; since: string }
  | { type: 'headline'; mode: 'month'; month: string; total: number; paid: number; pending: number; count: number; previous: Comparison; yearly?: Comparison }
  | { type: 'trend'; mode: 'scope'; rows: CashAccrual[] }
  | { type: 'trend'; mode: 'month'; month: string; movement: Omit<Movement, 'items'> & { items: MovementRow[] } }
  | { type: 'composition'; categories: CompositionRow[]; methods: CompositionRow[] }
  | { type: 'top'; mode: 'scope' | 'total'; rows: Array<{ sub: Subscription; amount: number }> }
  | { type: 'top'; mode: 'month'; rows: ChargeRow[] }
  | { type: 'upcoming'; rows: ChargeRow[]; total: number }
  | { type: 'events'; rows: ReportEvent[] }
  | { type: 'losses'; rows: StopLoss[]; refunds: ChargeRow[]; loss: number; refunded: number; incomplete: boolean }
  | { type: 'sharing'; rows: Array<{ sub: Subscription; received: number; owed: number }>; received: number; owed: number };

export interface ScopeReport {
  blocks: Block[];
}

export interface MonthCash {
  month: string;
  total: number;
  paid: number;
  pending: number;
}

const sum = (rows: Array<{ amount: number }>) => rows.reduce((a, r) => a + r.amount, 0);
const compare = (amount: number, previous: number): Comparison => ({
  amount: amount - previous,
  percent: previous > 0 ? (amount - previous) / previous : undefined,
});
const byAmount = (a: { sub: Subscription; amount: number }, b: { sub: Subscription; amount: number }) =>
  b.amount - a.amount || a.sub.id.localeCompare(b.sub.id);

function cashMonth(rows: ChargeRow[], month: string, today: string): MonthCash {
  return { month, total: sum(rows), paid: sum(rows.filter((r) => r.date <= today)), pending: sum(rows.filter((r) => r.date > today)) };
}

function charges(state: AppState, from: string, to: string, today: string): ChargeRow[] {
  return state.subscriptions
    .flatMap((sub) =>
      chargesBetween(sub, from, to, today)
        .filter((c) => c.kind !== 'failed')
        .map((c) => ({ sub, date: c.date, amount: chargeValue(state, c) * myShareFactor(c.sub, c.date), original: c })),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.sub.id.localeCompare(b.sub.id));
}

/** Ranked composition: at most six rows, with the tail sharing one explicit Other row. */
export function compactComposition(rows: readonly CompositionRow[]): CompositionRow[] {
  if (rows.length <= 6) return [...rows];
  const rest = rows.slice(5);
  return [...rows.slice(0, 5), { key: '', other: true, amount: sum(rest), share: rest.reduce((a, r) => a + r.share, 0) }];
}

function composition(rows: Array<{ key: string; amount: number }>): CompositionRow[] {
  const groups = new Map<string, number>();
  for (const r of rows) groups.set(r.key, (groups.get(r.key) ?? 0) + r.amount);
  const total = sum(rows);
  return compactComposition(
    [...groups]
      .filter(([, amount]) => amount > 0)
      .map(([key, amount]) => ({ key, amount, share: amount / total }))
      .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key)),
  );
}

function addComposition(blocks: Block[], cat: CompositionRow[], pay: CompositionRow[], scope: boolean) {
  const categories = scope && cat.length === 1 ? [] : cat;
  const methods = pay.length > 1 ? pay : [];
  if (categories.length || methods.length) blocks.push({ type: 'composition', categories, methods });
}

function details(
  state: AppState,
  today: string,
  from: string,
  to: string,
  lossRange: { from: string; to: string } | undefined,
  sharingFrom: string,
  sharingTo: string,
): Block[] {
  const blocks: Block[] = [];
  const roots = new Map(state.subscriptions.map((s) => [s.id, s]));
  // events() emits end-of-service on the following day and only after it has passed.
  const rows: ReportEvent[] = events(state, addDays(to, 1))
    .filter((e) => e.date >= from && e.date <= to && e.kind !== 'buy' && e.kind !== 'pause')
    .map((e) => ({ date: e.date, delta: e.delta, kind: e.kind === 'end' && e.sub.stop ? 'cancel' : e.kind, sub: roots.get(e.sub.id)! }));
  for (const sub of state.subscriptions) {
    if (
      sub.trialEnd &&
      sub.trialEnd >= from &&
      sub.trialEnd <= to &&
      (sub.status !== 'cancelled' || sub.end) &&
      (!sub.end || sub.end >= sub.trialEnd) &&
      (!sub.stop || sub.stop.date >= sub.trialEnd)
    )
      rows.push({ sub, date: sub.trialEnd, kind: 'trial', delta: 0 });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.sub.id.localeCompare(b.sub.id) || a.kind.localeCompare(b.kind));
  if (rows.length) blocks.push({ type: 'events', rows });

  const losses = stopLosses(state, today, lossRange);
  // Fully refunded stops are deliberately absent from stopLosses(); use cash records for refunds.
  const refunds = charges(state, lossRange?.from ?? '0001-01-01', lossRange?.to && lossRange.to < today ? lossRange.to : today, today).filter(
    (r) => r.original.kind === 'refund' && (r.original.amount < 0 || (r.original.settled?.amount ?? 0) < 0),
  );
  if (losses.items.length || refunds.length)
    blocks.push({ type: 'losses', rows: losses.items, refunds, loss: losses.total, refunded: -sum(refunds), incomplete: losses.incomplete });

  const sharing = state.subscriptions
    .filter((s) => s.share?.role === 'owner')
    .map((sub) => {
      const received = sub
        .share!.members.flatMap(memberCashFlows)
        .filter((p) => p.date >= sharingFrom && p.date <= sharingTo && p.date <= today)
        .reduce((a, p) => a + memberFlowValue(state, p), 0);
      // Only still-unpaid periods originating in this window, not older arrears.
      const before = new Map(memberDues(sub, addDays(sharingFrom, -1), state.settings.collectCurrency, state).map((d) => [d.member.id, d.owed]));
      const owed = memberDues(sub, sharingTo, state.settings.collectCurrency, state).reduce(
        (a, d) =>
          a +
          (Number.isFinite(d.owed) && Number.isFinite(before.get(d.member.id) ?? 0)
            ? toBaseAt(state, Math.max(0, d.owed - (before.get(d.member.id) ?? 0)), d.currency, sharingTo > today ? undefined : sharingTo)
            : NaN),
        0,
      );
      return { sub, received, owed };
    })
    .filter((r) => r.received !== 0 || r.owed > 0 || !Number.isFinite(r.owed));
  if (sharing.length)
    blocks.push({ type: 'sharing', rows: sharing, received: sharing.reduce((a, r) => a + r.received, 0), owed: sharing.reduce((a, r) => a + r.owed, 0) });
  return blocks;
}

/** Fixed window: twelve cash months including this month, then three forecast months. */
export function scopeReport(state: AppState, subs: readonly Subscription[], today: string): ScopeReport {
  const scoped = { ...state, subscriptions: subs.filter((s) => !s.proxy) };
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const mrr = mrrOn(scoped, today);
  // 没有任何持续计费（全是买断，或都已停止）时，月成本恒为 0，改看累计花了多少
  if (mrr === 0 && scoped.subscriptions.length) return totalReport(scoped, today, yearStart);
  const blocks: Block[] = [
    {
      type: 'headline',
      mode: 'scope',
      mrr,
      annual: mrr * 12,
      activeCount: totals(scoped, today).activeCount,
      paid: sum(charges(scoped, yearStart, today, today)),
      loss: stopLosses(scoped, today, { from: yearStart, to: today }).total,
      change: { amount: mrrChangeSinceLastMonth(scoped, today) },
    },
  ];
  const cash = cashVsAccrual(scoped, today, 11, 3);
  if (cash.some((r) => r.cash !== 0)) blocks.push({ type: 'trend', mode: 'scope', rows: cash });
  const live = scoped.subscriptions.map((sub) => ({ sub, amount: contributionOn(scoped, sub, today) })).filter((r) => r.amount > 0);
  addComposition(
    blocks,
    composition(live.map((r) => ({ key: r.sub.category, amount: r.amount }))),
    composition(scoped.subscriptions.flatMap((s) => phaseSubs(s).map((p) => ({ key: p.methodId ?? '', amount: contributionOn(scoped, p, today) })))),
    true,
  );
  if (live.length) blocks.push({ type: 'top', mode: 'scope', rows: live.sort(byAmount).slice(0, 5) });
  const upcoming = charges(scoped, addDays(today, 1), addDays(today, 30), today).filter((r) => r.original.kind !== 'refund' && r.amount > 0);
  if (upcoming.length) blocks.push({ type: 'upcoming', rows: upcoming, total: sum(upcoming) });
  blocks.push(...details(scoped, today, addMonths(today, -12), addDays(today, 30), undefined, yearStart, today));
  return { blocks };
}

/** 累计视角：从第一笔到今天按我的份额、扣除退款的实际支出；构成与排行也按累计金额。 */
function totalReport(scoped: AppState, today: string, yearStart: string): ScopeReport {
  const first = scoped.subscriptions.reduce((m, s) => (s.start < m ? s.start : m), today);
  const rows = charges(scoped, first, today, today);
  const total = sum(rows);
  const bySub = new Map<string, { sub: Subscription; amount: number }>();
  for (const r of rows) {
    const e = bySub.get(r.sub.id) ?? { sub: r.sub, amount: 0 };
    e.amount += r.amount;
    bySub.set(r.sub.id, e);
  }
  const spent = [...bySub.values()].filter((r) => r.amount > 0);
  const blocks: Block[] = [
    {
      type: 'headline',
      mode: 'total',
      total,
      count: scoped.subscriptions.length,
      average: scoped.subscriptions.length ? total / scoped.subscriptions.length : 0,
      yearPaid: sum(rows.filter((r) => r.date >= yearStart)),
      since: rows[0]?.date ?? first,
    },
  ];
  addComposition(
    blocks,
    composition(spent.map((r) => ({ key: r.sub.category, amount: r.amount }))),
    composition(rows.map((r) => ({ key: r.original.sub.methodId ?? '', amount: r.amount }))),
    true,
  );
  if (spent.length > 1) blocks.push({ type: 'top', mode: 'total', rows: spent.sort(byAmount).slice(0, 10) });
  blocks.push(...details(scoped, today, addMonths(today, -12), addDays(today, 30), undefined, yearStart, today));
  return { blocks };
}

/** Monthly cash uses the same net, my-share cash basis as cashVsAccrual, including refunds. */
export function monthReport(state: AppState, month: string, today: string): ScopeReport & { months: MonthCash[] } {
  const scoped = { ...state, subscriptions: state.subscriptions.filter((s) => !s.proxy) };
  const from = `${month}-01`;
  const to = monthEnd(month);
  const rows = charges(scoped, from, to, today);
  const previousMonth = addMonths(from, -1).slice(0, 7);
  const previous = charges(scoped, `${previousMonth}-01`, monthEnd(previousMonth), today);
  const lastYear = addMonths(from, -12).slice(0, 7);
  const yearly = charges(scoped, `${lastYear}-01`, monthEnd(lastYear), today);
  const debits = rows.filter((r) => r.original.kind !== 'refund' && r.amount > 0);
  const blocks: Block[] = [
    {
      type: 'headline',
      mode: 'month',
      ...cashMonth(rows, month, today),
      count: rows.filter((r) => r.original.kind !== 'refund').length,
      previous: compare(sum(rows), sum(previous)),
      yearly: yearly.some((r) => r.original.kind !== 'refund') ? compare(sum(rows), sum(yearly)) : undefined,
    },
  ];
  if (from <= today) {
    const end = to < today ? to : today;
    const start = addDays(from, -1);
    const endFx = end === today ? undefined : end;
    const mv = movement(scoped, start, end, endFx);
    if (mv.items.length || Math.abs(mv.fx) >= 0.005) {
      const changes = events(scoped, end).filter((e) => e.date >= from && e.kind !== 'buy');
      const items = mv.items.map((r): MovementRow => {
        const dates = changes
          .filter((e) => e.sub.id === r.sub.id)
          .map((e) => e.date)
          .sort();
        return {
          ...r,
          from: contributionOn(scoped, r.sub, start, endFx),
          to: contributionOn(scoped, r.sub, end, endFx),
          since: dates[0] ?? from,
          until: dates.at(-1) ?? end,
        };
      });
      blocks.push({ type: 'trend', mode: 'month', month, movement: { ...mv, items } });
    }
  }
  addComposition(
    blocks,
    composition(debits.map((r) => ({ key: r.sub.category, amount: r.amount }))),
    composition(debits.map((r) => ({ key: r.original.sub.methodId ?? '', amount: r.amount }))),
    false,
  );
  if (debits.length) blocks.push({ type: 'top', mode: 'month', rows: [...debits].sort(byAmount).slice(0, 5) });
  const upcoming = debits.filter((r) => r.date > today);
  if (to >= today && upcoming.length) blocks.push({ type: 'upcoming', rows: upcoming, total: sum(upcoming) });
  blocks.push(...details(scoped, today, from, to, { from, to }, from, to < today ? to : from > today ? to : today));
  const months = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(from, i - 5).slice(0, 7);
    return cashMonth(m === month ? rows : charges(scoped, `${m}-01`, monthEnd(m), today), m, today);
  });
  return { blocks, months };
}
