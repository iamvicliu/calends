import type { AppState, Cycle, FxTable, PaymentMethod, Subscription, Payment } from './types.ts';
import { t } from './i18n.ts';
import { chargeValue } from './fx.ts';
import { matchEntries } from './proxy.ts';

// ---------- 日期：全部按 UTC 日计算 ----------

const DAY = 86_400_000;

export function parseDay(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fmtDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function addDays(s: string, n: number): string {
  return fmtDay(parseDay(s) + n * DAY);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseDay(b) - parseDay(a)) / DAY);
}

/** 按月加，保留原始日号并在短月夹紧到月底（1/31 → 2/28 → 3/31） */
export function addMonths(s: string, n: number): string {
  const [y, m, d] = s.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return fmtDay(Date.UTC(ny, nm, Math.min(d, last)));
}

export function todayIn(tz: string, now = Date.now()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  } catch {
    return fmtDay(now);
  }
}

/** 第 k 次扣款日（k=0 即 start） */
export function nthCharge(start: string, cycle: Cycle, k: number): string {
  const n = cycle.every * k;
  switch (cycle.unit) {
    case 'day':
      return addDays(start, n);
    case 'week':
      return addDays(start, n * 7);
    case 'month':
      return addMonths(start, n);
    case 'year':
      return addMonths(start, n * 12);
    default:
      return start;
  }
}

export function cycleDays(c: Cycle): number {
  switch (c.unit) {
    case 'day':
      return c.every;
    case 'week':
      return c.every * 7;
    case 'month':
      return c.every * 30.4375;
    case 'year':
      return c.every * 365.25;
    default:
      return Infinity;
  }
}

export function cycleLabel(c: Cycle): string {
  if (c.unit === 'lifetime') return t('core.cycle.lifetime');
  if (c.every === 1) return t(`core.cycle.every.${c.unit}`);
  if (c.unit === 'month' && c.every === 3) return t('core.cycle.quarterly');
  if (c.unit === 'month' && c.every === 6) return t('core.cycle.halfYearly');
  if (c.unit === 'year' && c.every === 2) return t('core.cycle.biennial');
  return t(`core.cycle.everyN.${c.unit}`, { count: c.every });
}

export function cycleShort(c: Cycle): string {
  if (c.unit === 'lifetime') return t('core.cycle.once');
  const u = { day: 'd', week: 'w', month: 'mo', year: 'yr' }[c.unit];
  return c.every === 1 ? u : `${c.every}${u}`;
}

/** 订阅基本字段的校验：有问题时返回错误文案（后台接口与 MCP 共用） */
export function subError(s: Subscription): string | undefined {
  if (!s.name?.trim()) return t('core.subError.name');
  if (!Number.isFinite(s.price) || s.price < 0) return t('core.subError.price');
  if (!validDay(s.start)) return t('core.subError.start');
  if (!s.cycle || !['day', 'week', 'month', 'year', 'lifetime'].includes(s.cycle.unit) || !Number.isInteger(s.cycle.every) || !(s.cycle.every >= 1))
    return t('core.subError.cycle');
  for (const v of phaseSubs(s)) {
    const error = stopError(v) ?? paymentError(v);
    if (error) return error;
  }
  return undefined;
}

// ---------- 阶段（换区 / 换套餐 / 断更续订） ----------

/**
 * 把多阶段订阅展开成若干个单阶段的「虚拟订阅」，id 不变；无阶段时返回自身。
 * 阶段缺省在下一阶段开始前一天结束；显式的 end 可以晚于下一阶段的开始日（换区后旧区域预付到期前仍在跑），两段在时间上并行。
 */
