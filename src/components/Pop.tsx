import type { CSSProperties, ReactNode, RefObject } from 'react';
import { useState } from 'react';
import { Dialog, Modal, ModalOverlay, Popover } from 'react-aria-components';

/** 窄屏时弹层贴底显示（与之前的选择器一致） */
const MOBILE = 560;

/**
 * 选择器共用的弹出层（react-aria）：宽屏是挂在按钮旁的 Popover，自动翻转、跟随滚动；窄屏是贴底的面板，带遮罩。
 * 点外面、按 Esc 关闭，焦点留在弹层里、关闭后回到按钮；放在弹窗（Sheet）里也能正确叠放。
 * 由调用方按需挂载（挂上即打开）。className 给到盒子本身（.dp-pop 系列样式）；style 只用于宽屏（窄屏高度交给样式表）。
 */
export function Pop({
  triggerRef,
  onClose,
  label,
  className = '',
  style,
  placement = 'bottom end',
  children,
}: {
  triggerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  label: string;
  className?: string;
  style?: CSSProperties;
  placement?: 'bottom end' | 'bottom start' | 'right bottom' | 'right top';
  children: ReactNode;
}) {
  // 打开那一刻决定用哪种形态，打开期间不来回切换
  const [mobile] = useState(() => window.innerWidth < MOBILE);
  const change = (o: boolean) => !o && onClose();
  if (mobile)
    return (
      <ModalOverlay className="dp-scrim" isOpen onOpenChange={change} isDismissable>
        <Modal className="pop-shell">
          <Dialog aria-label={label} className={`dp-pop mobile ${className}`}>
            {children}
          </Dialog>
        </Modal>
      </ModalOverlay>
    );
  return (
    <Popover className="pop-shell" triggerRef={triggerRef} isOpen onOpenChange={change} placement={placement} offset={6} containerPadding={8}>
      <Dialog aria-label={label} className={`dp-pop ${className}`} style={style}>
        {children}
      </Dialog>
    </Popover>
  );
}
