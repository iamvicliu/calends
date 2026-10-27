import type { ReactNode as ComponentChildren } from 'react';
import { dateFormat } from '../../../shared/intl.ts';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addDays, addMonths, diffDays } from '../../../shared/billing.ts';
import { monthLabel } from '../../../shared/format.ts';
import { intlLocale, t } from '../../../shared/i18n.ts';
import './timeline.css';
import './copy.css';
import { TailName } from './TailName.tsx';
import { tooltipPosition } from './tooltip-position.ts';

export interface TimelineItem {
  key: string;
  icon: ComponentChildren;
  /** 悬停提示：名称与金额 */
  name: string;
  amount: string;
  /** 折成同一币种的金额，只用来比较大小（按日聚合时决定圆点大小）；缺汇率时为 0 或 NaN */
  value?: number;
  onClick?: () => void;
}

export interface TimelineGroup {
  date: string;
  items: TimelineItem[];
  /** 当天合计（已格式化），按日聚合时显示在提示里 */
  total?: string;
}

/** 真实比例：每天固定宽度，疏密如实呈现 */
const DAY = 12;
const ICON = 30;
const LEVELS = 3; // 同一处最多往上叠三层，再多的折成「+N」
const AXIS = 140;
/** 右端：今天往后一年（未来的扣款看一年就够） */
const AHEAD_MONTHS = 12;
/** 按日聚合时：圆点直径（不超过一天的宽度，相邻两天不重叠）与竖线最高处（最高的点也低于右上角「今天」按钮，手机上按钮高 40px） */
const DOT_MIN = 5;
const DOT_MAX = DAY - 1;
const STEM_MIN = 10;
const STEM_MAX = 92;
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
    // 稠密判定：图标叠满三层仍放不下（会出现「+N」）时，整条改成按日聚合——每天一个圆点，
    // 竖线高度与圆点大小按当天金额（面积比例，取平方根）；明细放在悬停 / 点按的提示里
    const dense = overflow.size > 0;
    const weight = (g: TimelineGroup) => g.items.reduce((s, it) => s + (Number.isFinite(it.value) ? Math.max(0, it.value!) : 0), 0);
    const top = Math.max(0, ...groups.map(weight));
    const days = dense
      ? groups.map((g) => {
          const k = top > 0 ? Math.sqrt(weight(g) / top) : 0;
          return { g, x: xOf(g.date), dot: Math.round(DOT_MIN + k * (DOT_MAX - DOT_MIN)), stem: Math.round(STEM_MIN + k * (STEM_MAX - STEM_MIN)) };
        })
      : [];
    const icons = dense ? [] : placed;
    return {
      xOf,
      placed: icons,
      overflow: dense ? new Map<string, number>() : overflow,
      months,
      days,
      dots: [...new Set(icons.map((p) => p.date))],
      width: xOf(to),
      monday,
    };
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

  const { xOf, placed, overflow, months, days, dots, width, monday } = layout;
  const near = (x: number) => x >= span[0] && x <= span[1];

  // 按日聚合的提示：悬停 / 聚焦时只读显示；点按（含触屏）后固定，里面的订阅可点开，Esc 或点别处关闭
  const tipId = useId();
  const [tip, setTip] = useState<{ g: TimelineGroup; x: number; top: number; bottom: number; pinned: boolean; from: HTMLElement } | null>(null);
  const tipBox = useRef<HTMLDivElement>(null);
  const [tipAt, setTipAt] = useState({ left: 8, top: 8 });
  const showTip = (g: TimelineGroup, el: HTMLElement, pinned: boolean) => {
    const r = el.getBoundingClientRect();
    setTip({ g, x: r.left + r.width / 2, top: r.top, bottom: r.bottom, pinned, from: el });
  };
  const closeTip = (refocus = false) => {
    if (refocus) tip?.from.focus();
    setTip(null);
  };
  useLayoutEffect(() => {
    if (!tip || !tipBox.current) return;
    setTipAt(tooltipPosition(tip, tipBox.current.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
    if (tip.pinned) tipBox.current.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [tip]);
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTip(true);
    };
    const outside = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!tipBox.current?.contains(n) && !tip.from.contains(n)) hide();
    };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', outside, true);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', outside, true);
    };
  }, [tip]);
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
          if (!(e.target as Element).closest('.tl-icon, .tl-day')) center(true);
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
          {days
            .filter((d) => near(d.x))
            .map(({ g, x, dot, stem }) => (
              <button
                key={`day-${g.date}`}
                type="button"
                className={`tl-day ${g.date < today ? 'past' : ''} ${tip?.g === g ? 'on' : ''}`}
                style={{ left: x - DAY / 2, top: AXIS - stem - dot / 2, height: stem + dot / 2, '--dot': `${dot}px` } as Record<string, string | number>}
                aria-label={[md(g.date), g.total, ...g.items.map((it) => `${it.name} ${it.amount}`)].filter(Boolean).join('\n')}
                aria-describedby={tip?.g === g ? tipId : undefined}
                aria-expanded={g.items.length > 1 ? tip?.g === g && tip.pinned : undefined}
                onMouseEnter={(e) => tip?.pinned || showTip(g, e.currentTarget, false)}
                onMouseLeave={() => tip?.pinned || setTip(null)}
                onFocus={(e) => tip?.pinned || showTip(g, e.currentTarget, false)}
                onBlur={(e) => tip?.pinned || tipBox.current?.contains(e.relatedTarget as Node) || setTip(null)}
                onClick={(e) => {
                  // 只有一笔：直接打开，与图标一致；多笔：固定提示，从里面挑
                  if (g.items.length === 1 && g.items[0].onClick) {
                    setTip(null);
                    g.items[0].onClick();
                  } else if (tip?.g === g && tip.pinned) closeTip();
                  else showTip(g, e.currentTarget, true);
                }}
              >
                <i />
              </button>
            ))}
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
                data-tip={`${md(date)}\n${it.name}\n${it.amount}`}
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
      {tip &&
        createPortal(
          <div
            ref={tipBox}
            id={tipId}
            className={`tl-tip ${tip.pinned ? 'pinned' : ''}`}
            role={tip.pinned ? 'dialog' : 'tooltip'}
            // 键盘离开提示（Tab 出去）就收起
            onBlur={(e) => {
              const n = e.relatedTarget as Node | null;
              if (n && !e.currentTarget.contains(n) && !tip.from.contains(n)) setTip(null);
            }}
            aria-label={tip.pinned ? md(tip.g.date) : undefined}
            style={tipAt}
          >
            <div className="tl-tip-head">
              <b>{md(tip.g.date)}</b>
              {tip.g.total && <b className="num">{tip.g.total}</b>}
            </div>
            {tip.g.items.map((it) =>
              tip.pinned && it.onClick ? (
                <button
                  key={it.key}
                  type="button"
                  className="tl-tip-row"
                  onClick={() => {
                    setTip(null);
                    it.onClick!();
                  }}
                >
                  <TailName name={it.name} />
                  <span className="num">{it.amount}</span>
                </button>
              ) : (
                <div key={it.key} className="tl-tip-row">
                  <TailName name={it.name} />
                  <span className="num">{it.amount}</span>
                </div>
              ),
            )}
          </div>,
          document.body,
        )}
      <button type="button" className="tl-home" onClick={() => center(true)} title={t('editor.timeline.home')}>
        {t('common.today')}
      </button>
    </div>
  );
}
