// 应收账：按期记账。合租成员和代付共用一套规则——
// 每一期是一笔应收（由条款推算，不存储）；每笔收款、免收写明抵扣哪几期；每期的状态由此推算。
// 期可以不连续地收（第 1、3、5 期收了，第 2、4 期仍欠），也可以提前收还没到期的期。
import { currencyDecimals } from './format.ts';
import { t } from './i18n.ts';
import type { Receipt, Waiver } from './types.ts';

/** 一期应收：key 是这一期的标识（合租为起始日，代付为扣款日） */
export interface Period {
  key: string;
  from: string;
  until: string;
  /** 这一期应收多少（currency） */
  due: number;
  currency: string;
}

/**
 * 一期的状态：已收、已免、免费（应收为 0，如免费首期、不分摊）、欠着（已经开始还没收）、未到期
 */
export type PeriodStatus = 'paid' | 'waived' | 'free' | 'due' | 'upcoming';

export interface LedgerPeriod extends Period {
  status: PeriodStatus;
  /** 抵扣这一期的收款 */
  receipt?: Receipt;
  /** 免收这一期的记录 */
  waiver?: Waiver;
  /** 这笔收款分到这一期的金额（收款币种）；期初结清没有金额 */
  share?: number;
}

export interface Receivable {
  receipts?: Receipt[];
  waivers?: Waiver[];
}

/** 已收、已免、免费都算结清：不欠钱，也不再提醒 */
export const isSettled = (p: Pick<LedgerPeriod, 'status'>) => p.status === 'paid' || p.status === 'waived' || p.status === 'free';

/**
 * 一笔收款分到各期的金额：按各期应收的比例分摊（首期按天折算的期分得少）；
 * 应收币种不一致、合计为 0、或有的期已不在应收里（条款改过）时平均分
 */
export function receiptShares(receipt: Receipt, periods: Map<string, Period>): Map<string, number> {
  const listed = receipt.periods.map((k) => periods.get(k));
  const known = listed.filter((p): p is Period => !!p);
  const total = known.reduce((a, p) => a + p.due, 0);
  const proportional = known.length === listed.length && total > 0 && known.every((p) => p.currency === known[0].currency);
  if (!receipt.periods.length) return new Map();
  const weights = receipt.periods.map((_, i) => (proportional ? listed[i]!.due : 1));
  const sum = weights.reduce((a, w) => a + w, 0);
  // 按收款币种的最小单位分：先各取整，差的几分按余数从大到小补上，合计正好等于实收
  const unit = 10 ** currencyDecimals(receipt.currency);
  const cents = Math.round(receipt.amount * unit);
  const raw = weights.map((w) => (cents * w) / sum);
  const out = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let left = cents - out.reduce((a, c) => a + c, 0), j = 0; left > 0; left--, j++) out[order[j % order.length][1]]++;
  return new Map(receipt.periods.map((k, i) => [k, out[i] / unit]));
}

/**
 * 记录里写的期对到现在的哪一期：先按起始日精确对上；条款改过（收款基准日、加入日、周期）把期重新切过时，
 * 落在哪一期里就算哪一期，历史收款不会因为改了条款变成欠款。都对不上返回空
 */
export function resolveKey(periods: Period[], key: string): string | undefined {
  if (periods.some((p) => p.key === key)) return key;
  return periods.find((p) => p.from <= key && key <= p.until)?.key;
}

/** 一笔记录对到现在各期后的期（去重、保持顺序）；对不上的期丢掉 */
export const resolvedPeriods = (periods: Period[], rec: Receipt | Waiver) => [
  ...new Set(rec.periods.map((k) => resolveKey(periods, k)).filter((k): k is string => !!k)),
];

/**
 * 把收款、免收对到各期上，推算每期状态。同一期被多笔记录覆盖时以先记的为准（写入时会拦住重复）。
 * unmatched 是一期都对不上的记录（比如加入日改到了收款之后），界面上单独列出来，不会悄悄丢掉
 */
