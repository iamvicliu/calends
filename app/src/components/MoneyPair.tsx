// 金额的「大字 + 小字」统一规则：跟随侧边栏的显示货币设置。
// - 选了本位币：大字是折算后的本位币，小字是原币（准确数，作参考）
// - 选了原币：大字是原币，小字是折算成本位币的约数
// - 原币就是本位币：只显示一个数
import type { ReactNode as ComponentChildren } from 'react';
import { money } from '../../../shared/format.ts';
import { convert } from '../../../shared/billing.ts';
import { toBaseAt } from '../../../shared/fx.ts';
import type { AppState } from '../../../shared/types.ts';
import { useOrig } from '../display.ts';
import { Amount } from './ui.tsx';

export interface Pair {
  /** 大字 */
  main: ComponentChildren;
  /** 小字（没有就是 undefined） */
  alt?: string;
}

/**
 * 返回一个函数：给出原币金额，得到大字和小字。
 * date 用于按当天汇率折算（已发生的扣款）；不给就按当前汇率。value 可以直接传入已经折算好的本位币金额。
 */
export function useMoneyPair(state: AppState) {
  const orig = useOrig();
  const base = state.settings.baseCurrency;
  return (amount: number, ccy: string, opts: { date?: string; value?: number; compact?: boolean } = {}): Pair => {
    if (ccy === base) return { main: <Amount value={amount} ccy={ccy} /> };
    const inBase = opts.value ?? (opts.date ? toBaseAt(state, amount, ccy, opts.date) : convert(amount, ccy, base, state.fx));
    return orig
      ? { main: <Amount value={amount} ccy={ccy} />, alt: `≈ ${money(inBase, base, { compact: opts.compact ?? true })}` }
      : { main: <Amount value={inBase} ccy={base} />, alt: money(amount, ccy, { compact: opts.compact }) };
  };
}
