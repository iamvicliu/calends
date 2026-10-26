import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberCashFlows } from './carpool.ts';
import { memberLedger, memberDues } from './billing.ts';
import { paidThrough, putRecord, removeRecord, resolveKey, setOpening, settle, type Period } from './receivables.ts';
import { migrateReceivables } from './receivables-legacy.ts';
import type { ShareMember, Subscription } from './types.ts';

const p = (key: string, until: string, due = 10, currency = 'CNY'): Period => ({ key, from: key, until, due, currency });
const periods = [p('2026-01-01', '2026-01-31', 5), p('2026-02-01', '2026-02-28'), p('2026-03-01', '2026-03-31'), p('2026-04-01', '2026-04-30')];

test('按期结清：一笔收款按各期应收比例分摊，可以不连续；免收、免费不算欠', () => {
  const r = {
    receipts: [{ id: 'r', date: '2026-01-05', amount: 30, currency: 'CNY', periods: ['2026-01-01', '2026-03-01'] }],
    waivers: [{ id: 'w', date: '2026-04-02', periods: ['2026-04-01'] }],
  };
  const { periods: out, unmatched } = settle(periods, r, '2026-04-15');
  assert.deepEqual(
    out.map((x) => x.status),
    ['paid', 'due', 'paid', 'waived'],
  );
  // 首期应收 5、第三期 10：30 按 1:2 分
  assert.deepEqual(
    out.filter((x) => x.share != null).map((x) => x.share),
    [10, 20],
  );
  assert.deepEqual(unmatched, []);
  assert.equal(paidThrough(out), '2026-01-31');
  assert.equal(settle([p('2026-05-01', '2026-05-31', 0)], {}, '2026-05-02').periods[0].status, 'free');
  assert.equal(settle(periods, {}, '2026-01-15').periods[1].status, 'upcoming');
});

test('写入校验：期不能为空、重复、不存在或已被占用；改一笔时可以沿用自己的期；删除后恢复', () => {
  const r = putRecord({}, 'receipt', { id: 'a', date: '2026-01-02', amount: 5, currency: 'CNY', periods: ['2026-01-01'] }, periods);
  assert.throws(() => putRecord(r, 'receipt', { id: 'b', date: '2026-01-02', amount: 5, currency: 'CNY', periods: [] }, periods), /noPeriods/);
  assert.throws(() => putRecord(r, 'waiver', { id: 'b', date: '2026-01-02', periods: ['2026-01-01'] }, periods), /periodTaken/);
  assert.throws(() => putRecord(r, 'waiver', { id: 'b', date: '2026-01-02', periods: ['2025-12-01'] }, periods), /periodUnknown/);
  // 落在某一期里的日期写入时统一成那一期的起始日
  const next = putRecord(r, 'waiver', { id: 'b', date: '2026-01-02', periods: ['2026-02-15'] }, periods);
  assert.deepEqual(next.waivers[0].periods, ['2026-02-01']);
  // 同一笔改成免收：从收款里移走
  const moved = putRecord(r, 'waiver', { id: 'a', date: '2026-01-02', periods: ['2026-01-01'] }, periods);
  assert.deepEqual([moved.receipts.length, moved.waivers.length], [0, 1]);
  assert.deepEqual(removeRecord(next, 'b').waivers, []);
  assert.throws(() => removeRecord(next, 'missing'), /invalidTarget/);
});

test('条款改过、期重新切过时，旧记录按落在哪一期对上，不会变成欠款', () => {
  const shifted = [p('2026-01-01', '2026-01-14'), p('2026-01-15', '2026-02-14'), p('2026-02-15', '2026-03-14')];
  assert.equal(resolveKey(shifted, '2026-02-01'), '2026-01-15');
  assert.equal(resolveKey(shifted, '2025-12-01'), undefined);
  const { periods: out, unmatched } = settle(
    shifted,
    {
      receipts: [
        { id: 'r', date: '2026-02-02', amount: 10, currency: 'CNY', periods: ['2026-02-01'] },
        { id: 'old', date: '2025-12-02', amount: 10, currency: 'CNY', periods: ['2025-12-01'] },
      ],
    },
    '2026-03-01',
  );
  assert.deepEqual(
    out.map((x) => x.status),
    ['due', 'paid', 'due'],
  );
  // 一期都对不上的单独列出，钱照样算收到
  assert.deepEqual(
    unmatched.map((x) => x.id),
    ['old'],
  );
});

test('期初结清：到某天为止没记收款的期算已收清，金额不详不计入收到的钱；整笔替换', () => {
  const r = { receipts: [{ id: 'r', date: '2026-02-03', amount: 10, currency: 'CNY', periods: ['2026-02-01'] }] };
  const o = setOpening(r, periods, '2026-03-15');
  assert.deepEqual(o.receipts[0], { id: 'opening', date: '2026-01-01', amount: 0, currency: 'CNY', periods: ['2026-01-01', '2026-03-01'], opening: true });
  assert.deepEqual(setOpening(o, periods, '2026-01-10').receipts[0].periods, ['2026-01-01']);
  assert.deepEqual(setOpening(o, periods, undefined).receipts, r.receipts);
  assert.equal(memberCashFlows({ id: 'm', name: 'M', share: 1, ...o }).length, 1);
});

