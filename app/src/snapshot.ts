import { toBlob } from 'html-to-image';
import { base } from './base.ts';
import { renderSnapshotCharts } from './snapshot-render.tsx';

// 截图在独立的 SVG 里渲染，用不到页面加载的网络字体：把 Google Fonts 的字体转成 data URL 内嵌（只取一次）
let fonts: Promise<string> | undefined;
function fontCSS(): Promise<string> {
  fonts ??= (async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis.com"]')?.href;
    if (!href) return '';
    const css = await (await fetch(href)).text();
    const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
    const data = await Promise.all(
      urls.map(async (u) => {
        const b = await (await fetch(u)).blob();
        return new Promise<string>((r) => {
          const fr = new FileReader();
          fr.onload = () => r(fr.result as string);
          fr.readAsDataURL(b);
        });
      }),
    );
    return urls.reduce((s, u, i) => s.replaceAll(u, data[i]), css);
  })().catch(() => '');
  return fonts;
}

// SVG descendants retain their stylesheet paint when embedded in a standalone image.
const SVG_PROPS = ['stroke', 'fill', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'fill-opacity', 'opacity', 'stop-color', 'stop-opacity'];
function inlineSvg(el: HTMLElement) {
  el.querySelectorAll('svg *').forEach((n) => {
    const cs = getComputedStyle(n);
    for (const p of SVG_PROPS) {
      n.setAttribute(p, cs.getPropertyValue(p));
    }
  });
}

/** Desktop detail width; independent of the caller's viewport and disclosure controls. */
export const SNAPSHOT_WIDTH = 760;

type SnapshotOptions = {
  radius?: string;
  width?: number;
  pixelRatio?: number;
  style?: Partial<CSSStyleDeclaration>;
  filter?: (n: HTMLElement) => boolean;
  prepare?: (clone: HTMLElement, copies: ReadonlyMap<Element, HTMLElement>) => void;
};

