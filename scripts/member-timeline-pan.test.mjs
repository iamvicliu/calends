import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachTimelinePan, fitTimelineLabels } from '../app/src/views/member-timeline-pan.ts';

function harness(t, maxOffset = 600) {
  const frames = new Map();
  let serial = 0;
  t.mock.method(globalThis, 'requestAnimationFrame', (fn) => {
    frames.set(++serial, fn);
    return serial;
  });
  t.mock.method(globalThis, 'cancelAnimationFrame', (id) => frames.delete(id));
  const styles = new Map();
  const root = Object.assign(new EventTarget(), { style: { setProperty: (key, value) => styles.set(key, value) }, dataset: {}, querySelectorAll: () => [] });
  const captured = new Set();
  const viewport = {
    closest: () => viewport,
    clientWidth: 300,
    setPointerCapture: (id) => captured.add(id),
    hasPointerCapture: (id) => captured.has(id),
    releasePointerCapture: (id) => captured.delete(id),
  };
  const send = (type, props = {}) => {
    const event = new Event(type, { cancelable: true, bubbles: true });
    Object.defineProperty(event, 'target', { value: viewport });
    Object.assign(event, { deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false, button: 0, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0, ...props });
    root.dispatchEvent(event);
    return event;
  };
  const dispose = attachTimelinePan(root, { start: '2024-01-01', end: '2027-01-01', totalDays: 1000, viewDays: 400, maxOffset });
  t.after(dispose);
  return {
    root,
    styles,
    frames,
    captured,
    dispose,
    send,
    flush: () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((fn) => fn());
    },
  };
}

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
};
globalThis.document ??= { fonts: { ready: Promise.resolve() } };

// Node has no browser frame scheduler.
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => {};

test('横向及 Shift 滚轮共用偏移，输入在一帧内合并并夹紧两端', (t) => {
  const h = harness(t);
  assert.equal(h.styles.get('--mt-x'), '-60%');
  assert.equal(h.send('wheel', { deltaX: -150 }).defaultPrevented, true);
  h.send('wheel', { deltaY: -150, shiftKey: true });
  assert.equal(h.frames.size, 1);
  h.flush();
  assert.equal(h.styles.get('--mt-x'), '-20%');
  h.send('wheel', { deltaX: -10000 });
  h.flush();
  assert.equal(h.root.dataset.mtLeft, 'false');
  assert.equal(h.styles.get('--mt-x'), '0%');
  h.send('wheel', { deltaX: 10000 });
  h.flush();
  assert.equal(h.styles.get('--mt-x'), '-60%');
  assert.equal(h.send('wheel', { deltaY: 100 }).defaultPrevented, false);
});

test('拖动后阻止行点击，普通点击与键盘点击可用；纵向手势交还页面', (t) => {
  const h = harness(t);
  h.send('pointerdown', { clientX: 200, clientY: 20 });
  h.send('pointermove', { clientX: 275, clientY: 21 });
  h.flush();
  assert.equal(h.styles.get('--mt-x'), '-50%');
  assert.equal(h.captured.size, 1);
  h.send('pointerup');
  assert.equal(h.captured.size, 0);
  assert.equal(h.send('click', { detail: 1 }).defaultPrevented, true);
  assert.equal(h.send('click', { detail: 0 }).defaultPrevented, false);
  h.send('pointerdown');
  h.send('pointerup');
  assert.equal(h.send('click', { detail: 1 }).defaultPrevented, false);
  h.send('pointerdown');
  assert.equal(h.send('pointermove', { clientX: 2, clientY: 20 }).defaultPrevented, false);
  h.send('pointermove', { clientX: 100, clientY: 21 });
  assert.equal(h.frames.size, 0);
});

test('短跨度不能滑动，清理时取消未完成帧', (t) => {
  const h = harness(t, 0);
  h.send('pointerdown');
  h.send('pointermove', { clientX: 100 });
  assert.equal(h.frames.size, 0);
  h.send('wheel', { deltaX: -100 });
  h.flush();
  assert.equal(h.styles.get('--mt-x'), '0%');
  h.send('wheel', { deltaX: 100 });
  assert.equal(h.frames.size, 1);
  h.dispose();
  assert.equal(h.frames.size, 0);
  h.send('wheel', { deltaX: 100 });
  assert.equal(h.frames.size, 0);
});

test('刻度完整落在视口内才可见，平移后重新显示', () => {
  const marks = [
    { style: {}, getBoundingClientRect: () => ({ left: 95, right: 125 }) },
    { style: {}, getBoundingClientRect: () => ({ left: 100, right: 135 }) },
    { style: {}, getBoundingClientRect: () => ({ left: 280, right: 305 }) },
  ];
  const axis = { getBoundingClientRect: () => ({ left: 100, right: 300 }), querySelectorAll: () => marks };
  const root = { querySelectorAll: () => [axis] };
  fitTimelineLabels(root);
  assert.deepEqual(
    marks.map((m) => m.style.visibility),
    ['hidden', 'visible', 'hidden'],
  );
  marks[0].getBoundingClientRect = () => ({ left: 110, right: 140 });
  fitTimelineLabels(root);
  assert.equal(marks[0].style.visibility, 'visible');
});
