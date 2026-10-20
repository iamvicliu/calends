import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { flag, symbol } from '../../shared/format.ts';
import type { CardNetwork, PaymentMethod, Subscription } from '../../shared/types.ts';
import { bankOf, BRANDS, brandOf, catColor, domainOf, KIND_BG, methodLogo, methodRegion, NETWORKS } from '../derive.ts';
import { useToasts } from '../store.ts';

// ---------- SF Symbols 风格线性图标 ----------
const P: Record<string, JSX.Element> = {
  chart: <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />,
  cal: (
    <>
      <rect x="3" y="4.5" width="18" height="16.5" rx="3" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </>
  ),
  list: (
    <>
      <rect x="3" y="3.5" width="18" height="17" rx="3" />
      <path d="M7.5 9h9M7.5 12.5h9M7.5 16h5" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="5" width="18" height="14.5" rx="3" />
      <path d="M3 9.5h18M15.5 14.5h2" />
    </>
  ),
  car: (
    <>
      <circle cx="8" cy="8" r="3" />
      <circle cx="16.5" cy="9" r="2.5" />
      <path d="M2.5 19c.6-3 2.8-5 5.5-5s4.9 2 5.5 5M14 14.2c.8-.4 1.6-.7 2.5-.7 2.3 0 4.2 1.8 4.7 4.5" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  tag: (
    <>
      <path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12l9 9-9 9z" />
      <circle cx="7.5" cy="7.5" r="1.3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  menu: <path d="M4 7h16M4 12h10M4 17h16" />,
  compose: <path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M18.4 3.6a2 2 0 0 1 2.8 2.8L12 15.6l-3.6.8.8-3.6z" />,
  home: <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  // 分类图标（Lucide 路径）
  bot: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 8V4.5M10 4.5h4M2 13.5v2M22 13.5v2M9.5 13v1.5M14.5 13v1.5" />
    </>
  ),
  sparkle: <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3Z" />,
  wrench: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8Z" />,
  film: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m10 8 6 4-6 4Z" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  zap: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />,
  server: (
    <>
      <rect x="2" y="3" width="20" height="8" rx="2" />
      <rect x="2" y="13" width="20" height="8" rx="2" />
      <path d="M6 7h.01M6 17h.01" />
    </>
  ),
  bag: (
    <>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18M16 10a4 4 0 0 1-8 0" />
    </>
  ),
  book: <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />,
  gamepad: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 12h4M8 10v4M15 13h.01M18 11h.01" />
    </>
  ),
  users: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  // 代付：一来一回
  swap: <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  left: <path d="m15 18-6-6 6-6" />,
  right: <path d="m9 18 6-6-6-6" />,
  down: <path d="m6 9 6 6 6-6" />,
  receipt: <path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2zM9 7.5h6M9 11.5h6M9 15.5h3" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
    </>
  ),
  link: <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  download: <path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 20h16" />,
  upload: <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 20h16" />,
  edit: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" />,
  pause: <path d="M8.5 5v14M15.5 5v14" />,
  play: <path d="M7 4.5v15l12-7.5z" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />,
  leaf: <path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15M5 19l7-7" />,
  archive: <path d="M3.5 4.5h17v4h-17zM5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M10 12.5h4" />,
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </>
  ),
  coins: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  share: <path d="M12 3v12M8 7l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3z" />
    </>
  ),
};

export function Icon({ name, size }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width={size} height={size} aria-hidden="true" class="i">
      {P[name]}
    </svg>
  );
}

// ---------- 订阅图标：emoji > 图片 URL > 站点图标 > 渐变首字母 ----------
const failed = new Set<string>();

