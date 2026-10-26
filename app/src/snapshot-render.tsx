import { useLayoutEffect, type ReactNode, type RefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

const renderers = new WeakMap<Element, () => ReactNode>();

/** Width-derived geometry must be calculated in the export layout, not copied as pixels. */
export function useSnapshotRender(ref: RefObject<HTMLElement | null>, render: () => ReactNode) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    renderers.set(node, render);
    return () => {
      renderers.delete(node);
    };
  });
}

export function renderSnapshotCharts(copies: ReadonlyMap<Element, HTMLElement>, boundary: HTMLElement) {
  let clone = boundary;
  const roots: ReturnType<typeof createRoot>[] = [];
  try {
    for (const [source, copy] of copies) {
      const render = renderers.get(source);
      if (!render || !copy.isConnected) continue;
      const gridColumn = getComputedStyle(copy).gridColumn;
      const host = copy.ownerDocument.createElement('div');
      host.style.display = 'contents';
      copy.replaceWith(host);
      const root = createRoot(host);
      roots.push(root);
      // useWidth's layout effect measures the detached desktop container synchronously.
      flushSync(() => root.render(render()));
      // The display:contents host changes direct-child selectors; retain grid placement.
      const rendered = host.firstElementChild as HTMLElement | null;
      if (rendered) rendered.style.gridColumn = gridColumn;
      if (copy === boundary) clone = host.firstElementChild as HTMLElement;
    }
  } catch (error) {
    roots.forEach((root) => root.unmount());
    throw error;
  }
  return { clone, dispose: () => roots.forEach((root) => root.unmount()) };
}
