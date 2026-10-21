import { base } from '../base.ts';
import type { ReactNode as ComponentChildren, JSX } from 'react';
import { Dialog, Heading, Modal, ModalOverlay, Switch as AriaSwitch, ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { flowSign, symbol } from '../../../shared/format.ts';
import { FLAGS } from '../display.ts';
import type { CardNetwork, PaymentMethod, Subscription } from '../../../shared/types.ts';
import { bankOf, BRANDS, brandOf, catColor, catIcon, faviconOf, isDomainCat, KIND_BG, methodLogo, methodRegion, NETWORKS } from '../derive.ts';
import { CatGlyph } from './CatGlyph.tsx';
import { intlLocale, t } from '../../../shared/i18n.ts';
import { Toaster } from 'sonner';

// ---------- SF Symbols 风格线性图标 ----------
const P: Record<string, JSX.Element> = {
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.7 12.3 21 2M17 6l3 3M14 9l2 2" />
    </>
  ),
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
  // 拖动排序的把手
  grip: (
    <>
      <circle cx="9" cy="6" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="6" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="15" cy="18" r="1" />
    </>
  ),
  // 侧边栏「AI 助手」：带两行字的对话气泡
  chat: (
    <>
      <path d="M21 12a8.5 8.5 0 0 1-12.6 7.45L3 21l1.55-5.4A8.5 8.5 0 1 1 21 12Z" />
      <path d="M8.5 10.5h7M8.5 14h4.5" />
    </>
  ),
  // 侧边栏「AI」
  bot: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 8V4.5M10 4.5h4M2 13.5v2M22 13.5v2M9.5 13v1.5M14.5 13v1.5" />
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
  left: <path d="m15 18-6-6 6-6" />,
  'sort-asc': <path d="m3 8 4-4 4 4M7 4v16M11 12h4M11 16h7M11 20h10" />,
  'sort-desc': <path d="m3 16 4 4 4-4M7 20V4M11 4h10M11 8h7M11 12h4" />,
  right: <path d="m9 18 6-6-6-6" />,
  down: <path d="m6 9 6 6 6-6" />,
  updown: <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />,
  ban: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.7 5.7 12.6 12.6" />
    </>
  ),
  receipt: <path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2zM9 7.5h6M9 11.5h6M9 15.5h3" />,
  link: <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  download: <path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 20h16" />,
  edit: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />,
  leaf: <path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15M5 19l7-7" />,
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
};

export function Icon({ name, size }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      aria-hidden="true"
      className="i"
    >
      {P[name]}
    </svg>
  );
}

// ---------- 订阅图标：emoji > 图片 URL > 站点图标 > 渐变首字母 ----------
const failed = new Set<string>();

/** proxied：经 /api/img 同源中转，导出图片时画布不会被跨域图片污染 */
export function SubIcon({ sub, size = 40, proxied }: { sub: Pick<Subscription, 'name' | 'icon' | 'url' | 'category'>; size?: number; proxied?: boolean }) {
  // failed 是模块级的集合，React Compiler 看不到它的变化：用 tried 计数让「挑哪张图」随失败重新计算
  const [tried, force] = useState(0);
  const tint = catColor(sub.category);
  const style = { '--s': `${size}px`, '--tint': tint } as Record<string, string>;
  // 域名用注册商的图标，不用各自的站点图标：默认 Cloudflare，其他注册商在 icon 里填它的图标
  if (isDomainCat(sub.category)) {
    return (
      <span className="ico domain" style={style}>
        <img
          src={sub.icon?.startsWith('http') ? (proxied ? base(`/api/img?u=${encodeURIComponent(sub.icon)}`) : sub.icon) : base('/brands/cloudflare.svg')}
          alt=""
        />
      </span>
    );
  }
  const icon = sub.icon?.trim();
  // 不是链接也不是站内图片路径（/ai/claude.svg）的，当 emoji 显示
  if (icon && !/^(https?:|\/)/.test(icon)) {
    return (
      <span className="ico emoji" style={style}>
        {icon}
      </span>
    );
  }
  // 依次尝试：填写的图标 → 官网图标；都加载失败才用首字母
  const viaProxy = (u: string) => (proxied && /^https?:/.test(u) ? base(`/api/img?u=${encodeURIComponent(u)}`) : base(u));
  const raw = [icon, faviconOf(sub.url)].find((u): u is string => tried >= 0 && !!u && !failed.has(viaProxy(u)));
  const src = raw && viaProxy(raw);
  if (src) {
    const fail = () => {
      failed.add(src);
      force((n) => n + 1);
    };
    return (
      // 目录里的 AI 标是透明底的矢量图，按站点图标那样放在白底上
      <span className={`ico ${raw === icon && !icon.startsWith('/ai/') ? 'app' : 'fav'}`} style={style}>
        <img
          src={base(src)}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={(e) => {
            // Google 对未知域名返回 16px 的地球占位图
            if (raw !== icon && e.currentTarget.naturalWidth <= 16) fail();
          }}
          onError={fail}
          // 失败的图片（尤其是缓存里的）可能在监听器挂上之前就已报错：挂载时补查一次
          ref={(el) => {
            if (el?.complete && el.naturalWidth === 0) queueMicrotask(fail);
          }}
        />
      </span>
    );
  }
  const letter = [...sub.name.replace(/^(域名|VPS)\s*/, '')][0]?.toUpperCase() ?? '?';
  return (
    <span className="ico mono" style={style}>
      {letter}
    </span>
  );
}

