import { addDays, addMonths, diffDays, parseDay } from './billing.ts';
import { dateFormat } from './intl.ts';

export type GanttZoom = '3m' | '6m' | '1y' | '3y' | 'all';
export const isGanttZoom = (v: string): v is GanttZoom => ['3m', '6m', '1y', '3y', 'all'].includes(v);
export const GANTT_STEP: Record<Exclude<GanttZoom, 'all'>, number> = { '3m': 3, '6m': 6, '1y': 12, '3y': 36 };

/** 名称列以图标为下限、最长名称为上限，至少给轨道留出一半容器。 */
export function ganttLabelBounds(
  textWidth: number,
  containerWidth: number,
  style: { paddingLeft: number; paddingRight: number; iconWidth: number; gap: number },
  defaultWidth = 200,
): { min: number; max: number; default: number } {
  const min = Math.ceil(style.paddingLeft + style.iconWidth + style.paddingRight);
  const full = Math.ceil(min + (textWidth > 0 ? style.gap + textWidth : 0));
  const max = Math.max(min, Math.min(full, containerWidth > 0 ? Math.floor(containerWidth / 2) : full));
  return { min, max, default: Math.max(min, Math.min(defaultWidth, max)) };
}

/** 今天留在中偏右；短范围仍保留足够的未来空间。全部从最早一笔的月初开始。 */
export function ganttWindow(zoom: GanttZoom, today: string, earliest = today): { start: string; end: string } {
  switch (zoom) {
    case '3m':
      return { start: addMonths(today, -2), end: addMonths(today, 1) };
    case '6m':
      return { start: addDays(addMonths(today, -4), -15), end: addDays(addMonths(today, 2), -15) };
    case '1y':
      return { start: addMonths(today, -9), end: addMonths(today, 3) };
    case '3y':
      return { start: addMonths(today, -30), end: addMonths(today, 6) };
    case 'all':
      return { start: `${earliest.slice(0, 7)}-01`, end: addMonths(today, 6) };
  }
}

/** 吸附到最近的月份锚点，保留基准日号；短月夹紧到月底，不产生 2/31 等无效日期。 */
export function snapGanttPan(baseStart: string, raw: number): number {
  const day = addDays(baseStart, Math.round(raw));
  const month = monthDistance(baseStart, day);
  const candidates = [month - 1, month, month + 1].map((n) => diffDays(baseStart, addMonths(baseStart, n)));
  return candidates.reduce((best, n) => (Math.abs(n - raw) < Math.abs(best - raw) ? n : best));
}

function monthDistance(from: string, to: string): number {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
}

/** 翻页也沿用基准日号，跨过二月后再返回不会逐渐漂离月份锚点。 */
export function stepGanttPan(baseStart: string, raw: number, months: number): number {
  const month = monthDistance(baseStart, addDays(baseStart, snapGanttPan(baseStart, raw)));
  return diffDays(baseStart, addMonths(baseStart, month + months));
}

export interface GanttTick {
  d: string;
  major: boolean;
  label: string;
  labelX: number;
}

/** 网格与文字独立：3 个月按周，半年按半月；窄屏保留细网格，文字按宽度抽稀。 */
export function ganttTicks(zoom: GanttZoom, start: string, end: string, width: number, locale: string): GanttTick[] {
  if (width <= 0) return [];
  const short = zoom === '3m' || zoom === '6m';
  const k = width / Math.max(1, diffDays(start, end));
  const fmt = dateFormat(locale, { timeZone: 'UTC', ...(short ? { month: 'numeric', day: 'numeric' } : { month: 'short' }) });
  const dates: string[] = [];
  if (zoom === '3m') {
    const weekday = new Date(parseDay(start)).getUTCDay();
    for (let d = addDays(start, (8 - weekday) % 7); d <= end; d = addDays(d, 7)) dates.push(d);
  } else {
    const monthPx = k * 30.4;
    const every = [1, 2, 3, 6, 12].find((n) => n >= (zoom === '3y' ? 3 : 1) && monthPx * n >= 40) ?? 12;
    for (let d = `${start.slice(0, 7)}-01`; d <= end; d = addMonths(d, 1)) {
      if (zoom === '6m') {
        if (d >= start) dates.push(d);
        const mid = `${d.slice(0, 7)}-15`;
        if (mid >= start && mid <= end) dates.push(mid);
      } else if (d >= start && (d.slice(5, 7) === '01' || (zoom !== 'all' && (Number(d.slice(5, 7)) - 1) % every === 0))) dates.push(d);
    }
  }
  let labelEnd = -8;
  return dates.map((d) => {
    const major = short ? Number(d.slice(8)) <= (zoom === '3m' ? 7 : 1) : d.slice(5, 7) === '01';
    const text = !short && major ? d.slice(0, 4) : fmt.format(new Date(parseDay(d)));
    // 11px 字号保守预留字符宽度与两端空隙；标签中心夹在轨道内，避免边缘截字。
    const labelWidth = Array.from(text).reduce((n, c) => n + (c.codePointAt(0)! > 0x024f ? 12 : 8), 0);
    const labelX = Math.min(width - labelWidth / 2, Math.max(labelWidth / 2, diffDays(start, d) * k));
    const fits = labelWidth <= width && labelX - labelWidth / 2 >= labelEnd + 8;
    if (fits) labelEnd = labelX + labelWidth / 2;
    return { d, major, label: fits ? text : '', labelX };
  });
}
