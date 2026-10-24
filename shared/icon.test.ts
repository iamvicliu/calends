import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDataIcon, isImageIcon } from './icon.ts';

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