/** 支付方式胶囊：logo 标记 + 名称；全站凡是显示支付方式的地方都用它 */
export function PayBadge({ m }: { m?: PaymentMethod }) {
  if (!m) return <span className="pay none">{t('ui.method.none')}</span>;
  return (
    <span className="pay" title={m.name}>
      <MethodMark m={m} size={16} />
      <span className="pay-name">{m.name}</span>
    </span>
  );
}

/** 分类图标（按分类表里设的图标或 emoji） */
export function CatIcon({ cat, size = 14 }: { cat: string; size?: number }) {
  return <CatGlyph icon={catIcon(cat)} size={size} />;
}

/** 分类胶囊：分类色 + 图标 + 名称 */
export function CatChip({ cat }: { cat: string }) {
  return (
    <span className="cat-chip" style={{ '--tint': catColor(cat) } as Record<string, string>}>
      <CatIcon cat={cat} size={12} />
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
  const region = methodRegion(m);
  // 小圆标优先用银行图标集（专为小尺寸设计）；其余用自定义 / 平台 / 官网 logo
  const logo = bank ? undefined : methodLogo(m);
  const bg = bank || brand === 'appstore' ? undefined : markBg(m, logo, BRANDS.find((b) => b.key === brand)?.onColor);
  const style = { '--s': `${size}px`, background: bg } as Record<string, string>;
  return (
    <span className={`mmark ${bank ? 'bank' : (brand ?? '')} ${m.logoWide ? 'wide' : ''}`} style={style} aria-hidden="true">
      {bank ? (
        <img src={base(`/banks/${bank}-rect.svg`)} alt="" />
      ) : brand === 'appstore' ? (
        <i className="mm-glyph" />
      ) : logo ? (
        <img src={base(logo)} alt="" />
      ) : (
        <b>{[...m.name][0]}</b>
      )}
      {region && <FlagImg cc={region} className="mm-flag" />}
    </span>
  );
}

/** 标记底色：白色 logo 放在卡面色上，彩色 logo 放在白底上 */
function markBg(m: PaymentMethod, logo: string | undefined, onColor: boolean | undefined): string {
  if (onColor) return KIND_BG[m.kind];
  if (logo) return m.color && m.logo ? m.color : '#fff';
  return m.color || KIND_BG[m.kind];
}

/** 卡组织标：Visa、Mastercard、银联… */
export function NetworkMark({ network, height = 20 }: { network?: CardNetwork; height?: number }) {
  if (!network) return null;
  return <img className="net-mark" src={base(`/networks/${network}.svg`)} alt={NETWORKS[network]} title={NETWORKS[network]} style={{ height }} />;
}

/** 小组件式金额：小数位缩小 */
export function Amount({ value, ccy, compact, plain }: { value: number; ccy: string; compact?: boolean; plain?: boolean }) {
  if (!Number.isFinite(value)) return <span className="amt">—</span>;
  const abs = Math.abs(value);
  const noDec = compact && abs >= 1000;
  // 整数分组和小数点都跟随当前语言（德语 1.234,56、法语 1 234,56），小数部分缩小显示
  const parts = new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: noDec ? 0 : 2, maximumFractionDigits: noDec ? 0 : 2 }).formatToParts(abs);
  const int = parts
    .filter((p) => p.type !== 'decimal' && p.type !== 'fraction')
    .map((p) => p.value)
    .join('');
  const point = parts.find((p) => p.type === 'decimal')?.value;
  const dec = parts.find((p) => p.type === 'fraction')?.value;
  return (
    <span className="amt" style={!plain && value > 0 ? { color: 'var(--green)' } : undefined}>
      {plain ? (value < 0 ? '−' : '') : flowSign(value)}
      <span className="cur">{symbol(ccy).trim()}</span>
      {int}
      {dec && (
        <small>
          {point}
          {dec}
        </small>
      )}
    </span>
  );
}

