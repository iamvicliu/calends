import type { Prefs } from './prefs.ts';
// 前端与 Worker 共用的数据模型。日期一律用 'YYYY-MM-DD' 字符串，按「日」计算，避免时区漂移。
import { t } from './i18n.ts';
import type { Category } from './categories.ts';

export type CycleUnit = 'day' | 'week' | 'month' | 'year';

export interface Cycle {
  unit: CycleUnit | 'lifetime';
  every: number;
}

export type SubStatus = 'active' | 'trial' | 'paused' | 'cancelled';

/** 一笔实际发生的钱。amount 是订阅币种的金额（退款为负）；settled 是卡上实际扣的币种和金额（不同时才填） */
export interface Payment {
  date: string;
  amount: number;
  note?: string;
  /** 缺省为正常扣款；refund 退款、adjust 补差（升级补差价等）、failed 扣款失败（不计入支出） */
  kind?: 'refund' | 'adjust' | 'failed';
  settled?: { amount: number; currency: string };
}

export interface PricePoint {
  /** 自该日起生效 */
  from: string;
  amount: number;
}

export interface ShareMember {
  id: string;
  /** 关联的人（people 名册）；有则以那个人的称呼、联系方式为准，下面的 name、contact 是镜像副本，老数据只有副本 */
  personId?: string;
  name: string;
  /** 每期应付金额，币种同订阅 */
  share: number;
  /** 已付至（含）该日；为空表示从未收款 */
  paidUntil?: string;
  /** 联系方式：渠道（Telegram、微信、邮箱…）+ 账号 / ID */
  contactVia?: string;
  contact?: string;
  /** 旧字段：早期单独记的 Telegram，读取时当作 contactVia = Telegram */
  tg?: string;
  /** 来源：从哪个群 / 渠道来的 */
  source?: string;
  /** 受邀账号：被邀请进家庭组的邮箱（多数服务用邮箱邀请） */
  account?: string;
  /** 不分摊：占一个位置但不交钱（比如自己的另一个账号、家人） */
  exempt?: boolean;
  /** 每次收多少（按收费周期），币种默认人民币；每期份额 share 由它按汇率换算得出 */
  fee?: number;
  feeCurrency?: string;
  /** 收费周期（月）：1 按月、3 按季、12 按年；缺省按月 */
  billEvery?: number;
  /** 收款记录 */
  payments?: MemberPayment[];
  note?: string;
  /** 加入日；缺省为开始合租那天 */
  joined?: string;
  /** 退出日：之后不再占座、不再计应收，历史收款保留 */
  left?: string;
}

/** 合租成员的一笔收款：收了多少、覆盖到哪天 */
export interface MemberPayment {
  date: string;
  amount: number;
  currency: string;
  /** 这笔钱覆盖的起始日 */
  from?: string;
  /** 这笔钱付到（含）哪一天 */
  until: string;
  note?: string;
}

export interface Share {
  /** owner = 我发起合租，代付全款向他人收钱；member = 我加入合租，price 记录的是我的那份 */
  role: 'owner' | 'member';
  seats: number;
  members: ShareMember[];
  /** member 时：付给谁 */
  ownerName?: string;
  /** 开始合租的日期：从这天起统计我付了多少、收回多少 */
  since?: string;
}

/** 代付的一期：卡上实扣多少（订阅币种），对方还了多少（币种可以不同，比如扣日元、收人民币） */
export interface ProxyEntry {
  /** 对应哪一期扣款（扣款日） */
  charge: string;
  /** 卡上实际扣款金额，缺省按订阅价格 */
  charged?: number;
  /** 实扣币种：卡按自己的币种结算时与订阅币种不同（订阅 JPY、Bybit 卡扣 USD）；缺省同订阅 */
  chargedCurrency?: string;
  /** 收回的金额；为空表示还没收 */
  received?: number;
  receivedCurrency?: string;
  /** 实际收到的日期，用于按当天汇率折算 */
  receivedOn?: string;
  note?: string;
}

/** 代付：替别人付的订阅。钱从我的卡上扣，但不算我的支出，每期向对方收回 */
export interface Proxy {
  /** 关联的人（people 名册）；forName、contact 是镜像副本，老数据只有副本 */
  personId?: string;
  /** 替谁付 */
  forName: string;
  /** 对方的联系方式：渠道 + 账号，与合租成员一致 */
  contactVia?: string;
  contact?: string;
  /** 一句话备注，如「同事，月底转账」 */
  note?: string;
  entries: ProxyEntry[];
}

/** 头像底色：只存色名，显示时按主题取色 */
export const PERSON_COLORS = ['blue', 'green', 'orange', 'pink', 'purple', 'teal', 'indigo', 'red'] as const;
export type PersonColor = (typeof PERSON_COLORS)[number];

