import type { ReactNode as ComponentChildren } from 'react';
import { dateFormat } from '../../../shared/intl.ts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addDays, addMonths, diffDays } from '../../../shared/billing.ts';
import { monthLabel } from '../../../shared/format.ts';
import { intlLocale, t } from '../../../shared/i18n.ts';
import './timeline.css';
import './copy.css';

export interface TimelineItem {
  key: string;
  icon: ComponentChildren;
  /** 悬停提示：名称与金额 */
  tip: string;
  onClick?: () => void;
}

export interface TimelineGroup {
  date: string;
  items: TimelineItem[];
}

/** 真实比例：每天固定宽度，疏密如实呈现 */
const DAY = 12;
const ICON = 30;
const LEVELS = 3; // 同一处最多往上叠三层，再多的折成「+N」
const AXIS = 140;
/** 右端：今天往后一年（未来的扣款看一年就够） */
const AHEAD_MONTHS = 12;
/** 只挂载视口附近的图标：按这个宽度分块，滚过一块才重新挑选；两侧各留一块余量 */
const CHUNK = 1200;

const yearLabel = (d: string) => dateFormat(intlLocale(), { year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

/**
 * 扣款时间线：最左是账本里最早的订阅开始那天，最右是今天往后一年；打开时今天在正中。
 * 鼠标按住拖动、触控板横滑、或在时间线上滚动滚轮都能左右移动。
 * 刻度按真实天数等距：每天一小格、每周一中格、每月一长格并标出月份；图标落在当天的位置，挤在一起时往上叠。
 * load 需用 useCallback 固定下来，否则每次渲染都会重算。
 */
export function Timeline({
  load,
  today,
  start,
}: {
  load: (from: string, to: string) => TimelineGroup[];
  today: string;
  /** 最早的订阅开始日 */ start?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const glide = useRef(0);
  const drag = useRef<{ x: number; left: number; moved: boolean; v: number; t: number; id: number } | null>(null);
  // 左边留半屏的余量，最早那一笔也能滚到中间附近
  const from = addDays(start && start < today ? start : addDays(today, -30), -30);
  const to = addMonths(today, AHEAD_MONTHS);

  const layout = useMemo(() => {
    const xOf = (d: string) => diffDays(from, d) * DAY;
    const groups = load(from, to).sort((p, q) => p.date.localeCompare(q.date));
    // 逐个放图标：找最低一层、与该层上一个图标不重叠的位置
    const last = Array<number>(LEVELS).fill(-Infinity);
    const placed: Array<{ it: TimelineItem; date: string; x: number; level: number }> = [];
    const overflow = new Map<string, number>();
    for (const g of groups) {
      const x = xOf(g.date);
      for (const it of g.items) {
        const level = last.findIndex((l) => x - l >= ICON + 4);
        if (level < 0) {
          overflow.set(g.date, (overflow.get(g.date) ?? 0) + 1);
          continue;
        }
        last[level] = x;
        placed.push({ it, date: g.date, x, level });
      }
    }
    // 日、周刻度用背景画，只有月份刻度是元素
    const months: Array<{ x: number; label: string }> = [];
    for (let d = `${from.slice(0, 8)}01`; d <= to; d = addMonths(d, 1)) {
      if (d >= from) months.push({ x: xOf(d), label: d.slice(5, 7) === '01' ? yearLabel(d) : monthLabel(d.slice(0, 7), { year: false }) });
    }
    const monday = (8 - new Date(from).getUTCDay()) % 7;
    return { xOf, placed, overflow, months, dots: [...new Set(placed.map((p) => p.date))], width: xOf(to), monday };
  }, [from, to, load]);

  const center = (smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    cancelAnimationFrame(glide.current);
    const target = layout.xOf(today) - el.clientWidth / 2;
    if (!smooth) {
      el.scrollLeft = target;
      return;
    }
    // 自己做缓动（浏览器的 smooth 滚动在双击时会被打断）：每帧走剩余距离的 18%，接近时停下
    const step = () => {
      const d = target - el.scrollLeft;
      if (Math.abs(d) < 1) {
        el.scrollLeft = target;
        return;
      }
      el.scrollLeft += Math.sign(d) * Math.max(1, Math.abs(d) * 0.18);
      glide.current = requestAnimationFrame(step);
    };
    glide.current = requestAnimationFrame(step);
  };
  // 视口附近的可见区间（像素）；整条轨道仍按全长排布，滚动条与定位不受影响
  const [span, setSpan] = useState<[number, number]>([0, 0]);
  const pick = () => {
    const el = scroller.current;
    if (!el) return;
    const a = (Math.floor(el.scrollLeft / CHUNK) - 1) * CHUNK;
    const b = (Math.ceil((el.scrollLeft + el.clientWidth) / CHUNK) + 1) * CHUNK;
    setSpan((prev) => (prev[0] === a && prev[1] === b ? prev : [a, b]));
  };
  useLayoutEffect(() => {
    center();
    pick();
  }, [today]);

  // 滚轮：鼠标在时间线上时，竖向滚动换成左右移动；已经到最左（往上滚）或最右（往下滚）时不再拦截，交还给页面滚动
  useEffect(() => {
    const el = scroller.current!;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return; // 触控板横滑，浏览器自己处理
      const atStart = el.scrollLeft <= 0;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return;
      e.preventDefault();
      cancelAnimationFrame(glide.current);
      el.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 鼠标按住拖动：按在空白或图标上都拖整条时间线；松手后带惯性滑一段。拖过之后不触发点击
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    cancelAnimationFrame(glide.current);
    drag.current = { x: e.clientX, left: scroller.current!.scrollLeft, moved: false, v: 0, t: e.timeStamp, id: e.pointerId };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) <= 4) return;
      d.moved = true;
      scroller.current!.setPointerCapture(d.id);
      box.current!.classList.add('dragging');
    }
    const el = scroller.current!;
    const next = d.left - dx;
    const dt = Math.max(1, e.timeStamp - d.t);
    d.v = 0.8 * ((next - el.scrollLeft) / dt) + 0.2 * d.v; // 每毫秒滚动的像素
    d.t = e.timeStamp;
    el.scrollLeft = next;
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    box.current!.classList.remove('dragging');
    if (!d.moved) {
      drag.current = null;
      return;
    }
    // 惯性：松手前停顿过就不滑；否则每帧按 0.95 衰减
    let v = e.timeStamp - d.t > 80 ? 0 : d.v * 16;
    const step = () => {
      if (Math.abs(v) < 0.5) return;
      scroller.current!.scrollLeft += v;
      v *= 0.95;
      glide.current = requestAnimationFrame(step);
    };
    glide.current = requestAnimationFrame(step);
    // 紧随其后的 click 要知道这次是拖动
    setTimeout(() => (drag.current = null), 0);
  };

  const { xOf, placed, overflow, months, dots, width, monday } = layout;
  const near = (x: number) => x >= span[0] && x <= span[1];
  return (
    <div className="tl" ref={box}>
      <div
        className="tl-scroll"
        ref={scroller}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onScroll={pick}
        onDragStart={(e) => e.preventDefault()}
        // 在空白处双击回到今天（双击图标不算，那是打开详情）
        onDoubleClick={(e) => {
          if (!(e.target as Element).closest('.tl-icon')) center(true);
        }}
        onClickCapture={(e) => {
          if (drag.current?.moved) e.stopPropagation();
        }}
      >
        <div className="tl-track" style={{ width, '--day': `${DAY}px`, '--mon': `${monday * DAY}px` } as Record<string, string | number>}>
          {months
            .filter((m) => near(m.x))
            .map((m) => (
              <i key={m.x} className="tl-month" style={{ left: m.x }}>
                <span>{m.label}</span>
              </i>
            ))}
          <div className="tl-today" style={{ left: xOf(today) }}>
            <span>{t('common.today')}</span>
          </div>
          {placed
            .filter((p) => near(p.x))
            .map(({ it, date, x, level }) => (
              <button
                key={it.key}
                type="button"
                className={`tl-icon copy-tooltip ${date < today ? 'past' : ''}`}
                style={
                  { left: x - ICON / 2, top: AXIS - 14 - ICON - level * (ICON + 4), '--stem': `${14 + level * (ICON + 4)}px` } as Record<
                    string,
                    string | number
                  >
                }
                data-tip={`${md(date)}\n${it.tip}`}
                onClick={() => it.onClick?.()}
              >
                {it.icon}
              </button>
            ))}
          {[...overflow]
            .filter(([d]) => near(xOf(d)))
            .map(([d, n]) => (
              <span key={`more-${d}`} className="tl-more" style={{ left: xOf(d), top: AXIS - 14 - LEVELS * (ICON + 4) - 4 }}>
                +{n}
              </span>
            ))}
          {dots
            .filter((d) => near(xOf(d)))
            .map((d) => (
              <i key={`dot-${d}`} className={`tl-dot ${d < today ? 'past' : ''}`} style={{ left: xOf(d) }} />
            ))}
        </div>
      </div>
      <button type="button" className="tl-home" onClick={() => center(true)} title={t('editor.timeline.home')}>
        {t('common.today')}
      </button>
    </div>
  );
}
