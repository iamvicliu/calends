import { useState, type ReactNode } from 'react';
import { diffDays, durationLabel } from '../../../shared/billing.ts';
import { cnDateAuto, flow } from '../../../shared/format.ts';
import { amountTotal, formatTotal, totalNote } from '../../../shared/fx-total.ts';
import { t } from '../../../shared/i18n.ts';
import type { Block, ScopeReport } from '../../../shared/scope-report.ts';
import type { AppState, Subscription } from '../../../shared/types.ts';
import { Gantt } from '../views/Gantt.tsx';
import { Composition } from './Composition.tsx';
import { MetricCards, Metric, CardTitle } from './ui.tsx';
import { SubIcon } from './marks.tsx';

/** Lifecycle presentation is exclusive to list selections; calendar blocks retain their renderer. */
export function ScopeLifecycleReport({
  report,
  state,
  today,
  onOpen,
  id,
  copying,
  actions,
  renderBlock,
}: {
  report: ScopeReport;
  state: AppState;
  today: string;
  onOpen: (s: Subscription) => void;
  id: string;
  copying: boolean;
  actions: ReactNode;
  renderBlock: (block: Block) => ReactNode;
}) {
  const [allEvents, setAllEvents] = useState(false);
  const data = report.lifecycle!;
  const base = state.settings.baseCurrency;
  const head = report.blocks.find((b) => b.type === 'headline');
  const trend = report.blocks.find((b) => b.type === 'trend');
  const events = report.blocks.find((b) => b.type === 'events');
  const upcoming = report.blocks.find((b) => b.type === 'upcoming');
  const mrr = head?.mode === 'scope' ? head.partial?.mrr : undefined;
  const count = (n: number) => t('scope.lifecycle.times', { count: n });
  const amount = (total: Parameters<typeof formatTotal>[0], direction: 1 | -1 = -1) => formatTotal(total, base, { direction, main: true });
  return (
    <div id={id} className="scope-grid scope-lifecycle">
      <div className="scope-headline scope-block">
        {actions}
        <MetricCards>
          <Metric label={t('scope.totalSpent')} value={amount(data.spent)} note={totalNote(data.spent) || t('scope.totalBasis')} />
          <Metric
            label={t('scope.monthly')}
            value={data.activeCount ? (mrr ? amount(mrr) : flow(0, base)) : '—'}
            note={
              data.activeCount && head?.mode === 'scope'
                ? `${t('scope.previousEnd')} / ${flow(-head.change.amount, base)}`
                : t(data.stoppedCount === data.timeline.length + data.omitted ? 'scope.lifecycle.allStopped' : 'scope.lifecycle.noActive')
            }
          />
          <Metric
            label={t(data.terminatedCount ? 'core.stop.terminate' : 'scope.lifecycle.stopped')}
            value={count(data.terminatedCount || data.stoppedCount)}
            note={
              <span className={data.terminatedCount ? (data.terminationLoss.value > 0 || data.terminationLoss.incomplete ? 'red' : '') : 'green'}>
                {t(data.terminatedCount ? 'report.stops.loss' : 'report.stops.saved')} /{' '}
                {amount(data.terminatedCount ? data.terminationLoss : data.saved, data.terminatedCount ? -1 : 1)}
              </span>
            }
          />
          <Metric label={t('scope.lifecycle.averageDuration')} value={durationLabel(data.averageDays)} />
        </MetricCards>
      </div>
      {data.timeline.length > 0 && (
        <div className="card scope-block scope-alone">
          <div className="card-h">
            <CardTitle>{t('list.view.gantt')}</CardTitle>
          </div>
          <Gantt rows={data.timeline} state={state} today={today} onOpen={onOpen} compact />
          {data.omitted > 0 && <p className="scope-note">{t('scope.lifecycle.omitted', { count: data.omitted })}</p>}
        </div>
      )}
      {(data.stops.length > 0 || data.saved.value > 0 || data.saved.incomplete) && (
        <div className="card scope-block scope-losses stop-report">
          <div className="card-h">
            <CardTitle>{t('report.stops.title')}</CardTitle>
          </div>
          <MetricCards inline>
            <Metric
              label={t('report.stops.saved')}
              value={amount(data.saved, 1)}
              valueClassName="green"
              note={totalNote(data.saved) || t('report.stops.savedHint')}
            />
            <Metric
              label={t('report.stops.loss')}
              value={amount(data.loss)}
              valueClassName={data.loss.value > 0 || data.loss.incomplete ? 'loss' : ''}
              note={totalNote(data.loss) || t('report.stops.lossHint')}
            />
          </MetricCards>
          <div className="stop-list">
            {data.stops.map((r) => (
              <button type="button" key={`${r.sub.id}-${r.phaseIndex}`} className="stop-row" onClick={() => onOpen(r.sub)}>
                <SubIcon sub={r.sub} size={32} proxied />
                <span className="stop-info">
                  <b>{r.sub.name}</b>
                  <small>
                    {cnDateAuto(r.date, today)} / {t(r.kind === 'terminate' ? 'core.stop.terminate' : 'report.stops.cancel')}
                  </small>
                  <small>
                    {t('scope.lifecycle.used', { span: durationLabel(Math.max(0, diffDays(r.phase.start, r.date))) })} /{' '}
                    {r.date === r.paidThrough
                      ? t('scope.lifecycle.noUnused')
                      : t('scope.lifecycle.unused', { count: Math.max(0, diffDays(r.date, r.paidThrough)) })}
                  </small>
                  {r.reason && <small>{r.reason}</small>}
                </span>
                <span className="stop-amount">
                  <b className={r.loss > 0 ? 'red' : ''}>
                    {r.loss > 0 ? amount(amountTotal(r.loss, r.currency, r.lossBase)) : t(r.refunded > 0 ? 'scope.refunded' : 'scope.lifecycle.noLoss')}
                  </b>
                  {r.loss > 0 && r.currency !== base && <small>{flow(-r.loss, r.currency)}</small>}
                  {r.refunded > 0 && (
                    <small className="green">
                      {t('scope.refunded')} / {amount(amountTotal(r.refunded, r.currency, r.refundedBase), 1)}
                    </small>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {trend && <div className="card scope-block scope-cash">{renderBlock(trend)}</div>}
      {data.spending.length > 0 && (
        <Composition
          state={state}
          today={today}
          onOpen={onOpen}
          spending={data.spending}
          className={`scope-block ${trend ? 'scope-spending' : 'scope-alone'}`}
        />
      )}
      {events && (
        <div className="card scope-block scope-events">
          {renderBlock({ ...events, rows: allEvents || copying ? events.rows : events.rows.slice(0, 6) })}
          {events.rows.length > 6 && !copying && (
            <button type="button" className="btn plain" aria-expanded={allEvents} onClick={() => setAllEvents(!allEvents)}>
              {allEvents ? t('report.checkup.less') : t('report.checkup.more', { count: events.rows.length - 6 })}
            </button>
          )}
        </div>
      )}
      {upcoming && <div className="card scope-block scope-alone">{renderBlock(upcoming)}</div>}
    </div>
  );
}
