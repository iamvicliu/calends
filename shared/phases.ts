// 订阅历程的编辑操作：调价、换区/换套餐、断更、续订。全部为纯函数，返回新的订阅对象。
import { addDays, billingPeriod, chargesBetween, currentPhase, effectiveStatus, phaseSubs, priceAt, subError, validDay } from './billing.ts';
import type { Cycle, Payment, Phase, Stop, Subscription } from './types.ts';
import { t } from './i18n.ts';

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
    stop: s.stop,
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
    end: endOf(phases),
    stop: last.stop,
  };
}

/** 整个订阅的结束日：最后一段一直延续时没有；否则取各段里最晚的结束日（并行的旧段可能比最后一段跑得更久） */
function endOf(phases: Phase[]): string | undefined {
  const last = phases[phases.length - 1];
  if (!last.end) return undefined;
  return phases.reduce((m, p) => (p.end && p.end > m ? p.end : m), last.end);
}

/**
 * 从 at 起换区或换套餐：上一阶段默认在 at 前一天结束，新阶段无缝衔接；
 * 给了 keepUntil 时上一阶段继续跑到那天（比如旧区域已预付到月底），两段并行、两边都照常计费
 */
export function switchPlan(s: Subscription, at: string, next: PlanChange, keepUntil?: string): Subscription {
  const phases = phasesOf(s);
  const last = phases[phases.length - 1];
  if (at <= last.start) throw new Error(t('core.phase.switchTooEarly'));
  if (keepUntil && keepUntil <= at) throw new Error(t('core.phase.keepTooEarly'));
  if (last.stop && at <= last.stop.date) throw new Error(t('core.phase.resumeTooEarly'));
  if (!last.stop) last.end = keepUntil ?? addDays(at, -1);
  phases.push({ start: at, ...next });
  return { ...mirror(s, phases), status: 'active', pausedAt: undefined };
}

/**
 * 补一段更早的历史：插在第一段之前，从 at 起；默认一直用到原来第一段开始（无缝），
 * 给了 until 时在那天结束，中间算断档。比如先买断、后来才改订阅，买断那段是后补的
 */
export function prependPlan(s: Subscription, at: string, prev: PlanChange, until?: string): Subscription {
  const phases = phasesOf(s);
  const first = phases[0];
  if (at >= first.start) throw new Error(t('core.phase.prependTooLate'));
  if (until && (until <= at || until > first.start)) throw new Error(t('core.phase.prependUntil'));
  phases.unshift({ start: at, end: until ?? addDays(first.start, -1), ...prev });
  return mirror({ ...s, start: at }, phases);
}

/** 计划成真：去掉「计划」标记 */
export function confirmPlan(s: Subscription, start: string): Subscription {
  return mirror(
    s,
    phasesOf(s).map((p) => (p.start === start ? { ...p, planned: undefined } : p)),
  );
}

/** 不切换了：删掉这个计划阶段，上一阶段就在原定的切换日结束（到期不续）；原本就打算并行跑得更久的，保留它自己的结束日 */
export function dropPlan(s: Subscription, start: string): Subscription {
  const phases = phasesOf(s).filter((p) => p.start !== start);
  const last = phases[phases.length - 1];
  if (!last.end || last.end < start) last.end = addDays(start, -1);
  if (phases.length === 1) {
    const p = phases[0];
    return {
      ...s,
      phases: undefined,
      start: p.start,
      end: p.end,
      stop: p.stop,
      price: p.price,
      currency: p.currency,
      cycle: p.cycle,
      methodId: p.methodId,
      region: p.region,
      priceHistory: p.priceHistory,
      intro: p.intro,
      payments: p.payments,
      nextDue: p.nextDue,
    };
  }
  return mirror({ ...s, start: phases[0].start }, phases);
}

/** 断更后在 at 续订：上一阶段保持原来的结束日，中间的空档就是断更期 */
export function resume(s: Subscription, at: string, next: PlanChange): Subscription {
  const phases = phasesOf(s);
  const last = phases[phases.length - 1];
  if (!last.end) last.end = addDays(s.pausedAt && s.pausedAt < at ? s.pausedAt : at, -1);
  if (at <= last.end) throw new Error(t('core.phase.resumeTooEarly'));
  phases.push({ start: at, ...next });
  return { ...mirror(s, phases), status: 'active', pausedAt: undefined };
}

