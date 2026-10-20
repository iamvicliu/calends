import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { symbol } from '../../shared/format.ts';
import { t } from '../../shared/i18n.ts';
import { ccyFlag, ccyName } from '../display.ts';
import { Icon } from './ui.tsx';

/**
 * 侧边栏的货币切换：点开在右侧弹出，可搜索。最上面是「原币」，然后是常用币种，再往下是汇率接口支持的全部货币。
 * 上下键移动、回车选中、Esc 关闭；窄屏贴底显示。
 */
export function CurrencyPicker({ value, used, all, onChange }: { value: string; used: string[]; all: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    mobile: boolean;
  } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const H = 440;
  useLayoutEffect(() => {
    if (!open) return;
    const r = btn.current!.getBoundingClientRect();
    const W = 300;
    const mobile = window.innerWidth < 560;
    setPos({
      mobile,
      top: Math.max(8, Math.min(r.bottom - H, window.innerHeight - H - 8)),
      left: Math.min(r.right + 8, window.innerWidth - W - 8),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  // 搜索：代码、中文名、符号都能搜
  const sections = useMemo(() => {
    const k = q.trim().toLowerCase();
    const hit = (c: string) => !k || c.toLowerCase().includes(k) || ccyName(c).toLowerCase().includes(k) || symbol(c).toLowerCase().includes(k);
    const out: Array<{ title?: string; items: string[] }> = [];
    if (!k || `${t('picker.ccy.orig')} 原币 original`.toLowerCase().includes(k)) out.push({ items: ['orig'] });
    const u = used.filter(hit);
    if (u.length) out.push({ title: t('picker.common'), items: u });
    const r = all.filter((c) => !used.includes(c) && hit(c));
    if (r.length) out.push({ title: k ? t('common.other') : t('picker.ccy.all'), items: r });
    return out;
  }, [q, used, all]);
  const flat = sections.flatMap((s) => s.items);

  useEffect(() => setHi(Math.max(0, flat.indexOf(value))), [open]);
  useEffect(() => {
    if (q) setHi(0);
  }, [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQ('');
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setHi((i) => Math.min(flat.length - 1, i + 1));
    else if (e.key === 'ArrowUp') setHi((i) => Math.max(0, i - 1));
    else if (e.key === 'Enter' && flat[hi]) pick(flat[hi]);
    else if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    } else return;
    e.preventDefault();
  };

  const orig = value === 'orig';
  let n = 0;
  return (
    <>
      <button type="button" ref={btn} class={`side-item theme-item ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} title={t('picker.ccy.switch')}>
        <Icon name="coins" />
        <span>{t('picker.ccy.label')}</span>
        <small>{orig ? t('picker.ccy.orig') : `${ccyName(value)}`}</small>
      </button>
      {open &&
        pos &&
        // 挂到 body 上：侧边栏自成层叠上下文，弹层放在里面会被主内容盖住
        createPortal(
          <>
            {pos.mobile && <div class="dp-scrim" onClick={() => setOpen(false)} />}
            <div ref={pop} class={`dp-pop cp-pop ${pos.mobile ? 'mobile' : ''}`} style={pos.mobile ? undefined : { top: pos.top, left: pos.left }} onKeyDown={onKey}>
              <label class="cp-search">
                <Icon name="search" />
                <input autoFocus value={q} placeholder={t('picker.ccy.search')} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
              </label>
              <div class="cp-list" ref={list} role="listbox" aria-label={t('picker.ccy.label')}>
                {sections.map((s) => (
                  <div key={s.title ?? 'orig'}>
                    {s.title && <div class="cp-head">{s.title}</div>}
                    {s.items.map((c) => {
                      const i = n++;
                      const sel = c === value;
                      return (
                        <button
                          type="button"
                          key={c}
                          data-i={i}
                          role="option"
                          aria-selected={sel}
                          class={`cp-opt ${sel ? 'sel' : ''} ${i === hi ? 'hi' : ''}`}
                          onMouseMove={() => setHi(i)}
                          onClick={() => pick(c)}
                        >
                          <span class="cp-flag">{c === 'orig' ? <Icon name="swap" /> : ccyFlag(c) ? <img src={ccyFlag(c)} alt="" loading="lazy" /> : <b>{symbol(c).trim() || c}</b>}</span>
                          <span class="cp-name">{c === 'orig' ? t('picker.ccy.orig') : ccyName(c)}</span>
                          <span class="cp-code">{c === 'orig' ? t('picker.ccy.origHint') : c}</span>
                          {sel && <Icon name="check" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {!flat.length && <div class="cp-empty">{t('picker.ccy.noMatch')}</div>}
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
