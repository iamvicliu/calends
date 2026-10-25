// 前端审查修复的回归测试：只测不依赖浏览器的纯函数与 store 行为
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cnDateFull } from './format.ts';
import { isDateField, proposalDay } from '../app/src/views/assistant-fields.ts';

test('助手草稿：只有日期字段按日期显示，category/status 等原样显示', () => {
  for (const k of ['date', 'end', 'at', 'until', 'from', 'expires', 'next_due', 'trial_end', 'paused_at', 'nextDue', 'trialEnd', 'collectFrom'])
    assert.equal(isDateField(k), true, k);
  for (const k of ['category', 'status', 'create_category', 'category_color', 'rate', 'name', 'start', 'amount']) assert.equal(isDateField(k), false, k);
  assert.equal(proposalDay('active'), 'active');
  assert.equal(proposalDay('Streaming'), 'Streaming');
  assert.equal(proposalDay('2026-03-04'), cnDateFull('2026-03-04'));
  assert.equal(proposalDay(undefined), undefined);
  assert.equal(proposalDay(''), undefined);
});
