import { CopyImageButton } from './CopyImageButton.tsx';
import { toBlob } from 'html-to-image';
import type { ReactNode as ComponentChildren } from 'react';
import { useRef, useState } from 'react';
import { flow } from '../../../shared/format.ts';
import { t } from '../../../shared/i18n.ts';
import { toast, usePref } from '../store.ts';
import type { PrefKey } from '../../../shared/prefs.ts';
import { Icon, IconButton, Seg, Sheet, Toggle } from './ui.tsx';

/**
 * 分享图的通用弹窗：选样式 → 预览 → 复制图片 / 下载图片。年度回顾和单个订阅都用它。
 * 图里的订阅图标要用 SubIcon 的 proxied，经同源中转，导出时画布才不会被跨域图片污染。
 */
export function ShareSheet<S extends string>({
  title,
  styles,
  prefKey,
  fileName,
  base,
  top,
  render,
  onClose,
}: {
  title: string;
  styles: Array<[S, string]>;
  /** 记住上次选的样式 */
  /** 记住上次选的样式（多台设备同步） */
  prefKey: PrefKey;
  fileName: (style: string) => string;
  base: string;
  /** 样式选择上方的额外控件（如年份） */
  top?: ComponentChildren;
  /** hide 为真时不要出现具体金额：改用占比、时长、笔数等说法，而不是打码 */
  render: (style: S, ctx: { hide: boolean; m: (v: number, ccy?: string) => string }) => ComponentChildren;
  onClose: () => void;
}) {
  const [style, setStyle] = usePref<S>(prefKey, styles[0][0], (v): v is S => styles.some(([k]) => k === v));
  const [amounts, setAmounts] = useState(true);
  const [busy, setBusy] = useState(false);
  const node = useRef<HTMLDivElement>(null);
  const m = (v: number, ccy = base) => flow(v, ccy, { compact: true });
  const pick = (s: S) => setStyle(s);

  // 3 倍像素导出，发到聊天里也清楚
  const render3x = () => toBlob(node.current!, { pixelRatio: 3, skipFonts: true, cacheBust: false, includeQueryParams: true });
  const download = async () => {
    setBusy(true);
    try {
      const blob = await render3x();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob!);
      a.download = fileName(styles.find(([k]) => k === style)![1]);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch {
      toast(t('share.sheet.renderFailed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      narrow
      title={title}
      onClose={onClose}
      actions={
        <>
          <IconButton aria-label={t('share.sheet.download')} title={t('share.sheet.download')} disabled={busy} onClick={download}>
            <Icon name="download" />
          </IconButton>
          <CopyImageButton render={render3x} disabled={busy} />
        </>
      }
    >
      <div className="stack">
        {top}
        <Seg value={style} onChange={pick} options={styles} />
        <div className="share-stage">
          <div ref={node} className={`share share-${style}`}>
            {render(style, { hide: !amounts, m })}
          </div>
        </div>
        <div className="group-body">
          <div className="cell">
            <span className="cell-l">{t('share.sheet.showAmounts')}</span>
            <span className="cell-r">
              <Toggle checked={amounts} onChange={setAmounts} />
            </span>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
