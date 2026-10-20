import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { addDays, addMonths, diffDays } from '../../shared/billing.ts';
import { monthLabel } from '../../shared/format.ts';
import { intlLocale, t } from '../../shared/i18n.ts';
import './timeline.css';

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
/** 初始范围与每次往两边延伸的天数；离边缘不到 EDGE 像素就继续加载 */
const BEFORE = 120;
const AFTER = 240;
const STEP = 180;
const EDGE = 900;

const yearLabel = (d: string) => new Intl.DateTimeFormat(intlLocale(), { year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

/**
 * 扣款时间线：今天在正中，左边是已扣的、右边是将要扣的，可以一直往两边拖（滑到边缘自动加载更多）。
 * 刻度按真实天数等距：每天一小格、每周一中格、每月一长格并标出月份；图标落在当天的位置，挤在一起时往上叠。
 * load 需用 useCallback 固定下来，否则每次渲染都会重算。
 */
export function Timeline({ load, today }: { load: (from: string, to: string) => TimelineGroup[]; today: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState(() => ({ from: addDays(today, -BEFORE), to: addDays(today, AFTER) }));
  const prevFrom = useRef(range.from);
  const busy = useRef(false); // 一次只加载一段
  const drag = useRef<{ x: number; left: number; moved: boolean; v: number; t: number; id: number } | null>(null);
  const { from, to } = range;

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
  useLayoutEffect(() => center(), [today]);
  // 往左加载后内容整体右移，补偿滚动位置（拖动中的起点也一起补），画面不跳
  useLayoutEffect(() => {
    const dx = diffDays(from, prevFrom.current) * DAY;
    prevFrom.current = from;
    if (dx && scroller.current) {
      scroller.current.scrollLeft += dx;
      if (drag.current) drag.current.left += dx;
    }
    busy.current = false;
  }, [from, to]);

  const onScroll = () => {
    const el = scroller.current!;
    if (busy.current) return;
    if (el.scrollLeft < EDGE) {
      busy.current = true;
      setRange((r) => ({ ...r, from: addDays(r.from, -STEP) }));
    } else if (el.scrollWidth - el.scrollLeft - el.clientWidth < EDGE) {
      busy.current = true;
      setRange((r) => ({ ...r, to: addDays(r.to, STEP) }));
    }
  };

  // 鼠标按住拖动：按在空白或图标上都拖整条时间线；松手后带惯性滑一段。拖过之后不触发点击
  const glide = useRef(0);
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    cancelAnimationFrame(glide.current);
    drag.current = { x: e.clientX, left: scroller.current!.scrollLeft, moved: false, v: 0, t: e.timeStamp, id: e.pointerId };
  };
  const onMove = (e: PointerEvent) => {
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
  const onUp = (e: PointerEvent) => {
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
  return (
    <div class="tl" ref={box}>
      <div
        class="tl-scroll"
        ref={scroller}
        onScroll={onScroll}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDragStart={(e) => e.preventDefault()}
        // 在空白处双击回到今天（双击图标不算，那是打开详情）
        onDblClick={(e) => {
          if (!(e.target as Element).closest('.tl-icon')) center(true);
        }}
        onClickCapture={(e) => {
          if (drag.current?.moved) e.stopPropagation();
        }}
      >
        <div class="tl-track" style={{ width, '--day': `${DAY}px`, '--mon': `${monday * DAY}px` } as Record<string, string | number>}>
          {months.map((m) => (
            <i key={m.x} class="tl-month" style={{ left: m.x }}>
              <span>{m.label}</span>
            </i>
          ))}
          <div class="tl-today" style={{ left: xOf(today) }}>
            <span>{t('common.today')}</span>
          </div>
          {placed.map(({ it, date, x, level }) => (
            <button
              key={it.key}
              type="button"
              class={`tl-icon ${date < today ? 'past' : ''}`}
              style={
                { left: x - ICON / 2, top: AXIS - 14 - ICON - level * (ICON + 4), '--stem': `${14 + level * (ICON + 4)}px` } as Record<string, string | number>
              }
              data-tip={`${md(date)} · ${it.tip}`}
              onClick={() => it.onClick?.()}
            >
              {it.icon}
            </button>
          ))}
          {[...overflow].map(([d, n]) => (
            <span key={`more-${d}`} class="tl-more" style={{ left: xOf(d), top: AXIS - 14 - LEVELS * (ICON + 4) - 4 }}>
              +{n}
            </span>
          ))}
          {dots.map((d) => (
            <i key={`dot-${d}`} class={`tl-dot ${d < today ? 'past' : ''}`} style={{ left: xOf(d) }} />
          ))}
        </div>
      </div>
      <button type="button" class="tl-home" onClick={() => center(true)} title={t('editor.timeline.home')}>
        {t('common.today')}
      </button>
    </div>
  );
}
