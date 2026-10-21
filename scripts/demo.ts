// 生成演示数据：一位虚构用户（Alex）的完整账本，日期都相对今天，任何时候生成都显得「正在使用」。
// 用法：
//   node --experimental-strip-types scripts/demo.ts > demo.json          备份文件，可在设置里「从备份恢复」
//   node --experimental-strip-types scripts/demo.ts --sql > demo.sql     直接写库：wrangler d1 execute DB --file demo.sql
//   加 --lang zh-CN 等：界面语言、分类名、本位币按该语言来（官网截图用）
import { readFileSync } from 'node:fs';
import type { PaymentMethod, Person, Settings, Subscription } from '../shared/types.ts';

const TODAY = new Date().toISOString().slice(0, 10);
const day = (offset: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
/** n 个月前的某一天（日固定，避免月末漂移） */
const monthsAgo = (n: number, dom = 1) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  d.setUTCDate(Math.min(dom, 28));
  return d.toISOString().slice(0, 10);
};

const methods: PaymentMethod[] = [
  { id: 'm-sapphire', name: 'Sapphire Preferred', kind: 'credit', currency: 'USD', network: 'visa', last4: '4821', color: '#1c3f94', cashback: 2, order: 0 },
  { id: 'm-revolut', name: 'Revolut', kind: 'debit', currency: 'EUR', network: 'mastercard', last4: '0193', color: '#191c1f', order: 1 },
  { id: 'm-wise', name: 'Wise', kind: 'debit', currency: 'USD', network: 'visa', last4: '7702', color: '#163300', order: 2 },
  { id: 'm-paypal', name: 'PayPal', kind: 'paypal', currency: 'USD', order: 3 },
  {
    id: 'm-apple-tr',
    name: 'App Store (Türkiye)',
    kind: 'appstore',
    currency: 'TRY',
    region: 'TR',
    balance: 2150,
    balanceAsOf: day(-12),
    lowRunwayDays: 45,
    order: 4,
  },
  { id: 'm-esim', name: 'Travel eSIM', kind: 'phone', currency: 'USD', balance: 18.5, balanceAsOf: day(-3), order: 5 },
];

const people: Person[] = [
  { id: 'p-jamie', name: 'Jamie', contactVia: 'Telegram', contact: '@jamie_demo', color: 'blue' },
  { id: 'p-priya', name: 'Priya', contactVia: 'WhatsApp', contact: '+1 555 0142', color: 'pink' },
  { id: 'p-leo', name: 'Leo', contactVia: '邮箱', contact: 'leo@example.com', color: 'green' },
  { id: 'p-sam', name: 'Sam', color: 'orange' },
  { id: 'p-mom', name: 'Mom', contactVia: '手机', contact: '+1 555 0199', color: 'purple' },
];

const monthly = { unit: 'month', every: 1 } as const;
const yearly = { unit: 'year', every: 1 } as const;
const base = (o: Partial<Subscription> & Pick<Subscription, 'id' | 'name' | 'category' | 'price' | 'currency' | 'start'>): Subscription => ({
  tags: [],
  cycle: monthly,
  status: 'active',
  createdAt: o.start,
  ...o,
});

/** 合租成员：按月付，付到下次扣款前后 */
const member = (p: Person, share: number, paidMonthsAhead: number, joinedMonthsAgo: number) => ({
  id: `sm-${p.id}`,
  personId: p.id,
  name: p.name,
  contactVia: p.contactVia,
  contact: p.contact,
  share,
  joined: monthsAgo(joinedMonthsAgo, 5),
  paidUntil: monthsAgo(-paidMonthsAhead, 5),
  payments: [{ date: monthsAgo(1, 6), amount: share * 3, currency: 'USD', until: monthsAgo(-paidMonthsAhead, 5) }],
});

