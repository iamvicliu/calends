import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconInput, isDataIcon, isImageIcon } from './icon.ts';

test('订阅图标：网址、站内路径和 png/jpeg/webp 内嵌图片是图片，其余当 emoji', () => {
  assert.ok(isImageIcon('https://example.test/a.png'));
  assert.ok(isImageIcon('/ai/claude.svg'));
  assert.ok(isImageIcon('data:image/png;base64,iVBORw0KGgo='));
  assert.ok(isDataIcon('data:image/webp;base64,UklGRg=='));
  // svg 内嵌图片不认（可能带脚本），当文字处理也不会执行
  assert.ok(!isDataIcon('data:image/svg+xml;base64,PHN2Zz4='));
  assert.ok(!isImageIcon('🎬'));
  assert.ok(!isImageIcon(undefined));
});

test('iconInput：接受网址、站内路径、内嵌图片和 emoji，空值清除，其余报错', () => {
  assert.equal(iconInput(' 🎬 '), '🎬');
  assert.equal(iconInput('🇯🇵'), '🇯🇵');
  assert.equal(iconInput('https://example.test/a.png'), 'https://example.test/a.png');
  assert.equal(iconInput('/ai/claude.svg'), '/ai/claude.svg');
  assert.equal(iconInput('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(iconInput(''), undefined);
  assert.equal(iconInput(null), undefined);
  for (const bad of ['javascript:alert(1)', 'mailto:a@example.test', 'https://', '//evil.test/x', 'two words', 'abcdefgh', 'data:image/svg+xml;base64,PHN2Zz4=', `data:image/png;base64,${'A'.repeat(90000)}`])
    assert.throws(() => iconInput(bad), undefined, bad);
});
