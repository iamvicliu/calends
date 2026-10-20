import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PaymentMethod } from '../../shared/types.ts';
import { KIND_LABEL } from '../derive.ts';
import { t } from '../../shared/i18n.ts';
import { Icon, MethodMark } from './ui.tsx';

/**
 * 支付方式选择器：系统下拉框放不了图片，这里自己画一个，每项带产品 logo 与国旗角标。
 * 弹层用 fixed 定位，窄屏时贴底显示，与日期选择器一致。
 */
export function MethodPicker({ methods, value, onChange }: { methods: PaymentMethod[]; value?: string; onChange: (id: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; mobile: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const cur = methods.find((m) => m.id === value);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const W = 280;
      const H = Math.min(420, 52 + methods.length * 48);
      const below = r.bottom + 6 + H < window.innerHeight;
      setPos({
        mobile: window.innerWidth < 560,
        top: below ? r.bottom + 6 : Math.max(8, r.top - H - 6),
        left: Math.min(Math.max(8, r.right - W), window.innerWidth - W - 8),
      });
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const pick = (id: string | undefined) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <>
      <button type="button" ref={btn} class={`mp-btn ${cur ? '' : 'empty'}`} onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}>
        {cur && <MethodMark m={cur} size={20} />}
        <span>{cur ? cur.name : t('picker.method.none')}</span>
        <Icon name="down" />
      </button>
      {open && pos && (
        <>
          {pos.mobile && <div class="dp-scrim" onClick={() => setOpen(false)} />}
          <div
            ref={pop}
            class={`dp-pop mp-pop ${pos.mobile ? 'mobile' : ''}`}
            style={pos.mobile ? undefined : { top: pos.top, left: pos.left }}
            role="listbox"
            aria-label={t('picker.method.label')}
          >
            <button type="button" role="option" aria-selected={!cur} class={`mp-opt ${cur ? '' : 'sel'}`} onClick={() => pick(undefined)}>
              <span class="mp-none" />
              <span class="mp-name">{t('picker.method.none')}</span>
              {!cur && <Icon name="check" />}
            </button>
            {methods.map((m) => (
              <button
                type="button"
                role="option"
                key={m.id}
                aria-selected={m.id === value}
                class={`mp-opt ${m.id === value ? 'sel' : ''}`}
                onClick={() => pick(m.id)}
              >
                <MethodMark m={m} size={28} />
                <span class="mp-name">
                  {m.name}
                  <small>
                    {KIND_LABEL[m.kind]} · {m.currency}
                  </small>
                </span>
                {m.id === value && <Icon name="check" />}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
