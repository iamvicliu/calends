import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paymentMethodGroups } from './payment-groups.ts';
import type { PaymentMethod } from './types.ts';

test('same-name cards retain identity, tail, refund and incomplete amounts', () => {
  const methods = [{ id: 'a', name: 'Fictional card', last4: '1111' }, { id: 'b', name: 'Fictional card', last4: '2222' }, { id: 'c', name: 'No tail' }] as PaymentMethod[];
  const groups = paymentMethodGroups(methods, [
    { methodId: 'a', value: 10, item: 'debit' }, { methodId: 'b', value: 20, item: 'second' },
    { methodId: 'a', value: -2, item: 'refund' }, { methodId: 'c', value: NaN, item: 'missing FX' }, { value: 0, item: 'unassigned' },
  ], 'Unassigned');
  assert.deepEqual(groups.slice(0, 2), [{ id: 'a', name: 'Fictional card · 1111', sum: 8, items: ['debit', 'refund'] }, { id: 'b', name: 'Fictional card · 2222', sum: 20, items: ['second'] }]);
  assert.equal(groups[2].name, 'No tail');
  assert.ok(Number.isNaN(groups[2].sum));
  assert.equal(groups[3].name, 'Unassigned');
});