const sub = (members: unknown[]): Subscription => ({
  id: 's',
  name: 'Fictional plan',
  category: '',
  tags: [],
  price: 30,
  currency: 'CNY',
  cycle: { unit: 'month', every: 1 },
  start: '2026-01-01',
  status: 'active',
  share: { role: 'owner', seats: 4, members: members as ShareMember[] },
});

test('旧合租成员转成按期：收款对上覆盖的期，已付至补成期初结清，钱一笔不丢，转过的原样返回', () => {
  const legacy = sub([
    {
      id: 'a',
      name: 'A',
      share: 10,
      fee: 10,
      billEvery: 1,
      joined: '2026-01-01',
      paidUntil: '2026-05-31',
      payments: [
        { date: '2026-03-02', amount: 20, currency: 'CNY', from: '2026-03-01', until: '2026-04-30' },
        // 覆盖期早于加入：对不上任何一期，保留原起始日
        { date: '2025-11-01', amount: 7, currency: 'CNY', from: '2025-11-01', until: '2025-11-30' },
      ],
    },
    { id: 'b', name: 'B', share: 10, fee: 10, billEvery: 1, joined: '2026-01-01' },
  ]);
  const s = migrateReceivables(legacy, 'CNY');
  assert.equal(migrateReceivables(s, 'CNY'), s);
  const [a, b] = s.share!.members;
  assert.equal(b, legacy.share!.members[1]);
  assert.equal('paidUntil' in a || 'payments' in a, false);
  // 旧版推断的收款基准日写死
  assert.equal(s.share!.collectFrom, '2025-11-01');
  assert.deepEqual(
    a.receipts!.map((r) => [r.amount, r.periods, !!r.opening]),
    [
      [7, ['2025-11-01'], false],
      [0, ['2026-01-01', '2026-02-01', '2026-05-01'], true],
      [20, ['2026-03-01', '2026-04-01'], false],
    ],
  );
  assert.equal(
    memberCashFlows(a).reduce((x, f) => x + f.amount, 0),
    27,
  );
  const ledger = memberLedger(s, a, '2026-06-15');
  assert.equal(paidThrough(ledger.periods), '2026-05-31');
  assert.equal(ledger.unmatched.length, 1);
  assert.equal(memberDues(s, '2026-06-15')[0].owed, 10);
});

test('旧数据的节奏改过（断过再续）：转成节奏重新起算，下一次收款日和金额与旧版一致', () => {
  const legacy = {
    ...sub([
      {
        id: 'a',
        name: 'A',
        share: 10,
        fee: 60,
        billEvery: 12,
        joined: '2023-08-16',
        paidUntil: '2026-10-27',
        payments: [
          { date: '2023-08-16', amount: 129, currency: 'CNY', from: '2023-08-16', until: '2024-08-15' },
          { date: '2025-10-28', amount: 60, currency: 'CNY', from: '2025-10-28', until: '2026-10-27' },
        ],
      },
    ]),
    start: '2023-08-16',
    cycle: { unit: 'year' as const, every: 1 },
  };
  legacy.share!.since = '2023-08-16';
  const s = migrateReceivables(legacy, 'CNY');
  const a = s.share!.members[0];
  assert.deepEqual(a.restarts, ['2025-10-28']);
  const { periods } = memberLedger(s, a, '2026-10-25');
  assert.deepEqual(
    periods.map((x) => `${x.key}..${x.until}`),
    ['2023-08-16..2024-08-15', '2024-08-16..2025-08-15', '2025-08-16..2025-10-27', '2025-10-28..2026-10-27'],
  );
  // 截短的那期按天折算：60 × 73 / 365
  assert.equal(periods[2].due, 12);
  assert.equal(memberDues(s, '2026-10-28')[0].owed, 60);
  assert.equal(memberDues(s, '2026-10-27')[0].owed, 0);
});

test('MCP 记收款：期写成那一期里的某一天时，缺省金额按那一期的应收，不记成 0', async () => {
  const { recordReceipt } = await import('./receivable-edit.ts');
  const { DEFAULT_SETTINGS, FALLBACK_FX } = { ...(await import('./types.ts')), ...(await import('./billing.ts')) };
  const s = {
    id: 's',
    name: 'Fictional',
    category: 'Tools',
    tags: [],
    price: 30,
    currency: 'CNY',
    start: '2026-01-01',
    cycle: { unit: 'month' as const, every: 1 },
    status: 'active' as const,
    share: {
      role: 'owner' as const,
      seats: 3,
      collectFrom: '2026-01-01',
      members: [{ id: 'm', name: 'M', fee: 10, feeCurrency: 'CNY', billEvery: 1, joined: '2026-01-01' }],
    },
  };
  const st = { subscriptions: [s], methods: [], settings: { ...DEFAULT_SETTINGS, baseCurrency: 'CNY' }, fx: FALLBACK_FX };
  const out = recordReceipt(st, s, { kind: 'share', member: s.share.members[0] }, { id: 'r', date: '2026-03-12', periods: ['2026-03-10'] }, '2026-03-12');
  assert.equal(out.record.amount, 10);
  assert.deepEqual(out.after.share!.members[0].receipts![0].periods, ['2026-03-01']);
});
