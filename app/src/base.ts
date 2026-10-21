import { normalizeBasePath, withBase } from '../../shared/base.ts';

export const BASE_PATH = normalizeBasePath(import.meta.env.BASE_URL);
export const base = (path: string) => withBase(path, BASE_PATH);
/** 根目录安装沿用旧键；同域下的其他安装各有自己的账本缓存。 */
export const storageKey = (key: string) => (BASE_PATH ? `${key}:${BASE_PATH}` : key);
