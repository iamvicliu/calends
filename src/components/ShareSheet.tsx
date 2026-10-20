import { toBlob } from 'html-to-image';
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { money } from '../../shared/format.ts';
import { toast } from '../store.ts';
import { Icon, Seg, Sheet, Toggle } from './ui.tsx';

/**
 * 分享图的通用弹窗：选样式 → 预览 → 复制图片 / 下载图片。年度回顾和单个订阅都用它。
 * 图里的订阅图标要用 SubIcon 的 proxied，经同源中转，导出时画布才不会被跨域图片污染。
 */
export function ShareSheet<S extends string>({
  title,
  styles,
  storageKey,
  fileName,
  base,
  top,
  render,
  onClose,
}: {
  title: string;
  styles: Array<[S, string]>;
  /** 记住上次选的样式 */
  storageKey: string;
  fileName: (style: string) => string;
  base: string;
  /** 样式选择上方的额外控件（如年份） */
  top?: ComponentChildren;
  /** hide 为真时不要出现具体金额：改用占比、时长、笔数等说法，而不是打码 */
  render: (style: S, ctx: { hide: boolean; m: (v: number, ccy?: string) => string }) => ComponentChildren;
  onClose: () => void;
}) {
  const [style, setStyle] = useState<S>(() => {
    try {
      const v = localStorage.getItem(storageKey) as S | null;
      return v && styles.some(([k]) => k === v) ? v : styles[0][0];
    } catch {
      return styles[0][0];
    }
  });
  const [amounts, setAmounts] = useState(true);
  const [busy, setBusy] = useState(false);
  const node = useRef<HTMLDivElement>(null);
  const m = (v: number, ccy = base) => money(v, ccy, { compact: true });
  const pick = (s: S) => {
    setStyle(s);
    try {
      localStorage.setItem(storageKey, s);
    } catch {
      /* ignore */
    }
  };
  // 3 倍像素导出，发到聊天里也清楚
  const render3x = () => toBlob(node.current!, { pixelRatio: 3, skipFonts: true, cacheBust: false, includeQueryParams: true });
  const copy = async () => {
    setBusy(true);
    try {
      // Safari 要求在点击的同一个调用里拿到 ClipboardItem，所以传 Promise 进去
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': render3x().then((b) => b!) })]);
      toast('图片已复制，可以直接粘贴');
    } catch {
      toast('复制失败，试试下载图片');
    } finally {
      setBusy(false);
    }
  };
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
      toast('生成图片失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      narrow
      title={title}
      onClose={onClose}
      foot={
        <>
          <button class="btn" disabled={busy} onClick={download}>
            <Icon name="download" /> 下载图片
          </button>
          <button class="btn primary" disabled={busy} onClick={copy}>
            <Icon name="copy" /> {busy ? '生成中…' : '复制图片'}
          </button>
        </>
      }
    >
      <div class="stack">
        {top}
        <Seg value={style} onChange={pick} options={styles} />
        <div class="share-stage">
          <div ref={node} class={`share share-${style}`}>
            {render(style, { hide: !amounts, m })}
          </div>
        </div>
        <div class="group-body">
          <div class="cell">
            <span class="cell-l">显示金额</span>
            <span class="cell-r">
              <Toggle checked={amounts} onChange={setAmounts} />
            </span>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
