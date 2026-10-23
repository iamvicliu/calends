import { useState } from 'react';
import { activePhases, currentPhase, cycleLabel, phaseSubs } from '../../../shared/billing.ts';
import { money } from '../../../shared/format.ts';
import { t } from '../../../shared/i18n.ts';
import { deletePayment, savePayment } from '../../../shared/phases.ts';
import type { Payment, Subscription } from '../../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { CurrencySelect, Picker } from '../components/Picker.tsx';
import { MoneyInput, Cell, Group, Sheet } from '../components/ui.tsx';
import { run, saveSub } from '../store.ts';

type Kind = 'charge' | NonNullable<Payment['kind']>;
const KINDS: Kind[] = ['charge', 'refund', 'adjust', 'failed'];

/**
 * 记一笔 / 修改一笔扣款。金额按这一段订阅的币种填；卡上实际扣的是别的币种（如日元订阅从美元卡扣）时，
 * 另填「卡上实扣」，统计就按实扣算，汇差和手续费都算进真实成本。
 */
export function PaymentSheet({
  sub,
  today,
  edit,
  onClose,
}: {
  sub: Subscription;
  today: string;
  edit?: { pay: Payment; index: number; phase?: string };
  onClose: () => void;
}) {
  const [date, setDate] = useState(edit?.pay.date ?? today);
  const [kind, setKind] = useState<Kind>(edit?.pay.kind ?? 'charge');
  // 换区后新旧两段并行的日子：要选这笔记在哪一段（缺省为最晚开始的那段，修改时为原记录所在的段）
  const lanes = sub.phases?.length ? (kind === 'refund' ? phaseSubs(sub).filter((v) => v.start <= date) : activePhases(sub, date)) : [];
  const [lane, setLane] = useState(edit?.phase);
  const phase = (lanes.length > 1 && lanes.find((v) => v.start === lane)) || currentPhase(sub, date);
  const pick = lanes.length > 1 ? phase.start : edit?.phase;
  const ccy = phase.currency;
  const [amount, setAmount] = useState(edit ? String(Math.abs(edit.pay.amount)) : String(phase.price));
  const [settled, setSettled] = useState(edit?.pay.settled ? String(Math.abs(edit.pay.settled.amount)) : '');
  const [settledCcy, setSettledCcy] = useState(edit?.pay.settled?.currency ?? 'USD');
  const [note, setNote] = useState(edit?.pay.note ?? '');
  const sign = kind === 'refund' ? -1 : 1;

  const save = () => {
    const n = Number(amount);
    if (!(n >= 0) || amount === '') return;
    const pay: Payment = {
      date,
      amount: sign * n,
      currency: ccy,
      kind: kind === 'charge' ? undefined : kind,
      settled: settled !== '' && Number(settled) >= 0 ? { amount: sign * Number(settled), currency: settledCcy } : undefined,
      note: note.trim() || undefined,
    };
    run(
      async () => {
        await saveSub(savePayment(sub, today, pay, edit && { date: edit.pay.date, index: edit.index }, pick));
        onClose();
      },
      t(edit ? 'editor.payment.toast.edited' : 'editor.payment.toast.added'),
    );
  };
  const remove = () =>
    run(async () => {
      await saveSub(deletePayment(sub, today, edit!.pay.date, edit!.index, edit!.phase));
      onClose();
    }, t('editor.payment.toast.deleted'));

  return (
    <Sheet
      narrow
      title={t(edit ? 'editor.payment.editTitle' : 'editor.payment.addTitle')}
      onClose={onClose}
      foot={
        <>
          {edit && (
            <button className="btn danger" style={{ marginRight: 'auto' }} onClick={remove}>
              {t('common.delete')}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="stack">
        <Group>
          <Cell label={t('editor.payment.date')}>
            <DatePicker value={date} onChange={(v) => setDate(v ?? today)} />
          </Cell>
          {lanes.length > 1 && (
            <Cell label={t('editor.overlap.payPhase')}>
              <Picker
                value={phase.start}
                onChange={(v) => {
                  setLane(v);
                  const p = lanes.find((x) => x.start === v);
                  if (!edit && p) setAmount(String(p.price));
                }}
                options={lanes.map((v) => ({
                  value: v.start,
                  label: `${v.region ? `${v.region}\n` : ''}${money(v.price, v.currency)} ${cycleLabel(v.cycle)}`,
                }))}
                ariaLabel={t('editor.overlap.payPhase')}
              />
            </Cell>
          )}
          <Cell label={t('editor.payment.kind.label')}>
            <Picker
              value={kind}
              onChange={setKind}
              options={KINDS.map((k) => ({ value: k, label: t(`editor.payment.kind.${k}`) }))}
              ariaLabel={t('editor.payment.kind.label')}
            />
          </Cell>
          <Cell label={t('editor.payment.amount', { currency: ccy })} sub={kind === 'refund' ? t('core.stop.currencyHint', { currency: ccy }) : undefined}>
            <MoneyInput ccy={ccy} className="num" value={amount} onChange={(e) => setAmount((e.target as HTMLInputElement).value)} />
          </Cell>
        </Group>
        <Group title={t('editor.payment.settled')}>
          <Cell label={t('editor.payment.settledCcy')}>
            <CurrencySelect value={settledCcy} onChange={setSettledCcy} />
          </Cell>
          <Cell label={t('editor.payment.settledAmount')}>
            <MoneyInput
              ccy={settledCcy}
              className="num"
              placeholder={t('editor.payment.blank')}
              value={settled}
              onChange={(e) => setSettled((e.target as HTMLInputElement).value)}
            />
          </Cell>
        </Group>
        <Group>
          <Cell label={t('editor.field.notes')}>
            <input value={note} placeholder={t('editor.field.optional')} onChange={(e) => setNote((e.target as HTMLInputElement).value)} />
          </Cell>
        </Group>
        {phase.payments?.length || sub.payments?.length ? null : (
          <small className="muted" style={{ padding: '0 4px' }}>
            {t('editor.payment.freezeHint', { amount: money(phase.price, ccy) })}
          </small>
        )}
      </div>
    </Sheet>
  );
}
