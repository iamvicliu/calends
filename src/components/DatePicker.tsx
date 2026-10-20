import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addDays, addMonths, parseDay } from '../../shared/billing.ts';
import { cnDateFull, monthLabel, weekdayShort } from '../../shared/format.ts';
import { intlLocale, t } from '../../shared/i18n.ts';
import { getState, today as todayOf } from '../store.ts';
import { Icon } from './ui.tsx';

/** 每周起始日跟随设置（1 周一、0 周日）；weekdayShort 的 0 是周日 */
const weekStart = () => getState()?.settings.weekStart ?? 1;
const dows = () => Array.from({ length: 7 }, (_, i) => (i + weekStart()) % 7);
const yearLabel = (y: number) => new Intl.DateTimeFormat(intlLocale(), { year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, 0, 1)));

function grid(month: string): string[] {
  const first = month + '-01';
  const dow = (new Date(parseDay(first)).getUTCDay() - weekStart() + 7) % 7;
  const start = addDays(first, -dow);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/**
 * 日期选择器：按钮显示「2026年10月19日」，点开是月历。
 * 弹层用 fixed 定位，避免被弹窗的滚动容器裁掉；窄屏时贴底显示。
 */
export function DatePicker({
  value,
  onChange,
  placeholder = t('picker.date.placeholder'),
  clearable,
  min,
  max,
}: {
  value?: string;
  onChange: (v: string | undefined) => void;
  placeholder?: string;
  clearable?: boolean;
  min?: string;
  max?: string;
}) {
  const today = todayOf();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState((value ?? today).slice(0, 7));
  const [mode, setMode] = useState<'day' | 'month'>('day');
  const [cursor, setCursor] = useState(value ?? today);
  const [pos, setPos] = useState<{ top: number; left: number; mobile: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = btn.current!.getBoundingClientRect();
    const mobile = window.innerWidth < 560;
    const W = 296;
    const H = 360;
    const below = r.bottom + 6 + H < window.innerHeight;
    setPos({ mobile, top: below ? r.bottom + 6 : Math.max(8, r.top - H - 6), left: Math.min(Math.max(8, r.right - W), window.innerWidth - W - 8) });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onScroll = () => place();
    window.addEventListener('resize', onScroll);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
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
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, cursor, mode]);

  const toggle = () => {
    if (!open) {
      setMonth((value ?? today).slice(0, 7));
      setCursor(value ?? today);
      setMode('day');
    }
    setOpen(!open);
  };
  const disabled = (d: string) => (min && d < min) || (max && d > max);
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
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Icon name="cal" />
        <span>{value ? cnDateFull(value) : placeholder}</span>
      </button>
      {open && pos && (
        <>
          {pos.mobile && <div className="dp-scrim" onClick={() => setOpen(false)} />}
          <div
            ref={pop}
            className={`dp-pop ${pos.mobile ? 'mobile' : ''}`}
            style={pos.mobile ? undefined : { top: pos.top, left: pos.left }}
            role="dialog"
            aria-label={t('picker.date.placeholder')}
          >
            <div className="dp-head">
              <button type="button" className="dp-title" onClick={() => setMode(mode === 'day' ? 'month' : 'day')}>
                {mode === 'day' ? monthLabel(month, { long: true }) : yearLabel(y)}
                <Icon name="down" />
              </button>
              <button
                type="button"
                className="dp-nav"
                aria-label={t('picker.date.prev')}
                onClick={() => setMonth(addMonths(month + '-01', mode === 'day' ? -1 : -12).slice(0, 7))}
              >
                <Icon name="left" />
              </button>
              <button
                type="button"
                className="dp-nav"
                aria-label={t('picker.date.next')}
                onClick={() => setMonth(addMonths(month + '-01', mode === 'day' ? 1 : 12).slice(0, 7))}
              >
                <Icon name="right" />
              </button>
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
                    disabled={!!disabled(d)}
                    onClick={() => pick(d)}
                  >
                    {Number(d.slice(8))}
                  </button>
                ))}
              </div>
            ) : (
              <div className="dp-months">
                {Array.from({ length: 12 }, (_, i) => (
                  <button
                    type="button"
                    key={i}
                    className={`dp-month ${i + 1 === m ? 'sel' : ''}`}
                    onClick={() => {
                      setMonth(`${y}-${String(i + 1).padStart(2, '0')}`);
                      setMode('day');
                    }}
                  >
                    {monthLabel(`${y}-${String(i + 1).padStart(2, '0')}`, { year: false })}
                  </button>
                ))}
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
          </div>
        </>
      )}
    </>
  );
}
