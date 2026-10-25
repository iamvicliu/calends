// 订阅图标的几种形态：网址、站内路径（/ai/claude.svg）、内嵌图片（导入的 logo，data:image/…）与 emoji。
// 浏览器、公开页、日历订阅与提醒共用这一套判定，内嵌图片不会被当成文字输出。
import { t } from './i18n.ts';

/** 导入时内嵌 logo 的大小上限：与人员头像一致，避免整串 base64 撑大账本 */
export const ICON_DATA_LIMIT = 64 * 1024;

/** 内嵌图片：只认 png、jpeg、webp 的 base64 */
export const isDataIcon = (icon?: string): boolean => !!icon && /^data:image\/(png|jpeg|webp);base64,/.test(icon.trim());

/** 是图片（网址、站内路径或内嵌图片），而不是 emoji 文字 */
export const isImageIcon = (icon?: string): boolean => !!icon && (/^(https?:|\/)/.test(icon.trim()) || isDataIcon(icon));

/** 文字图标最多几个字符（按字形计，组合 emoji 算一个）：够放 emoji 或简短符号，放不下一段说明 */
const ICON_TEXT_LIMIT = 4;
const graphemes = (s: string): number =>
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length : [...s].length;

/**
 * 写入订阅图标前的统一校验（MCP 新建与修改共用）：http(s) 网址、站内路径、png/jpeg/webp 内嵌图片（不超过 ICON_DATA_LIMIT），
 * 或一个 emoji / 简短符号。null、空串表示不设（清除）；其他值报错，不静默丢弃。返回去掉首尾空白后的值。
 */
export function iconInput(v: unknown): string | undefined {
  if (v == null) return undefined;
  const icon = String(v).trim();
  if (!icon) return undefined;
  const bad = () => new Error(t('mcp.error.invalidIcon', { value: icon.length > 40 ? `${icon.slice(0, 40)}…` : icon }));
  if (/^[a-z][a-z0-9+.-]*:/i.test(icon) && !icon.startsWith('data:')) {
    let url: URL;
    try {
      url = new URL(icon);
    } catch {
      throw bad();
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) throw bad();
    return icon;
  }
  if (icon.startsWith('data:')) {
    const b64 = icon.slice(icon.indexOf(',') + 1);
    if (!isDataIcon(icon) || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || Math.floor((b64.length * 3) / 4) > ICON_DATA_LIMIT) throw bad();
    return icon;
  }
  if (icon.startsWith('/')) {
    if (icon.startsWith('//') || /\s/.test(icon)) throw bad();
    return icon;
  }
  if (/[\s\p{Cc}]/u.test(icon) || graphemes(icon) > ICON_TEXT_LIMIT) throw bad();
  return icon;
}
