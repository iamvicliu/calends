import { useId, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { ChevronUp, Copy } from 'lucide-react';
import { cnDateAuto, flow, money, monthLabel } from '../../../shared/format.ts';
import { intlLocale, t } from '../../../shared/i18n.ts';
import type { Block, ChargeRow, Comparison, ScopeReport as ReportData } from '../../../shared/scope-report.ts';
import type { AppState, Subscription } from '../../../shared/types.ts';
import { snapshot } from '../snapshot.ts';
import { run } from '../store.ts';
import { catColor } from '../derive.ts';
import { BarLine } from './charts.tsx';
import { CatIcon, Hint, Icon, MethodMark, SubIcon } from './ui.tsx';
import './scope-report.css';

interface Props {
  report: ReportData;
  state: AppState;
  today: string;
  onOpen: (sub: Subscription) => void;
  title: string;
  animate: boolean;
  open: boolean;
  onToggle: () => void;
}

/** Spending increases use the same direction and unsigned comparison in both calendar modes. */
export function SpendingDelta({ value, base }: { value: Comparison; base: string }) {
  const direction = value.amount > 0.005 ? 'up' : value.amount < -0.005 ? 'down' : '';
  return (
    <span className={`chip-d ${direction}`}>
      {direction === 'up' ? '↑' : direction === 'down' ? '↓' : '·'} {money(Math.abs(value.amount), base)}
      {value.percent != null && ` · ${new Intl.NumberFormat(intlLocale(), { style: 'percent', maximumFractionDigits: 1 }).format(Math.abs(value.percent))}`}
    </span>
  );
}

/** Shared presentation for subscription selections and calendar months; callers own disclosure state. */
export function ScopeReport({ report, state, today, onOpen, title, animate, open, onToggle }: Props) {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'done'>('idle');
  const copying = copyState === 'copying';
  const expanded = open || copying;
  const copyImage = () => {
    if (!root.current || copying) return;
    const el = root.current;
    // 同步关闭动画并锁定操作，以便 Safari 在点击内创建 ClipboardItem。
    flushSync(() => setCopyState('copying'));
    const blob = (async () => {
      try {
        // 等待图表布局稳定，组装动画在复制后保持关闭。
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const image = await snapshot(el, {
          width: el.offsetWidth + 40,
          height: el.offsetHeight + 40,
          style: { backgroundColor: getComputedStyle(el).getPropertyValue('--bg'), padding: '20px', borderRadius: '20px' },
          filter: (n) => !(n instanceof Element && n.matches('.scope-actions')),
        });
        if (!image) throw new Error(t('ui.error.requestFailed', { status: 'PNG' }));
        return image;
      } finally {
        setCopyState('done');
      }
    })();
    void run(() => navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]), t('detail.toast.imageCopied'));
  };
  const base = state.settings.baseCurrency;
  const monthly = report.blocks.some((b) => b.type === 'headline' && b.mode === 'month');
  const top = report.blocks.find((b) => b.type === 'top' && b.mode === 'month');
  const upcomingRows = (rows: ChargeRow[]) => rows.filter((r) => !top?.rows.includes(r));
  const blocks = report.blocks.filter((b) =>
    b.type === 'upcoming' ? upcomingRows(b.rows).length > 0 : !(b.type === 'top' && b.mode === 'scope' && b.rows.length === 1),
  );
  const losses = report.blocks.find((b) => b.type === 'losses');
  const expense = (v: number) => flow(-v, base);
  const income = (v: number) => flow(v, base);
  const percent = (v: number) => new Intl.NumberFormat(intlLocale(), { style: 'percent', maximumFractionDigits: 1 }).format(Math.abs(v));
  const delta = (value: Comparison) => <SpendingDelta value={value} base={base} />;
  const fact = (label: string, value: ReactNode) => (
    <div>
      <b className="num">{value}</b>
      <span>{label}</span>
    </div>
  );
  const name = (sub: Subscription, meta?: ReactNode) => (
    <span className="scope-sub">
      <SubIcon sub={sub} size={24} proxied />
      <span>
        <span className="scope-name">{sub.name}</span>
        {meta && <small>{meta}</small>}
      </span>
    </span>
  );
  const chargeRows = (rows: ChargeRow[]) =>
    rows.map((r, i) => (
      <button type="button" className="scope-row scope-tap" key={`${r.sub.id}-${r.date}-${i}`} onClick={() => onOpen(r.sub)}>
        {name(r.sub, cnDateAuto(r.date, today))}
        <b className="num">{expense(r.amount)}</b>
      </button>
    ));
  const heading = (key: string, hint?: string, count?: number) => (
    <div className="card-h">
      <h3>{t(`scope.${key}`, { count })}</h3>
      {hint && <Hint text={t(`scope.${hint}`)} />}
    </div>
  );
  const headlineHeading = (label: string, hint?: string) => (
    <div className="scope-headline-header">
      <div className="stat-label">
        {t(label)} {hint && <Hint text={t(hint)} />}
      </div>
      <div className="scope-actions">
        {typeof ClipboardItem !== 'undefined' && (
          <button
            type="button"
            className="icon-btn"
            title={t('detail.action.copyImage')}
            aria-label={t('detail.action.copyImage')}
            disabled={copying}
            onClick={copyImage}
          >
            <Copy size={15} />
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          title={t('scope.collapse')}
          aria-expanded={expanded}
          aria-controls={id}
          aria-label={t('scope.collapse')}
          onClick={onToggle}
          disabled={copying}
        >
          <ChevronUp size={15} />
        </button>
      </div>
    </div>
  );
  const render = (block: Block): ReactNode => {
    switch (block.type) {
      case 'headline':
        return block.mode === 'scope' ? (
          <>
            {headlineHeading('scope.monthly', 'scope.mrrBasis')}
            <div className="hero-num num">{expense(block.mrr)}</div>
            <div className="hero-delta">
              {delta(block.change)}
              <span className="muted">{t('scope.previousEnd')}</span>
            </div>
            <div className="hero-facts">
              {fact(t('scope.annual'), expense(block.annual))}
              {fact(t('scope.active'), block.activeCount)}
              {fact(t('scope.yearPaid'), expense(block.paid))}
              {(block.loss > 0 || !Number.isFinite(block.loss)) && block.loss !== losses?.loss && fact(t('scope.includedLoss'), expense(block.loss))}
            </div>
          </>
        ) : (
          <>
            {headlineHeading('scope.monthTotal', 'scope.cashBasis')}
            <div className={`hero-num num ${block.total < 0 ? 'green' : ''}`}>{expense(block.total)}</div>
            <div className="hero-delta">
              <span className="scope-comparison">
                {delta(block.previous)}
                <span className="muted">{t('scope.previousMonth')}</span>
              </span>
              {block.yearly && (
                <span className="scope-comparison">
                  {delta(block.yearly)}
                  <span className="muted">{t('scope.previousYear')}</span>
                </span>
              )}
            </div>
            <div className="hero-facts">
              {fact(t('scope.paid'), expense(block.paid))}
              {fact(t('scope.pending'), expense(block.pending))}
              {fact(t('scope.count'), block.count)}
            </div>
          </>
        );
      case 'trend': {
        if (block.mode === 'scope')
          return (
            <>
              {heading('cash', 'cashWindow')}
              <BarLine
                bars={block.rows.map((r) => r.cash)}
                line={[]}
                future={block.rows.map((r) => r.projected)}
                labels={block.rows.map((r) => monthLabel(r.month, { year: false }))}
                tip={(i) => (
                  <>
                    {monthLabel(block.rows[i].month)} · {expense(block.rows[i].cash)}
                    {block.rows[i].projected && ` · ${t('scope.forecast')}`}
                  </>
                )}
              />
              <details className="scope-chart-data">
                <summary>{t('scope.chartData')}</summary>
                {block.rows.map((r) => (
                  <div className="scope-row" key={r.month}>
                    <span>
                      {monthLabel(r.month)}
                      {r.projected && ` · ${t('scope.forecast')}`}
                    </span>
                    <b className="num">{expense(r.cash)}</b>
                  </div>
                ))}
              </details>
            </>
          );
        const mv = block.movement;
        const drivers = [
          { key: 'added', amount: mv.added },
          { key: 'expansion', amount: mv.expansion },
          { key: 'contraction', amount: -mv.contraction },
          { key: 'churned', amount: -mv.churned },
          { key: 'fx', amount: mv.fx },
        ].filter((r) => Math.abs(r.amount) >= 0.005);
        const peak = Math.max(1, ...drivers.map((r) => Math.abs(r.amount)));
        const net = mv.to - mv.from;
        const singleDriver = drivers.length === 1 && Math.abs(drivers[0].amount - net) < 0.005;
        const singleItem = mv.items.length === 1 && Math.abs(mv.items[0].delta - net) < 0.005;
        return (
          <>
            <div className="card-h">
              <h3>{t('scope.movement', { month: monthLabel(block.month) })}</h3>
            </div>
            <div className="hero-delta">
              {!singleDriver && delta({ amount: net })}
              <span className="muted">{t('scope.previousEnd')}</span>
            </div>
            <div className="mv-rows">
              {drivers.map((r) => (
                <div className={`mv-row ${r.amount > 0 ? 'up' : 'down'}`} key={r.key}>
                  <span>{t(`scope.${r.key}`)}</span>
                  <div className="mv-bar">
                    <i style={{ width: `${(Math.abs(r.amount) / peak) * 100}%` }} />
                  </div>
                  <b className="num">
                    {r.amount > 0 ? '↑' : '↓'} {money(Math.abs(r.amount), base)}
                  </b>
                </div>
              ))}
            </div>
            {mv.items.map((r) => (
              <button type="button" className="scope-row scope-tap" key={r.sub.id} onClick={() => onOpen(r.sub)}>
                {name(r.sub)}
                {!singleItem && <span>{delta({ amount: r.delta })}</span>}
              </button>
            ))}
          </>
        );
      }
      case 'composition':
        return (
          <>
            {heading('composition', monthly ? 'debitBasis' : undefined)}
            {(['categories', 'methods'] as const).map(
              (dim) =>
                block[dim].length > 0 && (
                  <div className="scope-composition" key={dim}>
                    <h4>{t(`scope.${dim}`)}</h4>
                    {block[dim].map((r) => {
                      const method = state.methods.find((m) => m.id === r.key);
                      const color = dim === 'categories' ? catColor(r.key) : 'var(--accent)';
                      return (
                        <div className="scope-share" key={r.key}>
                          <div className="scope-row">
                            <span className="scope-sub">
                              {dim === 'categories' ? (
                                <span className="scope-cat" style={{ color }}>
                                  <CatIcon cat={r.key} size={18} />
                                </span>
                              ) : method ? (
                                <MethodMark m={method} size={24} proxied />
                              ) : (
                                <Icon name="wallet" size={24} />
                              )}
                              <span>{dim === 'categories' ? r.key || t('scope.uncategorized') : (method?.name ?? t('scope.noMethod'))}</span>
                            </span>
                            <b className="num">
                              {expense(r.amount)} · {percent(r.share)}
                            </b>
                          </div>
                          <div className="mv-bar">
                            <i style={{ width: `${r.share * 100}%`, background: color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ),
            )}
          </>
        );
      case 'top':
        return (
          <>
            {heading(block.mode === 'scope' ? 'topMonthly' : 'topCharges', block.mode === 'month' ? 'debitBasis' : undefined, block.rows.length)}
            {block.mode === 'month'
              ? chargeRows(block.rows)
              : block.rows.map((r) => (
                  <button type="button" className="scope-row scope-tap" key={r.sub.id} onClick={() => onOpen(r.sub)}>
                    {name(r.sub)}
                    <b className="num">{expense(r.amount)}</b>
                  </button>
                ))}
          </>
        );
      case 'upcoming':
        return (
          <>
            {heading('upcoming')}
            {!monthly && block.rows.length > 1 && <p className="scope-note num">{expense(block.total)}</p>}
            {chargeRows(upcomingRows(block.rows))}
          </>
        );
      case 'events':
        return (
          <>
            {heading('events')}
            {block.rows.map((r, i) => (
              <button type="button" className="scope-row scope-tap" key={`${r.sub.id}-${r.date}-${r.kind}-${i}`} onClick={() => onOpen(r.sub)}>
                {name(
                  r.sub,
                  <>
                    {cnDateAuto(r.date, today)} ·{' '}
                    {t(`scope.event.${r.kind === 'price' || r.kind === 'intro-end' ? (r.delta >= 0 ? 'increase' : 'decrease') : r.kind}`)}
                  </>,
                )}
                {r.delta !== 0 && delta({ amount: r.delta })}
              </button>
            ))}
          </>
        );
      case 'losses':
        return (
          <>
            {heading('losses')}
            <div className="hero-facts scope-facts">
              {block.rows.length > 1 && fact(t('scope.loss'), expense(block.loss))}
              {block.refunds.length > 1 && fact(t('scope.refunded'), income(block.refunded))}
            </div>
            {block.incomplete && <p className="scope-note red">{t('scope.incomplete')}</p>}
            {block.rows.map((r) => (
              <button type="button" className="scope-row scope-tap" key={`${r.sub.id}-${r.phaseIndex}`} onClick={() => onOpen(r.sub)}>
                {name(
                  r.sub,
                  <>
                    {cnDateAuto(r.date, today)} · {t(`scope.event.${r.kind === 'terminate' ? 'terminate' : 'cancel'}`)}
                  </>,
                )}
                <span>
                  <b className="num">{expense(r.lossBase)}</b>
                  {r.currency !== base && <small>{flow(-r.loss, r.currency)}</small>}
                </span>
              </button>
            ))}
            {block.refunds.map((r, i) => (
              <button type="button" className="scope-row scope-tap" key={`refund-${r.sub.id}-${r.date}-${i}`} onClick={() => onOpen(r.sub)}>
                {name(
                  r.sub,
                  <>
                    {cnDateAuto(r.date, today)} · {t('scope.refunded')}
                  </>,
                )}
                <b className="num green">{income(-r.amount)}</b>
              </button>
            ))}
          </>
        );
      case 'sharing':
        return (
          <>
            {heading('sharing', 'sharingBasis')}
            {block.rows.length > 1 && (
              <div className="hero-facts scope-facts">
                {block.received !== 0 && fact(t('scope.received'), income(block.received))}
                {block.owed > 0 && fact(t('scope.owed'), income(block.owed))}
              </div>
            )}
            {block.rows.map((r) => (
              <button type="button" className="scope-row scope-tap" key={r.sub.id} onClick={() => onOpen(r.sub)}>
                {name(r.sub)}
                <span>
                  {r.received !== 0 && <b className="num green">{t('scope.receivedAmount', { amount: income(r.received) })}</b>}
                  {r.owed > 0 && <small className="num">{t('scope.owedAmount', { amount: income(r.owed) })}</small>}
                </span>
              </button>
            ))}
          </>
        );
    }
  };
  return (
    <section ref={root} className={`scope-report ${animate && copyState === 'idle' ? 'scope-animate' : ''}`} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="scope-header">
        {expanded ? (
          <span className="scope-title">{title}</span>
        ) : (
          <button type="button" className="scope-trigger" aria-expanded={false} aria-controls={id} onClick={onToggle}>
            {t('scope.expand')} · {title}
          </button>
        )}
      </h2>
      {expanded && (
        <div id={id} className="scope-grid">
          {blocks.map((block, i) => (
            <div className={`card scope-block scope-${block.type}`} key={block.type} style={{ animationDelay: `${i * 65}ms` }}>
              {render(block)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
