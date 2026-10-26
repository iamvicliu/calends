import { chargesTotal, convertedTotal, emptyTotal, scaleTotal, sumTotals } from './fx-total.ts';
// 合租的账：一年的成本与预计收入、从开始合租起实际付出与收回；成员每次该收多少。
// 后台合租页与 MCP / AI 助手共用，算出来的数一致。
import {
  chargesBetween,
  currentPhase,
  cycleDays,
  monthlyGross,
  memberAboard,
  effectiveStatus,
  memberBillMonths,
  LIFETIME_BILL_MONTHS,
  memberRate,
  addMonths,
  collectionAnchor,
  memberLedger,
  diffDays,
  collectCurrencyOf,
  DAYS_PER_MONTH,
  memberSince,
  isStopped,
} from './billing.ts';
import { chargeBaseOrNaN, convertOn, toBaseAt, toBaseOrNaN } from './fx.ts';
import { yearCost } from './metrics.ts';
import { currencyDecimals } from './format.ts';
import { isSettled, type Period } from './receivables.ts';
import type { AppState, CarRule, MemberFeePoint, ShareMember, Subscription } from './types.ts';

/** 成员实际交来、退回的钱：期初结清没有金额，不算；退款作为负数。不改变各期是否结清 */
export function memberCashFlows(m: ShareMember) {
  return [
    ...(m.receipts ?? []).filter((r) => !r.opening).map((r) => ({ ...r, kind: 'receipt' as const })),
    ...(m.leaveRefund ? [{ ...m.leaveRefund, amount: -m.leaveRefund.amount, kind: 'refund' as const }] : []),
  ];
}

/** 实收、实退按各自日期换算；缺汇率保留不可用状态。 */
export function memberFlowValue(state: AppState, p: { amount: number; currency: string; date: string }, to = state.settings.baseCurrency) {
  return convertOn(p.amount, p.currency, to, p.date, state.fxHistory, state.fx);
}

/** 清空退出日时一并清除退款，其他历史不动。 */
export function updateMemberLeave(m: ShareMember, patch: Partial<ShareMember>): ShareMember {
  const next = { ...m, ...patch };
  return next.left ? next : { ...next, leaveRefund: undefined };
}

/**
 * 退出时建议退多少：收过钱的期里，退出日（当天已不在车上）之后没用的天数，按那一期分到的钱按天折算。
 * 期初结清的期金额不详，不计入。默认用最早一笔未用收款的币种，跨币种按退出日汇总，parts 保留原币种明细；缺汇率返回 NaN
 */
export function suggestedLeaveRefund(state: AppState, s: Subscription, m: ShareMember, currency?: string) {
  // 按没退出算各期，才能对上退出日之后提前收了的期
  const parts = !m.left
    ? []
    : memberLedger(s, { ...m, left: undefined }, m.left, collectCurrencyOf(state.settings), m.left).periods.flatMap((p) => {
        if (p.status !== 'paid' || p.share == null || p.until < m.left!) return [];
        const unusedFrom = p.from > m.left! ? p.from : m.left!;
        const unusedDays = diffDays(unusedFrom, p.until) + 1;
        return [{ from: p.from, until: p.until, unusedDays, amount: (p.share * unusedDays) / (diffDays(p.from, p.until) + 1), currency: p.receipt!.currency }];
      });
  const ccy = currency ?? parts[0]?.currency ?? m.feeCurrency ?? collectCurrencyOf(state.settings);
  const amount = parts.reduce((sum, p) => sum + convertOn(p.amount, p.currency, ccy, m.left!, state.fxHistory, state.fx), 0);
  const factor = 10 ** currencyDecimals(ccy);
  return { amount: Math.round(amount * factor) / factor, currency: ccy, unusedDays: parts.reduce((sum, p) => sum + p.unusedDays, 0), parts };
}

/**
 * 合租账本：订阅本身多少钱、我付出去多少、从成员身上收回多少，算出净成本（负数就是赚了）。
 * 预计按年算：订阅一年的费用对比成员一年应交；实际从开始合租那天（缺省为最早一笔收款）累计。
 */
