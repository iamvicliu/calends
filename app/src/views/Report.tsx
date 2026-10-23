import { CopyImageButton } from '../components/CopyImageButton.tsx';
import { copyParts } from '../components/copy.tsx';
import { base as appPath } from '../base.ts';
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addDays, addMonths, cycleDays, diffDays, totals } from '../../../shared/billing.ts';
import { flow, cnDate, money, monthLabel } from '../../../shared/format.ts';
import { t } from '../../../shared/i18n.ts';
import { tx } from '../i18n.ts';
import {
  cancelSavings,
  cashVsAccrual,
  contributionOn,
  events,
  insights,
  monthEnd,
  monthMovement,
  mrrSeries,
  prepaidValue,
  stopLosses,
  topUpPlan,
  type EventKind,
} from '../../../shared/metrics.ts';
import type { AppState, Subscription } from '../../../shared/types.ts';
import { AreaChart, BarLine, squarify } from '../components/charts.tsx';
import { MetricCards, Metric, IconButton, Amount, CatIcon, CardTitle, Icon, MethodMark, Seg, SubIcon, tipProps, Toolbar, useWidth } from '../components/ui.tsx';
import { allCharges, catColor, KIND_BG, paletteColor, sumBase, toBase } from '../derive.ts';
import { SpendingDelta } from '../components/ScopeReport.tsx';

export function perLabel(s: Subscription): string {
  const { unit, every } = s.cycle;
  if (unit === 'lifetime') return t('report.per.lifetime');
  if (every === 1) return t(`report.per.${unit}`);
  if (unit === 'month' && every === 3) return t('report.per.quarter');
  if (unit === 'month' && every === 6) return t('report.per.halfYear');
  if (unit === 'year' && every === 2) return t('report.per.twoYears');
  return t(`report.per.n.${unit}`, { count: every });
}

const mLabel = (m: string) => (m.endsWith('-01') ? t('report.axis.year', { yy: m.slice(2, 4), year: m.slice(0, 4) }) : monthLabel(m, { year: false }));
const perMonth = (amount: string) => t('report.perMonth', { amount });

export function Report({ state, today, onOpen, onReview }: { state: AppState; today: string; onOpen: (s: Subscription) => void; onReview: () => void }) {
  const base = state.settings.baseCurrency;
  const y = Number(today.slice(0, 4));
  return (
    <>
      <Toolbar title={t('report.title')}>
        <button className="btn" onClick={onReview}>
          <Icon name="share" /> {t('report.shareReview', { year: y })}
        </button>
      </Toolbar>
      <div className="page fade-in stack">
        <Hero state={state} today={today} />
        {/* 先看钱的全貌（现金与真实成本、钱花在哪），再看本月变动与体检 */}
        <CashCard state={state} today={today} />
        <Composition state={state} today={today} onOpen={onOpen} />
        <div className="grid g-2">
          <Waterfall state={state} today={today} onOpen={onOpen} />
          <Checkup state={state} today={today} onOpen={onOpen} />
        </div>
        <StopsCard state={state} today={today} onOpen={onOpen} />
        <div className="grid g-2 report-bottom">
          <TopUps state={state} today={today} />
          <Changelog state={state} today={today} onOpen={onOpen} base={base} />
        </div>
      </div>
    </>
  );
}

/** 头部：负 MRR + 历史走势 */
/** 从最早订阅所在月到今天的月数，至少 2 个月。放在组件外：Oxc 版 React Compiler 处理组件里的 Math.max 会内部报错并整组件放弃优化 */
function monthsSince(first: string, today: string): number {
  return Math.max(2, diffDays(first.slice(0, 8) + '01', today) / 30.4375 + 1);
}

