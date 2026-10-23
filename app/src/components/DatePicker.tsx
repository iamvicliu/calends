import { useEffect, useRef, useState } from 'react';
import { dateFormat } from '../../../shared/intl.ts';
import { addDays, addMonths, parseDay } from '../../../shared/billing.ts';
import { cnDateFull, monthLabel, weekdayShort } from '../../../shared/format.ts';
import { intlLocale, t } from '../../../shared/i18n.ts';
import { getState, today as todayOf } from '../store.ts';
import { IconButton, Icon } from './ui.tsx';
import { Pop } from './Pop.tsx';

/** 每周起始日跟随设置（1 周一、0 周日）；weekdayShort 的 0 是周日 */
const weekStart = () => getState()?.settings.weekStart ?? 1;
const dows = () => Array.from({ length: 7 }, (_, i) => (i + weekStart()) % 7);
const yearLabel = (y: number) => dateFormat(intlLocale(), { year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, 0, 1)));

function grid(month: string): string[] {
  const first = month + '-01';
  const dow = (new Date(parseDay(first)).getUTCDay() - weekStart() + 7) % 7;
  const start = addDays(first, -dow);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/**
 * 日期选择器：按钮显示「2026年10月19日」，点开是月历。
 * 弹层用共用的 Pop（react-aria），不会被弹窗的滚动容器裁掉；窄屏时贴底显示。
 */
export function DatePicker({
  value,
  onChange,
  placeholder = t('picker.date.placeholder'),
  clearable,
  min,
  max,
  ariaLabel,
}: {
  value?: string;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
  clearable?: boolean;
  min?: string;
  max?: string;
  ariaLabel?: string;
}) {
  const today = todayOf();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState((value ?? today).slice(0, 7));
  const [mode, setMode] = useState<'day' | 'month'>('day');
  const [cursor, setCursor] = useState(value ?? today);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      }
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (step && mode === 'day') {
        e.preventDefault();
        const n = addDays(cursor, step);
        setCursor(n);
        setMonth(n.slice(0, 7));
      }
      if (e.key === 'Enter' && mode === 'day') {
        e.preventDefault();
        pick(cursor);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, cursor, mode]);

  const toggle = () => {
    if (!open) {
      setMonth((value ?? today).slice(0, 7));
      setCursor(value ?? today);
      setMode('day');
    }
    setOpen(!open);
  };
  const disabled = (d: string) => (!!min && d < min) || (!!max && d > max);
  const pick = (d: string) => {
    if (disabled(d)) return;
    onChange(d);
    setOpen(false);
  };
  const [y, m] = month.split('-').map(Number);

  return (
    <>
      <button
        type="button"
        ref={btn}
        className={`dp-btn ${value ? '' : 'empty'} ${open ? 'open' : ''}`}
        onClick={toggle}
        aria-label={ariaLabel ? `${ariaLabel}: ${value ? cnDateFull(value) : placeholder}` : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Icon name="cal" />
        <span>{value ? cnDateFull(value) : placeholder}</span>
      </button>
      {open && (
        <Pop triggerRef={btn} onClose={() => setOpen(false)} label={t('picker.date.placeholder')}>
          <div className="dp-head">
            <button type="button" className="dp-title" onClick={() => setMode(mode === 'day' ? 'month' : 'day')}>
              {mode === 'day' ? monthLabel(month, { long: true }) : yearLabel(y)}
              <Icon name="down" />
            </button>
            <IconButton
              type="button"
              className="dp-nav"
              aria-label={t('picker.date.prev')}
              onClick={() => setMonth(addMonths(month + '-01', mode === 'day' ? -1 : -12).slice(0, 7))}
            >
              <Icon name="left" />
            </IconButton>
            <IconButton
              type="button"
              className="dp-nav"
              aria-label={t('picker.date.next')}
              onClick={() => setMonth(addMonths(month + '-01', mode === 'day' ? 1 : 12).slice(0, 7))}
            >
              <Icon name="right" />
            </IconButton>
          </div>
          {mode === 'day' ? (
            <div className="dp-grid">
              {dows().map((d) => (
                <span key={d} className="dp-dow">
                  {weekdayShort(d, true)}
                </span>
              ))}
              {grid(month).map((d) => (
                <button
                  type="button"
                  key={d}
                  className={[
                    'dp-day',
                    d.startsWith(month) ? '' : 'out',
                    d === today ? 'today' : '',
                    d === value ? 'sel' : '',
                    d === cursor ? 'cursor' : '',
                  ].join(' ')}
                  disabled={disabled(d)}
                  onClick={() => pick(d)}
                >
                  {Number(d.slice(8))}
                </button>
              ))}
            </div>
          ) : (
            <div className="dp-months">
              {Array.from({ length: 12 }, (_, i) => {
                const ym = `${y}-${String(i + 1).padStart(2, '0')}`;
                return (
                  <button
                    type="button"
                    key={i}
                    className={`dp-month ${i + 1 === m ? 'sel' : ''}`}
                    onClick={() => {
                      setMonth(ym);
                      setMode('day');
                    }}
                  >
                    {monthLabel(ym, { year: false })}
                  </button>
                );
              })}
            </div>
          )}
          <div className="dp-foot">
            <button type="button" className="btn plain" onClick={() => pick(today)}>
              {t('common.today')}
            </button>
            {clearable && value && (
              <button
                type="button"
                className="btn plain"
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                }}
              >
                {t('common.clear')}
              </button>
            )}
          </div>
        </Pop>
      )}
    </>
  );
}
