import { useState } from 'preact/hooks';
import { currentPhase } from '../../shared/billing.ts';
import { money } from '../../shared/format.ts';
import { deletePayment, savePayment } from '../../shared/phases.ts';
import type { Payment, Subscription } from '../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { CurrencySelect, Picker } from '../components/Picker.tsx';
import { Cell, Group, Sheet } from '../components/ui.tsx';
import { run, saveSub } from '../store.ts';

type Kind = 'charge' | NonNullable<Payment['kind']>;
const KINDS: Array<{ value: Kind; label: string }> = [
  { value: 'charge', label: '扣款' },
  { value: 'refund', label: '退款' },
  { value: 'adjust', label: '补差' },
  { value: 'failed', label: '扣款失败' },
];

/**
 * 记一笔 / 修改一笔扣款。金额按这一段订阅的币种填；卡上实际扣的是别的币种（如日元订阅从美元卡扣）时，
 * 另填「卡上实扣」，统计就按实扣算，汇差和手续费都算进真实成本。
 */
export function PaymentSheet({ sub, today, edit, onClose }: { sub: Subscription; today: string; edit?: { pay: Payment; index: number }; onClose: () => void }) {
  const [date, setDate] = useState(edit?.pay.date ?? today);
  const [kind, setKind] = useState<Kind>(edit?.pay.kind ?? 'charge');
  const phase = currentPhase(sub, date);
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
      kind: kind === 'charge' ? undefined : kind,
      settled: settled !== '' && Number(settled) >= 0 ? { amount: sign * Number(settled), currency: settledCcy } : undefined,
      note: note.trim() || undefined,
    };
    run(async () => {
      await saveSub(savePayment(sub, today, pay, edit && { date: edit.pay.date, index: edit.index }));
      onClose();
    }, edit ? '已修改这笔记录' : '已记下这笔');
  };
  const remove = () =>
    run(async () => {
      await saveSub(deletePayment(sub, today, edit!.pay.date, edit!.index));
      onClose();
    }, '已删除这笔记录');

  return (
    <Sheet
      narrow
      title={edit ? '修改扣款记录' : '记一笔'}
      onClose={onClose}
      foot={
        <>
          {edit && (
            <button class="btn danger" style={{ marginRight: 'auto' }} onClick={remove}>
              删除
            </button>
          )}
          <button class="btn" onClick={onClose}>
            取消
          </button>
          <button class="btn primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div class="stack">
        <Group>
          <Cell label="日期">
            <DatePicker value={date} onChange={(v) => setDate(v ?? today)} />
          </Cell>
          <Cell label="类型">
            <Picker value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} ariaLabel="类型" />
          </Cell>
          <Cell label={`金额（${ccy}）`} sub={kind === 'refund' ? '填退回多少，保存为负数' : undefined}>
            <input class="num" inputMode="decimal" value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} />
          </Cell>
        </Group>
        <Group title="卡上实扣（可选）">
          <Cell label="实扣币种">
            <CurrencySelect value={settledCcy} onChange={setSettledCcy} />
          </Cell>
          <Cell label="实扣金额">
            <input class="num" inputMode="decimal" placeholder="不填" value={settled} onInput={(e) => setSettled((e.target as HTMLInputElement).value)} />
          </Cell>
        </Group>
        <Group>
          <Cell label="备注">
            <input value={note} placeholder="可选" onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
          </Cell>
        </Group>
        {phase.payments?.length || sub.payments?.length ? null : (
          <small class="muted" style={{ padding: '0 4px' }}>
            这一段目前按周期推算扣款；保存后会先把到今天为止推算出的 {money(phase.price, ccy)} 各期固化成记录，以后完全以记录为准，未来的扣款照旧。
          </small>
        )}
      </div>
    </Sheet>
  );
}