/** 名册里的一个人：同一位朋友在多个合租、代付里只记一次，改联系方式处处生效 */
export interface Person {
  id: string;
  name: string;
  contactVia?: string;
  contact?: string;
  note?: string;
  color?: PersonColor;
  createdAt?: string;
}

/** 订阅的一个阶段：区域、币种、价格、周期、支付方式在阶段内不变（阶段内调价用 priceHistory） */
export interface Phase {
  start: string;
  /** 最后服务日（含）；缺省为下一阶段开始前一天，最后一段取订阅的 end */
  end?: string;
  price: number;
  currency: string;
  cycle: Cycle;
  methodId?: string;
  region?: string;
  priceHistory?: PricePoint[];
  intro?: { price: number; until: string };
  /** 赠送时长（如买一年送一年）：[from, until) 期间不扣款，之后从 until 起重新按周期扣 */
  bonus?: { from: string; until: string };
  payments?: Payment[];
  nextDue?: string;
  note?: string;
  /** 只是打算（比如到期后可能改年付），还没确定；照常计入预测，界面上标「计划」，可一键确认或取消 */
  planned?: boolean;
}

export interface Subscription {
  id: string;
  name: string;
  icon?: string; // emoji 或图片 URL
  url?: string;
  /** 管理页：家庭组成员、账单、续费设置所在的页面（如 Spotify Family、1Password People） */
  manageUrl?: string;
  category: string;
  tags: string[];
  price: number;
  currency: string;
  cycle: Cycle;
  start: string;
  /** 最后服务日（含当天）：次日结束，不再产生预测扣款 */
  end?: string;
  status: SubStatus;
  /** 首个付费日；前一天为试用最后一天 */
  trialEnd?: string;
  pausedAt?: string;
  methodId?: string;
  /** App Store 区域等，例如 TR、NG */
  region?: string;
  share?: Share;
  /** 代付：有则不计入我的支出，单独记账 */
  proxy?: Proxy;
  /** 提前几天提醒；空则用全局设置，-1 关闭 */
  remindDays?: number;
  /** 服务到期日（如域名）；与扣款日不同，自动续费可能提前若干天扣款 */
  expires?: string;
  /** 由阶段展开时带上：这一段只是计划 */
  planned?: boolean;
  priceHistory?: PricePoint[];
  /**
   * 历程：换区、换套餐、断更后续订。存在时按阶段计费，顶层的价格/币种/周期/支付方式镜像最后一个阶段。
   * 阶段之间有空档即为断更。
   */
  phases?: Phase[];
  /** 域名类订阅：已上线的项目可在公开页显示真实域名，默认打码 */
  showOnPublic?: boolean;
  /** 实际扣款记录：有则以此为准（一次付多年、提前续费、促销价都能准确记录） */
  payments?: Payment[];
  /** 下次扣款日：之后的扣款从这一天按周期推算 */
  nextDue?: string;
  /** 首期优惠：until 之前的扣款按优惠价，例如首年 5 折 */
  intro?: { price: number; until: string };
  /** 赠送时长（如买一年送一年）：[from, until) 期间不扣款，之后从 until 起重新按周期扣 */
  bonus?: { from: string; until: string };
  /** 登录账号：邮箱、手机号或用户名（通信类就是手机号）。公开页不下发 */
  account?: string;
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
  | 'googleplay' // Google Play 余额
  | 'giftcard'
  | 'prepaid' // 商家账户余额：先充值，扣费从余额里走（如 Uzuma）
  | 'phone' // 手机话费余额，如 SMART Load
  | 'crypto'
  | 'other';

export type CardNetwork = 'visa' | 'mastercard' | 'unionpay' | 'jcb' | 'american-express' | 'discover' | 'diners' | 'maestro';

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
  /** 旧字段：早期写死的品牌标识，现只认 App Store、PayPal、支付宝、微信支付这类平台 */
  brand?: string;
  /** 自定义 logo：图片链接，或上传后的 data URL；优先于银行图标 */
  logo?: string;
  /** logo 是横向字标（如 BYBIT、SMART），卡面上按宽版显示 */
  logoWide?: boolean;
  /** 钱包里的排列顺序，越小越靠前；缺省排在最后 */
  order?: number;
  /** 银行图标（public/banks 下的文件名）；缺省时按名称自动识别 */
  bank?: string;
  /** 卡组织：Visa、Mastercard、银联等 */
  network?: CardNetwork;
  /** 手机号（手机话费类）：只在后台显示，公开页不下发 */
  phone?: string;
  /** 官网或充值页（如商家余额的充值入口） */
  url?: string;
  /** 充值记录：充进多少（账户币种），以及实际花了多少（如买礼品卡的人民币成本） */
  topUps?: TopUp[];
}