export function phaseSubs(s: Subscription): Subscription[] {
  if (!s.phases?.length) return [s];
  const sorted = s.phases.slice().sort((a, b) => a.start.localeCompare(b.start));
  // 订阅整体的结束日、暂停日对所有阶段生效：之后才开始的计划阶段作废，跨过它的阶段（包括并行中的旧阶段）在那天截止
  const pausedAt = s.status === 'paused' ? s.pausedAt : undefined;
  const stop = [s.end, pausedAt].filter(Boolean).sort()[0];
  const kept = stop ? sorted.filter((p, i) => i === 0 || p.start <= stop) : sorted;
  const lastStart = kept[kept.length - 1].start;
  return kept.map((p, i) => {
    const last = i === kept.length - 1;
    const natural = p.end ?? (last ? undefined : addDays(kept[i + 1].start, -1));
    // 并行中的旧阶段跑过了暂停日：同样在暂停日停下
    const paused = !last && s.status === 'paused' && !!natural && natural > lastStart && (!s.pausedAt || natural > s.pausedAt);
    // 已退订但没写结束日：与最后一段并行的旧阶段也一并视为退订
    const cancelled = !last && s.status === 'cancelled' && !s.end && !!natural && natural > lastStart;
    return {
      ...s,
      phases: undefined,
      stop: p.stop ?? (last ? s.stop : undefined),
      start: p.start,
      end: s.end && (!natural || natural > s.end) ? s.end : natural,
      price: p.price,
      currency: p.currency,
      cycle: p.cycle,
      methodId: p.methodId,
      region: p.region,
      priceHistory: p.priceHistory,
      intro: p.intro,
      bonus: p.bonus,
      payments: p.payments,
      nextDue: p.nextDue,
      planned: p.planned,
      trialEnd: i === 0 ? s.trialEnd : undefined,
      status: last ? s.status : paused ? 'paused' : cancelled ? 'cancelled' : 'active',
      pausedAt: last || paused ? s.pausedAt : undefined,
    };
  });
}

/** 两段之间空了几天以内不算断更（续费晚一两天、时区差之类） */
export function isGap(prevEnd: string | undefined, nextStart: string): boolean {
  return !!prevEnd && diffDays(prevEnd, nextStart) > 4;
}

/** 把阶段排进并行轨道：与前面仍在跑的段重叠时放到下一条轨道，返回每段的轨道号（0 起）；没有结束日的段视为一直延续 */
export function phaseLanes(vs: Array<{ start: string; end?: string }>): number[] {
  const laneEnd: string[] = [];
  return vs.map((v) => {
    // 同一天交接（旧段结束日 = 新段开始日）是换套餐，不是并行：接在刚结束的那一行，而不是最早空出来的行
    let l = -1;
    laneEnd.forEach((e, i) => {
      if (e <= v.start && (l < 0 || e > laneEnd[l])) l = i;
    });
    if (l < 0) l = laneEnd.length;
    laneEnd[l] = v.end ?? '9999-12-31';
    return l;
  });
}

/** 第 i 段开始前，前面各段最晚跑到哪天；有一直延续的段时返回 undefined。断更看它：并行的旧段还没到期就不算断 */
export function coveredUntil(vs: Array<{ start: string; end?: string }>, i: number): string | undefined {
  let m = '';
  for (const v of vs.slice(0, i)) {
    if (!v.end) return undefined;
    if (v.end > m) m = v.end;
  }
  return m || undefined;
}

/** 实际在订的天数（并行的阶段不重复计，截到 today），以及中间没有任何阶段在跑的断更空档 */
export function servedTime(s: Subscription, today: string): { days: number; gaps: Array<{ from: string; to: string; days: number }> } {
  const vs = phaseSubs(s);
  let days = 0;
  let cursor = '';
  const gaps: Array<{ from: string; to: string; days: number }> = [];
  vs.forEach((v, i) => {
    const until = i > 0 ? coveredUntil(vs, i) : undefined;
    const gapStart = until ? addDays(until, 1) : undefined;
    if (gapStart && gapStart < v.start) gaps.push({ from: gapStart, to: v.start, days: diffDays(gapStart, v.start) });
    if (v.start > today) return;
    const a = cursor > v.start ? cursor : v.start;
    const b = v.end && v.end < today ? addDays(v.end, 1) : today;
    if (b > a) {
      days += diffDays(a, b);
      cursor = b;
    }
  });
  return { days, gaps };
}

/** day 当天同时在跑的所有阶段，按开始日排列（换区后旧区域还没到期时会有多个）；无阶段的订阅总是返回自身 */
export function activePhases(s: Subscription, day: string): Subscription[] {
  if (!s.phases?.length) return [s];
  return phaseSubs(s).filter((v) => v.start <= day && (!v.end || v.end >= day));
}

