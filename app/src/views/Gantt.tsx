import { Fragment, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addDays, addMonths, chargesBetween, coveredUntil, diffDays, effectiveStatus, phaseLanes, phaseSubs, priceAt } from '../../../shared/billing.ts';
import { cnDate, money, monthLabel } from '../../../shared/format.ts';
import { t } from '../../../shared/i18n.ts';
import type { AppState, Subscription } from '../../../shared/types.ts';
import { FlagImg, Icon, Seg, SubIcon, useWidth } from '../components/ui.tsx';
import { perLabel } from './Overview.tsx';
import { usePref } from '../store.ts';

type Zoom = 'year' | '1y' | '3y' | 'all';

/** 每种范围一次翻多少个月 */
const STEP: Record<Exclude<Zoom, 'all'>, number> = { year: 12, '1y': 12, '3y': 36 };
type ColorBy = 'method' | 'region';
const isZoom = (v: string): v is Zoom => ['year', '1y', '3y', 'all'].includes(v);
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
export function Gantt({ rows: subs, state, today, onOpen }: { rows: Subscription[]; state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  // 缩放与着色方式存在服务端，多台设备一致
  const [zoom, setZoomRaw] = usePref<Zoom>('gantt-zoom', 'year', isZoom);
  // 左右平移：pan 是已确定的偏移（天），drag 是拖动中尚未松手的偏移；松手后对齐到月初
  const [pan, setPan] = useState(0);
  const [drag, setDrag] = useState(0);
  const setZoom = (z: Zoom) => {
    setZoomRaw(z);
    setPan(0);
    setDrag(0);
  };
  const [colorBy, setColorBy] = usePref<ColorBy>('gantt-color', 'method', isColorBy);
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
      return { s, segs, lanes: phaseLanes(spans), gaps, first: segs[0].from, last: segs.reduce((m, g) => (g.to > m ? g.to : m), segs[0].to) };
    });
    // 每个订阅各占一行、互相独立；顺序跟随页面顶部的排序与筛选
    return out;
  }, [subs, today]);

  const earliest = rows.reduce((m, r) => (r.first < m ? r.first : m), today);
  // 基准窗口：今年 = 1 月 1 日到年底；1 年、3 年以今天为中偏右；全部 = 最早一笔到半年后
  const baseStart =
    zoom === 'year'
      ? `${today.slice(0, 4)}-01-01`
      : zoom === '1y'
        ? addMonths(today, -9)
        : zoom === '3y'
          ? addMonths(today, -30)
          : `${earliest.slice(0, 7)}-01`;
  const baseEnd = zoom === 'year' ? `${Number(today.slice(0, 4)) + 1}-01-01` : addMonths(today, zoom === '1y' ? 3 : 6);
  const offset = zoom === 'all' ? 0 : Math.round(pan + drag);
  const start = addDays(baseStart, offset);
  const end = addDays(baseEnd, offset);
  const days = Math.max(1, diffDays(start, end));
  const k = w / days;
  const pannable = zoom !== 'all';
  /** 把窗口起点对齐到最近的月份（与基准窗口同一天），返回对应的偏移 */
  const snap = (raw: number) => {
    const d = addDays(baseStart, Math.round(raw));
    const [y, m] = d.split('-').map(Number);
    const idx = y * 12 + (m - 1) + (Number(d.slice(8)) > 15 ? 1 : 0);
    const aligned = idx;
    const target = `${Math.floor(aligned / 12)}-${String((aligned % 12) + 1).padStart(2, '0')}-${baseStart.slice(8)}`;
    return diffDays(baseStart, target);
  };
  const step = (dir: 1 | -1) => {
    if (zoom === 'all') return;
    setPan(diffDays(baseStart, addMonths(start, dir * STEP[zoom])));
  };

  // 触控板横向滑动：直接平移，停下 150ms 后对齐到月初
  const wheelIdle = useRef<number | undefined>(undefined);
  const onWheel = (e: WheelEvent) => {
    if (!pannable || !k || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    setPan((p) => p + e.deltaX / k);
    clearTimeout(wheelIdle.current);
    wheelIdle.current = window.setTimeout(() => setPan((p) => snap(p)), 150);
  };
  // React 的 wheel 监听是被动的，拦不住页面滚动；横向滑动改用原生监听（非被动），并始终调用最新的处理函数
  const gtEl = useRef<HTMLDivElement>(null);
  const wheel = useEffectEvent((e: WheelEvent) => onWheel(e));
  useEffect(() => {
    const el = gtEl.current;
    if (!el) return;
    const h = (e: WheelEvent) => wheel(e);
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
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
  const rangeLabel =
    zoom === 'year' && start.slice(5) === '01-01' && end.slice(0, 4) !== start.slice(0, 4) && end.slice(5) === '01-01'
      ? start.slice(0, 4)
      : `${monthLabel(start.slice(0, 7))} – ${monthLabel(addDays(end, -1).slice(0, 7))}`;
  const x = (d: string) => Math.min(w, Math.max(0, diffDays(start, d) * k));

  // 颜色：按支付方式或地区，固定顺序分配
  const keyOf = (v: Subscription) => (colorBy === 'method' ? (v.methodId ?? 'none') : (v.region ?? '—'));
  const keys = useMemo(() => [...new Set(rows.flatMap((r) => r.segs.map((g) => keyOf(g.v))))], [rows, colorBy]);
  const color = (v: Subscription) => PALETTE[keys.indexOf(keyOf(v)) % PALETTE.length];
  const labelOf = (key: string) =>
    colorBy === 'method' ? (state.methods.find((m) => m.id === key)?.name ?? t('list.unassigned')) : key === '—' ? t('list.gantt.noRegion') : key;

  // 刻度：年份始终标；1 年视图再标每个月
  const ticks: Array<{ d: string; label: string; major: boolean }> = [];
  // 相邻刻度至少隔 40px：窄屏隔月、隔季度甚至只标年份，免得月份文字挤在一起
  const monthPx = k * 30.4;
  const every = [1, 2, 3, 6, 12].find((n) => n >= (zoom === '3y' ? 3 : 1) && monthPx * n >= 40) ?? 12;
  for (let d = `${start.slice(0, 7)}-01`; d <= end; d = addMonths(d, 1)) {
    if (d < start) continue;
    const jan = d.slice(5, 7) === '01';
    const m = Number(d.slice(5, 7)) - 1;
    if (jan || (zoom !== 'all' && m % every === 0)) ticks.push({ d, label: jan ? d.slice(0, 4) : monthLabel(d.slice(0, 7), { year: false }), major: jan });
  }

  return (
    <div className="gantt">
      <div className="gt-bar">
        <Seg
          small
          value={zoom}
          onChange={setZoom}
          options={[
            ['year', t('list.gantt.zoomYear')],
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
        className={`gt ${pannable ? 'pannable' : ''} ${drag ? 'dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="gt-head">
          <div className="gt-label" />
          <div className="gt-track" ref={box}>
            {ticks.map((t) => (
              <span key={t.d} className={`gt-tick ${t.major ? 'major' : ''}`} style={{ left: x(t.d) }}>
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
              <b className="gt-today" style={{ left: x(today) }} />
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
                  <SubIcon sub={r.s} size={20} />
                  <span>{r.s.name}</span>
                </div>
                <div className="gt-track">
                  {r.gaps.map((g) => (
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
                    const left = x(g.from);
                    const top = 8 + r.lanes[gi] * LANE;

                    if (g.to < start || g.from > end) return null;
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
                    const renewals = chargesBetween(g.v, g.from, g.to, today)
                      .filter((c) => c.amount > 0 && c.date > g.from && c.date < g.to)
                      .map((c) => c.date);
                    const perCycle = renewals.length > 1 ? diffDays(renewals[0], renewals[1]) * k : Infinity;
                    const cycleCuts = new Set(perCycle >= CYCLE_MIN_PX ? renewals : []);
                    const cuts = [
                      ...new Set([g.from, ...(g.v.priceHistory ?? []).map((p) => p.from), ...(g.v.intro ? [g.v.intro.until] : []), ...cycleCuts, g.to]),
                    ]
                      .filter((d) => d >= g.from && d <= g.to)
                      .sort();
                    let labeled = '';
                    return cuts.slice(0, -1).map((a, n) => {
                      const b = cuts[n + 1];
                      if (b < start || a > end) return null;
                      const pl = x(a);
                      const pw = Math.max(3, x(b) - pl);
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
                          className={`gt-seg ${g.v.planned ? 'planned' : ''} ${last && g.open ? 'open' : ''} ${n > 0 && !cycleCuts.has(a) ? 'cont' : ''} ${!last && !cycleCuts.has(b) ? 'cut' : ''} ${intro ? 'intro' : ''}`}
                          style={{ left: pl, width: pw, top, '--c': color(g.v), '--now': `${pnow}px` } as Record<string, string | number>}
                          title={ptip || tip}
                        >
                          {n === 0 && g.v.trialEnd && g.v.trialEnd > g.from && <i className="gt-trial" style={{ width: Math.min(pw, x(g.v.trialEnd) - pl) }} />}
                          {label && (
                            <em>
                              {n === 0 && g.v.region ? <FlagImg cc={g.v.region} /> : null}
                              {intro ? t('list.gantt.introShort') : ''}
                              {money(price, g.v.currency, { compact: true })}/{perLabel(g.v)}
                            </em>
                          )}
                        </span>
                      );
                    });
                  })}
                  {charges.map((c, k2) => (
                    <i key={k2} className={`gt-charge ${c.amount < 0 ? 'refund' : ''} ${c.date > today ? 'future' : ''}`} style={{ left: x(c.date) }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="gt-legend">
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
