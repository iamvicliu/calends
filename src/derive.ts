import { addDays, addMonths, chargesBetween, convert, effectiveStatus, parseDay, type Charge } from '../shared/billing.ts';
import { chargeValue } from '../shared/fx.ts';
import { flag } from '../shared/format.ts';
import type { AppState, CardNetwork, MethodKind, PaymentMethod, Subscription } from '../shared/types.ts';
import { BANKS } from './banks.ts';

const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)', 'var(--c9)', 'var(--c10)'];
const FIXED: Record<string, number> = { 工具: 0, 影音: 1, 效率: 2, 音乐: 3, 日用: 4, 教育: 5, 购物: 6, AI: 7, 游戏: 8, 域名: 9 };

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
  googleplay: 'Google Play 余额',
  giftcard: '礼品卡',
  prepaid: '商家余额',
  phone: '手机话费',
  crypto: '加密卡',
  other: '其他',
};

// 卡面底色：中性石墨或品牌纯色，不用蓝紫渐变；App Store 卡另有钛金属卡面
export const KIND_BG: Record<MethodKind, string> = {
  debit: 'linear-gradient(135deg,#3a3f47,#1c1f24)',
  credit: 'linear-gradient(135deg,#2c2c30,#111113)',
  alipay: '#1677ff',
  wechat: '#07c160',
  paypal: '#003087',
  appstore: 'linear-gradient(135deg,#fbfbfd,#e4e4e8)',
  googleplay: '#ffffff',
  giftcard: 'linear-gradient(135deg,#f08a4b,#d4532b)',
  prepaid: 'linear-gradient(135deg,#3a3f47,#1c1f24)',
  phone: 'linear-gradient(135deg,#2fbf71,#0f7d55)',
  crypto: 'linear-gradient(135deg,#1f2933,#4a3b10)',
  other: 'linear-gradient(135deg,#55626c,#262e34)',
};

/**
 * 平台品牌：这几类支付方式本身就是一个平台，选了类型就自动用它的 logo。
 * 其余的（银行卡从银行列表选；加密卡、商家余额、运营商等）由用户自己设 logo，不在代码里写死某一家。
 */
interface Brand {
  key: string;
  name: string;
  logo: string;
  kinds: MethodKind[];
  /** logo 是白色的，放在品牌色底上 */
  onColor?: boolean;
}
export const BRANDS: Brand[] = [
  { key: 'appstore', name: 'App Store', logo: '/brands/appstore.svg', kinds: ['appstore'] },
  { key: 'googleplay', name: 'Google Play', logo: '/brands/googleplay.svg', kinds: ['googleplay'] },
  { key: 'paypal', name: 'PayPal', logo: '/brands/paypal.svg', kinds: ['paypal'], onColor: true },
  { key: 'alipay', name: '支付宝', logo: '/brands/alipay.svg', kinds: ['alipay'], onColor: true },
  { key: 'wechat', name: '微信支付', logo: '/brands/wechat.svg', kinds: ['wechat'], onColor: true },
];

/** 卡面品牌 logo */
const BRAND_LOGO: Record<string, string> = Object.fromEntries(BRANDS.map((b) => [b.key, b.logo]));

/** 平台品牌（只按类型认） */
export function brandOf(m: Pick<PaymentMethod, 'kind'>): string | undefined {
  return BRANDS.find((b) => b.kinds.includes(m.kind))?.key;
}

/** 支付方式的 logo：自定义 > 平台品牌 > 官网图标；银行卡没设自定义时用银行图标集（见 bankOf） */
export function methodLogo(m: Pick<PaymentMethod, 'logo' | 'kind' | 'url' | 'bank' | 'name'>): string | undefined {
  if (m.logo) return m.logo;
  const b = brandOf(m);
  if (b) return BRAND_LOGO[b];
  if (bankOf(m)) return undefined;
  return faviconOf(m.url);
}

/** 只用一种货币的国家：没填地区时，App Store、礼品卡、话费按币种推断国旗 */
const CCY_REGION: Record<string, string> = { CNY: 'CN', TRY: 'TR', NGN: 'NG', PHP: 'PH', JPY: 'JP', HKD: 'HK', TWD: 'TW', KRW: 'KR', INR: 'IN', PKR: 'PK', EGP: 'EG', BRL: 'BR', ARS: 'AR', GBP: 'GB', MYR: 'MY', THB: 'TH', VND: 'VN', IDR: 'ID', SGD: 'SG', CAD: 'CA', AUD: 'AU', RUB: 'RU', UAH: 'UA', KZT: 'KZ', CHF: 'CH', MXN: 'MX' };

/** 支付方式所属的地区：填了就用填的；按地区区分的账户（App Store、礼品卡、话费）没填时看币种 */
export function methodRegion(m: Pick<PaymentMethod, 'region' | 'kind' | 'currency'>): string | undefined {
  if (m.region) return m.region;
  if (['appstore', 'googleplay', 'giftcard', 'phone'].includes(m.kind)) return CCY_REGION[m.currency];
  return undefined;
}

/** 卡组织名称；图标在 public/networks（datatrans/payment-logos，CC BY-SA 4.0） */
export const NETWORKS: Record<CardNetwork, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  unionpay: '银联',
  jcb: 'JCB',
  'american-express': 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  maestro: 'Maestro',
};

/** 银行卡对应的银行图标：手动指定优先，否则按名称里的银行名识别（招商银行 → cmbchina） */
export function bankOf(m: Pick<PaymentMethod, 'name' | 'kind' | 'bank'>): string | undefined {
  if (m.bank) return m.bank;
  if (m.kind !== 'debit' && m.kind !== 'credit') return undefined;
  return BANKS.find(([name]) => m.name.includes(name))?.[1];
}

/** 支付方式显示名：有地区的前面加国旗，一眼分清土耳其区、尼日利亚区 */
export function methodName(m: Pick<PaymentMethod, 'name' | 'region' | 'kind' | 'currency'>): string {
  const f = flag(methodRegion(m));
  return f ? `${f} ${m.name}` : m.name;
}

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

/** 区间内的扣款。默认不含代付（那是替别人付的，不算我的支出）；日历等需要看卡上实际扣款时传 withProxy */
export function allCharges(state: AppState, from: string, to: string, today: string, withProxy = false): Charge[] {
  return state.subscriptions
    .filter((s) => withProxy || !s.proxy)
    .flatMap((s) => chargesBetween(s, from, to, today))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 官网图标（Google favicon 服务） */
export function faviconOf(url?: string): string | undefined {
  const d = domainOf(url);
  return d ? `https://www.google.com/s2/favicons?domain=${d}&sz=128` : undefined;
}

/** 订阅的图片图标，用作卡片和详情的背景光晕：图片链接 > 官网图标；域名类不用 */
export function subImage(s: Pick<Subscription, 'category' | 'icon' | 'url'>): string | undefined {
  if (s.category === '域名') return undefined;
  if (s.icon?.startsWith('http')) return s.icon;
  return faviconOf(s.url);
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
  return charges.reduce((a, c) => a + chargeValue(state, c), 0);
}
