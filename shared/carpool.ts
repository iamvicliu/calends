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
  memberRate,
  addDays,
  addMonths,
  diffDays,
} from './billing.ts';
import { chargeValue, convertOn, toBaseAt } from './fx.ts';
import { currencyDecimals } from './format.ts';
import type { AppState, CarRule, MemberFeePoint, MemberPayment, ShareMember, Subscription } from './types.ts';

/** 保留收款原件；退款在现金流中作为支出，不改变覆盖期。 */
export function memberCashFlows(m: ShareMember) {
  return [
    ...(m.payments ?? []).map((p) => ({ ...p, kind: 'receipt' as const })),
    ...(m.leaveRefund
      ? [
          {
            ...m.leaveRefund,
            amount: -m.leaveRefund.amount,
            from: m.left,
            until: m.paidUntil && m.left && m.paidUntil >= m.left ? m.paidUntil : (m.left ?? m.leaveRefund.date),
            kind: 'refund' as const,
          },
        ]
      : []),
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
 * 按每笔实收的覆盖期日单价折算，退出当日已不在车上，计入未用天数。
 * 老收款无 from 时按前笔覆盖终点、收费周期和加入日推断；仅有 paidUntil 不虚构收款。
 * 默认使用最早一笔未用收款的币种，跨币种按退出日汇总，parts 保留原币种明细；缺汇率返回 NaN。
 */
export function suggestedLeaveRefund(state: AppState, s: Subscription, m: ShareMember, currency?: string) {
  const joined = m.joined ?? s.share?.since ?? s.start;
  let previous: string | undefined;
  const parts = (m.payments ?? [])
    .slice()
    .sort((a, b) => a.until.localeCompare(b.until))
    .flatMap((p) => {
      const inferred = previous ? addDays(previous, 1) : addMonths(addDays(p.until, 1), -memberBillMonths(s, m, p.until));
      const from = p.from ?? (inferred < joined ? joined : inferred);
      previous = previous && previous > p.until ? previous : p.until;
      if (!m.left || p.until < m.left || p.until < from) return [];
      const unusedFrom = from > m.left ? from : m.left;
      const unusedDays = diffDays(unusedFrom, p.until) + 1;
      return [{ from, until: p.until, unusedDays, amount: (p.amount * unusedDays) / (diffDays(from, p.until) + 1), currency: p.currency }];
    });
  const ccy = currency ?? parts[0]?.currency ?? m.feeCurrency ?? state.settings.collectCurrency ?? state.settings.baseCurrency;
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
  const yearCost = toBaseAt(state, monthlyGross(cur, today) * 12, cur.currency);
  // 预计收入只算还在车上的；实际收回保留所有人（包括已退出的）的历史收款
  const yearRefunded = members.reduce((sum, m) => {
    const r = m.leaveRefund;
    return sum + (r && r.date.slice(0, 4) === today.slice(0, 4) && r.date <= today ? memberFlowValue(state, r) : 0);
  }, 0);
  const yearIncome =
    (['ended', 'terminated'].includes(effectiveStatus(s, today))
      ? 0
      : members.reduce((a, m) => {
          const rate = memberFee(state, s, m, today);
          return a + (m.exempt || !memberAboard(m, today) ? 0 : toBaseAt(state, (rate.amount * 12) / memberBillMonths(s, m, today), rate.currency));
        }, 0)) - yearRefunded;
  const firstPay = members.flatMap((m) => m.payments ?? []).reduce<string | undefined>((a, p) => (!a || p.date < a ? p.date : a), undefined);
  // 发起日：没填就依次用第一笔收款、最早加入的成员、订阅开始日，「发起至今」总能算出来
  const firstJoin = members.map((m) => m.joined).reduce<string | undefined>((a, d) => (d && (!a || d < a) ? d : a), undefined);
  const since = s.share?.since ?? firstPay ?? firstJoin ?? s.start;
  const paid = since ? chargesBetween(s, since, today, today).reduce((a, c) => a + chargeValue(state, c), 0) : 0;
  const received = members.flatMap(memberCashFlows).reduce((a, p) => a + memberFlowValue(state, p), 0);
  return {
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

/** 订阅一期大约几个月，用来把「每期份额」换算成按月 / 季 / 年收的金额 */
export function cycleMonths(s: Subscription): number {
  return Math.max(0.25, cycleDays(s.cycle) / 30.4375);
}

/** 按收费周期应收的金额：每期份额 × 周期月数 ÷ 订阅一期的月数 */
export function billAmount(s: Subscription, m: ShareMember): number {
  return Math.round((((m.share || 0) * memberBillMonths(s, m)) / cycleMonths(s)) * 100) / 100;
}

/** 每次向这位成员收多少：填了收费标准就用它，否则由每期份额换算（订阅币种） */
export function memberFee(state: AppState, s: Subscription, m: ShareMember, day = m.joined ?? s.share?.since ?? s.start): { amount: number; currency: string } {
  const ccy = state.settings.collectCurrency ?? state.settings.baseCurrency;
  return memberRate(s, m, day, ccy);
}

/** 首次调价固定旧基线；只插入收费标准，绝不改写历史收款。 */
export function changeMemberFee(state: AppState, s: Subscription, m: ShareMember, point: MemberFeePoint, today: string): ShareMember {
  const baseline = memberRate(s, m, m.joined ?? s.share?.since ?? s.start, state.settings.collectCurrency ?? state.settings.baseCurrency);
  const history = m.feeHistory?.length
    ? m.feeHistory
    : [
        {
          from: [m.joined ?? s.share?.since ?? s.start, point.from].sort()[0],
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
  const current = memberRate(s, next, today);
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
  const ccy = state.settings.collectCurrency ?? state.settings.baseCurrency;
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

/** 更新应收和覆盖期时保留实际收款草稿；金额或币种手改后，两者都不再跟随默认值。 */
export function refreshReceiptDraft(draft: MemberPayment, next: MemberPayment, moneyEdited: boolean): MemberPayment {
  return {
    ...draft,
    from: next.from,
    until: next.until,
    ...(!moneyEdited ? { amount: next.amount, currency: next.currency } : {}),
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
  const ccy = state.settings.collectCurrency ?? state.settings.baseCurrency;
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
  const r = memberRate(s, m, today, state.settings.collectCurrency ?? state.settings.baseCurrency);
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
    const r = memberRate(s, m, from, state.settings.collectCurrency ?? state.settings.baseCurrency);
    if (sameRule({ billEvery: r.billEvery, fee: r.amount, currency: r.currency }, rule)) return m;
    return changeMemberFee(state, s, m, { from, fee: rule.fee, currency: rule.currency, billEvery: rule.billEvery }, today);
  });
  return { ...s, share: { ...s.share, rule, members } };
}

/** 成员改回跟随车：从生效日起套用车的规则 */
export function followCarRule(state: AppState, s: Subscription, m: ShareMember, from: string, today: string): ShareMember {
  const rule = carRule(state, s, today);
  const r = memberRate(s, m, from, state.settings.collectCurrency ?? state.settings.baseCurrency);
  const next = { ...m, custom: undefined };
  return sameRule({ billEvery: r.billEvery, fee: r.amount, currency: r.currency }, rule)
    ? next
    : changeMemberFee(state, s, next, { from, fee: rule.fee, currency: rule.currency, billEvery: rule.billEvery }, today);
}
