// 合租的账：一年的成本与预计收入、从开始合租起实际付出与收回；成员每次该收多少。
// 后台合租页与 MCP / AI 助手共用，算出来的数一致。
import { chargesBetween, currentPhase, cycleDays, monthlyGross, memberAboard, effectiveStatus, memberBillMonths, memberRate } from './billing.ts';
import { chargeValue, toBaseAt } from './fx.ts';
import type { AppState, MemberFeePoint, MemberPayment, ShareMember, Subscription } from './types.ts';

/**
 * 合租账本：订阅本身多少钱、我付出去多少、从成员身上收回多少，算出净成本（负数就是赚了）。
 * 预计按年算：订阅一年的费用对比成员一年应交；实际从开始合租那天（缺省为最早一笔收款）累计。
 */
export function carLedger(state: AppState, s: Subscription, today: string) {
  const cur = currentPhase(s, today);
  const members = s.share?.members ?? [];
  const yearCost = toBaseAt(state, monthlyGross(cur, today) * 12, cur.currency);
  // 预计收入只算还在车上的；实际收回保留所有人（包括已退出的）的历史收款
  const yearIncome = ['ended', 'terminated'].includes(effectiveStatus(s, today))
    ? 0
    : members.reduce((a, m) => {
        const rate = memberFee(state, s, m, today);
        return a + (m.exempt || !memberAboard(m, today) ? 0 : toBaseAt(state, (rate.amount * 12) / memberBillMonths(s, m, today), rate.currency));
      }, 0);
  const firstPay = members.flatMap((m) => m.payments ?? []).reduce<string | undefined>((a, p) => (!a || p.date < a ? p.date : a), undefined);
  // 发起日：没填就依次用第一笔收款、最早加入的成员、订阅开始日，「发起至今」总能算出来
  const firstJoin = members.map((m) => m.joined).reduce<string | undefined>((a, d) => (d && (!a || d < a) ? d : a), undefined);
  const since = s.share?.since ?? firstPay ?? firstJoin ?? s.start;
  const paid = since ? chargesBetween(s, since, today, today).reduce((a, c) => a + chargeValue(state, c), 0) : 0;
  const received = members.flatMap((m) => m.payments ?? []).reduce((a, p) => a + toBaseAt(state, p.amount, p.currency, p.date), 0);
  return { yearCost, yearIncome, yearNet: yearCost - yearIncome, since, paid, received, net: paid - received };
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