function Hero({ state, today }: { state: AppState; today: string }) {
  const base = state.settings.baseCurrency;
  const [range, setRange] = useState<'12' | '36' | 'all'>('36');
  const [hist, setHist] = useState(true);
  const first = state.subscriptions.reduce((m, s) => (s.start < m ? s.start : m), today);
  const allMonths = monthsSince(first, today);
  const months = range === 'all' ? Math.ceil(allMonths) : Number(range);
  const series = useMemo(() => mrrSeries(state, today, months, hist), [state, today, months, hist]);
  const tot = totals(state, today);
  const now = series[series.length - 1].mrr;
  const yearAgo = series.length > 12 ? series[series.length - 13].mrr : undefined;
  const evDates = new Set(
    events(state, today)
      .filter((e) => e.kind !== 'buy')
      .map((e) => e.date.slice(0, 7)),
  );
  const markers = series.map((p, i) => (evDates.has(p.month) ? i : -1)).filter((i) => i >= 0);
  /** 带正负号的金额：支出为负、收入为正 */
  const signed = (v: number, compact = true) => flow(v, base, { compact });
  return (
    <div className="card hero-card copy-card" data-copy-card>
      <div className="hero-l">
        <CardTitle as="div" className="stat-label" hint={t('scope.mrrBasis')}>
          {t('report.hero.label')}
        </CardTitle>
        <div className="hero-num">
          <Amount value={-now} ccy={base} />
        </div>
        <div className="hero-delta">
          {yearAgo != null && yearAgo > 0 && <span className="muted">{copyParts(t('report.hero.yearAgo', { amount: signed(-yearAgo) }))}</span>}
        </div>
        <MetricCards plain>
          <Metric label={t('report.hero.annual')} value={signed(-now * 12)} />
          <Metric label={t('report.hero.perDay')} value={signed(-now / 30.4375, false)} />
          <Metric label={t('report.hero.active')} value={tot.activeCount} />
          {tot.recoverMrr > 1 && <Metric label={t('report.hero.recover')} value={signed(tot.recoverMrr)} valueClassName="gain" />}
        </MetricCards>
      </div>
      <div className="hero-r">
        <div className="row copy-controls" style={{ justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
          <CopyImageButton hover />
          <Seg
            small
            value={hist ? 'h' : 'c'}
            onChange={(v) => setHist(v === 'h')}
            options={[
              ['h', t('report.hero.fxHist')],
              ['c', t('report.hero.fxNow')],
            ]}
          />
          <Seg
            small
            value={range}
            onChange={setRange}
            options={[
              ['12', t('report.hero.range1')],
              ['36', t('report.hero.range3')],
              ['all', t('report.hero.rangeAll')],
            ]}
          />
        </div>
        <AreaChart
          values={series.map((p) => p.mrr)}
          labels={series.map((p) => mLabel(p.month))}
          markers={markers}
          tip={(i) => (
            <>
              <b>{series[i].month}</b> <span className="copy-gap" aria-hidden="true" /> {perMonth(flow(-series[i].mrr, base, { compact: true }))}
            </>
          )}
        />
      </div>
    </div>
  );
}

/** 月度变动瀑布：上月末 → 新增 → 涨价 → 降价 → 退订 → 本月 */
function Waterfall({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  const [offset, setOffset] = useState(0);
  const month = addMonths(today.slice(0, 8) + '01', offset).slice(0, 7);
  const end = offset === 0 ? today : monthEnd(month);
  const mv = useMemo(() => monthMovement(state, end, offset !== 0), [state, month, end, offset]);
  const steps = [
    { k: t('report.wf.from'), v: mv.from, kind: 'total' },
    { k: t('report.wf.fx'), v: mv.fx, kind: mv.fx >= 0 ? 'up' : 'down' },
    { k: t('report.wf.added'), v: mv.added, kind: 'up' },
    { k: t('report.wf.expansion'), v: mv.expansion, kind: 'up' },
    { k: t('report.wf.contraction'), v: -mv.contraction, kind: 'down' },
    { k: t('report.wf.churned'), v: -mv.churned, kind: 'down' },
    { k: offset === 0 ? t('report.wf.now') : t('report.wf.monthEnd'), v: mv.to, kind: 'total' },
  ];
  // 不画瀑布：总额两千多、变化几十上百，放在一根轴上变化量只剩几条细线。
  // 改成「一句结论 + 变化来源清单」，清单的横条只在各项之间比大小
  const drivers = steps.filter((x) => x.kind !== 'total' && Math.abs(x.v) >= 0.5);
  const peak = Math.max(1, ...drivers.map((x) => Math.abs(x.v)));
  const delta = mv.to - mv.from;
  const singleDriver = drivers.length === 1 && Math.abs(drivers[0].v - delta) < 0.005;
  const singleItem = Math.abs(delta) >= 0.5 && mv.items.length === 1 && Math.abs(mv.items[0].delta - delta) < 0.005;
  const pct = mv.from > 0 ? delta / mv.from : 0;
  const kindLabel = (k: 'added' | 'expansion' | 'contraction' | 'churned') => t(`report.wf.${k}`);
  return (
    <div className="card copy-card" data-copy-card>
      <div className="card-h">
        <CardTitle>{t('report.wf.title', { n: Number(month.slice(5)), month: monthLabel(month, { year: false, long: true }) })}</CardTitle>
        <div className="row copy-controls" style={{ gap: 4 }}>
          <CopyImageButton hover />
          <IconButton aria-label={t('report.wf.prev')} onClick={() => setOffset(offset - 1)}>
            <Icon name="left" />
          </IconButton>
          <IconButton
            aria-label={t('report.wf.next')}
            disabled={offset >= 0}

            onClick={() => setOffset(Math.min(0, offset + 1))}
          >
            <Icon name="right" />
          </IconButton>
        </div>
      </div>
      <MetricCards inline>
        {offset !== 0 && <Metric label={offset === 0 ? t('report.wf.now') : t('report.wf.monthEnd')} value={perMonth(flow(-mv.to, base, { compact: true }))} />}
        <Metric
          label={t('report.wf.vsFrom', { amount: flow(-mv.from, base, { compact: true }) })}
          value={Math.abs(delta) < 0.5 ? t('report.wf.flat') : <SpendingDelta value={{ amount: delta, percent: mv.from > 0 ? pct : undefined }} base={base} />}
          valueClassName={Math.abs(delta) < 0.5 ? '' : delta > 0 ? 'loss' : 'gain'}
        />
      </MetricCards>
      {drivers.length > 0 && !singleDriver && (
        <div className="mv-rows">
          {drivers.map((x) => (
            <div key={x.k} className={`mv-row ${x.v > 0 ? 'up' : 'down'}`}>
              <span>{x.k}</span>
              <div className="mv-bar">
                <i style={{ width: `${(Math.abs(x.v) / peak) * 100}%` }} />
              </div>
              <b className="num">
                {x.v > 0 ? '↑' : '↓'} {money(Math.abs(x.v), base, { compact: true })}
              </b>
            </div>
          ))}
        </div>
      )}
      <div className="wf-items">
        {mv.items.length === 0 && (
          <div className="muted" style={{ fontSize: 'var(--fs-2)', padding: '8px 0' }}>
            {Math.abs(mv.fx) >= 0.5 ? t('report.wf.fx') : t('report.wf.empty')}
          </div>
        )}
        {mv.items.slice(0, 4).map((it) => (
          <button key={it.sub.id} className="wf-item" onClick={() => onOpen(it.sub)}>
            <SubIcon sub={it.sub} size={24} />
            <span className="wf-name">{it.sub.name}</span>
            <em className={it.delta > 0 ? 'up' : 'down'}>{kindLabel(it.kind)}</em>
            {!singleItem && (
              <b className="num">
                {it.delta > 0 ? '↑' : '↓'} {money(Math.abs(it.delta), base, { compact: true })}
              </b>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 体检：规则驱动的提醒与洞察 */
function Checkup({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const list = useMemo(() => insights(state, today).filter((i) => i.id !== 'unused'), [state, today]);
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 5);
  return (
    <div className="card copy-card" data-copy-card>
      <div className="card-h">
        <CardTitle>{t('report.checkup.title')}</CardTitle>
        <div className="copy-tools">
          <CopyImageButton hover />
          <span className="meta">{t('report.checkup.warn', { count: list.filter((i) => i.tone === 'warn').length })}</span>
        </div>
      </div>
      <div className="insights">
        {shown.map((i) => (
          <div key={i.id} className={`insight ${i.tone}`}>
            <i className="dot" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ins-t">{i.title}</div>
              <div className="ins-b">{i.body}</div>
              {!!(i.subs?.length || i.methods?.length) && (
                <div className="ins-subs">
                  {i.methods?.map((m) => (
                    <a className="icon-btn sub-shortcut" key={m.id} href={appPath('/wallet')} title={m.name} aria-label={m.name}>
                      <MethodMark m={m} size={22} />
                    </a>
                  ))}
                  {(i.subs ?? []).slice(0, 6).map((s) => (
                    <IconButton className="sub-shortcut" key={s.id} onClick={() => onOpen(s)} title={s.name} aria-label={s.name}>
                      <SubIcon sub={s} size={22} />
                    </IconButton>
                  ))}
                </div>
              )}
            </div>
            {i.href && (
              <a className="btn plain" href={i.href}>
                {t('report.checkup.fix')}
              </a>
            )}
          </div>
        ))}
      </div>
      {list.length > 5 && (
        <button className="btn plain" style={{ marginTop: 6 }} onClick={() => setAll(!all)}>
          {all ? t('report.checkup.less') : t('report.checkup.more', { count: list.length - 5 })}
        </button>
      )}
    </div>
  );
}

/** 现金 vs 权责 + 预付余值 */
function CashCard({ state, today }: { state: AppState; today: string }) {
  const base = state.settings.baseCurrency;
  const rows = useMemo(() => cashVsAccrual(state, today, 23, 12), [state, today]);
  const pv = useMemo(() => prepaidValue(state, today), [state, today]);
  const next90 = sumBase(state, allCharges(state, addDays(today, 1), addDays(today, 90), today));
  const peak = rows.filter((r) => r.projected).sort((a, b) => b.cash - a.cash)[0];
  return (
    <div className="card copy-card" data-copy-card>
      <div className="card-h">
        <CardTitle as="h3" hint={t('scope.cashBasis')}>
          {t('report.cash.title')}
        </CardTitle>
        <div className="copy-tools">
          <CopyImageButton hover />
          <div className="legend-inline">
            <span>
              <i style={{ background: 'var(--chart-ink-2)' }} />
              {t('report.cash.legendCash')}
            </span>
            <span>
              <i style={{ background: 'var(--chart-ink)', height: 3 }} />
              {t('report.cash.legendAccrual')}
            </span>
          </div>
        </div>
      </div>
      <div className="cash-grid">
        <BarLine
          bars={rows.map((r) => r.cash)}
          line={rows.map((r) => r.accrual)}
          future={rows.map((r) => r.projected)}
          labels={rows.map((r) => mLabel(r.month))}
          tip={(i) => (
            <>
              <b>{rows[i].month}</b>
              {copyParts(rows[i].projected ? t('report.cash.forecast') : '')}
              <br />
              {copyParts(t('report.cash.tip', { cash: flow(-rows[i].cash, base, { compact: true }), cost: flow(-rows[i].accrual, base, { compact: true }) }))}
            </>
          )}
        />
        <MetricCards inline>
          <Metric
            {...tipProps(() =>
              pv.items
                .slice(0, 6)
                .map((x) => (
                  <div key={x.sub.id}>
                    {copyParts(t('report.cash.prepaidItem', { name: x.sub.name, amount: money(x.value, base, { compact: true }), until: x.until }))}
                  </div>
                )),
            )}
            label={t('report.cash.prepaid')}
            value={<Amount plain value={pv.total} ccy={base} compact />}
            note={<small>{t('report.cash.prepaidSub', { count: pv.items.length })}</small>}
          />
          <Metric
            label={t('report.cash.next90')}
            value={<Amount value={-next90} ccy={base} compact />}
            note={
              <>
                <small>{t('report.cash.fullPaidHint')}</small>
                <small>
                  {copyParts(
                    peak
                      ? t('report.cash.peak', {
                          n: Number(peak.month.slice(5)),
                          month: monthLabel(peak.month.slice(0, 7), { year: false }),
                          amount: flow(-peak.cash, base, { compact: true }),
                        })
                      : '',
                  )}
                </small>
              </>
            }
          />
        </MetricCards>
      </div>
    </div>
  );
}

/** 退订后的续费节省与未退款损失，均截至今天、全部历史 */
function StopsCard({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  const saved = useMemo(() => cancelSavings(state, today), [state, today]);
  const losses = useMemo(() => stopLosses(state, today), [state, today]);
  return (
    <div className="card stop-report copy-card" data-copy-card id="report-stops">
      <div className="copy-corner">
        <CopyImageButton hover />
      </div>
      <div className="card-h">
        <CardTitle>{t('report.stops.title')}</CardTitle>
      </div>
      <p className="stop-basis">{copyParts(t('report.stops.basis'))}</p>
      <MetricCards inline>
        <Metric
          {...tipProps(() =>
            saved.items.map((i) => (
              <div key={i.sub.id}>{copyParts(t('report.cash.savedItem', { name: i.sub.name, amount: money(i.saved, base), since: i.since }))}</div>
            )),
          )}
          label={t('report.stops.saved')}
          value={
            <>
              {saved.total > 0 ? '+' : ''}
              <Amount plain value={saved.total} ccy={base} compact />
            </>
          }
          valueClassName="green"
          note={t('report.stops.savedHint')}
        />
        {losses.items.length !== 1 && (
          <Metric
            label={t('report.stops.loss')}
            value={<Amount value={-losses.total} ccy={base} compact />}
            valueClassName="loss"
            note={t('report.stops.lossHint')}
          />
        )}
      </MetricCards>
      {losses.incomplete && <p className="stop-basis red">{t('core.stop.fxMissing')}</p>}
      <h4 className="stop-list-title">{t('report.stops.details')}</h4>
      {losses.items.length === 0 ? (
        <div className="empty">{t('report.stops.empty')}</div>
      ) : (
        <div className="stop-list">
          {losses.items.map((i) => (
            <button key={`${i.sub.id}-${i.phaseIndex}`} className="stop-row" onClick={() => onOpen(i.sub)}>
              <SubIcon sub={i.sub} size={32} />
              <span className="stop-info">
                <b>{i.sub.name}</b>
                <small>
                  {cnDate(i.date)} <span className="copy-gap" aria-hidden="true" />{' '}
                  {i.kind === 'terminate' ? t('core.stop.terminate') : t('report.stops.cancel')}
                  {copyParts(i.reason ? `\n${i.reason}` : '')}
                </small>
                <small style={i.refunded > 0 ? { color: 'var(--green)' } : undefined}>
                  {i.refundStatus === 'none' ? t('core.stop.refundNo') : t('core.stop.partial', { money: flow(i.refunded, i.currency) })}
                </small>
              </span>
              <span className="stop-amount">
                <b className="red">
                  <span className="stop-days">
                    {t('core.stop.lossDays', { count: i.wastedDays })} <span className="copy-gap" aria-hidden="true" />{' '}
                  </span>
                  <span>{flow(-i.lossBase, base)}</span>
                </b>
                {i.currency !== base && <small>{flow(-i.loss, i.currency)}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Dim = 'cat' | 'pay' | 'ccy' | 'cycle';

/** 构成：树状图，面积 = 每月成本 */
export function Composition({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  const [dim, setDim] = useState<Dim>('cat');
  const [focus, setFocus] = useState<string | null>(null);
  const [box, W] = useWidth();
  const H = W < 560 ? 320 : 400;
  const live = state.subscriptions.map((s) => ({ s, v: contributionOn(state, s, today) })).filter((x) => x.v > 0);
  const total = live.reduce((a, x) => a + x.v, 0);
  const keyOf = (s: Subscription) => {
    if (dim === 'cat') return s.category;
    if (dim === 'pay') return state.methods.find((m) => m.id === s.methodId)?.name ?? t('report.comp.unassigned');
    if (dim === 'ccy') return s.currency;
    const days = cycleDays(s.cycle);
    return days >= 300 ? t('report.comp.yearly') : days >= 80 ? t('report.comp.quarterly') : t('report.comp.monthly');
  };
  const groups = new Map<string, typeof live>();
  for (const x of live) {
    const k = keyOf(x.s);
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  const entries = [...groups.entries()]
    .map(([k, xs]) => ({ k, xs: xs.sort((a, b) => b.v - a.v), v: xs.reduce((a, x) => a + x.v, 0) }))
    .sort((a, b) => b.v - a.v);
  const color = (k: string, i: number) => {
    if (dim === 'cat') return catColor(k);
    if (dim === 'pay') {
      const m = state.methods.find((x) => x.name === k);
      return m ? paletteColor(m.color, KIND_BG[m.kind]) : 'var(--c9)';
    }
    return `var(--c${(i % 10) + 1})`;
  };
  const sel = focus ? entries.find((e) => e.k === focus) : undefined;
  const rects = squarify(entries.map((e) => e.v));
  /** 每个订阅一块，图标按块的大小放大，空间够再写名称和金额 */
  const tiles = (xs: typeof live, b: { x: number; y: number; w: number; h: number }, bg: (cat: string) => string, onPick?: () => void) =>
    squarify(
      xs.map((x) => x.v),
      b.x,
      b.y,
      b.w,
      b.h,
    ).map((r) => {
      const x = xs[r.i];
      const side = Math.min(r.w, r.h);
      const label = r.w > 76 && r.h > 70;
      const ico = Math.floor(Math.min(96, side * (label ? 0.4 : 0.6)));
      return (
        <button
          key={x.s.id}
          className={`tm-cell ${side > 200 ? 'lg' : ''}`}
          style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: bg(x.s.category) }}
          onClick={() => (onPick ? onPick() : onOpen(x.s))}
          {...tipProps(() => `${x.s.name}\n${perMonth(flow(-x.v, base))}`)}
        >
          {ico >= 12 && <SubIcon sub={x.s} size={ico} />}
          {label && <b>{x.s.name}</b>}
          {label && r.h > ico + 52 && <span>{flow(-x.v, base, { compact: true })}</span>}
        </button>
      );
    });
  return (
    <div className="card copy-card" data-copy-card>
      <div className="card-h">
        <CardTitle>{copyParts(sel ? `${sel.k}\n${perMonth(flow(-sel.v, base, { compact: true }))}` : t('report.comp.title'))}</CardTitle>
        <div className="copy-controls">
          <CopyImageButton hover />
          {sel ? (
            <button className="btn plain" onClick={() => setFocus(null)}>
              {t('report.comp.back')}
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
                ['cat', t('report.comp.cat')],
                ['pay', t('report.comp.pay')],
                ['ccy', t('report.comp.ccy')],
                ['cycle', t('report.comp.cycle')],
              ]}
            />
          )}
        </div>
      </div>
      <div className="treemap" ref={box} style={{ height: H }}>
        {W > 0 &&
          (sel
            ? tiles(sel.xs, { x: 0, y: 0, w: W, h: H }, catColor)
            : rects.map((r) => {
                const e = entries[r.i];
                const g = { x: (r.x / 100) * W, y: (r.y / 100) * H, w: (r.w / 100) * W, h: (r.h / 100) * H };
                // 分组：顶上一条标题，下面按订阅再分小块
                const head = g.w > 70 && g.h > 64 ? 22 : 0;
                const bg = color(e.k, r.i);
                return (
                  <div key={e.k} className="tm-group" style={{ left: g.x, top: g.y, width: g.w, height: g.h, background: bg }}>
                    {head > 0 && (
                      <button
                        className="tm-head"
                        onClick={() => setFocus(e.k)}
                        {...tipProps(() => t('report.comp.groupTip', { name: e.k, count: e.xs.length, amount: flow(-e.v, base) }))}
                      >
                        <b className="icon-text">
                          {dim === 'cat' && <CatIcon cat={e.k} size={11} />}
                          <span>{e.k}</span>
                        </b>
                        {g.w > 150 && (
                          <span>
                            {Math.round((e.v / total) * 100)}% <span className="copy-gap" aria-hidden="true" /> {flow(-e.v, base, { compact: true })}
                          </span>
                        )}
                      </button>
                    )}
                    {tiles(e.xs, { x: 0, y: head, w: g.w, h: g.h - head }, () => bg, head ? undefined : () => setFocus(e.k))}
                  </div>
                );
              }))}
      </div>
    </div>
  );
}

/** 礼品卡 / 话费充值计划 */
function TopUps({ state, today }: { state: AppState; today: string }) {
  const [months, setMonths] = useState<'3' | '6' | '12'>('6');
  const plan = useMemo(() => topUpPlan(state, today, Number(months)), [state, today, months]);
  const span = t(`report.topup.span${months}`);
  const base = state.settings.baseCurrency;
  return (
    <div className="card copy-card" data-copy-card>
      <div className="card-h">
        <CardTitle>{t('report.topup.title')}</CardTitle>
        <div className="copy-controls">
          <CopyImageButton hover />
          <Seg
            small
            value={months}
            onChange={setMonths}
            options={[
              ['3', t('report.topup.range3')],
              ['6', t('report.topup.range6')],
              ['12', t('report.topup.range12')],
            ]}
          />{' '}
        </div>
      </div>
      {plan.length === 0 && (
        <div className="empty">
          {t('report.topup.empty')}
          <br />
          <a className="btn plain" href={appPath('/wallet')}>
            {t('report.topup.emptyCta')}
          </a>
        </div>
      )}
      {plan.map((p) => (
        <div key={p.method.id} className="topup">
          <MethodMark m={p.method} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{p.method.name}</div>
            <div className="muted" style={{ fontSize: 'var(--fs-1)' }}>
              {copyParts(
                t('report.topup.summary', {
                  balance: money(p.current, p.method.currency, { compact: true }),
                  monthly: flow(-p.monthly, p.method.currency, { compact: true }),
                }),
              )}
            </div>
            {p.need > 0 ? (
              <>
                <div className="topup-why">
                  {t('report.topup.why', {
                    span,
                    due: flow(-p.due, p.method.currency, { compact: true }),
                    balance: money(p.current, p.method.currency, { compact: true }),
                    need: money(p.need, p.method.currency, { compact: true }),
                  })}
                  {p.deadline && p.minNeed > 0 && p.minNeed < p.need - 0.01 && (
                    <>{tx('report.topup.urgent', { date: cnDate(p.deadline), min: <b>{money(p.minNeed, p.method.currency, { compact: true })}</b> })}</>
                  )}
                </div>
                {p.cards.length > 0 ? (
                  <div className="cards-row">
                    <small>{t('report.topup.cards')}</small>
                    {/* 同面额合并成「×N」，不再一张张平铺 */}
                    {[...p.cards.reduce((m2, c) => m2.set(c, (m2.get(c) ?? 0) + 1), new Map<number, number>())]
                      .sort((x, y) => y[0] - x[0])
                      .map(([c, n]) => (
                        <span key={c} className="gift">
                          {money(c, p.method.currency, { compact: true })}
                          {n > 1 && <em>×{n}</em>}
                        </span>
                      ))}
                  </div>
                ) : (
                  <div className="topup-why soft">{t('report.topup.anyAmount')}</div>
                )}
              </>
            ) : (
              <div className="green" style={{ fontSize: 'var(--fs-2)', marginTop: 6 }}>
                {t(`report.topup.enough${months}`)}
              </div>
            )}
          </div>
          {p.need > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700 }}>
                <Amount plain value={p.need} ccy={p.method.currency} compact />
              </div>
              <div className="muted" style={{ fontSize: 'var(--fs-1)' }}>
                ≈ {money(toBase(state, p.need, p.method.currency), base, { compact: true })}
              </div>
              {p.deadline && (
                <div className={diffDays(today, p.deadline) <= 7 ? 'red' : 'muted'} style={{ fontSize: 'var(--fs-1)', fontWeight: 600 }}>
                  {t('report.topup.by', { date: cnDate(p.deadline) })}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** 事件类型 → [文案键, 色调] */
const EV: Record<EventKind, [string, string]> = {
  start: ['start', 'up'],
  end: ['end', 'down'],
  terminate: ['terminate', 'down'],
  price: ['price', 'up'],
  'intro-end': ['introEnd', 'up'],
  buy: ['buy', 'buy'],
  pause: ['pause', 'down'],
  switch: ['switch', 'up'],
  resume: ['resume', 'up'],
};

/** 变更日志 */
function Changelog({ state, today, onOpen, base }: { state: AppState; today: string; onOpen: (s: Subscription) => void; base: string }) {
  const list = useMemo(() => events(state, today), [state, today]);
  const [fit, setFit] = useState<number | null>(null);
  const [extra, setExtra] = useState(0);
  const log = useRef<HTMLDivElement>(null);
  const n = (fit ?? 8) + extra;
  // 右卡不撑高桌面网格；按左卡留下的空间显示完整条目，包含跨年的标题。
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    const desktop = matchMedia('(min-width: 681px)');
    const measure = () => {
      if (!desktop.matches) {
        setFit(null);
        return;
      }
      if (extra > 0) return;
      const row = el.querySelector<HTMLElement>('.log-item');
      const year = el.querySelector<HTMLElement>('.log-year');
      if (!row || !year) return;
      const rowHeight = row.getBoundingClientRect().height;
      const yearHeight = year.getBoundingClientRect().height;
      const available = el.getBoundingClientRect().height;
      let height = 0;
      let count = 0;
      let last = '';
      for (const event of list) {
        const yr = event.date.slice(0, 4);
        const next = height + rowHeight + (yr !== last ? yearHeight : 0);
        if (next > available) break;
        height = next;
        last = yr;
        count++;
      }
      setFit(Math.max(1, count));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const row = el.querySelector('.log-item');
    const year = el.querySelector('.log-year');
    if (row) observer.observe(row);
    if (year) observer.observe(year);
    desktop.addEventListener('change', measure);
    return () => {
      observer.disconnect();
      desktop.removeEventListener('change', measure);
    };
  }, [list, extra]);
  return (
    <div className={`card report-log copy-card ${extra > 0 ? 'expanded' : ''}`} data-copy-card>
      <div className="card-h">
        <CardTitle>{t('report.log.title')}</CardTitle>
        <div className="copy-tools">
          <CopyImageButton hover />
          <span className="meta">{t('report.log.decisions', { count: list.length })}</span>
        </div>
      </div>
      <div className="log" ref={log}>
        {list.slice(0, n).map((e, i) => {
          const yr = e.date.slice(0, 4);
          const showYear = i === 0 || list[i - 1].date.slice(0, 4) !== yr;
          const [labelKey, tone] = EV[e.kind];
          const label = e.kind === 'terminate' ? t('core.stop.terminate') : t(`report.ev.${labelKey}`);
          const up = e.kind === 'price' || e.kind === 'intro-end' || e.kind === 'switch' ? e.delta > 0 : tone === 'up';
          return (
            <Fragment key={e.sub.id + e.kind + e.date + i}>
              {showYear && <div className="log-year">{yr}</div>}
              <button className="log-item" onClick={() => onOpen(e.sub)}>
                <span className="log-date num">{e.date.slice(5).replace('-', '/')}</span>
                <i className={`log-dot ${tone}`} />
                <SubIcon sub={e.sub} size={24} />
                <span className="log-name">
                  {e.sub.name}
                  <small>
                    {label}
                    {e.note ? ` ${e.note}` : ''}
                  </small>
                </span>
                <b className={`num ${tone === 'buy' ? '' : up ? 'red' : 'green'}`}>
                  {copyParts(
                    tone === 'buy'
                      ? money(e.delta, base, { compact: true })
                      : perMonth(`${e.delta > 0 ? '↑' : e.delta < 0 ? '↓' : ''} ${money(Math.abs(e.delta), base, { compact: true })}`),
                  )}
                </b>
              </button>
            </Fragment>
          );
        })}
      </div>
      <div className="log-actions">
        {list.length > n && (
          <button className="btn plain" onClick={() => setExtra(extra + 12)}>
            {t('report.log.more')}
          </button>
        )}
      </div>
    </div>
  );
}
