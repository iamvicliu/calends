import { addDays, addMonths, chargesBetween, convert, effectiveStatus, myShareFactor, parseDay, type Charge } from '../shared/billing.ts';
import type { AppState, MethodKind, Subscription } from '../shared/types.ts';

const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)', 'var(--c9)', 'var(--c10)'];
const FIXED: Record<string, number> = { 工具: 0, 影音: 1, 效率: 2, 音乐: 3, 日用: 4, 教育: 5, 购物: 6, AI: 7, 游戏: 8, 云服务: 9 };

export function catColor(cat: string): string {
  if (cat in FIXED) return PALETTE[FIXED[cat]];
  let h = 0;
  for (const ch of cat) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export const KIND_LABEL: Record<MethodKind, string> = {
  debit: '银行卡',
  credit: '信用卡',
  alipay: '支付宝',
  wechat: '微信支付',
  paypal: 'PayPal',
  appstore: 'App Store 余额',
  giftcard: '礼品卡',
  phone: '手机话费',
  crypto: '加密卡',
  other: '其他',
};

export const KIND_BG: Record<MethodKind, string> = {
  debit: 'linear-gradient(135deg,#2d4f7c,#16263d)',
  credit: 'linear-gradient(135deg,#4a3b6b,#1e1730)',
  alipay: 'linear-gradient(135deg,#1677ff,#0b4fc0)',
  wechat: 'linear-gradient(135deg,#1aad5f,#0d7a40)',
  paypal: 'linear-gradient(135deg,#1b5fb5,#0b2f66)',
  appstore: 'linear-gradient(135deg,#3a8dfd,#7b5cf0 60%,#e2468f)',
  giftcard: 'linear-gradient(135deg,#f08a4b,#c94677)',
  phone: 'linear-gradient(135deg,#2fbf71,#0f7d55)',
  crypto: 'linear-gradient(135deg,#1f2933,#4a3b10)',
  other: 'linear-gradient(135deg,#55626c,#262e34)',
};

export function liveSubs(state: AppState, today: string): Subscription[] {
  return state.subscriptions.filter((s) => {
    const st = effectiveStatus(s, today);
    return st === 'active' || st === 'ending' || st === 'trial';
  });
}

export function toBase(state: AppState, amount: number, ccy: string): number {
  const v = convert(amount, ccy, state.settings.baseCurrency, state.fx);
  return Number.isFinite(v) ? v : 0;
}

export interface MonthBucket {
  key: string; // YYYY-MM
  total: number;
  byCat: Record<string, number>;
  projected: boolean;
  count: number;
}

export function allCharges(state: AppState, from: string, to: string, today: string): Charge[] {
  return state.subscriptions.flatMap((s) => chargesBetween(s, from, to, today)).sort((a, b) => a.date.localeCompare(b.date));
}

export function monthSeries(state: AppState, today: string, back = 23, fwd = 12): MonthBucket[] {
  const first = addMonths(today.slice(0, 8) + '01', -back);
  const last = addMonths(today.slice(0, 8) + '01', fwd + 1);
  const map = new Map<string, MonthBucket>();
  for (let i = 0; i <= back + fwd; i++) {
    const k = addMonths(first, i).slice(0, 7);
    map.set(k, { key: k, total: 0, byCat: {}, projected: k > today.slice(0, 7), count: 0 });
  }
  for (const c of allCharges(state, first, last, today)) {
    const b = map.get(c.date.slice(0, 7));
    if (!b) continue;
    const v = toBase(state, c.amount, c.currency);
    b.total += v;
    b.count++;
    b.byCat[c.sub.category] = (b.byCat[c.sub.category] ?? 0) + v;
  }
  return [...map.values()];
}

export function earliest(state: AppState): string | undefined {
  return state.subscriptions.reduce<string | undefined>((m, s) => (!m || s.start < m ? s.start : m), undefined);
}

export function lifetimeByYear(state: AppState, today: string) {
  const start = earliest(state);
  if (!start) return [];
  const yearEnd = today.slice(0, 4) + '-12-31';
  const rows = new Map<string, { year: string; paid: number; projected: number; count: number }>();
  for (const c of allCharges(state, start, yearEnd, today)) {
    const y = c.date.slice(0, 4);
    const r = rows.get(y) ?? { year: y, paid: 0, projected: 0, count: 0 };
    const v = toBase(state, c.amount, c.currency);
    if (c.projected) r.projected += v;
    else {
      r.paid += v;
      r.count++;
    }
    rows.set(y, r);
  }
  return [...rows.values()].sort((a, b) => a.year.localeCompare(b.year));
}

export function spentSince(state: AppState, from: string, today: string) {
  let total = 0;
  let count = 0;
  const byCcy: Record<string, number> = {};
  for (const c of allCharges(state, from, today, today)) {
    total += toBase(state, c.amount, c.currency);
    byCcy[c.currency] = (byCcy[c.currency] ?? 0) + c.amount;
    count++;
  }
  return { total, count, byCcy };
}

/** 按分组聚合每月成本（我承担的部分） */
export function breakdown(state: AppState, today: string, key: (s: Subscription) => string) {
  const map = new Map<string, { key: string; mrr: number; count: number }>();
  for (const s of liveSubs(state, today)) {
    if (effectiveStatus(s, today) === 'trial') continue;
    const k = key(s);
    const r = map.get(k) ?? { key: k, mrr: 0, count: 0 };
    r.mrr += toBase(state, (s.price * 30.4375) / cycleDaysSafe(s), s.currency) * myShareFactor(s);
    r.count++;
    map.set(k, r);
  }
  return [...map.values()].sort((a, b) => b.mrr - a.mrr);
}

function cycleDaysSafe(s: Subscription): number {
  const c = s.cycle;
  if (c.unit === 'lifetime') return Infinity;
  return { day: 1, week: 7, month: 30.4375, year: 365.25 }[c.unit] * c.every;
}

export function domainOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\.|^ww\./, '');
  } catch {
    return undefined;
  }
}

export type Period = 'day' | 'week' | 'month' | 'year';
export const PERIOD_LABEL: Record<Period, string> = { day: '今日', week: '本周', month: '本月', year: '今年' };
export const PERIOD_UNIT: Record<Period, string> = { day: '日', week: '周', month: '月', year: '年' };

/** 当前周期向前/后偏移 offset 个周期的 [from, to]（含两端） */
export function periodRange(p: Period, today: string, offset = 0): [string, string] {
  if (p === 'day') {
    const d = addDays(today, offset);
    return [d, d];
  }
  if (p === 'week') {
    const dow = (new Date(parseDay(today)).getUTCDay() + 6) % 7;
    const from = addDays(today, -dow + offset * 7);
    return [from, addDays(from, 6)];
  }
  if (p === 'month') {
    const from = addMonths(today.slice(0, 8) + '01', offset);
    return [from, addDays(addMonths(from, 1), -1)];
  }
  const y = Number(today.slice(0, 4)) + offset;
  return [`${y}-01-01`, `${y}-12-31`];
}

export function sumBase(state: AppState, charges: Charge[]): number {
  return charges.reduce((a, c) => a + toBase(state, c.amount, c.currency), 0);
}
