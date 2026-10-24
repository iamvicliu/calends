import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingPeriod, chargesBetween, paymentError } from './billing.ts';
import type { Subscription } from './types.ts';

// 虚构的导入订阅：年付 120 USD，2024-03-01 开始，2026-10-24 从外部账本导入（之前没有逐笔记录）
const imported = (o: Partial<Subscription> = {}): Subscription => ({
  id: 'fictional-import',
  name: 'Fictional imported plan',
  category: 'Tools',
  tags: [],
  price: 120,
  currency: 'USD',
  cycle: { unit: 'year', every: 1 },
  start: '2024-03-01',
  status: 'active',
  estimateFrom: '2026-10-24',
  ...o,
});

test('导入边界只影响统计：边界前的推算扣款不计入支出，但当前账期照常按计费规则推算', () => {
  const s = imported();
  // 统计：边界前没有记录的推算扣款不算
  assert.equal(chargesBetween(s, '2024-01-01', '2026-10-23', '2026-11-10').length, 0);
  // 账期：2026-03-01 那一期仍然在，已付 120、共 365 天
  const period = billingPeriod(s, '2026-11-10');
  assert.equal(period.from, '2026-03-01');
  assert.equal(period.paid, 120);
  assert.equal(period.days, 365);
});

test('导入后、第一笔扣款前立即取消，可以记录不超过本期已付的退款', () => {
  const s = imported({
    stop: { kind: 'cancel', date: '2026-11-10', immediate: true } as Subscription['stop'],
    payments: [{ date: '2026-11-10', amount: -36, kind: 'refund' }],
  });
  assert.equal(paymentError(s), undefined);
  const tooMuch = imported({ payments: [{ date: '2026-11-10', amount: -130, kind: 'refund' }] });
  assert.ok(paymentError(tooMuch));
});
