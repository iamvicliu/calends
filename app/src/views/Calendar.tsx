import { canUseSingleKey } from '../keyboard.ts';
import { copyParts } from '../components/copy.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import {
  addDays,
  addMonths,
  billingPeriod,
  diffDays,
  parseDay,
  cycleLabel,
  currentPhase,
  effectiveStatus,
  nextCharge,
  type Charge,
} from '../../../shared/billing.ts';
import { flow, cnDate, cnDateAuto, monthLabel, relDays, weekdayShort } from '../../../shared/format.ts';
import { t } from '../../../shared/i18n.ts';
import type { AppState, Subscription } from '../../../shared/types.ts';
import { IconButton, Amount, CardTitle, Icon, PayBadge, Seg, SubIcon, tipProps, Toolbar, useWidth } from '../components/ui.tsx';
import { chargeValue } from '../../../shared/fx.ts';
import { allCharges, sumBase } from '../derive.ts';
import { useMoneyPair } from '../components/MoneyPair.tsx';
import { usePref } from '../store.ts';
import { monthReport } from '../../../shared/scope-report.ts';
import { ScopeReport, SpendingDelta } from '../components/ScopeReport.tsx';
import { StopText, stopDescription, stopLabel } from '../components/StopPanel.tsx';

/** 表头的星期简称，按周起始日排好 */
const dows = () => Array.from({ length: 7 }, (_, i) => weekdayShort((i + weekStart) % 7, true));
/** 周起始日：设置里选的，缺省周一 */
let weekStart: 0 | 1 = 1;

function monthGrid(month: string) {
  const first = month + '-01';
  const dow = (new Date(parseDay(first)).getUTCDay() + 7 - weekStart) % 7;
  const start = addDays(first, -dow);
  const last = addDays(addMonths(first, 1), -1);
  const cells = Math.ceil((dow + Number(last.slice(8))) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => addDays(start, i));
}

