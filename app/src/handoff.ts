import { AVATAR_INPUT_MAX_BYTES, avatarCrop, prepareAvatarThumbnail } from '../../shared/avatar.ts';
import { t } from '../../shared/i18n.ts';
// 从别的页面（新建订阅表单）把文字、图片交给 AI 助手：先存进 sessionStorage，助手页打开时取走
import { go } from './router.ts';

const KEY = 'calends.assistant.handoff';

/** 压缩成长边不超过 1600px 的 JPEG（data URL）：截图够清晰，请求体也不大 */
export async function compressImage(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.86);
}

export function handoff(text: string, images: string[] = []) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ text, images }));
  } catch {
    /* 存不下（图片太大）就只带文字 */
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ text, images: [] }));
    } catch {
      /* 隐私模式：直接跳过去 */
    }
  }
  go('assistant');
}

export function takeHandoff(): { text: string; images: string[] } | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as { text: string; images: string[] };
  } catch {
    return null;
  }
}

/** Private roster thumbnail: center-crop and re-encode to strip source metadata. */
export async function compressAvatar(file: Blob): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > AVATAR_INPUT_MAX_BYTES)
    throw new Error(t('server.avatarInvalid'));
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error(t('server.avatarInvalid'));
  }
  try {
    const crop = avatarCrop(bmp.width, bmp.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = crop.size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(t('server.avatarInvalid'));
    ctx.drawImage(bmp, crop.x, crop.y, crop.side, crop.side, 0, 0, crop.size, crop.size);
    // PNG fallback covers browsers without a WebP encoder.
    return prepareAvatarThumbnail(canvas.toDataURL('image/webp', 0.82));
  } finally {
    bmp.close();
  }
}
