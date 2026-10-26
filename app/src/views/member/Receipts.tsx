import { useState, useId } from 'react';
import { copyParts } from '../../components/copy.tsx';

import { addDays } from '../../../../shared/billing.ts';
import { flow, cnDate, cnDateFull } from '../../../../shared/format.ts';

import { paidThrough } from '../../../../shared/receivables.ts';
import { isReceipt, recordPeriods } from '../Receivable.tsx';
import { DatePicker } from '../../components/DatePicker.tsx';
import { IconButton, Cell, Group } from '../../components/ui.tsx';

import { Icon } from '../../components/icons.tsx';
import { NumInput, Stepper, Toggle } from '../../components/inputs.tsx';

import { CurrencySelect } from '../../components/Picker.tsx';
import { t } from '../../../../shared/i18n.ts';

import { memberLedgerAhead } from '../MemberReceipt.tsx';

import type { useMemberForm } from './useMemberForm.ts';

export function FirstReceiptFields({ context }: { context: ReturnType<typeof useMemberForm> }) {
  const { today, once, val, firstPay, setFirstPay, firstPeriods, setFirstPeriods, firstOpen, payEdit, setPayEdit, pay, firstUntil } = context;
  return (
    <Group
      title={t('family.member.firstPay')}
      foot={firstPay && !once && firstUntil ? t('family.collect.next', { date: cnDateFull(addDays(firstUntil, 1)) }) : undefined}
    >
      <Cell label={t('family.member.firstPayToggle')}>
        <Toggle checked={firstPay} onChange={setFirstPay} />
      </Cell>
      {firstPay && (
        <>
          <Cell label={t('family.member.receivedOn')}>
            <DatePicker value={pay.date} onChange={(v) => setPayEdit({ ...payEdit, date: v ?? today })} />
          </Cell>
          <Cell label={t('family.member.amount')}>
            <span className="contact-field">
              <NumInput className="num" ccy={pay.currency} value={pay.amount} onValue={(n) => setPayEdit({ ...payEdit, amount: n ?? 0 })} />
              <CurrencySelect value={pay.currency} onChange={(c) => setPayEdit({ ...payEdit, currency: c })} ariaLabel={t('family.member.currency')} />
            </span>
          </Cell>
          {!once && (
            <>
              <Cell label={t('family.collect.periods')}>
                <Stepper
                  label={t('family.collect.periods')}
                  value={firstPeriods}
                  min={1}
                  max={Math.max(1, Math.min(24, firstOpen.length))}
                  unit={(n) => t('family.collect.periodUnit', { count: n })}
                  onChange={setFirstPeriods}
                />
              </Cell>
              {firstUntil && (
                <Cell label={t('family.collect.until')}>
                  <span>{cnDateFull(firstUntil)}</span>
                </Cell>
              )}
            </>
          )}
          <Cell label={t('family.member.note')}>
            <input value={pay.note ?? ''} placeholder={t('family.member.notePh')} onChange={(e) => setPayEdit({ ...payEdit, note: val(e) || undefined })} />
          </Cell>
        </>
      )}
    </Group>
  );
}

