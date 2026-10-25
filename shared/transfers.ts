// 转让收付：二手转入时付给原主的钱、转出时收到的钱。都是实际现金，不推算剩余服务价值。
// 不是服务商扣款：不进 MRR、续费预测、余额消耗、退款与扣款笔数；只进生命周期净成本和年度、月度现金流。
import { chargesBetween, CURRENCY_CODE, diffDays, servedTime, validDay } from './billing.ts';
import { chargeBaseOrNaN, convertOn } from './fx.ts';
import { t } from './i18n.ts';
import type { AppState, Subscription, Transfer } from './types.ts';

const MONTH = 30.44;

/** 按日期排好的转让记录（同一天保持存储顺序）；没有时为空 */
export function transfersOf(s: Pick<Subscription, 'transfers'>): Transfer[] {
  return (s.transfers ?? [])
    .map((tr, i) => ({ tr, i }))
    .sort((a, b) => a.tr.date.localeCompare(b.tr.date) || a.i - b.i)
    .map((x) => x.tr);
}

/** 现金方向：转入付出去为正（成本），转出收回来为负 */
export const transferSign = (tr: Pick<Transfer, 'kind'>) => (tr.kind === 'buy' ? 1 : -1);

/** 转让当天汇率折成 to；历史缺失时回落当前汇率，仍缺则为 NaN，不当成 0 */
export function transferValue(state: AppState, tr: Transfer, to = state.settings.baseCurrency): number {
  return convertOn(tr.amount, tr.currency, to, tr.date, state.fxHistory, state.fx);
}

/** 最后一笔转出的日期：那天起不再是我的（之后若又转入，则视为仍在持有） */
export function soldOn(s: Pick<Subscription, 'transfers'>): string | undefined {
  const last = transfersOf(s).at(-1);
  return last?.kind === 'sell' ? last.date : undefined;
}

/**
 * 持有期：起点取最早一笔转入（早于订阅开始时），终点取最后一笔转出（不含当天），否则到今天。
 * 天数沿用实际在订天数（不算断档），转入早于开始的那段另加。
 */
export function holdingPeriod(s: Subscription, today: string): { from: string; until: string; days: number } {
  const buy = transfersOf(s).find((tr) => tr.kind === 'buy');
  const sold = soldOn(s);
  const until = sold && sold < today ? sold : today;
  const from = buy && buy.date < s.start ? buy.date : s.start;
  const lead = from < s.start ? Math.max(0, diffDays(from, s.start < until ? s.start : until)) : 0;
  return { from, until, days: servedTime(s, until).days + lead };
}

export interface NetCost {
  currency: string;
  /** 服务商扣款（实扣、退款为负），同详情「累计」口径；有扣款缺汇率时为 NaN */
  service: number;
  charges: number;
  /** 转入付出的钱、转出收回的钱（正数）；缺汇率时为 NaN */
  bought: number;
  sold: number;
  net: number;
  from: string;
  until: string;
  days: number;
  perMonth: number;
  perDay: number;
  /** 有服务扣款或转让缺少可用汇率：本位币合计不可用 */
  incomplete: boolean;
}

/** 生命周期净成本 = 服务付款 + 转入 − 转出；月均、日均按持有期摊（今天之后的转让不计） */
export function netCost(state: AppState, s: Subscription, today: string, to = state.settings.baseCurrency): NetCost {
  const history = chargesBetween(s, s.start, today, today);
  const service = history.reduce((a, c) => a + chargeBaseOrNaN(state, c, to), 0);
  let bought = 0;
  let sold = 0;
  for (const tr of transfersOf(s)) {
    if (tr.date > today) continue;
    const v = transferValue(state, tr, to);
    if (tr.kind === 'buy') bought += v;
    else sold += v;
  }
  const net = service + bought - sold;
  const held = holdingPeriod(s, today);
  const perMonth = net / Math.max(1, held.days / MONTH);
  return {
    currency: to,
    service,
    charges: history.length,
    bought,
    sold,
    net,
    ...held,
    perMonth,
    perDay: perMonth / MONTH,
    incomplete: !Number.isFinite(service) || !Number.isFinite(bought) || !Number.isFinite(sold),
  };
}

/**
 * 停止阶段的剩余服务是否已随转出收回：转出发生在该阶段开始到已付截止日之间。
 * 这时没有「已付未用」损失，钱已经算在转出里。
 */
export function transferredStop(phase: Subscription): Transfer | undefined {
  if (!phase.stop) return undefined;
  return transfersOf(phase).find((tr) => tr.kind === 'sell' && tr.date >= phase.start && tr.date <= phase.stop!.paidThrough);
}

export interface TransferRow {
  sub: Subscription;
  date: string;
  /** 本位币，转入为正、转出为负；缺汇率为 NaN */
  amount: number;
  transfer: Transfer;
}

/** [from, to] 内的转让现金（不含今天之后），供年度回顾、月报的现金流 */
export function transferRows(state: AppState, from: string, to: string, today: string): TransferRow[] {
  const end = to < today ? to : today;
  return state.subscriptions
    .filter((s) => !s.proxy)
    .flatMap((sub) =>
      transfersOf(sub)
        .filter((tr) => tr.date >= from && tr.date <= end)
        .map((transfer) => ({ sub, date: transfer.date, amount: transferSign(transfer) * transferValue(state, transfer), transfer })),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.sub.id.localeCompare(b.sub.id));
}

/** 保存前校验：种类、日期、正数金额、三位币种、备注为文本 */
export function transferError(s: Pick<Subscription, 'transfers'>): string | undefined {
  if (s.transfers == null) return undefined;
  if (!Array.isArray(s.transfers)) return t('core.subError.transfer');
  for (const tr of s.transfers) {
    if (
      !tr ||
      (tr.kind !== 'buy' && tr.kind !== 'sell') ||
      typeof tr.date !== 'string' ||
      !validDay(tr.date) ||
      typeof tr.amount !== 'number' ||
      !Number.isFinite(tr.amount) ||
      tr.amount <= 0 ||
      typeof tr.currency !== 'string' ||
      !CURRENCY_CODE.test(tr.currency) ||
      (tr.note != null && typeof tr.note !== 'string')
    )
      return t('core.subError.transfer');
  }
  return undefined;
}

/** 写入入口共用：去掉空备注、空列表 */
export function cleanTransfers(list: Transfer[] | undefined): Transfer[] | undefined {
  const out = (list ?? []).map(({ kind, date, amount, currency, note }) => ({
    kind,
    date,
    amount,
    currency: currency.toUpperCase(),
    ...(note?.trim() ? { note: note.trim() } : {}),
  }));
  return out.length ? out : undefined;
}
