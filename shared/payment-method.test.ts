import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FALLBACK_FX, chargeMethodId, chargesBetween } from './billing.ts';
import { deleteMethodData } from './ledger-edit.ts';
import { savePayment, setPhaseMethod, switchPlan } from './phases.ts';
import { DEFAULT_SETTINGS, type AppState, type Subscription } from './types.ts';

// 虚构月付：两张卡 A、B，三笔已记录的扣款
const today = '2026-04-10';
const base: Subscription = {
  id: 'fictional-pay-method',
  name: 'Fictional monthly',
  price: 10,
  currency: 'USD',
  cycle: { unit: 'month', every: 1 },
  start: '2026-01-05',
  status: 'active',
  category: 'tools',
  tags: [],
  methodId: 'card-a',
  payments: [
    { date: '2026-01-05', amount: 10 },
    { date: '2026-02-05', amount: 10 },
    { date: '2026-03-05', amount: 10 },
  ],
};
const methods = (s: Subscription) =>
  chargesBetween(s, s.start, today, today)
    .filter((c) => !c.projected)
    .map(chargeMethodId);

test('a single charge can use another card without changing the rest of the plan', () => {
  const s = savePayment(base, today, { date: '2026-02-05', amount: 10, methodId: 'card-b' }, { date: '2026-02-05', index: 0 });
  assert.equal(s.methodId, 'card-a');
  assert.deepEqual(methods(s), ['card-a', 'card-b', 'card-a', 'card-a']);
});

test('changing the plan method moves every charge in that plan and drops overrides that now match', () => {
  let s = savePayment(base, today, { date: '2026-02-05', amount: 10, methodId: 'card-b' }, { date: '2026-02-05', index: 0 });
  s = setPhaseMethod(s, s.start, 'card-b');
  assert.equal(s.methodId, 'card-b');
  assert.equal(s.payments!.find((p) => p.date === '2026-02-05')!.methodId, undefined);
  assert.ok(methods(s).every((m) => m === 'card-b'));
});

test('with several plans only the chosen plan changes', () => {
  const two = switchPlan(base, '2026-03-05', { price: 12, currency: 'USD', cycle: base.cycle, methodId: 'card-a' });
  const s = setPhaseMethod(two, '2026-01-05', undefined);
  assert.equal(s.phases![0].methodId, undefined);
  assert.equal(s.phases![1].methodId, 'card-a');
});

test('deleting a card migrates single-charge overrides too, never leaving a dangling reference', () => {
  const s = savePayment(base, today, { date: '2026-02-05', amount: 10, methodId: 'card-b' }, { date: '2026-02-05', index: 0 });
  const st: AppState = {
    settings: DEFAULT_SETTINGS,
    fx: FALLBACK_FX,
    methods: [
      { id: 'card-a', name: 'A', kind: 'credit', currency: 'USD' },
      { id: 'card-b', name: 'B', kind: 'credit', currency: 'USD' },
    ],
    subscriptions: [s],
  };
  const out = deleteMethodData(st, 'card-b', 'card-a');
  assert.ok(out.references.some((r) => (r as { kind: string }).kind === 'payment'));
  assert.ok(out.subscriptions[0].payments!.every((p) => p.methodId !== 'card-b'));
});
