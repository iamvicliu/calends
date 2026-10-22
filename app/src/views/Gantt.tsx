import { stopDescription } from '../components/StopPanel.tsx';
import { Fragment, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  addDays,
  addMonths,
  chargesBetween,
  coveredUntil,
  diffDays,
  effectiveStatus,
  stopSummary,
  phaseLanes,
  phaseSubs,
  priceAt,
} from '../../../shared/billing.ts';
import { flow, cnDate, money, monthLabel } from '../../../shared/format.ts';
import { intlLocale, t } from '../../../shared/i18n.ts';
import { GANTT_STEP, ganttLabelBounds, ganttTicks, ganttWindow, isGanttZoom, snapGanttPan, stepGanttPan, type GanttZoom } from '../../../shared/gantt.ts';
import type { AppState, Subscription } from '../../../shared/types.ts';
import { FlagImg, Icon, Seg, SubIcon, useWidth } from '../components/ui.tsx';
import { perLabel } from './Overview.tsx';
import { usePref } from '../store.ts';

type ColorBy = 'method' | 'region';
const isColorBy = (v: string): v is ColorBy => v === 'method' || v === 'region';

const PALETTE = ['var(--c1)', 'var(--c4)', 'var(--c5)', 'var(--c3)', 'var(--c6)', 'var(--c7)', 'var(--c2)', 'var(--c8)', 'var(--c10)', 'var(--c9)'];

interface Seg_ {
  v: Subscription;
  from: string;
  to: string;
  open: boolean; // 没有结束日，一直延续
}
interface Row {
  s: Subscription;
  segs: Seg_[];
  /** 每段所在的轨道：换区后新旧两段并行时，后开始的那段画在下面一条 */
  lanes: number[];
  gaps: Array<{ from: string; to: string }>;
  first: string;
  last: string;
}

/** 并行的段往下错开的距离（条高 18） */
const LANE = 21;

/** 一个周期至少这么宽才按续费切开，太窄会密成一串圆点 */
const CYCLE_MIN_PX = 28;
const GAP_TUCK = 9;
const span = (d: number) => (d >= 60 ? t('list.gantt.months', { count: Math.round(d / 30.4) }) : t('list.gantt.days', { count: d }));

/**
 * 时间轴（甘特图）：一行一个订阅，一段一根条。
 * 条按支付方式或地区上色；过去的实心、未来的半透明；计划中的斜线；两段之间空着的是断订；条下的小刻度是每笔扣款。
 */
