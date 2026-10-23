import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingPeriod, chargesBetween, FALLBACK_FX, collectionAnchor, phaseLanes, phaseSubs, priceAt, stopSummary, subError } from './billing.ts';
import { deletePayment, movePhaseStart, paymentsOutsideMovedPhase, savePayment, setPhaseEnd, stopSubscription, switchPlan } from './phases.ts';
import { maskForPublic } from './mask.ts';
import { DEFAULT_SETTINGS, type Subscription } from './types.ts';

const base = (extra: Partial<Subscription> = {}): Subscription => ({
  id: 'fictional',
  name: 'Fictional plan',
  category: 'Tools',
  tags: [],
  start: '2024-01-31',
  price: 120,
  currency: 'USD',
  cycle: { unit: 'year', every: 1 },
  status: 'active',
  ...extra,
});
const charges = (s: Subscription) =>
  chargesBetween(s, '2020-01-01', '2030-12-31', '2026-10-22').map(({ sub, ...c }) => ({
    ...c,
    kind: c.kind,
    note: c.note,
    settled: c.settled,
    method: sub.methodId,
    phase: sub.start,
  }));
const values = (s: Subscription) => charges(s).map(({ phase: _phase, ...c }) => c);

for (const cycle of [
  { unit: 'month' as const, every: 1 },
  { unit: 'year' as const, every: 1 },
  { unit: 'day' as const, every: 3 },
]) {
  test(`moving inferred ${cycle.unit} start retains charges on the original anchor`, () => {
    const s = base({
      cycle,
      priceHistory: [
        { from: '2024-01-31', amount: 95 },
        { from: '2025-03-01', amount: 120 },
      ],
    });
    const original = structuredClone(s);
    const n = movePhaseStart(s, s.start, '2024-02-10');
    assert.deepEqual(
      values(n),
      values(s).filter((c) => c.date >= n.start),
    );
    assert.equal(n.start, '2024-02-10');
    assert.equal(n.priceHistory![0].from, n.start);
    assert.deepEqual(s, original);
    assert.equal(subError(n), undefined);
  });
}

test('first phase, planned phase and price changes preserve history, currency and sharing coverage', () => {
  const s = switchPlan(
    base({
      payments: [{ date: '2024-01-31', amount: 95, settled: { amount: 680, currency: 'CNY' }, note: 'original' }],
      priceHistory: [
        { from: '2024-01-31', amount: 95 },
        { from: '2024-06-01', amount: 120 },
      ],
      share: {
        role: 'owner',
        seats: 3,
        members: [
          { id: 'a', name: 'Fictional A', share: 40, payments: [{ date: '2024-02-01', amount: 40, currency: 'USD', from: '2024-01-31', until: '2025-01-30' }] },
        ],
      },
    }),
    '2027-01-01',
    { price: 1000, currency: 'JPY', cycle: { unit: 'month', every: 1 }, planned: true },
  );
  const original = structuredClone(s);
  const n = movePhaseStart(s, s.start, '2024-07-01');
  assert.equal(n.start, n.phases![0].start);
  assert.equal(collectionAnchor(n), collectionAnchor(s));
  assert.deepEqual(n.share!.members, s.share!.members);
  assert.deepEqual(n.phases![0].payments, s.phases![0].payments);
  assert.equal(priceAt(phaseSubs(n)[0], '2025-01-01'), 120);
  assert.deepEqual(values(n), values(s));
  const planned = movePhaseStart(n, '2027-01-01', '2027-02-01');
  assert.equal(planned.phases![1].planned, true);
  assert.equal(planned.phases![1].currency, 'JPY');
  assert.equal(planned.phases![0].end, n.phases![0].end);
  assert.equal(paymentsOutsideMovedPhase(s, n).length, 1);
  assert.deepEqual(s, original);
});

test('implicit sharing anchor is pinned when there are no receipts', () => {
  const s = base({ share: { role: 'owner', seats: 2, members: [{ id: 'a', name: 'A', share: 60 }] } });
  const n = movePhaseStart(s, s.start, '2024-02-10');
  assert.equal(collectionAnchor(n), s.start);
  assert.equal(n.share!.since, s.start);
});

