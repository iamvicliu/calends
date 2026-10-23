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

// Exercise the real price editor handlers with a small hook driver; domain validation stays real.
async function priceEditorHarness() {
  const billing = await import('../shared/billing.ts');
  const phases = await import('../shared/phases.ts');
  const { t } = await import('../shared/i18n.ts');
  const [, ast, source] = sources.find(([file]) => file === 'components/ChangePanel.tsx');
  const range = functionRange(ast, 'ChangePanel');
  const result = transformSync('ChangePanel.tsx', source.slice(...range), { lang: 'tsx', jsx: { runtime: 'classic' }, reactCompiler: false });
  assert.equal(result.fatal, false);
  const hooks = [];
  let cursor = 0;
  let valid = true;
  let confirmations = 0;
  let confirm = true;
  let form = {
    id: 'fictional',
    name: 'Orbit Notes',
    category: 'tools',
    tags: [],
    currency: 'USD',
    cycle: { unit: 'month', every: 1 },
    start: '2026-01-01',
    end: '2026-12-31',
    status: 'active',
    price: 18,
    priceHistory: [
      { from: '2026-01-01', amount: 10 },
      { from: '2026-04-01', amount: 14 },
      { from: '2026-07-01', amount: 18 },
    ],
  };
  const deps = {
    ...billing,
    ...phases,
    React,
    t,
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [
        hooks[index],
        (value) => {
          hooks[index] = value;
        },
      ];
    },
    useId: () => 'point-error',
    CYCLES: [['m1', { unit: 'month', every: 1 }]],
    Trash2: 'trash',
    History: 'history',
    Group: 'group',
    Icon: 'icon',
    IconButton: 'icon-button',
    DatePicker: 'date-picker',
    ask: async () => {
      confirmations++;
      return confirm;
    },
  };
  const Component = new Function(...Object.keys(deps), `${result.code}; return ChangePanel;`)(...Object.values(deps));
  const walk = (el) => (!el || typeof el !== 'object' ? [] : [el, ...React.Children.toArray(el.props?.children).flatMap(walk)]);
  const render = () => {
    cursor = 0;
    return Component({
      f: form,
      setF: (next) => {
        form = next;
      },
      state: { methods: [] },
      today: '2026-10-22',
      onPriceValidity: (v) => {
        valid = v;
      },
    });
  };
  const history = () => walk(render()).find((el) => el.type === 'history');
  const inline = () => history().props.priceEditor?.content;
  return {
    open: (from = '2026-07-01') => history().props.onPrice('2026-01-01', from),
    change: (type, value) =>
      type === 'date'
        ? walk(inline())
            .find((el) => el.type === 'date-picker')
            .props.onChange(value || undefined)
        : walk(inline())
            .find((el) => el.type === 'input' && el.props.inputMode === 'decimal')
            .props.onChange({ target: { value } }),
    remove: () =>
      walk(inline())
        .find((el) => el.type === 'icon-button')
        .props.onClick(),
    inline,
    form: () => form,
    valid: () => valid,
    confirmations: () => confirmations,
    confirm: (v) => {
      confirm = v;
    },
    nodes: () => walk(inline()),
  };
}

test('inline price edits update the form immediately without an inner apply/cancel or confirmation', async () => {
  const h = await priceEditorHarness();
  h.open();
  h.change('amount', '22');
  assert.equal(h.form().priceHistory.at(-1).amount, 22);
  h.change('date', '2026-06-15');
  assert.equal(h.form().priceHistory.at(-1).from, '2026-06-15');
  h.change('amount', '0');
  assert.equal(h.form().priceHistory.at(-1).amount, 0);
  assert.equal(h.valid(), true);
  assert.equal(h.confirmations(), 0);
  assert.equal(
    h.nodes().some((el) => el.type === 'button'),
    false,
  );
  h.inline().props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null });
  assert.equal(h.inline(), undefined);
});

test('invalid price drafts remain visible and block completion until corrected', async () => {
  const h = await priceEditorHarness();
  h.open();
  for (const [field, value] of [
    ['date', '2025-12-31'],
    ['date', '2027-01-01'],
    ['date', '2026-04-01'],
    ['date', ''],
    ['amount', '-1'],
    ['amount', ''],
    ['amount', 'no'],
    ['amount', 'Infinity'],
  ]) {
    h.change('date', '2026-07-01');
    h.change('amount', '18');
    h.change(field, value);
    assert.equal(h.valid(), false, `${field}: ${value}`);
    assert.ok(h.nodes().some((el) => el.props?.role === 'alert'));
    h.inline().props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null });
    assert.ok(h.inline());
    h.open('2026-04-01');
    assert.equal(h.nodes().find((el) => el.type === 'date-picker').props.value, field === 'date' ? value : '2026-07-01');
    assert.equal(h.form().price, 18);
  }
  h.change('amount', '19');
  assert.equal(h.valid(), true);
  assert.equal(h.form().price, 19);
});

