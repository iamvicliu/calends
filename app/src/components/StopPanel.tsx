import { useState } from 'react';
import { billingPeriod, currentPhase, effectiveStatus, phaseSubs, stopSummary } from '../../../shared/billing.ts';
import { cnDateFull, money } from '../../../shared/format.ts';
import { t } from '../../../shared/i18n.ts';
import { cancelAtEnd, reactivate, stopSubscription } from '../../../shared/phases.ts';
import type { Subscription } from '../../../shared/types.ts';
import { toast } from '../store.ts';
import { DatePicker } from './DatePicker.tsx';
import { CurrencySelect, Picker } from './Picker.tsx';
import { Cell } from './ui.tsx';

type Mode = 'nonrenew' | 'cancel' | 'terminate';

export function stopLabel(sub: Subscription, today: string): string | undefined {
  const summary = stopSummary(sub, today);
  if (!summary || summary.date > today) return undefined;
  if (summary.refunded > 0)
    return t(summary.refundStatus === 'full' ? 'core.stop.refunded' : 'core.stop.partial', { money: money(summary.refunded, sub.currency) });
  return summary.unusedValue > 0 ? t('core.stop.unrefunded', { money: money(summary.unusedValue, sub.currency) }) : t('core.stop.refundNo');
}

export function stopDescription(sub: Subscription, today: string): string {
  const summary = stopSummary(sub, today);
  if (!summary) return '';
  return [
    cnDateFull(summary.date),
    t(summary.kind === 'terminate' ? 'core.stop.terminate' : 'core.stop.cancel'),
    summary.reason ? `(${summary.reason})` : '',
    summary.refundStatus === 'full'
      ? t('core.stop.fullyRefunded')
      : summary.refunded > 0
        ? t('core.stop.partial', { money: money(summary.refunded, sub.currency) })
        : t('core.stop.refundNo'),
    summary.unusedValue > 0
      ? t('core.stop.unused', { days: t('core.stop.lossDays', { count: summary.wastedDays }), money: money(summary.unusedValue, sub.currency) })
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function StopBadge({ sub, today, readonly }: { sub: Subscription; today: string; readonly?: boolean }) {
  const cur = currentPhase(sub, today);
  const label = readonly ? undefined : stopLabel(cur, today);
  return label ? (
    <span className="badge stop-badge" title={stopDescription(cur, today)}>
      {label}
    </span>
  ) : null;
}

/** 作为草稿应用到编辑器，或由详情的弹层保存。所有金额与校验复用 shared。 */
export function StopPanel({ sub, today, onApply }: { sub: Subscription; today: string; onApply: (s: Subscription) => void }) {
  const [mode, setMode] = useState<Mode>('nonrenew');
  const [date, setDate] = useState(sub.end ?? billingPeriod(currentPhase(sub, today), today).paidThrough);
  const [refund, setRefund] = useState(false);
  const [amount, setAmount] = useState<string | undefined>();
  const [refundDate, setRefundDate] = useState<string | undefined>();
  const [reason, setReason] = useState('');
  const [settled, setSettled] = useState('');
  const [settledCurrency, setSettledCurrency] = useState('USD');
  const cur = currentPhase(sub, date);
  const period = billingPeriod(cur, date < today ? date : today);
  const preview = stopSummary({ ...cur, stop: { kind: mode === 'terminate' ? 'terminate' : 'cancel', date, paidThrough: period.paidThrough } });
  const ended = ['ended', 'terminated'].includes(effectiveStatus(sub, today));
  const stops = phaseSubs(sub).filter((p) => p.stop);
  const apply = () => {
    try {
      if (refund && (!(Number(amount ?? preview!.suggestedRefund) >= 0) || amount === '')) throw new Error(t('mcp.error.invalidRefund'));
      if (settled !== '' && !(Number(settled) >= 0)) throw new Error(t('mcp.error.invalidRefund'));
      const next =
        mode === 'nonrenew'
          ? cancelAtEnd(sub, date, today)
          : stopSubscription(
              sub,
              today,
              mode,
              date,
              reason,
              refund
                ? {
                    amount: Number(amount ?? preview!.suggestedRefund),
                    date: refundDate ?? date,
                    settled: settled !== '' ? { amount: Number(settled), currency: settledCurrency } : undefined,
                  }
                : undefined,
            );
      onApply(next);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  };
  if (sub.stop || ended)
    return (
      <div className="stop-panel">
        {stops.map((p) => (
          <div className="stop-summary" key={p.start}>
            <b>{stopDescription(p, today)}</b>
            <small>{t('core.stop.paidThrough', { date: cnDateFull(p.stop!.paidThrough) })}</small>
          </div>
        ))}
        {sub.stop?.kind !== 'terminate' && sub.status !== 'terminated' && (
          <div className="cell">
            <button type="button" className="btn" onClick={() => onApply(reactivate(sub, today))}>
              {t('core.stop.restore')}
            </button>
          </div>
        )}
      </div>
    );
  return (
    <div className="stop-panel">
      <Cell label={t('core.stop.title')}>
        <Picker
          value={mode}
          onChange={(v) => {
            setMode(v);
            setDate(v === 'nonrenew' ? period.paidThrough : today);
            setAmount(undefined);
          }}
          options={(['nonrenew', 'cancel', 'terminate'] as const).map((value) => ({ value, label: t(`core.stop.${value}`) }))}
          ariaLabel={t('core.stop.title')}
        />
      </Cell>
      <Cell label={t(mode === 'nonrenew' ? 'editor.field.end' : 'core.stop.date')}>
        <DatePicker
          value={date}
          onChange={(value) => {
            if (value) {
              setDate(value);
              setAmount(undefined);
            }
          }}
        />
      </Cell>
      {mode !== 'nonrenew' && (
        <>
          <p className="stop-hint">{t('core.stop.paidThrough', { date: cnDateFull(period.paidThrough) })}</p>
          {mode === 'terminate' && (
            <Cell label={t('core.stop.reason')}>
              <input value={reason} onChange={(e) => setReason(e.target.value)} />
            </Cell>
          )}
          <Cell label={t('editor.payment.kind.refund')}>
            <Picker
              value={refund ? 'yes' : 'no'}
              onChange={(v) => setRefund(v === 'yes')}
              options={[
                { value: 'no', label: t('core.stop.refundNo') },
                { value: 'yes', label: t('core.stop.refundYes') },
              ]}
              ariaLabel={t('editor.payment.kind.refund')}
            />
          </Cell>
          {refund && (
            <>
              <Cell label={`${t('core.stop.refundAmount')} · ${cur.currency}`} sub={t('core.stop.currencyHint', { currency: cur.currency })}>
                <input inputMode="decimal" value={amount ?? String(preview!.suggestedRefund)} onChange={(e) => setAmount(e.target.value)} />
              </Cell>
              <Cell label={t('core.stop.refundDate')}>
                <DatePicker value={refundDate ?? date} min={date} onChange={(v) => setRefundDate(v)} />
              </Cell>
              <Cell label={t('editor.payment.settledCcy')}>
                <CurrencySelect value={settledCurrency} onChange={setSettledCurrency} />
              </Cell>
              <Cell label={t('editor.payment.settledAmount')}>
                <input inputMode="decimal" value={settled} placeholder={t('editor.field.optional')} onChange={(e) => setSettled(e.target.value)} />
              </Cell>
            </>
          )}
        </>
      )}
      <div className="cell stop-actions">
        {sub.end && (
          <button type="button" className="btn" onClick={() => onApply(reactivate(sub, today))}>
            {t('core.stop.restore')}
          </button>
        )}
        <button type="button" className="btn" onClick={apply}>
          {t('common.apply')}
        </button>
      </div>
    </div>
  );
}
