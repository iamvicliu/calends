// 旧版应收数据一次性转成按期记账（receivables.ts）。读账本、导入备份后都会经过这里，转过的数据原样返回。
// 旧合租成员：paidUntil（已付至）+ payments（每笔收款写覆盖起止日）；旧代付：entries（每期一条，收款、实扣混在一起）。
// 收到的钱一笔不丢：对不上任何一期的收款保留原来覆盖的起始日，界面上作为对不上的记录单独列出
import { addDays, addMonths, chargesBetween, diffDays, memberBillMonths, memberPeriods, memberSince } from './billing.ts';
import type { Period } from './receivables.ts';
import type { ProxyCharge, Receipt, ShareMember, Subscription } from './types.ts';

interface LegacyPayment {
  date: string;
  amount: number;
  currency: string;
  from?: string;
  until: string;
  note?: string;
}

interface LegacyEntry {
  charge: string;
  charged?: number;
  chargedCurrency?: string;
  received?: number;
  receivedCurrency?: string;
  receivedOn?: string;
  note?: string;
  batch?: { id: string; amount: number; periods: number };
}

type LegacyMember = ShareMember & { paidUntil?: string; payments?: LegacyPayment[] };
type LegacyProxy = NonNullable<Subscription['proxy']> & { entries?: LegacyEntry[] };

const isLegacyMember = (m: ShareMember) => 'paidUntil' in m || 'payments' in m;
const isLegacyProxy = (p: Subscription['proxy']) => !!p && 'entries' in p;

/** 有旧版字段的订阅转成新结构；没有的原样返回（同一个对象），调用方据此判断要不要写回 */
export function migrateReceivables(s: Subscription, baseCurrency: string): Subscription {
  const members = s.share?.members;
  const legacyShare = !!members?.some(isLegacyMember);
  const legacyProxy = isLegacyProxy(s.proxy);
  if (!legacyShare && !legacyProxy) return s;
  // 旧版的收款基准日由收款覆盖期推断；转换前先写死，各期的切法和以后新成员的对齐都不变
  const share = legacyShare && !s.share!.collectFrom && !s.share!.since ? { ...s.share!, collectFrom: legacyAnchor(s) } : s.share;
  const base = { ...s, share };
  return {
    ...base,
    ...(legacyShare ? { share: { ...share!, members: members!.map((m) => (isLegacyMember(m) ? memberFrom(base, m as LegacyMember) : m)) } } : {}),
    ...(legacyProxy ? { proxy: proxyFrom(s, s.proxy as LegacyProxy, baseCurrency) } : {}),
  };
}

/** 旧版推断收款基准日：最早一笔收款的覆盖起点；只有已付至时按一个收费周期往前推 */
function legacyAnchor(s: Subscription): string {
  const starts = (s.share?.members ?? []).flatMap((x) => {
    const m = x as LegacyMember;
    const fromUntil = (until: string) => addMonths(addDays(until, 1), -memberBillMonths(s, m));
    if (m.payments?.length) return m.payments.map((p) => p.from ?? fromUntil(p.until));
    return m.paidUntil ? [fromUntil(m.paidUntil)] : [];
  });
  return starts.sort()[0] ?? s.start;
}

function memberFrom(s: Subscription, m: LegacyMember): ShareMember {
  const { paidUntil, payments = [], ...plain } = m;
  const joined = memberSince(s, m);
  const last = [joined, paidUntil ?? joined, ...payments.map((p) => p.until)].sort().at(-1)!;
  // 旧版的期跟着收款走：收款写明的起始日、已付至的次日如果不在按条款切出的期界上，说明节奏在那天改过（断过再续、手动调过），
  // 记成节奏重新起算，转换后下一次收款日与旧版一致
  let rest: ShareMember = plain;
  const marks = [...payments.flatMap((p) => (p.from ? [p.from] : [])), ...(paidUntil ? [addDays(paidUntil, 1)] : [])].filter((d) => d > joined).sort();
  for (const d of new Set(marks)) {
    // 只在落在某一期中间时才算改了节奏；正好在期界上、或已在退出与订阅结束之后的不用记
    if ((m.left && d >= m.left) || !memberPeriods(s, rest, d, s.currency).some((p) => p.from < d && d <= p.until)) continue;
    rest = { ...rest, restarts: [...(rest.restarts ?? []), d] };
  }
  // 迁移按旧版口径（订阅币种）切期，转换结果不随设置变化
  const periods = memberPeriods(s, rest, last, s.currency);
  const taken = new Set<string>();
  const receipts: Receipt[] = [];
  // 老收款没有起始日时，接着上一笔的终点，再不行按一个收费周期往前推
  let previous: string | undefined;
  for (const [i, p] of payments.map((p, i) => [i, p] as const).sort((a, b) => a[1].until.localeCompare(b[1].until) || a[1].date.localeCompare(b[1].date))) {
    const inferred = previous ? addDays(previous, 1) : addMonths(addDays(p.until, 1), -memberBillMonths(s, rest, p.until));
    const from = p.from ?? (inferred < joined ? joined : inferred);
    previous = previous && previous > p.until ? previous : p.until;
    receipts.push({
      id: `legacy-${i}`,
      date: p.date,
      amount: p.amount,
      currency: p.currency,
      periods: claim(periods, taken, from, p.until),
      ...(p.note ? { note: p.note } : {}),
    });
  }
  // 已付至之前、没有收款记录的期：开始记账前就收清了，金额不详
  const opening = paidUntil ? periods.filter((p) => p.from <= paidUntil && !taken.has(p.key) && p.due > 0).map((p) => p.key) : [];
  if (opening.length) receipts.unshift({ id: 'legacy-opening', date: opening[0], amount: 0, currency: periods[0].currency, periods: opening, opening: true });
  return { ...rest, ...(receipts.length ? { receipts: receipts.sort((a, b) => a.date.localeCompare(b.date)) } : {}) };
}

