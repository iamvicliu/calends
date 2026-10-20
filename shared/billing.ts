import type { AppState, Cycle, FxTable, PaymentMethod, Subscription, Payment } from './types.ts';

// ---------- 日期：全部按 UTC 日计算 ----------

const DAY = 86_400_000;

export function parseDay(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fmtDay(t: number): string {
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

export function todayIn(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return fmtDay(Date.now());
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
  if (c.unit === 'lifetime') return '买断';
  const unit = { day: '天', week: '周', month: '月', year: '年' }[c.unit];
  if (c.every === 1) return { day: '每天', week: '每周', month: '每月', year: '每年' }[c.unit];
  if (c.unit === 'month' && c.every === 3) return '每季度';
  if (c.unit === 'month' && c.every === 6) return '每半年';
  if (c.unit === 'year' && c.every === 2) return '每两年';
  return `每 ${c.every} ${unit === '月' ? '个月' : unit}`;
}

export function cycleShort(c: Cycle): string {
  if (c.unit === 'lifetime') return '一次';
  const u = { day: 'd', week: 'w', month: 'mo', year: 'yr' }[c.unit];
  return c.every === 1 ? u : `${c.every}${u}`;
}

/** 订阅基本字段的校验：有问题时返回错误文案（后台接口与 MCP 共用） */
export function subError(s: Subscription): string | undefined {
  if (!s.name?.trim()) return '名称不能为空';
  if (!Number.isFinite(s.price) || s.price < 0) return '价格无效';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.start)) return '开始日期无效';
  if (!s.cycle || !['day', 'week', 'month', 'year', 'lifetime'].includes(s.cycle.unit) || !(s.cycle.every >= 1)) return '周期无效';
  return undefined;
}

// ---------- 阶段（换区 / 换套餐 / 断更续订） ----------

/** 把多阶段订阅展开成若干个单阶段的「虚拟订阅」，id 不变；无阶段时返回自身 */
export function phaseSubs(s: Subscription): Subscription[] {
  if (!s.phases?.length) return [s];
  const sorted = s.phases.slice().sort((a, b) => a.start.localeCompare(b.start));
  // 订阅整体的结束日、暂停日对所有阶段生效：之后才开始的计划阶段作废，跨过它的阶段在那天截止
  const pausedAt = s.status === 'paused' ? s.pausedAt : undefined;
  const stop = [s.end, pausedAt].filter(Boolean).sort()[0];
  const kept = stop ? sorted.filter((p, i) => i === 0 || p.start < stop) : sorted;
  return kept.map((p, i) => {
    const last = i === kept.length - 1;
    const natural = p.end ?? (last ? undefined : kept[i + 1].start);
    return {
      ...s,
      phases: undefined,
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
      status: last ? s.status : 'active',
      pausedAt: last ? s.pausedAt : undefined,
    };
  });
}

/** 两段之间空了几天以内不算断更（续费晚一两天、时区差之类） */
export function isGap(prevEnd: string | undefined, nextStart: string): boolean {
  return !!prevEnd && diffDays(prevEnd, nextStart) > 3;
}

/** day 当天所处的阶段；处在断更空档或尚未开始时返回 undefined（无阶段的订阅总是返回自身） */
export function phaseAt(s: Subscription, day: string): Subscription | undefined {
  const vs = phaseSubs(s);
  if (vs.length === 1 && !s.phases?.length) return vs[0];
  return vs.find((v) => v.start <= day && (!v.end || v.end > day));
}

/** 当前生效的阶段；没有生效的取最近的一个 */
export function currentPhase(s: Subscription, day: string): Subscription {
  const vs = phaseSubs(s);
  return phaseAt(s, day) ?? vs.filter((v) => v.start <= day).pop() ?? vs[0];
}

// ---------- 订阅状态 ----------

