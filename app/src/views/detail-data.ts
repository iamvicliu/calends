import { addDays, addMonths, chargeServicePeriod, chargesBetween, currentPhase, cycleDays, effectiveStatus, phaseSubs } from '../../../shared/billing.ts';
import type { Subscription } from '../../../shared/types.ts';

/** Display boundary only: an undated stop never becomes a persisted service end. */
export function detailHistoryEnd(sub: Subscription, today: string): { date: string | undefined; unknown: boolean } {
  const status = effectiveStatus(sub, today);
  if (!['ended', 'terminated', 'paused'].includes(status)) return { date: undefined, unknown: false };
  const known = sub.stop?.date ?? (status === 'paused' && sub.pausedAt ? addDays(sub.pausedAt, -1) : sub.end);
  if (known && known <= today) return { date: known, unknown: false };
  if (sub.phases?.length) {
    const ends = phaseSubs(sub)
      .filter((p) => p.start <= today)
      .map((p) => detailHistoryEnd(p, today));
    return {
      date: ends
        .map((e) => e.date)
        .filter((d): d is string => !!d)
        .sort()
        .at(-1),
      unknown: ends.some((e) => e.unknown),
    };
  }
  const last =
    (sub.payments ?? [])
      .filter((p) => !p.kind && p.date <= today)
      .map((p) => p.date)
      .sort()
      .at(-1) ?? sub.start;
  const coverage = sub.cycle.unit === 'lifetime' ? last : addDays(chargeServicePeriod(sub, last).until, -1);
  // An already-disposed service can have prepaid time left. Do not draw that as future ownership.
  return { date: coverage < today ? coverage : last, unknown: true };
}

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
