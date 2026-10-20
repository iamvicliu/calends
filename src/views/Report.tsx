import { Fragment } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { addDays, addMonths, cycleDays, cycleLabel, diffDays, totals } from '../../shared/billing.ts';
import { cnDate, money } from '../../shared/format.ts';
import { cancelSavings, cashVsAccrual, contributionOn, events, insights, monthEnd, movement, mrrSeries, prepaidValue, topUpPlan, type EventKind } from '../../shared/metrics.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { AreaChart, BarLine, squarify } from '../components/charts.tsx';
import { Amount, Icon, MethodMark, Seg, SubIcon, tipProps, Toolbar } from '../components/ui.tsx';
import { allCharges, catColor, KIND_BG, sumBase, toBase } from '../derive.ts';

const PER: Record<string, string> = { day: '天', week: '周', month: '月', year: '年' };
export function perLabel(s: Subscription): string {
  if (s.cycle.unit === 'lifetime') return '买断';
  return s.cycle.every === 1 ? PER[s.cycle.unit] : cycleLabel(s.cycle).replace('每', '');
}

const mLabel = (m: string) => (m.endsWith('-01') ? `${m.slice(2, 4)}年` : `${Number(m.slice(5))}月`);

export function Report({ state, today, onOpen, onReview }: { state: AppState; today: string; onOpen: (s: Subscription) => void; onReview: () => void }) {
  const base = state.settings.baseCurrency;
  const y = Number(today.slice(0, 4));
  return (
    <>
      <Toolbar title="报告">
        <button class="btn" onClick={onReview}>
          <Icon name="share" /> 分享 {y} 年度回顾
        </button>
      </Toolbar>
      <div class="page fade-in stack">
        <Hero state={state} today={today} />
        <div class="grid g-2">
          <Waterfall state={state} today={today} onOpen={onOpen} />
          <Checkup state={state} today={today} onOpen={onOpen} />
        </div>
        <CashCard state={state} today={today} />
        <Composition state={state} today={today} onOpen={onOpen} />
        <div class="grid g-2">
          <TopUps state={state} today={today} />
          <Changelog state={state} today={today} onOpen={onOpen} base={base} />
        </div>
      </div>
    </>
  );
}

/** 头部：负 MRR + 历史走势 */
function Hero({ state, today }: { state: AppState; today: string }) {
  const base = state.settings.baseCurrency;
  const [range, setRange] = useState<'12' | '36' | 'all'>('36');
  const [hist, setHist] = useState(true);
  const first = state.subscriptions.reduce((m, s) => (s.start < m ? s.start : m), today);
  const allMonths = Math.max(2, diffDays(first.slice(0, 8) + '01', today) / 30.4375 + 1);
  const months = range === 'all' ? Math.ceil(allMonths) : Number(range);
  const series = useMemo(() => mrrSeries(state, today, months, hist), [state, today, months, hist]);
  const t = totals(state, today);
  const now = series[series.length - 1].mrr;
  const lastMonth = mrrOnMonthEnd(state, today, -1);
  const yearAgo = series.length > 12 ? series[series.length - 13].mrr : undefined;
  const delta = now - lastMonth;
  const evDates = new Set(events(state, today).filter((e) => e.kind !== 'buy').map((e) => e.date.slice(0, 7)));
  const markers = series.map((p, i) => (evDates.has(p.month) ? i : -1)).filter((i) => i >= 0);
  return (
    <div class="card hero-card">
      <div class="hero-l">
        <div class="stat-label">每月订阅支出 · 负 MRR</div>
        <div class="hero-num">
          <Amount value={-now} ccy={base} />
        </div>
        <div class="hero-delta">
          <span class={`chip-d ${delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : ''}`}>
            {delta > 0.5 ? '▲' : delta < -0.5 ? '▼' : '—'} {money(Math.abs(delta), base, { compact: true })}
          </span>
          <span class="muted">较上月末</span>
          {yearAgo != null && yearAgo > 0 && <span class="muted">· 一年前 {money(yearAgo, base, { compact: true })}</span>}
        </div>
        <div class="hero-facts">
          <div>
            <b>{money(now * 12, base, { compact: true })}</b>
            <span>年化</span>
          </div>
          <div>
            <b>{money(now / 30.4375, base)}</b>
            <span>每天</span>
          </div>
          <div>
            <b>{t.activeCount}</b>
            <span>计费中</span>
          </div>
          {t.recoverMrr > 1 && (
            <div>
              <b>{money(t.recoverMrr, base, { compact: true })}</b>
              <span>合租回血/月</span>
            </div>
          )}
        </div>
      </div>
      <div class="hero-r">
        <div class="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <Seg
            small
            value={hist ? 'h' : 'c'}
            onChange={(v) => setHist(v === 'h')}
            options={[
              ['h', '当时汇率'],
              ['c', '今天汇率'],
            ]}
          />
          <Seg
            small
            value={range}
            onChange={setRange}
            options={[
              ['12', '1 年'],
              ['36', '3 年'],
              ['all', '全部'],
            ]}
          />
        </div>
        <AreaChart
          values={series.map((p) => p.mrr)}
          labels={series.map((p) => mLabel(p.month))}
          markers={markers}
          tip={(i) => (
            <>
              <b>{series[i].month}</b> · {money(series[i].mrr, base, { compact: true })}/月
            </>
          )}
        />
      </div>
    </div>
  );
}

