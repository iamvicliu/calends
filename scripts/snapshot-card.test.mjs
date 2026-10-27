import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'oxc-transform-react';

class Element {
  children = [];
  style = {};
  attrs = new Map();
  parentElement = null;
  scrollLeft = 0;
  scrollTop = 0;
  width = 390;
  height = 240;
  className = '';
  css = { backgroundColor: 'rgba(0, 0, 0, 0)', borderRadius: '0px', transform: 'none' };
  get attributes() {
    return [...this.attrs].map(([name, value]) => ({ name, value }));
  }
  get offsetWidth() {
    return Number.parseFloat(this.style.width) || this.width;
  }
  get offsetHeight() {
    return this.height;
  }
  get isConnected() {
    return !this.removed && (!this.parentElement || this.parentElement.isConnected);
  }
  get classList() {
    return {
      add: (name) => {
        this.className += ` ${name}`;
      },
      contains: (name) => this.className.split(' ').includes(name),
    };
  }
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  querySelectorAll(selector) {
    const all = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
    return selector === '*' ? all : all.filter((node) => node.matches(selector));
  }
  cloneNode(deep) {
    const copy = Object.assign(new this.constructor(), this, {
      style: { ...this.style },
      attrs: new Map(this.attrs),
      parentElement: null,
      children: [],
      scrollLeft: 0,
      scrollTop: 0,
    });
    if (deep) this.children.forEach((child) => copy.appendChild(child.cloneNode(true)));
    return copy;
  }
  setAttribute(key, value) {
    this.attrs.set(key, value);
  }
  hasAttribute(key) {
    return this.attrs.has(key);
  }
  getAttribute(key) {
    return this.attrs.get(key) ?? null;
  }
  removeAttribute(key) {
    this.attrs.delete(key);
  }
  matches(selector) {
    return selector.split(',').some((part) => {
      part = part.trim();
      return part.startsWith('[') ? this.hasAttribute(part.slice(1, -1)) : part === 'img' ? this instanceof Image : this.classList.contains(part.slice(1));
    });
  }
  remove() {
    this.removed = true;
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
  }
}
class Image extends Element {
  src = 'https://images.example.invalid/icon.png';
  decode() {
    return Promise.resolve();
  }
}

function harness(fail = false) {
  const source = readFileSync(new URL('../app/src/snapshot.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  const compiled = transformSync('snapshot.ts', source, { lang: 'ts', reactCompiler: false });
  assert.equal(compiled.fatal, false);
  let captured;
  let frame;
  let disposed = 0;
  const document = {
    fonts: { ready: Promise.resolve() },
    documentElement: new Element(),
    body: new Element(),
    head: new Element(),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => {
      frame = new Element();
      frame.contentDocument = { documentElement: new Element(), body: new Element(), head: new Element(), fonts: { ready: Promise.resolve() } };
      return frame;
    },
  };
  const deps = {
    Element,
    HTMLElement: Element,
    SVGElement: Element,
    HTMLImageElement: Image,
    requestAnimationFrame: (fn) => fn(),
    location: { origin: 'https://ledger.example.invalid' },
    base: (path) => path,
    document,
    getComputedStyle: (node) => ({ ...node.css, getPropertyValue: () => '#fcfcfc' }),
    renderSnapshotCharts: (_copies, clone) => ({
      clone,
      dispose() {
        disposed++;
      },
    }),
    toBlob: async (clone, options) => {
      captured = { clone, options };
      if (fail) throw new Error('render failed');
      return new Blob(['PNG']);
    },
  };
  const api = new Function(...Object.keys(deps), `${compiled.code.replace(/export /g, '')}; return { snapshot, snapshotCard };`)(...Object.values(deps));
  return { ...api, document, frame: () => frame, capture: () => captured, disposed: () => disposed };
}

test('card PNG uses a desktop layout, preserves chart pan and proxies images without changing the page', async () => {
  const root = new Element();
  const control = root.appendChild(new Element());
  control.className = 'seg';
  const viewport = root.appendChild(new Element());
  viewport.scrollLeft = 420;
  const track = viewport.appendChild(new Element());
  track.css.transform = 'matrix(1, 0, 0, 1, 10, 0)';
  root.appendChild(new Image());
  const h = harness();
  assert.ok((await h.snapshotCard(root)) instanceof Blob);
  const { clone, options } = h.capture();
  assert.equal(options.width, 760);
  assert.equal(clone.style.height, 'auto');
  assert.equal(clone.style.borderRadius, 'var(--radius-lg)');
  assert.equal(clone.style.backgroundColor, '#fcfcfc');
  assert.equal(clone.children[0].children[0].style.transform, 'translate(-420px, 0px) matrix(1, 0, 0, 1, 10, 0)');
  assert.equal(viewport.scrollLeft, 420);
  assert.deepEqual(track.style, {}, 'the visible chart is never moved');
  assert.equal(clone.children[1].src, '/api/img?u=https%3A%2F%2Fimages.example.invalid%2Ficon.png');
  assert.equal(root.children.length, 3);
  assert.equal(h.frame().removed, true);
  assert.equal(h.disposed(), 1);
});

test('hidden notes/actions are removed before measurement and transfer explanations survive', async () => {
  const root = new Element();
  for (const cls of ['note', 'hint', 'action']) {
    const child = root.appendChild(new Element());
    child.className = cls;
    if (cls !== 'hint') child.setAttribute('data-snapshot-hide', '');
  }
  const transfer = root.appendChild(new Element());
  transfer.textContent = '从他人处收购';
  const h = harness();
  let prepared = false;
  await h.snapshot(root, {
    prepare: (clone) => {
      assert.equal(clone.children.length, 1);
      prepared = true;
    },
  });
  assert.equal(prepared, true);
  assert.equal(h.capture().clone.children[0].textContent, '从他人处收购');
  assert.equal(root.children.length, 4);
});

test('desktop and phone sources export at the same width, retaining named ancestors and theme', async () => {
  for (const width of [390, 1280]) {
    const h = harness();
    h.document.documentElement.setAttribute('data-theme', 'dark');
    const sheet = h.document.body.appendChild(new Element());
    sheet.className = 'sheet bare';
    const root = sheet.appendChild(new Element());
    root.width = width;
    await h.snapshot(root);
    assert.equal(h.capture().options.width, 760);
    assert.equal(h.capture().clone.parentElement.className, 'sheet bare');
    assert.equal(h.frame().contentDocument.documentElement.getAttribute('data-theme'), 'dark');
    assert.equal(h.frame().style.width, '1280px');
    assert.equal(h.frame().removed, true);
    assert.equal(h.disposed(), 1);
  }
});

test('failed rendering removes its isolated document and leaves the source alone', async () => {
  const source = new Element();
  const h = harness(true);
  await assert.rejects(h.snapshotCard(source), /render failed/);
  assert.equal(h.frame().removed, true);
  assert.equal(h.disposed(), 1);
  assert.equal(source.removed, undefined);
});
