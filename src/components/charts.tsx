import type { ComponentChildren } from 'preact';
import { tipProps } from './ui.tsx';

/** 面积折线图：SVG 只画形状，文字用 HTML 叠加，避免被拉伸 */
export function AreaChart({ values, labels, height = 160, tip, markers }: { values: number[]; labels: string[]; height?: number; tip: (i: number) => ComponentChildren; markers?: number[] }) {
  const W = 1000;
  const max = Math.max(1, ...values) * 1.12;
  const n = values.length;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => height - (v / max) * height;
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line}L${W},${height}L0,${height}Z`;
  const step = Math.max(1, Math.ceil(n / 8));
  return (
    <div class="area" style={{ height: height + 22 }}>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ height }}>
        <defs>
          <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--accent)" stop-opacity="0.28" />
            <stop offset="1" stop-color="var(--accent)" stop-opacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={height * f} y2={height * f} stroke="var(--sep)" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="3 4" />
        ))}
        <path d={area} fill="url(#area-fill)" />
        <path d={line} fill="none" stroke="var(--accent)" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
      </svg>
      {markers?.map((i) => (
        <i key={i} class="area-mark" style={{ left: `${(x(i) / W) * 100}%`, top: y(values[i]) }} />
      ))}
      <i class="area-end" style={{ left: '100%', top: y(values[n - 1]) }} />
      <div class="area-hit">
        {values.map((_, i) => (
          <span key={i} {...tipProps(() => tip(i))} />
        ))}
      </div>
      <div class="area-x">
        {labels.map((l, i) =>
          i % step === 0 || i === n - 1 ? (
            <span key={i} style={{ left: `${(x(i) / W) * 100}%` }}>
              {l}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

/** 柱 + 线：柱为现金，线为权责 */
export function BarLine({ bars, line, labels, future, height = 150, tip }: { bars: number[]; line: number[]; labels: string[]; future: boolean[]; height?: number; tip: (i: number) => ComponentChildren }) {
  const max = Math.max(1, ...bars, ...line) * 1.08;
  const n = bars.length;
  const W = 1000;
  const cx = (i: number) => ((i + 0.5) / n) * W;
  const path = line.map((v, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`).join('');
  const step = Math.max(1, Math.ceil(n / 12));
  return (
    <div class="barline" style={{ height: height + 22 }}>
      <div class="bl-bars" style={{ height }}>
        {bars.map((v, i) => (
          <div key={i} class={`bl-col ${future[i] ? 'future' : ''}`} {...tipProps(() => tip(i))}>
            <i style={{ height: `${(v / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ height }} class="bl-line">
        <path d={path} fill="none" stroke="var(--orange)" stroke-width="2.4" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" />
      </svg>
      <div class="area-x">
        {labels.map((l, i) =>
          i % step === 0 ? (
            <span key={i} style={{ left: `${(cx(i) / W) * 100}%` }}>
              {l}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  i: number;
}

/** Squarified treemap（Bruls et al.），坐标为百分比 */
export function squarify(values: number[], x = 0, y = 0, w = 100, h = 100): Rect[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const items = values.map((v, i) => ({ v: (v / total) * w * h, i })).filter((t) => t.v > 0).sort((a, b) => b.v - a.v);
  const out: Rect[] = [];
  const worst = (row: number[], side: number) => {
    const s = row.reduce((a, b) => a + b, 0);
    const mx = Math.max(...row);
    const mn = Math.min(...row);
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  let rect = { x, y, w, h };
  let row: typeof items = [];
  const layout = (r: typeof items) => {
    const s = r.reduce((a, b) => a + b.v, 0);
    if (rect.w >= rect.h) {
      const cw = s / rect.h;
      let cy = rect.y;
      for (const t of r) {
        const ch = t.v / cw;
        out.push({ x: rect.x, y: cy, w: cw, h: ch, i: t.i });
        cy += ch;
      }
      rect = { x: rect.x + cw, y: rect.y, w: rect.w - cw, h: rect.h };
    } else {
      const ch = s / rect.w;
      let cx = rect.x;
      for (const t of r) {
        const cw = t.v / ch;
        out.push({ x: cx, y: rect.y, w: cw, h: ch, i: t.i });
        cx += cw;
      }
      rect = { x: rect.x, y: rect.y + ch, w: rect.w, h: rect.h - ch };
    }
  };
  for (const t of items) {
    const side = Math.min(rect.w, rect.h);
    if (!row.length || worst([...row.map((r) => r.v), t.v], side) <= worst(row.map((r) => r.v), side)) row.push(t);
    else {
      layout(row);
      row = [t];
    }
  }
  if (row.length) layout(row);
  return out;
}

/** 取整齐的刻度：1 / 2 / 2.5 / 5 × 10^n */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export interface Bucket {
  key: string;
  label: string;
  parts: Array<{ k: string; v: number }>;
  total: number;
  future: boolean;
  current: boolean;
}

/** 堆叠柱状图：有刻度、可选中，未来为斜纹 */
export function Activity({ buckets, color, selected, current, onSelect, height = 220, fmt }: { buckets: Bucket[]; color: (k: string) => string; selected?: string; current?: string; onSelect: (k: string) => void; height?: number; fmt: (v: number) => string }) {
  const ticks = niceTicks(Math.max(1, ...buckets.map((b) => b.total)));
  const top = ticks[ticks.length - 1];
  return (
    <div class="act" style={{ '--h': `${height}px` } as Record<string, string>}>
      <div class="act-grid">
        {ticks.map((t) => (
          <div key={t} class="act-tick" style={{ bottom: `${(t / top) * 100}%` }}>
            <span>{fmt(t)}</span>
          </div>
        ))}
      </div>
      <div class="act-bars">
        {buckets.map((b, i) => (
          <button key={b.key} class={`act-col ${(buckets.length - 1 - i) % 2 ? 'odd' : ''} ${b.future ? 'future' : ''} ${b.current ? 'current' : ''} ${(selected ?? current) === b.key ? 'sel' : ''} ${selected && selected !== b.key ? 'dim' : ''}`} onClick={() => onSelect(b.key)} aria-label={`${b.label} ${fmt(b.total)}`}>
            <div class="act-stack" style={{ height: `${(b.total / top) * 100}%` }}>
              {b.parts.map((p) => (
                <i key={p.k} style={{ flexGrow: p.v, background: color(p.k) }} />
              ))}
            </div>
            <span class="act-label">{b.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export interface Bubble {
  x: number;
  y: number;
  r: number;
  i: number;
}

/**
 * 圆堆积：面积 ∝ 数值。最大的放中心，之后每个圆贴着已有的圆找离中心最近、且不重叠的位置。
 * 返回的坐标已归一化到 [0, 1] 的正方形里。
 */
export function packCircles(values: number[], aspect = 1.6): Bubble[] {
  const order = values.map((v, i) => ({ v, i })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  const placed: Bubble[] = [];
  const top = Math.sqrt(order[0]?.v ?? 1);
  // 面积 ∝ 数值，但给小圆一个下限，保证图标看得清；大小顺序不变
  const radius = (v: number) => Math.max(Math.sqrt(v), top * 0.2);
  const gap = top * 0.04;
  for (const { v, i } of order) {
    const r = radius(v);
    if (!placed.length) {
      placed.push({ x: 0, y: 0, r, i });
      continue;
    }
    let best: Bubble | undefined;
    let bestD = Infinity;
    for (const p of placed) {
      for (let a = 0; a < 360; a += 10) {
        const t = (a * Math.PI) / 180;
        const d = p.r + r + gap;
        const x = p.x + Math.cos(t) * d;
        const y = p.y + Math.sin(t) * d;
        if (placed.some((q) => Math.hypot(q.x - x, q.y - y) < q.r + r + gap - 1e-6)) continue;
        // 以椭圆距离衡量离中心远近，整体铺成横向的椭圆团
        const dc = Math.hypot(x / aspect, y) + r * 0.3;
        if (dc < bestD) {
          bestD = dc;
          best = { x, y, r, i };
        }
      }
    }
    placed.push(best!);
  }
  if (!placed.length) return [];
  const minX = Math.min(...placed.map((p) => p.x - p.r));
  const maxX = Math.max(...placed.map((p) => p.x + p.r));
  const minY = Math.min(...placed.map((p) => p.y - p.r));
  const maxY = Math.max(...placed.map((p) => p.y + p.r));
  const w = maxX - minX;
  const h = maxY - minY;
  return placed.map((p) => ({ i: p.i, r: p.r / w, x: (p.x - minX) / w, y: (p.y - minY) / w, h: h / w } as Bubble & { h: number }));
}