const subscriptions: Subscription[] = [
  // AI
  base({
    id: 's-chatgpt',
    name: 'ChatGPT Plus',
    category: 'AI',
    price: 20,
    currency: 'USD',
    start: monthsAgo(26, 14),
    url: 'https://chatgpt.com',
    methodId: 'm-sapphire',
  }),
  base({
    id: 's-claude',
    name: 'Claude Pro',
    category: 'AI',
    price: 20,
    currency: 'USD',
    start: monthsAgo(9, 3),
    url: 'https://claude.ai',
    methodId: 'm-sapphire',
    priceHistory: [{ from: monthsAgo(9, 3), amount: 20 }],
  }),
  base({
    id: 's-cursor',
    name: 'Cursor Pro',
    category: 'Developer',
    price: 20,
    currency: 'USD',
    start: day(-6),
    url: 'https://cursor.com',
    methodId: 'm-wise',
    status: 'trial',
    trialEnd: day(8),
  }),
  base({
    id: 's-perplexity',
    name: 'Perplexity Pro',
    category: 'AI',
    price: 200,
    currency: 'USD',
    cycle: yearly,
    start: monthsAgo(14, 9),
    end: day(25),
    url: 'https://perplexity.ai',
    methodId: 'm-sapphire',
    notes: "Won't renew — Claude covers search now.",
  }),
  // 影音、音乐：Spotify 家庭版由我组织，向三位朋友收钱
  base({
    id: 's-spotify',
    name: 'Spotify Family',
    category: 'Music',
    price: 19.99,
    currency: 'USD',
    start: monthsAgo(31, 5),
    url: 'https://spotify.com',
    methodId: 'm-sapphire',
    priceHistory: [
      { from: monthsAgo(31, 5), amount: 16.99 },
      { from: monthsAgo(15, 5), amount: 17.99 },
      { from: monthsAgo(3, 5), amount: 19.99 },
    ],
    share: {
      role: 'owner',
      seats: 6,
      since: monthsAgo(31, 5),
      members: [member(people[0], 5, 2, 30), member(people[1], 5, 0, 18), member(people[2], 5, -1, 8)],
    },
  }),
  base({
    id: 's-netflix',
    name: 'Netflix Standard',
    category: 'Video',
    price: 17.99,
    currency: 'USD',
    start: monthsAgo(40, 22),
    url: 'https://netflix.com',
    methodId: 'm-sapphire',
    priceHistory: [
      { from: monthsAgo(40, 22), amount: 15.49 },
      { from: monthsAgo(9, 22), amount: 17.99 },
    ],
  }),
  // 换区：先在美区付，后来转到土耳其区；美区预付到期前两段并行
  base({
    id: 's-youtube',
    name: 'YouTube Premium',
    category: 'Video',
    price: 79.99,
    currency: 'TRY',
    start: monthsAgo(20, 11),
    url: 'https://youtube.com',
    region: 'TR',
    methodId: 'm-apple-tr',
    phases: [
      { start: monthsAgo(20, 11), end: monthsAgo(2, 11), price: 13.99, currency: 'USD', cycle: monthly, methodId: 'm-sapphire', region: 'US' },
      { start: monthsAgo(3, 2), price: 79.99, currency: 'TRY', cycle: monthly, methodId: 'm-apple-tr', region: 'TR' },
    ],
  }),
  base({
    id: 's-disney',
    name: 'Disney+',
    category: 'Video',
    price: 13.99,
    currency: 'USD',
    start: monthsAgo(22, 1),
    end: monthsAgo(6, 1),
    status: 'cancelled',
    url: 'https://disneyplus.com',
    methodId: 'm-paypal',
    notes: 'Cancelled after the Marvel binge.',
  }),
  base({
    id: 's-crunchyroll',
    name: 'Crunchyroll',
    category: 'Video',
    price: 7.99,
    currency: 'USD',
    start: monthsAgo(11, 16),
    status: 'paused',
    pausedAt: monthsAgo(2, 16),
    url: 'https://crunchyroll.com',
    methodId: 'm-paypal',
  }),
  // 苹果全家桶：家庭共享，替妈妈付她自己的 iCloud
  base({
    id: 's-apple-one',
    name: 'Apple One Family',
    category: 'Storage',
    price: 25.95,
    currency: 'USD',
    start: monthsAgo(28, 18),
    url: 'https://apple.com/apple-one',
    methodId: 'm-sapphire',
    share: { role: 'owner', seats: 5, since: monthsAgo(28, 18), members: [{ ...member(people[3], 0, 0, 28), exempt: true, note: 'Partner — not splitting' }] },
  }),
  base({
    id: 's-mom-icloud',
    name: 'iCloud+ 200GB (Mom)',
    category: 'Storage',
    price: 2.99,
    currency: 'USD',
    start: monthsAgo(16, 8),
    url: 'https://icloud.com',
    methodId: 'm-wise',
    proxy: {
      personId: 'p-mom',
      forName: 'Mom',
      contactVia: '手机',
      contact: '+1 555 0199',
      entries: [
        { charge: monthsAgo(2, 8), received: 2.99, receivedCurrency: 'USD', receivedOn: monthsAgo(2, 12) },
        { charge: monthsAgo(1, 8), received: 2.99, receivedCurrency: 'USD', receivedOn: monthsAgo(1, 9) },
      ],
    },
  }),
  base({
    id: 's-1password',
    name: '1Password Families',
    category: 'Tools',
    price: 59.88,
    currency: 'USD',
    cycle: yearly,
    start: monthsAgo(20, 2),
    url: 'https://1password.com',
    methodId: 'm-sapphire',
    share: {
      role: 'owner',
      seats: 5,
      since: monthsAgo(20, 2),
      members: [
        { ...member(people[0], 12, 0, 20), billEvery: 12, fee: 12, feeCurrency: 'USD' },
        { ...member(people[2], 12, 0, 8), billEvery: 12, fee: 12, feeCurrency: 'USD' },
      ],
    },
  }),
  // 效率、设计、开发
  base({
    id: 's-notion',
    name: 'Notion Plus',
    category: 'Productivity',
    price: 96,
    currency: 'USD',
    cycle: yearly,
    start: monthsAgo(25, 27),
    url: 'https://notion.so',
    methodId: 'm-sapphire',
  }),
  base({
    id: 's-raycast',
    name: 'Raycast Pro',
    category: 'Productivity',
    price: 96,
    currency: 'USD',
    cycle: yearly,
    start: monthsAgo(7, 13),
    url: 'https://raycast.com',
    methodId: 'm-wise',
    intro: { price: 48, until: monthsAgo(-5, 13) },
  }),
  base({
    id: 's-figma',
    name: 'Figma Professional',
    category: 'Design',
    price: 15,
    currency: 'USD',
    start: monthsAgo(18, 4),
    url: 'https://figma.com',
    methodId: 'm-sapphire',
    priceHistory: [
      { from: monthsAgo(18, 4), amount: 12 },
      { from: monthsAgo(7, 4), amount: 15 },
    ],
  }),
  base({
    id: 's-github',
    name: 'GitHub Copilot',
    category: 'Developer',
    price: 100,
    currency: 'USD',
    cycle: yearly,
    start: monthsAgo(15, 21),
    url: 'https://github.com',
    methodId: 'm-wise',
  }),
  base({
    id: 's-setapp',
    name: 'Setapp',
    category: 'Tools',
    price: 9.99,
    currency: 'USD',
    start: monthsAgo(13, 10),
    url: 'https://setapp.com',
    methodId: 'm-paypal',
  }),
  base({
    id: 's-tailscale',
    name: 'Tailscale Personal Plus',
    category: 'VPN & Network',
    price: 5,
    currency: 'USD',
    start: monthsAgo(6, 25),
    url: 'https://tailscale.com',
    methodId: 'm-wise',
  }),
  // 服务器、域名（欧元、按年）
  base({
    id: 's-hetzner',
    name: 'Hetzner · CX32',
    category: 'Cloud & Servers',
    price: 6.8,
    currency: 'EUR',
    start: monthsAgo(19, 1),
    url: 'https://hetzner.com',
    methodId: 'm-revolut',
    priceHistory: [
      { from: monthsAgo(19, 1), amount: 6.3 },
      { from: monthsAgo(4, 1), amount: 6.8 },
    ],
  }),
  base({
    id: 's-domain-dev',
    name: 'alexmakes.dev',
    category: 'Domains',
    price: 12,
    currency: 'USD',
    cycle: yearly,
    start: monthsAgo(34, 17),
    url: 'https://cloudflare.com',
    methodId: 'm-sapphire',
    tags: ['domain'],
  }),
  base({
    id: 's-domain-app',
    name: 'tinyledger.app',
    category: 'Domains',
    price: 14.2,
    currency: 'USD',
    cycle: yearly,
    start: monthsAgo(10, 9),
    end: day(40),
    url: 'https://cloudflare.com',
    methodId: 'm-sapphire',
    tags: ['domain'],
    notes: 'Side project shelved — let it expire.',
  }),
  // 生活、学习、健康、新闻
  base({
    id: 's-duolingo',
    name: 'Duolingo Super',
    category: 'Education',
    price: 59.99,
    currency: 'USD',
    cycle: yearly,
    start: monthsAgo(9, 30),
    url: 'https://duolingo.com',
    methodId: 'm-apple-tr',
    region: 'TR',
  }),
  base({
    id: 's-strava',
    name: 'Strava',
    category: 'Health & Fitness',
    price: 79.99,
    currency: 'USD',
    cycle: yearly,
    start: monthsAgo(23, 6),
    url: 'https://strava.com',
    methodId: 'm-sapphire',
  }),
  base({
    id: 's-nyt',
    name: 'The New York Times',
    category: 'News & Reading',
    price: 25,
    currency: 'USD',
    cycle: { unit: 'week', every: 4 },
    start: monthsAgo(12, 15),
    url: 'https://nytimes.com',
    methodId: 'm-sapphire',
    intro: { price: 4, until: monthsAgo(6, 15) },
  }),
  base({
    id: 's-kindle',
    name: 'Kindle Unlimited',
    category: 'News & Reading',
    price: 11.99,
    currency: 'USD',
    start: monthsAgo(4, 19),
    url: 'https://amazon.com/kindle-dbs/hz/subscribe/ku',
    methodId: 'm-sapphire',
  }),
  base({
    id: 's-gamepass',
    name: 'Xbox Game Pass Ultimate',
    category: 'Games',
    price: 19.99,
    currency: 'USD',
    start: monthsAgo(8, 24),
    url: 'https://xbox.com',
    methodId: 'm-paypal',
    priceHistory: [
      { from: monthsAgo(8, 24), amount: 16.99 },
      { from: monthsAgo(2, 24), amount: 19.99 },
    ],
  }),
  base({
    id: 's-switch',
    name: 'Nintendo Switch Online',
    category: 'Games',
    price: 19.99,
    currency: 'USD',
    cycle: yearly,
    start: monthsAgo(29, 12),
    url: 'https://nintendo.com',
    methodId: 'm-paypal',
  }),
  base({
    id: 's-esim',
    name: 'Travel eSIM data',
    category: 'Phone & Mobile',
    price: 9,
    currency: 'USD',
    start: monthsAgo(3, 7),
    url: 'https://airalo.com',
    methodId: 'm-esim',
  }),
  base({
    id: 's-things',
    name: 'Things 3',
    category: 'Productivity',
    price: 49.99,
    currency: 'USD',
    cycle: { unit: 'lifetime', every: 1 },
    start: monthsAgo(44, 2),
    url: 'https://culturedcode.com/things',
    methodId: 'm-sapphire',
  }),
];