test('overlap/gap follow explicit previous end, adjacent keys and own end cannot cross', () => {
  const s = switchPlan(base(), '2026-06-01', { price: 90, currency: 'EUR', cycle: { unit: 'month', every: 1 } }, '2026-08-01');
  assert.deepEqual(phaseLanes(phaseSubs(movePhaseStart(s, '2026-06-01', '2026-05-01'))), [0, 1]);
  assert.deepEqual(phaseLanes(phaseSubs(movePhaseStart(s, '2026-06-01', '2026-09-01'))), [0, 0]);
  assert.equal(movePhaseStart(s, '2026-06-01', '2026-09-01').phases![0].end, '2026-08-01');
  for (const date of ['2024-01-31', '2023-01-01', '2026-02-30', '']) assert.throws(() => movePhaseStart(s, '2026-06-01', date));
  assert.throws(() => movePhaseStart(s, s.start, '2026-06-01'));
  assert.throws(() => movePhaseStart(s, s.start, '2026-08-01'));
  assert.throws(() => movePhaseStart(s, 'missing', '2025-01-01'));
  assert.throws(() => setPhaseEnd(s, s.start, s.start));
  assert.strictEqual(movePhaseStart(s, s.start, s.start), s);
});

test('nested payment references remain editable by the new phase key', () => {
  const s = switchPlan(base(), '2026-06-01', { price: 20, currency: 'EUR', cycle: { unit: 'month', every: 1 } }, '2026-08-01');
  s.phases![1].payments = [
    { date: '2026-06-01', amount: 18, settled: { amount: 21, currency: 'USD' } },
    { date: '2026-07-01', amount: 20 },
  ];
  const n = movePhaseStart(s, '2026-06-01', '2026-06-10');
  assert.deepEqual(values(n), values(s));
  assert.equal(charges(n).find((c) => c.currency === 'EUR')!.phase, '2026-06-10');
  const outsideEdit = savePayment(n, '2026-10-22', { ...n.phases![1].payments![0], amount: 17 }, { date: '2026-06-01', index: 0 }, '2026-06-10');
  assert.equal(outsideEdit.phases![0].payments, undefined);
  assert.equal(outsideEdit.phases![1].payments![0].amount, 17);
  assert.equal(charges(outsideEdit).find((c) => c.date === '2026-06-01')!.currency, 'EUR');
  const changed = savePayment(n, '2026-10-22', { date: '2026-07-01', amount: 19 }, { date: '2026-07-01', index: 0 }, '2026-06-10');
  assert.equal(changed.phases![1].payments![1].amount, 19);
  const removed = deletePayment(changed, '2026-10-22', '2026-07-01', 0, '2026-06-10');
  assert.equal(removed.phases![1].payments!.length, 1);
});

test('stopped annual plan and refunds keep original paid-through and paid amounts after moving past the payment', () => {
  const s = stopSubscription(base({ start: '2026-01-01', payments: [{ date: '2026-01-01', amount: 120 }] }), '2026-06-01', 'cancel', '2026-06-01', undefined, {
    amount: 30,
  });
  const n = movePhaseStart(s, s.start, '2026-02-01');
  assert.deepEqual(n.stop, s.stop);
  assert.deepEqual(n.payments, s.payments);
  assert.deepEqual(billingPeriod(n, '2026-06-01'), billingPeriod(s, '2026-06-01'));
  assert.deepEqual(stopSummary(n), stopSummary(s));
  assert.deepEqual(values(n), values(s));
  assert.equal(subError(n), undefined);
  assert.equal(paymentsOutsideMovedPhase(s, n).length, 1);
  assert.throws(() => movePhaseStart(s, s.start, '2026-06-01'));
});

test('lifetime purchase never becomes a new purchase or zero after start correction', () => {
  const s = base({ cycle: { unit: 'lifetime', every: 1 }, price: 299 });
  const n = movePhaseStart(s, s.start, '2024-02-15');
  assert.deepEqual(n.payments, [{ date: s.start, amount: 299 }]);
  assert.deepEqual(values(n), values(s));
  assert.equal(paymentsOutsideMovedPhase(s, n).length, 1);
});

test('implicit previous boundary changes warn for its existing payments but do not reassign them', () => {
  const s = switchPlan(base(), '2026-06-01', { price: 10, currency: 'EUR', cycle: { unit: 'month', every: 1 } });
  s.phases![0].end = undefined;
  s.phases![0].payments = [{ date: '2026-05-15', amount: 120 }];
  const n = movePhaseStart(s, '2026-06-01', '2026-05-01');
  assert.equal(paymentsOutsideMovedPhase(s, n).length, 1);
  assert.deepEqual(n.phases![0].payments, s.phases![0].payments);
});

