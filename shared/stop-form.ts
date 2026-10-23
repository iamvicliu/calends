// Transient stop fields owned by the editor or the standalone stop dialog.
import { nonrenewalDate, billingPeriod, currentPhase, stopSummary, subError } from './billing.ts';
import { cancelAtEnd, reactivate, statusChangeError, stopSubscription } from './phases.ts';
import { t } from './i18n.ts';
import type { Subscription } from './types.ts';

export type StopMode = 'nonrenew' | 'cancel' | 'terminate';
export interface StopForm {
  mode: StopMode;
  date: string;
  refund: boolean;
  amount?: string;
  refundDate?: string;
  reason: string;
  settled: string;
  settledCurrency: string;
}

/** Existing refunds remain ordinary payment records; the fields edit the latest stop refund. */
export function stopForm(sub: Subscription, today: string): StopForm {
  const cur = currentPhase(sub, sub.stop?.date ?? today);
  const paid = nonrenewalDate(cur, today);
  const payment = cur.stop ? cur.payments?.filter((p) => p.kind === 'refund' && p.date >= cur.stop!.date).at(-1) : undefined;
  return {
    mode: sub.stop?.kind ?? 'nonrenew',
    date: sub.stop?.date ?? sub.end ?? (sub.status === 'cancelled' ? today : paid),
    refund: !!payment,
    amount: payment ? String(-payment.amount) : undefined,
    refundDate: payment?.date,
    reason: sub.stop?.reason ?? '',
    settled: payment?.settled ? String(-payment.settled.amount) : '',
    settledCurrency: payment?.settled?.currency ?? 'USD',
  };
}

export function stopPreview(sub: Subscription, form: StopForm, today: string) {
  const cur = currentPhase(sub, form.date);
  const period = billingPeriod(cur, form.date < today ? form.date : today);
  return {
    cur,
    period,
    summary: stopSummary({ ...cur, stop: { kind: form.mode === 'terminate' ? 'terminate' : 'cancel', date: form.date, paidThrough: period.paidThrough } })!,
  };
}

/** Validate only on the owner's submit. Never persist partial date or amount inputs. */
export function applyStopForm(sub: Subscription, form: StopForm, today: string): Subscription {
  if (JSON.stringify(form) === JSON.stringify(stopForm(sub, today)) && (sub.stop || (sub.status === 'cancelled' && sub.end))) return sub;
  const terminated = sub.stop?.kind === 'terminate' || sub.status === 'terminated';
  if (terminated && form.mode !== 'terminate') throw new Error(t('mcp.error.terminatedReactivate'));
  let open = sub;
  if (sub.stop || sub.end || sub.status === 'cancelled' || sub.status === 'terminated') {
    // Reopen only this local calculation; the resulting record must still pass the provider-termination constraint.
    open = terminated
      ? {
          ...sub,
          status: 'active',
          pausedAt: undefined,
          end: undefined,
          stop: undefined,
          phases: sub.phases?.map((p, i, all) => (i === all.length - 1 ? { ...p, end: undefined, stop: undefined } : p)),
        }
      : reactivate(sub, today);
  }
  if (form.mode === 'nonrenew') return cancelAtEnd(open, form.date, today);
  const { summary } = stopPreview(sub, form, today);
  if (
    form.refund &&
    (form.amount === '' || !Number.isFinite(Number(form.amount ?? summary.suggestedRefund)) || Number(form.amount ?? summary.suggestedRefund) < 0)
  )
    throw new Error(t('mcp.error.invalidRefund'));
  if (form.refund && form.settled !== '' && (!Number.isFinite(Number(form.settled)) || Number(form.settled) < 0)) throw new Error(t('mcp.error.invalidRefund'));
  // Replace just the latest refund shown in the fields; retain all other payments and earlier refunds.
  const cur = currentPhase(sub, sub.stop?.date ?? today);
  const previous = cur.stop ? cur.payments?.filter((p) => p.kind === 'refund' && p.date >= cur.stop!.date).at(-1) : undefined;
  if (previous) {
    const index = cur.payments!.indexOf(previous);
    const payments = cur.payments!.filter((_, i) => i !== index);
    if (open.phases?.length) {
      const phases = open.phases.map((p) => (p.start === cur.start ? { ...p, payments } : p));
      open = { ...open, phases };
    } else open = { ...open, payments };
  }
  const next = stopSubscription(
    open,
    today,
    form.mode,
    form.date,
    form.reason,
    form.refund
      ? {
          amount: Number(form.amount ?? summary.suggestedRefund),
          date: form.refundDate ?? form.date,
          settled: form.settled !== '' ? { amount: Number(form.settled), currency: form.settledCurrency } : undefined,
        }
      : undefined,
  );
  const error = subError(next) ?? statusChangeError(sub, next, today);
  if (error) throw new Error(error);
  return next;
}
