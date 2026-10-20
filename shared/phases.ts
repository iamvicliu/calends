// 订阅历程的编辑操作：调价、换区/换套餐、断更、续订。全部为纯函数，返回新的订阅对象。
import { addDays, chargesBetween, phaseSubs, priceAt } from './billing.ts';
import type { Cycle, Payment, Phase, Subscription } from './types.ts';

export interface PlanChange {
  price: number;
  currency: string;
  cycle: Cycle;
  methodId?: string;
  region?: string;
  note?: string;
  /** 只是计划，还没确定 */
  planned?: boolean;
}

/** 当前顶层字段 → 一个阶段 */
function fromTop(s: Subscription, start: string): Phase {
  return {
    start,
    end: s.end,
    price: s.price,
    currency: s.currency,
    cycle: s.cycle,
    methodId: s.methodId,
    region: s.region,
    priceHistory: s.priceHistory,
    intro: s.intro,
    bonus: s.bonus,
    payments: s.payments,
    nextDue: s.nextDue,
  };
}

function phasesOf(s: Subscription): Phase[] {
  return s.phases?.length ? s.phases.map((p) => ({ ...p })).sort((a, b) => a.start.localeCompare(b.start)) : [fromTop(s, s.start)];
}

/** 让顶层字段镜像最后一个阶段，列表、详情等界面直接读顶层即可 */
function mirror(s: Subscription, phases: Phase[]): Subscription {
  const last = phases[phases.length - 1];
  return {
    ...s,
    phases,
    price: last.price,
    currency: last.currency,
    cycle: last.cycle,
    methodId: last.methodId,
    region: last.region,
    priceHistory: undefined,
    // 首期优惠、赠送时长跟着最后一段走，编辑表单才能看到并修改；计费只读阶段，不会重复生效
    intro: last.intro,
    bonus: last.bonus,
    payments: undefined,
    nextDue: undefined,
    end: last.end,
  };
}

/** 从 at 起换区或换套餐：上一阶段在 at 结束，新阶段无缝衔接 */
export function switchPlan(s: Subscription, at: string, next: PlanChange): Subscription {
  const phases = phasesOf(s);
  const last = phases[phases.length - 1];
  if (at <= last.start) throw new Error('生效日期要晚于当前阶段的开始日期');
  last.end = at;
  phases.push({ start: at, ...next });
  return { ...mirror(s, phases), status: 'active', pausedAt: undefined };
}

/** 计划成真：去掉「计划」标记 */
export function confirmPlan(s: Subscription, start: string): Subscription {
  return mirror(s, phasesOf(s).map((p) => (p.start === start ? { ...p, planned: undefined } : p)));
}

/** 不切换了：删掉这个计划阶段，上一阶段就在原定的切换日结束（到期不续） */
export function dropPlan(s: Subscription, start: string): Subscription {
  const phases = phasesOf(s).filter((p) => p.start !== start);
  const last = phases[phases.length - 1];
  last.end = start;
  if (phases.length === 1) {
    const p = phases[0];
    return { ...s, phases: undefined, start: p.start, end: p.end, price: p.price, currency: p.currency, cycle: p.cycle, methodId: p.methodId, region: p.region, priceHistory: p.priceHistory, intro: p.intro, payments: p.payments, nextDue: p.nextDue };
  }
  return mirror({ ...s, start: phases[0].start }, phases);
}

/** 断更后在 at 续订：上一阶段保持原来的结束日，中间的空档就是断更期 */
export function resume(s: Subscription, at: string, next: PlanChange): Subscription {
  const phases = phasesOf(s);
  const last = phases[phases.length - 1];
  if (!last.end) last.end = s.pausedAt && s.pausedAt < at ? s.pausedAt : at;
  if (at < last.end) throw new Error('续订日期不能早于上次结束的日期');
  phases.push({ start: at, ...next });
  return { ...mirror(s, phases), status: 'active', pausedAt: undefined };
}

/** 在当前阶段记一次调价：from 起按新价格扣费 */
export function changePrice(s: Subscription, from: string, amount: number): Subscription {
  if (!s.phases?.length) {
    const hist = s.priceHistory?.length ? [...s.priceHistory] : [{ from: s.start, amount: priceAt(s, addDays(from, -1)) }];
    const merged = hist.filter((p) => p.from !== from).concat({ from, amount }).sort((a, b) => a.from.localeCompare(b.from));
    return { ...s, priceHistory: merged, price: merged[merged.length - 1].amount };
  }
  const phases = phasesOf(s);
  const idx = phases.findIndex((p, i) => p.start <= from && (!phases[i + 1] || phases[i + 1].start > from));
  if (idx < 0) throw new Error('调价日期不在任何阶段内');
  const p = phases[idx];
  const old = phaseSubs({ ...s, phases })[idx];
  const hist = p.priceHistory?.length ? [...p.priceHistory] : [{ from: p.start, amount: priceAt(old, addDays(from, -1)) }];
  p.priceHistory = hist.filter((x) => x.from !== from).concat({ from, amount }).sort((a, b) => a.from.localeCompare(b.from));
  p.price = p.priceHistory[p.priceHistory.length - 1].amount;
  return mirror(s, phases);
}

