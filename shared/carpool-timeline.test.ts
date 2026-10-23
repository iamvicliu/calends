import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, diffDays, memberCollection, memberUnpaidFrom } from './billing.ts';
import { carpoolRoster, carpoolTimeline } from './carpool-timeline.ts';
import type { ShareMember, Subscription } from './types.ts';

const today = '2026-10-23';
const member = (o: Partial<ShareMember> = {}): ShareMember => ({ id: 'a', name: 'A', share: 10, fee: 10, billEvery: 1, joined: '2024-01-01', ...o });
const sub = (members: ShareMember[], seats = 4): Subscription => ({
  id: 's',
  name: 'Shared test',
  category: '',
  tags: [],
  price: 40,
  currency: 'CNY',
  cycle: { unit: 'month', every: 1 },
  start: '2024-01-01',
  status: 'active',
  share: { role: 'owner', seats, collectFrom: '2024-01-01', members },
});

test('离开当天收起成员；不分摊与未来加入的成员仍占位，历史收款不变', () => {
  const s = sub([
    member(),
    member({ id: 'exempt', exempt: true }),
    member({ id: 'future', joined: '2026-11-01' }),
    member({ id: 'left', left: today, payments: [{ date: '2026-01-01', amount: 10, currency: 'CNY', until: '2026-01-31' }] }),
  ]);
  const before = JSON.stringify(s);
  const roster = carpoolRoster(s, today);
  assert.deepEqual(
    roster.active.map((m) => m.id),
    ['a', 'exempt', 'future'],
  );
  assert.deepEqual(
    roster.departed.map((m) => m.id),
    ['left'],
  );
  // 四座车：三位在车成员（含不分摊、未来加入）+ 车主自己，正好坐满
  assert.equal(roster.taken, 4);
  assert.equal(roster.vacancies, 0);
  assert.equal(carpoolRoster(sub(s.share!.members, 5), today).vacancies, 1);
  assert.equal(JSON.stringify(s), before);
  assert.equal(carpoolRoster(sub(roster.active, 1), today).vacancies, 0);
});

test('左界包含下车成员的最早加入日，默认从右侧显示十五个月', () => {
  const s = sub([member(), member({ id: 'old', joined: '2022-03-05', left: '2023-01-01' })]);
  const win = carpoolTimeline(s, today, 1);
  assert.equal(win.start, '2022-03-05');
  assert.equal(win.end, '2026-12-14'); // 第一段未来期 11 月，期末后两周
  assert.equal(win.viewDays, diffDays(addMonths(win.end, -15), win.end));
  assert.equal(win.maxOffset, diffDays(win.start, addMonths(win.end, -15)));
});

test('右界取所有在车成员下一期的最晚期末，跳过欠费且保留提前付费后的下一期', () => {
  const annual = member({ id: 'annual', paidUntil: '2027-01-31', billEvery: 12 });
  const s = sub([member(), annual, member({ id: 'gone', left: today, paidUntil: '2030-01-31' })]);
  const win = carpoolTimeline(s, today, 1);
  assert.equal(win.end, addDays(memberCollection(s, annual, memberUnpaidFrom(s, annual)).until, 14));
  assert.equal(win.end, '2028-02-14');
});

test('短历史全部展示，空车使用车规则周期，收款起点优先于推导的收款覆盖起点', () => {
  const s = sub([]);
  s.start = today;
  s.share!.collectFrom = today;
  const win = carpoolTimeline(s, today, 3);
  assert.equal(win.end, addDays(addMonths(today, 3), 14));
  assert.equal(win.start, addMonths(today, -3));
  assert.equal(win.maxOffset, 0);
  assert.equal(win.totalDays, win.viewDays);
  delete s.share!.collectFrom;
  s.share!.since = '2026-06-01';
  assert.equal(carpoolTimeline(s, today, 1).start, '2026-06-01');
});

test('首期对齐、免费首期及未来收费周期参与下一期边界', () => {
  const m = member({
    joined: '2026-10-20',
    firstPeriod: 'free',
    feeHistory: [
      { from: '2026-10-20', fee: 10, currency: 'CNY', billEvery: 1 },
      { from: '2026-11-01', fee: 100, currency: 'CNY', billEvery: 12 },
    ],
  });
  const s = sub([m]);
  assert.equal(carpoolTimeline(s, today, 1).end, '2027-11-14');
});

test('不分摊成员没有 future 或 due 段，不把右界拉长到订阅的默认年周期', () => {
  const s = sub([member(), member({ id: 'exempt', exempt: true, billEvery: 12, paidUntil: '2030-01-01' })]);
  assert.equal(carpoolTimeline(s, today, 1).end, '2026-12-14');
});

test('逾期 1658 天与长期预付同车时，默认窗口仍含今天及前三个月', () => {
  const overdue = member({ joined: addDays(today, -1658) });
  const prepaid = member({ id: 'prepaid', paidUntil: '2030-01-31', billEvery: 12 });
  const win = carpoolTimeline(sub([overdue, prepaid]), today, 1);
  const left = addDays(win.end, -win.viewDays);
  assert.ok(win.end >= addMonths(today, 1));
  assert.ok(left <= addMonths(today, -3));
  assert.ok(left < today && today < win.end);
  assert.ok(win.end >= '2031-01-31');
});

test('短收费周期右侧也至少留出一个月，不丢今天线', () => {
  const win = carpoolTimeline(sub([member({ joined: today })]), '2026-10-01', 1);
  assert.ok(win.end >= '2026-11-01');
  assert.ok(addDays(win.end, -win.viewDays) <= '2026-07-01');
});
