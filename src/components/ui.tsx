import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Subscription } from '../../shared/types.ts';
import { catColor, domainOf } from '../derive.ts';
import { useToasts } from '../store.ts';

// ---------- 线性图标 ----------
const P: Record<string, JSX.Element> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  cal: (
    <>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  wallet: (
    <>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19v4" />
      <path d="M3 7.5V18a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5.5A2.5 2.5 0 0 1 3 7.5Z" />
      <path d="M16.5 14.5h.01" />
    </>
  ),
  car: (
    <>
      <path d="M5 16.5V12l2-5h10l2 5v4.5" />
      <path d="M3.5 12h17v4.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
      <path d="M6.5 17.5V20M17.5 17.5V20M7 14.5h.01M17 14.5h.01" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  left: <path d="m15 18-6-6 6-6" />,
  right: <path d="m9 18 6-6-6-6" />,
  receipt: <path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2zM9 7.5h6M9 11.5h6M9 15.5h3" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
    </>
  ),
  link: <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  download: <path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 20h16" />,
  upload: <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 20h16" />,
};

export function Icon({ name, size }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width={size} height={size} aria-hidden="true">
      {P[name]}
    </svg>
  );
}

// ---------- 订阅图标：emoji > 图片 URL > 站点 favicon > 首字母 ----------
const failed = new Set<string>();

export function SubIcon({ sub, size = '' }: { sub: Pick<Subscription, 'name' | 'icon' | 'url' | 'category'>; size?: '' | 'sm' | 'xs' }) {
  const [, force] = useState(0);
  const tint = catColor(sub.category);
  const style = { '--tint': tint } as Record<string, string>;
  const icon = sub.icon?.trim();
  if (icon && !/^https?:/.test(icon)) {
    return (
      <span class={`ico emoji ${size}`} style={style}>
        {icon}
      </span>
    );
  }
  const domain = domainOf(sub.url);
  const src = icon || (domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : undefined);
  if (src && !failed.has(src)) {
    return (
      <span class={`ico ${size}`} style={style}>
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerpolicy="no-referrer"
          onError={() => {
            failed.add(src);
            force((n) => n + 1);
          }}
        />
      </span>
    );
  }
  const letter = [...sub.name.replace(/^(域名|VPS)\s*/, '')][0]?.toUpperCase() ?? '?';
  return (
    <span class={`ico ${size}`} style={style}>
      {letter}
    </span>
  );
}

// ---------- 弹层 ----------
export function Sheet(props: { title: ComponentChildren; onClose: () => void; children: ComponentChildren; foot?: ComponentChildren; narrow?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class={`sheet ${props.narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true">
        <div class="grabber" />
        <div class="sheet-head">
          <h3>{props.title}</h3>
          <button class="icon-btn" onClick={props.onClose} aria-label="关闭">
            <Icon name="x" />
          </button>
        </div>
        <div class="sheet-body">{props.children}</div>
        {props.foot && <div class="sheet-foot">{props.foot}</div>}
      </div>
    </div>
  );
}

export function Toasts() {
  const list = useToasts();
  return (
    <div class="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} class={`toast ${t.err ? 'err' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---------- 悬浮提示 ----------
let tipSet: ((t: { x: number; y: number; html: ComponentChildren } | null) => void) | undefined;

export function TipLayer() {
  const [tip, setTip] = useState<{ x: number; y: number; html: ComponentChildren } | null>(null);
  tipSet = setTip;
  if (!tip) return null;
  const x = Math.min(Math.max(tip.x, 90), window.innerWidth - 90);
  return (
    <div class="tip" style={{ left: x, top: tip.y }}>
      {tip.html}
    </div>
  );
}

export function tipProps(html: () => ComponentChildren) {
  return {
    onMouseEnter: (e: MouseEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      tipSet?.({ x: r.left + r.width / 2, y: r.top, html: html() });
    },
    onMouseLeave: () => tipSet?.(null),
  };
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label class="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <i />
    </label>
  );
}

export function SectionHead(props: { no: string; label: string; title: string; meta?: ComponentChildren; right?: ComponentChildren }) {
  return (
    <div class="section-head">
      <div class="section-head-row">
        <div>
          <div class="eyebrow">
            {props.no} · {props.label}
          </div>
          <h2 class="h2">{props.title}</h2>
          {props.meta && <div class="meta">{props.meta}</div>}
        </div>
        {props.right}
      </div>
    </div>
  );
}
