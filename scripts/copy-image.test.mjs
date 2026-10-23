import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'oxc-transform-react';
import * as React from 'react';

function harness({ supported = true, write = async () => {} } = {}) {
  const source = readFileSync(new URL('../app/src/components/CopyImageButton.tsx', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  const result = transformSync('CopyImageButton.tsx', source, { lang: 'tsx', jsx: { runtime: 'classic' }, reactCompiler: false });
  assert.equal(result.fatal, false);
  const feedback = [];
  let sync = true;
  const deps = {
    React,
    useState: (initial) => [initial, () => {}],
    useRef: () => ({ current: false }),
    t: (key) => key,
    toast: (...args) => feedback.push(args),
    snapshotCard: async () => new Blob(['card']),
    Icon: () => null,
    IconButton: (props) => React.createElement('button', props),
    navigator: { clipboard: { write } },
    ClipboardItem: supported
      ? function (data) {
          assert.equal(sync, true, 'Safari needs construction in the click stack');
          this.data = data;
        }
      : undefined,
  };
  const code = result.code.replace(/export (async )?function/g, '$1function');
  const api = new Function(...Object.keys(deps), `${code}; return { copyImage, CopyImageButton };`)(...Object.values(deps));
  return {
    ...api,
    feedback,
    leaveClick: () => {
      sync = false;
    },
  };
}

test('copy starts clipboard write synchronously with an unresolved PNG promise', async () => {
  let resolve;
  const image = new Blob(['fictional PNG'], { type: 'image/png' });
  let written;
  const h = harness({
    write: (items) => {
      written = items;
      return Promise.resolve();
    },
  });
  const pending = h.copyImage(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  assert.ok(written, 'write occurs before image rendering resolves');
  h.leaveClick();
  assert.ok(written[0].data['image/png'] instanceof Promise);
  resolve(image);
  assert.equal(await written[0].data['image/png'], image);
  await pending;
  assert.deepEqual(h.feedback, [['detail.toast.imageCopied']]);
});

test('denied clipboard, synchronous write errors and failed/null rendering use the same localized error toast', async () => {
  for (const mode of ['denied', 'sync', 'render', 'null']) {
    const h = harness({
      write:
        mode === 'sync'
          ? () => {
              throw new Error('denied');
            }
          : async (items) => {
              await items[0].data['image/png'];
              if (mode === 'denied') throw new Error('denied');
            },
    });
    await h.copyImage(() => (mode === 'render' ? Promise.reject(new Error('render')) : Promise.resolve(mode === 'null' ? null : new Blob(['PNG']))));
    assert.deepEqual(h.feedback, [['family.sheet.copyFailed', true]], mode);
  }
});

test('unsupported browsers omit image actions; supported actions share the icon, label and snapshot exclusion', () => {
  assert.equal(harness({ supported: false }).CopyImageButton({}), null);
  const button = harness().CopyImageButton({ hover: true });
  assert.equal(button.props['aria-label'], 'detail.action.copyImage');
  assert.equal(button.props['data-snapshot-hide'], true);
  assert.equal(button.props.className, 'copy-image copy-hover');
  assert.equal(button.props.children.props.name, 'copy');
});
