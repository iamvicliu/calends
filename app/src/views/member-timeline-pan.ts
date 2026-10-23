import { useEffect, useRef } from 'react';
import type { carpoolTimeline } from '../../../shared/carpool-timeline.ts';

/** 只有完整放得下的标签才显示；平移、尺寸变化及 PNG 布局都重新测量。 */
export function fitTimelineLabels(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.mt-axis').forEach((axis) => {
    const bounds = axis.getBoundingClientRect();
    axis.querySelectorAll<HTMLElement>('.mt-mark').forEach((mark) => {
      const box = mark.getBoundingClientRect();
      mark.style.visibility = box.left >= bounds.left && box.right <= bounds.right ? 'visible' : 'hidden';
    });
  });
}

type Window = ReturnType<typeof carpoolTimeline>;

/** 日期偏移共享给各行；滚轮和拖拽只在一帧中写一次 CSS，不触发 React 渲染。 */
export function attachTimelinePan(root: HTMLElement, win: Window) {
  let offset = win.maxOffset;
  let frame = 0;
  let dragged = false;
  let pointer: { id: number; x: number; y: number; offset: number; viewport: HTMLElement } | undefined;
  const paint = () => {
    frame = 0;
    root.style.setProperty('--mt-x', `${(-offset / win.totalDays) * 100}%`);
    root.dataset.mtLeft = String(offset > 0.01);
    fitTimelineLabels(root);
  };
  const move = (next: number) => {
    offset = Math.max(0, Math.min(win.maxOffset, next));
    if (!frame) frame = requestAnimationFrame(paint);
  };
  root.style.setProperty('--mt-scale', `${(win.totalDays / win.viewDays) * 100}%`);
  paint();
  const observer = new ResizeObserver(() => {
    if (!frame) frame = requestAnimationFrame(paint);
  });
  observer.observe(root);
  let disposed = false;
  void document.fonts.ready.then(() => !disposed && paint());
  const viewportOf = (e: Event) => (e.target as Element).closest<HTMLElement>('.mt-viewport');
  const wheel = (e: WheelEvent) => {
    const viewport = viewportOf(e);
    const delta = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
    if (!viewport || !delta || (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX))) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientWidth : 1;
    move(offset + (delta * unit * win.viewDays) / Math.max(1, viewport.clientWidth));
  };
  const down = (e: PointerEvent) => {
    dragged = false;
    const viewport = viewportOf(e);
    if (!viewport || e.button !== 0 || !e.isPrimary || !win.maxOffset) return;
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, offset, viewport };
  };
  const drag = (e: PointerEvent) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    const dx = e.clientX - pointer.x;
    const dy = e.clientY - pointer.y;
    if (!dragged) {
      if (Math.abs(dy) > 6 && Math.abs(dy) > Math.abs(dx)) {
        pointer = undefined;
        return;
      }
      if (Math.abs(dx) < 6 || Math.abs(dx) <= Math.abs(dy)) return;
      dragged = true;
      pointer.viewport.setPointerCapture(e.pointerId);
      root.dataset.mtDragging = 'true';
    }
    e.preventDefault();
    move(pointer.offset - (dx * win.viewDays) / Math.max(1, pointer.viewport.clientWidth));
  };
  const up = () => {
    if (pointer?.viewport.hasPointerCapture(pointer.id)) pointer.viewport.releasePointerCapture(pointer.id);
    pointer = undefined;
    delete root.dataset.mtDragging;
  };
  const click = (e: MouseEvent) => {
    if (dragged && e.detail !== 0) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  root.addEventListener('wheel', wheel, { passive: false });
  root.addEventListener('pointerdown', down);
  root.addEventListener('pointermove', drag);
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('click', click, true);
  return () => {
    disposed = true;
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    up();
    root.removeEventListener('wheel', wheel);
    root.removeEventListener('pointerdown', down);
    root.removeEventListener('pointermove', drag);
    root.removeEventListener('pointerup', up);
    root.removeEventListener('pointercancel', up);
    root.removeEventListener('click', click, true);
  };
}

export function useTimelinePan(win: Window) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) return attachTimelinePan(ref.current, win);
  }, [win.start, win.end, win.totalDays, win.viewDays, win.maxOffset]);
  return ref;
}
