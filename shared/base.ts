/** 统一的部署前缀：空串表示根目录，按完整路径段匹配。 */
export const normalizeBasePath = (value = '') =>
  value
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/^(.+)$/, '/$1');

/** 站内绝对路径加前缀；外链、data URL、emoji 与已经带前缀的路径保持原样。 */
export function withBase(path: string, basePath = ''): string {
  const prefix = normalizeBasePath(basePath);
  if (!prefix || !path.startsWith('/') || path.startsWith('//')) return path;
  if (path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`) || path.startsWith(`${prefix}#`)) return path;
  return `${prefix}${path}`;
}

export function stripBase(path: string, basePath = ''): string {
  const prefix = normalizeBasePath(basePath);
  return prefix && (path === prefix || path.startsWith(`${prefix}/`)) ? path.slice(prefix.length) || '/' : path;
}

/** SITE_URL 可以只写域名，也可以已包含前缀；始终只加一次。 */
export function siteUrl(value: string, basePath = ''): string {
  const site = value.replace(/\/+$/, '');
  const prefix = normalizeBasePath(basePath);
  return prefix && !site.endsWith(prefix) ? `${site}${prefix}` : site;
}
