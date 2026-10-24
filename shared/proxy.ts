// 代付：把每一期扣款和对方的收款记录对上。页面和提醒邮件共用，保证两边说法一致
import { chargesBetween, diffDays } from './billing.ts';
import { toBaseAt } from './fx.ts';
import type { AppState, ProxyEntry, Subscription } from './types.ts';

/** 先按扣款日精确对上；改过开始日期等原因对不上的，再找前后 15 天内还没用过的那条 */
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
    const e = entries.filter((x) => !used.has(x)).sort((p, q) => Math.abs(diffDays(p.charge, d)) - Math.abs(diffDays(q.charge, d)))[0];
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

/** 每一期（新的在前）：卡上实扣多少、折合多少，对方还了多少、折合多少 */
export function proxyRows(state: AppState, s: Subscription, today: string): ProxyRow[] {
  const entries = s.proxy?.entries ?? [];
  const charges = chargesBetween(s, s.start, today, today);
  const matched = matchEntries(
    entries,
    charges.map((c) => c.date),
  );
  return charges
    .map((c) => {
      const entry = matched.get(c.date);
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
        receivedBase:
          received == null ? undefined : toBaseAt(state, received, entry!.receivedCurrency ?? state.settings.baseCurrency, entry!.receivedOn ?? c.date),
      };
    })
    .reverse();
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
