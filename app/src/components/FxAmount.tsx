import type { FxTotal } from '../../../shared/fx-total.ts';
import { formatTotal } from '../../../shared/fx-total.ts';
import { Amount } from './inputs.tsx';

/** Preserve the existing number markup; all-missing amounts use their original currencies. */
export function FxAmount({
  total,
  ccy,
  compact,
  plain,
  decimals,
  direction = 1,
}: {
  total: FxTotal;
  ccy: string;
  compact?: boolean;
  plain?: boolean;
  decimals?: number;
  direction?: 1 | -1;
}) {
  return total.incomplete && !total.known ? (
    formatTotal(total, ccy, { compact, direction: plain ? undefined : direction, main: true })
  ) : (
    <Amount value={total.value * direction} ccy={ccy} compact={compact} plain={plain} decimals={decimals} />
  );
}