/** day 当天所处的阶段：并行时取最晚开始的那段；处在断更空档或尚未开始时返回 undefined（无阶段的订阅总是返回自身） */
export function phaseAt(s: Subscription, day: string): Subscription | undefined {
  return activePhases(s, day).pop();
}

/** 当前生效的阶段（并行时取最晚开始的那段）；没有生效的取最近的一个 */
export function currentPhase(s: Subscription, day: string): Subscription {
  const vs = phaseSubs(s);
  return phaseAt(s, day) ?? vs.filter((v) => v.start <= day).pop() ?? vs[0];
}

// ---------- 订阅状态 ----------

/** 订阅在 day 当天是否仍处于计费关系中（不考虑暂停） */
function isLive(s: Subscription, day: string): boolean {
  if (s.status === 'cancelled' && !s.end) return false;
  if (s.end && s.end < day) return false;
  return true;
}

/**
 * 待生效的变更：今天之后才开始的第一个阶段（换区、换支付方式、断更后约好的续订）；
 * 没有阶段的订阅若开始日在未来，返回自身（未来某天才开始订阅、前面有免费期等）
 */
export function upcomingPhase(s: Subscription, today: string): Subscription | undefined {
  if (!s.phases?.length) return s.start > today ? s : undefined;
  return phaseSubs(s).find((v) => v.start > today);
}

export function effectiveStatus(s: Subscription, today: string): 'upcoming' | 'active' | 'trial' | 'paused' | 'ending' | 'ended' | 'terminated' | 'lifetime' {
  if (s.phases?.length) {
    const vs = phaseSubs(s);
    const v = phaseAt(s, today);
    if (v) {
      const st = effectiveStatus(v, today);
      // 已经排好下一阶段（换区 / 换套餐 / 换支付方式，中间空几天也算），不算到期不续
      const next = vs[vs.findIndex((x) => x.start === v.start) + 1];
      return st === 'ending' && next ? 'active' : st;
    }
    if (vs.some((x) => x.start > today)) return vs[0].start > today ? 'upcoming' : 'paused'; // 尚未开始，或断更中已安排续订
    return effectiveStatus(vs[vs.length - 1], today);
  }
  if (s.start > today) return 'upcoming';
  if (s.stop && s.stop.date <= today) return s.stop.kind === 'terminate' ? 'terminated' : 'ended';
  if (s.status === 'terminated' && !s.stop) return 'terminated';
  if (s.cycle.unit === 'lifetime') return 'lifetime';
  if (s.status === 'paused') return 'paused';
  if (!isLive(s, today)) return 'ended';
  if (s.status === 'trial' && s.trialEnd && s.trialEnd > today) return 'trial';
  if (s.end) return 'ending';
  return 'active';
}

export function priceAt(s: Subscription, day: string): number {
  if (s.phases?.length) return priceAt(currentPhase(s, day), day);
  if (s.intro && day < s.intro.until) return s.intro.price;
  let p = s.price;
  const hist = (s.priceHistory ?? []).slice().sort((a, b) => a.from.localeCompare(b.from));
  if (!hist.length) return p;
  // 历史价：取 from<=day 的最后一个；早于首个历史点时用首个点
  p = hist[0].amount;
  for (const h of hist) if (h.from <= day) p = h.amount;
  return p;
}

export interface Charge {
  sub: Subscription;
  date: string;
  amount: number; // 原币
  currency: string;
  /** 预测的未来扣款 */
  projected: boolean;
  kind?: Payment['kind'];
  /** 卡上实际扣的币种与金额 */
  settled?: Payment['settled'];
  note?: string;
}

