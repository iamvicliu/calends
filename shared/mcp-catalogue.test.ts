import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TOOLS } from '../worker/ai/mcp-tools.ts';
import { mcp } from '../worker/ai/mcp.ts';
import { sha256 } from '../worker/auth.ts';
import { flatten, setLocale } from './i18n.ts';
import type { Env } from '../worker/env.ts';

const frozen = JSON.parse(readFileSync(new URL('./fixtures/mcp-catalogue.json', import.meta.url), 'utf8'));
const messages = {};
flatten('mcp', JSON.parse(readFileSync(new URL('./locales/en/mcp.json', import.meta.url), 'utf8')), messages);
setLocale('en', [messages]);

test('phase2 catalogue preserves names, flags, descriptions and serialized schemas in order', () => {
  assert.deepEqual(
    TOOLS.map((t) => [t.name, t.write, t.destructive, t.idempotent, t.description, JSON.stringify(t.inputSchema)]).map((t) => t.map((v) => v ?? null)),
    frozen.catalogue,
  );
});

test('phase2 tools/list preserves the transport catalogue and read-token order', async () => {
  const raw = 'fictional-phase2-catalogue-token';
  const token = { id: 'fictional', hash: await sha256(raw), scope: 'write', lastUsedAt: new Date().toISOString() };
  const env = {
    DB: {
      prepare() {
        let key: string;
        return {
          bind(k: string) {
            key = k;
            return this;
          },
          async first() {
            return { value: JSON.stringify(key === 'mcpTokens' ? [token] : key === 'mcpTokenUse' ? {} : {}) };
          },
        };
      },
    },
  } as unknown as Env;
  const list = async () => {
    const response = await mcp(
      new Request('https://fictional.invalid/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${raw}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      env,
    );
    assert.equal(response.status, 200);
    return ((await response.json()) as { result: { tools: unknown[] } }).result.tools;
  };
  assert.deepEqual(await list(), frozen.list);
  token.scope = 'read';
  assert.deepEqual(
    await list(),
    frozen.list.filter((t: { annotations: { readOnlyHint: boolean } }) => t.annotations.readOnlyHint),
  );
});

test('phase2 tool modules have no circular imports', () => {
  const visited = new Set<string>();
  const walk = (file: string, stack: string[]) => {
    assert.ok(!stack.includes(file), `circular import: ${[...stack, file].join(' -> ')}`);
    if (visited.has(file)) return;
    const source = readFileSync(new URL(`../worker/ai/${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/from ['"]\.\/([^'"]+\.ts)['"]/g)) {
      if (
        [
          'mcp-tools.ts',
          'tool-kit.ts',
          'tool-views.ts',
          'read-tools.ts',
          'subscription-tools.ts',
          'share-tools.ts',
          'ledger-tools.ts',
          'report-tools.ts',
        ].includes(match[1])
      )
        walk(match[1], [...stack, file]);
    }
    visited.add(file);
  };
  walk('mcp-tools.ts', []);
});
