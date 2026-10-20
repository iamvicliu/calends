import { useRef, useState } from 'react';
import type { PaymentMethod } from '../../shared/types.ts';
import { KIND_LABEL } from '../derive.ts';
import { t } from '../../shared/i18n.ts';
import { Icon, MethodMark } from './ui.tsx';
import { Pop } from './Pop.tsx';

/**
 * 支付方式选择器：系统下拉框放不了图片，这里自己画一个，每项带产品 logo 与国旗角标。
 * 弹层用共用的 Pop，窄屏时贴底显示，与日期选择器一致。
 */
export function MethodPicker({ methods, value, onChange }: { methods: PaymentMethod[]; value?: string; onChange: (id: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const cur = methods.find((m) => m.id === value);

  const pick = (id: string | undefined) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <>
      <button type="button" ref={btn} className={`mp-btn ${cur ? '' : 'empty'}`} onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}>
        {cur && <MethodMark m={cur} size={20} />}
        <span>{cur ? cur.name : t('picker.method.none')}</span>
        <Icon name="down" />
      </button>
      {open && (
        <Pop triggerRef={btn} onClose={() => setOpen(false)} label={t('picker.method.label')} className="mp-pop">
          <div role="listbox" aria-label={t('picker.method.label')}>
            <button type="button" role="option" aria-selected={!cur} className={`mp-opt ${cur ? '' : 'sel'}`} onClick={() => pick(undefined)}>
              <span className="mp-none" />
              <span className="mp-name">{t('picker.method.none')}</span>
              {!cur && <Icon name="check" />}
            </button>
            {methods.map((m) => (
              <button
                type="button"
                role="option"
                key={m.id}
                aria-selected={m.id === value}
                className={`mp-opt ${m.id === value ? 'sel' : ''}`}
                onClick={() => pick(m.id)}
              >
                <MethodMark m={m} size={28} />
                <span className="mp-name">
                  {m.name}
                  <small>
                    {KIND_LABEL[m.kind]} · {m.currency}
                  </small>
                </span>
                {m.id === value && <Icon name="check" />}
              </button>
            ))}
          </div>
        </Pop>
      )}
    </>
  );
}
