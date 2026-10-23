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
  const [, copyAst, copySource] = sources.find(([file]) => file === 'components/copy.tsx');
  functions.push(copySource.slice(...functionRange(copyAst, 'copyParts')));
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
  const keyboard = await import('../app/src/keyboard.ts');
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
    ...keyboard,
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
  assert.match(rule[1], /line-height:\s*22px/);
  assert.match(rule[1], /font-size:\s*var\(--fs-1\)/);
});

const styleFiles = readdirSync(root, { recursive: true }).filter((file) => file.endsWith('.css'));
const styleSources = styleFiles.map((file) => [file, readFileSync(new URL(file, root), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')]);

test('app and public CSS use only the four shared type sizes, including font shorthands', async () => {
  const failures = [];
  for (const [file, css] of styleSources) {
    for (const [, value] of css.matchAll(/font-size:\s*([^;]+);/g)) {
      if (!/^(?:var\(--fs-[1-4]\)|12px|14px|17px|28px)(?: !important)?$/.test(value)) failures.push(`${file}: ${value}`);
    }
    for (const [, value] of css.matchAll(/(?<![\w-])font:\s*([^;]+);/g)) {
      if (value !== 'inherit' && !/var\(--fs-[1-4]\)/.test(value)) failures.push(`${file}: font ${value}`);
    }
  }
  for (const file of readdirSync(root, { recursive: true }).filter((file) => file.endsWith('.tsx'))) {
    const source = readFileSync(new URL(file, root), 'utf8');
    visit(await parsers.typescript.parse(source), (node) => {
      if (node.type !== 'ObjectProperty' || node.key.name !== 'fontSize') return;
      if (node.value.type !== 'StringLiteral' || !/^var\(--fs-[1-4]\)$/.test(node.value.value)) failures.push(`${file}: inline fontSize`);
    });
    if (/text-\[\d+(?:\.\d+)?(?:px|rem|em)\]/.test(source)) failures.push(`${file}: arbitrary text size`);
  }
  assert.deepEqual(failures, []);
});

test('colors come from Radix with both themes and package-provided P3 support', () => {
  const tokens = readFileSync(new URL('design-tokens.css', root), 'utf8');
  const families = ['gray', 'indigo', 'red', 'green', 'orange', 'purple', 'teal', 'pink', 'iris', 'gold'];
  for (const family of families) {
    for (const suffix of ['', '-dark']) {
      assert.ok(tokens.includes(`@radix-ui/colors/${family}${suffix}.css`));
      const palette = readFileSync(new URL(`../../node_modules/@radix-ui/colors/${family}${suffix}.css`, root), 'utf8');
      assert.match(palette, /color\(display-p3/);
    }
  }
  assert.match(readFileSync(new URL('theme.tsx', root), 'utf8'), /classList.toggle\('dark', resolved === 'dark'\)/);
  for (const [file, css] of styleSources) assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(/i, file);
  for (const entry of ['styles.css', 'public/index.css']) assert.match(readFileSync(new URL(entry, root), 'utf8'), /import ['"]\.\.?\/design-tokens.css/);
});

test('borders use hairlines and keyboard focus uses only the shared ring', () => {
  const failures = [];
  for (const [file, css] of styleSources) {
    for (const [, value] of css.matchAll(/(?:border(?:-(?:top|right|bottom|left|inline|block|width))?|outline)(?:-width)?:\s*([^;]+);/g)) {
      if (/\d+(?:\.\d+)?px/.test(value) && value !== '0.5px') failures.push(`${file}: ${value}`);
    }
    for (const [, value] of css.matchAll(/outline:\s*([^;]+);/g)) {
      if (!['none', 'none !important', '0'].includes(value) && !value.includes('var(--focus-ring)')) failures.push(`${file}: focus ${value}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('remaining CSS transitions use 250ms ease-out and cards do not lift on hover', () => {
  for (const [file, css] of styleSources) {
    for (const [, value] of css.matchAll(/transition:\s*([^;]+);/g)) {
      if (value.startsWith('none')) continue;
      for (const part of value.split(',')) assert.match(part.trim(), /^[\w-]+ var\(--duration\) var\(--ease\)$/, `${file}: ${value}`);
    }
    assert.doesNotMatch(css, /:hover[^{}]*\{[^{}]*transform:\s*(?:translateY\(-|perspective)/, file);
  }
  const css = readFileSync(new URL('components/ui.css', root), 'utf8');
  assert.match(css, /animation: rm-pop var\(--duration\) var\(--ease\)/);
  assert.match(readFileSync(new URL('styles.css', root), 'utf8'), /\.sc-glow \{[^{}]*opacity: 0\.18/);
  const assistant = readFileSync(new URL('views/assistant.css', root), 'utf8');
  assert.match(assistant, /\.as-card \{[^{}]*box-shadow:/);
  assert.match(assistant, /\.as-card::before \{[^{}]*linear-gradient/);
});

test('custom presentation colors map to Radix without changing stored color strings', async () => {
  const colors = await import('@radix-ui/colors');
  const source = readFileSync(new URL('derive.ts', root), 'utf8');
  const ast = await parsers.typescript.parse(source);
  let rgb;
  visit(ast, (node) => {
    if (node.type === 'VariableDeclaration' && node.declarations.some((d) => d.id.name === 'rgb')) rgb = text(node, source);
  });
  const range = functionRange(ast, 'paletteColor');
  const transformed = transformSync('palette.ts', `${rgb}\n${source.slice(...range)}`, { lang: 'ts' });
  assert.equal(transformed.fatal, false);
  const swatches = Object.fromEntries(
    ['indigo', 'red', 'purple', 'green', 'orange', 'teal', 'pink', 'iris', 'gray', 'gold', 'slate', 'blue'].map((name) => [name, colors[name]]),
  );
  const paletteColor = new Function('swatches', `const { slate, gray } = swatches; ${transformed.code}; return paletteColor;`)(swatches);
  const value = '#e5484d';
  assert.match(paletteColor(value), /var\(--red-9\)/);
  assert.equal(value, '#e5484d');
  assert.equal(paletteColor('var(--c4)'), 'var(--c4)');
  assert.equal(paletteColor('var(--indigo-9)'), 'var(--indigo-9)');
  assert.equal(paletteColor(undefined, 'var(--blue-9)'), 'var(--blue-9)');
  assert.equal(paletteColor('invalid', 'var(--c1)'), 'var(--c1)');
  assert.doesNotMatch(paletteColor('#abc'), /NaN|undefined/);
  assert.match(paletteColor('linear-gradient(135deg,#c8102e,#7a0a1c)'), /linear-gradient.*var\(--red-9\)/);
  assert.match(paletteColor('linear-gradient(135deg,#1c1c22,#0a0a0d)'), /var\(--(?:gray|slate)-9\)/);
});

test('copy separates facts into elements and preserves punctuation in user names', () => {
  const [, ast, source] = sources.find(([file]) => file === 'components/copy.tsx');
  const result = transformSync('copy.tsx', source.slice(...functionRange(ast, 'copyParts')), {
    lang: 'tsx',
    jsx: { runtime: 'classic' },
    reactCompiler: false,
  });
  assert.equal(result.fatal, false);
  const copyParts = new Function('React', `${result.code}; return copyParts;`)(React);
  const name = 'Orbit · Family';
  assert.equal(copyParts(name), name);
  const markup = renderToStaticMarkup(copyParts(`${name}\n$12/month\nNext charge Oct 28`));
  assert.match(markup, /<span class="copy-parts"><span>Orbit · Family<\/span><span>\$12\/month<\/span><span>Next charge Oct 28<\/span><\/span>/);
  assert.equal(copyParts(0), 0);
  assert.equal(copyParts(null), null);
  // Leading/trailing boundaries still need spacing when a conditional fact follows existing text.
  assert.match(renderToStaticMarkup(copyParts('\nNext charge Oct 28')), /<span><\/span><span>Next charge Oct 28<\/span>/);
});

test('UI copy and locale templates never introduce middle-dot separators', async () => {
  const failures = [];
  for (const file of readdirSync(root, { recursive: true }).filter((file) => file.endsWith('.tsx'))) {
    const source = readFileSync(new URL(file, root), 'utf8');
    const ast = await parsers.typescript.parse(source);
    visit(ast, (node) => {
      const value = node.type === 'JSXText' ? node.value : node.type === 'Literal' ? node.value : node.type === 'TemplateElement' ? node.value.raw : undefined;
      if (typeof value === 'string' && value.includes('\u00b7')) failures.push(file);
    });
  }
  const locales = new URL('../shared/locales/', import.meta.url);
  for (const file of readdirSync(locales, { recursive: true }).filter((file) => file.endsWith('.json'))) {
    if (readFileSync(new URL(file, locales), 'utf8').includes('\u00b7')) failures.push(`locales/${file}`);
  }
  assert.deepEqual(failures, []);
});

test('controls that sit in toolbars and rows share the pill shape instead of mixing pills and rectangles', () => {
  const css = allCss + readFileSync(new URL('views/assistant.css', root), 'utf8');
  const last = (sel) =>
    cssRules(css)
      .filter(([s]) => s.split(',').some((x) => x.trim() === sel))
      .map(([, body]) => /border-radius:\s*([^;]+)/.exec(body)?.[1])
      .filter(Boolean)
      .at(-1);
  for (const sel of ['.seg', '.seg button', '.as-suggest button', '.pk-btn.inline', '.mp-btn', '.ai-copy'])
    assert.match(last(sel) ?? '', /radius-pill|999px/, sel);
});

test('assistant tool output and its proposal have distinct stable sibling keys', () => {
  const [, ast, source] = sources.find(([file]) => file === 'views/Assistant.tsx');
  const result = transformSync('BotMessage.tsx', source.slice(...functionRange(ast, 'BotMessage')), {
    lang: 'tsx',
    jsx: { runtime: 'classic' },
    reactCompiler: false,
  });
  assert.equal(result.fatal, false);
  const deps = { React, ToolCard: 'tool-card', Proposal: 'proposal', Reasoning: 'reasoning', Markdown: 'markdown' };
  const BotMessage = new Function(...Object.keys(deps), `${result.code}; return BotMessage;`)(...Object.values(deps));
  const id = 'call_00_fictional';
  const tool = { kind: 'tool', id, name: 'create_subscription', args: {}, status: 'done' };
  const proposal = { kind: 'proposal', id, tool: tool.name, args: {}, preview: {}, state: 'pending' };
  const render = (parts) => BotMessage({ turn: { parts, status: 'done' }, state: {}, last: false });
  const children = (tree) => tree.props.children.props.children[1];
  const initial = children(render([tool]));
  const paired = children(render([tool, proposal]));
  assert.equal(new Set(paired.map((el) => el.key)).size, 2);
  assert.equal(initial[0].key, paired[0].key);
  assert.equal(paired[0].props.part, tool);
  assert.equal(paired[1].props.part, proposal);
  assert.deepEqual(
    children(render([tool, { kind: 'text', text: 'Review draft' }, proposal]))
      .filter((el) => el.props.part)
      .map((el) => el.key),
    paired.map((el) => el.key),
  );
});

test('pages and panels hide scrollbars and never assign them accent colors', () => {
  for (const [file, css] of styleSources) {
    for (const [, property, value] of css.matchAll(/((?:--)?scrollbar-(?:color|thumb|track|width)|--scrollbar):\s*([^;]+);/g)) {
      assert.ok(property.endsWith('width') ? value === 'none' : value === 'auto', `${file}: ${property}: ${value}`);
    }
    for (const [, body] of css.matchAll(/[^{}]*::-webkit-scrollbar[^{}]*\{([^{}]*)\}/g)) {
      assert.doesNotMatch(body, /(?:background|color|box-shadow)\s*:/, file);
    }
  }
  const css = readFileSync(new URL('styles.css', root), 'utf8');
  const global = cssRules(css)
    .filter(([sel]) => sel === '*')
    .map(([, body]) => body)
    .join('\n');
  assert.match(global, /scrollbar-width:\s*none;/);
  assert.match(global, /scrollbar-color:\s*auto;/);
  assert.match(css, /\*::-webkit-scrollbar\s*\{[^}]*display:\s*none;/);
  const hero = readFileSync(new URL('heroui.css', root), 'utf8');
  assert.match(hero, /--scrollbar-width:\s*none;/);
  assert.match(hero, /--scrollbar-color:\s*auto;/);
});

test('glass is limited to sticky toolbars and sheet headers and footers', () => {
  const failures = [];
  const walk = (rules, file) => {
    for (const [selector, body] of rules) {
      if (selector.startsWith('@')) walk(cssRules(body), file);
      else if ([...body.matchAll(/(?:^|;)\s*(?:-webkit-)?backdrop-filter:\s*([^;]+);/g)].some((m) => m[1].trim() !== 'none')) {
        if (!['.toolbar', '.sheet-head', '.sheet-foot'].includes(selector)) failures.push(`${file}: ${selector}`);
        assert.match(body, /position:\s*sticky/, `${file}: ${selector}`);
      }
    }
  };
  for (const [file, css] of styleSources) walk(cssRules(css), file);
  assert.deepEqual(failures, []);
});

test('decorative spotlights and left-edge callouts do not return', () => {
  for (const [file, css] of styleSources) {
    assert.doesNotMatch(css, /--m[xy]\b/, file);
    for (const [, body] of css.matchAll(/[^{}]+\{([^{}]*radial-gradient[^{}]*)\}/g)) {
      // The remaining radial gradients cut the functional receipt-paper edges.
      assert.match(body, /(?:-webkit-)?mask:\s*radial-gradient/, file);
      assert.doesNotMatch(body, /background(?:-image)?:[^;]*radial-gradient/, file);
    }
  }
  const detail = readFileSync(new URL('views/detail.css', root), 'utf8');
  assert.doesNotMatch(detail, /box-shadow:\s*inset\s+[1-9][\d.]*px\s+0\s+0/);
  const assistant = readFileSync(new URL('views/assistant.css', root), 'utf8');
  for (const sel of ['.as-md blockquote', '.as-reason-b']) {
    const body = cssRules(assistant).find(([selector]) => selector === sel)?.[1];
    assert.ok(body);
    assert.doesNotMatch(body, /border-left:/);
    assert.match(body, /padding:/);
  }
  for (const css of [detail, readFileSync(new URL('styles.css', root), 'utf8')]) {
    for (const [, body] of css.matchAll(/(?:\.dt-badge\.dot|\.ph-status)[^{}]*\bi\s*\{([^{}]*)\}/g)) {
      assert.doesNotMatch(body, /box-shadow:|filter:|animation:/);
    }
  }
});

test('normal settlement is silent while attention status pills retain their labels', () => {
  const [, ast, source] = sources.find(([file]) => file === 'components/ui.tsx');
  const result = transformSync('StatusPill.tsx', source.slice(...functionRange(ast, 'StatusPill')), {
    lang: 'tsx',
    jsx: { runtime: 'classic' },
    reactCompiler: false,
  });
  assert.equal(result.fatal, false);
  const StatusPill = new Function('React', 'Icon', `${result.code}; return StatusPill;`)(React, 'icon');
  assert.equal(renderToStaticMarkup(React.createElement(StatusPill, { tone: 'ok' }, 'Settled')), '');
  for (const [tone, label] of [
    ['owe', 'Pending'],
    ['stop', 'Stopped'],
    ['notice', 'Paused'],
  ]) {
    assert.match(renderToStaticMarkup(React.createElement(StatusPill, { tone }, label)), new RegExp(label));
  }
});

test('assistant welcome resources contain only four concrete variants in every locale', () => {
  const locales = new URL('../shared/locales/', import.meta.url);
  for (const { name: lang } of readdirSync(locales, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const { welcome } = JSON.parse(readFileSync(new URL(`${lang}/assistant.json`, locales), 'utf8'));
    assert.deepEqual(Object.keys(welcome.variants), ['v1', 'v2', 'v3', 'v4'], lang);
    for (const { title, body } of Object.values(welcome.variants)) {
      assert.ok(title.trim() && body.trim(), lang);
    }
  }
});

test('subscription headings omit normal status badges and retain exceptional states', () => {
  const [, ast, source] = sources.find(([file]) => file === 'views/Detail.tsx');
  let header;
  visit(ast, (node) => {
    if (node.type === 'JSXElement' && node.openingElement.name.name === 'h2' && text(node, source).includes('dt-name')) header = text(node, source);
  });
  assert.ok(header);
  const result = transformSync('DetailHeader.tsx', `function Header() { return (${header}); }`, {
    lang: 'tsx',
    jsx: { runtime: 'classic' },
    reactCompiler: false,
  });
  assert.equal(result.fatal, false);
  for (const st of ['active', 'lifetime', 'trial', 'paused', 'ending', 'ended', 'terminated', 'upcoming']) {
    const Header = new Function('React', 'sub', 'st', 'TONE', 't', `${result.code}; return Header;`)(React, { name: 'Orbit Notes' }, st, {}, (key) => key);
    const html = renderToStaticMarkup(React.createElement(Header));
    assert.match(html, /Orbit Notes/);
    if (['active', 'lifetime'].includes(st)) assert.doesNotMatch(html, /dt-badge/);
    else assert.ok(html.includes(`list.status.${st}`), st);
  }
});

test('MCP connection headings only add a status badge when access is disabled', () => {
  const [, ast, source] = sources.find(([file]) => file === 'views/Ai.tsx');
  let header;
  visit(ast, (node) => {
    if (node.type === 'JSXElement' && node.openingElement.name.name === 'b' && text(node, source).includes('ai-badge')) header = text(node, source);
  });
  assert.ok(header);
  const result = transformSync('ConnectionHeader.tsx', `function Header() { return (${header}); }`, {
    lang: 'tsx',
    jsx: { runtime: 'classic' },
    reactCompiler: false,
  });
  assert.equal(result.fatal, false);
  for (const enabled of [true, false]) {
    const Header = new Function('React', 'enabled', 't', `${result.code}; return Header;`)(React, enabled, (key) => key);
    const html = renderToStaticMarkup(React.createElement(Header));
    if (enabled) assert.doesNotMatch(html, /ai-badge/);
    else assert.match(html, /settings.open.off/);
  }
});

test('subscription share posters omit normal status chips but keep attention states', () => {
  const [, ast, source] = sources.find(([file]) => file === 'views/SubShare.tsx');
  let chips;
  visit(ast, (node) => {
    if (node.type === 'JSXElement' && text(attr(node.openingElement, 'className')?.value, source) === '"sp-chips"') chips = text(node, source);
  });
  assert.ok(chips);
  const result = transformSync('ShareStatus.tsx', `function Chips() { return (${chips}); }`, {
    lang: 'tsx',
    jsx: { runtime: 'classic' },
    reactCompiler: false,
  });
  assert.equal(result.fatal, false);
  for (const status of ['active', 'lifetime', 'trial', 'paused', 'ending', 'ended', 'terminated', 'upcoming']) {
    const deps = { React, st: { status, gaps: [], vs: [], change: null }, statusText: (st) => st.status, t: (key) => key, changeText: () => '' };
    const Chips = new Function(...Object.keys(deps), `${result.code}; return Chips;`)(...Object.values(deps));
    const html = renderToStaticMarkup(React.createElement(Chips));
    if (['active', 'lifetime'].includes(status)) assert.doesNotMatch(html, /<span/);
    else assert.ok(html.includes(`<span>${status}</span>`), status);
  }
});

test('inline price Enter respects IME and its local boundary, without submitting the sheet', async () => {
  const h = await priceEditorHarness();
  h.open();
  const doc = { querySelector: () => null };
  const target = { tagName: 'INPUT', type: 'text', closest: () => null };
  let prevented = 0;
  let stopped = 0;
  const event = (extra = {}) => ({
    nativeEvent: { key: 'Enter', target, ...extra },
    currentTarget: { ownerDocument: doc },
    preventDefault: () => prevented++,
    stopPropagation: () => stopped++,
  });
  assert.equal(h.inline().props['data-submit'], '');
  h.inline().props.onKeyDown(event({ isComposing: true }));
  h.inline().props.onKeyDown(event({ keyCode: 229 }));
  assert.ok(h.inline());
  assert.equal(prevented, 0);
  h.inline().props.onKeyDown(event());
  assert.equal(h.inline(), undefined);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
});

test('keyboard behavior stays in the shared Sheet and guards, with safe confirmation focus', () => {
  const ui = sources.find(([file]) => file === 'components/ui.tsx')[2];
  const app = sources.find(([file]) => file === 'app.tsx')[2];
  const calendar = sources.find(([file]) => file === 'views/Calendar.tsx')[2];
  assert.match(ui, /submitSheet\(e, dialog\.current\)/);
  assert.match(ui, /className="btn" autoFocus onClick=\{\(\) => done\(false\)\}/);
  assert.doesNotMatch(ui, /danger-solid" autoFocus/);
  assert.match(calendar, /if \(!canUseSingleKey\(e\)\) return/);
  assert.match(app, /const action = pageShortcut\(e, detail\)/);
  assert.match(app, /onEdit=\{editFromDetail\}/);
  const people = sources.find(([file]) => file === 'views/People.tsx')[2];
  assert.match(people, /data-submit=\{editingAccount === accountKey\(i\) \? '' : undefined\}/);
});

test('connection terminals keep theme-independent dark surfaces and light text', () => {
  const css = readFileSync(new URL('styles.css', root), 'utf8');
  const rules = cssRules(css);
  for (const selector of ['.ai-code', '.ai-code-bar', '.ai-copy', '.ai-copy:hover']) {
    const body = rules.find(([sel]) => sel === selector)?.[1];
    assert.ok(body, selector);
    const colors = [...body.matchAll(/(?:^|;)\s*(?:background|color):\s*([^;]+);/g)].map((m) => m[1]);
    assert.ok(colors.length, selector);
    for (const color of colors) assert.match(color, /^var\(--(?:black|white)-a\d+\)$/, selector);
    if (selector === '.ai-code') {
      assert.match(body, /background:\s*var\(--black-a12\)/);
      assert.match(body, /color:\s*var\(--white-a12\)/);
    } else if (selector !== '.ai-copy:hover') assert.match(body, /color:\s*var\(--white-a(?:11|12)\)/);
  }
  const pre = rules.find(([sel]) => sel === '.ai-code pre')?.[1];
  assert.doesNotMatch(pre, /(?:^|;)\s*(?:background|color):/); // 代码继承终端前景，避免主题文字色覆盖
  for (const [selector, body] of rules) {
    if (/\.ai-(?:code|copy)\b/.test(selector)) assert.doesNotMatch(body, /var\(--(?:gray|slate|label|ink)/, selector);
  }
});

test('connection setup hint is removed in every locale', () => {
  for (const entry of readdirSync(new URL('../shared/locales/', import.meta.url), { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const messages = JSON.parse(readFileSync(new URL(`../shared/locales/${entry.name}/ai.json`, import.meta.url), 'utf8'));
    assert.equal(messages.setupHint, undefined, entry.name);
  }
});
