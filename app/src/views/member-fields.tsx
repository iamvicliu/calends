import { LIFETIME_BILL_MONTHS } from '../../../shared/billing.ts';
import type { CarRule } from '../../../shared/types.ts';
import { Cell } from '../components/ui.tsx';
import { NumInput, Seg } from '../components/inputs.tsx';
import { CurrencySelect } from '../components/Picker.tsx';
import { t, type Params } from '../../../shared/i18n.ts';

/** 按收费周期选文案：常用周期各有一条，买断只收一次（once），其余走 custom（带 count） */
export const perBill = (key: string, months = 1, params: Params = {}): string =>
  t(`${key}.${months >= LIFETIME_BILL_MONTHS ? 'once' : [1, 3, 6, 12].includes(months) ? `m${months}` : 'custom'}`, { count: months, ...params });

/**
 * 收费标准：周期（按月 / 按季 / 半年 / 按年）+ 每期金额与币种。
 * 订阅编辑器的「我发起」、转为合租、车的收费规则、成员的自定义收费共用，四处长得一样
 */
export function FeeRuleFields({ value, onChange }: { value: CarRule; onChange: (r: CarRule) => void }) {
  return (
    <>
      <div className="cell">
        <Seg
          value={String(value.billEvery)}
          onChange={(v) => onChange({ ...value, billEvery: Number(v) })}
          options={[
            ['1', t('family.member.seg.m1')],
            ['3', t('family.member.seg.m3')],
            ['6', t('family.member.seg.m6')],
            ['12', t('family.member.seg.m12')],
          ]}
        />
      </div>
      <Cell label={perBill('family.member.feeLabel', value.billEvery)}>
        <span className="contact-field">
          <NumInput ccy={value.currency} className="num" value={value.fee} placeholder="0" onValue={(n) => onChange({ ...value, fee: n ?? 0 })} />
          <CurrencySelect value={value.currency} onChange={(c) => onChange({ ...value, currency: c })} ariaLabel={t('family.member.feeCcyAria')} />
        </span>
      </Cell>
    </>
  );
}
