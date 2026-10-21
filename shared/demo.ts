// 纯演示账本：只依赖传入的 UTC 日期，不读时钟、环境或文件。
import type { PaymentMethod, Person, Settings, Subscription } from './types.ts';

export function demoState(today: string): { subscriptions: Subscription[]; methods: PaymentMethod[]; people: Person[]; settings: Settings } {
  const TODAY = today;
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
    { id: 'p-jamie', name: 'Jamie', color: 'blue' },
    { id: 'p-priya', name: 'Priya', color: 'pink' },
    { id: 'p-leo', name: 'Leo', color: 'green' },
    { id: 'p-sam', name: 'Sam', color: 'orange' },
    { id: 'p-mom', name: 'Mom', color: 'purple' },
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
      share: {
        role: 'owner',
        seats: 5,
        since: monthsAgo(28, 18),
        members: [{ ...member(people[3], 0, 0, 28), exempt: true, note: 'Partner — not splitting' }],
      },
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
    timezone: 'UTC',
    publicView: false,
    monthlyDigest: true,
    displayName: 'Alex',
    weekStart: 0,
    aiEnabled: false,
  };

  // 钱包包含高余额和即将用尽的余额，订阅均关联实际支付账户。
  methods.push(
    { id: 'm-apple-us', name: 'App Store (US)', kind: 'appstore', currency: 'USD', region: 'US', balance: 42, balanceAsOf: today, order: 6 },
    {
      id: 'm-apple-jp',
      name: 'App Store (Japan)',
      kind: 'appstore',
      currency: 'JPY',
      region: 'JP',
      balance: 800,
      balanceAsOf: today,
      lowRunwayDays: 45,
      order: 7,
    },
    { id: 'm-play-in', name: 'Google Play (India)', kind: 'googleplay', currency: 'INR', region: 'IN', balance: 450, balanceAsOf: today, order: 8 },
    { id: 'm-play-br', name: 'Google Play (Brazil)', kind: 'googleplay', currency: 'BRL', region: 'BR', balance: 120, balanceAsOf: today, order: 9 },
    { id: 'm-gift', name: 'Amazon Gift Card', kind: 'giftcard', currency: 'GBP', balance: 15, balanceAsOf: today, order: 10 },
    {
      id: 'm-cloud',
      name: 'DigitalOcean Credit',
      kind: 'prepaid',
      currency: 'USD',
      balance: 96,
      balanceAsOf: today,
      topUps: [{ date: day(-10), amount: 100, cost: 90, costCurrency: 'USD' }],
      order: 11,
    },
  );
  const more: Array<[string, string, string, number, string, string, string]> = [
    ['adobe', 'Adobe Photography', 'Design', 9.99, 'GBP', 'adobe.com', 'm-revolut'],
    ['apple-music', 'Apple Music', 'Music', 1080, 'JPY', 'music.apple.com', 'm-apple-jp'],
    ['google-one', 'Google One', 'Storage', 130, 'INR', 'one.google.com', 'm-play-in'],
    ['tinder', 'Tinder Plus', 'Social', 25.9, 'BRL', 'tinder.com', 'm-play-br'],
    ['prime', 'Amazon Prime', 'Shopping', 8.99, 'GBP', 'amazon.co.uk', 'm-gift'],
    ['ynab', 'YNAB', 'Finance', 14.99, 'USD', 'ynab.com', 'm-sapphire'],
    ['headspace', 'Headspace', 'Lifestyle', 12.99, 'USD', 'headspace.com', 'm-apple-us'],
    ['bilibili', 'Bilibili Premium', 'Video', 25, 'CNY', 'bilibili.com', 'm-paypal'],
    ['digitalocean', 'DigitalOcean Droplet', 'Cloud & Servers', 6, 'USD', 'digitalocean.com', 'm-cloud'],
    ['proton', 'Proton Mail Plus', 'Tools', 47.88, 'EUR', 'proton.me', 'm-revolut'],
    ['office', 'Microsoft 365 Family', 'Productivity', 2, 'USD', 'microsoft.com', 'm-paypal'],
    ['todoist', 'Todoist Pro', 'Productivity', 12, 'USD', 'todoist.com', 'm-wise'],
  ];
  for (const [id, name, category, price, currency, domain, methodId] of more)
    subscriptions.push(base({ id: `s-${id}`, name, category, price, currency, start: day(-180), url: `https://${domain}`, methodId }));
  const find = (id: string) => subscriptions.find((s) => s.id === `s-${id}`)!;
  find('esim').cycle = { unit: 'day', every: 30 };
  find('todoist').cycle = { unit: 'month', every: 3 };
  find('office').share = { role: 'member', seats: 6, ownerName: 'Jamie', since: day(-180), members: [] };
  find('proton').cycle = yearly;
  find('proton').bonus = { from: day(-30), until: day(60) };
  // 月付升级年付，再断订后续订；顶层镜像最后一段。
  find('notion').phases = [
    { start: monthsAgo(25, 27), end: monthsAgo(13, 27), price: 10, currency: 'USD', cycle: monthly, note: 'Plus monthly' },
    { start: monthsAgo(13, 27), end: day(-90), price: 96, currency: 'USD', cycle: yearly, note: 'Plus annual' },
    { start: day(-20), price: 96, currency: 'USD', cycle: yearly, note: 'Resumed after a break' },
  ];
  find('spotify').share!.members[1] = { ...member(people[1], 5, -1, 18), billEvery: 3, fee: 15, feeCurrency: 'USD' };
  // 保留名称示例但使用保留域名，不指向任何真实个人的项目。
  find('domain-dev').name = 'alex.example';
  find('domain-app').name = 'studio.example';
  find('domain-dev').expires = day(45);
  find('domain-app').expires = day(40);

  return { subscriptions, methods, people, settings };
}