export function settle(periods: Period[], r: Receivable, today: string): { periods: LedgerPeriod[]; unmatched: (Receipt | Waiver)[] } {
  const byKey = new Map(periods.map((p) => [p.key, p]));
  const paid = new Map<string, { receipt: Receipt; share: number }>();
  const waived = new Map<string, Waiver>();
  const unmatched: (Receipt | Waiver)[] = [];
  for (const receipt of [...(r.receipts ?? [])].sort((a, b) => a.date.localeCompare(b.date))) {
    const keys = resolvedPeriods(periods, receipt);
    if (!keys.length) unmatched.push(receipt);
    const shares = receiptShares({ ...receipt, periods: keys }, byKey);
    for (const k of keys) if (!paid.has(k)) paid.set(k, { receipt, share: shares.get(k)! });
  }
  for (const w of r.waivers ?? []) {
    const keys = resolvedPeriods(periods, w);
    if (!keys.length) unmatched.push(w);
    for (const k of keys) if (!waived.has(k) && !paid.has(k)) waived.set(k, w);
  }
  return {
    unmatched,
    periods: periods.map((p) => {
      const hit = paid.get(p.key);
      if (hit) return { ...p, status: 'paid', receipt: hit.receipt, share: hit.receipt.opening ? undefined : hit.share };
      const w = waived.get(p.key);
      if (w) return { ...p, status: 'waived', waiver: w };
      return { ...p, status: p.due === 0 ? 'free' : p.from <= today ? 'due' : 'upcoming' };
    }),
  };
}

/** 从第一期起连续结清到哪天（显示用的「已付至」）；第一期就没结清时为空 */
export function paidThrough(periods: LedgerPeriod[]): string | undefined {
  let until: string | undefined;
  for (const p of periods) {
    if (!isSettled(p)) break;
    until = p.until;
  }
  return until;
}

/** 已经被收款或免收占用的期（对到现在各期后）：写入新收款时不能重复抵扣 */
export function takenPeriods(r: Receivable, periods: Period[], except?: string): Set<string> {
  return new Set([...(r.receipts ?? []), ...(r.waivers ?? [])].filter((x) => x.id !== except).flatMap((x) => resolvedPeriods(periods, x)));
}

/**
 * 写入（新增或按 id 替换）一笔收款或免收：期不能为空、不能重复，必须是这笔账里的期，且没被别的记录占用。
 * periods 是当前推算出的各期（含要提前收的未来期）；校验失败抛错，不写半截
 */
export function putRecord(r: Receivable, kind: 'receipt' | 'waiver', rec: Receipt | Waiver, periods: Period[]): Required<Receivable> {
  if (!rec.periods.length || new Set(rec.periods).size !== rec.periods.length) throw new Error(t('mcp.error.noPeriods'));
  const unknown = rec.periods.find((k) => !resolveKey(periods, k));
  if (unknown) throw new Error(t('mcp.error.periodUnknown', { period: unknown }));
  // 写入时统一成现在各期的起始日
  const keys = resolvedPeriods(periods, rec);
  if (keys.length !== rec.periods.length) throw new Error(t('mcp.error.noPeriods'));
  const taken = takenPeriods(r, periods, rec.id);
  const clash = keys.find((k) => taken.has(k));
  if (clash) throw new Error(t('mcp.error.periodTaken', { period: clash }));
  const sorted = { ...rec, periods: keys.sort() };
  const put = <T extends { id: string }>(list: T[] | undefined, x: T | undefined) => [...(list ?? []).filter((y) => y.id !== rec.id), ...(x ? [x] : [])];
  return {
    receipts: put(r.receipts, kind === 'receipt' ? (sorted as Receipt) : undefined).sort((a, b) => a.date.localeCompare(b.date)),
    waivers: put(r.waivers, kind === 'waiver' ? (sorted as Waiver) : undefined),
  };
}

/** 删掉一笔收款或免收：抵扣的期恢复为没结清；找不到这笔时抛错 */
export function removeRecord(r: Receivable, id: string): Required<Receivable> {
  if (![...(r.receipts ?? []), ...(r.waivers ?? [])].some((x) => x.id === id)) throw new Error(t('mcp.error.invalidTarget'));
  return { receipts: (r.receipts ?? []).filter((x) => x.id !== id), waivers: (r.waivers ?? []).filter((x) => x.id !== id) };
}

