import { addDays, addMonths, diffDays } from './billing.ts';
import type { LedgerPeriod } from './receivables.ts';

export type PeriodGridMode = 'months' | 'weeks' | 'periods';
export interface PeriodSegment {
  period: LedgerPeriod;
  /** Zero-based column and number of cells, with no gap inside the segment. */
  column: number;
  span: number;
  start: boolean;
  end: boolean;
}
export interface PeriodGridRow {
  key: string;
  year?: number;
  quarter?: number;
  segments: PeriodSegment[];
}
const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

/** Infer presentation from the derived schedule, including clipped joining/final periods. */
export function periodGridMode(periods: LedgerPeriod[]): PeriodGridMode {
  const spans = periods.map((p, i) => [p.from, periods[i + 1]?.from ?? addDays(p.until, 1)]);
  const monthly = spans.some(([from, next]) => {
    const months = monthIndex(next) - monthIndex(from);
    return months > 0 && addMonths(from, months) === next;
  });
  if (monthly && spans.every(([from, next]) => monthIndex(next) > monthIndex(from))) return 'months';
  if (spans.length && spans.every(([from, next]) => diffDays(from, next) === 7)) return 'weeks';
  return 'periods';
}

/** All started periods plus only the immediately following one, even when later periods are prepaid. */
export function visibleStripPeriods(periods: LedgerPeriod[], today: string): LedgerPeriod[] {
  const sorted = [...periods].sort((a, b) => a.from.localeCompare(b.from));
  const next = sorted.findIndex((p) => p.from > today);
  return next < 0 ? sorted : sorted.slice(0, next + 1);
}

/** Pure presentation: keeps dates, dues and receipt allocation untouched. */
export function periodGrid(periods: LedgerPeriod[], today: string, mode = periodGridMode(periods)) {
  const all = [...periods].sort((a, b) => a.from.localeCompare(b.from));
  const visible = visibleStripPeriods(all, today);
  // A restart can cut two periods inside one month: retain both as individual cells.
  if (mode === 'months' && all.some((p, i) => all[i + 1] && monthIndex(all[i + 1].from) <= monthIndex(p.from))) mode = 'periods';
  const columns = mode === 'weeks' ? 13 : 12;
  const rows: PeriodGridRow[] = [];
  const rowFor = (key: string, year?: number, quarter?: number) => {
    let row = rows.find((r) => r.key === key);
    if (!row) rows.push((row = { key, year, quarter, segments: [] }));
    return row;
  };
  if (mode === 'months') {
    for (const p of visible) {
      const index = all.indexOf(p);
      const first = monthIndex(p.from);
      // Use the next start month, not the overlapping end month (e.g. Jul 17–Jan 16).
      const last = all[index + 1] ? monthIndex(all[index + 1].from) - 1 : monthIndex(p.until);
      for (let cell = first; cell <= last;) {
        const year = Math.floor(cell / 12);
        const end = Math.min(last, year * 12 + 11);
        rowFor(String(year), year).segments.push({ period: p, column: cell % 12, span: end - cell + 1, start: cell === first, end: end === last });
        cell = end + 1;
      }
    }
  } else if (mode === 'weeks' && visible.length) {
    // Thirteen consecutive weeks per row; no duplicated or dropped week at quarter/year edges.
    const first = visible[0].from;
    const quarter = Number(first.slice(0, 4)) * 4 + Math.floor((Number(first.slice(5, 7)) - 1) / 3);
    const quarterStart = `${first.slice(0, 4)}-${String(Math.floor((Number(first.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
    const offset = Math.floor(diffDays(quarterStart, first) / 7);
    for (const p of visible) {
      const week = offset + Math.round(diffDays(first, p.from) / 7);
      const q = quarter + Math.floor(week / 13);
      rowFor(String(q), Math.floor(q / 4), (q % 4) + 1).segments.push({ period: p, column: week % 13, span: 1, start: true, end: true });
    }
  } else {
    // 不按月对齐（自定义天数周期，或改过收费后同一个月里切出两期）：仍按年分行、标出年份，一格一期，一年超过 12 期就换行
    const used = new Map<number, number>();
    for (const p of visible) {
      const year = Number(p.from.slice(0, 4));
      const i = used.get(year) ?? 0;
      used.set(year, i + 1);
      rowFor(`${year}-${Math.floor(i / columns)}`, year).segments.push({ period: p, column: i % columns, span: 1, start: true, end: true });
    }
  }
  return { mode, columns, rows };
}

/** Semantic tooltip data: allocation count refers to the whole recorded payment, including hidden future periods. */
export function periodTipData(p: LedgerPeriod) {
  return {
    from: p.from,
    until: p.until,
    due: p.due,
    currency: p.currency,
    status: p.status,
    receipt: p.receipt
      ? { date: p.receipt.date, amount: p.receipt.amount, currency: p.receipt.currency, count: p.receipt.periods.length, opening: !!p.receipt.opening }
      : undefined,
    note: p.waiver?.note ?? p.receipt?.note,
  };
}