export function carLedger(state: AppState, s: Subscription, today: string) {
  const cur = currentPhase(s, today);
  const members = s.share?.members ?? [];
  // 缺汇率的部分为 NaN（与收回、退款的 memberFlowValue 同一口径），不当成 0
  const yearCost = toBaseOrNaN(state, monthlyGross(cur, today) * 12, cur.currency);
  // 预计收入只算还在车上的；实际收回保留所有人（包括已退出的）的历史收款
  const yearRefunded = members.reduce((sum, m) => {
    const r = m.leaveRefund;
    return sum + (r && r.date.slice(0, 4) === today.slice(0, 4) && r.date <= today ? memberFlowValue(state, r) : 0);
  }, 0);
  // 买断的车只收一次，没有每年的收入；一次性收款算在发起至今的收回里
  const yearIncome =
    (isStopped(effectiveStatus(s, today)) || cur.cycle.unit === 'lifetime'
      ? 0
      : members.reduce((a, m) => {
          const rate = memberFee(state, s, m, today);
          return a + (m.exempt || !memberAboard(m, today) ? 0 : toBaseOrNaN(state, (rate.amount * 12) / memberBillMonths(s, m, today), rate.currency));
        }, 0)) - yearRefunded;
  const firstPay = members
    .flatMap(memberCashFlows)
    .filter((p) => p.kind === 'receipt')
    .reduce<string | undefined>((a, p) => (!a || p.date < a ? p.date : a), undefined);
  // 发起日：没填就依次用第一笔收款、最早加入的成员、订阅开始日，「发起至今」总能算出来
  const firstJoin = members.map((m) => m.joined).reduce<string | undefined>((a, d) => (d && (!a || d < a) ? d : a), undefined);
  const since = s.share?.since ?? firstPay ?? firstJoin ?? s.start;
  const paid = chargesBetween(s, since, today, today).reduce((a, c) => a + chargeBaseOrNaN(state, c), 0);
  const received = members.flatMap(memberCashFlows).reduce((a, p) => a + memberFlowValue(state, p), 0);
  const paidTotal = chargesTotal(state, chargesBetween(s, since, today, today));
  const receivedTotal = sumTotals(members.flatMap(memberCashFlows).map((p) => convertedTotal(state, p.amount, p.currency, p.date)));
  const yearCostTotal = convertedTotal(state, monthlyGross(cur, today) * 12, cur.currency);
  const yearRefundTotal = sumTotals(
    members.flatMap((m) =>
      m.leaveRefund && m.leaveRefund.date.slice(0, 4) === today.slice(0, 4) && m.leaveRefund.date <= today
        ? [convertedTotal(state, m.leaveRefund.amount, m.leaveRefund.currency, m.leaveRefund.date)]
        : [],
    ),
  );
  const yearIncomeTotal = sumTotals([
    isStopped(effectiveStatus(s, today)) || cur.cycle.unit === 'lifetime'
      ? emptyTotal()
      : sumTotals(
          members
            .filter((m) => !m.exempt && memberAboard(m, today))
            .map((m) => {
              const rate = memberFee(state, s, m, today);
              return convertedTotal(state, (rate.amount * 12) / memberBillMonths(s, m, today), rate.currency);
            }),
        ),
    scaleTotal(yearRefundTotal, -1),
  ]);
  return {
    partial: {
      paid: paidTotal,
      received: receivedTotal,
      net: sumTotals([paidTotal, scaleTotal(receivedTotal, -1)]),
      yearCost: yearCostTotal,
      yearIncome: yearIncomeTotal,
      yearNet: sumTotals([yearCostTotal, scaleTotal(yearIncomeTotal, -1)]),
    },
    hasRecords: members.some((m) => memberCashFlows(m).length > 0),
    yearCost,
    yearIncome,
    yearRefunded,
    yearNet: yearCost - yearIncome,
    since,
    paid,
    received,
    net: paid - received,
  };
}

/**
 * 一辆车今年（自然年）的盈亏：成本是今年已扣加剩下预计要扣的；收入是成员今年已经交的，
 * 加上今年里还该收的各期（含已逾期没收的）。都折成本币，买断与停止的车同样适用
 */
