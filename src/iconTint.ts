import { base } from './base.ts';
import { useEffect, useState } from 'react';

/**
 * 从图标里取主色，给卡片光晕用。很多图标外圈是白底（站点 favicon、Cloudflare 等），
 * 直接把图片模糊铺开只会得到一片白，所以这里跳过近白、近黑、透明和灰色的像素，
 * 按色相分桶、以饱和度加权，取最突出的那一桶的平均色。取不到（纯黑白图标、加载失败）时返回 null。
 * 外站图片走同源的 /api/img 代理，canvas 才能读像素。结果按地址缓存。
 */
const cache = new Map<string, Promise<string | null>>();

function sample(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const N = 32;
        const c = document.createElement('canvas');
        c.width = c.height = N;
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(img, 0, 0, N, N);
        const d = g.getImageData(0, 0, N, N).data;
        const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
        for (let i = 0; i < d.length; i += 4) {
          const [r, gg, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
          if (a < 128) continue;
          const max = Math.max(r, gg, b);
          const min = Math.min(r, gg, b);
          const l = (max + min) / 510;
          const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
          if (l > 0.92 || l < 0.1 || s < 0.25) continue;
          let h = 0;
          if (max === r) h = ((gg - b) / (max - min)) % 6;
          else if (max === gg) h = (b - r) / (max - min) + 2;
          else h = (r - gg) / (max - min) + 4;
          const k = Math.floor(((h * 60 + 360) % 360) / 30) % 12;
          const w = s * (a / 255);
          const bk = buckets[k];
          bk.w += w;
          bk.r += r * w;
          bk.g += gg * w;
          bk.b += b * w;
        }
        const best = buckets.reduce((x, y) => (y.w > x.w ? y : x));
        // 彩色像素太少（只是边缘一点点）也不算
        if (best.w < N * N * 0.03) return resolve(null);
        resolve(`rgb(${Math.round(best.r / best.w)}, ${Math.round(best.g / best.w)}, ${Math.round(best.b / best.w)})`);
      } catch {
        resolve(null);
      }
    };
    img.src = /^https?:/.test(src) ? base(`/api/img?u=${encodeURIComponent(src)}`) : base(src);
  });
}

export function iconTint(src: string): Promise<string | null> {
  let p = cache.get(src);
  if (!p) cache.set(src, (p = sample(src)));
  return p;
}

/** 图标主色；还没算出来或取不到时为 null */
export function useIconTint(src: string | undefined): string | null {
  const [tint, setTint] = useState<string | null>(null);
  useEffect(() => {
    if (!src) return setTint(null);
    let live = true;
    void iconTint(src).then((c) => live && setTint(c));
    return () => {
      live = false;
    };
  }, [src]);
  return tint;
}