test('inline deletion confirms once and only changes the form; initial price has no delete action', async () => {
  const h = await priceEditorHarness();
  h.open();
  h.confirm(false);
  await h.remove();
  assert.equal(h.form().priceHistory.length, 3);
  h.confirm(true);
  h.change('amount', 'invalid');
  await h.remove();
  assert.equal(h.form().priceHistory.length, 2);
  assert.equal(h.form().price, 14);
  assert.equal(h.valid(), true);
  assert.equal(h.inline(), undefined);
  assert.equal(h.confirmations(), 2);
  h.open('2026-01-01');
  assert.equal(
    h.nodes().some((el) => el.type === 'icon-button'),
    false,
  );
});

test('mobile sheets fit the visible viewport so the header and close button stay on screen', () => {
  const css = readFileSync(new URL('styles.css', root), 'utf8');
  const start = css.search(/\.scrim \{\s*align-items: flex-end;/);
  assert.ok(start > 0);
  const block = css.slice(start, css.indexOf('.grabber', start));
  // iOS 的 vh 按工具栏收起后的大视口计算；最后生效的 max-height 必须基于 dvh
  const heights = [...block.matchAll(/max-height:\s*([^;]+);/g)].map((m) => m[1]);
  assert.match(heights.at(-1) ?? '', /dvh/);
});

test('mobile carpool cards stretch to full width instead of shrinking to content', () => {
  const css = readFileSync(new URL('styles.css', root), 'utf8');
  const rule = /@media \(max-width: 860px\) \{\s*\.car-cols \{([^}]*)\}/.exec(css);
  assert.ok(rule);
  assert.match(rule[1], /align-items:\s*stretch/);
});

const cssRules = (text) => {
  const out = [];
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  for (;;) {
    const m = /([^{}]+)\{/.exec(clean.slice(i));
    if (!m) break;
    const start = i + m.index + m[0].length;
    let depth = 1;
    let j = start;
    while (depth) {
      depth += clean[j] === '{' ? 1 : clean[j] === '}' ? -1 : 0;
      j++;
    }
    out.push([m[1].trim(), clean.slice(start, j - 1)]);
    i = j;
  }
  return out;
};
const allCss = ['styles.css', 'components/ui.css'].map((f) => readFileSync(new URL(f, root), 'utf8')).join('\n');

test('viewport-height sizes also get a dvh override so iOS toolbars cannot push content off screen', () => {
  const failures = [];
  const walk = (rules, scope) => {
    for (const [sel, body] of rules) {
      if (sel.startsWith('@media')) walk(cssRules(body), sel);
      else
        for (const [, prop] of body.matchAll(/(height|max-height|margin-top):\s*[^;]*\d+vh/g))
          if (!new RegExp(`${prop}:[^;]*dvh`).test(body)) failures.push(`${scope} ${sel} ${prop}`);
    }
  };
  walk(cssRules(allCss), '');
  assert.deepEqual(failures, []);
});

test('grids aligned to start reset align-items when a breakpoint turns them into a flex column', () => {
  const base = new Map();
  const media = [];
  for (const [sel, body] of cssRules(allCss)) {
    if (sel.startsWith('@media')) for (const [s, b] of cssRules(body)) media.push([sel, s, b]);
    else if (!sel.startsWith('@')) for (const s of sel.split(',')) base.set(s.trim(), [...(base.get(s.trim()) ?? []), body]);
  }
  const failures = media.flatMap(([mq, sel, body]) =>
    /flex-direction:\s*column/.test(body) && !/align-items/.test(body)
      ? sel
          .split(',')
          .map((s) => s.trim())
          .filter((s) => (base.get(s) ?? []).some((b) => /align-items:\s*(start|flex-start)/.test(b)))
          .map((s) => `${mq} ${s}`)
      : [],
  );
  assert.deepEqual(failures, []);
});

test('timeline loss amount uses its own line box so the digits stay vertically centered', () => {
  const rule = cssRules(allCss).find(([sel]) => sel === '.gt-unused-amount');
  assert.ok(rule);
  assert.match(rule[1], /display:\s*block/);
  assert.match(rule[1], /line-height:\s*18px/);
});
