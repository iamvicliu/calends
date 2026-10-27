import { snapshot } from '../snapshot.ts';
import { fitTimelineLabels } from './member-timeline-pan.ts';

/** 详情图片共用桌面宽度与卡片边界，保留调用处当前的打码状态 */
export async function summarySnapshot(source: HTMLElement, prepare?: (clone: HTMLElement) => void) {
  const image = await snapshot(source, {
    width: 1000,
    radius: 'var(--radius-lg)',
    prepare: (clone) => {
      clone.classList.add('car-snapshot');
      prepare?.(clone);
    },
  });
  if (!image) throw new Error('PNG');
  return image;
}

/** 合租图片保留桌面成员表，操作列不入图 */
export function carpoolSnapshot(source: HTMLElement) {
  return summarySnapshot(source, (clone) => {
    clone.querySelectorAll('.car-member-table td:last-child > button, .member > .btn, .car-departed-toggle').forEach((node) => node.remove());
    clone.querySelectorAll('.car-member-table tr > :last-child, .car-member-table tfoot').forEach((node) => node.remove());
    fitTimelineLabels(clone);
  });
}
