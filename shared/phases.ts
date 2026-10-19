// 订阅历程的编辑操作：调价、换区/换套餐、断更、续订。全部为纯函数，返回新的订阅对象。
import { addDays, phaseSubs, priceAt } from './billing.ts';
import type { Cycle, Phase, Subscription } from './types.ts';

export interface PlanChange {
  price: number;
  currency: string;
  cycle: Cycle;
  methodId?: string;
  region?: string;
  note?: string;
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
    intro: undefined,
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
  if (s.intro) last.intro = s.intro;
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