/** 分段控件：单选、不能取消；左右方向键切换（react-aria 的 ToggleButtonGroup） */
export function Seg<T extends string>({
  value,
  options,
  onChange,
  small,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
  small?: boolean;
}) {
  return (
    <ToggleButtonGroup
      className={`seg ${small ? 'sm' : ''}`}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const k = [...keys][0];
        if (k != null && k !== value) onChange(k as T);
      }}
    >
      {options.map(([k, l]) => (
        <ToggleButton key={k} id={k} className={({ isSelected }) => (isSelected ? 'on' : '')}>
          {l}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

/** 页面工具栏：桌面端为半透明窗口工具栏，手机端为大标题 */
export function Toolbar({ title, sub, children }: { title: ComponentChildren; sub?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <header className="toolbar">
      <button className="sb-btn tb-lead" aria-label={t('ui.toolbar.openSidebar')} onClick={() => window.dispatchEvent(new Event('ledger:drawer'))}>
        <Icon name="menu" />
      </button>
      <div className="tb-title">
        <h1>{title}</h1>
        {sub && <div className="tb-sub">{sub}</div>}
      </div>
      <button className="sb-btn tb-trail" aria-label={t('ui.toolbar.add')} onClick={() => window.dispatchEvent(new Event('ledger:add'))}>
        <Icon name="compose" />
      </button>
      <div className="tb-actions">{children}</div>
    </header>
  );
}

// ---------- 弹层 ----------
/** 打开中的弹窗，后开的在上面 */
const openSheets: object[] = [];

/**
 * 弹窗（react-aria Modal）：宽屏居中，窄屏贴底。点遮罩、按 Esc 关闭，多层叠放时只关最上面那层；
 * 打开期间焦点留在弹窗里、背景不滚动，关闭后焦点回到打开它的按钮。
 * 没有标题（bare）时用 label 作为读屏名称。
 */
export function Sheet(props: {
  title?: ComponentChildren;
  label?: string;
  onClose: () => void;
  children: ComponentChildren;
  foot?: ComponentChildren;
  narrow?: boolean;
  bare?: boolean;
}) {
  // 兜底：焦点不在弹窗里（如落在 body 上）时 react-aria 收不到 Esc，这里替最上面那层关掉
  const close = useEffectEvent(() => props.onClose());
  useEffect(() => {
    const me = {};
    openSheets.push(me);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && e.target === document.body && openSheets[openSheets.length - 1] === me && close();
    document.addEventListener('keydown', onKey);
    return () => {
      openSheets.splice(openSheets.indexOf(me), 1);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <ModalOverlay className="scrim" isOpen isDismissable onOpenChange={(o) => !o && props.onClose()}>
      <Modal className={`sheet ${props.narrow ? 'narrow' : ''} ${props.bare ? 'bare' : ''}`}>
        <Dialog className="sheet-dlg" aria-label={props.bare ? props.label : undefined}>
          <div className="grabber" />
          {props.bare ? (
            <button className="icon-btn sheet-close" onClick={props.onClose} aria-label={t('ui.close')}>
              <Icon name="x" />
            </button>
          ) : (
            <div className="sheet-head">
              <Heading slot="title" level={3}>
                {props.title}
              </Heading>
              <button className="icon-btn" onClick={props.onClose} aria-label={t('ui.close')}>
                <Icon name="x" />
              </button>
            </div>
          )}
          <div className="sheet-body">{props.children}</div>
          {props.foot && <div className="sheet-foot">{props.foot}</div>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/** 全局提示（Sonner）：跟随亮色/暗色主题；手机上避开底部的安全区 */
export function Toasts() {
  const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
  useEffect(() => {
    const el = document.documentElement;
    const mo = new MutationObserver(() => setTheme(el.dataset.theme === 'dark' ? 'dark' : 'light'));
    mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return (
    <Toaster
      theme={theme as 'light' | 'dark'}
      position="bottom-center"
      offset={24}
      mobileOffset={{ bottom: 'calc(16px + env(safe-area-inset-bottom))' }}
      gap={8}
      visibleToasts={4}
      toastOptions={{ className: 'ledger-toast' }}
    />
  );
}

/** 跟踪元素的实际宽度（ResizeObserver）：图表按它布局，未测量前为 0 */
/**
 * 国旗：用图片，不用 emoji（Windows 不显示国旗 emoji，只会变成两个字母）；没有对应图片时不显示
 */
export function FlagImg({ cc, className = '' }: { cc?: string; className?: string }) {
  const k = cc?.trim().toLowerCase();
  if (!k || !FLAGS.has(k)) return null;
  return <img className={`flag-img ${className}`} src={base(`/flags/${k}.png`)} alt="" loading="lazy" />;
}

/** 右上角的状态胶囊：进行中绿点、待收橙点、已停止换成红色「禁止」图标，形状都一样 */
export function StatusPill({ tone, children }: { tone: 'ok' | 'owe' | 'stop'; children: ComponentChildren }) {
  return (
    <span className={`ph-status ${tone}`}>
      {tone === 'stop' ? <Icon name="ban" size={13} /> : <i />}
      {children}
    </span>
  );
}

/**
 * 卡片里的订阅名：悬停出现下划线，点它只打开订阅本身；卡片其余区域打开合租 / 代付自己的弹窗
 */
export function NameLink({ children, onClick }: { children: ComponentChildren; onClick: () => void }) {
  return (
    <span
      className="name-link"
      role="link"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </span>
  );
}

export function useWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

// ---------- 悬浮提示 ----------
let tipSet: ((t: { x: number; y: number; html: ComponentChildren } | null) => void) | undefined;

export function TipLayer() {
  const [tip, setTip] = useState<{ x: number; y: number; html: ComponentChildren } | null>(null);
  tipSet = setTip;
  if (!tip) return null;
  const x = Math.min(Math.max(tip.x, 90), window.innerWidth - 90);
  return (
    <div className="tip" style={{ left: x, top: tip.y }}>
      {tip.html}
    </div>
  );
}

export function tipProps(html: () => ComponentChildren) {
  return {
    onMouseEnter: (e: React.MouseEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      tipSet?.({ x: r.left + r.width / 2, y: r.top, html: html() });
    },
    onMouseLeave: () => tipSet?.(null),
  };
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <AriaSwitch className="toggle" isSelected={checked} onChange={onChange} aria-label={label}>
      <i />
    </AriaSwitch>
  );
}

/** iOS 分组列表 */
export function Group({ title, foot, children }: { title?: ComponentChildren; foot?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section className="group">
      {title && <div className="group-title">{title}</div>}
      <div className="group-body">{children}</div>
      {foot && <div className="group-foot">{foot}</div>}
    </section>
  );
}

export function Cell({
  label,
  children,
  onClick,
  sub,
}: {
  label: ComponentChildren;
  children?: ComponentChildren;
  onClick?: () => void;
  sub?: ComponentChildren;
}) {
  const inner = (
    <>
      <span className="cell-l">
        {label}
        {sub && <small>{sub}</small>}
      </span>
      <span className="cell-r">{children}</span>
    </>
  );
  return onClick ? (
    <button className="cell tap" onClick={onClick}>
      {inner}
      <Icon name="right" />
    </button>
  ) : (
    <div className="cell">{inner}</div>
  );
}