/** 订阅在 day 当天是否仍处于计费关系中（不考虑暂停） */
export function isLive(s: Subscription, day: string): boolean {
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

export function effectiveStatus(s: Subscription, today: string): 'upcoming' | 'active' | 'trial' | 'paused' | 'ending' | 'ended' | 'lifetime' {
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
  if (s.cycle.unit === 'lifetime') return 'lifetime';
  if (s.status === 'paused') return 'paused';
  if (!isLive(s, today)) return 'ended';
  if (s.status === 'trial' && s.trialEnd && s.trialEnd >= today) return 'trial';
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
  const firstPaid = s.status === 'trial' && s.trialEnd ? s.trialEnd : '';
  const stopAt = s.end && s.end < to ? s.end : to;
  const pausedFrom = s.status === 'paused' ? (s.pausedAt ?? today) : undefined;
  // 估算起点 k，避免逐期迭代
  let k = Math.max(0, Math.floor(diffDays(anchor, from) / cycleDays(s.cycle)) - 2);
  for (let guard = 0; guard < 5000; guard++, k++) {
    const d = nthCharge(anchor, s.cycle, k);
    if (d > stopAt) break;
    if (d < from || d < firstPaid || d <= after) continue;
    if (s.end && d >= s.end && d !== s.start) break; // 到期当天不再扣
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
  const lastPaid = (s.payments ?? []).reduce((m, p) => (p.date > m ? p.date : m), '');
  const keep = raw.filter((c) => paid.has(c.date) || c.date < b.from);
  const after = schedule(s, b.until, from, to, today, lastPaid > b.until ? lastPaid : addDays(b.until, -1));
  return keep.concat(after.filter((c) => !paid.has(c.date))).sort((x, y) => x.date.localeCompare(y.date));
}

function rawCharges(s: Subscription, from: string, to: string, today: string): Charge[] {
  const pays = (s.payments ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (pays.length) {
    // 扣款失败的记一笔 0，不计入支出，但留在记录里
    const out: Charge[] = pays.filter((p) => p.date >= from && p.date <= to).map((p) => ({ sub: s, date: p.date, amount: p.kind === 'failed' ? 0 : p.amount, currency: s.currency, projected: p.date > today, kind: p.kind, settled: p.settled, note: p.note }));
    if (s.cycle.unit === 'lifetime') return out;
    const last = pays[pays.length - 1].date;
    return out.concat(schedule(s, s.nextDue ?? nthCharge(last, s.cycle, 1), from, to, today, last));
  }
  if (s.cycle.unit === 'lifetime') {
    return s.start >= from && s.start <= to ? [{ sub: s, date: s.start, amount: priceAt(s, s.start), currency: s.currency, projected: s.start > today }] : [];
  }
  if (s.nextDue) {
    const before = schedule(s, s.start, from, to < s.nextDue ? to : addDays(s.nextDue, -1), today).filter((c) => diffDays(c.date, s.nextDue!) > cycleDays(s.cycle) / 2);
    return before.concat(schedule(s, s.nextDue, from, to, today));
  }
  return schedule(s, s.start, from, to, today);
}

export function nextCharge(s: Subscription, today: string): string | undefined {
  if (s.cycle.unit === 'lifetime') return s.start > today ? s.start : undefined;
  return chargesBetween(s, today, addMonths(today, 12 * Math.max(1, s.cycle.unit === 'year' ? s.cycle.every : 1) + 1), today)[0]?.date;
}

export function lastCharge(s: Subscription, today: string): string | undefined {
  const all = chargesBetween(s, s.start, today, today);
  return all[all.length - 1]?.date;
}

// ---------- 金额 ----------

export const FALLBACK_FX: FxTable = {
  base: 'USD',
  fetchedAt: '2026-10-19',
  rates: { USD: 1, CNY: 7.12, HKD: 7.78, TWD: 32.1, JPY: 151.5, EUR: 0.92, GBP: 0.77, TRY: 41.9, NGN: 1530, PHP: 58.4, INR: 88.6, KRW: 1390, SGD: 1.3, MYR: 4.25, THB: 34.2, VND: 26300, IDR: 16400, AUD: 1.52, CAD: 1.39, BRL: 5.4, ARS: 1400, EGP: 48.5, PKR: 281, RUB: 81, UAH: 41.5, KZT: 535, CHF: 0.8 },
};

export function convert(amount: number, from: string, to: string, fx: FxTable): number {
  if (from === to) return amount;
  const a = fx.rates[from] ?? FALLBACK_FX.rates[from];
  const b = fx.rates[to] ?? FALLBACK_FX.rates[to];
  if (!a || !b) return NaN;
  return (amount / a) * b;
}

/** 我实际承担的比例（合租发起人扣除他人份额；加入的成员 price 本就是自己那份） */
export function myShareFactor(s: Subscription, day?: string): number {
  // 代付：全额由对方承担
  if (s.proxy) return 0;
  const sh = s.share;
  if (!sh || sh.role !== 'owner' || s.price <= 0) return 1;
  // 给了日期就按那天在不在车上算（历史统计用）；不给日期按现在的成员算
  const aboard = (m: (typeof sh.members)[number]) => (day ? (!m.left || m.left > day) && (!m.joined || m.joined <= day) : !m.left);
  const others = sh.members.reduce((t, m) => t + (m.exempt || !aboard(m) ? 0 : m.share || 0), 0);
  return Math.max(0, (s.price - others) / s.price);
}

/** 每月折算（原币，全额） */
export function monthlyGross(s: Subscription, day?: string): number {
  if (s.phases?.length) return monthlyGross(day ? currentPhase(s, day) : phaseSubs(s).pop()!, day);
  if (s.cycle.unit === 'lifetime') return 0;
  const p = day ? priceAt(s, day) : s.price;
  // 有赠送时长：这一期的钱摊到「周期 + 赠送」上，赠送结束后恢复正常
  const b = s.bonus;
  const days = cycleDays(s.cycle) + (b && (!day || day < b.until) ? Math.max(0, diffDays(b.from, b.until)) : 0);
  return (p * 30.4375) / days;
}

/** 每月折算到本位币、我承担的部分；多阶段订阅按 day 所在阶段的价格和币种算 */
export function monthlyMine(state: AppState, s: Subscription, day: string): number {
  const v = currentPhase(s, day);
  const m = convert(monthlyGross(v, day), v.currency, state.settings.baseCurrency, state.fx);
  return Number.isFinite(m) ? m * myShareFactor(v) : 0;
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
    count++;
    // 试用期计入数量，不计入金额
    if (st === 'trial') continue;
    const v = currentPhase(s, today);
    const m = convert(monthlyGross(v, today), v.currency, base, state.fx);
    if (!Number.isFinite(m)) continue;
    gross += m;
    mrr += m * myShareFactor(s);
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
  upcoming: Array<Charge & { balanceAfter: number; amountInMethod: number }>;
}

export function runwayFor(method: PaymentMethod, state: AppState, today: string, horizonMonths = 36): Runway | undefined {
  if (method.balance == null) return undefined;
  // 按阶段展开：换区前后可能用不同的支付方式
  const subs = state.subscriptions.flatMap(phaseSubs).filter((s) => s.methodId === method.id);
  const asOf = method.balanceAsOf ?? today;
  const horizon = addMonths(today, horizonMonths);
  const charges = subs
    .flatMap((s) => chargesBetween(s, addDays(asOf, 1), horizon, today))
    .sort((a, b) => a.date.localeCompare(b.date));
  let bal = method.balance;
  const upcoming: Runway['upcoming'] = [];
  let shortfall: Charge | undefined;
  let covered = 0;
  let current = bal;
  for (const c of charges) {
    const amt = convert(c.amount, c.currency, method.currency, state.fx);
    if (!Number.isFinite(amt)) continue;
    if (c.date <= today) {
      bal -= amt;
      current = bal;
      continue;
    }
    if (!shortfall && bal - amt < -1e-9) shortfall = c;
    bal -= amt;
    if (!shortfall) covered++;
    if (upcoming.length < 60) upcoming.push({ ...c, balanceAfter: bal, amountInMethod: amt });
  }
  const yearOut = addMonths(today, 12);
  const need12 = upcoming.filter((c) => c.date <= yearOut).reduce((a, c) => a + c.amountInMethod, 0);
  let monthlyDrain = 0;
  for (const s of subs) {
    const st = effectiveStatus(s, today);
    if (st === 'active' || st === 'ending') monthlyDrain += convert(monthlyGross(s, today), s.currency, method.currency, state.fx) || 0;
  }
  return { method, current, monthlyDrain, shortfall, coveredCharges: covered, runsOutOn: shortfall?.date, topUp12m: Math.max(0, need12 - current), upcoming };
}

// ---------- 合租 ----------

export interface MemberDue {
  sub: Subscription;
  member: NonNullable<Subscription['share']>['members'][number];
  /** 下一期需要覆盖到的日期 */
  dueFor: string;
  owed: number;
  periodsOwed: number;
}

export function memberDues(s: Subscription, today: string): MemberDue[] {
  if (!s.share || s.share.role !== 'owner') return [];
  const next = nextCharge(s, today);
  if (!next) return [];
  const cycleMonths = cycleDays(s.cycle) / 30.4375;
  return s.share.members.map((m) => {
    if (m.exempt) return { sub: s, member: m, dueFor: next, owed: 0, periodsOwed: 0 };
    // 按成员自己的收费周期数欠了几期：从已付至的次日（没收过就从加入那天）起，每个周期开始时就该交；退出后不再计
    const every = m.billEvery ?? Math.max(1, Math.round(cycleMonths));
    const until = m.left && m.left <= today ? addDays(m.left, -1) : today;
    let periods = 0;
    if (!m.paidUntil || m.paidUntil < until) {
      const from = m.paidUntil ? addDays(m.paidUntil, 1) : (m.joined ?? s.share!.since ?? today);
      if (from <= until) {
        periods = 1;
        for (let d = addMonths(from, every); d <= until && periods < 120; d = addMonths(d, every)) periods++;
      }
    }
    const perCollect = ((m.share || 0) * every) / cycleMonths;
    return { sub: s, member: m, dueFor: next, owed: periods * perCollect, periodsOwed: periods };
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
