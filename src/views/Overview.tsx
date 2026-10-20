import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { addDays, addMonths, cycleLabel, diffDays, runwayFor, totals, type Charge } from '../../shared/billing.ts';
import { cnDate, money, relDays } from '../../shared/format.ts';
import { chargeValue } from '../../shared/fx.ts';
import { contributionOn, insights, mrrSeries } from '../../shared/metrics.ts';
import { BALANCE_KINDS, type AppState, type Subscription } from '../../shared/types.ts';
import { Activity, packCircles, type Bucket } from '../components/charts.tsx';
import { Timeline, type TimelineGroup } from '../components/Timeline.tsx';
import { Amount, Icon, MethodMark, Seg, SubIcon, Toolbar } from '../components/ui.tsx';
import { allCharges, catColor, sumBase } from '../derive.ts';
import { perLabel } from './Report.tsx';

type Scale = 'month' | 'year';
const PROJ = '__proj';

export function Overview({ state, today, onOpen, onAdd }: { state: AppState; today: string; onOpen: (s: Subscription) => void; onAdd: () => void }) {
  const base = state.settings.baseCurrency;
  const t = totals(state, today);
  return (
    <>
      <Toolbar title="概览">
        {!state.readonly && (
          <button class="btn primary d-only" onClick={onAdd}>
            <Icon name="plus" /> 新建订阅
          </button>
        )}
      </Toolbar>
      <div class="page fade-in stack" style={{ gap: 20 }}>
        <Statement state={state} today={today} onOpen={onOpen} />
        <ChargeTimeline state={state} today={today} onOpen={onOpen} />
        <Spending state={state} today={today} onOpen={onOpen} />
        <div class="grid g-2">
          <DueSoon state={state} today={today} onOpen={onOpen} />
          <WalletBrief state={state} today={today} />
        </div>
        <Tips state={state} today={today} onOpen={onOpen} />
        <p class="card-note" style={{ textAlign: 'center' }}>
          {t.activeCount} 个订阅计费中 · 每月 {money(t.mrr, base)} ·{' '}
          <a href="/admin/report" style={{ textDecoration: 'underline' }}>
            看完整报告
          </a>
        </p>
      </div>
    </>
  );
}

