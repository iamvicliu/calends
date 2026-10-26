import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('calendar card layout keeps precedence over optional report CSS regardless of chunk order', () => {
  const css = readFileSync(new URL('../app/src/styles.css', import.meta.url), 'utf8');
  // Lazy report chunks also target these nodes with one class: the calendar owner must win in either loading order.
  for (const [selector, property] of [['.cal-daycards', 'grid-template-columns'], ['.cal-daycard', 'gap']]) {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim().endsWith(selector) && m[2].includes(property + ':'));
    const own = rules.at(-1);
    assert.ok(own, selector);
    assert.ok((own[1].match(/\.[\w-]+/g) ?? []).length > 1, `${selector} must retain precedence when report styles load last`);
  }
});