export function carYear(state: AppState, s: Subscription, today: string) {
  const y = today.slice(0, 4);
  const ccy = collectCurrencyOf(state.settings);
  const cost = yearCost(state, s, today);
  const members = s.share?.members ?? [];
  const received = members
    .flatMap(memberCashFlows)
    .filter((p) => p.date.slice(0, 4) === y && p.date <= today)
    .reduce((a, p) => a + memberFlowValue(state, p), 0);
  const expected = members
    .filter((m) => !m.exempt)
    .flatMap((m) =>
      memberLedger(s, m, today, ccy, `${y}-12-31`)
        .periods.filter((p) => !isSettled(p) && p.from.slice(0, 4) === y)
        .map((p) => toBaseOrNaN(state, p.due, p.currency, p.from)),
    )
    .reduce((a, v) => a + v, 0);
  const income = received + expected;
  const costTotal = chargesTotal(state, chargesBetween(s, `${y}-01-01`, `${y}-12-31`, today));
  const incomeTotal = sumTotals([
    ...members
      .flatMap(memberCashFlows)
      .filter((p) => p.date.slice(0, 4) === y && p.date <= today)
      .map((p) => convertedTotal(state, p.amount, p.currency, p.date)),
    ...members
      .filter((m) => !m.exempt)
      .flatMap((m) =>
        memberLedger(s, m, today, ccy, `${y}-12-31`)
          .periods.filter((p) => !isSettled(p) && p.from.slice(0, 4) === y)
          .map((p) => convertedTotal(state, p.due, p.currency, p.from)),
      ),
  ]);
  return { cost, income, net: income - cost, partial: { cost: costTotal, income: incomeTotal, net: sumTotals([incomeTotal, scaleTotal(costTotal, -1)]) } };
}

/** 订阅一期大约几个月，用来把「每期份额」换算成按月 / 季 / 年收的金额 */
export function cycleMonths(s: Subscription): number {
  // 买断没有周期：按收一次（与成员的买断收费周期一致）算，份额就是一次性的那份
  if (s.cycle.unit === 'lifetime') return LIFETIME_BILL_MONTHS;
  return Math.max(0.25, cycleDays(s.cycle) / DAYS_PER_MONTH);
}

/** 每次向这位成员收多少：填了收费标准就用它，否则由每期份额换算（订阅币种） */
export function memberFee(state: AppState, s: Subscription, m: ShareMember, day = memberSince(s, m)): { amount: number; currency: string } {
  const ccy = collectCurrencyOf(state.settings);
  return memberRate(s, m, day, ccy);
}

/** 首次调价固定旧基线；只插入收费标准，绝不改写历史收款。 */
export function changeMemberFee(state: AppState, s: Subscription, m: ShareMember, point: MemberFeePoint, today: string): ShareMember {
  const baseline = memberRate(s, m, memberSince(s, m), collectCurrencyOf(state.settings));
  const history = m.feeHistory?.length
    ? m.feeHistory
    : [
        {
          from: [memberSince(s, m), point.from].sort()[0],
          fee: baseline.amount,
          currency: baseline.currency,
          billEvery: baseline.billEvery,
          share: m.share,
        },
      ];
  const feeHistory = [
    ...history.filter((p) => p.from !== point.from),
    { ...point, share: shareFromFee(state, s, point.fee, point.currency, point.billEvery) },
  ].sort((a, b) => a.from.localeCompare(b.from));
  const next = { ...m, feeHistory };
  const current = memberRate(s, next, today, collectCurrencyOf(state.settings));
  return {
    ...next,
    fee: current.amount,
    feeCurrency: current.currency,
    billEvery: current.billEvery,
    share: m.exempt ? 0 : shareFromFee(state, s, current.amount, current.currency, current.billEvery),
  };
}

/** 由收费标准反推每期份额（订阅币种），用于算我自己的份额与成员应交 */
export function shareFromFee(state: AppState, s: Subscription, fee: number, ccy: string, billEvery: number): number {
  return Math.round(((toBaseAt(state, fee, ccy, undefined, s.currency) * cycleMonths(s)) / billEvery) * 100) / 100;
}

/**
 * 订阅换了币种或计费周期后，成员按收费标准（fee）重新折算每期份额。
 * 份额是保存成员时按当时的币种、周期算好存下的，不重算会把 ¥60 当成 $60
 */
