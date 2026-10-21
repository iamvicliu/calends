import { intlLocale, t } from './i18n.ts';

const SYMBOL: Record<string, string> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: 'JP¥',
  HKD: 'HK$',
  TWD: 'NT$',
  TRY: '₺',
  NGN: '₦',
  PHP: '₱',
  INR: '₹',
  KRW: '₩',
  SGD: 'S$',
  AUD: 'A$',
  CAD: 'C$',
  THB: '฿',
  VND: '₫',
  RUB: '₽',
  UAH: '₴',
  BRL: 'R$',
  EGP: 'E£',
  PKR: '₨',
  KZT: '₸',
  IDR: 'Rp',
  MYR: 'RM',
};

export const CURRENCIES = [
  'CNY',
  'USD',
  'HKD',
  'TWD',
  'JPY',
  'EUR',
  'GBP',
  'TRY',
  'NGN',
  'PHP',
  'INR',
  'PKR',
  'EGP',
  'KRW',
  'SGD',
  'MYR',
  'THB',
  'VND',
  'IDR',
  'AUD',
  'CAD',
  'BRL',
  'ARS',
  'RUB',
  'UAH',
  'KZT',
  'CHF',
];

export function symbol(ccy: string): string {
  return SYMBOL[ccy] ?? ccy + ' ';
}

/** 带币种符号的金额；compact 去掉多余小数。数字分组跟随当前语言 */
export function money(n: number, ccy: string, opts: { compact?: boolean; sign?: boolean; decimals?: number } = {}): string {
  if (!Number.isFinite(n)) return '—';
  const big = Math.abs(n) >= 1000;
  const decimals = opts.decimals ?? (opts.compact ? (big || Number.isInteger(n) ? 0 : 2) : ['JPY', 'KRW', 'VND', 'IDR'].includes(ccy) ? 0 : 2);
  const s = Math.abs(n).toLocaleString(intlLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = n < 0 ? '−' : opts.sign && n > 0 ? '+' : '';
  return `${sign}${symbol(ccy)}${s}`;
}

let signedAmounts = true;

/** 只控制收支展示，不改变 money() 的标价及对比差额语义。 */
export function setSignedAmounts(on: boolean): void {
  signedAmounts = on;
}

/** 收支符号：负数流出，正数流入，零不带符号。 */
export function flowSign(n: number): string {
  return signedAmounts && Number.isFinite(n) ? (n < 0 ? '−' : n > 0 ? '+' : '') : '';
}

/** 带方向的收支金额；格式选项与 money() 一致。 */
export function flow(n: number, ccy: string, opts: { compact?: boolean; decimals?: number } = {}): string {
  return `${flowSign(n)}${money(Math.abs(n), ccy, opts)}`;
}

/** 日期字符串（YYYY-MM-DD）按当前语言格式化；按 UTC 解析，避免时区把日期挪一天 */
function fmtDate(d: string, o: Intl.DateTimeFormatOptions): string {
  const [y, m, day] = d.split('-').map(Number);
  return new Intl.DateTimeFormat(intlLocale(), { ...o, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, day)));
}

/** 「10月20日」「Oct 20」；withWeek 附带星期 */
export function cnDate(d: string, withWeek = false): string {
  const s = fmtDate(d, { month: 'short', day: 'numeric' });
  return withWeek ? `${s} · ${fmtDate(d, { weekday: 'short' })}` : s;
}

/** 星期几的简写：「周一」「Mon」 */
export function weekdayOf(d: string): string {
  return fmtDate(d, { weekday: 'short' });
}

/** 今年的日期省略年份，往年的带上年份，避免「1月17日」到底是哪一年的歧义 */
export function cnDateAuto(d: string, today: string): string {
  return d.slice(0, 4) === today.slice(0, 4) ? cnDate(d) : cnDateFull(d);
}

/** 「2026年10月20日」「Oct 20, 2026」 */
export function cnDateFull(d: string): string {
  return fmtDate(d, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** 「2026年10月」「Oct 2026」；month 为 YYYY-MM */
export function monthLabel(month: string, opts: { year?: boolean; long?: boolean } = {}): string {
  return fmtDate(`${month}-01`, { month: opts.long ? 'long' : 'short', ...(opts.year === false ? {} : { year: 'numeric' }) });
}

/** 星期几的简称，0 = 周日 */
export function weekdayShort(i: number, narrow = false): string {
  // 2023-01-01 是周日
  return fmtDate(`2023-01-0${i + 1}`, { weekday: narrow ? 'narrow' : 'short' });
}

/** 今天、明天、3 天后、2 个月后 */
export function relDays(n: number): string {
  const rtf = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto' });
  return Math.abs(n) < 60 ? rtf.format(n, 'day') : rtf.format(Math.round(n / 30), 'month');
}

/** 合租收费周期的文字：按月、按季……不在常用选项里的写成「按 N 个月」 */
export function billLabel(months?: number): string {
  const m = months ?? 1;
  return [1, 3, 6, 12].includes(m) ? t(`core.bill.m${m}`) : t('core.bill.custom', { count: m });
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** 把服务端的 UTC 时间（ISO 或 SQLite 的「YYYY-MM-DD HH:MM:SS」）按设置的时区显示成「2026-10-20 19:03」；dateOnly 只要日期 */
export function localTime(raw: string, timeZone: string, dateOnly = false): string {
  const iso = /[TZ]/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return raw;
  const s = d.toLocaleString('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  return dateOnly ? s.slice(0, 10) : s.slice(0, 16);
}