/** proxied：经 /api/img 同源中转，导出图片时画布不会被跨域图片污染 */
export function SubIcon({ sub, size = 40, proxied }: { sub: Pick<Subscription, 'name' | 'icon' | 'url' | 'category'>; size?: number; proxied?: boolean }) {
  const [, force] = useState(0);
  const tint = catColor(sub.category);
  const style = { '--s': `${size}px`, '--tint': tint } as Record<string, string>;
  // 域名用注册商的图标，不用各自的站点图标：默认 Cloudflare，其他注册商在 icon 里填它的图标
  if (sub.category === '域名') {
    return (
      <span class="ico domain" style={style}>
        <img src={sub.icon?.startsWith('http') ? (proxied ? `/api/img?u=${encodeURIComponent(sub.icon)}` : sub.icon) : '/brands/cloudflare.svg'} alt="" />
      </span>
    );
  }
  const icon = sub.icon?.trim();
  // 不是链接也不是站内图片路径（/ai/claude.svg）的，当 emoji 显示
  if (icon && !/^(https?:|\/)/.test(icon)) {
    return (
      <span class="ico emoji" style={style}>
        {icon}
      </span>
    );
  }
  const domain = domainOf(sub.url);
  const raw = icon || (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : undefined);
  const src = raw && proxied && /^https?:/.test(raw) ? `/api/img?u=${encodeURIComponent(raw)}` : raw;
  if (src && !failed.has(src)) {
    return (
      // 目录里的 AI 标是透明底的矢量图，按站点图标那样放在白底上
      <span class={`ico ${icon && !icon.startsWith('/ai/') ? 'app' : 'fav'}`} style={style}>
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerpolicy="no-referrer"
          onLoad={(e) => {
            // Google 对未知域名返回 16px 的地球占位图
            const img = e.currentTarget as HTMLImageElement;
            if (!icon && img.naturalWidth <= 16) {
              failed.add(src);
              force((n) => n + 1);
            }
          }}
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
    <span class="ico mono" style={style}>
      {letter}
    </span>
  );
}

/** 支付方式胶囊：logo 标记 + 名称；全站凡是显示支付方式的地方都用它 */
export function PayBadge({ m }: { m?: PaymentMethod }) {
  if (!m) return <span class="pay none">未指定</span>;
  return (
    <span class="pay" title={m.name}>
      <MethodMark m={m} size={16} />
      <span class="pay-name">{m.name}</span>
    </span>
  );
}

export const CAT_ICON: Record<string, string> = { AI: 'bot', 工具: 'wrench', 影音: 'film', 音乐: 'music', 日用: 'home', 效率: 'zap', 购物: 'bag', 教育: 'book', 游戏: 'gamepad', 域名: 'globe', 服务器: 'server', 社交: 'users' };

/** 分类胶囊：分类色 + 图标 + 名称 */
export function CatChip({ cat }: { cat: string }) {
  return (
    <span class="cat-chip" style={{ '--tint': catColor(cat) } as Record<string, string>}>
      <Icon name={CAT_ICON[cat] ?? 'tag'} size={12} />
      {cat}
    </span>
  );
}

/**
 * 支付方式标记：统一显示支付产品自己的 logo —— 银行卡用银行图标集，
 * App Store、Plasma、SMART、Bybit 用各自的标；有地区的在右下角加国旗角标。没有 logo 的用卡面色 + 名称首字。
 */
export function MethodMark({ m, size = 36 }: { m: PaymentMethod; size?: number }) {
  const brand = brandOf(m);
  const bank = bankOf(m);
  const f = flag(methodRegion(m));
  // 小圆标优先用银行图标集（专为小尺寸设计）；其余用自定义 / 平台 / 官网 logo
  const logo = bank ? undefined : methodLogo(m);
  const onColor = BRANDS.find((b) => b.key === brand)?.onColor;
  // 白色 logo 放在卡面色上，彩色 logo 放在白底上
  const bg = bank || brand === 'appstore' ? undefined : onColor ? KIND_BG[m.kind] : logo ? (m.color && m.logo ? m.color : '#fff') : m.color || KIND_BG[m.kind];
  const style = { '--s': `${size}px`, background: bg } as Record<string, string>;
  return (
    <span class={`mmark ${bank ? 'bank' : (brand ?? '')} ${m.logoWide ? 'wide' : ''}`} style={style} aria-hidden="true">
      {bank ? <img src={`/banks/${bank}-rect.svg`} alt="" /> : brand === 'appstore' ? <i class="mm-glyph" /> : logo ? <img src={logo} alt="" /> : <b>{[...m.name][0]}</b>}
      {f && <em class="mm-flag">{f}</em>}
    </span>
  );
}

/** 卡组织标：Visa、Mastercard、银联… */
export function NetworkMark({ network, height = 20 }: { network?: CardNetwork; height?: number }) {
  if (!network) return null;
  return <img class="net-mark" src={`/networks/${network}.svg`} alt={NETWORKS[network]} title={NETWORKS[network]} style={{ height }} />;
}

/** 小组件式金额：小数位缩小 */
export function Amount({ value, ccy, sign, compact }: { value: number; ccy: string; sign?: boolean; compact?: boolean }) {
  if (!Number.isFinite(value)) return <span class="amt">—</span>;
  const neg = value < 0;
  const abs = Math.abs(value);
  const noDec = compact && abs >= 1000;
  const [int, dec] = abs.toFixed(noDec ? 0 : 2).split('.');
  return (
    <span class="amt">
      {neg ? '−' : sign ? '+' : ''}
      <span class="cur">{symbol(ccy).trim()}</span>
      {Number(int).toLocaleString('en-US')}
      {dec && <small>.{dec}</small>}
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange, small }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div class={`seg ${small ? 'sm' : ''}`} role="tablist">
      {options.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={value === k} class={value === k ? 'on' : ''} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** 页面工具栏：桌面端为半透明窗口工具栏，手机端为大标题 */
export function Toolbar({ title, sub, children }: { title: ComponentChildren; sub?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <header class="toolbar">
      <button class="sb-btn tb-lead" aria-label="打开侧边栏" onClick={() => window.dispatchEvent(new Event('ledger:drawer'))}>
        <Icon name="menu" />
      </button>
      <div class="tb-title">
        <h1>{title}</h1>
        {sub && <div class="tb-sub">{sub}</div>}
      </div>
      <button class="sb-btn tb-trail" aria-label="添加订阅" onClick={() => window.dispatchEvent(new Event('ledger:add'))}>
        <Icon name="compose" />
      </button>
      <div class="tb-actions">{children}</div>
    </header>
  );
}

// ---------- 弹层 ----------
export function Sheet(props: { title?: ComponentChildren; onClose: () => void; children: ComponentChildren; foot?: ComponentChildren; narrow?: boolean; bare?: boolean }) {
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
      <div class={`sheet ${props.narrow ? 'narrow' : ''} ${props.bare ? 'bare' : ''}`} role="dialog" aria-modal="true">
        <div class="grabber" />
        {props.bare ? (
          <button class="icon-btn sheet-close" onClick={props.onClose} aria-label="关闭">
            <Icon name="x" />
          </button>
        ) : (
          <div class="sheet-head">
            <h3>{props.title}</h3>
            <button class="icon-btn" onClick={props.onClose} aria-label="关闭">
              <Icon name="x" />
            </button>
          </div>
        )}
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

/** iOS 分组列表 */
export function Group({ title, foot, children }: { title?: ComponentChildren; foot?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="group">
      {title && <div class="group-title">{title}</div>}
      <div class="group-body">{children}</div>
      {foot && <div class="group-foot">{foot}</div>}
    </section>
  );
}

export function Cell({ label, children, onClick, sub }: { label: ComponentChildren; children?: ComponentChildren; onClick?: () => void; sub?: ComponentChildren }) {
  const inner = (
    <>
      <span class="cell-l">
        {label}
        {sub && <small>{sub}</small>}
      </span>
      <span class="cell-r">{children}</span>
    </>
  );
  return onClick ? (
    <button class="cell tap" onClick={onClick}>
      {inner}
      <Icon name="right" />
    </button>
  ) : (
    <div class="cell">{inner}</div>
  );
}
