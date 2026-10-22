import { addDays, addMonths, chargesBetween, currentPhase, cycleDays, effectiveStatus, phaseSubs, type Charge } from '../../../shared/billing.ts';
import type { Subscription } from '../../../shared/types.ts';

/** 短周期保留一年节奏；稀疏扣款只展示下一笔，查询范围覆盖多年周期。 */
export function detailForecast(sub: Subscription, today: string) {
  if (sub.cycle.unit === 'lifetime') return { sparse: true, charges: [] };
  const from = addDays(today, 1);
  const ended = ['ended', 'terminated'].includes(effectiveStatus(sub, today));
  const cur = currentPhase(sub, today);
  const charges = ended ? [] : chargesBetween(sub, from, addMonths(today, 12), today).filter((c) => !c.kind);
  const sparse = cycleDays(cur.cycle) >= 365 || charges.length <= 2;
  if (!sparse) return { sparse, charges };
  const span = Math.max(
    366,
    ...phaseSubs(sub)
      .filter((p) => p.cycle.unit !== 'lifetime')
      .map((p) => Math.ceil(cycleDays(p.cycle)) + 31),
  );
  const next = ended ? undefined : (charges[0] ?? chargesBetween(sub, from, addDays(today, span), today).find((c) => !c.kind));
  return { sparse, charges: next ? [next] : [] };
}

/** 与扣款表共用默认年份和可见行数，避免侧栏判断与实际内容脱节。 */
export function detailChargeHistory(history: Charge[], today: string) {
  const years = history.map((c) => c.date.slice(0, 4));
  const thisYear = today.slice(0, 4);
  const defaultYear = years.includes(thisYear) ? thisYear : years.reduce((latest, year) => (year > latest ? year : latest), '');
  const grouped = new Set(years).size > 1;
  const defaultRowCount = years.filter((year) => year === defaultYear).length + (grouped ? 1 : 0);
  return { defaultYear, grouped, defaultRowCount };
}
