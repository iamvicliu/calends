import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DAYS_PER_MONTH, durationLabel } from './billing.ts';
import { flatten, setLocale } from './i18n.ts';

const messages = {};
for (const ns of ['editor', 'list']) flatten(ns, JSON.parse(readFileSync(new URL(`./locales/en/${ns}.json`, import.meta.url), 'utf8')), messages);
setLocale('en', [messages]);
test('timeline and history durations use the same rounded-month boundary', () => {
  assert.equal(DAYS_PER_MONTH, 365.25 / 12);
  assert.equal(durationLabel(15), '15 days');
  assert.equal(durationLabel(16), '1 month');
  assert.equal(durationLabel(30), '1 month');
  assert.equal(durationLabel(61), '2 months');
  assert.equal(durationLabel(16, 'gap'), 'Lapsed 1 month');
});
