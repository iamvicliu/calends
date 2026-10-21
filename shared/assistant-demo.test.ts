import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoState } from './demo.ts';
import { assistantTransport, demoHikes, demoMonth, demoPrompt, demoReceipt, demoReply, demoScenarios } from './assistant-demo.ts';
import { chargesBetween, subError } from './billing.ts';
import { chargeValue } from './fx.ts';
import { flatten, setLocale } from './i18n.ts';
import { readFileSync } from 'node:fs';
import type { AppState } from './types.ts';
const messages = {};
for (const ns of ['assistant', 'app', 'list']) flatten(ns, JSON.parse(readFileSync(new URL(`./locales/en/${ns}.json`, import.meta.url), 'utf8')), messages);
setLocale('en', [messages]);
const stateFor = (profile: 'default' | 'ai'): AppState => ({
  ...demoState('2026-10-21', profile),
  demo: true,
  fx: { base: 'USD', rates: { USD: 1, EUR: 0.92, TRY: 35, NGN: 1500, PHP: 56 }, fetchedAt: '2026-10-21' },
  fxHistory: {},
  prefs: {},
});

test('两个档位发送预设或自由文本都不触发任何 /api/assistant 请求', async () => {
  const requests: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    throw new Error('Unexpected network');
  };
  try {
    for (const profile of ['default', 'ai'] as const) {
      const state = stateFor(profile);
      for (const scenario of [...demoScenarios(state), undefined]) {
        let text = '';
        await assistantTransport(
          true,
          async () => {
            text = demoReply(state, '2026-10-21', scenario).text;
          },
          async () => {
            await fetch('/api/assistant/chat');
          },
        );
        assert.ok(text);
      }
    }
    assert.deepEqual(requests, []);
    let live = false;
    await assistantTransport(
      false,
      async () => assert.fail('Normal mode must use live transport'),
      async () => {
        live = true;
      },
    );
    assert.equal(live, true);
  } finally {
    globalThis.fetch = original;
  }
});

test('收据查重、月汇总、涨价和降级建议都读取当前账本', () => {
  for (const profile of ['default', 'ai'] as const) {
    const state = stateFor(profile);
    const receipt = demoReceipt(state, '2026-10-21');
    assert.equal(subError(receipt), undefined);
    assert.ok(demoPrompt(state, '2026-10-21', 'receipt').includes(receipt.account!));
    assert.equal(demoReply(state, '2026-10-21', 'receipt').subscription?.id, receipt.id);
    const before = demoMonth(state, '2026-10-21');
    state.subscriptions.push(receipt);
    assert.equal(demoReply(state, '2026-10-21', 'receipt').subscription, undefined);
    const after = demoMonth(state, '2026-10-21');
    assert.equal(after.count, before.count + 1);
    assert.ok(Math.abs(after.total - before.total - receipt.price) < 0.001);
    const all = state.subscriptions.filter((s) => !s.proxy).flatMap((s) => chargesBetween(s, '2026-10-01', '2026-10-31', '2026-10-21'));
    assert.equal(
      after.total,
      all.reduce((v, c) => v + chargeValue(state, c), 0),
    );
    assert.ok(demoHikes(state, '2026-10-21').length > 0);
    assert.ok(!demoReply(state, '2026-10-21', 'hikes').text.includes('assistant.demo'));
    assert.ok(demoReply(state, '2026-10-21').text.includes('https://github.com/imetn/calends'));
  }
  const state = stateFor('ai');
  const reply = demoReply(state, '2026-10-21', 'downgrade');
  assert.ok(reply.text.includes('usage data'));
  assert.ok(reply.text.includes('Claude Max 20x'));
  state.subscriptions = [];
  assert.equal(demoMonth(state, '2026-10-21').total, 0);
  assert.deepEqual(demoHikes(state, '2026-10-21'), []);
});
