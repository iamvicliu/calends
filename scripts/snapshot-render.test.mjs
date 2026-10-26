import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'oxc-transform-react';

test('export rerender preserves a full-width grid card and releases its React root', () => {
  let registered;
  let disposed = 0;
  const card = { style: {} };
  const host = { style: {}, firstElementChild: card };
  const copy = {
    isConnected: true,
    ownerDocument: { createElement: () => host },
    replaceWith(node) {
      assert.equal(node, host);
    },
  };
  const source = {};
  const deps = {
    useLayoutEffect: (fn) => fn(),
    createRoot: () => ({ render: (value) => assert.equal(value, 'new desktop chart'), unmount: () => disposed++ }),
    flushSync: (fn) => fn(),
    getComputedStyle: (node) => {
      assert.equal(node, copy);
      return { gridColumn: '1 / -1' };
    },
  };
  const sourceText = readFileSync(new URL('../app/src/snapshot-render.tsx', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  const compiled = transformSync('snapshot-render.tsx', sourceText, { lang: 'tsx', reactCompiler: false });
  assert.equal(compiled.fatal, false);
  registered = new Function(...Object.keys(deps), compiled.code.replace(/export /g, '') + ';return {useSnapshotRender,renderSnapshotCharts}')(
    ...Object.values(deps),
  );
  registered.useSnapshotRender({ current: source }, () => 'new desktop chart');
  const result = registered.renderSnapshotCharts(new Map([[source, copy]]), source);
  assert.equal(card.style.gridColumn, '1 / -1');
  assert.equal(result.clone, source);
  result.dispose();
  assert.equal(disposed, 1);
});
