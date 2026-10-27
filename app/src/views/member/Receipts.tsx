import { ConfirmButton } from '../../components/ConfirmButton.tsx';
import { addDays } from '../../../../shared/billing.ts';
import { cnDate, cnDateFull } from '../../../../shared/format.ts';

import { paidThrough, type LedgerPeriod } from '../../../../shared/receivables.ts';
import { isReceipt, periodRange, PeriodTip, usePeriodEdit } from '../Receivable.tsx';
import { Pop } from '../../components/Pop.tsx';
import { DatePicker } from '../../components/DatePicker.tsx';
import { Cell, Group } from '../../components/ui.tsx';
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

/**
 * 点开一格：这一期的明细，字段与悬停提示、代付每期弹窗相同。点「编辑」原地改日期、这一期的金额和备注；
 * 点「一笔分几期」改整笔（调整抵扣哪几期）；也可复制给其他成员、删掉这一期（其余期照旧）
 */
export function PeriodPop({
  context,
  period: p,
  anchor,
  onClose,
}: {
  context: ReturnType<typeof useMemberForm>;
  period: LedgerPeriod;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const { setReceipt, others, copying, setCopying, startCopy, removeRecordPeriodOf, editRecordPeriodOf } = context;
  const r = p.receipt ?? p.waiver!;
  const edit = usePeriodEdit(p);
  const openWhole = () => {
    onClose();
    setCopying(null);
    setReceipt({ edit: r.id });
  };
  return (
    <Pop triggerRef={{ current: anchor }} label={periodRange(p)} className="period-pop" placement="bottom start" onClose={onClose}>
      <PeriodTip p={p} edit={edit} onBatch={edit.editable && isReceipt(r) ? openWhole : undefined} />
      {edit.editing && edit.splits && <small className="period-pop-foot">{t('receivable.splitEdit')}</small>}
      {copying === r.id && isReceipt(r) ? (
        <CopyReceiptFields context={context} record={r} />
      ) : (
        <div className="period-pop-actions">
          <ConfirmButton
            onConfirm={() => {
              onClose();
              void removeRecordPeriodOf(r.id, p);
            }}
          >
            {t('common.delete')}
          </ConfirmButton>
          <span className="grow" />
          {edit.editing ? (
            <>
              <button className="btn" onClick={edit.cancel}>
                {t('common.cancel')}
              </button>
              <button
                className="btn primary"
                disabled={!edit.dirty || !edit.valid}
                onClick={() => {
                  onClose();
                  void editRecordPeriodOf(r.id, p, edit.patch);
                }}
              >
                {t('common.save')}
              </button>
            </>
          ) : (
            <>
              {isReceipt(r) && !r.opening && others.length > 0 && (
                <button className="btn" onClick={() => startCopy(r)}>
                  {t('family.member.copyAria')}
                </button>
              )}
              {edit.editable && (
                <button className="btn primary" onClick={edit.start}>
                  {t('detail.action.edit')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </Pop>
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
