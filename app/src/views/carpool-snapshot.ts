import { snapshot } from '../snapshot.ts';
import { fitTimelineLabels } from './member-timeline-pan.ts';

/** 临时以固定宽度排版，复用当前内容与打码状态，不改变可见弹窗。 */
export async function carpoolSnapshot(source: HTMLElement) {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.classList.add('car-snapshot');
  clone.setAttribute('aria-hidden', 'true');
  await document.fonts.ready;
  clone.querySelectorAll('[data-snapshot-hide], .car-member-table td:last-child > button, .member > .btn, .car-departed-toggle').forEach((n) => n.remove());
  clone.querySelectorAll('.car-member-table tr > :last-child').forEach((n) => n.remove());
  clone.querySelectorAll('.car-member-table tfoot').forEach((n) => n.remove());
  document.body.appendChild(clone);
  try {
    fitTimelineLabels(clone);
    const image = await snapshot(clone, {
      width: 1000,
      radius: 'var(--radius-lg)',
      height: clone.offsetHeight,
      style: { position: 'static', left: 'auto', top: 'auto' },
    });
    if (!image) throw new Error('PNG');
    return image;
  } finally {
    clone.remove();
  }
}
