// 2026-10-25 审查 S 组（shared 领域层）的回归用例
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FALLBACK_FX } from './billing.ts';
import { prepareImport, readImportCsv } from './import-ledger.ts';
import { subRefsError } from './ledger-edit.ts';
import { prepareSubWrite } from './sub-write.ts';
import { DEFAULT_SETTINGS, type AppState, type Phase, type Subscription } from './types.ts';

const today = '2026-10-25';
const sub = (extra: Partial<Subscription> = {}): Subscription => ({
  id: 's',
  name: 'Fictional Cloud',
  category: 'Tools',
  tags: [],
  price: 10,
  currency: 'USD',
  cycle: { unit: 'month', every: 1 },
  start: '2026-01-01',
  status: 'active',
  ...extra,
});
const state = (subscriptions: Subscription[] = [], extra: Partial<AppState> = {}): AppState => ({
  subscriptions,
  methods: [],
  settings: { ...DEFAULT_SETTINGS },
  fx: FALLBACK_FX,
  ...extra,
});
const phase = (extra: Partial<Phase> = {}): Phase => ({ start: '2026-01-01', price: 10, currency: 'USD', cycle: { unit: 'month', every: 1 }, ...extra });
const phased = (second: Partial<Phase>) => sub({ price: 12, phases: [phase({ end: '2026-05-31' }), phase({ start: '2026-06-01', price: 12, ...second })] });
const writeError = (next: Subscription, previous?: Subscription) => {
  const r = prepareSubWrite(previous, next, today, state());
  return r.error;
};

test('S-1 整条写入拦下新引入的阶段价格、周期、开始日与各类日期格式错误', () => {
  assert.equal(writeError(phased({})), undefined);
  assert.ok(writeError(phased({ price: 'abc' as unknown as number })));
  assert.ok(writeError(phased({ price: -1 })));
  assert.ok(writeError(phased({ cycle: { unit: 'month', every: 0 } })));
  assert.ok(writeError(phased({ end: '2026-02-30' })));
  assert.ok(writeError(phased({ end: '2026-05-01' })), '结束日早于开始日');
  assert.ok(writeError(phased({ nextDue: 'tomorrow' })));
  assert.ok(writeError(phased({ intro: { price: 5, until: '2026-13-01' } })));
  assert.ok(writeError(phased({ bonus: { from: '2026-06-01', until: 'later' } })));
  assert.ok(writeError(sub({ end: '2026/12/31' })));
  assert.ok(writeError(sub({ nextDue: '2026-11-31' })));
  assert.ok(writeError(sub({ status: 'trial', trialEnd: '2026-02-30' })));
  assert.ok(writeError(sub({ status: 'paused', pausedAt: 'x' })));
  assert.ok(writeError(sub({ tags: 'a,b' as unknown as string[] })));
});

test('S-1 标签缺省补为空数组；库里原有的同一格式问题放行，只拦本次新写入的', () => {
  const r = prepareSubWrite(undefined, { ...sub(), tags: undefined as unknown as string[] }, today, state());
  assert.ok(!r.error && Array.isArray(r.sub.tags) && r.sub.tags.length === 0);
  const legacy = sub({ status: 'trial', trialEnd: '2026-02-30', notes: 'old' });
  assert.equal(writeError({ ...legacy, notes: 'edited' }, legacy), undefined);
  assert.ok(writeError({ ...legacy, nextDue: 'bad' }, legacy));
  // MCP 窄工具走 commit → subRefsError，同一套校验
  assert.ok(subRefsError(state(), undefined, phased({ cycle: { unit: 'week', every: 1.5 } })));
});

test('S-2 普通扣款写了与方案不同的币种时拒绝新写入，原有记录放行', () => {
  const pays = (currency?: string) => sub({ payments: [{ date: '2026-01-01', amount: 10, ...(currency ? { currency } : {}) }] });
  assert.equal(writeError(pays()), undefined);
  assert.equal(writeError(pays('USD')), undefined);
  assert.ok(writeError(pays('EUR')));
  assert.ok(writeError(phased({ payments: [{ date: '2026-06-01', amount: 12, kind: 'adjust', currency: 'EUR' }] })));
  const legacy = pays('EUR');
  assert.equal(writeError({ ...legacy, notes: 'edited' }, legacy), undefined);
});

test('S-3 旧格式 CSV：认不出的金额、周期、币种、开始日都在预览里报问题，不再猜成别的值', () => {
  const csv = [
    'Name,Currency,Price,Category,Cycle,Starts,Ends,Tags,Payment Account,URL,Notes',
    'Comma Price,EUR,"12,99",Tools,Monthly,2026-01-01,,,,,',
    'Odd Cycle,USD,5,Tools,Every fortnight,2026-01-01,,,,,',
    'No Currency,,5,Tools,Monthly,2026-01-01,,,,,',
    'Odd Start,USD,5,Tools,Monthly,31.12.2025,,,,,',
    'No Start,USD,5,Tools,Every 2 months,,,,,,',
    'Good,USD,9.99,Tools,Yearly,1/15/2026,,,,,',
  ].join('\n');
  const preview = prepareImport(readImportCsv(csv, [], today), [], today);
  const issue = (name: string) => preview.issues.find((i) => i.name === name)?.message;
  assert.ok(issue('Comma Price'));
  assert.ok(issue('Odd Cycle'));
  assert.ok(issue('No Currency'));
  assert.ok(issue('Odd Start'));
  const byName = new Map(preview.subscriptions.map((s) => [s.name, s]));
  assert.deepEqual([...byName.keys()].sort(), ['Good', 'No Start']);
  assert.equal(byName.get('Good')!.price, 9.99);
  assert.equal(byName.get('Good')!.start, '2026-01-15');
  assert.deepEqual(byName.get('No Start')!.cycle, { unit: 'month', every: 2 });
  assert.equal(byName.get('No Start')!.start, today);
});
