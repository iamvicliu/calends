// 订阅图标的几种形态：网址、站内路径（/ai/claude.svg）、内嵌图片（导入的 logo，data:image/…）与 emoji。
// 浏览器、公开页、日历订阅与提醒共用这一套判定，内嵌图片不会被当成文字输出。

/** 导入时内嵌 logo 的大小上限：与人员头像一致，避免整串 base64 撑大账本 */
export const ICON_DATA_LIMIT = 64 * 1024;

/** 内嵌图片：只认 png、jpeg、webp 的 base64 */
export const isDataIcon = (icon?: string): boolean => !!icon && /^data:image\/(png|jpeg|webp);base64,/.test(icon.trim());

/** 是图片（网址、站内路径或内嵌图片），而不是 emoji 文字 */
export const isImageIcon = (icon?: string): boolean => !!icon && (/^(https?:|\/)/.test(icon.trim()) || isDataIcon(icon));
