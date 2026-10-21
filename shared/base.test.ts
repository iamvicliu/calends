import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeBasePath, siteUrl, stripBase, withBase } from './base.ts';

test('前缀按路径段匹配，可重复应用且根目录行为不变', () => {
  assert.equal(normalizeBasePath('/claude/'), '/claude');
  for (const path of ['/list', '/api/state', '/mcp', '/cal/key.ics', '/icons/logo.svg', '/']) {
    assert.equal(withBase(path), path);
    const prefixed = withBase(path, '/claude');
    assert.equal(prefixed, '/claude' + path);
    assert.equal(withBase(prefixed, '/claude'), prefixed);
    assert.equal(stripBase(prefixed, '/claude'), path);
  }
  for (const path of ['https://example.com/a', '//example.com/a', 'data:image/png;base64,abc', '🤖']) assert.equal(withBase(path, '/claude'), path);
  assert.equal(stripBase('/claudette/api/state', '/claude'), '/claudette/api/state');
  assert.equal(stripBase('/claude', '/claude'), '/');
  assert.equal(siteUrl('https://example.com/', '/claude'), 'https://example.com/claude');
  assert.equal(siteUrl('https://example.com/claude/', '/claude'), 'https://example.com/claude');
  assert.equal(siteUrl('https://example.com/'), 'https://example.com');
});
