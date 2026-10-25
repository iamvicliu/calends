// 代付：把每一期扣款和对方的收款记录对上。页面和提醒邮件共用，保证两边说法一致
import { addDays, addMonths, chargesBetween, diffDays, type Charge } from './billing.ts';
import { toBaseAt } from './fx.ts';
import { t } from './i18n.ts';
import type { AppState, ProxyEntry, Subscription } from './types.ts';

/**
 * 先按扣款日精确对上；改过开始日期等原因对不上的，再找前后 15 天内还没用过的那条。
 * 按笔记的收款（batch，可能预收、可能多期）是按排期逐期生成的，只按扣款日精确对上，避免预收的下一期被挪到眼前这期
 */
export function matchEntries(entries: ProxyEntry[], dates: string[]): Map<string, ProxyEntry> {
  const out = new Map<string, ProxyEntry>();
  const used = new Set<ProxyEntry>();
  for (const d of dates) {
    const e = entries.find((x) => x.charge === d);
    if (e) {
      out.set(d, e);
      used.add(e);
    }
  }
  for (const d of dates) {
    if (out.has(d)) continue;
    const e = entries.filter((x) => !used.has(x) && !x.batch).sort((p, q) => Math.abs(diffDays(p.charge, d)) - Math.abs(diffDays(q.charge, d)))[0];
    if (!e || Math.abs(diffDays(e.charge, d)) > 15) continue;
    out.set(d, e);
    used.add(e);
  }
  return out;
}

export interface ProxyRow {
  date: string;
  entry?: ProxyEntry;
  /** 订阅原价（订阅币种） */
  list: number;
  listCurrency: string;
  /** 卡上实扣 */
  charged: number;
  currency: string;
  /** 扣款当天汇率折成本位币 */
  chargedBase: number;
  /** 收款当天汇率折成本位币；未收为空 */
  receivedBase?: number;
}

function row(state: AppState, c: Charge, entry: ProxyEntry | undefined): ProxyRow {
  const charged = entry?.charged ?? c.amount;
  const currency = entry?.chargedCurrency ?? c.currency;
  const received = entry?.received;
  return {
    date: c.date,
    entry,
    list: c.amount,
    listCurrency: c.currency,
    charged,
    currency,
    chargedBase: toBaseAt(state, charged, currency, c.date),
    receivedBase: received == null ? undefined : toBaseAt(state, received, entry!.receivedCurrency ?? state.settings.baseCurrency, entry!.receivedOn ?? c.date),
  };
}

/** 每一期（新的在前）：卡上实扣多少、折合多少，对方还了多少、折合多少 */
export function proxyRows(state: AppState, s: Subscription, today: string): ProxyRow[] {
  const entries = s.proxy?.entries ?? [];
  const charges = chargesBetween(s, s.start, today, today);
  const matched = matchEntries(
    entries,
    charges.map((c) => c.date),
  );
  return charges.map((c) => row(state, c, matched.get(c.date))).reverse();
}

/**
 * 已经预收、还没到扣款日的期（新的在前）。实扣按预测金额，不计入已代付、已收回与盈亏；到了扣款日自然进入 proxyRows
 */
export function proxyAhead(state: AppState, s: Subscription, today: string): ProxyRow[] {
  const ahead = (s.proxy?.entries ?? []).filter((e) => e.received != null && e.charge > today);
  if (!ahead.length) return [];
  const last = ahead.reduce((a, e) => (e.charge > a ? e.charge : a), ahead[0].charge);
  const byDate = new Map(ahead.map((e) => [e.charge, e]));
  return chargesBetween(s, addDays(today, 1), last, today)
    .filter((c) => byDate.has(c.date))
    .map((c) => row(state, c, byDate.get(c.date)))
    .reverse();
}

