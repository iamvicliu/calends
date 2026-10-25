import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chargeMethodId, chargeSources, chargesBetween, FALLBACK_FX, runwayFor, subError } from './billing.ts';
import { maskForPublic } from './mask.ts';
import { savePayment } from './phases.ts';
import { deleteMethodData } from './ledger-edit.ts';
import { t } from './i18n.ts';
import { DEFAULT_SETTINGS, type AppState, type Payment, type Subscription } from './types.ts';

const today = '2026-10-25';
const base = (payments: Payment[] = []): Subscription => ({
  id: 'music',
  name: 'Fictional Music',
  category: 'Test',
  tags: [],
  price: 45.9,
  currency: 'USD',
  cycle: { unit: 'month', every: 1 },
  start: '2026-08-10',
  status: 'active',
  methodId: 'card',
  payments,
});
const ledger = (s: Subscription): AppState => ({
  subscriptions: [s],
  methods: [
    { id: 'card', name: 'Fictional credit card', kind: 'credit', currency: 'USD' },
    { id: 'bal', name: 'Fictional balance', kind: 'prepaid', currency: 'USD', balance: 100, balanceAsOf: '2026-10-01' },
    { id: 'pp', name: 'Fictional PayPal', kind: 'paypal', currency: 'USD', balance: 500, balanceAsOf: '2026-10-01' },
  ],
  settings: { ...DEFAULT_SETTINGS, baseCurrency: 'USD' },
  fx: FALLBACK_FX,
});

test('runway: a one-off charge paid from the balance reduces it even though the phase method is the credit card', () => {
  const st = ledger(base([{ date: '2026-10-10', amount: 45.9, methodId: 'bal' }]));
  const r = runwayFor(st.methods[1], st, today)!;
  // 修复前按阶段支付方式（信用卡）过滤，余额不扣，仍是 100
  assert.equal(Math.round(r.current * 100) / 100, 54.1);
  // 未来预测仍按阶段支付方式：信用卡订阅不会出现在余额的预测里
  assert.equal(r.forecast.length, 0);
  assert.equal(r.monthlyDrain, 0);
});

test('runway: the phase method no longer absorbs a charge recorded on another method', () => {
  const s = { ...base([{ date: '2026-10-10', amount: 45.9, methodId: 'card' }]), methodId: 'bal' };
  const st = ledger(s);
  const r = runwayFor(st.methods[1], st, today)!;
  assert.equal(r.current, 100);
  // 预测的扣款没有单笔记录，归阶段的余额
  assert.ok(r.forecast.length > 0 && r.forecast.every((c) => c.projected));
});

test('runway: split funding deducts each part from its own account', () => {
  const st = ledger({
    ...base([
      {
        date: '2026-10-10',
        amount: 178.8,
        funding: [
          { methodId: 'pp', amount: 168.05 },
          { methodId: 'bal', amount: 10.75 },
        ],
      },
    ]),
    price: 178.8,
  });
  assert.equal(Math.round(runwayFor(st.methods[1], st, today)!.current * 100) / 100, 89.25);
  assert.equal(Math.round(runwayFor(st.methods[2], st, today)!.current * 100) / 100, 331.95);
  const [c] = chargesBetween(st.subscriptions[0], '2026-10-10', '2026-10-10', today);
  assert.equal(chargeMethodId(c), 'pp');
  assert.deepEqual(
    chargeSources(c).map((x) => [x.methodId, Math.round(x.share * 178.8 * 100) / 100]),
    [
      ['pp', 168.05],
      ['bal', 10.75],
    ],
  );
});

test('runway: charges without funding or a per-charge method keep the phase method', () => {
  const st = ledger({ ...base([{ date: '2026-10-10', amount: 45.9 }]), methodId: 'bal' });
  assert.equal(Math.round(runwayFor(st.methods[1], st, today)!.current * 100) / 100, 54.1);
});

test('funding validation: two different sources, same sign, sum equals the amount, exclusive with methodId', () => {
  const pay = (p: Partial<Payment>): Subscription => base([{ date: '2026-10-10', amount: 178.8, ...p }]);
  const ok = [
    { methodId: 'pp', amount: 168.05 },
    { methodId: 'bal', amount: 10.75 },
  ];
  assert.equal(subError(pay({ funding: ok })), undefined);
  assert.equal(subError(pay({ funding: [ok[0], { methodId: 'bal', amount: 10 }] })), t('core.subError.fundingSum'));
  assert.ok(subError(pay({ funding: [{ methodId: 'pp', amount: 178.8 }] })));
  assert.ok(subError(pay({ funding: [ok[0], { methodId: 'pp', amount: 10.75 }] })));
  assert.ok(subError(pay({ funding: ok, methodId: 'card' })));
  assert.ok(subError(pay({ funding: ok, kind: 'failed' })));
  assert.ok(subError(pay({ funding: [ok[0], { methodId: 'bal', amount: -10.75 }] })));
  assert.ok(subError(pay({ funding: [ok[0], { methodId: '', amount: 10.75 }] })));
  // 退款的拆分同为负数
  assert.equal(
    subError(
      base([
        { date: '2026-10-10', amount: 45.9 },
        {
          date: '2026-10-12',
          amount: -20,
          kind: 'refund',
          funding: [
            { methodId: 'pp', amount: -15 },
            { methodId: 'bal', amount: -5 },
          ],
        },
      ]),
    ),
    undefined,
  );
});

test('savePayment keeps a split when an edit omits it, and an explicit method replaces it', () => {
  const s = base([
    {
      date: '2026-10-10',
      amount: 45.9,
      funding: [
        { methodId: 'pp', amount: 40 },
        { methodId: 'bal', amount: 5.9 },
      ],
    },
  ]);
  const kept = savePayment(s, today, { date: '2026-10-10', amount: 45.9, note: 'edited' }, { date: '2026-10-10', index: 0 });
  assert.equal(kept.payments![0].funding?.length, 2);
  const single = savePayment(s, today, { date: '2026-10-10', amount: 45.9, methodId: 'card' }, { date: '2026-10-10', index: 0 });
  assert.equal(single.payments![0].funding, undefined);
  assert.equal(single.payments![0].methodId, 'card');
});

test('public mask whitelists funding parts like methodId', () => {
  const st = ledger(
    base([
      {
        date: '2026-10-10',
        amount: 45.9,
        note: 'private note',
        funding: [{ methodId: 'pp', amount: 40, secret: 'x' } as never, { methodId: 'bal', amount: 5.9 }],
      },
    ]),
  );
  const out = maskForPublic(st);
  assert.deepEqual(out.subscriptions[0].payments![0].funding, [
    { methodId: 'pp', amount: 40 },
    { methodId: 'bal', amount: 5.9 },
  ]);
  assert.doesNotMatch(JSON.stringify(out), /private note|secret|Fictional PayPal/);
});

test('deleting a funding source migrates it and collapses a split onto one remaining method', () => {
  const st = ledger(
    base([
      {
        date: '2026-10-10',
        amount: 45.9,
        funding: [
          { methodId: 'pp', amount: 40 },
          { methodId: 'bal', amount: 5.9 },
        ],
      },
    ]),
  );
  const moved = deleteMethodData(st, 'bal', 'pp');
  assert.equal(moved.references.length, 1);
  const p = moved.subscriptions[0].payments![0];
  assert.equal(p.funding, undefined);
  assert.equal(p.methodId, 'pp');
  const other = deleteMethodData(st, 'bal', 'card').subscriptions[0].payments![0];
  assert.deepEqual(other.funding, [
    { methodId: 'pp', amount: 40 },
    { methodId: 'card', amount: 5.9 },
  ]);
});
