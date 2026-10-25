import { currentPhase, LIFETIME_BILL_MONTHS, perLabel } from '../../../shared/billing.ts';
import { money } from '../../../shared/format.ts';
import { yearCost } from '../../../shared/metrics.ts';
import { t } from '../../../shared/i18n.ts';
import type { AppState, Subscription } from '../../../shared/types.ts';
import { Icon, useMedia } from './ui.tsx';

/** 每 N 个月的简写周期：月、季度、半年、年，其余写「N 个月」；接在金额后面的「/」之后 */
export function perMonths(n: number): string {
  if (n === 1) return t('report.per.month');
  if (n === 3) return t('report.per.quarter');
  if (n === 6) return t('report.per.halfYear');
  if (n === 12) return t('report.per.year');
  if (n === 24) return t('report.per.twoYears');
  if (n >= LIFETIME_BILL_MONTHS) return t('report.per.lifetime');
  return t('report.per.n.month', { count: n }).trim();
}

/**
 * 套餐价格一格：上面是原币价格和周期（$71.88/年），下面是今年的总成本折成本币：
 * 今年已扣的按实扣，剩下的按预计，一起算到 12 月 31 日；单位统一是「/年」
 */
export function PlanPrice({ state, s, today, cost }: { state: AppState; s: Subscription; today: string; cost?: number }) {
  const cur = currentPhase(s, today);
  const base = state.settings.baseCurrency;
  // 调用方已算过今年成本（合租表的当年盈亏）就直接用，不再重算一遍
  const year = cost ?? yearCost(state, s, today);
  return (
    <span className="lt-num" data-p={3}>
      <span>
        {money(cur.price, cur.currency)}
        {/* 买断同样写成「/买断」，和订阅列表的单位写法一致 */}
        {`/${perLabel(cur)}`}
      </span>
      {Number.isFinite(year) && (
        <small>
          {money(year, base)}/{t('report.per.year')}
        </small>
      )}
    </span>
  );
}

/** 手机宽度：合租、代付在这里不出表格，列表视图也用卡片 */
export function usePhone() {
  return useMedia('(max-width: 640px)');
}

/**
 * 表头排序的三态：点一列先按该列的默认方向，再点反向，第三次回到页面的默认排序（initial 列的默认方向）。
 * 页面默认排序不算「排过序」，表头不标图标
 */
export function nextSort<K extends string>(k: K, cur: K, dir: 'asc' | 'desc', defDir: Record<K, 'asc' | 'desc'>, initial: K): [K, 'asc' | 'desc'] {
  if (k !== cur) return [k, defDir[k]];
  if (dir === defDir[k]) return [k, dir === 'asc' ? 'desc' : 'asc'];
  return [initial, defDir[initial]];
}

/** 这一列要不要标方向箭头：正在按它排序，且不是页面的默认排序（initial 那一列的默认方向） */
export function isMarked<K extends string>(k: K | undefined, sort: K | undefined, dir: 'asc' | 'desc' | undefined, initial?: [K, 'asc' | 'desc']): boolean {
  return sort === k && !(initial && initial[0] === sort && initial[1] === dir);
}

/**
 * 列表视图（.ltable）的表头：可排序的列是按钮，再点一次反向；p 是收窄时的隐藏优先级，与行内单元格的 data-p 一致；num 的列靠右，与数字对齐
 */
export function LtHead<K extends string>({
  cols,
  sort,
  dir,
  onSort,
  initial,
}: {
  cols: Array<{ label: string; sort?: K; p?: 2 | 3; num?: boolean }>;
  sort?: K;
  dir?: 'asc' | 'desc';
  /** 页面默认排序：处于这一列的这个方向时不标图标 */
  initial?: [K, 'asc' | 'desc'];
  onSort?: (k: K) => void;
}) {
  const marked = (k?: K) => isMarked(k, sort, dir, initial);
  return (
    <div className="lt-row lt-head table-head" role="row">
      {cols.map((c) =>
        c.sort && onSort ? (
          <button
            key={c.label}
            data-p={c.p}
            className={`lt-sort ${marked(c.sort) ? 'on' : ''} ${c.num ? 'lt-r' : ''}`}
            onClick={() => onSort(c.sort!)}
            aria-sort={sort === c.sort ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
          >
            {c.label}
            {marked(c.sort) && <Icon name={dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} />}
          </button>
        ) : (
          <span key={c.label} data-p={c.p} className={c.num ? 'lt-r' : undefined}>
            {c.label}
          </span>
        ),
      )}
    </div>
  );
}
