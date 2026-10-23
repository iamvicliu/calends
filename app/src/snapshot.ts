import { toBlob } from 'html-to-image';
import { base } from './base.ts';

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

// SVG 的描边、填充来自样式表里的 class，克隆后会丢：截图前写成属性，截完还原
const SVG_PROPS = ['stroke', 'fill', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'fill-opacity', 'opacity', 'stop-color', 'stop-opacity'];
function inlineSvg(el: HTMLElement) {
  const saved: Array<[Element, string, string | null]> = [];
  el.querySelectorAll('svg *').forEach((n) => {
    const cs = getComputedStyle(n);
    for (const p of SVG_PROPS) {
      saved.push([n, p, n.getAttribute(p)]);
      n.setAttribute(p, cs.getPropertyValue(p));
    }
  });
  return () => saved.forEach(([n, p, v]) => (v == null ? n.removeAttribute(p) : n.setAttribute(p, v)));
}

/** 把元素渲染成 PNG：圆角与弹窗一致、圆角外透明，filter 可去掉按钮等 */
export async function snapshot(
  el: HTMLElement,
  opts: { radius?: string; width?: number; height?: number; style?: Partial<CSSStyleDeclaration>; filter?: (n: HTMLElement) => boolean } = {},
) {
  const fontEmbedCSS = await fontCSS();
  const restore = inlineSvg(el);
  try {
    return await toBlob(el, {
      pixelRatio: 2,
      fontEmbedCSS,
      cacheBust: false,
      includeQueryParams: true,
      width: opts.width,
      height: opts.height,
      style: { borderRadius: opts.radius ?? '0', overflow: 'hidden', ...opts.style },
      filter: (node) => !(node instanceof Element && (node.hasAttribute('data-snapshot-hide') || node.matches('.hint'))) && (opts.filter?.(node) ?? true),
    });
  } finally {
    restore();
  }
}

/** Capture the visible card at its current size, including scrolled viewports. */
export async function snapshotCard(source: HTMLElement) {
  await document.fonts.ready;
  const clone = source.cloneNode(true) as HTMLElement;
  const sourceNodes = [source, ...source.querySelectorAll<HTMLElement>('*')];
  const cloneNodes = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
  sourceNodes.forEach((node, index) => {
    const copy = cloneNodes[index];
    if (node instanceof HTMLImageElement && copy instanceof HTMLImageElement && /^https?:/.test(node.src) && new URL(node.src).origin !== location.origin) {
      copy.src = base(`/api/img?u=${encodeURIComponent(node.src)}`);
      copy.removeAttribute('srcset');
    }
    copy.style.animation = 'none';
    copy.style.transition = 'none';
    if (node.scrollLeft || node.scrollTop) {
      copy.style.overflow = 'hidden';
      [...copy.children].forEach((child, i) => {
        if (!(child instanceof HTMLElement || child instanceof SVGElement)) return;
        const transform = getComputedStyle(node.children[i]).transform;
        child.style.transform = `translate(${-node.scrollLeft}px, ${-node.scrollTop}px) ${transform === 'none' ? '' : transform}`;
      });
    }
  });
  const style = getComputedStyle(source);
  Object.assign(clone.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${source.offsetWidth}px`,
    height: `${source.offsetHeight}px`,
    margin: '0',
    boxSizing: 'border-box',
    backgroundColor: style.backgroundColor === 'rgba(0, 0, 0, 0)' ? style.getPropertyValue('--bg') : style.backgroundColor,
  });
  clone.setAttribute('aria-hidden', 'true');
  document.body.appendChild(clone);
  try {
    return await snapshot(clone, {
      width: source.offsetWidth,
      height: source.offsetHeight,
      radius: style.borderRadius === '0px' ? 'var(--radius-lg)' : style.borderRadius,
      style: { position: 'static', left: 'auto', top: 'auto' },
      filter: (node) => !(node instanceof Element && node.matches('.seg, .hint, .tl-home, .log-actions, .copy-controls > :not(.copy-hover)')),
    });
  } finally {
    clone.remove();
  }
}