/** 在当前阶段记一次调价：from 起按新价格扣费 */
export function changePrice(s: Subscription, from: string, amount: number): Subscription {
  if (!s.phases?.length) {
    const hist = s.priceHistory?.length ? [...s.priceHistory] : [{ from: s.start, amount: priceAt(s, addDays(from, -1)) }];
    const merged = hist
      .filter((p) => p.from !== from)
      .concat({ from, amount })
      .sort((a, b) => a.from.localeCompare(b.from));
    return { ...s, priceHistory: merged, price: merged[merged.length - 1].amount };
  }
  const phases = phasesOf(s);
  const idx = phases.findIndex((p, i) => p.start <= from && (!phases[i + 1] || phases[i + 1].start > from));
  if (idx < 0) throw new Error(t('core.phase.priceOutOfRange'));
  const p = phases[idx];
  const old = phaseSubs({ ...s, phases })[idx];
  const hist = p.priceHistory?.length ? [...p.priceHistory] : [{ from: p.start, amount: priceAt(old, addDays(from, -1)) }];
  p.priceHistory = hist
    .filter((x) => x.from !== from)
    .concat({ from, amount })
    .sort((a, b) => a.from.localeCompare(b.from));
  p.price = p.priceHistory[p.priceHistory.length - 1].amount;
  return mirror(s, phases);
}

/** 阶段 i 最后一个服务日（含）；无缝切换在下一段开始前一天结束。 */
const endAt = (phases: Phase[], i: number) => phases[i].end ?? (phases[i + 1] ? addDays(phases[i + 1].start, -1) : '9999-12-31');

/**
 * 编辑表单对应的阶段：今天所在的阶段（还没开始的计划阶段不算；并行时取最晚开始的，与 currentPhase 一致），
 * 今天不在任何阶段里时取最近开始的，都没开始时取第一个
 */
function editIndex(phases: Phase[], today: string): number {
  const live = phases.findLastIndex((p, i) => p.start <= today && today <= endAt(phases, i));
  return live >= 0
    ? live
    : Math.max(
        0,
        phases.findLastIndex((p) => p.start <= today),
      );
}

/** 打开编辑表单时，顶层字段换成当前阶段的，避免把未生效的计划阶段当成现在的样子 */
export function toEditForm(s: Subscription, today: string): Subscription {
  if (!s.phases?.length) return s;
  const phases = phasesOf(s);
  const p = phases[editIndex(phases, today)];
  return { ...s, price: p.price, currency: p.currency, cycle: p.cycle, methodId: p.methodId, region: p.region, intro: p.intro, bonus: p.bonus };
}

/**
 * 编辑表单改了顶层字段后，同步回当前阶段；结束日属于整个订阅，改了才写到最后一个阶段
 * （并行的旧段各有自己的结束日，没改结束日时不动它们；订阅的结束日对所有阶段封顶）
 */
export function syncPhase(s: Subscription, today: string): Subscription {
  if (!s.phases?.length) return s;
  const phases = phasesOf(s);
  Object.assign(phases[editIndex(phases, today)], {
    price: s.price,
    currency: s.currency,
    cycle: s.cycle,
    methodId: s.methodId,
    region: s.region,
    intro: s.intro,
    bonus: s.bonus,
  });
  if (s.end !== endOf(phases)) phases[phases.length - 1].end = s.end;
  phases[phases.length - 1].stop = s.stop;
  return { ...mirror(s, phases), end: s.end };
}

/**
 * 改某一段的结束日（按开始日定位）：留空回到缺省（下一段开始日；最后一段为一直延续）。
 * 晚于下一段的开始日即为并行，早于则中间是断更；最后一段的结束日就是整个订阅的结束日
 */
export function setPhaseEnd(s: Subscription, start: string, end: string | undefined): Subscription {
  if (end && end < start) throw new Error(t('core.phase.endTooEarly'));
  if (!s.phases?.length) return { ...s, end };
  const phases = phasesOf(s);
  const p = phases.find((x) => x.start === start);
  if (!p) throw new Error(t('core.phase.priceOutOfRange'));
  p.end = end;
  return mirror(s, phases);
}

/** 删除一个阶段（误操作撤回）；只剩一个阶段时退回普通订阅 */
export function removePhase(s: Subscription, index: number): Subscription {
  const phases = phasesOf(s);
  if (phases.length <= 1) return s;
  const [removed] = phases.splice(index, 1);
  // 撤回最后一次换区：上一阶段只是因为换区才结束（或换区时选了继续跑到某天）的，恢复为进行中
  const prev = phases[phases.length - 1];
  if (index === phases.length && !prev.stop && prev.end && prev.end >= addDays(removed.start, -1)) prev.end = undefined;
  if (phases.length === 1) {
    const p = phases[0];
    return {
      ...s,
      phases: undefined,
      start: p.start,
      end: p.end,
      stop: p.stop,
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
    };
  }
  return mirror({ ...s, start: phases[0].start }, phases);
}

// ---------- 扣款记录（手动编辑） ----------

