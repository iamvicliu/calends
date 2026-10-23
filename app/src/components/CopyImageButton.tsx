import { useRef, useState } from 'react';
import { t } from '../../../shared/i18n.ts';
import { snapshotCard } from '../snapshot.ts';
import { toast } from '../store.ts';
import { Icon, IconButton } from './ui.tsx';

/** Keep ClipboardItem and write in the click stack; Safari accepts the PNG promise. */
export async function copyImage(render: () => Promise<Blob | null>): Promise<void> {
  try {
    const png = render().then((blob) => {
      if (!blob) throw new Error('PNG');
      return blob;
    });
    // A synchronous clipboard failure must not leave a rejected render promise unhandled.
    void png.catch(() => {});
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    toast(t('detail.toast.imageCopied'));
  } catch {
    toast(t('family.sheet.copyFailed'), true);
  }
}

/** One image action for sheets and cards. Card callers mark their capture boundary. */
export function CopyImageButton({ render, hover = false, disabled = false }: { render?: () => Promise<Blob | null>; hover?: boolean; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return null;
  return (
    <IconButton
      className={hover ? 'copy-image copy-hover' : 'copy-image'}
      aria-label={t('detail.action.copyImage')}
      title={t('detail.action.copyImage')}
      data-snapshot-hide
      disabled={busy || disabled}
      onClick={(event) => {
        if (pending.current) return;
        const card = event.currentTarget.closest<HTMLElement>('[data-copy-card]');
        pending.current = true;
        setBusy(true);
        void copyImage(render ?? (() => (card ? snapshotCard(card) : Promise.reject(new Error('PNG'))))).finally(() => {
          pending.current = false;
          setBusy(false);
        });
      }}
    >
      <Icon name="copy" />
    </IconButton>
  );
}
