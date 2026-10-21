// 合租的账：一年的成本与预计收入、从开始合租起实际付出与收回；成员每次该收多少。
// 后台合租页与 MCP / AI 助手共用，算出来的数一致。
import { chargesBetween, currentPhase, cycleDays, monthlyGross } from './billing.ts';
import { chargeValue, toBaseAt } from './fx.ts';
import type { AppState, ShareMember, Subscription } from './types.ts';

/**
 * 合租账本：订阅本身多少钱、我付出去多少、从成员身上收回多少，算出净成本（负数就是赚了）。
 * 预计按年算：订阅一年的费用对比成员一年应交；实际从开始合租那天（缺省为最早一笔收款）累计。
 */
export function carLedger(state: AppState, s: Subscription, today: string) {
  const cur = currentPhase(s, today);
  const members = s.share?.members ?? [];
  const perYear = 365.25 / cycleDays(cur.cycle);
  const yearCost = toBaseAt(state, monthlyGross(cur, today) * 12, cur.currency);
  // 预计收入只算还在车上的；实际收回保留所有人（包括已退出的）的历史收款
  const yearIncome = members.reduce((a, m) => a + (m.exempt || (m.left && m.left <= today) ? 0 : toBaseAt(state, (m.share || 0) * perYear, cur.currency)), 0);
  const firstPay = members.flatMap((m) => m.payments ?? []).reduce<string | undefined>((a, p) => (!a || p.date < a ? p.date : a), undefined);
  const since = s.share?.since ?? firstPay;
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
  return Math.round((((m.share || 0) * (m.billEvery ?? 1)) / cycleMonths(s)) * 100) / 100;
}

/** 每次向这位成员收多少：填了收费标准就用它，否则由每期份额换算成本位币 */
export function memberFee(state: AppState, s: Subscription, m: ShareMember): { amount: number; currency: string } {
  const ccy = state.settings.collectCurrency ?? state.settings.baseCurrency;
  if (m.fee != null) return { amount: m.fee, currency: m.feeCurrency ?? ccy };
  return { amount: Math.round(toBaseAt(state, billAmount(s, m), s.currency, undefined, ccy)), currency: ccy };
}

/** 由收费标准反推每期份额（订阅币种），用于算我自己的份额与成员应交 */
export function shareFromFee(state: AppState, s: Subscription, fee: number, ccy: string, billEvery: number): number {
  return Math.round(((toBaseAt(state, fee, ccy, undefined, s.currency) * cycleMonths(s)) / billEvery) * 100) / 100;
}
