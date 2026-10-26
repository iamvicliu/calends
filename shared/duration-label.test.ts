import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { calendarSpan, DAYS_PER_MONTH, durationLabel } from './billing.ts';
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

test('加入时长按日历数整年整月，剩下的算天；月底加入按月底对齐', () => {
  assert.deepEqual(calendarSpan('2021-04-14', '2026-10-26'), { years: 5, months: 6, days: 12 });
  assert.deepEqual(calendarSpan('2026-10-26', '2026-10-26'), { years: 0, months: 0, days: 0 });
  assert.deepEqual(calendarSpan('2026-01-31', '2026-02-28'), { years: 0, months: 1, days: 0 });
  assert.deepEqual(calendarSpan('2026-01-31', '2026-03-30'), { years: 0, months: 1, days: 30 });
});