export function ReceiptHistory({ context }: { context: ReturnType<typeof useMemberForm> }) {
  const { member, collectCcy, mode, ledger, records, received, setReceipt, others, copying, setCopying, startCopy, removeRecordById } = context;
  const [expanded, setExpanded] = useState(false);
  const historyId = useId();
  return (
    <Group
      title={
        records.length > 0 && (
          <button type="button" className="car-departed-toggle" aria-expanded={expanded} aria-controls={historyId} onClick={() => setExpanded(!expanded)}>
            {t('family.member.payments', { count: records.length })}
            <Icon name="down" size={14} />
          </button>
        )
      }
      foot={
        (expanded || records.length === 0) &&
        (records.length > 1 || !!member!.leaveRefund || (isReceipt(records[0]) && records[0].currency !== collectCcy)) &&
        t('family.member.receivedTotal', { amount: flow(received, collectCcy) })
      }
    >
      <div id={historyId} hidden={records.length > 0 && !expanded}>
        {ledger.unmatched.length > 0 && <div className="cell muted">{t('receivable.unmatchedNote', { count: ledger.unmatched.length })}</div>}
        {records.map((r) => {
          const opening = isReceipt(r) && r.opening;
          return (
            <div key={r.id} className="cell member-pay">
              <button
                type="button"
                className="cell-l member-pay-edit"
                disabled={opening}
                onClick={() => setReceipt({ edit: r.id })}
                aria-label={t('family.member.editPayAria')}
              >
                {isReceipt(r) && !opening ? (
                  <span className="green">{flow(r.amount, r.currency)}</span>
                ) : (
                  <span>{t(opening ? 'receivable.opening' : 'receivable.waived')}</span>
                )}
                <small>
                  {copyParts(opening ? recordPeriods(r, ledger.periods) : `${cnDateFull(r.date)}\n${recordPeriods(r, ledger.periods)}`)}
                  {copyParts(r.note ? `\n${r.note}` : '')}
                </small>
              </button>
              <span className="cell-r">
                {isReceipt(r) && !opening && others.length > 0 && (
                  <IconButton
                    className={`${copying === r.id ? 'on' : ''}`}
                    aria-label={t('family.member.copyAria')}
                    title={t('family.member.copyAria')}
                    onClick={() => (copying === r.id ? setCopying(null) : startCopy(r))}
                  >
                    <Icon name="copy" />
                  </IconButton>
                )}
                <IconButton aria-label={t('family.member.removePayAria')} onClick={() => removeRecordById(r.id, r.date)}>
                  <Icon name="x" />
                </IconButton>
              </span>
              {copying === r.id && isReceipt(r) && <CopyReceiptFields context={context} record={r} />}
            </div>
          );
        })}
        {member!.leaveRefund && (
          <Cell label={t('family.sheet.refund')}>
            <span>
              {cnDateFull(member!.leaveRefund.date)}
              {copyParts(member!.leaveRefund.note ? `\n${member!.leaveRefund.note}` : '')}
            </span>
            <b>{flow(-member!.leaveRefund.amount, member!.leaveRefund.currency)}</b>
          </Cell>
        )}
      </div>
      {mode !== 'exempt' && (
        <button type="button" className="cell tap member-pay-add" onClick={() => setReceipt({})}>
          <Icon name="plus" /> {t('family.quick.backCollect')}
        </button>
      )}
    </Group>
  );
}

export function CopyReceiptFields({
  context,
  record: r,
}: { context: ReturnType<typeof useMemberForm> } & { record: import('../../../../shared/types.ts').Receipt }) {
  const { state, s, today, others, setCopying, targets, setTargets, copyable, copyTo } = context;
  return (
    <div className="copy-pay" data-submit=".btn.primary">
      {others.map((o) => {
        const dup = !copyable(o, r);
        const until = paidThrough(memberLedgerAhead(state, s, o, today).periods);
        return (
          <label key={o.id} className={`copy-target ${dup ? 'dup' : ''}`}>
            <input
              type="checkbox"
              disabled={dup}
              checked={!dup && targets.includes(o.id)}
              onChange={(e) => setTargets((e.target as HTMLInputElement).checked ? [...targets, o.id] : targets.filter((x) => x !== o.id))}
            />
            <span>{o.name || t('family.member.unnamed')}</span>
            <small>{dup ? t('family.member.dup') : until ? t('family.member.paidUntilDate', { date: cnDate(until) }) : t('family.member.noPay')}</small>
          </label>
        );
      })}
      <div className="sheet-actions">
        <button className="btn" onClick={() => setCopying(null)}>
          {t('family.member.cancel')}
        </button>
        <button className="btn primary" disabled={!targets.length} onClick={() => copyTo(r)}>
          {t('family.member.copyN', { count: targets.length })}
        </button>
      </div>
    </div>
  );
}
