import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareEditorSave, mergeEditorSave } from '../app/src/views/editor/save.ts';
import { chargesBetween, FALLBACK_FX } from './billing.ts';
import { memberStatus, memberSegments } from './carpool.ts';
import { DEFAULT_SETTINGS, type AppState, type Subscription } from './types.ts';
const today = '2026-10-25';
const original: Subscription = {
  id: 'fiction',
  name: 'Fictional plan',
  category: 'tools',
  tags: [],
  price: 20,
  currency: 'USD',
  start: '2026-01-01',
  status: 'active',
  cycle: { unit: 'month', every: 1 },
};
const state = (s: Subscription): AppState => ({ subscriptions: [s], methods: [], fx: FALLBACK_FX, settings: DEFAULT_SETTINGS });

test('editor save trims fields, preserves past charges and applies a manual price edit only from today', () => {
  const form = { ...original, name: ' Fictional plan ', account: ' account@example.test ', price: 22 };
  const before = structuredClone(form),
    out = prepareEditorSave(original, form, today, false, 20);
  assert.deepEqual(form, before);
  assert.equal(out.name, 'Fictional plan');
  assert.equal(out.account, 'account@example.test');
  assert.deepEqual(
    chargesBetween(out, original.start, today, today).map((c) => [c.date, c.amount]),
    chargesBetween(original, original.start, today, today).map((c) => [c.date, c.amount]),
  );
  assert.equal(chargesBetween(out, '2026-11-01', '2026-11-01', today)[0].amount, 22);
});

test('editor merge keeps role edits but takes seats, receipts and unrelated fields from the latest plan, and cannot resurrect a deleted record', () => {
  const member = { id: 'm', name: 'Fictional member', share: 5, fee: 5, feeCurrency: 'USD', joined: original.start };
  const sub: Subscription = { ...original, share: { role: 'owner', seats: 4, members: [member], since: original.start } };
  const receipt = { id: 'r', date: today, amount: 5, currency: 'USD', periods: ['2026-10-01'] };
  const latest: Subscription = { ...sub, notes: 'written elsewhere', share: { ...sub.share!, seats: 6, members: [{ ...member, receipts: [receipt] }] } };
  const edited: Subscription = { ...sub, share: { ...sub.share!, role: 'member', ownerName: 'Fictional owner' } };
  const out = mergeEditorSave(sub, edited, latest, false);
  assert.equal(out.share!.role, 'member');
  assert.equal(out.share!.ownerName, 'Fictional owner');
  assert.equal(out.share!.seats, 6);
  assert.deepEqual(out.share!.members, latest.share!.members);
  assert.equal(out.notes, 'written elsewhere');
  assert.throws(() => mergeEditorSave(sub, edited, undefined, false));
});

test('shared member status exposes numeric dues and segments retain unpaid, paid and unused coverage', () => {
  const member = { id: 'm', name: 'Fictional member', share: 5, fee: 5, feeCurrency: 'USD', joined: '2026-10-01' };
  const sub: Subscription = { ...original, share: { role: 'owner', seats: 4, members: [member], collectFrom: '2026-10-01' } };
  const st = memberStatus(state(sub), sub, member, today);
  assert.equal(st.owed, 5);
  assert.equal(st.currency, 'USD');
  assert.equal(st.late, 24);
  assert.equal(st.owe, true);
  const left = { ...member, left: '2026-10-15', receipts: [{ id: 'r', date: '2026-10-01', amount: 5, currency: 'USD', periods: ['2026-10-01'] }] };
  const segments = memberSegments(sub, left, today, '2026-10-01', '2026-11-30');
  assert.deepEqual(segments, [
    { from: '2026-10-01', until: '2026-10-14', kind: 'paid' },
    { from: '2026-10-15', until: '2026-10-31', kind: 'unused' },
  ]);
  const free = { ...member, exempt: true };
  const freeSub = { ...sub, share: { ...sub.share!, members: [free] } };
  assert.equal(memberStatus(state(freeSub), freeSub, free, today).owe, false);
  assert.deepEqual(memberSegments(sub, free, today, '2026-10-01', '2026-11-30'), []);
});