/**
 * date 落在哪一段：开始日 ≤ date < 结束日；都不在时取它之前最近的一段。
 * 给了 phase（阶段开始日）就用那段；两段并行时，找已有记录（existing）优先取那天确实有扣款的一段，否则取最晚开始的一段
 */
function phaseIndexAt(phases: Phase[], date: string, sub?: Subscription, phase?: string, existing = false): number {
  const pick = phase ? phases.findIndex((p) => p.start === phase) : -1;
  if (pick >= 0) return pick;
  const live = phases.flatMap((p, k) => (p.start <= date && date < endAt(phases, k) ? [k] : []));
  if (existing && sub && live.length > 1) {
    const has =
      live.find((k) => (phases[k].payments ?? []).some((x) => x.date === date)) ??
      live.find(
        (k) => !phases[k].payments?.length && chargesBetween({ ...sub, phases: undefined, ...phases[k], end: endAt(phases, k) }, date, date, date).length,
      );
    if (has != null) return has;
  }
  if (live.length) return live[live.length - 1];
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
  const next = p.stop ? addDays(p.stop.paidThrough, 1) : chargesBetween(v, addDays(today, 1), addDays(today, 800), today).find((c) => !c.kind)?.date;
  // 到期前不会再扣（比如并行中快到期的旧段）：下次扣款记为结束日，删掉最后一笔也不会被重新推算出来
  return { ...p, payments: past.map((c) => ({ date: c.date, amount: c.amount })), nextDue: p.nextDue ?? next ?? p.end };
}

/** 新增或修改一笔扣款记录；old 为原记录的日期与序号（修改时） */
export function savePayment(s: Subscription, today: string, pay: Payment, old?: { date: string; index: number }, phase?: string): Subscription {
  const phases = phasesOf(s);
  let originalPhase: number | undefined;
  if (old) {
    const oi = phaseIndexAt(phases, old.date, s, phase, true);
    phases[oi] = materialize(phases[oi], s, today);
    originalPhase = oi;
    const list = (phases[oi].payments ?? []).filter((x) => x.date === old.date);
    const target = list[old.index];
    if (!target) throw new Error(t('mcp.error.invalidTarget'));
    phases[oi] = { ...phases[oi], payments: (phases[oi].payments ?? []).filter((x) => x !== target) };
  }
  // 指定了阶段（并行时选的那一段，或原记录所在的段）且日期仍在那段里：记在那段；否则按日期归段
  const keep = phase ? phases.findIndex((p, k) => p.start === phase && p.start <= pay.date && (pay.kind === 'refund' || pay.date < endAt(phases, k))) : -1;
  const i = keep >= 0 ? keep : phaseIndexAt(phases, pay.date);
  // The original phase was already materialized before removal. Repeating it after
  // removing its sole payment would recreate the estimate being replaced.
  if (i !== originalPhase) phases[i] = materialize(phases[i], s, today);
  phases[i] = { ...phases[i], payments: [...(phases[i].payments ?? []), pay].sort((a, b) => a.date.localeCompare(b.date)) };
  const next = fromPhases(s, phases);
  const error = subError(next);
  if (error) throw new Error(error);
  return next;
}