/** 停用标志与条同高，作为条的末端 */
const STOP_CAP = 18;
const NARROW = '(max-width: 700px)';
const PORTRAIT = '(max-width: 700px) and (orientation: portrait)';
function subscribeNarrow(cb: () => void) {
  const mq = matchMedia(NARROW);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
function subscribePortrait(cb: () => void) {
  const mq = matchMedia(PORTRAIT);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

export function Gantt({ rows: subs, state, today, onOpen }: { rows: Subscription[]; state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  // 缩放与着色方式存在服务端，多台设备一致
  const [zoom, setZoomRaw] = usePref<GanttZoom>('gantt-zoom', '1y', isGanttZoom);
  // 左右平移：pan 是已确定的偏移（天），drag 是拖动中尚未松手的偏移；松手后对齐到月份锚点
  const [pan, setPan] = useState(0);
  const [drag, setDrag] = useState(0);
  const setZoom = (z: GanttZoom) => {
    clearTimeout(wheelIdle.current);
    dragFrom.current = null;
    dragged.current = false;
    setZoomRaw(z);
    setPan(0);
    setDrag(0);
  };
  const [colorBy, setColorBy] = usePref<ColorBy>('gantt-color', 'method', isColorBy);
  // 名称列宽度可拖动调整；手机与桌面各记一份，桌面上调宽的值不会挤占手机上的时间轴
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => matchMedia(NARROW).matches,
    () => false,
  );
  const portrait = useSyncExternalStore(
    subscribePortrait,
    () => matchMedia(PORTRAIT).matches,
    () => false,
  );
  const gtEl = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{ textWidth: number; containerWidth: number; paddingLeft: number; paddingRight: number; gap: number } | null>(null);
  const bounds = ganttLabelBounds(measured?.textWidth ?? 144, measured?.containerWidth ?? 0, {
    paddingLeft: measured?.paddingLeft ?? (narrow ? 12 : 16),
    paddingRight: measured?.paddingRight ?? 12,
    gap: measured?.gap ?? 8,
    iconWidth: 20,
  });
  const { min: minW, max: maxW } = bounds;
  const [savedW, setSavedW] = usePref<string>(
    narrow ? 'gantt-label-w-m' : 'gantt-label-w',
    '',
    (v): v is string => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)),
  );
  const [liveW, setLiveW] = useState<number | null>(null);
  const labelW = portrait ? minW : Math.min(maxW, Math.max(minW, liveW ?? (savedW ? Number(savedW) : bounds.default)));
  const iconOnly = portrait || labelW <= minW;
  const resizeFrom = useRef<{ x: number; w: number } | null>(null);
  const onResizeDown = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    const label = gtEl.current?.querySelector('.gt-head .gt-label');
    resizeFrom.current = { x: e.clientX, w: label?.getBoundingClientRect().width ?? minW };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent<HTMLElement>) => {
    const from = resizeFrom.current;
    if (!from) return;
    e.stopPropagation();
    setLiveW(Math.round(Math.min(maxW, Math.max(minW, from.w + e.clientX - from.x))));
  };
  const onResizeUp = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    resizeFrom.current = null;
    if (liveW != null) setSavedW(String(liveW));
    setLiveW(null);
  };
  const [box, w] = useWidth();

  // 排序、筛选变化时的过渡（FLIP）：记下每行上一次的位置，重排后从旧位置平滑滑到新位置；新出现的行淡入
  const body = useRef<HTMLDivElement>(null);
  const prevTops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, number>();
    el.querySelectorAll<HTMLElement>('.gt-row').forEach((row) => {
      const id = row.dataset.id!;
      const top = row.offsetTop;
      next.set(id, top);
      if (reduce || !prevTops.current.size) return;
      const before = prevTops.current.get(id);
      if (before == null)
        row.animate(
          [
            { opacity: 0, transform: 'translateY(6px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        );
      else if (before !== top)
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    });
    prevTops.current = next;
  });

  const rows: Row[] = useMemo(() => {
    const out = subs.map((s) => {
      const vs = phaseSubs(s);
      const segs = vs.map((v) => {
        const st = effectiveStatus(v, today);
        const end = v.end ?? (st === 'ended' ? today : undefined);
        return { v, from: v.start, to: end ?? addMonths(today, 6), open: !end };
      });
      const spans = segs.map((g) => ({ start: g.from, end: g.open ? undefined : g.to }));
      // 断订：前面所有段都已结束、下一段还没开始的空档（并行的旧段还在跑就不算）
      const gaps = segs.slice(1).flatMap((g, i) => {
        const until = coveredUntil(spans, i + 1);
        return until && until < g.from ? [{ from: until, to: g.from }] : [];
      });
      return {
        s,
        segs,
        lanes: phaseLanes(
          segs.map((g) => ({
            start: g.from,
            end:
              !state.readonly && g.v.stop && (stopSummary(g.v, today)?.wastedDays ?? 0) > 0
                ? addDays(g.v.stop.date, stopSummary(g.v, today)!.wastedDays)
                : g.open
                  ? undefined
                  : g.to,
          })),
        ),
        gaps,
        first: segs[0].from,
        last: segs.reduce((m, g) => (g.to > m ? g.to : m), segs[0].to),
      };
    });
    // 每个订阅各占一行、互相独立；顺序跟随页面顶部的排序与筛选
    return out;
  }, [subs, today, state.readonly]);

  const earliest = rows.reduce((m, r) => (r.first < m ? r.first : m), today);
  const { start: baseStart, end: baseEnd } = ganttWindow(zoom, today, earliest);
  const offset = zoom === 'all' ? 0 : Math.round(pan + drag);
  const start = addDays(baseStart, offset);
  const end = addDays(baseEnd, offset);
  const days = Math.max(1, diffDays(start, end));
  const k = w / days;
  const pannable = zoom !== 'all';
  const snap = (raw: number) => snapGanttPan(baseStart, raw);
  const step = (dir: 1 | -1) => {
    if (zoom === 'all') return;
    setPan(stepGanttPan(baseStart, offset, dir * GANTT_STEP[zoom]));
  };

  // 触控板横向滑动：直接平移，停下 150ms 后对齐到月份锚点
  const wheelIdle = useRef<number | undefined>(undefined);
  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault(); // 全部范围或尚未测得宽度时也不能把横滑交给浏览器
    if (!pannable || !k) return;
    const pixels = e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? w : 1);
    setPan((p) => p + pixels / k);
    clearTimeout(wheelIdle.current);
    wheelIdle.current = window.setTimeout(() => setPan((p) => snap(p)), 150);
  };
  const locale = intlLocale();
  useLayoutEffect(() => {
    const el = gtEl.current;
    const label = el?.querySelector<HTMLElement>('.gt-head .gt-label');
    if (!el || !label) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const style = getComputedStyle(label);
      // 临时文字继承名称格的真实字体，脱离布局测量，折叠名称后也能重新展开。
      const probe = document.createElement('span');
      probe.style.cssText = 'position:fixed;visibility:hidden;white-space:nowrap;width:max-content;max-width:none;';
      label.appendChild(probe);
      let textWidth = 0;
      for (const sub of subs) {
        probe.textContent = sub.name;
        textWidth = Math.max(textWidth, probe.getBoundingClientRect().width);
      }
      probe.remove();
      const next = {
        textWidth,
        containerWidth: el.clientWidth,
        paddingLeft: parseFloat(style.paddingLeft) || 0,
        paddingRight: parseFloat(style.paddingRight) || 0,
        gap: parseFloat(style.columnGap) || 0,
      };
      setMeasured((prev) => (prev && Object.keys(next).every((key) => prev[key as keyof typeof next] === next[key as keyof typeof next]) ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener('loadingdone', measure);
    return () => {
      active = false;
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', measure);
    };
  }, [subs, narrow, locale]);
  useLayoutEffect(() => {
    resizeFrom.current = null;
    setLiveW(null);
  }, [portrait, narrow]);
  // React 的 wheel 监听是被动的，拦不住页面滚动；横向滑动改用原生监听（非被动），并始终调用最新的处理函数
  const wheel = useEffectEvent((e: WheelEvent) => onWheel(e));
  useEffect(() => {
    const el = gtEl.current;
    if (!el) return;
    const h = (e: WheelEvent) => wheel(e);
    el.addEventListener('wheel', h, { passive: false });
    return () => {
      el.removeEventListener('wheel', h);
      clearTimeout(wheelIdle.current);
    };
  }, []);
  // 按住拖动：超过 6px 才算拖动，拖动后吞掉这次点击，避免误开详情
  const dragFrom = useRef<number | null>(null);
  const dragged = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!pannable || e.button !== 0) return;
    dragFrom.current = e.clientX;
    dragged.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragFrom.current == null || !k) return;
    const dx = e.clientX - dragFrom.current;
    if (!dragged.current && Math.abs(dx) < 6) return;
    if (!dragged.current) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragged.current = true;
    setDrag(-dx / k);
  };
  const onPointerUp = () => {
    if (dragFrom.current == null) return;
    dragFrom.current = null;
    if (dragged.current) {
      setPan((p) => snap(p + drag));
      setDrag(0);
    }
  };
  const rangeLabel = `${monthLabel(start.slice(0, 7))} – ${monthLabel(addDays(end, -1).slice(0, 7))}`;
  const x = (d: string) => Math.min(w, Math.max(0, diffDays(start, d) * k));

  // 颜色：按支付方式或地区，固定顺序分配
  const keyOf = (v: Subscription) => (colorBy === 'method' ? (v.methodId ?? 'none') : (v.region ?? '—'));
  const keys = useMemo(() => [...new Set(rows.flatMap((r) => r.segs.map((g) => keyOf(g.v))))], [rows, colorBy]);
  const color = (v: Subscription) => PALETTE[keys.indexOf(keyOf(v)) % PALETTE.length];
  const labelOf = (key: string) =>
    colorBy === 'method' ? (state.methods.find((m) => m.id === key)?.name ?? t('list.unassigned')) : key === '—' ? t('list.gantt.noRegion') : key;

  const ticks = ganttTicks(zoom, start, end, w, intlLocale());

  return (
    <div className="gantt">
      <div className="gt-bar">
        <Seg
          small
          value={zoom}
          onChange={setZoom}
          options={[
            ['3m', t('list.gantt.zoom3m')],
            ['6m', t('list.gantt.zoom6m')],
            ['1y', t('list.gantt.zoom1y')],
            ['3y', t('list.gantt.zoom3y')],
            ['all', t('list.all')],
          ]}
        />
        {pannable && (
          <div className="gt-nav">
            <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label={t('list.gantt.earlier')}>
              <Icon name="left" />
            </button>
            <button type="button" className={`gt-range ${offset === 0 ? '' : 'moved'}`} onClick={() => setPan(0)} title={t('list.gantt.backToNow')}>
              {rangeLabel}
            </button>
            <button type="button" className="icon-btn" onClick={() => step(1)} aria-label={t('list.gantt.later')}>
              <Icon name="right" />
            </button>
          </div>
        )}
        <Seg
          small
          value={colorBy}
          onChange={setColorBy}
          options={[
            ['method', t('list.gantt.byMethod')],
            ['region', t('list.gantt.byRegion')],
          ]}
        />
      </div>
      <div
        ref={gtEl}
        className={`gt ${pannable ? 'pannable' : ''} ${drag ? 'dragging' : ''} ${liveW != null ? 'resizing' : ''}`}
        style={{ '--lw': `${labelW}px` } as Record<string, string>}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {!portrait && (
          <div
            className="gt-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('list.gantt.resize')}
            title={t('list.gantt.resize')}
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={() => setSavedW(null)}
          />
        )}
        <div className="gt-head">
          <div className="gt-label" />
          <div className="gt-track" ref={box}>
            {ticks
              .filter((t) => t.label)
              .map((t) => (
                <span key={t.d} className={`gt-tick ${t.major ? 'major' : ''}`} style={{ left: t.labelX }}>
                  {t.label}
                </span>
              ))}
          </div>
        </div>
        <div className="gt-body" ref={body}>
          <div className="gt-grid">
            <div className="gt-label" />
            <div className="gt-track">
              {ticks.map((t) => (
                <i key={t.d} className={t.major ? 'major' : ''} style={{ left: x(t.d) }} />
              ))}
              {today >= start && today <= end && <b className="gt-today" style={{ left: x(today) }} />}
            </div>
          </div>
          {rows.map((r) => {
            const charges = w ? chargesBetween(r.s, start, end, today) : [];
            return (
              <div
                key={r.s.id}
                data-id={r.s.id}
                className="gt-row"
                style={{ '--lanes': Math.max(...r.lanes) + 1 } as Record<string, number>}
                onClick={() => !dragged.current && onOpen(r.s)}
              >
                <div className="gt-label" title={r.s.name}>
                  <span className="gt-icon" role="img" title={r.s.name} aria-label={r.s.name}>
                    <SubIcon sub={r.s} size={20} />
                  </span>
                  {!iconOnly && <span className="gt-name">{r.s.name}</span>}
                </div>
                <div className="gt-track">
                  {r.gaps
                    .filter((g) => g.to >= start && g.from <= end)
                    .map((g) => (
                      <span
                        key={g.from}
                        className="gt-gap"
                        // 两端各伸进相邻段的圆角下面，虚线和前后两段首尾相接
                        style={{ left: x(g.from) - GAP_TUCK, width: Math.max(0, x(g.to) - x(g.from) + GAP_TUCK * 2) }}
                        title={t('list.gantt.gapTitle', { span: span(diffDays(g.from, g.to)), from: cnDate(g.from), to: cnDate(g.to) })}
                      >
                        {x(g.to) - x(g.from) > 90 && <em>{t('list.gantt.gapShort', { span: span(diffDays(g.from, g.to)) })}</em>}
                      </span>
                    ))}
                  {r.segs.map((g, gi) => {
                    const to = g.open && end > g.to ? end : g.to;
                    const left = x(g.from);
                    const top = 8 + r.lanes[gi] * LANE;

                    const stopped = stopSummary(g.v, today);
                    const unused = !state.readonly && !!stopped && stopped.wastedDays > 0;
                    const wastedUntil = unused ? addDays(stopped!.date, stopped!.wastedDays) : '';
                    const unusedWidth = unused ? Math.max(0, x(wastedUntil) - x(stopped!.date)) : 0;
                    const unusedAmount = unused ? flow(-stopped!.unusedValue, g.v.currency, { compact: true }) : '';
                    // 留出左右内边距；停用标志占据的半圆不计入文字空间。
                    const showUnusedAmount = unusedWidth >= Math.max(56, [...unusedAmount].length * 7 + 18);
                    if ((unused ? wastedUntil : to) < start || g.from > end) return null;
                    const lifetime = g.v.cycle.unit === 'lifetime';
                    const tip = `${g.v.region ? `${g.v.region} · ` : ''}${money(g.v.price, g.v.currency)}${lifetime ? t('list.gantt.lifetimeSuffix') : `/${perLabel(g.v)}`} · ${cnDate(g.from)} – ${g.open ? t('list.gantt.present') : cnDate(g.to)}${g.v.planned ? t('list.gantt.plannedSuffix') : ''}`;
                    // 买断：一个圆点；有结束日（如含一年更新、之后改订阅）时，再拉一条细线到结束日，和后面的虚线、下一段接上
                    if (lifetime)
                      return (
                        <Fragment key={g.from}>
                          {!g.open && x(g.to) - left > 8 && (
                            <span className="gt-life-tail" style={{ left, width: x(g.to) - left, top: top + 8, background: color(g.v) }} />
                          )}
                          <span className="gt-lifetime" style={{ left, top: top + 2, background: color(g.v) }} title={tip} />
                        </Fragment>
                      );
                    // 段内按调价、首期优惠切成几截，每截标自己的价格；
                    // 周期够宽时再按每次续费切开：每个周期一颗圆角胶囊，连续续订的首尾相接
                    const renewals = chargesBetween(g.v, g.from, to, today)
                      .filter((c) => c.amount > 0 && c.date > g.from && c.date < to)
                      .map((c) => c.date);
                    const perCycle = renewals.length > 1 ? diffDays(renewals[0], renewals[1]) * k : Infinity;
                    // 短窗口优先给价格留空间，避免窄屏每期都切开后没有一截能放下价格。
                    const cycleMin = zoom === '3m' || zoom === '6m' ? 80 : CYCLE_MIN_PX;
                    const cycleCuts = new Set(perCycle >= cycleMin ? renewals : []);
                    const cuts = [
                      ...new Set([g.from, ...(g.v.priceHistory ?? []).map((p) => p.from), ...(g.v.intro ? [g.v.intro.until] : []), ...cycleCuts, to]),
                    ]
                      .filter((d) => d >= g.from && d <= to)
                      .sort();
                    let labeled = '';
                    return (
                      <Fragment key={g.from}>
                        {cuts.slice(0, -1).map((a, n) => {
                          const b = cuts[n + 1];
                          if (b < start || a > end) return null;
                          // 被服务方停用：最后一截至少是一个正圆，停用标志正好嵌在末端
                          const capped = stopped?.kind === 'terminate' && n === cuts.length - 2 && b === stopped.date;
                          const pl = capped ? Math.min(x(a), x(b) - STOP_CAP) : x(a);
                          const pw = Math.max(capped ? STOP_CAP : 3, x(b) - pl);
                          const intro = g.v.intro && a < g.v.intro.until;
                          const price = priceAt(g.v, a);
                          const last = n === cuts.length - 2;
                          const pnow = Math.min(pw, Math.max(0, x(today) - pl));
                          // 同价的一串只标一次：标在窗口内第一截放得下的
                          const run = `${price}|${intro ? 1 : 0}`;
                          const label = pw > 70 && labeled !== run;
                          if (label) labeled = run;
                          const ptip = `${intro ? t('list.gantt.introPrefix') : ''}${money(price, g.v.currency)}/${perLabel(g.v)} · ${cnDate(a)} – ${last && g.open ? t('list.gantt.present') : cnDate(b)}${g.v.region ? ` · ${g.v.region}` : ''}${g.v.planned ? t('list.gantt.plannedSuffix') : ''}`;
                          return (
                            <span
                              key={a}
                              className={`gt-seg ${g.v.planned ? 'planned' : ''} ${last && g.open ? 'open' : ''} ${n > 0 && !cycleCuts.has(a) ? 'cont' : ''} ${!last && !cycleCuts.has(b) ? 'cut' : ''} ${last && unused && !capped ? 'joined' : ''} ${intro ? 'intro' : ''}`}
                              style={{ left: pl, width: pw, top, '--c': color(g.v), '--now': `${pnow}px` } as Record<string, string | number>}
                              title={ptip || tip}
                            >
                              {g.v.trialEnd && a < g.v.trialEnd && x(g.v.trialEnd) > pl && (
                                <i className="gt-trial" style={{ width: Math.min(pw, x(g.v.trialEnd) - pl) }} />
                              )}
                              {label && (
                                <em>
                                  {n === 0 && g.v.region ? <FlagImg cc={g.v.region} /> : null}
                                  {intro ? t('list.gantt.introShort') : ''}
                                  {money(price, g.v.currency, { compact: true })}/{perLabel(g.v)}
                                </em>
                              )}
                            </span>
                          );
                        })}
                        {unused && (
                          <span
                            className="gt-unused"
                            // 被服务方停用时，灰段起点藏到停用标志下半个圆，接缝处只露出完整的圆
                            style={{
                              left: x(stopped!.date) - (stopped!.kind === 'terminate' ? STOP_CAP / 2 : 0),
                              width: unusedWidth + (stopped!.kind === 'terminate' ? STOP_CAP / 2 : 0),
                              paddingLeft: stopped!.kind === 'terminate' ? STOP_CAP / 2 : 0,
                              top,
                            }}
                            title={stopDescription(g.v, today)}
                          >
                            {showUnusedAmount && <em className="gt-unused-amount">{unusedAmount}</em>}
                          </span>
                        )}
                        {stopped && stopped.date >= start && stopped.date <= end && stopped.kind === 'terminate' && (
                          <svg
                            className="gt-stop"
                            role="img"
                            aria-label={t('core.stop.terminate')}
                            style={{ left: x(stopped.date) - STOP_CAP, top }}
                            viewBox="0 0 20 20"
                          >
                            <title>{state.readonly ? t('core.stop.terminate') : stopDescription(g.v, today)}</title>
                            <circle cx="10" cy="10" r="8.75" />
                            <path d="M4.7 15.3 15.3 4.7" />
                          </svg>
                        )}
                      </Fragment>
                    );
                  })}
                  {charges.map((c, k2) => (
                    <i
                      key={k2}
                      className={`gt-charge ${c.amount < 0 ? 'refund' : ''} ${c.date > today ? 'future' : ''}`}
                      style={{ left: x(c.date) }}
                      title={`${cnDate(c.date)} · ${c.kind === 'refund' ? t('editor.payment.kind.refund') : t('editor.payment.kind.charge')} · ${flow(-c.amount, c.currency)}`}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="gt-legend">
        <span>
          <i className="lg-unused" />
          {t('core.stop.unusedTitle')}
        </span>
        <span>
          <svg className="lg-stop" viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="8.75" />
            <path d="M4.7 15.3 15.3 4.7" />
          </svg>
          {t('core.stop.terminate')}
        </span>
        {keys.map((key, i) => (
          <span key={key}>
            <i style={{ background: PALETTE[i % PALETTE.length] }} />
            {labelOf(key)}
          </span>
        ))}
        <span>
          <i className="lg-planned" />
          {t('list.gantt.planned')}
        </span>
        <span>
          <i className="lg-gap" />
          {t('list.gantt.gap')}
        </span>
      </div>
    </div>
  );
}