function mrrOnMonthEnd(state: AppState, today: string, offset: number): number {
  const m = addMonths(today.slice(0, 8) + '01', offset).slice(0, 7);
  return state.subscriptions.reduce((a, s) => a + contributionOn(state, s, monthEnd(m)), 0);
}

/** 月度变动瀑布：上月末 → 新增 → 涨价 → 降价 → 退订 → 本月 */
function Waterfall({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  const [offset, setOffset] = useState(0);
  const month = addMonths(today.slice(0, 8) + '01', offset).slice(0, 7);
  const end = offset === 0 ? today : monthEnd(month);
  const mv = useMemo(() => movement(state, addDays(month + '-01', -1), end, offset === 0 ? undefined : end), [state, month, end, offset]);
  const steps = [
    { k: '上月末', v: mv.from, kind: 'total' },
    { k: '汇率', v: mv.fx, kind: mv.fx >= 0 ? 'up' : 'down' },
    { k: '新增', v: mv.added, kind: 'up' },
    { k: '涨价', v: mv.expansion, kind: 'up' },
    { k: '降价', v: -mv.contraction, kind: 'down' },
    { k: '退订', v: -mv.churned, kind: 'down' },
    { k: offset === 0 ? '现在' : '月末', v: mv.to, kind: 'total' },
  ];
  const max = Math.max(1, mv.from + Math.max(0, mv.fx) + mv.added + mv.expansion, mv.to, mv.from);
  let run = 0;
  const kindLabel = { added: '新增', expansion: '涨价', contraction: '降价', churned: '退订' } as const;
  return (
    <div class="card">
      <div class="card-h">
        <h3>{Number(month.slice(5))}月变动</h3>
        <div class="row" style={{ gap: 4 }}>
          <button class="icon-btn" aria-label="上个月" onClick={() => setOffset(offset - 1)}>
            <Icon name="left" />
          </button>
          <button class="icon-btn" aria-label="下个月" disabled={offset >= 0} style={{ opacity: offset >= 0 ? 0.35 : 1 }} onClick={() => setOffset(Math.min(0, offset + 1))}>
            <Icon name="right" />
          </button>
        </div>
      </div>
      <div class="wf">
        {steps.map((s) => {
          let bottom = 0;
          let h = 0;
          if (s.kind === 'total') {
            h = s.v;
            run = s.v;
          } else if (s.v >= 0) {
            bottom = run;
            h = s.v;
            run += s.v;
          } else {
            run += s.v;
            bottom = run;
            h = -s.v;
          }
          return (
            <div key={s.k} class={`wf-col ${s.kind}`} {...tipProps(() => `${s.k} ${s.kind === 'total' ? '' : s.v >= 0 ? '+' : '−'}${money(Math.abs(s.v), base)}/月`)}>
              <div class="wf-track">
                <i style={{ bottom: `${(bottom / max) * 100}%`, height: `max(${h > 0 ? 3 : 1}px, ${(h / max) * 100}%)` }} />
              </div>
              <b class="num">
                {s.kind === 'total' ? '' : s.v >= 0 ? '+' : '−'}
                {Math.abs(s.v) >= 1000 ? `${(Math.abs(s.v) / 1000).toFixed(1)}k` : Math.round(Math.abs(s.v))}
              </b>
              <span>{s.k}</span>
            </div>
          );
        })}
      </div>
      <div class="wf-items">
        {mv.items.length === 0 && <div class="muted" style={{ fontSize: 13, padding: '8px 0' }}>这个月没有新增、退订或调价{Math.abs(mv.fx) >= 0.5 ? `，变化全部来自汇率（${mv.fx > 0 ? '+' : '−'}${money(Math.abs(mv.fx), base, { compact: true })}）` : ''}。</div>}
        {mv.items.slice(0, 4).map((it) => (
          <button key={it.sub.id} class="wf-item" onClick={() => onOpen(it.sub)}>
            <SubIcon sub={it.sub} size={24} />
            <span class="wf-name">{it.sub.name}</span>
            <em class={it.delta > 0 ? 'up' : 'down'}>{kindLabel[it.kind]}</em>
            <b class="num">
              {it.delta > 0 ? '+' : '−'}
              {money(Math.abs(it.delta), base, { compact: true })}
            </b>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 体检：规则驱动的提醒与洞察 */
function Checkup({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const list = useMemo(() => insights(state, today), [state, today]);
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 5);
  return (
    <div class="card">
      <div class="card-h">
        <h3>体检</h3>
        <span class="meta">{list.filter((i) => i.tone === 'warn').length} 项需要留意</span>
      </div>
      <div class="insights">
        {shown.map((i) => (
          <div key={i.id} class={`insight ${i.tone}`}>
            <i class="dot" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div class="ins-t">{i.title}</div>
              <div class="ins-b">{i.body}</div>
              {i.subs && i.subs.length > 0 && (
                <div class="ins-subs">
                  {i.subs.slice(0, 6).map((s) => (
                    <button key={s.id} onClick={() => onOpen(s)} title={s.name}>
                      <SubIcon sub={s} size={22} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            {i.href && (
              <a class="btn plain" href={i.href}>
                处理
              </a>
            )}
          </div>
        ))}
      </div>
      {list.length > 5 && (
        <button class="btn plain" style={{ marginTop: 6 }} onClick={() => setAll(!all)}>
          {all ? '收起' : `再看 ${list.length - 5} 项`}
        </button>
      )}
    </div>
  );
}

/** 现金 vs 权责 + 预付余值 + 退订省下 */
function CashCard({ state, today }: { state: AppState; today: string }) {
  const base = state.settings.baseCurrency;
  const rows = useMemo(() => cashVsAccrual(state, today, 23, 12), [state, today]);
  const pv = useMemo(() => prepaidValue(state, today), [state, today]);
  const sv = useMemo(() => cancelSavings(state, today), [state, today]);
  const next90 = sumBase(state, allCharges(state, addDays(today, 1), addDays(today, 90), today));
  const peak = rows.filter((r) => r.projected).sort((a, b) => b.cash - a.cash)[0];
  return (
    <div class="card">
      <div class="card-h">
        <h3>现金与真实成本</h3>
        <div class="legend-inline">
          <span>
            <i style={{ background: 'var(--accent)' }} />
            当月扣款
          </span>
          <span>
            <i style={{ background: 'var(--orange)', height: 3 }} />
            摊到每月的成本
          </span>
        </div>
      </div>
      <div class="cash-grid">
        <BarLine
          bars={rows.map((r) => r.cash)}
          line={rows.map((r) => r.accrual)}
          future={rows.map((r) => r.projected)}
          labels={rows.map((r) => mLabel(r.month))}
          tip={(i) => (
            <>
              <b>{rows[i].month}</b>
              {rows[i].projected ? ' · 预测' : ''}
              <br />
              扣款 {money(rows[i].cash, base, { compact: true })} · 成本 {money(rows[i].accrual, base, { compact: true })}
            </>
          )}
        />
        <div class="cash-facts">
          <div {...tipProps(() => pv.items.slice(0, 6).map((x) => <div key={x.sub.id}>{x.sub.name} · {money(x.value, base, { compact: true })} · 至 {x.until}</div>))}>
            <span>预付余值</span>
            <b>
              <Amount value={pv.total} ccy={base} compact />
            </b>
            <small>{pv.items.length} 项已付未用完</small>
          </div>
          <div {...tipProps(() => sv.items.slice(0, 6).map((x) => <div key={x.sub.id}>{x.sub.name} · {money(x.saved, base, { compact: true })} · 自 {x.since}</div>))}>
            <span>退订至今省下</span>
            <b style={{ color: 'var(--green)' }}>
              <Amount value={sv.total} ccy={base} compact />
            </b>
            <small>{sv.items.length} 个已退订</small>
          </div>
          <div>
            <span>未来 90 天要付</span>
            <b>
              <Amount value={next90} ccy={base} compact />
            </b>
            <small>{peak ? `高峰在 ${Number(peak.month.slice(5))} 月 · ${money(peak.cash, base, { compact: true })}` : ''}</small>
          </div>
        </div>
      </div>
    </div>
  );
}

type Dim = 'cat' | 'pay' | 'ccy' | 'cycle';

/** 构成：树状图，面积 = 每月成本 */
export function Composition({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  const [dim, setDim] = useState<Dim>('cat');
  const [focus, setFocus] = useState<string | null>(null);
  const live = state.subscriptions.map((s) => ({ s, v: contributionOn(state, s, today) })).filter((x) => x.v > 0);
  const total = live.reduce((a, x) => a + x.v, 0);
  const keyOf = (s: Subscription) =>
    dim === 'cat'
      ? s.category
      : dim === 'pay'
        ? (state.methods.find((m) => m.id === s.methodId)?.name ?? '未指定')
        : dim === 'ccy'
          ? s.currency
          : cycleDays(s.cycle) >= 300
            ? '年付'
            : cycleDays(s.cycle) >= 80
              ? '季付 / 半年付'
              : '月付';
  const groups = new Map<string, typeof live>();
  for (const x of live) groups.set(keyOf(x.s), [...(groups.get(keyOf(x.s)) ?? []), x]);
  const entries = [...groups.entries()].map(([k, xs]) => ({ k, xs: xs.sort((a, b) => b.v - a.v), v: xs.reduce((a, x) => a + x.v, 0) })).sort((a, b) => b.v - a.v);
  const color = (k: string, i: number) => {
    if (dim === 'cat') return catColor(k);
    if (dim === 'pay') {
      const m = state.methods.find((x) => x.name === k);
      return m ? m.color || KIND_BG[m.kind] : 'var(--c9)';
    }
    return `var(--c${(i % 10) + 1})`;
  };
  const sel = focus ? entries.find((e) => e.k === focus) : undefined;
  const rects = sel ? squarify(sel.xs.map((x) => x.v)) : squarify(entries.map((e) => e.v));
  return (
    <div class="card">
      <div class="card-h">
        <h3>{sel ? `${sel.k} · ${money(sel.v, base, { compact: true })}/月` : '钱花在哪'}</h3>
        {sel ? (
          <button class="btn plain" onClick={() => setFocus(null)}>
            返回
          </button>
        ) : (
          <Seg
            small
            value={dim}
            onChange={(v) => {
              setDim(v);
              setFocus(null);
            }}
            options={[
              ['cat', '分类'],
              ['pay', '支付'],
              ['ccy', '币种'],
              ['cycle', '周期'],
            ]}
          />
        )}
      </div>
      <div class="treemap">
        {rects.map((r) => {
          if (sel) {
            const x = sel.xs[r.i];
            return (
              <button key={x.s.id} class="tm-cell" style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`, background: catColor(x.s.category) }} onClick={() => onOpen(x.s)} {...tipProps(() => `${x.s.name} · ${money(x.v, base)}/月`)}>
                {r.w * r.h > 300 && <SubIcon sub={x.s} size={24} />}
                {r.w * r.h > 180 && <b>{x.s.name}</b>}
                {r.w * r.h > 300 && <span>{money(x.v, base, { compact: true })}</span>}
              </button>
            );
          }
          const e = entries[r.i];
          return (
            <button key={e.k} class="tm-cell" style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`, background: color(e.k, r.i) }} onClick={() => setFocus(e.k)} {...tipProps(() => `${e.k} · ${e.xs.length} 项 · ${money(e.v, base)}/月`)}>
              {r.w * r.h > 160 && <b>{e.k}</b>}
              {r.w * r.h > 260 && (
                <span>
                  {Math.round((e.v / total) * 100)}% · {money(e.v, base, { compact: true })}
                </span>
              )}
              {r.w * r.h > 900 && (
                <span class="tm-icons">
                  {e.xs.slice(0, 5).map((x) => (
                    <SubIcon key={x.s.id} sub={x.s} size={20} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 礼品卡 / 话费充值计划 */
function TopUps({ state, today }: { state: AppState; today: string }) {
  const [months, setMonths] = useState<'3' | '6' | '12'>('6');
  const plan = useMemo(() => topUpPlan(state, today, Number(months)), [state, today, months]);
  const span = months === '12' ? '未来一年' : months === '6' ? '未来半年' : '未来三个月';
  const base = state.settings.baseCurrency;
  return (
    <div class="card">
      <div class="card-h">
        <h3>充值计划</h3>
        <Seg
          small
          value={months}
          onChange={setMonths}
          options={[
            ['3', '3 个月'],
            ['6', '半年'],
            ['12', '1 年'],
          ]}
        />
      </div>
      {plan.length === 0 && (
        <div class="empty">
          还没有设置余额的账户。
          <br />
          <a class="btn plain" href="/admin/wallet">
            去钱包填写 App Store / 话费余额
          </a>
        </div>
      )}
      {plan.map((p) => (
        <div key={p.method.id} class="topup">
          <MethodMark m={p.method} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{p.method.name}</div>
            <div class="muted" style={{ fontSize: 12.5 }}>
              余额 {money(p.current, p.method.currency, { compact: true })} · 每月约 {money(p.monthly, p.method.currency, { compact: true })}
            </div>
            {p.need > 0 ? (
              <>
                <div class="topup-why">
                  {span}要扣 {money(p.due, p.method.currency, { compact: true })}，余额 {money(p.current, p.method.currency, { compact: true })}，还差 {money(p.need, p.method.currency, { compact: true })}
                  {p.deadline && p.minNeed > 0 && p.minNeed < p.need - 0.01 && (
                    <>
                      ；最急的是 {cnDate(p.deadline)} 前至少补 <b>{money(p.minNeed, p.method.currency, { compact: true })}</b>
                    </>
                  )}
                </div>
                {p.cards.length > 0 ? (
                  <div class="cards-row">
                    <small>礼品卡面额参考</small>
                    {/* 同面额合并成「×N」，不再一张张平铺 */}
                    {[...p.cards.reduce((m2, c) => m2.set(c, (m2.get(c) ?? 0) + 1), new Map<number, number>())].sort((x, y) => y[0] - x[0]).map(([c, n]) => (
                      <span key={c} class="gift">
                        {money(c, p.method.currency, { compact: true })}
                        {n > 1 && <em>×{n}</em>}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div class="topup-why soft">按需充值即可，不用凑面额</div>
                )}
              </>
            ) : (
              <div class="green" style={{ fontSize: 13, marginTop: 6 }}>
                余额足够，{months === '12' ? '一年' : months === '6' ? '半年' : '三个月'}内不用充值
              </div>
            )}
          </div>
          {p.need > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700 }}>
                <Amount value={p.need} ccy={p.method.currency} compact />
              </div>
              <div class="muted" style={{ fontSize: 12 }}>≈ {money(toBase(state, p.need, p.method.currency), base, { compact: true })}</div>
              {p.deadline && <div class={diffDays(today, p.deadline) <= 7 ? 'red' : 'muted'} style={{ fontSize: 12, fontWeight: 600 }}>{cnDate(p.deadline)} 前</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const EV: Record<EventKind, [string, string]> = {
  start: ['开始订阅', 'up'],
  end: ['退订', 'down'],
  price: ['调价', 'up'],
  'intro-end': ['优惠结束', 'up'],
  buy: ['买断', 'buy'],
  pause: ['暂停', 'down'],
  switch: ['换区 / 换套餐', 'up'],
  resume: ['续订', 'up'],
};

/** 变更日志 */
function Changelog({ state, today, onOpen, base }: { state: AppState; today: string; onOpen: (s: Subscription) => void; base: string }) {
  const list = useMemo(() => events(state, today), [state, today]);
  const [n, setN] = useState(8);
  let lastYear = '';
  return (
    <div class="card">
      <div class="card-h">
        <h3>变更日志</h3>
        <span class="meta">{list.length} 次决定</span>
      </div>
      <div class="log">
        {list.slice(0, n).map((e, i) => {
          const yr = e.date.slice(0, 4);
          const showYear = yr !== lastYear;
          lastYear = yr;
          const [label, tone] = EV[e.kind];
          const up = e.kind === 'price' || e.kind === 'intro-end' || e.kind === 'switch' ? e.delta > 0 : tone === 'up';
          return (
            <Fragment key={e.sub.id + e.kind + e.date + i}>
              {showYear && <div class="log-year">{yr}</div>}
              <button class="log-item" onClick={() => onOpen(e.sub)}>
                <span class="log-date num">{e.date.slice(5).replace('-', '/')}</span>
                <i class={`log-dot ${tone}`} />
                <SubIcon sub={e.sub} size={24} />
                <span class="log-name">
                  {e.sub.name}
                  <small>
                    {label}
                    {e.note ? ` ${e.note}` : ''}
                  </small>
                </span>
                <b class={`num ${tone === 'buy' ? '' : up ? 'red' : 'green'}`}>
                  {tone === 'buy' ? money(e.delta, base, { compact: true }) : `${e.delta >= 0 ? '+' : '−'}${money(Math.abs(e.delta), base, { compact: true })}/月`}
                </b>
              </button>
            </Fragment>
          );
        })}
      </div>
      {list.length > n && (
        <button class="btn plain" style={{ marginTop: 6 }} onClick={() => setN(n + 12)}>
          更早的记录
        </button>
      )}
    </div>
  );
}

