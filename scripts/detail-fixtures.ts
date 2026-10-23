/** Fictional, date-relative detail stress ledger. Run with Node --experimental-strip-types. */
import { addDays, addMonths, chargesBetween, nthCharge, phaseSubs, subError, todayIn } from '../shared/billing.ts';
import { resume, stopSubscription, switchPlan } from '../shared/phases.ts';
import { DEFAULT_SETTINGS, type Cycle, type ShareMember, type Subscription } from '../shared/types.ts';

export interface DetailCase {
  case: number;
  id: string;
  name: string;
  description: string;
  expected: { records: number; phases: number; members: number };
}

export function detailFixtures(today = todayIn('Asia/Shanghai')) {
  const month: Cycle = { unit: 'month', every: 1 };
  const year: Cycle = { unit: 'year', every: 1 };
  const subscriptions: Subscription[] = [];
  const cases: DetailCase[] = [];
  const longNote = [
    '此处全部为虚构压力测试数据。账号仅用于检查换行与复制按钮，不对应任何真实服务或个人。所有服务名称、账号、付款和成员关系都是虚构的，不能用于登录或发起实际交易，也没有关联个人账本。家庭共享包含不同收款周期、预付款、免分摊和退出记录，请检查摘要与成员列表是否能在窄屏完整显示。',
    '第二段专门增加摘要高度：服务有效期与银行扣款时间不同，应在取消截止日之前处理续订。成员甲已逾期多期，成员乙预付至明年，成员丙免分摊，成员丁已退出并收到部分退款。',
    '第三段用于验证多段备注不会挤压日期、金额与操作按钮。长文字不应被当作账务事实；每一笔付款与退款都来自本脚本生成的虚构记录。请留意两栏高度差、底部留白和长金额的排版情况。',
  ].join('\n\n');
  const base = (n: number, title: string, start = addMonths(today, -12), cycle = month): Subscription => ({
    id: `detail-${String(n).padStart(2, '0')}`,
    name: `D${String(n).padStart(2, '0')} ${title}`,
    category: '压力测试',
    tags: [],
    price: 36,
    currency: 'CNY',
    cycle,
    start,
    status: 'active',
    icon: '🧪',
    methodId: 'fictional-card',
  });
  const record = (s: Subscription, count: number): Subscription => ({
    ...s,
    payments: Array.from({ length: count }, (_, i) => ({ date: nthCharge(s.start, s.cycle, i), amount: s.price })),
    nextDue: nthCharge(s.start, s.cycle, count),
  });
  const add = (n: number, s: Subscription, description: string) => {
    const error = subError(s);
    if (error) throw new Error(`${s.name}: ${error}`);
    const history = chargesBetween(s, s.start, today, today);
    const stored = phaseSubs(s).flatMap((p) => p.payments ?? []);
    if (stored.some((p) => p.date > today)) throw new Error(`${s.name}: future actual payment`);
    subscriptions.push(s);
    cases.push({
      case: n,
      id: s.id,
      name: s.name,
      description,
      expected: { records: history.length, phases: phaseSubs(s).length, members: s.share?.members.length ?? 0 },
    });
  };
  add(1, record(base(1, '月付三年平线', addMonths(today, -35)), 36), '36 笔月付，三年价格完全不变；走势应为平线。');
  let s = record(base(2, '月付返佣双记录', addMonths(today, -34)), 35);
  s.payments = s.payments!.flatMap((p) => [p, { date: p.date, amount: -3, kind: 'adjust' as const, note: '虚构返佣抵扣' }]);
  add(2, s, '35 个月，每月扣款和负数抵扣各一笔，共 70 笔。');
  s = base(3, '八年年付逐年调价', addMonths(today, -84), year);
  s.price = 180;
  s = record(s, 1);
  for (let i = 1; i < 8; i++) {
    s = switchPlan(s, addMonths(today, -84 + i * 12), { price: 180 + i * 35, currency: 'CNY', cycle: year, methodId: 'fictional-card' });
    const p = s.phases!.at(-1)!;
    p.payments = [{ date: p.start, amount: p.price }];
    p.nextDue = addMonths(p.start, 12);
  }
  for (let i = 0; i < 7; i++) s.phases![i].nextDue = s.phases![i + 1].start;
  add(3, s, '8 个年付阶段、8 笔付款，每年换价。');
  const carStart = addMonths(today, -12);
  const member = (id: string, patch: Partial<ShareMember> = {}): ShareMember => ({
    id,
    name: id,
    share: 120,
    fee: 10,
    feeCurrency: 'CNY',
    billEvery: 1,
    joined: carStart,
    ...patch,
  });
  const members = [
    member('虚构甲-逾期', {
      paidUntil: addMonths(today, -5),
      payments: [{ date: carStart, from: carStart, until: addMonths(today, -5), amount: 70, currency: 'CNY' }],
    }),
    member('虚构乙-预付', {
      paidUntil: addMonths(today, 14),
      payments: [{ date: carStart, from: carStart, until: addMonths(today, 14), amount: 270, currency: 'CNY' }],
    }),
    member('虚构丙-免分摊', { exempt: true, share: 0 }),
    member('虚构丁-已退出', {
      left: addDays(today, -20),
      paidUntil: addMonths(today, 2),
      payments: [{ date: carStart, from: carStart, until: addMonths(today, 2), amount: 150, currency: 'CNY' }],
      leaveRefund: { date: addDays(today, -20), amount: 20, currency: 'CNY' },
    }),
  ];
  s = record(
    {
      ...base(4, '年付合租复杂成员', carStart, year),
      price: 600,
      account: 'fictional-owner@example.invalid',
      notes: longNote,
      chargeLeadDays: 7,
      cancelLeadDays: 10,
      share: { role: 'owner', seats: 5, since: carStart, collectFrom: carStart, rule: { fee: 10, currency: 'CNY', billEvery: 1 }, members },
    },
    2,
  );
  add(4, s, '右栏压力：5 席、4 条成员记录（含退出者，当前 4/5 在席）、逾期/预付/免分摊/退款、约300字备注、提前扣款与取消截止。');
  add(
    4,
    {
      ...s,
      id: 'detail-04-full',
      name: 'D04B 年付合租当前满员',
      share: { ...s.share!, members: [...members, member('虚构戊-补位', { joined: addDays(today, -19) })] },
    },
    '满员变体：4 名在席成员加发起人共5席，另保留1名历史退出者（共5条成员记录）。',
  );
  add(
    5,
    record(
      { ...base(5, '新合租两席', today), share: { role: 'owner', seats: 2, since: today, members: [member('虚构新成员', { joined: today, share: 10 })] } },
      1,
    ),
    '两席一成员，今天开始，仅一笔。',
  );
  add(
    6,
    record({ ...base(6, '加入他人合租', addMonths(today, -11)), share: { role: 'member', seats: 5, ownerName: '虚构车主', members: [] } }, 12),
    'member 身份，月付一年，12笔。',
  );
  add(7, record(base(7, '年付第一天', today, year), 1), '刚开始年付，只有1笔，无多段历程。');
  add(8, base(8, '尚未开始', addDays(today, 20)), '20天后开始，零历史扣款。');
  add(9, { ...base(9, '免费试用', addDays(today, -9)), status: 'trial', trialEnd: addDays(today, 5) }, '试用中，5天后首扣，零历史扣款。');
  add(
    10,
    { ...record(base(10, '月付一年后暂停', addMonths(today, -13)), 12), status: 'paused', pausedAt: addMonths(today, -1) },
    '月付12笔后暂停，无未来扣款。',
  );
  const stopping = (n: number, title: string) => record({ ...base(n, title, addMonths(today, -6), year), price: 1200 }, 1);
  add(
    11,
    stopSubscription(stopping(11, '主动停止部分退款'), today, 'cancel', addDays(today, -5), undefined, { amount: 300 }),
    '主动停止、部分退款300，保留停止结果卡与未用余额。',
  );
  add(
    12,
    stopSubscription(stopping(12, '服务方停用无退款'), today, 'terminate', addDays(today, -5), '虚构服务商终止旧套餐并关闭账号，预付余款不予退回。'),
    '服务方停用、有原因、零退款、产生损失。',
  );
  add(
    13,
    { ...record(base(13, '两个月前到期', addMonths(today, -14)), 12), end: addDays(addMonths(today, -2), -1), status: 'cancelled' },
    '两个月前到期不续，历史12笔。',
  );
  add(14, { ...record(base(14, '十天后到期', addMonths(today, -11)), 12), end: addDays(today, 10), status: 'cancelled' }, '10天后到期不续。');
  const overlap = (n: number, title: string) => {
    let v = record({ ...base(n, title, addMonths(today, -8)), region: 'US' }, 8);
    v = switchPlan(v, addDays(today, -15), { price: 28, currency: 'CNY', cycle: month, region: 'TR', methodId: 'fictional-card' }, addDays(today, 25));
    v.phases!.at(-1)!.payments = [{ date: addDays(today, -15), amount: 28 }];
    return switchPlan(v, addDays(today, 12), { price: 320, currency: 'CNY', cycle: year, region: 'JP', planned: true, methodId: 'fictional-card' });
  };
  add(15, overlap(15, '并行换区及计划变更'), 'US旧方案仍并行，TR当前，12天后计划JP年付；应出现确认按钮。');
  add(
    16,
    {
      ...base(16, '首期优惠赠送时长', addMonths(today, -5)),
      intro: { price: 9, until: addMonths(today, -3) },
      bonus: { from: addMonths(today, -2), until: addDays(today, 15) },
    },
    '首期两个月优惠9元，之后正常计费，再赠送到15天后。',
  );
  s = record(base(17, '失败退款补差混合', addMonths(today, -4)), 5);
  s.payments = s
    .payments!.flatMap((p) => [p, { date: p.date, amount: 36, kind: 'failed' as const }, { date: addDays(p.date, 1), amount: -4, kind: 'refund' as const }])
    .filter((p) => p.date <= today);
  s.payments.push({ date: today, amount: 5, kind: 'adjust', note: '虚构升级补差' });
  add(17, s, '约15笔，正常扣款、失败、退款与补差混排。');
  s = record({ ...base(18, '美元标价港币实扣', addMonths(today, -11)), price: 19.99, currency: 'USD' }, 12);
  s.payments = s.payments!.map((p) => ({ ...p, settled: { amount: 157.23, currency: 'HKD' } }));
  add(18, s, 'USD标价、HKD卡上实扣、CNY本位币，三币同屏。');
  add(
    18,
    record({ ...base(18, '缺失汇率冷门币种', addMonths(today, -11)), id: 'detail-18-missing', currency: 'XCD', price: 27 }, 12),
    'XCD不在虚构汇率表：未知值必须保持未知，不能变零。',
  );
  add(19, record(base(19, '两年周付', addDays(today, -728), { unit: 'week', every: 1 }), 105), '两年105笔周付，历史展开后压力最大。');
  for (const [suffix, title, c, months, count] of [
    ['quarter', '两年季付', { unit: 'month', every: 3 }, 21, 8],
    ['half', '三年半年付', { unit: 'month', every: 6 }, 30, 6],
    ['biennial', '六年两年付', { unit: 'year', every: 2 }, 48, 3],
  ] as const)
    add(
      20,
      record({ ...base(20, title, addMonths(today, -months), c), id: `detail-20-${suffix}` }, count),
      `${title}，${count}笔，周期每${c.every}${c.unit}。`,
    );
  add(21, record(base(21, '每三十天按日计费', addDays(today, -360), { unit: 'day', every: 30 }), 13), 'day/every=30，跨月份日期漂移。');
  s = { ...record(base(22, '断档四月后续订', addMonths(today, -18)), 6), end: addDays(addMonths(today, -12), -1) };
  add(22, resume(s, addMonths(today, -8), { price: 42, currency: 'CNY', cycle: month }), '第一段结束后整4个月断档，再续订。');
  s = record(base(23, '买断一笔', addMonths(today, -24), { unit: 'lifetime', every: 1 }), 1);
  add(23, s, '单次买断，1笔，无续费预测。');
  add(
    23,
    {
      ...switchPlan(s, addMonths(today, -3), { price: 288, currency: 'CNY', cycle: { unit: 'lifetime', every: 1 } }),
      id: 'detail-23-upgrade',
      name: 'D23B 买断再购升级版',
    },
    '两段lifetime，旧版与升级版各一笔。',
  );
  add(
    24,
    {
      ...record(base(24, '', addMonths(today, -3)), 4),
      name: '跨越星际的超长订阅名称 Interstellar Creative Collaboration Ultimate 全家桶专业年度增强版',
      account: `${'verylongfictionalaccount'.repeat(5)}@example.invalid`,
      url: `https://example.invalid/${'extremely-long-fictional-service-path/'.repeat(8)}`,
      manageUrl: `https://example.invalid/manage/${'fictional-billing-settings/'.repeat(8)}`,
    },
    '约60字符中英名称、超长邮箱、超长官网及管理链接。',
  );
  add(
    25,
    { ...record(base(25, '最少可选信息', addMonths(today, -11)), 12), methodId: undefined, category: '', icon: undefined },
    '无支付方式、无分类、无自定义图标。',
  );
  add(
    26,
    {
      ...record(base(26, '进行中的代付', addMonths(today, -11)), 12),
      proxy: {
        forName: '虚构代付对象',
        entries: [{ charge: today, charged: 36, received: 36, receivedCurrency: 'CNY', receivedOn: today }],
        note: '虚构代付，月末结清',
      },
    },
    '代付进行中，12笔；从代付页的名称链接打开订阅详情。',
  );
  add(27, record({ ...base(27, '极宽年付金额', addMonths(today, -36), year), price: 123456.78 }, 4), '每年¥123,456.78，大整数与小数同时压力。');
  add(
    27,
    record({ ...base(27, '低价美元周付', addDays(today, -84), { unit: 'week', every: 1 }), id: 'detail-27-small', price: 0.99, currency: 'USD' }, 13),
    '$0.99每周，低价与CNY换算。',
  );
  const dense = (n: number, title: string) => {
    let v = record(base(n, title, addMonths(today, -19)), 1);
    for (let i = 1; i < 20; i++) {
      v = switchPlan(v, addMonths(today, -19 + i), {
        price: 20 + i * 3,
        currency: 'CNY',
        cycle: month,
        region: i % 2 ? 'TR' : 'US',
        methodId: 'fictional-card',
      });
      const p = v.phases!.at(-1)!;
      p.payments = [{ date: p.start, amount: p.price }];
      p.nextDue = addMonths(p.start, 1);
    }
    for (let i = 0; i < 19; i++) v.phases![i].nextDue = v.phases![i + 1].start;
    return v;
  };
  add(28, dense(28, '二十段密集变更'), '20阶段，每月换价/换区；图表分段和历程列表压力。');
  s = record(base(29, '今天扣款', addMonths(today, -11)), 12);
  s.payments!.at(-1)!.date = today;
  s.nextDue = addMonths(today, 1);
  add(29, s, '今天正好扣款，已发生记录包含今天。');
  s = dense(30, '全都有');
  s.phases![0].intro = { price: 6, until: addDays(s.start, 10) };
  s.phases![0].payments![0].amount = 6;
  for (const p of s.phases!) p.payments!.push({ date: p.start, amount: -2, kind: 'adjust', note: '虚构返佣' });
  s = switchPlan(s, addDays(today, 18), { price: 88, currency: 'CNY', cycle: month, planned: true, region: 'JP' });
  add(
    30,
    {
      ...s,
      account: 'fictional-everything@example.invalid',
      notes: longNote,
      share: { role: 'owner', seats: 5, since: carStart, members: members.map((m) => ({ ...m, share: m.exempt ? 0 : 10 })) },
    },
    '21段含计划、40笔密集记录、预测、已结束首期优惠、发起合租、长备注。',
  );
  const fxDates = new Set(subscriptions.flatMap((s) => chargesBetween(s, s.start, today, today).map((c) => c.date)).concat(today));
  const first = subscriptions.map((s) => s.start).sort()[0];
  for (let d = `${first.slice(0, 7)}-01`; d <= today; d = addMonths(d, 1)) {
    const end = addDays(addMonths(d, 1), -1);
    fxDates.add(end < today ? end : today);
  }
  return {
    backup: {
      format: 'calends-backup',
      version: 3,
      exportedAt: new Date().toISOString(),
      subscriptions,
      methods: [{ id: 'fictional-card', name: '虚构测试卡', kind: 'credit', currency: 'CNY', last4: '0000' }],
      people: [],
      settings: {
        ...DEFAULT_SETTINGS,
        baseCurrency: 'CNY',
        collectCurrency: 'CNY',
        timezone: 'Asia/Shanghai',
        language: 'zh-CN',
        displayName: '虚构布局测试',
        monthlyDigest: false,
        categories: [{ name: '压力测试' }],
      },
      fx: { base: 'USD', rates: { USD: 1, CNY: 7.12, HKD: 7.78, JPY: 151.5 }, fetchedAt: today },
      fxDaily: [...fxDates].sort().map((date) => ({ date, rates: { USD: 1, CNY: 7.12, HKD: 7.78, JPY: 151.5 }, source: 'fictional-detail-fixtures' })),
    },
    cases,
    today,
    limitations: [
      'D04: 四成员中一人退出无法同时当前满员，D04B补入第四名在席成员，保留退出历史。',
      '完整图保留默认折叠；另存history-expanded图验证全历史。弹窗920px硬上限通过滚动拼接处理，不改布局CSS。',
    ],
  };
}
