import { snapshot } from '../snapshot.ts';
import { fitTimelineLabels } from './member-timeline-pan.ts';

/** Use the desktop collection table and mask accounts even when revealed on screen. */
export async function carpoolSnapshot(source: HTMLElement) {
  const image = await snapshot(source, {
    width: 1000,
    radius: 'var(--radius-lg)',
    prepare: (clone) => {
      clone.classList.add('car-snapshot');
      clone.querySelectorAll('.car-member-table td:last-child > button, .member > .btn, .car-departed-toggle').forEach((node) => node.remove());
      clone.querySelectorAll('.car-member-table tr > :last-child, .car-member-table tfoot').forEach((node) => node.remove());
      fitTimelineLabels(clone);
    },
  });
  if (!image) throw new Error('PNG');
  return image;
}
