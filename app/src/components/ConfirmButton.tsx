import { useEffect, useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { t } from '../../../shared/i18n.ts';

/**
 * 弹窗底部的删除类按钮，就地二次确认、不再叠一层确认弹窗：
 * 第一次点，胶囊向前伸出一个问号并转成红底；再点一次才执行。失焦、按 Esc 或 4 秒不操作就收回。
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
      className={`btn confirm-btn ${armed ? 'danger-solid armed' : 'danger-soft'}`}
      disabled={disabled}
      aria-label={armed ? `${t('common.confirm')} ${typeof children === 'string' ? children : ''}${hint ? `, ${hint}` : ''}` : undefined}
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
      <span className="confirm-q" aria-hidden>
        <CircleHelp size={15} strokeWidth={2.2} />
      </span>
      {children}
    </button>
  );
}