/** 还没收回的期：已扣未收的（含按相近日期对上的旧记录）在前，接着是未来的期；返回扣款日与现有记录 */
export function proxyOpenPeriods(s: Subscription, from: string, count: number, today: string): { date: string; entry?: ProxyEntry }[] {
  const entries = s.proxy?.entries ?? [];
  const past = chargesBetween(s, s.start, today, today);
  const matched = matchEntries(
    entries,
    past.map((c) => c.date),
  );
  const out = past.filter((c) => c.date >= from && matched.get(c.date)?.received == null).map((c) => ({ date: c.date, entry: matched.get(c.date) }));
  // 往后逐步放宽窗口，直到凑够期数或订阅不再扣款（周付、年付都不用估算周期）
  const start = from > today ? from : addDays(today, 1);
  for (let years = 1; out.length < count && years <= 128; years *= 2) {
    const future = chargesBetween(s, start, addMonths(start, 12 * years), today);
    const fresh = future.filter((c) => !entries.some((e) => e.charge === c.date && e.received != null) && !out.some((o) => o.date === c.date));
    out.push(...fresh.map((c) => ({ date: c.date, entry: entries.find((e) => e.charge === c.date) })));
    if (s.end && addMonths(start, 12 * years) > s.end) break;
  }
  return out.slice(0, count);
}

/**
 * 记一笔收款，覆盖从 from 起的 periods 期还没收回的扣款（可以是未来的期）：按期均摊金额，各期盈亏按自己那份算。
 * 已有的实扣修正与备注保留；凑不够期数时报错，不按更少的期摊
 */
export function recordProxyReceipt(
  s: Subscription,
  r: { id: string; date: string; amount: number; currency: string; from: string; periods: number; note?: string },
  today: string,
): { entries: ProxyEntry[]; covered: string[] } {
  const periods = proxyOpenPeriods(s, r.from, r.periods, today);
  if (periods.length < r.periods) throw new Error(t('mcp.error.proxyPeriodsShort', { count: periods.length, from: r.from }));
  const olds = new Set(periods.map((p) => p.entry).filter(Boolean));
  const batch = { id: r.id, amount: r.amount, periods: r.periods };
  const next = periods.map((p): ProxyEntry => ({
    ...p.entry,
    charge: p.date,
    received: r.amount / r.periods,
    receivedCurrency: r.currency,
    receivedOn: r.date,
    note: r.note ?? p.entry?.note,
    batch,
  }));
  const entries = [...(s.proxy?.entries ?? []).filter((e) => !olds.has(e)), ...next].sort((a, b) => a.charge.localeCompare(b.charge));
  return { entries, covered: periods.map((p) => p.date) };
}

/** 撤销一笔收款（可能覆盖多期）：各期恢复为未收，实扣修正与备注保留，空记录去掉 */
export function removeProxyBatch(entries: ProxyEntry[], id: string): ProxyEntry[] {
  return entries.flatMap((e) => {
    if (e.batch?.id !== id) return [e];
    const { received: _r, receivedCurrency: _c, receivedOn: _o, batch: _b, ...rest } = e;
    return rest.charged != null || rest.note ? [rest] : [];
  });
}

/**
 * 一组代付期的合计（都折成本位币）：已收与待收两组、已代付、已收回、待收、盈亏（只算已收的期：收回 − 实扣）、最近一次收款日。
 * 代付页、卡片、详情与列表共用，口径只在这里一处
 */
export function proxyTotals(rows: ProxyRow[]) {
  const done = rows.filter((r) => r.receivedBase != null);
  const open = rows.filter((r) => r.receivedBase == null);
  return {
    done,
    open,
    charged: rows.reduce((a, r) => a + r.chargedBase, 0),
    received: done.reduce((a, r) => a + r.receivedBase!, 0),
    owed: open.reduce((a, r) => a + r.chargedBase, 0),
    diff: done.reduce((a, r) => a + r.receivedBase! - r.chargedBase, 0),
    lastIn: done.map((r) => r.entry?.receivedOn ?? r.date).reduce<string | undefined>((a, d) => (!a || d > a ? d : a), undefined),
  };
}
