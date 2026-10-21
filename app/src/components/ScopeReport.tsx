import { useId, type ReactNode } from 'react';
import { cnDateAuto, flow, money, monthLabel } from '../../../shared/format.ts';
import { intlLocale, t } from '../../../shared/i18n.ts';
import type { Block, ChargeRow, Comparison, ScopeReport as ReportData } from '../../../shared/scope-report.ts';
import type { AppState, Subscription } from '../../../shared/types.ts';
import { BarLine } from './charts.tsx';
import { Icon } from './ui.tsx';
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

/** Shared presentation for subscription selections and calendar months; callers own disclosure state. */
export function ScopeReport({ report, state, today, onOpen, title, animate, open, onToggle }: Props) {
  const id = useId();
  const base = state.settings.baseCurrency;
  const expense = (v: number) => flow(-v, base);
  const income = (v: number) => flow(v, base);
  const percent = (v: number) => new Intl.NumberFormat(intlLocale(), { style: 'percent', maximumFractionDigits: 1 }).format(Math.abs(v));
  const delta = (value: Comparison) => (
    <span className={`chip-d ${value.amount > 0.005 ? 'up' : value.amount < -0.005 ? 'down' : ''}`}>
      {value.amount > 0.005 ? '↑' : value.amount < -0.005 ? '↓' : '·'} {money(Math.abs(value.amount), base)}
      {value.percent != null && ` · ${percent(value.percent)}`}
    </span>
  );
  const fact = (label: string, value: ReactNode) => (
    <div>
      <b className="num">{value}</b>
      <span>{label}</span>
    </div>
  );
  const name = (sub: Subscription) => (
    <button type="button" className="scope-name" onClick={() => onOpen(sub)}>
      {sub.name}
    </button>
  );
  const chargeRows = (rows: ChargeRow[]) =>
    rows.map((r, i) => (
      <div className="scope-row" key={`${r.sub.id}-${r.date}-${i}`}>
        <div>
          {name(r.sub)}
          <small>{cnDateAuto(r.date, today)}</small>
        </div>
        <b className="num">{expense(r.amount)}</b>
      </div>
    ));
  const heading = (key: string) => (
    <div className="card-h">
      <h3>{t(`scope.${key}`)}</h3>
    </div>
  );
  const render = (block: Block): ReactNode => {
    switch (block.type) {
      case 'headline':
        return block.mode === 'scope' ? (
          <>
            <div className="stat-label">{t('scope.monthly')}</div>
            <div className="hero-num num">{expense(block.mrr)}</div>
            <div className="hero-delta">
              {delta(block.change)}
              <span className="muted">{t('scope.previousEnd')}</span>
            </div>
            <div className="hero-facts">
              {fact(t('scope.annual'), expense(block.annual))}
              {fact(t('scope.active'), block.activeCount)}
              {fact(t('scope.yearPaid'), expense(block.paid))}
              {(block.loss > 0 || !Number.isFinite(block.loss)) && fact(t('scope.includedLoss'), expense(block.loss))}
            </div>
          </>
        ) : (
          <>
            <div className="stat-label">{t('scope.monthTotal')}</div>
            <div className="hero-num num">{expense(block.total)}</div>
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
            <p className="scope-note">{t('scope.cashBasis')}</p>
          </>
        );
      case 'trend': {
        if (block.mode === 'scope')
          return (
            <>
              {heading('cash')}
              <p className="scope-note">{t('scope.cashWindow')}</p>
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
        return (
          <>
            <div className="card-h">
              <h3>{t('scope.movement', { month: monthLabel(block.month) })}</h3>
            </div>
            <div className="hero-delta">
              {delta({ amount: mv.to - mv.from })}
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
              <div className="scope-row" key={r.sub.id}>
                {name(r.sub)}
                <span>{delta({ amount: r.delta })}</span>
              </div>
            ))}
          </>
        );
      }
      case 'composition':
        return (
          <>
            {heading('composition')}
            {(['categories', 'methods'] as const).map(
              (dim) =>
                block[dim].length > 0 && (
                  <div className="scope-composition" key={dim}>
                    <h4>{t(`scope.${dim}`)}</h4>
                    {block[dim].map((r) => (
                      <div className="scope-share" key={r.key}>
                        <div className="scope-row">
                          <span>
                            {dim === 'categories'
                              ? r.key || t('scope.uncategorized')
                              : (state.methods.find((m) => m.id === r.key)?.name ?? t('scope.noMethod'))}
                          </span>
                          <b className="num">
                            {expense(r.amount)} · {percent(r.share)}
                          </b>
                        </div>
                        <div className="mv-bar">
                          <i style={{ width: `${r.share * 100}%`, background: 'var(--accent)' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ),
            )}
          </>
        );
      case 'top':
        return (
          <>
            {heading(block.mode === 'scope' ? 'topMonthly' : 'topCharges')}
            {block.mode === 'month'
              ? chargeRows(block.rows)
              : block.rows.map((r) => (
                  <div className="scope-row" key={r.sub.id}>
                    {name(r.sub)}
                    <b className="num">{expense(r.amount)}</b>
                  </div>
                ))}
          </>
        );
      case 'upcoming':
        return (
          <>
            {heading('upcoming')}
            <p className="scope-note num">{expense(block.total)}</p>
            {chargeRows(block.rows)}
          </>
        );
      case 'events':
        return (
          <>
            {heading('events')}
            {block.rows.map((r, i) => (
              <div className="scope-row" key={`${r.sub.id}-${r.date}-${r.kind}-${i}`}>
                <div>
                  {name(r.sub)}
                  <small>
                    {cnDateAuto(r.date, today)} ·{' '}
                    {t(`scope.event.${r.kind === 'price' || r.kind === 'intro-end' ? (r.delta >= 0 ? 'increase' : 'decrease') : r.kind}`)}
                  </small>
                </div>
                {r.delta !== 0 && delta({ amount: r.delta })}
              </div>
            ))}
          </>
        );
      case 'losses':
        return (
          <>
            {heading('losses')}
            <div className="hero-facts scope-facts">
              {block.rows.length > 0 && fact(t('scope.loss'), expense(block.loss))}
              {block.refunds.length > 0 && fact(t('scope.refunded'), income(block.refunded))}
            </div>
            {block.incomplete && <p className="scope-note red">{t('scope.incomplete')}</p>}
            {block.rows.map((r) => (
              <div className="scope-row" key={`${r.sub.id}-${r.phaseIndex}`}>
                <div>
                  {name(r.sub)}
                  <small>
                    {cnDateAuto(r.date, today)} · {t(`scope.event.${r.kind === 'terminate' ? 'terminate' : 'cancel'}`)}
                  </small>
                </div>
                <div>
                  <b className="num">{expense(r.lossBase)}</b>
                  {r.currency !== base && <small>{flow(-r.loss, r.currency)}</small>}
                </div>
              </div>
            ))}
            {block.refunds.map((r, i) => (
              <div className="scope-row" key={`refund-${r.sub.id}-${r.date}-${i}`}>
                <div>
                  {name(r.sub)}
                  <small>
                    {cnDateAuto(r.date, today)} · {t('scope.refunded')}
                  </small>
                </div>
                <b className="num green">{income(-r.amount)}</b>
              </div>
            ))}
          </>
        );
      case 'sharing':
        return (
          <>
            {heading('sharing')}
            <div className="hero-facts scope-facts">
              {block.received !== 0 && fact(t('scope.received'), income(block.received))}
              {block.owed > 0 && fact(t('scope.owed'), income(block.owed))}
            </div>
            <p className="scope-note">{t('scope.sharingBasis')}</p>
            {block.rows.map((r) => (
              <div className="scope-row" key={r.sub.id}>
                {name(r.sub)}
                <div>
                  {r.received !== 0 && <b className="num green">{t('scope.receivedAmount', { amount: income(r.received) })}</b>}
                  {r.owed > 0 && <small className="num">{t('scope.owedAmount', { amount: income(r.owed) })}</small>}
                </div>
              </div>
            ))}
          </>
        );
    }
  };
  return (
    <section className={`scope-report ${animate ? 'scope-animate' : ''}`} aria-labelledby={`${id}-title`}>
      <header className="scope-header">
        <h2 id={`${id}-title`}>{title}</h2>
        <button
          type="button"
          className="icon-btn"
          aria-expanded={open}
          aria-controls={id}
          aria-label={t(open ? 'scope.collapse' : 'scope.expand')}
          onClick={onToggle}
        >
          <span className={open ? 'scope-chevron open' : 'scope-chevron'}>
            <Icon name="down" />
          </span>
        </button>
      </header>
      {open && (
        <div id={id} className="scope-grid">
          {report.blocks.map((block, i) => (
            <div className={`card scope-block scope-${block.type}`} key={block.type} style={{ animationDelay: `${i * 65}ms` }}>
              {render(block)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