/**
 * 从一笔分几期的记录里只去掉某一期（每期弹窗里的删除）：这一期回到待收，其余期照旧；
 * 收款同时扣掉分到这一期的金额（share，与表格上显示的同一个数）。只剩这一期时整笔删掉
 */
export function removeRecordPeriod(r: Receivable, id: string, period: Pick<LedgerPeriod, 'key' | 'share'>, periods: Period[]): Required<Receivable> {
  const rec = [...(r.receipts ?? []), ...(r.waivers ?? [])].find((x) => x.id === id);
  const hit = rec?.periods.filter((k) => resolveKey(periods, k) === period.key) ?? [];
  if (!rec || !hit.length) throw new Error(t('mcp.error.invalidTarget'));
  if (hit.length === rec.periods.length) return removeRecord(r, id);
  const rest = rec.periods.filter((k) => !hit.includes(k));
  const receipts = (r.receipts ?? []).map((x) => {
    if (x.id !== id) return x;
    if (x.opening || period.share == null) return { ...x, periods: rest };
    const unit = 10 ** currencyDecimals(x.currency);
    return { ...x, periods: rest, amount: Math.round((x.amount - period.share) * unit) / unit };
  });
  const waivers = (r.waivers ?? []).map((x) => (x.id === id ? { ...x, periods: rest } : x));
  return { receipts, waivers };
}

/**
 * 改某一期的收款日期、金额和备注（每期弹窗里的编辑）：这笔只抵这一期就原地改；
 * 一笔分几期时把这一期单独拆成一笔新记录（id 由调用方给），其余期和它们分到的金额照旧。
 * 期初结清的一期总是拆出来变成一笔真实收款（金额必填），其余期仍算期初
 */
export function editRecordPeriod(
  r: Receivable,
  id: string,
  period: Pick<LedgerPeriod, 'key' | 'share'>,
  patch: { date: string; amount?: number; note?: string },
  periods: Period[],
  newId: string,
): Required<Receivable> {
  const receipt = (r.receipts ?? []).find((x) => x.id === id);
  const rec = receipt ?? (r.waivers ?? []).find((x) => x.id === id);
  const own = rec?.periods.filter((k) => resolveKey(periods, k) === period.key) ?? [];
  if (!rec || !own.length || (receipt?.opening && patch.amount == null)) throw new Error(t('mcp.error.invalidTarget'));
  const whole = own.length === rec.periods.length && !receipt?.opening;
  const { note: _, opening: __, ...base } = whole ? (rec as Receipt) : { ...(rec as Receipt), id: newId, periods: [period.key] };
  const next = { ...base, date: patch.date, ...(patch.note ? { note: patch.note } : {}) };
  if (!receipt) return putRecord(whole ? r : removeRecordPeriod(r, id, period, periods), 'waiver', next, periods);
  const amount = patch.amount ?? (whole ? receipt.amount : (period.share ?? 0));
  return putRecord(whole ? r : removeRecordPeriod(r, id, period, periods), 'receipt', { ...(next as Receipt), amount }, periods);
}

/**
 * 期初结清：开始记账前就收清了的期（金额不详，不计入收到的钱）。until 及之前、没被别的记录占用的期都算进来；
 * 原来的期初结清整笔替换，until 为空则去掉
 */
export function setOpening(r: Receivable, periods: Period[], until: string | undefined): Required<Receivable> {
  const receipts = (r.receipts ?? []).filter((x) => !x.opening);
  const taken = takenPeriods({ receipts, waivers: r.waivers }, periods);
  const keys = until ? periods.filter((p) => p.from <= until && p.due > 0 && !taken.has(p.key)).map((p) => p.key) : [];
  const opening = keys.length
    ? [{ id: 'opening', date: periods.find((p) => p.key === keys[0])!.from, amount: 0, currency: periods[0].currency, periods: keys, opening: true }]
    : [];
  return { receipts: [...opening, ...receipts], waivers: r.waivers ?? [] };
}
