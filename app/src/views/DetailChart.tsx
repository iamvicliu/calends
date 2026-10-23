import type { ReactNode } from 'react';
import { useState } from 'react';
import { addMonths, diffDays } from '../../../shared/billing.ts';
import { monthLabel } from '../../../shared/format.ts';
import { useWidth } from '../components/ui.tsx';

export interface ChartPoint {
  date: string;
  v: number;
  /** 标价按这一段首笔的汇率折算，画成虚线：和实线的差就是汇率带来的涨跌 */
  list?: number;
}

export interface ChartLane {
  key: string;
  from: string;
  to: string;
  lane: number;
  color: string;
  label: ReactNode;
  aside?: ReactNode;
}

const PAD_L = 44;
const PAD_R = 14;
const LANE = 24;
/** 曲线区高度与顶部留白 */
const H = 150;
const T = 10;

/** 刻度取 1、2、2.5、5 × 10ⁿ，让 4 格左右正好盖住最大值 */
function niceStep(max: number) {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= raw) ?? 10) * p;
}

/** 单调三次插值（Fritsch–Carlson）：曲线平滑，但不会冲出相邻两点的范围 */
function smooth(pts: Array<[number, number]>) {
  if (pts.length < 3) return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('');
  const n = pts.length;
  const d = pts.slice(1).map(([x, y], i) => (y - pts[i][1]) / (x - pts[i][0] || 1));
  const m = pts.map((_, i) => {
    if (i === 0) return d[0];
    if (i === n - 1) return d[n - 2];
    return d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  });
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  let out = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = (x1 - x0) / 3;
    out += `C${x0 + h},${y0 + m[i] * h} ${x1 - h},${y1 - m[i + 1] * h} ${x1},${y1}`;
  }
  return out;
}

/**
 * 每笔扣款折算后的走势：实线是每笔实际折合，虚线是标价按首笔汇率折合，下面是各段方案的轨道。
 * 悬停（或手指按住拖动）时出现十字线和明细卡片。
 */
export function ChargeChart({
  points,
  fmt,
  lanes,
  tip,
}: {
  points: ChartPoint[];
  fmt: (v: number) => string;
  lanes: ChartLane[];
  tip: (i: number) => ReactNode;
}) {
  const [box, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);

  const from = points[0].date;
  const to = points[points.length - 1].date;
  const span = Math.max(1, diffDays(from, to));
  const iw = Math.max(1, w - PAD_L - PAD_R);
  const x = (d: string) => PAD_L + (Math.min(span, Math.max(0, diffDays(from, d))) / span) * iw;
  const max = Math.max(...points.map((p) => Math.max(p.v, p.list ?? 0))) || 1;
  const step = niceStep(max * 1.08);
  const top = Math.ceil((max * 1.08) / step) * step;
  const y = (v: number) => T + (1 - v / top) * (H - T - 6);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  const pts = points.map((p) => [x(p.date), y(p.v)] as [number, number]);
  const line = smooth(pts);
  const area = `${line}L${pts[pts.length - 1][0]},${H}L${pts[0][0]},${H}Z`;
  // 标价：阶梯线，价格或汇率基准变了才跳
  let list = '';
  points.forEach((p, i) => {
    if (p.list == null) return;
    const px = x(p.date);
    const py = y(p.list);
    const prev = points[i - 1]?.list;
    list += !list || prev == null ? `M${px},${py}` : `L${px},${y(prev)}L${px},${py}`;
  });

  // 月份刻度：间隔按宽度挑，最多约每 90px 一个
  const months = Math.max(1, Math.round(span / 30.44));
  const every = [1, 2, 3, 6, 12, 24, 36].find((m) => (months / m) * 90 <= iw) ?? 48;
  const xt: Array<{ d: string; label: string }> = [];
  for (let d = addMonths(`${from.slice(0, 7)}-01`, 1); d <= to; d = addMonths(d, 1)) {
    const m = Number(d.slice(5, 7)) - 1;
    if (every >= 12 ? m !== 0 || Number(d.slice(0, 4)) % (every / 12) : m % every) continue;
    xt.push({ d, label: m === 0 ? d.slice(0, 4) : monthLabel(d.slice(0, 7), { year: false }) });
  }

  const nLanes = lanes.reduce((m, l) => Math.max(m, l.lane + 1), 0);
  const last = points.length - 1;
  const onMove = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i][0] - px) < Math.abs(pts[best][0] - px)) best = i;
    setHover(best);
  };
  const hx = hover != null ? pts[hover][0] : 0;

  return (
    <div className="cc" ref={box} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
      {w > 0 && (
        <>
          <svg className="cc-plot" width={w} height={H}>
            <defs>
              <linearGradient id="cc-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--chart-ink)" stopOpacity="0.16" />
                <stop offset="1" stopColor="var(--chart-ink)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((v) => (
              <g key={v}>
                <line className="cc-grid" x1={PAD_L} x2={w - PAD_R} y1={y(v)} y2={y(v)} />
                <text className="cc-tk" x={PAD_L - 8} y={y(v) + 3.5} textAnchor="end">
                  {fmt(v)}
                </text>
              </g>
            ))}
            <path d={area} fill="url(#cc-fill)" />
            {list && <path className="cc-list" d={list} />}
            <path className="cc-line" d={line} />
            {points.length <= 40 && pts.map(([px, py], i) => <circle key={i} className="cc-pt" cx={px} cy={py} r={i === last ? 4 : 2.2} />)}
            {hover != null && (
              <>
                <line className="cc-cross" x1={hx} x2={hx} y1={T} y2={H} />
                {points[hover].list != null && <circle className="cc-hl list" cx={hx} cy={y(points[hover].list!)} r={3.5} />}
                <circle className="cc-hl" cx={hx} cy={pts[hover][1]} r={5} />
              </>
            )}
          </svg>
          {nLanes > 0 && (
            <div className="cc-lanes" style={{ height: nLanes * LANE + 4, marginLeft: PAD_L, marginRight: PAD_R }}>
              {lanes.map((l) => {
                const a = Math.max(PAD_L, x(l.from));
                const b = Math.min(w - PAD_R, x(l.to > to ? to : l.to));
                return (
                  <div
                    key={l.key}
                    className="cc-lane"
                    style={{ left: a - PAD_L, width: Math.max(6, b - a), top: l.lane * LANE + 4, '--tint': l.color } as Record<string, string | number>}
                  >
                    {b - a > 56 && <b>{l.label}</b>}
                    {l.aside && b - a > 260 && <span>{l.aside}</span>}
                  </div>
                );
              })}
              {hover != null && <i className="cc-cross-l" style={{ left: hx - PAD_L }} />}
            </div>
          )}
          <div className="cc-xt" style={{ marginLeft: PAD_L, marginRight: PAD_R }}>
            {xt.map((t) => (
              <span key={t.d} style={{ left: x(t.d) - PAD_L }}>
                {t.label}
              </span>
            ))}
          </div>
          {hover != null && (
            <div className="cc-tip" style={hx > w / 2 ? { right: w - hx + 14 } : { left: hx + 14 }}>
              {tip(hover)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