/**
 * 一笔老收款覆盖 [from, until]：起始日落在其中、还没被占用的期都归它（应收为 0 的免费期不占）。
 * 都被占了就挂在重叠的期上（不影响各期状态，钱照样计入）；连重叠的期都没有就保留原起始日
 */
function claim(periods: Period[], taken: Set<string>, from: string, until: string): string[] {
  const inside = periods.filter((p) => p.from >= from && p.from <= until && p.due > 0);
  const free = inside.filter((p) => !taken.has(p.key));
  const overlap = periods.filter((p) => p.from <= until && p.until >= from);
  const pick = free.length ? free : (overlap.find((p) => !taken.has(p.key)) ?? overlap[0]);
  const keys = Array.isArray(pick) ? pick.map((p) => p.key) : pick ? [pick.key] : [from];
  for (const k of keys) taken.add(k);
  return keys;
}

function proxyFrom(s: Subscription, p: LegacyProxy, baseCurrency: string): Subscription['proxy'] {
  const { entries = [], ...rest } = p;
  const last = entries.reduce((a, e) => (e.charge > a ? e.charge : a), s.start);
  const dates = chargesBetween(s, s.start, last, last).map((c) => c.date);
  const keyOf = matchEntries(entries, dates);
  const charged: ProxyCharge[] = [];
  const receipts: Receipt[] = [];
  const batches = new Map<string, Receipt>();
  entries.forEach((e, i) => {
    const key = keyOf.get(e) ?? e.charge;
    const received = e.received != null;
    if (e.charged != null || (e.note && !received))
      charged.push({
        charge: key,
        ...(e.charged != null ? { amount: e.charged } : {}),
        ...(e.chargedCurrency ? { currency: e.chargedCurrency } : {}),
        ...(e.note && !received ? { note: e.note } : {}),
      });
    if (!received) return;
    const base = { date: e.receivedOn ?? e.charge, currency: e.receivedCurrency ?? baseCurrency, ...(e.note ? { note: e.note } : {}) };
    if (e.batch) {
      const b = batches.get(e.batch.id);
      if (b) b.periods.push(key);
      else batches.set(e.batch.id, { id: e.batch.id, amount: e.batch.amount, periods: [key], ...base });
      return;
    }
    receipts.push({ id: `legacy-${i}`, amount: e.received!, periods: [key], ...base });
  });
  const all = [...receipts, ...batches.values()].map((r) => ({ ...r, periods: [...new Set(r.periods)].sort() }));
  return {
    ...rest,
    ...(all.length ? { receipts: all.sort((a, b) => a.date.localeCompare(b.date)) } : {}),
    ...(charged.length ? { charged: charged.sort((a, b) => a.charge.localeCompare(b.charge)) } : {}),
  };
}

/**
 * 老代付记录对到扣款日：先按扣款日精确对上；改过开始日期等原因对不上的，再找前后 15 天内还没用过的那条。
 * 一笔多期的收款（batch）是按排期逐期生成的，只精确对上
 */
function matchEntries(entries: LegacyEntry[], dates: string[]): Map<LegacyEntry, string> {
  const out = new Map<LegacyEntry, string>();
  const usedDates = new Set<string>();
  for (const d of dates) {
    const e = entries.find((x) => x.charge === d && !out.has(x));
    if (e) {
      out.set(e, d);
      usedDates.add(d);
    }
  }
  for (const d of dates) {
    if (usedDates.has(d)) continue;
    const e = entries.filter((x) => !out.has(x) && !x.batch).sort((p, q) => Math.abs(diffDays(p.charge, d)) - Math.abs(diffDays(q.charge, d)))[0];
    if (!e || Math.abs(diffDays(e.charge, d)) > 15) continue;
    out.set(e, d);
    usedDates.add(d);
  }
  return out;
}