export function resyncShares(state: AppState, prev: Subscription | undefined, next: Subscription): Subscription {
  if (!next.share || !prev || (prev.currency === next.currency && cycleMonths(prev) === cycleMonths(next))) return next;
  const ccy = collectCurrencyOf(state.settings);
  return {
    ...next,
    share: {
      ...next.share,
      members: next.share.members.map((m) =>
        m.fee != null && !m.exempt
          ? {
              ...m,
              share: shareFromFee(state, next, m.fee, m.feeCurrency ?? ccy, m.billEvery ?? memberBillMonths(next, m)),
              feeHistory: m.feeHistory?.map((p) => ({ ...p, share: shareFromFee(state, next, p.fee, p.currency, p.billEvery) })),
            }
          : m,
      ),
    },
  };
}

/** 两条收费标准是否相同（金额容差一分钱） */
export const sameRule = (a: CarRule, b: CarRule) => a.billEvery === b.billEvery && a.currency === b.currency && Math.abs(a.fee - b.fee) < 0.005;

/**
 * 车的收款规则：存了就用存的；老数据没存时，取在车成员里最常见的收费标准（周期 + 金额 + 币种）。
 * 没有可参考的成员时按订阅价格除以座位、周期同订阅推一个默认值。
 */
export function carRule(state: AppState, s: Subscription, today: string): CarRule {
  if (s.share?.rule) return s.share.rule;
  const ccy = collectCurrencyOf(state.settings);
  const counts = new Map<string, { rule: CarRule; n: number }>();
  for (const m of s.share?.members ?? []) {
    if (m.exempt || (m.left && m.left <= today)) continue;
    const r = memberRate(s, m, today, ccy);
    const rule = { billEvery: r.billEvery, fee: r.amount, currency: r.currency };
    const key = `${rule.billEvery}|${rule.currency}|${rule.fee}`;
    counts.set(key, { rule, n: (counts.get(key)?.n ?? 0) + 1 });
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  if (top) return top.rule;
  const months = Math.max(1, Math.round(cycleMonths(s)));
  const fee = toBaseAt(state, s.price / Math.max(1, s.share?.seats ?? 1), s.currency, undefined, ccy);
  return { billEvery: months, fee: Math.round(fee * 100) / 100, currency: ccy };
}

/** 成员是否跟随车的规则：没标自定义、要分摊；老数据未存规则时，收费与规则一致才算跟随 */
export function followsCar(state: AppState, s: Subscription, m: ShareMember, today: string): boolean {
  if (m.custom || m.exempt) return false;
  if (s.share?.rule) return true;
  const r = memberRate(s, m, today, collectCurrencyOf(state.settings));
  return sameRule({ billEvery: r.billEvery, fee: r.amount, currency: r.currency }, carRule(state, s, today));
}

/**
 * 改车的收款规则：存下新规则，跟随车的成员从生效日起改用新标准（沿用调价机制，历史收款不变）；
 * 自定义收费、不分摊、已退出的成员不动。
 */
export function applyCarRule(state: AppState, s: Subscription, rule: CarRule, from: string, today: string): Subscription {
  if (!s.share) return s;
  const members = s.share.members.map((m) => {
    if (m.left && (m.left <= today || m.left <= from)) return m;
    // 规则第一次存下时，原本就与车不一致的成员明确标为自定义，之后不会被当成跟随车
    if (!followsCar(state, s, m, today)) return m.exempt || m.custom ? m : { ...m, custom: true };
    const r = memberRate(s, m, from, collectCurrencyOf(state.settings));
    if (sameRule({ billEvery: r.billEvery, fee: r.amount, currency: r.currency }, rule)) return m;
    return changeMemberFee(state, s, m, { from, fee: rule.fee, currency: rule.currency, billEvery: rule.billEvery }, today);
  });
  return { ...s, share: { ...s.share, rule, members } };
}

/** 成员改回跟随车：从生效日起套用车的规则 */
export function followCarRule(state: AppState, s: Subscription, m: ShareMember, from: string, today: string): ShareMember {
  const rule = carRule(state, s, today);
  const r = memberRate(s, m, from, collectCurrencyOf(state.settings));
  const next = { ...m, custom: undefined };
  return sameRule({ billEvery: r.billEvery, fee: r.amount, currency: r.currency }, rule)
    ? next
    : changeMemberFee(state, s, next, { from, fee: rule.fee, currency: rule.currency, billEvery: rule.billEvery }, today);
}

/** 几期应收的合计：金额折成第一期的币种相加（收款表单按选中的期预填金额） */
export function periodsTotal(state: AppState, periods: Period[]) {
  const ccy = periods[0]?.currency ?? collectCurrencyOf(state.settings);
  const amount = periods.reduce((a, p) => a + (p.currency === ccy ? p.due : convertOn(p.due, p.currency, ccy, p.from, state.fxHistory, state.fx)), 0);
  const d = 10 ** currencyDecimals(ccy);
  return { amount: Math.round(amount * d) / d, currency: ccy };
}

/**
 * 按车的收款节奏（基准日每隔 billEvery 个月一次），今天之后的下一次收款日。
 * 收费规则里的「下期收款日」：新标准从这天起执行，改这个日期就是把全车的收款节奏挪到这天
 */
export function nextCollectionDay(s: Subscription, billEvery: number, today: string): string {
  const anchor = collectionAnchor(s);
  const every = Math.max(1, billEvery);
  let k = Math.ceil(((Number(today.slice(0, 4)) - Number(anchor.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(anchor.slice(5, 7))) / every) - 1;
  while (addMonths(anchor, k * every) > today) k--;
  while (addMonths(anchor, k * every) <= today) k++;
  return addMonths(anchor, k * every);
}

import { addDays, memberUnpaidFrom, memberCollection, memberDues } from './billing.ts';

/** 成员一行的收款状态：逾期几天 / 待收 / 已结清，合租表格和收费弹窗共用 */
export function memberStatus(state: AppState, s: Subscription, m: ShareMember, today: string) {
  const collect = collectCurrencyOf(state.settings);
  const d = memberDues(s, today, collect, state).find((x) => x.member.id === m.id);
  const next = memberCollection(s, m, memberUnpaidFrom(s, m), collect);
  const owe = !!d && d.periodsOwed > 0;
  // 本期：今天所在的这个人自己的收费期；还没加入或已经退出时取最早没结清的一期
  const now = memberLedger(s, m, today, collect).periods.find((p) => p.from <= today && p.until >= today);
  const period = now ? { from: now.from, until: now.until, paid: isSettled(now) } : { from: next.from, until: next.until, paid: false };
  return {
    owe,
    period,
    owed: owe ? d!.owed : undefined,
    currency: d?.currency ?? collect,
    late: owe && next.from < today ? diffDays(next.from, today) : 0,
    next,
    gone: !!m.left && next.from >= m.left,
  };
}

/** 成员时间条上的一段：已收、免收（含免费）、该收没收（到今天为止）、还没到期的下一期，以及退出后没用完的已付天数 */
export interface MemberSegment {
  from: string;
  until: string;
  kind: 'paid' | 'due' | 'future' | 'unused' | 'waived';
}

/**
 * 成员在时间窗口内的各期：按这个人自己的收费周期切分，每期按收款、免收推算状态，可以不连续。
 * 已退出的截到退出前一天；不分摊的没有分段。
 */
export function memberSegments(s: Subscription, m: ShareMember, today: string, start: string, end: string): MemberSegment[] {
  if (m.exempt) return [];
  const stop = m.left ? addDays(m.left, -1) : end;
  const out: MemberSegment[] = [];
  const push = (from: string, until: string, kind: MemberSegment['kind']) => {
    const a = from < start ? start : from;
    const b = [until, stop, end].sort()[0];
    if (a <= b) out.push({ from: a, until: b, kind });
  };
  const { periods } = memberLedger(s, m, today, s.currency, end);
  let future = false;
  for (const p of periods) {
    if (p.until < start || p.from > end) continue;
    if (p.status === 'upcoming') {
      // 还没到期的只画下一期
      if (future) continue;
      future = true;
    }
    push(p.from, p.until, p.status === 'paid' ? 'paid' : p.status === 'due' ? 'due' : p.status === 'upcoming' ? 'future' : 'waived');
  }
  // 退出时已付到退出日之后、又没退钱：退出后到已付至的那段画成没用完
  const paid =
    m.left && !m.leaveRefund
      ? memberLedger(s, { ...m, left: undefined }, today, s.currency, m.left).periods.filter((p) => p.status === 'paid' && p.until >= m.left!)
      : [];
  if (paid.length) {
    const from = [m.left!, start].sort().at(-1)!;
    const last = paid.at(-1)!.until;
    const until = last < end ? last : end;
    if (from <= until) out.push({ from, until, kind: 'unused' });
  }
  return out;
}
