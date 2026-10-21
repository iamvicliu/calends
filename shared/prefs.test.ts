import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePrefs } from './prefs.ts';

test('按项合并：只改传来的项，null 删除', () => {
  const cur = { 'list-view': 'grid', theme: 'dark' };
  assert.deepEqual(mergePrefs(cur, { 'list-view': 'gantt' }), { 'list-view': 'gantt', theme: 'dark' });
  assert.deepEqual(mergePrefs(cur, { theme: null }), { 'list-view': 'grid' });
  assert.deepEqual(cur, { 'list-view': 'grid', theme: 'dark' }, '不改原对象');
});

test('不合规的键和值被丢弃', () => {
  const out = mergePrefs({}, { 'Bad Key': 'x', ok: 1, long: 'x'.repeat(5000), 'car-open': '["a"]', __proto__: 'x' });
  assert.deepEqual(out, { 'car-open': '["a"]' });
  assert.deepEqual(mergePrefs({ a: '1' }, null), { a: '1' });
  assert.deepEqual(mergePrefs({ a: '1' }, ['x']), { a: '1' });
});

test('数量上限：已有的项仍可修改，新项不再加入', () => {
  const full = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, 'v']));
  const out = mergePrefs(full, { k1: 'w', extra: 'v' });
  assert.equal(out.k1, 'w');
  assert.equal(out.extra, undefined);
});
