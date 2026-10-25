import { submitSheet } from '../keyboard.ts';
import { copyParts } from './copy.tsx';
import './ui.css';
import { createPortal } from 'react-dom';
import { tooltipPosition } from './tooltip-position.ts';
import type { ReactNode as ComponentChildren } from 'react';
import { Button as AriaButton, Tooltip, TooltipTrigger, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Fragment, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n.ts';
import { Toaster } from 'sonner';
import { Icon } from './icons.tsx';
import { IconButton } from './ui.tsx';
import { Cell } from './ui.tsx';

// ---------- 弹层 ----------
/** 打开中的弹窗，后开的在上面 */
export const openSheets: object[] = [];

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
  /** 自带完整表头的内容可传 null，仍复用弹窗的焦点、关闭和键盘行为。 */
  header?: ComponentChildren;
  actions?: ComponentChildren;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  // 兜底：焦点不在弹窗里（如落在 body 上）时 react-aria 收不到 Esc，这里替最上面那层关掉
  const close = useEffectEvent(() => props.onClose());
  useEffect(() => {
    const me = {};
    openSheets.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (openSheets[openSheets.length - 1] !== me) return;
      if (e.key === 'Escape' && e.target === document.body) close();
      if (dialog.current) submitSheet(e, dialog.current);
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      openSheets.splice(openSheets.indexOf(me), 1);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);
  return (
    <ModalOverlay className="scrim" isOpen isDismissable onOpenChange={(o) => !o && props.onClose()}>
      <Modal className={`sheet ${props.narrow ? 'narrow' : ''} ${props.bare ? 'bare' : ''}`}>
        <Dialog ref={dialog} className="sheet-dlg" aria-label={props.bare ? props.label : undefined}>
          <div className="grabber" />
          {props.header !== undefined ? (
            props.header
          ) : (
            <div className={`sheet-head ${props.bare ? 'bare-head' : ''}`} data-snapshot-hide>
              {!props.bare && (
                <Heading slot="title" level={3} className="ui-title">
                  <span className="ui-title-text">{copyParts(props.title)}</span>
                </Heading>
              )}
              <div className="sheet-head-actions">
                {props.actions}
                <IconButton onClick={props.onClose} aria-label={t('ui.close')}>
                  <Icon name="x" />
                </IconButton>
              </div>
            </div>
          )}
          <div className="sheet-body">{props.children}</div>
          {props.foot && <div className="sheet-foot sheet-actions">{copyParts(props.foot)}</div>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/**
 * 确认弹窗：替代浏览器原生 confirm（全局禁止 alert / confirm / prompt）。
 * const ok = await ask('删除？')；取消、Esc、点遮罩都算否。由 AskLayer 统一渲染
 */
export type AskReq = { message: ComponentChildren; ok?: string; resolve: (v: boolean) => void };

export let askSet: ((r: AskReq | null) => void) | null = null;

/** 正在等回答的那一问：新的一问顶替它时，旧的按「否」结束，不会永远挂起 */
export let asking: AskReq | null = null;

export function ask(message: ComponentChildren, opts: { ok?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!askSet) return resolve(false);
    asking?.resolve(false);
    asking = { message, ...opts, resolve };
    askSet(asking);
  });
}

export function AskLayer() {
  const [req, setReq] = useState<AskReq | null>(null);
  askSet = setReq;
  // 整棵树重新挂载（换语言）或卸载时：未回答的一问按「否」结束，旧的 setter 不再接收新问题
  useEffect(
    () => () => {
      if (askSet === setReq) askSet = null;
      asking?.resolve(false);
      asking = null;
    },
    [],
  );
  if (!req) return null;
  const done = (v: boolean) => {
    if (asking === req) asking = null;
    setReq(null);
    req.resolve(v);
  };
  return (
    <Sheet
      narrow
      title={t('common.confirmTitle')}
      onClose={() => done(false)}
      foot={
        <>
          <button className="btn" autoFocus onClick={() => done(false)}>
            {t('common.cancel')}
          </button>
          <button className="btn danger-solid" onClick={() => done(true)}>
            {req.ok ?? t('common.confirm')}
          </button>
        </>
      }
    >
      <p className="ask-msg">{req.message}</p>
    </Sheet>
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

// ---------- 悬浮提示 ----------
export type Tip = { x: number; top: number; bottom: number; html: ComponentChildren };

export let tipSet: ((tip: Tip | null) => void) | undefined;

export function TipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const ref = useRef<HTMLDivElement>(null);
  tipSet = setTip;
  useLayoutEffect(() => {
    if (!tip || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    setPosition(tooltipPosition(tip, box, { width: window.innerWidth, height: window.innerHeight }));
  }, [tip]);
  useEffect(() => {
    const hide = () => setTip(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('keydown', key);
      tipSet = undefined;
    };
  }, []);
  return (
    tip &&
    createPortal(
      <div ref={ref} className="tip" role="tooltip" style={position}>
        {copyParts(tip.html)}
      </div>,
      document.body,
    )
  );
}

/** 悬浮提示里的明细表：名称左对齐、金额右对齐，标题行与明细同一套两列 */
export function TipTable({
  head,
  rows,
}: {
  head: [ComponentChildren, ComponentChildren];
  rows: Array<{ key: string; label: ComponentChildren; value: ComponentChildren }>;
}) {
  return (
    <div className="tip-table">
      <b>{head[0]}</b>
      <b className="num">{head[1]}</b>
      {rows.map((r) => (
        <Fragment key={r.key}>
          <span>{r.label}</span>
          <span className="num">{r.value}</span>
        </Fragment>
      ))}
    </div>
  );
}

export function tipProps(html: () => ComponentChildren) {
  const show = (e: { currentTarget: EventTarget }) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    tipSet?.({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom, html: html() });
  };
  const hide = () => tipSet?.(null);
  return { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide };
}

/** 说明可悬停、键盘聚焦或点按；React Aria 负责 portal、翻转、视口边界和 Escape。 */
export function Hint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipTrigger isOpen={open} onOpenChange={setOpen} shouldCloseOnPress={false} delay={150} closeDelay={100}>
      <AriaButton
        className="icon-btn hint"
        aria-label={text}
        onHoverStart={() => setOpen(true)}
        onHoverEnd={() => setOpen(false)}
        onPress={() => setOpen(true)}
      >
        <Icon name="info" />
      </AriaButton>
      <Tooltip className="info-tip" placement="top" offset={8} containerPadding={8}>
        {copyParts(text)}
      </Tooltip>
    </TooltipTrigger>
  );
}

/** 读取失败：一行提示加重试（沿用 Cell 的可点行），不把失败显示成空列表 */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <Cell label={t('ui.loadFailed')} onClick={onRetry}>
      {t('ui.retry')}
    </Cell>
  );
}
