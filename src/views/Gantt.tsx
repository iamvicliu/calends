import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { addMonths, chargesBetween, diffDays, effectiveStatus, phaseSubs, priceAt } from '../../shared/billing.ts';
import { cnDate, flag, money } from '../../shared/format.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { Seg, SubIcon } from '../components/ui.tsx';
import { perLabel } from './Overview.tsx';

type Zoom = '1y' | '3y' | 'all';
type ColorBy = 'method' | 'region';

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
  gaps: Array<{ from: string; to: string }>;
  first: string;
  last: string;
}

const span = (d: number) => (d >= 60 ? `${Math.round(d / 30.4)} 个月` : `${d} 天`);

/**
 * 时间轴（甘特图）：一行一个订阅，一段一根条。
 * 条按支付方式或地区上色；过去的实心、未来的半透明；计划中的斜线；两段之间空着的是断订；条下的小刻度是每笔扣款。
 */
export function Gantt({ rows: subs, state, today, onOpen }: { rows: Subscription[]; state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const [zoom, setZoom] = useState<Zoom>('3y');
  const [colorBy, setColorBy] = useState<ColorBy>('method');
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      if (before == null) row.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      else if (before !== top) row.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
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
      const gaps = segs.slice(1).flatMap((g, i) => (segs[i].to < g.from ? [{ from: segs[i].to, to: g.from }] : []));
      return { s, segs, gaps, first: segs[0].from, last: segs[segs.length - 1].to };
    });
    // 每个订阅各占一行、互相独立；顺序跟随页面顶部的排序与筛选
    return out;
  }, [subs, today]);

  const end = addMonths(today, zoom === '1y' ? 3 : 6);
  const earliest = rows.reduce((m, r) => (r.first < m ? r.first : m), today);
  const start = zoom === '1y' ? addMonths(today, -9) : zoom === '3y' ? addMonths(today, -30) : `${earliest.slice(0, 7)}-01`;
  const days = Math.max(1, diffDays(start, end));
  const k = w / days;
  const x = (d: string) => Math.min(w, Math.max(0, diffDays(start, d) * k));

  // 颜色：按支付方式或地区，固定顺序分配
  const keyOf = (v: Subscription) => (colorBy === 'method' ? (v.methodId ?? 'none') : (v.region ?? '—'));
  const keys = useMemo(() => [...new Set(rows.flatMap((r) => r.segs.map((g) => keyOf(g.v))))], [rows, colorBy]);
  const color = (v: Subscription) => PALETTE[keys.indexOf(keyOf(v)) % PALETTE.length];
  const labelOf = (key: string) => (colorBy === 'method' ? (state.methods.find((m) => m.id === key)?.name ?? '未指定') : key === '—' ? '未标地区' : `${flag(key)} ${key}`);

  // 刻度：年份始终标；1 年视图再标每个月
  const ticks: Array<{ d: string; label: string; major: boolean }> = [];
  for (let d = `${start.slice(0, 7)}-01`; d <= end; d = addMonths(d, 1)) {
    if (d < start) continue;
    const jan = d.slice(5, 7) === '01';
    if (zoom === '1y' || jan || (zoom === '3y' && ['04', '07', '10'].includes(d.slice(5, 7)))) ticks.push({ d, label: jan ? d.slice(0, 4) : `${Number(d.slice(5, 7))}月`, major: jan });
  }

  return (
    <div class="gantt">
      <div class="gt-bar">
        <Seg small value={zoom} onChange={setZoom} options={[['1y', '1 年'], ['3y', '3 年'], ['all', '全部']]} />
        <Seg small value={colorBy} onChange={setColorBy} options={[['method', '按支付'], ['region', '按地区']]} />
      </div>
      <div class="gt">
        <div class="gt-head">
          <div class="gt-label" />
          <div class="gt-track" ref={box}>
            {ticks.map((t) => (
              <span key={t.d} class={`gt-tick ${t.major ? 'major' : ''}`} style={{ left: x(t.d) }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>
        <div class="gt-body" ref={body}>
          <div class="gt-grid">
            <div class="gt-label" />
            <div class="gt-track">
              {ticks.map((t) => (
                <i key={t.d} class={t.major ? 'major' : ''} style={{ left: x(t.d) }} />
              ))}
              <b class="gt-today" style={{ left: x(today) }} />
            </div>
          </div>
          {rows.map((r) => {
            const charges = w ? chargesBetween(r.s, start, end, today) : [];
            return (
              <div key={r.s.id} data-id={r.s.id} class="gt-row" onClick={() => onOpen(r.s)}>
                <div class="gt-label" title={r.s.name}>
                  <SubIcon sub={r.s} size={20} />
                  <span>{r.s.name}</span>
                </div>
                <div class="gt-track">
                  {r.gaps.map((g) => (
                    <span key={g.from} class="gt-gap" style={{ left: x(g.from), width: Math.max(0, x(g.to) - x(g.from)) }} title={`断订 ${span(diffDays(g.from, g.to))}：${cnDate(g.from)} – ${cnDate(g.to)}`}>
                      {x(g.to) - x(g.from) > 56 && <em>断 {span(diffDays(g.from, g.to))}</em>}
                    </span>
                  ))}
                  {r.segs.map((g) => {
                    const left = x(g.from);

                    if (g.to < start || g.from > end) return null;
                    const lifetime = g.v.cycle.unit === 'lifetime';
                    const tip = `${g.v.region ? `${flag(g.v.region)} ${g.v.region} · ` : ''}${money(g.v.price, g.v.currency)}${lifetime ? ' 买断' : `/${perLabel(g.v)}`} · ${cnDate(g.from)} – ${g.open ? '至今' : cnDate(g.to)}${g.v.planned ? ' · 计划中' : ''}`;
                    if (lifetime) return <span key={g.from} class="gt-lifetime" style={{ left, background: color(g.v) }} title={tip} />;
                    // 段内按调价、首期优惠切成几截，每截标自己的价格
                    const cuts = [...new Set([g.from, ...(g.v.priceHistory ?? []).map((p) => p.from), ...(g.v.intro ? [g.v.intro.until] : []), g.to])]
                      .filter((d) => d >= g.from && d <= g.to)
                      .sort();
                    return cuts.slice(0, -1).map((a, n) => {
                      const b = cuts[n + 1];
                      const pl = x(a);
                      const pw = Math.max(3, x(b) - pl);
                      const intro = g.v.intro && a < g.v.intro.until;
                      const price = priceAt(g.v, a);
                      const last = n === cuts.length - 2;
                      const pnow = Math.min(pw, Math.max(0, x(today) - pl));
                      const ptip = `${intro ? '首期优惠 · ' : ''}${money(price, g.v.currency)}/${perLabel(g.v)} · ${cnDate(a)} – ${last && g.open ? '至今' : cnDate(b)}${g.v.region ? ` · ${flag(g.v.region)} ${g.v.region}` : ''}${g.v.planned ? ' · 计划中' : ''}`;
                      return (
                        <span
                          key={a}
                          class={`gt-seg ${g.v.planned ? 'planned' : ''} ${last && g.open ? 'open' : ''} ${n > 0 ? 'cont' : ''} ${!last ? 'cut' : ''} ${intro ? 'intro' : ''}`}
                          style={{ left: pl, width: pw, '--c': color(g.v), '--now': `${pnow}px` } as Record<string, string | number>}
                          title={ptip || tip}
                        >
                          {n === 0 && g.v.trialEnd && g.v.trialEnd > g.from && <i class="gt-trial" style={{ width: Math.min(pw, x(g.v.trialEnd) - pl) }} />}
                          {pw > 70 && (
                            <em>
                              {n === 0 && g.v.region ? `${flag(g.v.region)} ` : ''}
                              {intro ? '首期 ' : ''}
                              {money(price, g.v.currency, { compact: true })}/{perLabel(g.v)}
                            </em>
                          )}
                        </span>
                      );
                    });
                  })}
                  {charges.map((c, k2) => (
                    <i key={k2} class={`gt-charge ${c.amount < 0 ? 'refund' : ''} ${c.date > today ? 'future' : ''}`} style={{ left: x(c.date) }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div class="gt-legend">
        {keys.map((key, i) => (
          <span key={key}>
            <i style={{ background: PALETTE[i % PALETTE.length] }} />
            {labelOf(key)}
          </span>
        ))}
        <span>
          <i class="lg-planned" />
          计划中
        </span>
        <span>
          <i class="lg-gap" />
          断订
        </span>
      </div>
    </div>
  );
}

/**
 * 详情里的迷你时间轴：只画这一个订阅。每段一根胶囊条（按支付方式上色，调价处切开），断档是虚线，
 * 时间上重叠的段自动分到第二条轨道；下面是年份刻度和每笔扣款。
 */
export function MiniGantt({ sub, state, today }: { sub: Subscription; state: AppState; today: string }) {
  const vs = phaseSubs(sub);
  const segs = vs.map((v) => {
    const st = effectiveStatus(v, today);
    const end = v.end ?? (st === 'ended' ? today : undefined);
    return { v, from: v.start, to: end ?? addMonths(today, 2), open: !end };
  });
  const start = segs[0].from;
  const last = segs.reduce((m, g) => (g.to > m ? g.to : m), today);
  const pad = Math.max(10, Math.round(diffDays(start, last) * 0.03));
  const from = start;
  const to = last;
  const days = Math.max(1, diffDays(from, to) + pad);
  const x = (d: string) => `${(Math.max(0, diffDays(from, d)) / days) * 100}%`;
  const w = (a: string, b: string) => `${(Math.max(0.6, diffDays(a, b)) / days) * 100}%`;
  // 重叠的段放到下一条轨道
  const laneEnd: string[] = [];
  const lanes = segs.map((g) => {
    let l = laneEnd.findIndex((e) => e <= g.from);
    if (l < 0) l = laneEnd.length;
    laneEnd[l] = g.to;
    return l;
  });
  const methodIds = [...new Set(vs.map((v) => v.methodId ?? 'none'))];
  const color = (v: Subscription) => PALETTE[methodIds.indexOf(v.methodId ?? 'none') % PALETTE.length];
  const charges = chargesBetween(sub, from, to, today);
  const years: string[] = [];
  for (let y = Number(from.slice(0, 4)) + 1; `${y}-01-01` <= to; y++) years.push(`${y}-01-01`);
  return (
    <div class="mg" style={{ '--lanes': laneEnd.length } as Record<string, number>}>
      <div class="mg-track">
        {years.map((y) => (
          <i key={y} class="mg-year" style={{ left: x(y) }}>
            <span>{y.slice(0, 4)}</span>
          </i>
        ))}
        <b class="mg-today" style={{ left: x(today) }} />
        {segs.slice(1).map((g, i) => (segs[i].to < g.from && lanes[i] === lanes[i + 1] ? <span key={`gap-${g.from}`} class="mg-gap" style={{ left: x(segs[i].to), width: w(segs[i].to, g.from), top: `${lanes[i] * 22 + 9}px` }} title={`断订 ${diffDays(segs[i].to, g.from)} 天`} /> : null))}
        {segs.map((g, k) => {
            if (g.v.cycle.unit === 'lifetime') return <span key={g.from} class="mg-dot" style={{ left: x(g.from), top: `${lanes[k] * 22 + 3}px`, background: color(g.v) }} title={`买断 ${money(g.v.price, g.v.currency)}`} />;
            const cuts = [...new Set([g.from, ...(g.v.priceHistory ?? []).map((p) => p.from), ...(g.v.intro ? [g.v.intro.until] : []), g.to])].filter((d) => d >= g.from && d <= g.to).sort();
            return cuts.slice(0, -1).map((a, n) => {
              const b = cuts[n + 1];
              const lastCut = n === cuts.length - 2;
              const price = priceAt(g.v, a);
              return (
                <span
                  key={`${g.from}-${a}`}
                  class={`mg-seg ${n > 0 ? 'cont' : ''} ${!lastCut ? 'cut' : ''} ${lastCut && g.open ? 'open' : ''} ${g.v.planned ? 'planned' : ''} ${a > today ? 'future' : ''}`}
                  style={{ left: x(a), width: w(a, b), top: `${lanes[k] * 22}px`, '--c': color(g.v) } as Record<string, string>}
                  title={`${g.v.region ? `${flag(g.v.region)} ${g.v.region} · ` : ''}${money(price, g.v.currency)}/${perLabel(g.v)} · ${cnDate(a)} – ${lastCut && g.open ? '至今' : cnDate(b)}`}
                />
              );
            });
        })}
        {charges.map((c, i) => (
          <i key={i} class={`mg-charge ${c.amount < 0 ? 'refund' : ''} ${c.projected ? 'future' : ''}`} style={{ left: x(c.date) }} />
        ))}
      </div>
      <div class="mg-legend">
        {methodIds.map((id) => (
          <span key={id}>
            <i style={{ background: PALETTE[methodIds.indexOf(id) % PALETTE.length] }} />
            {state.methods.find((m) => m.id === id)?.name ?? '未指定'}
          </span>
        ))}
        <span class="mg-range">
          {cnDate(start)} 起 · {segs.length} 段
        </span>
      </div>
    </div>
  );
}
