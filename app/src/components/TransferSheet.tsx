import { useState } from 'react';
import { t } from '../../../shared/i18n.ts';
import type { Transfer } from '../../../shared/types.ts';
import { DatePicker } from './DatePicker.tsx';
import { CurrencySelect } from './Picker.tsx';
import { Cell, Group, MoneyInput, Seg, Sheet } from './ui.tsx';

/**
 * 记一笔 / 修改一笔转让收付：二手转入付给原主的钱，或转出时收到的钱。金额是实际现金，不推算剩余价值。
 * 只把改好的整组记录交给调用方：编辑器写进表单（完成时一起保存），详情页直接保存
 */
export function TransferSheet({
  list,
  index,
  currency,
  today,
  onSave,
  onClose,
}: {
  list: Transfer[];
  /** 修改的那一笔在原数组里的位置；缺省为新增 */
  index?: number;
  currency: string;
  today: string;
  onSave: (next: Transfer[]) => void;
  onClose: () => void;
}) {
  const edit = index != null ? list[index] : undefined;
  const [kind, setKind] = useState<Transfer['kind']>(edit?.kind ?? (list.some((x) => x.kind === 'buy') ? 'sell' : 'buy'));
  const [date, setDate] = useState(edit?.date ?? today);
  const [ccy, setCcy] = useState(edit?.currency ?? currency);
  const [amount, setAmount] = useState(edit ? String(edit.amount) : '');
  const [note, setNote] = useState(edit?.note ?? '');
  const n = Number(amount);
  const valid = amount.trim() !== '' && Number.isFinite(n) && n > 0;

  const save = () => {
    if (!valid) return;
    const item: Transfer = { kind, date, amount: n, currency: ccy, ...(note.trim() ? { note: note.trim() } : {}) };
    onSave(index != null ? list.map((x, i) => (i === index ? item : x)) : [...list, item]);
    onClose();
  };

  return (
    <Sheet
      narrow
      title={t(edit ? 'detail.transfer.editTitle' : 'detail.transfer.addTitle')}
      onClose={onClose}
      foot={
        <>
          {edit && (
            <button
              className="btn danger"
              style={{ marginRight: 'auto' }}
              onClick={() => {
                onSave(list.filter((_, i) => i !== index));
                onClose();
              }}
            >
              {t('common.delete')}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!valid} onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="stack">
        <Group foot={t(`detail.transfer.hint.${kind}`)}>
          <Cell label={t('detail.transfer.kind.label')}>
            <Seg
              small
              value={kind}
              onChange={setKind}
              options={[
                ['buy', t('detail.transfer.kind.buy')],
                ['sell', t('detail.transfer.kind.sell')],
              ]}
            />
          </Cell>
          <Cell label={t('editor.payment.date')}>
            <DatePicker value={date} onChange={(v) => setDate(v ?? today)} />
          </Cell>
        </Group>
        <Group>
          <Cell label={t('picker.currency')}>
            <CurrencySelect value={ccy} onChange={setCcy} />
          </Cell>
          <Cell label={t(kind === 'buy' ? 'detail.transfer.paid' : 'detail.transfer.received')}>
            <MoneyInput ccy={ccy} className="num" value={amount} placeholder="0" onChange={(e) => setAmount((e.target as HTMLInputElement).value)} />
          </Cell>
        </Group>
        <Group>
          <Cell label={t('editor.field.notes')}>
            <input value={note} placeholder={t('editor.field.optional')} onChange={(e) => setNote((e.target as HTMLInputElement).value)} />
          </Cell>
        </Group>
      </div>
    </Sheet>
  );
}
