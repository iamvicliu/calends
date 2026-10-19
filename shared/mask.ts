// 公开页脱敏：服务端只下发这里处理过的数据，浏览器拿不到原始信息
import type { AppState, MethodKind, PaymentMethod, Subscription } from './types.ts';

const DOMAIN = /\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+)([a-z]{2,})\b/gi;

/** framingflow.com → f•••••••w.com；保留首尾字母和顶级域 */
export function maskDomain(text: string): string {
  return text.replace(DOMAIN, (_m, labels: string, tld: string) => {
    const parts = labels.slice(0, -1).split('.');
    const masked = parts.map((p) => (p.length <= 2 ? '•'.repeat(p.length) : p[0] + '•'.repeat(Math.min(p.length - 2, 8)) + p[p.length - 1]));
    return `${masked.join('.')}.${tld}`;
  });
}

export function isDomainSub(s: Pick<Subscription, 'name' | 'category' | 'tags' | 'notes'>): boolean {
  if (s.category === '域名') return true;
  return /域名|domain/i.test(`${s.category} ${s.tags.join(' ')} ${s.notes ?? ''}`) || new RegExp(DOMAIN.source, 'i').test(s.name);
}

const KIND_PUBLIC: Record<MethodKind, string> = {
  debit: '银行卡',
  credit: '信用卡',
  alipay: '支付宝',
  wechat: '微信支付',
  paypal: 'PayPal',
  appstore: 'App Store',
  giftcard: '礼品卡',
  phone: '手机话费',
  crypto: '加密卡',
  other: '其他',
};

function publicMethod(m: PaymentMethod): PaymentMethod {
  return { id: m.id, kind: m.kind, currency: m.currency, region: m.region, color: m.color, name: `${KIND_PUBLIC[m.kind]}${m.region ? ` · ${m.region}` : ''}` };
}

/** FNV-1a 短哈希：公开数据里不暴露可能含域名的 id */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

function publicSub(s: Subscription): Subscription {
  const domain = isDomainSub(s);
  // 未上线项目的域名打码；已上线的（showOnPublic）原样展示
  const hide = domain && !s.showOnPublic;
  return {
    id: hide ? `d-${shortHash(s.id)}` : s.id,
    name: hide ? maskDomain(s.name) : s.name,
    // 域名统一用域名图标；隐藏的域名连网址也不下发，避免暴露真实域名
    icon: domain ? undefined : s.icon,
    url: hide || !s.url ? undefined : new URL(s.url.startsWith('http') ? s.url : `https://${s.url}`).origin,
    category: s.category,
    tags: [],
    price: s.price,
    currency: s.currency,
    cycle: s.cycle,
    start: s.start,
    end: s.end,
    status: s.status,
    trialEnd: s.trialEnd,
    pausedAt: s.pausedAt,
    methodId: s.methodId,
    region: s.region,
    intro: s.intro,
    priceHistory: s.priceHistory,
    // 计费需要的结构原样保留：阶段、实际扣款、下次扣款日（不含敏感信息）
    phases: s.phases?.map(({ note: _n, ...p }) => ({ ...p, payments: p.payments?.map(({ note: _x, ...pay }) => pay) })),
    payments: s.payments?.map(({ note: _n, ...p }) => p),
    nextDue: s.nextDue,
    share: s.share && {
      role: s.share.role,
      seats: s.share.seats,
      members: s.share.members.map((m, i) => ({ id: `m${i}`, name: '', share: m.share, paidUntil: m.paidUntil })),
    },
  };
}

export function maskForPublic(state: AppState): AppState {
  return {
    readonly: true,
    fx: state.fx,
    fxHistory: state.fxHistory,
    settings: {
      ...state.settings,
      notifyEmail: '',
      icsToken: undefined,
      remindDays: 0,
      monthlyDigest: false,
    },
    methods: state.methods.map(publicMethod),
    subscriptions: state.subscriptions.map(publicSub),
  };
}
