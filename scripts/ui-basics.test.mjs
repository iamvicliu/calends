import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parsers } from 'prettier/plugins/typescript';
import { transformSync } from 'oxc-transform-react';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { tooltipPosition } from '../app/src/components/tooltip-position.ts';

const root = new URL('../app/src/', import.meta.url);
const sources = [];
for (const file of readdirSync(root, { recursive: true }).filter((file) => file.endsWith('.tsx') && !file.startsWith('public/'))) {
  const source = readFileSync(new URL(file, root), 'utf8');
  sources.push([file, await parsers.typescript.parse(source), source]);
}
const visit = (node, fn) => {
  if (!node || typeof node !== 'object') return;
  fn(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'range', 'comments', 'tokens'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => visit(child, fn));
    else visit(value, fn);
  }
};
const attr = (node, key) => node.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === key);
const text = (node, source) => (node ? source.slice(...node.range) : '');
const functionRange = (ast, name) => {
  let range;
  visit(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) range = node.range;
  });
  return range;
};
const inside = (node, range) => range && node.range[0] >= range[0] && node.range[1] <= range[1];

test('app title hints go through CardTitle so text and trigger share an alignment context', () => {
  const failures = [];
  for (const [file, ast] of sources) {
    const owner = file === 'components/ui.tsx' ? functionRange(ast, 'CardTitle') : undefined;
    visit(ast, (node) => {
      if (node.type === 'JSXOpeningElement' && node.name.name === 'Hint' && !inside(node, owner)) failures.push(file);
    });
  }
  assert.deepEqual(failures, []);
});

test('circular icon controls use the shared primitive and cannot override its hit area inline', () => {
  const failures = [];
  for (const [file, ast, source] of sources) {
    const owner = file === 'components/ui.tsx' ? functionRange(ast, 'IconButton') : undefined;
    visit(ast, (node) => {
      if (node.type !== 'JSXOpeningElement') return;
      const tag = node.name.name;
      const classes = text(attr(node, 'className')?.value, source);
      if (
        !inside(node, owner) &&
        tag === 'button' &&
        /(?<![\w-])(?:icon-btn|sb-btn|dp-nav|tb-search-x|as-icon|as-send|as-bottom|pubs-x|cat-grip)(?![\w-])/.test(classes)
      )
        failures.push(`${file}: native ${classes}`);
      if (tag === 'IconButton' && /\b(width|height|transform|marginTop)\s*:/.test(text(attr(node, 'style'), source)))
        failures.push(`${file}: inline size/offset`);
      if (tag === 'IconButton' && !attr(node, 'aria-label')) failures.push(`${file}: missing accessible label`);
    });
  }
  assert.deepEqual(failures, []);
});

test('chart tooltip placement fits narrow viewports and flips at the top edge', () => {
  assert.deepEqual(tooltipPosition({ x: 200, top: 200, bottom: 230 }, { width: 180, height: 40 }, { width: 390, height: 844 }), { left: 110, top: 152 });
  for (const x of [0, 20, 195, 390]) {
    for (const top of [0, 15, 400, 840]) {
      const pos = tooltipPosition({ x, top, bottom: top + 32 }, { width: 320, height: 80 }, { width: 390, height: 844 });
      assert.ok(pos.left >= 8 && pos.left + 320 <= 382);
      assert.ok(pos.top >= 8 && pos.top + 80 <= 836);
    }
  }
  assert.equal(tooltipPosition({ x: 100, top: 0, bottom: 32 }, { width: 180, height: 40 }, { width: 390, height: 844 }).top, 40);
});

test('title and icon primitives preserve heading semantics, accessible names and non-submitting actions', () => {
  const [, ast, source] = sources.find(([file]) => file === 'components/ui.tsx');
  const functions = [];
  visit(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && ['CardTitle', 'IconButton'].includes(node.id?.name)) functions.push(text(node, source));
  });
  const result = transformSync('ui.tsx', functions.join('\n'), { lang: 'tsx', jsx: { runtime: 'classic' }, reactCompiler: false });
  assert.equal(result.fatal, false);
  const { CardTitle, IconButton } = new Function('React', 'Hint', `${result.code}; return { CardTitle, IconButton };`)(React, 'hint');
  const title = renderToStaticMarkup(React.createElement(CardTitle, { as: 'h2', hint: 'Details' }, '每月花了多少'));
  assert.match(title, /<h2 class="ui-title /);
  assert.match(title, /<span class="ui-title-text">每月花了多少<\/span>/);
  assert.match(title, /<hint text="Details"/);
  const button = renderToStaticMarkup(React.createElement(IconButton, { 'aria-label': 'Close', className: 'accent', disabled: true }));
  assert.match(button, /type="button"/);
  assert.match(button, /aria-label="Close"/);
  assert.match(button, /class="icon-btn accent"/);
  assert.match(button, /disabled=""/);
});
