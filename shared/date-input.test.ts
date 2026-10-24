import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDateInput } from './date-input.ts';

test('manual dates accept leap day and all four supported formats', () => {
  assert.equal(parseDateInput('2024-02-29'), '2024-02-29');
  assert.equal(parseDateInput('2026-10-24'), '2026-10-24');
  assert.equal(parseDateInput('2026/10/24'), '2026-10-24');
  assert.equal(parseDateInput('2026年10月24日'), '2026-10-24');
  assert.equal(parseDateInput('20261024'), '2026-10-24');
  assert.equal(parseDateInput('1999-01-02'), '1999-01-02');
});

test('manual dates reject impossible calendar dates and unsupported formats', () => {
  for (const input of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-01', '2026-01-00', '2026/2/3', '2026.10.24', '2026102']) {
    assert.equal(parseDateInput(input), undefined, input);
  }
});
