/**
 * Intl 格式化器缓存。构造 DateTimeFormat / NumberFormat 远比 format() 本身贵，
 * 时间轴一次平移会格式化几千个日期；按 locale + 选项复用实例。
 * 选项组合与语言都是有限集合，缓存不会无界增长。构造失败（如非法时区）照常抛出，不进缓存。
 */
const dateCache = new Map<string, Intl.DateTimeFormat>();
const numberCache = new Map<string, Intl.NumberFormat>();
const relativeCache = new Map<string, Intl.RelativeTimeFormat>();

function key(locale: string, options: object): string {
  return `${locale}\u0000${JSON.stringify(options)}`;
}

export function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = key(locale, options);
  let f = dateCache.get(k);
  if (!f) dateCache.set(k, (f = new Intl.DateTimeFormat(locale, options)));
  return f;
}

export function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const k = key(locale, options);
  let f = numberCache.get(k);
  if (!f) numberCache.set(k, (f = new Intl.NumberFormat(locale, options)));
  return f;
}

export function relativeFormat(locale: string, options: Intl.RelativeTimeFormatOptions): Intl.RelativeTimeFormat {
  const k = key(locale, options);
  let f = relativeCache.get(k);
  if (!f) relativeCache.set(k, (f = new Intl.RelativeTimeFormat(locale, options)));
  return f;
}