export interface TopUp {
  date: string;
  amount: number;
  cost?: number;
  costCurrency?: string;
  note?: string;
}

export type ChannelKind = 'email' | 'telegram' | 'lark' | 'dingtalk' | 'wecom' | 'bark' | 'ntfy' | 'serverchan' | 'discord' | 'slack' | 'webhook';

/** 一个通知渠道：同一份提醒会发到所有开着的渠道。config 里是该渠道的地址、令牌等（只存在后台，公开页不下发） */
export interface Channel {
  id: string;
  kind: ChannelKind;
  name: string;
  enabled: boolean;
  config: Record<string, string>;
}

export interface Settings {
  baseCurrency: string;
  /** 通知渠道；为空时沿用 notifyEmail 作为唯一的邮件渠道 */
  channels?: Channel[];
  /** 合租向成员收款的默认币种；缺省同本位币 */
  collectCurrency?: string;
  /** 新建订阅默认的支付方式 */
  defaultMethodId?: string;
  notifyEmail: string;
  remindDays: number;
  notifyHour: number;
  timezone: string;
  publicView: boolean;
  /** 公开页不展示的订阅 id；缺省全部展示，新加的订阅默认也展示 */
  publicHidden?: string[];
  monthlyDigest: boolean;
  icsToken?: string;
  displayName: string;
  /** 侧边栏、公开页与合租里「我」的头像：图片链接或上传后的 data URL；缺省用 Calends 图标 */
  avatar?: string;
  /** 公开页标题（页头和浏览器页签）；缺省「名字的订阅」 */
  publicTitle?: string;
  /** 侧边栏显示「即将扣款」，以及往后看多少天；缺省显示、45 天 */
  sidebarUpcoming?: boolean;
  /** 侧边栏「即将扣款」往后看几天；0 = 看到本月月底 */
  upcomingDays?: number;
  /** 侧边栏里隐藏的模块（路由名） */
  hiddenNav?: string[];
  /** 侧边栏模块的顺序（overview、list、calendar…），用户在设置里拖出来的；没列到的按默认位置 */
  navOrder?: string[];
  /** 打开后台时进入的页面（路由名，空为概览） */
  startPage?: string;
  /** 每周从哪天开始：1 周一（缺省）、0 周日 */
  weekStart?: 0 | 1;
  /** AI 接入（MCP）总开关；关闭后 /mcp 拒绝所有请求；缺省开启 */
  aiEnabled?: boolean;
  /** 最多同时登录的设备数；超出时最久未活动的设备被挤下线；缺省 10 */
  maxSessions?: number;
  /** 分类注册表（名称、图标、颜色），顺序即显示顺序；缺省按内置预设和已用分类推导，见 shared/categories.ts */
  categories?: Category[];
  /** 界面、提醒邮件、MCP 的语言；缺省跟随浏览器 */
  language?: string;
  /** 跟随浏览器时，后台最近一次实际使用的语言（提醒邮件、MCP 用它） */
  languageSeen?: string;
  /** 站点地址：没配置 SITE_URL 时，后台访问时记下，供定时提醒里的链接使用 */
  siteUrl?: string;
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
  /** 人：合租成员、代付对象的名册（公开页不下发） */
  people?: Person[];
  settings: Settings;
  fx: FxTable;
  /** 扣款日的历史汇率；缺失的日期用相邻日期或当前汇率兜底 */
  fxHistory?: FxHistory;
  /** 界面配置（视图、排序、主题等），多台设备同步；公开页不下发 */
  prefs?: Prefs;
  /** 匿名公开视图时为 true（已脱敏、只读） */
  readonly?: boolean;
  /** 公开可编辑的演示账本 */
  demo?: boolean;
}

export const BALANCE_KINDS: MethodKind[] = ['appstore', 'googleplay', 'giftcard', 'prepaid', 'phone', 'paypal', 'alipay', 'wechat', 'crypto'];

/** 头像地址：没设置时用产品图标 */
export const avatarOf = (s: Pick<Settings, 'avatar'>) => s.avatar || '/icons/logo.svg';

export const DEFAULT_SETTINGS: Settings = {
  baseCurrency: 'USD',
  notifyEmail: '',
  remindDays: 3,
  notifyHour: 9,
  timezone: 'UTC',
  // 新部署默认不公开，需要时到设置里打开
  publicView: false,
  monthlyDigest: true,
  displayName: '',
};

/** 实际生效的通知渠道：没配过渠道时，把旧的「通知邮箱」当成一个邮件渠道 */
export function channelsOf(s: Settings): Channel[] {
  if (s.channels) return s.channels;
  return s.notifyEmail ? [{ id: 'email', kind: 'email', name: t('core.channel.email'), enabled: true, config: { to: s.notifyEmail } }] : [];
}
