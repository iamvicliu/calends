import { useState } from 'react';
import { activePhases, chargesBetween, currentPhase, cycleLabel, phaseSubs } from '../../../shared/billing.ts';
import { money } from '../../../shared/format.ts';
import { t } from '../../../shared/i18n.ts';
import { deletePayment, savePayment, setPhaseMethod } from '../../../shared/phases.ts';
import type { Payment, Subscription } from '../../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { CurrencySelect, Picker } from '../components/Picker.tsx';
import { MethodPicker } from '../components/MethodPicker.tsx';
import { MoneyInput, Cell, Group, Icon, IconButton, Seg, Sheet, useSubmit } from '../components/ui.tsx';
import { getState, run, saveSub } from '../store.ts';

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
  // 支付方式：缺省为这一笔单独记的，否则是所属这一段的；换了卡时选只改这一笔，还是整段一起改
  const [method, setMethod] = useState(edit?.pay.methodId ?? phase.methodId);
  const changed = method !== (edit?.pay.methodId ?? phase.methodId);
  const [scope, setScope] = useState<'one' | 'phase'>(phase.methodId ? 'one' : 'phase');
  const phaseCount = chargesBetween(phase, phase.start, today, today).length;
  // 资金拆分：一笔订单由几个来源合付；金额按订阅币种，合计等于本笔
  const [split, setSplit] = useState<Array<{ methodId?: string; amount: string }> | null>(
    edit?.pay.funding?.length ? edit.pay.funding.map((f) => ({ methodId: f.methodId, amount: String(Math.abs(f.amount)) })) : null,
  );
  const splitSum = (split ?? []).reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const left = Math.round((Number(amount) - splitSum) * 100) / 100;
  const blanks = (split ?? []).filter((x) => x.amount === '').length;
  const setPart = (i: number, patch: Partial<{ methodId?: string; amount: string }>) => setSplit((xs) => xs!.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  const [busy, submit] = useSubmit();
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
      methodId: split ? undefined : changed ? (scope === 'one' && method !== phase.methodId ? method : undefined) : edit?.pay.methodId,
      // 只剩一个来源没填金额时，它补上差额；其余校验（来源不同、合计相等）由 savePayment 统一做
      // 没选来源也没填金额的空行直接忽略
      funding: split
        ?.filter((x) => x.methodId || x.amount !== '')
        .map((x) => ({ methodId: x.methodId ?? '', amount: sign * (x.amount === '' && blanks === 1 ? left : Number(x.amount)) })),
    };
    return submit(() =>
      run(
        async () => {
          let next = savePayment(sub, today, pay, edit && { date: edit.pay.date, index: edit.index }, pick);
          if (!split && changed && scope === 'phase') next = setPhaseMethod(next, phase.start, method);
          await saveSub(next);
          onClose();
        },
        t(edit ? 'editor.payment.toast.edited' : 'editor.payment.toast.added'),
      ),
    );
  };
  const remove = () =>
    submit(() =>
      run(async () => {
        await saveSub(deletePayment(sub, today, edit!.pay.date, edit!.index, edit!.phase));
        onClose();
      }, t('editor.payment.toast.deleted')),
    );

  return (
    <Sheet
      narrow
      title={t(edit ? 'editor.payment.editTitle' : 'editor.payment.addTitle')}
      onClose={onClose}
      foot={
        <>
          {edit && (
            <button className="btn danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={remove}>
              {t('common.delete')}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={busy} onClick={save}>
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
        </Group>
        <Group
          title={split ? t('editor.payment.sources') : undefined}
          action={
            <button
              type="button"
              className="btn plain"
              onClick={() =>
                setSplit(
                  split
                    ? null
                    : [
                        { methodId: method, amount },
                        { methodId: undefined, amount: '' },
                      ],
                )
              }
            >
              {t(split ? 'editor.payment.unsplit' : 'editor.payment.split')}
            </button>
          }
          foot={
            split
              ? Math.abs(left) < 0.005 || (blanks === 1 && left > 0)
                ? t('editor.payment.splitOk', { amount: money(Number(amount) || 0, ccy) })
                : t('editor.payment.splitLeft', { amount: money(left, ccy) })
              : undefined
          }
        >
          {split ? (
            <>
              {split.map((x, i) => (
                <div className="cell pay-split" key={i}>
                  <MethodPicker methods={getState().methods} value={x.methodId} onChange={(v) => setPart(i, { methodId: v })} />
                  <MoneyInput
                    ccy={ccy}
                    className="num"
                    aria-label={t('editor.payment.amount', { currency: ccy })}
                    placeholder={x.amount === '' && blanks === 1 && left > 0 ? String(left) : '0'}
                    value={x.amount}
                    onChange={(e) => setPart(i, { amount: (e.target as HTMLInputElement).value })}
                  />
                  {split.length > 2 && (
                    <IconButton aria-label={t('common.delete')} onClick={() => setSplit(split.filter((_, k) => k !== i))}>
                      <Icon name="x" />
                    </IconButton>
                  )}
                </div>
              ))}
              <button type="button" className="cell tap pay-split-add" onClick={() => setSplit([...split, { methodId: undefined, amount: '' }])}>
                <Icon name="plus" />
                {t('editor.payment.addSource')}
              </button>
            </>
          ) : (
            <Cell label={t('editor.payment.method')}>
              <MethodPicker methods={getState().methods} value={method} onChange={setMethod} />
            </Cell>
          )}
          {!split && changed && phaseCount > 1 && (
            <Cell label={t('editor.payment.scope')}>
              <Seg
                small
                value={scope}
                onChange={setScope}
                options={[
                  ['one', t('editor.payment.scopeOne')],
                  ['phase', t('editor.payment.scopePhase', { count: phaseCount })],
                ]}
              />
            </Cell>
          )}
        </Group>
        {/* 金额按这一段的币种（写在标签里，跟方案走）；卡上用别的币种扣时先选实扣币种再填金额 */}
        <Group>
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