/** 按周期从 anchor 推算 [from, to] 内、晚于 after 的扣款 */
function schedule(s: Subscription, anchor: string, from: string, to: string, today: string, after = ''): Charge[] {
  const out: Charge[] = [];
  const begin = anchor;
  // 实付或固化记录落在原周期上时继续使用原始日号，避免 1/31 → 2/28 → 3/28。
  const original = s.status === 'trial' && s.trialEnd ? s.trialEnd : s.start;
  if (s.cycle.unit === 'month' || s.cycle.unit === 'year') {
    const k = Math.max(0, Math.round(diffDays(original, anchor) / cycleDays(s.cycle)));
    if (nthCharge(original, s.cycle, k) === anchor) anchor = original;
  }
  const firstPaid = s.status === 'trial' && s.trialEnd ? s.trialEnd : '';
  const stopAt = s.end && s.end < to ? s.end : to;
  const pausedFrom = s.status === 'paused' ? (s.pausedAt ?? today) : undefined;
  // 估算起点 k，避免逐期迭代
  let k = Math.max(0, Math.floor(diffDays(anchor, from) / cycleDays(s.cycle)) - 2);
  for (let guard = 0; guard < 5000; guard++, k++) {
    const d = nthCharge(anchor, s.cycle, k);
    if (d > stopAt) break;
    if (s.status === 'cancelled' && !s.end && d > s.start) break;
    if (d < begin || d < from || d < firstPaid || d <= after) continue;
    if (pausedFrom && d >= pausedFrom) break;
    out.push({ sub: s, date: d, amount: priceAt(s, d), currency: s.currency, projected: d > today });
  }
  return out;
}

/**
 * [from, to] 区间内的扣款（含两端）。暂停中的订阅不产生未来扣款；试用期内的不计费。
 * 有实际扣款记录（payments）时以记录为准，之后从 nextDue（缺省为最后一笔 + 一个周期）开始推算；
 * 只有 nextDue 时，此前按开始日推算，此后从 nextDue 推算（用于扣款日漂移、提前续费等）。
 */
