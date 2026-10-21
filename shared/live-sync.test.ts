import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceRevision, canApplySnapshot, CHECK_THROTTLE, PREF_GRACE, shouldCheck, shouldPoll, syncedPrefs, SYNC_INTERVAL } from './live-sync.ts';

test('sync polls only visible editable sessions, including cached offline sessions', () => {
  assert.equal(SYNC_INTERVAL, 30_000);
  for (const phase of ['ready', 'offline']) {
    assert.equal(shouldPoll(phase, false, true), true);
    assert.equal(shouldPoll(phase, true, true), false);
    assert.equal(shouldPoll(phase, false, false), false);
  }
  for (const phase of ['login', 'loading']) assert.equal(shouldPoll(phase, false, true), false);
  assert.equal(shouldCheck(100_000, -Infinity, 0, true), true);
  assert.equal(shouldCheck(CHECK_THROTTLE - 1, 0, 0, true), false);
  assert.equal(shouldCheck(CHECK_THROTTLE, 0, 0, true), true);
  assert.equal(shouldCheck(100_000, 0, 1, true), false);
  assert.equal(shouldCheck(100_000, 0, 0, false), false);
});

test('sync rejects reads started during writes, overlapping writes, and older SW snapshots', () => {
  assert.equal(canApplySnapshot(0, 0, 1, 1, 5, 4), true);
  assert.equal(canApplySnapshot(0, 0, 1, 1, 5), true);
  assert.equal(canApplySnapshot(1, 0, 1, 1, 5, 4), false);
  assert.equal(canApplySnapshot(0, 1, 1, 1, 5, 4), false);
  assert.equal(canApplySnapshot(0, 0, 1, 3, 5, 4), false);
  assert.equal(canApplySnapshot(0, 0, 1, 1, 3, 4), false);
  assert.equal(canApplySnapshot(0, 0, 1, 1, undefined, 4), false);
});

test('own concurrent/bulk writes advance only contiguous revisions, never hide a remote write', () => {
  assert.equal(advanceRevision(4, [{ from: 4, rev: 5 }]), 5);
  assert.equal(advanceRevision(4, [{ from: 4, rev: 20 }]), 20);
  assert.equal(advanceRevision(4, [{ from: 5, rev: 6 }]), 4);
  assert.equal(
    advanceRevision(4, [
      { from: 5, rev: 6 },
      { from: 4, rev: 5 },
    ]),
    6,
  );
  assert.equal(
    advanceRevision(4, [
      { from: 4, rev: 5 },
      { from: 6, rev: 7 },
    ]),
    5,
  );
  assert.equal(advanceRevision(8, [{ from: 4, rev: 5 }]), 8);
  assert.equal(advanceRevision(undefined, [{ from: 4, rev: 5 }]), undefined);
});

test('remote prefs follow, local edits get a five-second grace period, and deletions stay deleted', () => {
  const edits = new Map([
    ['list-view', 10_000],
    ['theme', 10_000],
  ]);
  const local = { 'list-view': 'grid', 'list-sort': 'next' };
  const remote = { 'list-view': 'table', 'list-sort': 'name', theme: 'dark' };
  const recent = syncedPrefs(remote, local, edits, {}, 10_001);
  assert.deepEqual(recent.prefs, { 'list-view': 'grid', 'list-sort': 'name' });
  assert.equal(recent.retryAt, 10_000 + PREF_GRACE);
  assert.deepEqual(syncedPrefs(remote, local, edits, {}, 10_000 + PREF_GRACE), { prefs: remote, retryAt: 0 });
  assert.deepEqual(syncedPrefs({}, { theme: 'light' }, new Map(), {}, 10_000).prefs, {});
  assert.equal(syncedPrefs(remote, local, edits, { 'list-view': 'grid' }, 50_000).prefs['list-view'], 'grid');
  assert.equal(syncedPrefs(remote, local, edits, { theme: null }, 50_000).prefs.theme, undefined);
});