/** 编辑表单改了顶层字段后，同步回最后一个阶段 */
export function syncLastPhase(s: Subscription): Subscription {
  if (!s.phases?.length) return s;
  const phases = phasesOf(s);
  const last = phases[phases.length - 1];
  Object.assign(last, { price: s.price, currency: s.currency, cycle: s.cycle, methodId: s.methodId, region: s.region, end: s.end });
  last.intro = s.intro;
  last.bonus = s.bonus;
  return { ...s, phases };
}

/** 删除一个阶段（误操作撤回）；只剩一个阶段时退回普通订阅 */
export function removePhase(s: Subscription, index: number): Subscription {
  const phases = phasesOf(s);
  if (phases.length <= 1) return s;
  const [removed] = phases.splice(index, 1);
  // 撤回最后一次换区：上一阶段只是因为换区才结束的，恢复为进行中
  if (index === phases.length && phases[phases.length - 1].end === removed.start) phases[phases.length - 1].end = undefined;
  if (phases.length === 1) {
    const p = phases[0];
    return { ...s, phases: undefined, start: p.start, end: p.end, price: p.price, currency: p.currency, cycle: p.cycle, methodId: p.methodId, region: p.region, priceHistory: p.priceHistory, intro: p.intro, payments: p.payments, nextDue: p.nextDue };
  }
  return mirror({ ...s, start: phases[0].start }, phases);
}

// ---------- 扣款记录（手动编辑） ----------

/** date 落在哪一段：开始日 ≤ date < 结束日；都不在时取它之前最近的一段 */
function phaseIndexAt(phases: Phase[], date: string): number {
  const i = phases.findIndex((p, k) => p.start <= date && date < (p.end ?? phases[k + 1]?.start ?? '9999-12-31'));
  if (i >= 0) return i;
  const before = phases.map((p, k) => [p.start, k] as const).filter(([d]) => d <= date);
  return before.length ? before[before.length - 1][1] : 0;
}

/**
 * 把推算出来的历史扣款固化成记录：一段一旦有了扣款记录，就完全以记录为准，
 * 所以第一次手动改之前，先把到今天为止推算出的扣款写进去，并记下原本的下次扣款日，未来照旧。
 */
function materialize(p: Phase, sub: Subscription, today: string): Phase {
  if (p.payments?.length || p.cycle.unit === 'lifetime') return p;
  const v: Subscription = { ...sub, phases: undefined, ...p, end: p.end };
  const past = chargesBetween(v, p.start, today, today);
  const next = chargesBetween(v, addDays(today, 1), addDays(today, 800), today)[0]?.date;
  return { ...p, payments: past.map((c) => ({ date: c.date, amount: c.amount })), nextDue: p.nextDue ?? next };
}

/** 新增或修改一笔扣款记录；old 为原记录的日期与序号（修改时） */
export function savePayment(s: Subscription, today: string, pay: Payment, old?: { date: string; index: number }): Subscription {
  const phases = phasesOf(s);
  if (old) {
    const oi = phaseIndexAt(phases, old.date);
    phases[oi] = materialize(phases[oi], s, today);
    const list = (phases[oi].payments ?? []).filter((x) => x.date === old.date);
    const target = list[old.index] ?? list[0];
    phases[oi] = { ...phases[oi], payments: (phases[oi].payments ?? []).filter((x) => x !== target) };
  }
  const i = phaseIndexAt(phases, pay.date);
  phases[i] = materialize(phases[i], s, today);
  phases[i] = { ...phases[i], payments: [...(phases[i].payments ?? []), pay].sort((a, b) => a.date.localeCompare(b.date)) };
  return fromPhases(s, phases);
}

/** 删除一笔扣款记录 */
export function deletePayment(s: Subscription, today: string, date: string, index: number): Subscription {
  const phases = phasesOf(s);
  const i = phaseIndexAt(phases, date);
  phases[i] = materialize(phases[i], s, today);
  const list = (phases[i].payments ?? []).filter((x) => x.date === date);
  const target = list[index] ?? list[0];
  phases[i] = { ...phases[i], payments: (phases[i].payments ?? []).filter((x) => x !== target) };
  return fromPhases(s, phases);
}

/** 只有一段时写回顶层（不引入 phases），多段时镜像最后一段 */
function fromPhases(s: Subscription, phases: Phase[]): Subscription {
  if (!s.phases?.length && phases.length === 1) {
    const p = phases[0];
    return { ...s, payments: p.payments, nextDue: p.nextDue };
  }
  return mirror(s, phases);
}