test('recorded month-end charges and leap-day yearly charges retain their future day-of-month', () => {
  for (const s of [
    base({ cycle: { unit: 'month', every: 1 }, payments: [{ date: '2024-02-29', amount: 120 }] }),
    base({ start: '2024-02-29', payments: [{ date: '2025-02-28', amount: 120 }] }),
  ]) {
    const n = movePhaseStart(s, s.start, '2024-03-10');
    assert.deepEqual(values(n), values(s));
  }
});

test('trial, bonus, failed and zero charges preserve their meanings', () => {
  for (const s of [
    base({ status: 'trial', trialEnd: '2024-03-31', cycle: { unit: 'month', every: 1 }, payments: [{ date: '2024-04-30', amount: 120 }] }),
    base({
      bonus: { from: '2025-01-01', until: '2026-01-01' },
      price: 0,
      payments: [
        { date: '2024-01-31', amount: 0 },
        { date: '2025-01-31', amount: 120, kind: 'failed' },
      ],
    }),
  ]) {
    const n = movePhaseStart(s, s.start, '2024-02-10');
    assert.deepEqual(values(n), values(s));
    assert.deepEqual(n.bonus, s.bonus);
    assert.equal(n.trialEnd, s.trialEnd);
  }
});

test('stopped inferred annual period remains valid after correcting service start', () => {
  const s = stopSubscription(base({ start: '2026-01-01' }), '2026-06-01', 'terminate', '2026-06-01', 'Fictional provider stop');
  const n = movePhaseStart(s, s.start, '2026-02-01');
  assert.equal(subError(n), undefined);
  assert.deepEqual(stopSummary(n), stopSummary(s));
});

test('explicit prepaid nextDue is preserved without filling skipped renewals or drifting month-end dates', () => {
  for (const payments of [undefined, [{ date: '2024-01-31', amount: 120 }]]) {
    const s = base({ cycle: { unit: 'month', every: 1 }, nextDue: '2027-02-28', payments });
    const n = movePhaseStart(s, s.start, '2024-02-10');
    assert.equal(n.nextDue, s.nextDue);
    assert.deepEqual(
      values(n),
      values(s).filter((c) => payments || c.date >= n.start),
    );
    assert.equal(movePhaseStart(n, n.start, '2024-03-10').billingStart, s.start);
  }
});

test('billing anchor survives JSON round trips and public masking without exposing private fields', () => {
  const plain = movePhaseStart(
    base({ account: 'private-fictional', notes: 'private note', payments: [{ date: '2024-01-31', amount: 120 }] }),
    '2024-01-31',
    '2024-02-10',
  );
  const phased = switchPlan(plain, '2027-01-01', { price: 10, currency: 'EUR', cycle: { unit: 'month', every: 1 } });
  for (const s of [plain, phased]) {
    const restored = JSON.parse(JSON.stringify(s)) as Subscription;
    assert.deepEqual(values(restored), values(s));
    const masked = maskForPublic({ subscriptions: [restored], methods: [], settings: DEFAULT_SETTINGS, fx: FALLBACK_FX }).subscriptions[0];
    assert.deepEqual(values(masked), values(s));
    assert.equal(masked.account, undefined);
    assert.equal(masked.notes, undefined);
    assert.equal(subError(restored), undefined);
  }
});

test('记录之后推算出的扣款（结束日当天那一期）可以修改和删除，删除后不再被推算回来', () => {
  const phase = {
    start: '2026-07-20',
    end: '2026-08-20',
    price: 199,
    currency: 'CNY',
    cycle: { unit: 'month' as const, every: 1 },
    payments: [{ date: '2026-07-20', amount: 199 }],
  };
  const s: Subscription = {
    id: 'k',
    name: 'K',
    category: 'AI',
    tags: [],
    status: 'active',
    start: '2026-07-20',
    price: 199,
    currency: 'CNY',
    cycle: { unit: 'month', every: 1 },
    end: '2026-08-20',
    phases: [phase],
  };
  const today = '2026-10-23';
  const dates = (x: Subscription) => chargesBetween(x, '2026-01-01', '2026-12-31', today).map((c) => c.date);
  assert.deepEqual(dates(s), ['2026-07-20', '2026-08-20']);
  const removed = deletePayment(s, today, '2026-08-20', 0);
  assert.deepEqual(dates(removed), ['2026-07-20']);
  const edited = savePayment(s, today, { date: '2026-08-20', amount: 99 }, { date: '2026-08-20', index: 0 });
  assert.deepEqual(
    chargesBetween(edited, '2026-08-20', '2026-08-20', today).map((c) => c.amount),
    [99],
  );
});