export function chargesBetween(s: Subscription, from: string, to: string, today: string): Charge[] {
  if (s.phases?.length) {
    return phaseSubs(s)
      .flatMap((v) => chargesBetween(v, from, to, today))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  const raw = rawCharges(s, from, to, today);
  const b = s.bonus;
  if (!b || s.cycle.unit === 'lifetime') return raw;
  // 赠送期：期间的预测扣款去掉，之后从赠送结束日重新按周期起算；实际扣款记录照旧保留
  const paid = new Set((s.payments ?? []).map((p) => p.date));
  const lastPaid = (s.payments ?? []).filter((p) => !p.kind).reduce((m, p) => (p.date > m ? p.date : m), '');
  const keep = raw.filter((c) => paid.has(c.date) || c.date < b.from);
  const after = schedule(s, b.until, from, to, today, lastPaid > b.until ? lastPaid : addDays(b.until, -1));
  return keep.concat(after.filter((c) => !paid.has(c.date))).sort((x, y) => x.date.localeCompare(y.date));
}

function rawCharges(s: Subscription, from: string, to: string, today: string): Charge[] {
  const pays = (s.payments ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const renewals = pays.filter((p) => !p.kind);
  if (pays.length) {
    // 扣款失败的记一笔 0，不计入支出，但留在记录里
    const out: Charge[] = pays
      .filter((p) => p.date >= from && p.date <= to && (!s.stop || p.date <= s.stop.date || p.kind === 'refund'))
      .map((p) => ({
        sub: s,
        date: p.date,
        amount: p.kind === 'failed' ? 0 : p.amount,
        currency: s.currency,
        projected: p.date > today,
        kind: p.kind,
        settled: p.kind === 'failed' ? undefined : p.settled,
        note: p.note,
      }));
    if (s.cycle.unit === 'lifetime') return out;
    const last = renewals.at(-1)?.date ?? s.start;
    return out.concat(schedule(s, s.nextDue ?? last, from, to, today, last));
  }
  if (s.cycle.unit === 'lifetime') {
    return s.start >= from && s.start <= to ? [{ sub: s, date: s.start, amount: priceAt(s, s.start), currency: s.currency, projected: s.start > today }] : [];
  }
  const anchor = s.status === 'trial' && s.trialEnd ? s.trialEnd : s.start;
  if (s.nextDue) {
    const before = schedule(s, anchor, from, to < s.nextDue ? to : addDays(s.nextDue, -1), today).filter(
      (c) => diffDays(c.date, s.nextDue!) > cycleDays(s.cycle) / 2,
    );
    return before.concat(schedule(s, s.nextDue, from, to, today));
  }
  return schedule(s, anchor, from, to, today);
}

export function nextCharge(s: Subscription, today: string): string | undefined {
  if (s.cycle.unit === 'lifetime') return s.start > today ? s.start : undefined;
  if (s.stop && s.stop.date <= today) return undefined;
  return chargesBetween(s, today, addMonths(today, 12 * Math.max(1, s.cycle.unit === 'year' ? s.cycle.every : 1) + 1), today).find((c) => !c.kind)?.date;
}

export function lastCharge(s: Subscription, today: string): string | undefined {
  const all = chargesBetween(s, s.start, today, today).filter((c) => !c.kind);
  return all[all.length - 1]?.date;
}

/** 停止前原账期。按原始锚点推算，保留月末夹紧、nextDue、实付与赠送期。 */
export function billingPeriod(s: Subscription, at: string): { from: string; paidThrough: string; paid: number; days: number } {
  if (s.phases?.length) return billingPeriod(currentPhase(s, at), at);
  const open = { ...s, stop: undefined, end: undefined, status: s.status === 'trial' || (s.stop && s.trialEnd) ? ('trial' as const) : ('active' as const) };
  const past = chargesBetween(open, s.start, at, at).filter((c) => !c.kind);
  const last = past.at(-1);
  const from = last?.date ?? s.start;
  const horizon = addDays(at, Math.ceil(cycleDays(s.cycle) === Infinity ? 366 : cycleDays(s.cycle) * 2) + 32);
  const next =
    s.cycle.unit === 'lifetime'
      ? addDays(at, 1)
      : (chargesBetween(open, addDays(at, 1), horizon, at).find((c) => !c.kind)?.date ?? nthCharge(from, s.cycle, 1));
  const paidThrough = addDays(next, -1);
  const paid = last
    ? chargesBetween(open, from, at, at)
        .filter((c) => c.amount > 0 && c.kind !== 'failed')
        .reduce((a, c) => a + c.amount, 0)
    : 0;
  return { from, paidThrough, paid, days: Math.max(1, diffDays(from, next)) };
}

export function stopSummary(s: Subscription, asOf = '9999-12-31') {
  if (!s.stop) return undefined;
  const period = billingPeriod(s, s.stop.date);
  const unusedDays = Math.max(0, diffDays(s.stop.date, s.stop.paidThrough));
  const prorated = (period.paid * unusedDays) / period.days;
  const refunded = (s.payments ?? []).filter((p) => p.kind === 'refund' && p.date >= s.stop!.date && p.date <= asOf).reduce((a, p) => a - p.amount, 0);
  // 商家通常按天退剩余部分：退回金额达到按天折算额即视为全额退款
  const refundStatus: 'none' | 'full' | 'partial' = refunded < 0.005 ? 'none' : refunded + 0.005 >= Math.min(prorated, period.paid) ? 'full' : 'partial';
  const unusedValue = refundStatus === 'full' ? 0 : Math.max(0, prorated - refunded);
  return {
    ...s.stop,
    refunded,
    refundStatus,
    unusedDays,
    unusedValue,
    /** 真正浪费的天数：没退回的钱按日价折算，部分退款时短于 unusedDays */
    wastedDays: prorated > 0 ? Math.round((unusedDays * unusedValue) / prorated) : 0,
    suggestedRefund: Math.round(prorated * 100) / 100,
    paid: period.paid,
  };
}

export function validDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(parseDay(day)) && fmtDay(parseDay(day)) === day;
}

export function stopError(s: Subscription): string | undefined {
  const stop = s.stop;
  if (!stop) return s.status === 'terminated' ? t('mcp.error.needStop') : undefined;
  if (!['cancel', 'terminate'].includes(stop.kind) || !validDay(stop.date) || !validDay(stop.paidThrough)) return t('mcp.error.notDate', { what: 'stop' });
  if (stop.date < s.start) return t('mcp.error.stopBeforeStart');
  if (stop.date > stop.paidThrough) return t('mcp.error.stopAfterPaidThrough');
  if (stop.paidThrough !== billingPeriod(s, stop.date).paidThrough) return t('mcp.error.invalidPaidThrough');
  if (s.end !== stop.date || (stop.kind === 'cancel' && stop.reason)) return t('mcp.error.invalidStop');
  return undefined;
}

/** 所有写入入口共用：逐账期限制退款总额，settled 只影响卡上实退，不改变原币上限。 */
export function paymentError(s: Subscription): string | undefined {
  for (const p of s.payments ?? []) {
    if (!validDay(p.date)) return t('mcp.error.notDate', { what: 'payment.date' });
    if (!Number.isFinite(p.amount) || (p.settled && (!Number.isFinite(p.settled.amount) || !p.settled.currency))) return t('core.subError.price');
    if (p.kind !== 'refund') continue;
    if (p.currency && p.currency !== s.currency) return t('mcp.error.refundCurrency');
    if (p.amount > 0 || (p.settled && p.settled.amount > 0)) return t('mcp.error.invalidRefund');
    const stopPeriod = s.stop && p.date >= s.stop.date;
    const period = billingPeriod(s, stopPeriod ? s.stop!.date : s.end && p.date > s.end ? s.end : p.date);
    const refunded = -(s.payments ?? [])
      .filter((r) => r.kind === 'refund' && r.date >= period.from && (stopPeriod || r.date <= period.paidThrough))
      .reduce((a, r) => a + r.amount, 0);
    if (refunded > period.paid + 0.005) return t('mcp.error.refundExceedsPaid');
  }
  return undefined;
}

// ---------- 金额 ----------

export const FALLBACK_FX: FxTable = {
  base: 'USD',
  fetchedAt: '2026-10-19',
  rates: {
    USD: 1,
    CNY: 7.12,
    HKD: 7.78,
    TWD: 32.1,
    JPY: 151.5,
    EUR: 0.92,
    GBP: 0.77,
    TRY: 41.9,
    NGN: 1530,
    PHP: 58.4,
    INR: 88.6,
    KRW: 1390,
    SGD: 1.3,
    MYR: 4.25,
    THB: 34.2,
    VND: 26300,
    IDR: 16400,
    AUD: 1.52,
    CAD: 1.39,
    BRL: 5.4,
    ARS: 1400,
    EGP: 48.5,
    PKR: 281,
    RUB: 81,
    UAH: 41.5,
    KZT: 535,
    CHF: 0.8,
  },
};

export function convert(amount: number, from: string, to: string, fx: FxTable): number {
  if (from === to) return amount;
  const a = fx.rates[from] ?? FALLBACK_FX.rates[from];
  const b = fx.rates[to] ?? FALLBACK_FX.rates[to];
  if (!a || !b) return NaN;
  return (amount / a) * b;
}

/** 加入日当天生效，退出日当天已离开。 */
export function memberAboard(m: { joined?: string; left?: string }, day: string): boolean {
  return (!m.joined || m.joined <= day) && (!m.left || m.left > day);
}

/** 我实际承担的比例（合租发起人扣除他人份额；加入的成员 price 本就是自己那份） */
export function myShareFactor(s: Subscription, day: string): number {
  // 代付：全额由对方承担
  if (s.proxy) return 0;
  const sh = s.share;
  if (!sh || sh.role !== 'owner' || s.price <= 0) return 1;
  const others = sh.members.reduce((t, m) => t + (m.exempt || !memberAboard(m, day) ? 0 : m.share || 0), 0);
  return Math.max(0, (s.price - others) / s.price);
}

/**
 * 每月折算（原币，全额）。多阶段订阅按 day 当天的阶段算，币种为 currentPhase 的币种；
 * 换区后新旧两段并行时两边都在真实付钱，按两段之和计（另一段按 fx 折成当前段的币种，缺省用内置汇率）
 */
export function monthlyGross(s: Subscription, day?: string, fx: FxTable = FALLBACK_FX): number {
  if (s.phases?.length) {
    if (!day) return monthlyGross(phaseSubs(s).pop()!);
    const cur = currentPhase(s, day);
    const others = activePhases(s, day).filter((v) => v.start !== cur.start);
    return others.reduce((a, v) => a + (convert(monthlyGross(v, day), v.currency, cur.currency, fx) || 0), monthlyGross(cur, day));
  }
  if (s.cycle.unit === 'lifetime') return 0;
  const p = day ? priceAt(s, day) : s.price;
  // 有赠送时长：这一期的钱摊到「周期 + 赠送」上，赠送结束后恢复正常
  const b = s.bonus;
  const days = cycleDays(s.cycle) + (b && (!day || day < b.until) ? Math.max(0, diffDays(b.from, b.until)) : 0);
  return (p * 30.4375) / days;
}

/** 计入每月成本的阶段：day 当天在跑的各段（并行时都算），都不在跑时取最近的一段 */
function billedPhases(s: Subscription, day: string): Subscription[] {
  const vs = activePhases(s, day);
  return vs.length ? vs : [currentPhase(s, day)];
}

/**
 * 每月折算到本位币、我承担的部分；多阶段订阅按 day 所在阶段的价格和币种算，并行的几段相加。
 * 给了 methodId 时只算用这个支付方式付的那几段（钱包按卡统计）
 */
export function monthlyMine(state: AppState, s: Subscription, day: string, methodId?: string): number {
  return billedPhases(s, day)
    .filter((v) => (methodId === undefined || v.methodId === methodId) && ['active', 'ending'].includes(effectiveStatus(v, day)))
    .reduce((a, v) => {
      const m = convert(monthlyGross(v, day), v.currency, state.settings.baseCurrency, state.fx);
      return Number.isFinite(m) ? a + m * myShareFactor(v, day) : a;
    }, 0);
}

export interface Totals {
  mrr: number; // 我承担的部分，正数，展示时加负号
  grossMrr: number;
  recoverMrr: number; // 合租每月回血
  activeCount: number;
}

export function totals(state: AppState, today: string): Totals {
  const base = state.settings.baseCurrency;
  let mrr = 0;
  let gross = 0;
  let count = 0;
  for (const s of state.subscriptions) {
    // 代付是替别人付的钱，不算我的订阅，也不计入数量与总额
    if (s.proxy) continue;
    const st = effectiveStatus(s, today);
    if (st !== 'active' && st !== 'ending' && st !== 'trial') continue;
    // 数量只算正在计费的；试用期不计入数量与金额（和列表的「订阅中」一致）
    if (st !== 'trial') count++;
    // 试用期不计入数量与金额
    if (st === 'trial') continue;
    // 换区后新旧两段并行时两边都在付钱，都计入
    for (const v of billedPhases(s, today)) {
      const m = convert(monthlyGross(v, today), v.currency, base, state.fx);
      if (!Number.isFinite(m)) continue;
      if (!['active', 'ending'].includes(effectiveStatus(v, today))) continue;
      gross += m;
      mrr += m * myShareFactor(v, today);
    }
  }
  return { mrr, grossMrr: gross, recoverMrr: gross - mrr, activeCount: count };
}

// ---------- 余额续航 ----------

export interface Runway {
  method: PaymentMethod;
  /** 今天的估算余额（asOf 之后的扣款已扣除） */
  current: number;
  monthlyDrain: number;
  /** 余额首次不足以支付的那笔扣款 */
  shortfall?: Charge;
  /** 余额还能完整支付的期数 */
  coveredCharges: number;
  runsOutOn?: string;
  /** 撑满未来 12 个月还需充值多少（账户币种） */
  topUp12m: number;
  /** 完整推演，供充值计划使用；明细单独截断 */
  forecast: Array<Charge & { balanceAfter: number; amountInMethod: number }>;
  upcoming: Runway['forecast'];
}

export function runwayFor(method: PaymentMethod, state: AppState, today: string, horizonMonths = 36): Runway | undefined {
  if (method.balance == null) return undefined;
  // 按阶段展开：换区前后可能用不同的支付方式
  const subs = state.subscriptions.flatMap(phaseSubs).filter((s) => s.methodId === method.id);
  const asOf = method.balanceAsOf ?? today;
  const horizon = addMonths(today, Math.max(12, horizonMonths));
  const charges = subs.flatMap((s) => chargesBetween(s, addDays(asOf, 1), horizon, today)).sort((a, b) => a.date.localeCompare(b.date));
  let bal = method.balance;
  const forecast: Runway['forecast'] = [];
  // 按完整历史匹配代付记录，避免窗口外的记录被误配到窗口内。
  const proxyCharges = new Map(
    state.subscriptions
      .filter((s) => s.proxy)
      .map((s) => [
        s.id,
        matchEntries(
          s.proxy!.entries,
          chargesBetween(s, s.start, horizon, today).map((c) => c.date),
        ),
      ]),
  );
  let shortfall: Charge | undefined;
  let covered = 0;
  let current = bal;
  for (const c of charges) {
    const entry = proxyCharges.get(c.sub.id)?.get(c.date);
    const settled =
      c.kind === 'failed' ? undefined : entry?.charged != null ? { amount: entry.charged, currency: entry.chargedCurrency ?? c.currency } : c.settled;
    const amt = chargeValue(state, { ...c, settled }, method.currency);
    if (!Number.isFinite(amt)) continue;
    if (c.date <= today) {
      bal -= amt;
      current = bal;
      continue;
    }
    if (!shortfall && bal - amt < -1e-9) shortfall = c;
    bal -= amt;
    if (!shortfall) covered++;
    forecast.push({ ...c, balanceAfter: bal, amountInMethod: amt });
  }
  const yearOut = addMonths(today, 12);
  const need12 = forecast.filter((c) => c.date <= yearOut).reduce((a, c) => a + c.amountInMethod, 0);
  let monthlyDrain = 0;
  for (const s of subs) {
    const st = effectiveStatus(s, today);
    if (st === 'active' || st === 'ending') monthlyDrain += convert(monthlyGross(s, today), s.currency, method.currency, state.fx) || 0;
  }
  return {
    method,
    current,
    monthlyDrain,
    shortfall,
    coveredCharges: covered,
    runsOutOn: shortfall?.date,
    topUp12m: Math.max(0, need12 - current),
    forecast,
    upcoming: forecast.slice(0, 60),
  };
}

// ---------- 合租 ----------

export interface MemberDue {
  sub: Subscription;
  member: NonNullable<Subscription['share']>['members'][number];
  /** 下一期需要覆盖到的日期 */
  dueFor: string;
  owed: number;
  currency: string;
  periodsOwed: number;
}

/** 最早未覆盖的收费期起点；退出或停止后补收也从原欠款期开始。 */
export function memberUnpaidFrom(s: Subscription, m: NonNullable<Subscription['share']>['members'][number]): string {
  const joined = m.joined ?? s.share?.since ?? s.start;
  const unpaid = m.paidUntil ? addDays(m.paidUntil, 1) : joined;
  return unpaid > joined ? unpaid : joined;
}

export function memberDues(s: Subscription, today: string, collectCurrency = s.currency): MemberDue[] {
  if (!s.share || s.share.role !== 'owner') return [];
  const next = nextCharge(s, today) ?? s.end ?? s.pausedAt ?? today;
  const stopped = [
    s.end,
    s.status === 'paused' ? addDays(s.pausedAt ?? today, -1) : undefined,
    s.status === 'cancelled' && !s.end ? (lastCharge(s, today) ?? s.start) : undefined,
    today,
  ]
    .filter((d): d is string => !!d)
    .sort()[0];
  const stop = stopped;
  const cycleMonths = cycleDays(s.cycle) / 30.4375;
  return s.share.members.map((m) => {
    const currency = m.fee != null ? (m.feeCurrency ?? collectCurrency) : s.currency;
    if (m.exempt) return { sub: s, member: m, dueFor: next, owed: 0, currency, periodsOwed: 0 };
    // 按成员自己的收费周期数欠了几期：从已付至的次日（没收过就从加入那天）起，每个周期开始时就该交；退出后不再计
    const every = m.billEvery ?? Math.max(1, Math.round(cycleMonths));
    const until = m.left && m.left <= stop ? addDays(m.left, -1) : stop;
    let periods = 0;
    if (!m.paidUntil || m.paidUntil < until) {
      const from = memberUnpaidFrom(s, m);
      if (from <= until) {
        periods = 1;
        for (let k = 1; addMonths(from, every * k) <= until; k++) periods++;
      }
    }
    const perCollect = m.fee ?? ((m.share || 0) * every) / cycleMonths;
    return { sub: s, member: m, dueFor: next, owed: periods * perCollect, currency, periodsOwed: periods };
  });
}

/** 标记收款：把 paidUntil 推进一个周期 */
export function advancePaid(s: Subscription, paidUntil: string | undefined, today: string): string {
  const next = nextCharge(s, today) ?? today;
  const startFrom = paidUntil && paidUntil >= addDays(next, -1) ? addDays(paidUntil, 1) : next;
  return addDays(nthCharge(startFrom, s.cycle, 1), -1);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