/** 扣款时间线：今天居中，左右滑动看前后的扣款 */
function ChargeTimeline({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  const { past30, next30 } = useMemo(() => {
    let past30 = 0;
    let next30 = 0;
    for (const c of allCharges(state, addDays(today, -30), addDays(today, 30), today)) {
      const v = chargeValue(state, c);
      if (c.date < today) past30 += v;
      else next30 += v;
    }
    return { past30, next30 };
  }, [state, today]);
  // 时间线按需加载：拖到哪段算哪段
  const load = useCallback(
    (from: string, to: string) => {
      const map = new Map<string, TimelineGroup>();
      for (const c of allCharges(state, from, to, today)) {
        const g = map.get(c.date) ?? { date: c.date, items: [] };
        const real = state.subscriptions.find((x) => x.id === c.sub.id) ?? c.sub;
        g.items.push({ key: `${c.sub.id}-${c.date}`, icon: <SubIcon sub={c.sub} size={30} />, tip: `${c.sub.name} · ${money(c.amount, c.currency)}`, onClick: () => onOpen(real) });
        map.set(c.date, g);
      }
      return [...map.values()];
    },
    [state, today],
  );
  return (
    <section class="card">
      <div class="row tl-head" style={{ justifyContent: 'space-between', marginBottom: 6, paddingRight: 64 }}>
        <h3 class="sec-title">时间线</h3>
        <span class="sec-sub" style={{ marginTop: 0 }}>
          过去 30 天扣了 {money(past30, base, { compact: true })} · 接下来 30 天要扣 {money(next30, base, { compact: true })}
        </span>
      </div>
      <Timeline load={load} today={today} />
    </section>
  );
}

/** 主图：每月 / 每年花了多少，按分类堆叠 */
export function Spending({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  const [scale, setScale] = useState<Scale>('month');
  const [hidden, setHidden] = useState<string[]>([]);
  const [selKey, setSelKey] = useState<string | undefined>();
  const first = state.subscriptions.reduce((m, s) => (s.start < m ? s.start : m), today);

  const ranges = useMemo(() => {
    const out: Array<{ key: string; label: string; from: string; to: string }> = [];
    if (scale === 'month') {
      for (let i = -11; i <= 6; i++) {
        const m = addMonths(today.slice(0, 8) + '01', i);
        out.push({ key: m.slice(0, 7), label: i === 0 || m.endsWith('-01-01') ? `${m.slice(2, 4)}/${Number(m.slice(5, 7))}` : `${Number(m.slice(5, 7))}月`, from: m, to: addDays(addMonths(m, 1), -1) });
      }
    } else {
      for (let yy = Number(first.slice(0, 4)); yy <= Number(today.slice(0, 4)) + 1; yy++) out.push({ key: String(yy), label: String(yy), from: `${yy}-01-01`, to: `${yy}-12-31` });
    }
    return out;
  }, [scale, today, first]);

  const data = useMemo(
    () =>
      ranges.map((r) => {
        const cs = allCharges(state, r.from, r.to, today).filter((c) => !hidden.includes(c.sub.category));
        return { r, cs };
      }),
    [state, ranges, hidden, today],
  );

  const curKey = scale === 'month' ? today.slice(0, 7) : today.slice(0, 4);
  const buckets: Bucket[] = data.map(({ r, cs }) => {
    const parts = new Map<string, number>();
    for (const c of cs) {
      const k = c.projected && r.key === curKey ? PROJ : c.sub.category;
      parts.set(k, (parts.get(k) ?? 0) + chargeValue(state, c));
    }
    const arr = [...parts.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => (a.k === PROJ ? 1 : b.k === PROJ ? -1 : b.v - a.v));
    return { key: r.key, label: r.label, parts: arr, total: arr.reduce((a, p) => a + p.v, 0), future: r.key > curKey, current: r.key === curKey };
  });

  const sel = selKey && buckets.some((b) => b.key === selKey) ? selKey : curKey;
  const selData = data.find((d) => d.r.key === sel);
  const selTotal = selData ? sumBase(state, selData.cs) : 0;
  const selPaid = selData ? sumBase(state, selData.cs.filter((c) => !c.projected)) : 0;
  const bySub = new Map<string, { sub: Subscription; v: number; n: number; proj: boolean }>();
  for (const c of selData?.cs ?? []) {
    const e = bySub.get(c.sub.id) ?? { sub: c.sub, v: 0, n: 0, proj: true };
    e.v += chargeValue(state, c);
    e.n++;
    e.proj = e.proj && c.projected;
    bySub.set(c.sub.id, e);
  }
  const items = [...bySub.values()].sort((a, b) => b.v - a.v);

  // 图例：所选区间（全部柱子）里各分类的合计
  const catTotals = new Map<string, number>();
  for (const { cs } of allRanges(state, ranges, today)) for (const c of cs) catTotals.set(c.sub.category, (catTotals.get(c.sub.category) ?? 0) + chargeValue(state, c));
  const cats = [...catTotals.entries()].sort((a, b) => b[1] - a[1]);
  const selLabel = scale === 'month' ? `${sel.slice(0, 4)}年${Number(sel.slice(5))}月` : `${sel}年`;
  const isFuture = sel > curKey;

  return (
    <div class="card" style={{ padding: '22px 24px 20px' }}>
      <div class="ov-head">
        <div>
          <h3 class="sec-title">每月花了多少</h3>
          <div class="sec-sub">浅色为预计</div>
        </div>
        <Seg
          value={scale}
          onChange={(v) => {
            setScale(v);
            setSelKey(undefined);
          }}
          options={[
            ['month', '按月'],
            ['year', '按年'],
          ]}
        />
      </div>

      <Activity
        buckets={buckets}
        color={(k) => (k === PROJ ? 'color-mix(in srgb, var(--label-3) 45%, transparent)' : catColor(k))}
        selected={selKey ? sel : undefined}
        current={sel}
        onSelect={(k) => setSelKey(k === selKey ? undefined : k)}
        fmt={(v) => (v >= 10000 ? `${(v / 1000).toFixed(0)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))}
      />

      <div class="legend-chips">
        {cats.map(([k, v]) => (
          <button key={k} class={`lc ${hidden.includes(k) ? 'off' : ''}`} onClick={() => setHidden(hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k])}>
            <i style={{ background: catColor(k) }} />
            {k}
            <b>{money(v, base, { compact: true })}</b>
          </button>
        ))}
      </div>

      <div class="sel-box">
        <div>
          <h4>
            {selLabel}
            {isFuture ? ' · 预计' : sel === curKey ? ' · 进行中' : ''}
          </h4>
          <div class="big">
            <Amount value={selTotal} ccy={base} />
          </div>
          <div class="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
            {items.length} 个订阅 · {selData?.cs.length ?? 0} 笔
            {sel === curKey && selTotal > selPaid ? ` · 已付 ${money(selPaid, base, { compact: true })}` : ''}
          </div>
        </div>
        <div class="sel-items">
          {items.length === 0 && <span class="muted" style={{ fontSize: 13 }}>这段时间没有扣款</span>}
          {items.slice(0, 12).map((e) => (
            <button key={e.sub.id} class="sel-item" onClick={() => onOpen(e.sub)}>
              <SubIcon sub={e.sub} size={22} />
              <span class="si-name" style={{ opacity: e.proj && !isFuture ? 0.6 : 1 }}>
                {e.sub.name}
                {e.n > 1 ? ` ×${e.n}` : ''}
              </span>
              <b>{money(e.v, base, { compact: true })}</b>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function allRanges(state: AppState, ranges: Array<{ from: string; to: string }>, today: string): Array<{ cs: Charge[] }> {
  if (!ranges.length) return [];
  return [{ cs: allCharges(state, ranges[0].from, ranges[ranges.length - 1].to, today) }];
}

/** 接下来 30 天 */
function DueSoon({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  const cs = allCharges(state, today, addDays(today, 30), today);
  const total = sumBase(state, cs);
  const groups: Array<[string, Charge[]]> = [
    ['这周', cs.filter((c) => diffDays(today, c.date) <= 6)],
    ['之后', cs.filter((c) => diffDays(today, c.date) > 6)],
  ];
  return (
    <div class="card">
      <div class="card-h">
        <h3>接下来 30 天</h3>
        <span class="meta">
          {cs.length} 笔 · {money(total, base, { compact: true })}
        </span>
      </div>
      {cs.length === 0 && <div class="empty">30 天内没有扣款</div>}
      <div class="due-list">
        {groups
          .filter(([, l]) => l.length)
          .map(([g, list]) => (
            <>
              <div class="due-g">{g}</div>
              {list.slice(0, g === '这周' ? 10 : 6).map((c) => {
                const d = diffDays(today, c.date);
                const m = state.methods.find((x) => x.id === c.sub.methodId);
                return (
                  <button key={c.sub.id + c.date} class="due-row" onClick={() => onOpen(c.sub)}>
                    <SubIcon sub={c.sub} size={36} />
                    <span class="nm">
                      <b>{c.sub.name}</b>
                      <small>
                        {m?.name ?? '未指定支付'} · {cycleLabel(c.sub.cycle)}
                      </small>
                    </span>
                    <span class="am">
                      <b>
                        <Amount value={c.amount} ccy={c.currency} />
                      </b>
                      {c.currency !== base && <small>≈ {money(chargeValue(state, c), base, { compact: true })}</small>}
                    </span>
                    <span class={`pill ${d <= 3 ? 'hot' : ''}`}>{d <= 13 ? relDays(d) : cnDate(c.date)}</span>
                  </button>
                );
              })}
            </>
          ))}
      </div>
    </div>
  );
}

/** 钱包小结：余额账户还能撑多久 */
function WalletBrief({ state, today }: { state: AppState; today: string }) {
  const rows = state.methods
    .filter((m) => BALANCE_KINDS.includes(m.kind) && state.subscriptions.some((s) => s.methodId === m.id))
    .map((m) => ({ m, r: runwayFor(m, state, today) }));
  const cards = state.methods.filter((m) => !BALANCE_KINDS.includes(m.kind));
  return (
    <div class="card">
      <div class="card-h">
        <h3>钱包</h3>
        <a class="btn plain" href="/admin/wallet">
          管理
        </a>
      </div>
      {rows.map(({ m, r }) => {
        const days = r?.runsOutOn ? diffDays(today, r.runsOutOn) : undefined;
        const pct = r ? (r.monthlyDrain <= 0 ? 100 : Math.min(100, ((days ?? 365) / 365) * 100)) : 0;
        return (
          <a key={m.id} class="wal-row" href="/admin/wallet">
            <MethodMark m={m} size={28} />
            <span class="nm">
              <b>{m.name}</b>
              {r ? (
                <>
                  <small>
                    余额 {money(r.current, m.currency, { compact: true })} ·{' '}
                    {r.shortfall ? (r.coveredCharges ? `还能扣 ${r.coveredCharges} 期，${cnDate(r.shortfall.date)} 前要充值` : `${cnDate(r.shortfall.date)} 前必须充值`) : '3 年内够用'}
                  </small>
                  <div class="wal-bar">
                    <i class={days != null && days <= 7 ? 'out' : days != null && days <= 30 ? 'low' : ''} style={{ width: `${Math.max(3, pct)}%` }} />
                  </div>
                </>
              ) : (
                <small style={{ color: 'var(--orange)' }}>还没填余额，填了才能算出还能撑多久</small>
              )}
            </span>
          </a>
        );
      })}
      {cards.length > 0 && (
        <div class="muted" style={{ fontSize: 12.5, marginTop: rows.length ? 12 : 0 }}>
          另有 {cards.map((m) => m.name).join('、')}
        </div>
      )}
    </div>
  );
}

/** 三条最值得看的洞察 */
function Tips({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const list = useMemo(() => insights(state, today), [state, today]);
  const order = { warn: 0, info: 1, good: 2 } as const;
  const top = [...list].sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 3);
  if (!top.length) return null;
  const label = { warn: '需要留意', info: '提示', good: '一个事实' } as const;
  return (
    <div class="tips">
      {top.map((i) => (
        <div key={i.id} class={`tip-card ${i.tone}`}>
          <span class="k">
            <i />
            {label[i.tone]}
          </span>
          <b>{i.title}</b>
          <p>{i.body}</p>
          {i.subs && i.subs.length > 0 && (
            <div class="ins-subs">
              {i.subs.slice(0, 7).map((s) => (
                <button key={s.id} onClick={() => onOpen(s)} title={s.name}>
                  <SubIcon sub={s} size={22} />
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export { perLabel };

/** 账单头：深色底，左边负 MRR，右边订阅星图（圆的面积 = 每月成本） */
export function Statement({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  const t = totals(state, today);
  const series = useMemo(() => mrrSeries(state, today, 24, true), [state, today]);
  const prev = series[series.length - 2]?.mrr ?? 0;
  const delta = t.mrr - prev;
  const ytd = useMemo(() => sumBase(state, allCharges(state, `${today.slice(0, 4)}-01-01`, today, today)), [state, today]);
  const live = useMemo(
    () =>
      state.subscriptions
        .map((s) => ({ s, v: contributionOn(state, s, today) }))
        .filter((x) => x.v > 0)
        .sort((a, b) => b.v - a.v),
    [state, today],
  );
  const bubbles = useMemo(() => packCircles(live.map((x) => x.v)) as Array<{ x: number; y: number; r: number; i: number; h: number }>, [live]);
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const h = bubbles[0]?.h ?? 1;
  const max = Math.max(1, ...series.map((p) => p.mrr));
  const path = series.map((p, i) => `${i ? 'L' : 'M'}${((i / (series.length - 1)) * 100).toFixed(2)},${(30 - (p.mrr / max) * 28).toFixed(2)}`).join('');
  const [hover, setHover] = useState<number | null>(null);
  const hv = hover != null ? live[hover] : undefined;

  return (
    <section class="stmt">
      <div class="stmt-l">
        <div class="stmt-kicker">每月订阅支出</div>
        <div class="stmt-num">
          <Amount value={-t.mrr} ccy={base} />
        </div>
        <div class="stmt-delta">
          <span class={delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : ''}>
            {delta > 0.5 ? '↑' : delta < -0.5 ? '↓' : '·'} {money(Math.abs(delta), base, { compact: true })}
          </span>
          较上月末
        </div>
        <svg class="stmt-spark" viewBox="0 0 100 32" preserveAspectRatio="none">
          <path d={`${path}L100,32L0,32Z`} fill="url(#stmt-g)" />
          <path d={path} fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke" />
          <defs>
            <linearGradient id="stmt-g" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color="currentColor" stop-opacity="0.25" />
              <stop offset="1" stop-color="currentColor" stop-opacity="0" />
            </linearGradient>
          </defs>
        </svg>
        <div class="stmt-facts">
          <div>
            <b>{money(t.mrr * 12, base, { compact: true })}</b>
            <span>年化</span>
          </div>
          <div>
            <b>{money(ytd, base, { compact: true })}</b>
            <span>{today.slice(0, 4)} 已付</span>
          </div>
          <div>
            <b>{money(t.mrr / 30.4375, base)}</b>
            <span>每天</span>
          </div>
          <div>
            <b>{t.activeCount}</b>
            <span>计费中</span>
          </div>
        </div>
      </div>
      <div class="stmt-r">
        <div class="stmt-cap">
          {hv ? (
            <>
              <b>{hv.s.name}</b> · {money(hv.v, base, { compact: true })}/月 · 占 {Math.round((hv.v / t.mrr) * 100)}%
            </>
          ) : (
            <>订阅星图 · 圆的大小按每月金额比例</>
          )}
        </div>
        <div class="stars" ref={box} style={{ aspectRatio: `${1 / h}` }}>
          {w > 0 &&
            bubbles.map((b, k) => {
              const { s, v } = live[b.i];
              const d = b.r * 2 * w;
              return (
                <button
                  key={s.id}
                  class={`star ${hover === b.i ? 'on' : ''}`}
                  style={{ left: `${(b.x - b.r) * 100}%`, top: `${((b.y - b.r) / h) * 100}%`, width: d, height: d, '--tint': catColor(s.category), animationDelay: `${k * 35}ms` } as Record<string, string | number>}
                  onMouseEnter={() => setHover(b.i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onOpen(s)}
                  aria-label={`${s.name} 每月 ${money(v, base)}`}
                >
                  <SubIcon sub={s} size={Math.max(12, Math.round(d * 0.5))} />
                  {d > 86 && <span class="star-amt">{money(v, base, { compact: true })}</span>}
                </button>
              );
            })}
        </div>
      </div>
    </section>
  );
}
