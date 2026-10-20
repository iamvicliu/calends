const SYMBOL: Record<string, string> = {
  CNY: '¥', USD: '$', EUR: '€', GBP: '£', JPY: 'JP¥', HKD: 'HK$', TWD: 'NT$', TRY: '₺', NGN: '₦', PHP: '₱', INR: '₹', KRW: '₩',
  SGD: 'S$', AUD: 'A$', CAD: 'C$', THB: '฿', VND: '₫', RUB: '₽', UAH: '₴', BRL: 'R$', EGP: 'E£', PKR: '₨', KZT: '₸', IDR: 'Rp', MYR: 'RM',
};

export const CURRENCIES = ['CNY', 'USD', 'HKD', 'TWD', 'JPY', 'EUR', 'GBP', 'TRY', 'NGN', 'PHP', 'INR', 'PKR', 'EGP', 'KRW', 'SGD', 'MYR', 'THB', 'VND', 'IDR', 'AUD', 'CAD', 'BRL', 'ARS', 'RUB', 'UAH', 'KZT', 'CHF'];

export function symbol(ccy: string): string {
  return SYMBOL[ccy] ?? ccy + ' ';
}

/** 带币种符号的金额；compact 去掉多余小数 */
export function money(n: number, ccy: string, opts: { compact?: boolean; sign?: boolean; decimals?: number } = {}): string {
  if (!Number.isFinite(n)) return '—';
  const big = Math.abs(n) >= 1000;
  const decimals = opts.decimals ?? (opts.compact ? (big || Number.isInteger(n) ? 0 : 2) : ['JPY', 'KRW', 'VND', 'IDR'].includes(ccy) ? 0 : 2);
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = n < 0 ? '−' : opts.sign && n > 0 ? '+' : '';
  return `${sign}${symbol(ccy)}${s}`;
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

export function cnDate(d: string, withWeek = false): string {
  const [y, m, day] = d.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return `${m}月${day}日${withWeek ? ` · 周${WEEK[w]}` : ''}`;
}

export function cnDateFull(d: string): string {
  const [y] = d.split('-');
  return `${y}年${cnDate(d)}`;
}

export function relDays(n: number): string {
  if (n === 0) return '今天';
  if (n === 1) return '明天';
  if (n === 2) return '后天';
  if (n < 0) return `${-n} 天前`;
  if (n < 60) return `${n} 天后`;
  return `${Math.round(n / 30)} 个月后`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** 国家/地区代码转国旗 emoji：TR → 🇹🇷；不是两位字母则返回空串 */
export function flag(region?: string): string {
  const r = region?.trim().toUpperCase();
  if (!r || !/^[A-Z]{2}$/.test(r)) return '';
  return String.fromCodePoint(...[...r].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}