export function Calendar({ state, today, onOpen, onIcs }: { state: AppState; today: string; onOpen: (s: Subscription) => void; onIcs: () => void }) {
  // 大字 / 小字金额跟随显示货币设置
  const pair = useMoneyPair(state);
  weekStart = state.settings.weekStart ?? 1;
  const DOW = dows();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [mode, setMode] = usePref<'month' | 'year'>('cal-mode', 'month', (v): v is 'month' | 'year' => v === 'month' || v === 'year');
  const [sel, setSel] = useState<string | null>(today);
  const [reportMode, setReportMode] = usePref<'mini' | 'full'>('cal-report-mode', 'mini', (v): v is 'mini' | 'full' => v === 'mini' || v === 'full');
  const report = useMemo(() => (mode === 'month' ? monthReport(state, month, today) : null), [state, month, today, mode]);
  const base = state.settings.baseCurrency;

  const year = month.slice(0, 4);
  const grid = monthGrid(month);
  const charges = useMemo(
    () =>
      allCharges(
        state,
        grid[0] < `${year}-01-01` ? grid[0] : `${year}-01-01`,
        grid[grid.length - 1] > `${year}-12-31` ? grid[grid.length - 1] : `${year}-12-31`,
        today,
      ).filter((c) => c.kind !== 'failed'),
    [state, year, month, today],
  );
  // 图标只排一行、叠放约四成：按格子实际宽度算能放几个，放不下的换成「+N」，格子高度始终不变。
  // 悬停格子时依次轻浮一下，悬停某个图标时它浮到最上层；是哪几项看右侧当天列表
  const [gridRef, gridW] = useWidth();
  const narrow = gridW > 0 && gridW < 560;
  const icon = narrow ? 17 : 24;
  const step = Math.round(icon * 0.6);
  const inner = gridW / 7 - (narrow ? 6 : 14);
  const MORE_W = 20;
  const iconCap = gridW ? Math.max(2, Math.floor((inner - icon - MORE_W) / step) + 1) : 4;
  /** 不叠也放得下（间隔 3px）就平铺，放不下才叠 */
  const fits = (n: number) => icon * n + 3 * (n - 1) <= inner;
  const byDay = useMemo(() => {
    const m = new Map<string, Charge[]>();
    for (const c of charges) m.set(c.date, [...(m.get(c.date) ?? []), c]);
    return m;
  }, [charges]);
  const sumOf = (list: Charge[] = []) => sumBase(state, list);
  const monthCharges = charges.filter((c) => c.date.startsWith(month));
  const yearCharges = charges.filter((c) => c.date.startsWith(year));
  // 翻月清空选择；今天按钮和 T 明确选中今天。
  const goMonth = (m: string) => {
    setMonth(m);
    setSel(null);
  };
  const goToday = () => {
    setMonth(today.slice(0, 7));
    setSel(today);
  };
  const shift = (n: number) => goMonth(addMonths(month + '-01', mode === 'year' ? n * 12 : n).slice(0, 7));
  // ← → 翻上/下一页（月视图翻月，年视图翻年），T 回到今天；输入框里、弹层打开时不响应
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!canUseSingleKey(e)) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        goMonth(addMonths(month + '-01', (e.key === 'ArrowLeft' ? -1 : 1) * (mode === 'year' ? 12 : 1)).slice(0, 7));
      } else if (e.key === 't' || e.key === 'T') {
        goToday();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [month, mode, today]);
  const selList = (sel && byDay.get(sel)) || [];
  const selection = useRef<HTMLDivElement>(null);
  const hasSelection = selList.length > 0;
  useEffect(() => {
    if (mode !== 'month' || reportMode !== 'full' || !hasSelection) return;
    const el = selection.current;
    if (!el) return;
    const bounds = el.getBoundingClientRect();
    const toolbarBottom = document.querySelector('.toolbar')?.getBoundingClientRect().bottom ?? 0;
    el.style.scrollMarginTop = `${toolbarBottom}px`;
    if (bounds.top < toolbarBottom || bounds.bottom > window.innerHeight) {
      el.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
  }, [sel, reportMode, mode, hasSelection]);
  const list = mode === 'month' ? monthCharges : yearCharges;

  return (
    <>
      <Toolbar
        title={mode === 'month' ? monthLabel(month, { long: true }) : t('calendar.yearTitle', { year })}
        // 月视图的笔数与合计放进右侧的指标卡；年视图没有右栏，仍写在标题下
        sub={mode === 'year' ? t('calendar.summary', { count: list.length, amount: flow(-sumOf(list), base, { compact: true }) }) : undefined}
      >
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            ['month', t('calendar.mode.month')],
            ['year', t('calendar.mode.year')],
          ]}
        />
        <IconButton aria-label={t('calendar.prev')} title={`${t('calendar.prev')} ←`} onClick={() => shift(-1)}>
          <Icon name="left" />
        </IconButton>
        <button
          className="btn"
          title={`${t('calendar.today')} T`}
          onClick={() => {
            goToday();
          }}
        >
          {t('calendar.today')}
        </button>
        <IconButton aria-label={t('calendar.next')} title={`${t('calendar.next')} →`} onClick={() => shift(1)}>
          <Icon name="right" />
        </IconButton>
        {!state.readonly && (
          <IconButton onClick={onIcs} title={t('calendar.ics')} aria-label={t('calendar.ics')}>
            <Icon name="share" />
          </IconButton>
        )}
      </Toolbar>
      <div className="page fade-in">
        {mode === 'year' ? (
          <YearHeat
            year={year}
            byDay={byDay}
            today={today}
            sumOf={sumOf}
            base={base}
            onPick={(m) => {
              goMonth(m);
              setMode('month');
            }}
          />
        ) : (
          <div className="cal-wrap">
            {/* 左：日历与选中日明细或月报告；右：整月列表 */}
            <div className="stack">
              <div className="card cal">
                <div className="cal-grid" ref={gridRef}>
                  {DOW.map((d, i) => (
                    <div key={i} className="cal-dow">
                      {d}
                    </div>
                  ))}
                  {grid.map((d) => {
                    const items = byDay.get(d) ?? [];
                    const shown = items.length > iconCap ? items.slice(0, iconCap) : items;
                    return (
                      <button
                        key={d}
                        className={`cal-cell ${d.startsWith(month) ? '' : 'out'} ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''}`}
                        aria-pressed={d === sel}
                        aria-current={d === today ? 'date' : undefined}
                        aria-label={cnDate(d, true)}
                        onClick={() => setSel((current) => (current === d ? null : d))}
                      >
                        <div className="cal-day">
                          <b>{Number(d.slice(8))}</b>
                          {items.length > 0 && (
                            <span className="sum">
                              <Amount value={-sumOf(items)} ccy={base} decimals={0} />
                            </span>
                          )}
                        </div>
                        <div className="cal-icons" style={{ '--m0': `${fits(shown.length) ? 3 : step - icon}px` } as Record<string, string>}>
                          {shown.map((c, i) => (
                            <span
                              key={c.sub.id}
                              style={{ '--i': i } as Record<string, number>}
                              {...tipProps(() => `${c.sub.name}\n${flow(-c.amount, c.currency)}`)}
                            >
                              <SubIcon sub={c.sub} size={24} />
                            </span>
                          ))}
                          {items.length > shown.length && <span className="cal-more">+{items.length - shown.length}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              {sel && hasSelection ? (
                <div className="stack cal-selection" ref={selection}>
                  <section className="cal-dayhead">
                    <CardTitle as="h3" hint={t('report.cash.fullPaidHint')}>
                      {copyParts(`${cnDate(sel, true)}\n${relDays(diffDays(today, sel))}`)}
                    </CardTitle>
                  </section>
                  <div className="cal-daycards">
                    {selList.map((c, i) => {
                      const amt = pair(-c.amount, c.currency, { value: -chargeValue(state, c) });
                      const sub = state.subscriptions.find((s) => s.id === c.sub.id) ?? c.sub;
                      const cur = currentPhase(sub, today);
                      const status = effectiveStatus(sub, today);
                      const next = nextCharge(sub, addDays(today, 1));
                      const period = c.kind !== 'refund' && c.sub.cycle.unit !== 'lifetime' ? billingPeriod(c.sub, c.date) : undefined;
                      const endedOn = cur.stop?.date ?? cur.end;
                      const stopped = !state.readonly && c.kind !== 'refund' && stopLabel(cur, today);
                      return (
                        <button key={`${c.sub.id}-${i}`} className="card cal-daycard" onClick={() => onOpen(sub)}>
                          <SubIcon sub={sub} size={48} />
                          <span className="cal-dc-main">
                            <b>{sub.name}</b>
                            <span className="cal-dc-meta">
                              <PayBadge m={state.methods.find((m) => m.id === c.sub.methodId)} />
                              <span>{cycleLabel(c.sub.cycle)}</span>
                              {status !== 'active' && !(status === 'lifetime' && c.sub.cycle.unit === 'lifetime') && (
                                <span className="badge">{t(`list.status.${status}`)}</span>
                              )}
                              {c.kind === 'refund' && <span className="badge green">{t('detail.charges.kind.refund')}</span>}
                            </span>
                          </span>
                          <span className="cal-dc-info">
                            {c.sub.cycle.unit === 'lifetime' && c.kind !== 'refund' && (
                              <small>
                                {t('editor.field.purchased')} <span className="copy-gap" aria-hidden="true" /> {cnDateAuto(c.sub.start, today)}
                              </small>
                            )}
                            {period && (
                              <small>
                                {cnDateAuto(period.from, today)} – {cnDateAuto(period.paidThrough, today)}
                              </small>
                            )}
                            {status === 'paused' ? (
                              cur.pausedAt && (
                                <small>
                                  {t('detail.ev.paused')} <span className="copy-gap" aria-hidden="true" /> {cnDateAuto(cur.pausedAt, today)}
                                </small>
                              )
                            ) : ['ended', 'terminated'].includes(status) ? (
                              endedOn && <small>{t('list.endedOn', { date: cnDateAuto(endedOn, today) })}</small>
                            ) : status === 'ending' && cur.end ? (
                              <small>{t('core.stop.paidThrough', { date: cnDateAuto(cur.end, today) })}</small>
                            ) : next && next !== c.date ? (
                              // 下次扣款就是选中的这一天时，标题已写明日期，不再重复
                              <small>{copyParts(t('calendar.nextCharge', { date: cnDateAuto(next, today) }))}</small>
                            ) : null}
                            {stopped && (
                              <small title={stopDescription(cur, today)}>
                                <StopText sub={cur} today={today} />
                              </small>
                            )}
                          </span>
                          <span className="cal-dc-amt">
                            {amt.main}
                            {/* 已扣/预计与原币合成一行：「预计 · −₺499.99」 */}
                            {(amt.alt || c.kind !== 'refund') && (
                              <small>
                                {copyParts(
                                  [c.kind !== 'refund' && (c.projected ? t('calendar.projected') : t('calendar.charged')), amt.alt].filter(Boolean).join('\n'),
                                )}
                              </small>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : !sel && reportMode !== 'full' ? (
                <div className="cal-none">{t('calendar.pickDay')}</div>
              ) : null}
              {reportMode === 'full' && report && (
                <ScopeReport
                  key={month}
                  report={report}
                  state={state}
                  today={today}
                  onOpen={onOpen}
                  title={t('scope.monthTitle', { month: monthLabel(month, { long: true }) })}
                  animate={true}
                  open={true}
                  onToggle={() => setReportMode('mini')}
                  selectedChargeDate={sel ?? undefined}
                />
              )}
            </div>
            <div className="stack">
              {reportMode === 'mini' && report && <MiniReport report={report} base={base} today={today} onExpand={() => setReportMode('full')} />}
              <section className="card cal-charges">
                <div className="card-h">
                  <CardTitle>{copyParts(t('calendar.monthAll', { month: monthLabel(month, { year: false }) }))}</CardTitle>
                </div>
                {monthCharges.length === 0 && <div className="cell muted">{t('calendar.noneMonth')}</div>}
                <div className="cal-charge-list">
                  {[...byDay]
                    .filter(([date]) => date.startsWith(month))
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([date, items]) => (
                      <section key={date} data-date={date} className="cal-charge-group">
                        <h4 className={`cal-charge-day ${date === today ? 'today' : ''}`} aria-label={cnDate(date, true)}>
                          <span>{Number(date.slice(8))}</span>
                          <i aria-hidden="true" />
                        </h4>
                        {items.map((c, i) => {
                          const amt = pair(-c.amount, c.currency, { value: -chargeValue(state, c) });
                          return (
                            <button
                              type="button"
                              className="cal-charge-row"
                              key={c.sub.id + date + i}
                              onClick={() => onOpen(state.subscriptions.find((s) => s.id === c.sub.id) ?? c.sub)}
                            >
                              <span className="row cal-name">
                                <SubIcon sub={c.sub} size={24} />
                                <span>{c.sub.name}</span>
                              </span>
                              <span className="cal-charge-amount" title={amt.alt}>
                                {amt.main}
                              </span>
                            </button>
                          );
                        })}
                      </section>
                    ))}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function YearHeat({
  year,
  byDay,
  today,
  sumOf,
  base,
  onPick,
}: {
  year: string;
  byDay: Map<string, Charge[]>;
  today: string;
  sumOf: (l?: Charge[]) => number;
  base: string;
  onPick: (m: string) => void;
}) {
  const DOW = dows();
  return (
    <div className="heat">
      {Array.from({ length: 12 }, (_, i) => {
        const m = `${year}-${String(i + 1).padStart(2, '0')}`;
        // 固定 6 行，让 12 张月卡等高对齐
        const grid = Array.from({ length: 42 }, (_, k) => addDays(monthGrid(m)[0], k));
        const days = grid.filter((d) => d.startsWith(m));
        const total = days.reduce((a, d) => a + sumOf(byDay.get(d)), 0);
        const count = days.reduce((a, d) => a + (byDay.get(d)?.length ?? 0), 0);
        return (
          <button key={m} className={`heat-m ${today.startsWith(m) ? 'cur' : ''} ${m < today.slice(0, 7) ? 'past' : ''}`} onClick={() => onPick(m)}>
            <div className="heat-h">
              {monthLabel(m, { year: false })}
              <span>
                {copyParts(count ? t('calendar.heatCount', { count }) : '')}
                {flow(-total, base, { compact: true })}
              </span>
            </div>
            <div className="heat-g">
              {DOW.map((w, k) => (
                <em key={k}>{w}</em>
              ))}
              {grid.map((d) => {
                if (!d.startsWith(m)) return <i key={d} className="hd out" />;
                const list = (byDay.get(d) ?? []).slice().sort((x, y) => y.amount - x.amount);
                const cls = `hd ${d === today ? 'today' : ''} ${list.length ? 'has' : ''} ${d < today ? 'gone' : ''}`;
                if (!list.length)
                  return (
                    <i key={d} className={cls}>
                      {Number(d.slice(8))}
                    </i>
                  );
                return (
                  <i
                    key={d}
                    className={cls}
                    {...tipProps(() => (
                      <>
                        <b>{cnDate(d, true)}</b>
                        {list.map((c) => (
                          <div key={c.sub.id}>
                            {c.sub.name} <span className="copy-gap" aria-hidden="true" /> {flow(-c.amount, c.currency)}
                          </div>
                        ))}
                      </>
                    ))}
                  >
                    {/* 同一天多笔：只画第一个图标，右上角标出总笔数（格子太小，叠起来只剩一道边） */}
                    <span className="hd-stack">
                      <SubIcon sub={list[0].sub} size={20} />
                      {list.length > 1 && <b className="hd-more">{list.length}</b>}
                    </span>
                  </i>
                );
              })}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** 月度净现金只读 monthReport 的结果，迷你和完整报告共用同一口径。 */
function MiniReport({ report, base, today, onExpand }: { report: ReturnType<typeof monthReport>; base: string; today: string; onExpand: () => void }) {
  const headline = report.blocks.find((b) => b.type === 'headline');
  if (!headline || headline.mode !== 'month') return null;
  const peak = Math.max(1, ...report.months.map((r) => Math.abs(r.paid) + Math.abs(r.pending)));
  return (
    <section className="card cal-stat">
      <div className="cal-mini-head">
        <CardTitle as="span" hint={t('scope.cashBasis')}>
          {t('scope.monthTotal')}
        </CardTitle>
        <IconButton type="button" className="cal-expand" aria-label={t('calendar.expandReport')} title={t('calendar.expandReport')} onClick={onExpand}>
          <Maximize2 size={15} />
        </IconButton>
      </div>
      <div className="cal-stat-big">
        <b className={headline.total < 0 ? 'green' : undefined}>{flow(-headline.total, base)}</b>
      </div>
      <div className="cal-stat-split">
        <div>
          <small>{t('scope.paid')}</small>
          <b>{flow(-headline.paid, base)}</b>
        </div>
        <div>
          <small>{t('scope.pending')}</small>
          <b>{flow(-headline.pending, base)}</b>
        </div>
      </div>
      <div className="cal-comparisons">
        <div>
          <span>{t('scope.previousMonth')}</span>
          <SpendingDelta value={headline.previous} base={base} />
        </div>
        {headline.yearly && (
          <div>
            <span>{t('scope.previousYear')}</span>
            <SpendingDelta value={headline.yearly} base={base} />
          </div>
        )}
      </div>
      <div className="cal-mini-chart">
        {report.months.map((r) => (
          <div
            key={r.month}
            role="img"
            aria-label={`${monthLabel(r.month)}\n${flow(-r.total, base)}`}
            className={`cal-mini-month ${r.month === headline.month ? 'current' : ''}`}
            {...tipProps(
              () => `${monthLabel(r.month)}\n${flow(-r.total, base)}${r.month >= today.slice(0, 7) && r.pending !== 0 ? `\n${t('scope.forecast')}` : ''}`,
            )}
          >
            <div className={`cal-mini-bars ${report.months.some((m) => m.paid < 0 || m.pending < 0) ? 'signed' : ''}`}>
              <div className="cal-mini-positive">
                <i style={{ height: `${(Math.max(0, r.paid) / peak) * 100}%` }} />
                <i className="forecast" style={{ height: `${(Math.max(0, r.pending) / peak) * 100}%` }} />
              </div>
              <div className="cal-mini-negative">
                <i style={{ height: `${(Math.max(0, -r.paid) / peak) * 100}%` }} />
                <i className="forecast" style={{ height: `${(Math.max(0, -r.pending) / peak) * 100}%` }} />
              </div>
            </div>
            <small>{monthLabel(r.month, { year: false })}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