const settings: Settings = {
  baseCurrency: 'USD',
  notifyEmail: '',
  remindDays: 3,
  notifyHour: 9,
  timezone: 'America/New_York',
  publicView: true,
  monthlyDigest: true,
  displayName: 'Alex',
  weekStart: 0,
  aiEnabled: true,
};

// 指定语言时：分类名换成该语言的内置分类名，本位币换成当地货币
const LANG = process.argv[process.argv.indexOf('--lang') + 1];
if (process.argv.includes('--lang') && LANG) {
  const cats = (lang: string) => (JSON.parse(readFileSync(new URL(`../shared/locales/${lang}/core.json`, import.meta.url), 'utf8')) as { category: Record<string, string> }).category;
  const en = cats('en');
  const to = cats(LANG);
  const rename = new Map(Object.entries(en).map(([code, name]) => [name, to[code] ?? name]));
  for (const s of subscriptions) s.category = rename.get(s.category) ?? s.category;
  const CCY: Record<string, string> = { 'zh-CN': 'CNY', 'zh-TW': 'TWD', 'zh-HK': 'HKD', ja: 'JPY', ko: 'KRW', de: 'EUR', fr: 'EUR', es: 'EUR', 'pt-BR': 'BRL', ru: 'RUB', tr: 'TRY', id: 'IDR', vi: 'VND' };
  settings.language = LANG;
  settings.baseCurrency = CCY[LANG] ?? 'USD';
}

const backup = { format: 'calends-backup', version: 3, exportedAt: new Date().toISOString(), subscriptions, methods, people, settings, fxDaily: [] };

if (process.argv.includes('--sql')) {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const rows = [
    'DELETE FROM subscriptions;',
    'DELETE FROM methods;',
    ...subscriptions.map((s) => `INSERT INTO subscriptions (id, data) VALUES (${q(s.id)}, ${q(JSON.stringify(s))});`),
    ...methods.map((m) => `INSERT INTO methods (id, data) VALUES (${q(m.id)}, ${q(JSON.stringify(m))});`),
    `INSERT INTO kv (key, value) VALUES ('settings', ${q(JSON.stringify(settings))}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    `INSERT INTO kv (key, value) VALUES ('people', ${q(JSON.stringify(people))}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
  ];
  console.log(rows.join('\n'));
} else {
  console.log(JSON.stringify(backup, null, 2));
}
