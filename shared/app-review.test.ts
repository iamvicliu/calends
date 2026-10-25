// 前端审查修复的回归测试：只测不依赖浏览器的纯函数与 store 行为
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
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

test('助手：读回本机会话时残留的 streaming 回复记为中断，可以重试', async () => {
  const { settleTurns } = await import('../app/src/views/assistant-fields.ts');
  const turns = settleTurns([
    { role: 'user', text: 'hi' },
    { role: 'assistant', status: 'done', parts: [] },
    { role: 'assistant', status: 'streaming', parts: [] },
  ] as Array<{ role: string; status?: string; error?: { kind: string; message: string } }>);
  assert.equal(turns[1].status, 'done');
  assert.equal(turns[2].status, 'error');
  assert.equal(turns[2].error?.kind, 'network');
});

test('子路径安装：本机键带安装前缀，旧的无前缀键只读兼容', async (t) => {
  const values = new Map<string, string>([['ledger:locale', 'de']]);
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) },
  });
  t.after(() => (prev ? Object.defineProperty(globalThis, 'localStorage', prev) : Reflect.deleteProperty(globalThis, 'localStorage')));
  // base.ts 读 import.meta.env.BASE_URL：用与 live-sync-store 相同的做法换成 /ledger
  const { registerHooks } = await import('node:module');
  const hook = registerHooks({
    load(url, ctx, next) {
      if (url.includes('/app/src/base.ts?subpath'))
        return {
          format: 'module-typescript',
          shortCircuit: true,
          source: readFileSync(new URL('../app/src/base.ts', import.meta.url), 'utf8').replace('import.meta.env.BASE_URL', "'/ledger/'"),
        };
      return next(url, ctx);
    },
  });
  t.after(() => hook.deregister());
  const { readStored, storageKey } = await import('../app/src/base.ts?subpath');
  assert.equal(storageKey('ledger:locale'), 'ledger:locale:/ledger');
  assert.equal(readStored('ledger:locale'), 'de');
  values.set('ledger:locale:/ledger', 'ja');
  assert.equal(readStored('ledger:locale'), 'ja');
});
