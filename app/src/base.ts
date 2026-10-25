import { normalizeBasePath, withBase } from '../../shared/base.ts';

export const BASE_PATH = normalizeBasePath(import.meta.env.BASE_URL);
export const base = (path: string) => withBase(path, BASE_PATH);
/** 根目录安装沿用旧键；同域下的其他安装各有自己的账本缓存。 */
export const storageKey = (key: string) => (BASE_PATH ? `${key}:${BASE_PATH}` : key);

/**
 * 读本安装的键。子路径安装以前用过无前缀的旧键：读不到新键时沿用旧值（只读不删，同域的根目录安装可能仍在用），
 * 之后写入都落在新键上。读写失败（隐私模式）返回 null。
 */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(storageKey(key)) ?? (BASE_PATH ? localStorage.getItem(key) : null);
  } catch {
    return null;
  }
}
