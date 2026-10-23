import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'oxc-transform-react';

class Element {
  children = [];
  style = {};
  attributes = {};
  scrollLeft = 0;
  scrollTop = 0;
  offsetWidth = 390;
  offsetHeight = 240;
  className = '';
  css = { backgroundColor: 'rgba(0, 0, 0, 0)', borderRadius: '0px', transform: 'none' };
  querySelectorAll(selector) {
    return selector === '*' ? this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]) : [];
  }
  cloneNode() {
    const copy = Object.assign(new this.constructor(), this, { style: { ...this.style }, attributes: { ...this.attributes }, scrollLeft: 0, scrollTop: 0 });
    copy.children = this.children.map((child) => child.cloneNode());
    return copy;
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  hasAttribute(key) {
    return key in this.attributes;
  }
  removeAttribute(key) {
    delete this.attributes[key];
  }
  matches(selector) {
    return selector.split(',').some((part) => part.trim() === `.${this.className}`);
  }
  remove() {
    this.removed = true;
  }
}
class Image extends Element {
  src = 'https://images.example.invalid/icon.png';
}

function harness(fail = false) {
  const source = readFileSync(new URL('../app/src/snapshot.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  const compiled = transformSync('snapshot.ts', source, { lang: 'ts', reactCompiler: false });
  assert.equal(compiled.fatal, false);
  let captured;
  const deps = {
    Element,
    HTMLElement: Element,
    SVGElement: Element,
    HTMLImageElement: Image,
    location: { origin: 'https://ledger.example.invalid' },
    base: (path) => path,
    document: { fonts: { ready: Promise.resolve() }, querySelector: () => null, body: { appendChild: () => {} } },
    getComputedStyle: (node) => ({ ...node.css, getPropertyValue: () => '#fcfcfc' }),
    toBlob: async (clone, options) => {
      captured = { clone, options };
      if (fail) throw new Error('render failed');
      return new Blob(['PNG']);
    },
  };
  const snapshotCard = new Function(...Object.keys(deps), `${compiled.code.replace(/export /g, '')}; return snapshotCard;`)(...Object.values(deps));
  return { snapshotCard, capture: () => captured };
}

test('card PNG keeps visible dimensions and scroll position, supplies a background and omits actions', async () => {
  const root = new Element();
  const viewport = new Element();
  viewport.scrollLeft = 420;
  const track = new Element();
  track.css.transform = 'matrix(1, 0, 0, 1, 10, 0)';
  viewport.children.push(track);
  const icon = new Image();
  root.children.push(viewport, icon);
  const h = harness();
  assert.ok((await h.snapshotCard(root)) instanceof Blob);
  const { clone, options } = h.capture();
  assert.equal(options.width, 390);
  assert.equal(options.height, 240);
  assert.equal(options.style.borderRadius, 'var(--radius-lg)');
  assert.equal(clone.style.backgroundColor, '#fcfcfc');
  assert.equal(clone.children[0].children[0].style.transform, 'translate(-420px, 0px) matrix(1, 0, 0, 1, 10, 0)');
  assert.equal(viewport.scrollLeft, 420);
  assert.deepEqual(track.style, {}, 'the visible chart is never moved');
  assert.equal(clone.children[1].src, '/api/img?u=https%3A%2F%2Fimages.example.invalid%2Ficon.png');
  for (const className of ['seg', 'hint', 'tl-home', 'log-actions']) {
    const control = Object.assign(new Element(), { className });
    assert.equal(options.filter(control), false, className);
  }
  const action = new Element();
  action.setAttribute('data-snapshot-hide', '');
  assert.equal(options.filter(action), false);
  assert.equal(options.filter(Object.assign(new Element(), { className: 'tm-cell' })), true, 'data labels stay in the PNG');
  assert.equal(clone.removed, true);
});

test('failed card rendering removes only its temporary clone', async () => {
  const source = new Element();
  const h = harness(true);
  await assert.rejects(h.snapshotCard(source), /render failed/);
  assert.equal(h.capture().clone.removed, true);
  assert.equal(source.removed, undefined);
});
