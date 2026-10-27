import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../../../shared/i18n.ts';

/**
 * 弹窗底部的删除类按钮，就地二次确认、不再叠一层确认弹窗：
 * 平时是红框红字的透明胶囊；第一次点转成实心红底、文字换成「确认删除？」，再点一次才执行。失焦、按 Esc 或 4 秒不操作就收回。
 */
export function ConfirmButton({
  children,
  onConfirm,
  disabled,
  hint,
}: {
  children: ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
  /** 确认态的说明（如「这几期一起回到待收」），作为提示与读屏文字 */
  hint?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      className={`btn confirm-btn${armed ? ' armed' : ''}`}
      disabled={disabled}
      aria-label={armed && hint ? `${t('common.confirmDelete')} ${hint}` : undefined}
      title={armed ? hint : undefined}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
      onBlur={() => setArmed(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && armed) {
          e.stopPropagation();
          setArmed(false);
        }
      }}
    >
      {armed ? t('common.confirmDelete') : children}
    </button>
  );
}
