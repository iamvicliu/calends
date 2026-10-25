import { type Charge } from '../../../../shared/billing.ts';
import type { AppState } from '../../../../shared/types.ts';
import { FlagImg } from '../../components/marks.tsx';

/** 状态角标的色调；文案见 list.status.* */
export const TONE: Record<string, string> = {
  upcoming: 'acc',
  trial: 'ok',
  paused: '',
  ending: 'warn',
  ended: '',
  terminated: 'bad',
};

export const LANE_COLORS = ['var(--c1)', 'var(--c6)', 'var(--c5)', 'var(--c3)', 'var(--c4)', 'var(--c7)'];

/** 地区：国旗小图 + 代码（emoji 国旗在部分系统上显示成字母） */
export function Region({ cc }: { cc: string }) {
  return (
    <span className="dt-region">
      <FlagImg cc={cc} />
      {cc.toUpperCase()}
    </span>
  );
}

export const methodOf = (state: AppState, id?: string) => state.methods.find((m) => m.id === id);

/** 正常扣款（不含退款、补差、失败，也不含记成负数的返佣、抵扣）：走势和「每笔」都只看这些 */
export const regular = (h: Charge[]) => h.filter((c) => !c.kind && c.amount > 0);
