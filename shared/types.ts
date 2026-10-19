// 前端与 Worker 共用的数据模型。日期一律用 'YYYY-MM-DD' 字符串，按「日」计算，避免时区漂移。

export type CycleUnit = 'day' | 'week' | 'month' | 'year';

export interface Cycle {
  unit: CycleUnit | 'lifetime';
  every: number;
}

export type SubStatus = 'active' | 'trial' | 'paused' | 'cancelled';

export interface PricePoint {
  /** 自该日起生效 */
  from: string;
  amount: number;
}

export interface ShareMember {
  id: string;
  name: string;
  /** 每期应付金额，币种同订阅 */
  share: number;
  /** 已付至（含）该日；为空表示从未收款 */
  paidUntil?: string;
  contact?: string;
}

export interface Share {
  /** owner = 我是车主，代付全款向他人收钱；member = 我上车，price 记录的是我的那份 */
  role: 'owner' | 'member';
  seats: number;
  members: ShareMember[];
  /** member 时：付给谁 */
  ownerName?: string;
}

/** 订阅的一个阶段：区域、币种、价格、周期、支付方式在阶段内不变（阶段内调价用 priceHistory） */
export interface Phase {
  start: string;
  /** 缺省：下一阶段开始日；最后一个阶段取订阅的 end */
  end?: string;
  price: number;
  currency: string;
  cycle: Cycle;
  methodId?: string;
  region?: string;
  priceHistory?: PricePoint[];
  intro?: { price: number; until: string };
  payments?: Array<{ date: string; amount: number; note?: string }>;
  nextDue?: string;
  note?: string;
}

export interface Subscription {
  id: string;
  name: string;
  icon?: string; // emoji 或图片 URL
  url?: string;
  category: string;
  tags: string[];
  price: number;
  currency: string;
  cycle: Cycle;
  start: string;
  /** 到期/取消日：之后不再扣款 */
  end?: string;
  status: SubStatus;
  trialEnd?: string;
  pausedAt?: string;
  methodId?: string;
  /** App Store 区域等，例如 TR、NG */
  region?: string;
  share?: Share;
  /** 提前几天提醒；空则用全局设置，-1 关闭 */
  remindDays?: number;
  priceHistory?: PricePoint[];
  /**
   * 历程：换区、换套餐、断更后续订。存在时按阶段计费，顶层的价格/币种/周期/支付方式镜像最后一个阶段。
   * 阶段之间有空档即为断更。
   */
  phases?: Phase[];
  /** 域名类订阅：已上线的项目可在公开页显示真实域名，默认打码 */
  showOnPublic?: boolean;
  /** 实际扣款记录：有则以此为准（一次付多年、提前续费、促销价都能准确记录） */
  payments?: Array<{ date: string; amount: number; note?: string }>;
  /** 下次扣款日：之后的扣款从这一天按周期推算 */
  nextDue?: string;
  /** 首期优惠：until 之前的扣款按优惠价，例如首年 5 折 */
  intro?: { price: number; until: string };
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type MethodKind =
  | 'debit'
  | 'credit'
  | 'alipay'
  | 'wechat'
  | 'paypal'
  | 'appstore' // App Store 余额 / 礼品卡
  | 'giftcard'
  | 'phone' // 手机话费余额，如 SMART Load
  | 'crypto'
  | 'other';

export interface PaymentMethod {
  id: string;
  name: string;
  kind: MethodKind;
  currency: string;
  /** 余额类账户才有：asOf 当天的余额 */
  balance?: number;
  balanceAsOf?: string;
  last4?: string;
  color?: string;
  region?: string;
  notes?: string;
  /** 低于多少天续航时提醒 */
  lowRunwayDays?: number;
  /** 返现 / 积分比例（%） */
  cashback?: number;
  /** 卡面品牌：决定 logo 与卡面样式（cmb / plasma / appstore / smart） */
  brand?: string;
}

export interface Settings {
  baseCurrency: string;
  notifyEmail: string;
  remindDays: number;
  notifyHour: number;
  timezone: string;
  publicView: boolean;
  monthlyDigest: boolean;
  icsToken?: string;
  displayName: string;
}

export interface FxTable {
  base: 'USD';
  rates: Record<string, number>;
  fetchedAt: string;
}

/** 历史汇率：date → { CCY: 1 USD 可换多少 } */
export type FxHistory = Record<string, Record<string, number>>;

export interface AppState {
  subscriptions: Subscription[];
  methods: PaymentMethod[];
  settings: Settings;
  fx: FxTable;
  /** 扣款日的历史汇率；缺失的日期用相邻日期或当前汇率兜底 */
  fxHistory?: FxHistory;
  /** 匿名公开视图时为 true（已脱敏、只读） */
  readonly?: boolean;
}

export const BALANCE_KINDS: MethodKind[] = ['appstore', 'giftcard', 'phone', 'paypal', 'alipay', 'wechat', 'crypto'];

export const DEFAULT_SETTINGS: Settings = {
  baseCurrency: 'CNY',
  notifyEmail: 'you@example.com',
  remindDays: 3,
  notifyHour: 9,
  timezone: 'Asia/Shanghai',
  publicView: true,
  monthlyDigest: true,
  displayName: 'Ethan',
};