/** Lay out a private copy before html-to-image freezes computed widths and heights. */
export async function snapshot(el: HTMLElement, opts: SnapshotOptions = {}) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  Object.assign(frame.style, { position: 'fixed', left: '-100000px', top: '0', width: '1280px', height: '900px', borderWidth: '0', pointerEvents: 'none' });
  document.body.appendChild(frame);
  let disposeCharts: (() => void) | undefined;
  try {
    const doc = frame.contentDocument!;
    for (const attr of document.documentElement.attributes) doc.documentElement.setAttribute(attr.name, attr.value);
    for (const attr of document.body.attributes) doc.body.setAttribute(attr.name, attr.value);
    // Keep media queries desktop-sized and named ancestor containers intact. Only the
    // copied wrappers lose their page positioning, padding and viewport height caps.
    const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((node) => {
      const copy = node.cloneNode(true) as HTMLLinkElement;
      const ready =
        copy.tagName === 'LINK'
          ? new Promise<void>((resolve, reject) => {
              copy.onload = () => resolve();
              copy.onerror = () => reject(new Error('Snapshot stylesheet'));
            })
          : Promise.resolve();
      doc.head.appendChild(copy);
      return ready;
    });
    const ancestors: HTMLElement[] = [];
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) ancestors.unshift(node);
    Object.assign(doc.body.style, { margin: '0', padding: '0', width: `${opts.width ?? SNAPSHOT_WIDTH}px` });
    let parent = doc.body;
    for (const node of ancestors) {
      const wrapper = node.cloneNode(false) as HTMLElement;
      Object.assign(wrapper.style, {
        position: 'static',
        display: 'block',
        width: '100%',
        minWidth: '0',
        maxWidth: 'none',
        height: 'auto',
        minHeight: '0',
        maxHeight: 'none',
        overflow: 'visible',
        margin: '0',
        padding: '0',
        transform: 'none',
      });
      parent.appendChild(wrapper);
      parent = wrapper;
    }
    let clone = el.cloneNode(true) as HTMLElement;
    const originals = [el, ...el.querySelectorAll('*')];
    const copied = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
    const copies = new Map(originals.map((node, i) => [node, copied[i]]));
    const exportStyle: Partial<CSSStyleDeclaration> = {
      position: 'static',
      width: `${opts.width ?? SNAPSHOT_WIDTH}px`,
      maxWidth: 'none',
      height: 'auto',
      maxHeight: 'none',
      margin: '0',
      boxSizing: 'border-box',
      borderRadius: opts.radius ?? '0',
      overflow: 'hidden',
      animation: 'none',
      transition: 'none',
      ...opts.style,
    };
    Object.assign(clone.style, exportStyle);
    parent.appendChild(clone);
    await Promise.all(styles);
    const rendered = renderSnapshotCharts(copies, clone);
    clone = rendered.clone;
    disposeCharts = rendered.dispose;
    Object.assign(clone.style, exportStyle);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const allowed = (node: HTMLElement) => !node.hasAttribute('data-snapshot-hide') && !node.matches('.hint') && (opts.filter?.(node) ?? true);
    // Remove before measuring, so notes and action rows leave no reserved space.
    clone.querySelectorAll<HTMLElement>('*').forEach((node) => {
      if (!allowed(node)) node.remove();
      else {
        node.style.animation = 'none';
        node.style.transition = 'none';
      }
    });
    clone.querySelectorAll<HTMLElement>('[data-private-account]').forEach((node) => {
      node.classList.add('car-private');
      node.setAttribute('aria-hidden', 'true');
    });
    const images = [...clone.querySelectorAll<HTMLImageElement>('img')];
    images.forEach((image) => {
      image.loading = 'eager';
      if (/^https?:/.test(image.src) && new URL(image.src).origin !== location.origin) {
        image.src = base(`/api/img?u=${encodeURIComponent(image.src)}`);
        image.removeAttribute('srcset');
      }
    });
    // Flush stylesheet layout so FontFaceSet tracks the faces actually in use.
    void clone.offsetWidth;
    await doc.fonts.ready;
    await Promise.all(images.map((image) => image.decode().catch(() => {})));
    opts.prepare?.(clone, copies);
    const fontEmbedCSS = await fontCSS();
    inlineSvg(clone);
    return await toBlob(clone, {
      pixelRatio: opts.pixelRatio ?? 2,
      fontEmbedCSS,
      cacheBust: false,
      includeQueryParams: true,
      width: clone.offsetWidth,
      height: clone.offsetHeight,
    });
  } finally {
    try {
      disposeCharts?.();
    } finally {
      frame.remove();
    }
  }
}

/** Capture a desktop card, retaining the selected chart viewport without touching it. */
export async function snapshotCard(source: HTMLElement) {
  const style = getComputedStyle(source);
  const sourceNodes = [source, ...source.querySelectorAll<HTMLElement>('*')];
  return snapshot(source, {
    radius: style.borderRadius === '0px' ? 'var(--radius-lg)' : style.borderRadius,
    style: { backgroundColor: style.backgroundColor === 'rgba(0, 0, 0, 0)' ? style.getPropertyValue('--bg') : style.backgroundColor },
    prepare: (_clone, copies) => {
      sourceNodes.forEach((node) => {
        const copy = copies.get(node);
        if (!copy?.isConnected || (!node.scrollLeft && !node.scrollTop)) return;
        copy.style.overflow = 'hidden';
        [...node.children].forEach((child) => {
          const target = copies.get(child);
          if (!target?.isConnected) return;
          const transform = getComputedStyle(child).transform;
          target.style.transform = `translate(${-node.scrollLeft}px, ${-node.scrollTop}px) ${transform === 'none' ? '' : transform}`;
        });
      });
    },
    filter: (node) => !node.matches('.seg, .hint, .tl-home, .log-actions, .copy-controls > :not(.copy-hover)'),
  });
}