/** 删除一笔扣款记录 */
export function deletePayment(s: Subscription, today: string, date: string, index: number, phase?: string): Subscription {
  const phases = phasesOf(s);
  const i = phaseIndexAt(phases, date, s, phase, true);
  phases[i] = materialize(phases[i], s, today);
  const list = (phases[i].payments ?? []).filter((x) => x.date === date);
  const target = list[index];
  if (!target) throw new Error(t('mcp.error.invalidTarget'));
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

export interface StopRefund {
  amount: number;
  date?: string;
  currency?: string;
  settled?: { amount: number; currency: string };
}

/** 提前停止：撤销所有后续阶段，保留已发生的扣款与原已付服务期。 */
export function stopSubscription(s: Subscription, today: string, kind: Stop['kind'], at = today, reason?: string, refund?: StopRefund): Subscription {
  if (!validDay(at)) throw new Error(t('mcp.error.notDate', { what: 'at' }));
  if (at < s.start) throw new Error(t('mcp.error.stopBeforeStart'));
  if (s.stop || ['ended', 'terminated'].includes(effectiveStatus(s, today))) throw new Error(t('mcp.error.subscriptionEnded'));
  const current = currentPhase(s, at);
  if (at < current.start) throw new Error(t('mcp.error.stopBeforeStart'));
  const period = billingPeriod(current, at < today ? at : today);
  if (at > period.paidThrough) throw new Error(t('mcp.error.stopAfterPaidThrough'));
  const stop: Stop = { kind, date: at, paidThrough: period.paidThrough, reason: kind === 'terminate' ? reason?.trim() || undefined : undefined };
  let next: Subscription;
  if (s.phases?.length) {
    const phases = phasesOf(s).filter((p) => p.start <= at);
    for (const p of phases) {
      if (!p.end || p.end > at) p.end = at;
    }
    const target = phases.find((p) => p.start === current.start)!;
    target.stop = stop;
    target.end = at;
    next = { ...mirror(s, phases), end: at, stop };
  } else next = { ...s, end: at, stop };
  next = { ...next, status: kind === 'terminate' ? 'terminated' : 'cancelled', pausedAt: undefined };
  if (refund) {
    if (!Number.isFinite(refund.amount) || refund.amount < 0) throw new Error(t('mcp.error.invalidRefund'));
    if (refund.currency && refund.currency !== current.currency) throw new Error(t('mcp.error.refundCurrency'));
    const date = refund.date ?? at;
    if (date < at) throw new Error(t('mcp.error.refundBeforeStop'));
    next = savePayment(
      next,
      today,
      {
        date,
        amount: -refund.amount,
        currency: current.currency,
        kind: 'refund',
        settled: refund.settled ? { ...refund.settled, amount: -Math.abs(refund.settled.amount) } : undefined,
      },
      undefined,
      current.start,
    );
  }
  const error = subError(next);
  if (error) throw new Error(error);
  return next;
}

export function reactivate(s: Subscription, today: string): Subscription {
  if (s.stop?.kind === 'terminate' || effectiveStatus(s, today) === 'terminated') throw new Error(t('mcp.error.terminatedReactivate'));
  const phases = s.phases?.map((p, i, all) => (i === all.length - 1 ? { ...p, end: undefined, stop: undefined } : p));
  return { ...s, phases, status: 'active', pausedAt: undefined, end: undefined, stop: undefined };
}

/** API 与 MCP 共用的状态迁移约束；重新订阅必须保留原停用阶段并新增阶段。 */
export function statusChangeError(previous: Subscription | undefined, next: Subscription, today: string): string | undefined {
  const error = subError(next);
  if (error) return error;
  if (previous && !previous.stop && next.stop) {
    if (['ended', 'terminated'].includes(effectiveStatus(previous, today))) return t('mcp.error.subscriptionEnded');
    const period = billingPeriod(currentPhase(previous, next.stop.date), next.stop.date < today ? next.stop.date : today);
    if (next.stop.date > period.paidThrough) return t('mcp.error.stopAfterPaidThrough');
  }
  if (previous && (previous.stop?.kind === 'terminate' || previous.status === 'terminated') && next.stop?.kind !== 'terminate') {
    const old = phaseSubs(previous).at(-1)!;
    const history = next.phases?.find((p) => p.start === old.start);
    const newPhase = next.phases?.some((p) => p.start > old.end!);
    if (history?.stop?.date !== old.stop?.date || history?.end !== old.end) return t('mcp.error.terminatedReactivate');
    if (!history?.stop || history.stop.kind !== 'terminate' || !newPhase) return t('mcp.error.terminatedReactivate');
  }
  return undefined;
}

/** 到期不续：只有 end，没有 stop；撤销结束日之后的阶段。 */
export function cancelAtEnd(s: Subscription, at: string, today: string): Subscription {
  if (s.stop || ['ended', 'terminated'].includes(effectiveStatus(s, today))) throw new Error(t('mcp.error.subscriptionEnded'));
  if (!validDay(at)) throw new Error(t('mcp.error.notDate', { what: 'at' }));
  if (at < s.start) throw new Error(t('mcp.error.stopBeforeStart'));
  let c = s;
  for (const p of (s.phases ?? []).filter((p) => p.start > at).sort((a, b) => b.start.localeCompare(a.start))) c = dropPlan(c, p.start);
  return syncPhase({ ...toEditForm(c, today), status: 'cancelled', end: at, stop: undefined }, today);
}

/** Correct one existing phase without replacing unrelated phases or recorded payments. */
export function editPhase(s: Subscription, start: string, patch: Partial<Phase>): Subscription {
  const phases = phasesOf(s);
  const index = phases.findIndex((p) => p.start === start);
  if (index < 0) throw new Error(t('mcp.error.invalidTarget'));
  const p = { ...phases[index] } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete p[key];
    else p[key] = value;
  }
  phases[index] = p as unknown as Phase;
  phases.sort((a, b) => a.start.localeCompare(b.start));
  if (new Set(phases.map((p) => p.start)).size !== phases.length) throw new Error(t('mcp.error.invalidTarget'));
  for (const phase of phases) {
    const error = subError({ ...s, ...phase, phases: undefined });
    if (error) throw new Error(error);
    if (phase.end && phase.end < phase.start) throw new Error(t('core.phase.endTooEarly'));
  }
  return mirror({ ...s, start: phases[0].start }, phases);
}
