// 「化为尘埃」的消失效果（类似 Telegram 删除消息）：把元素切成细小的颗粒，从左到右依次飘散、淡出。
// 不截图、不读像素：直接把图标图片按小块 drawImage 到一张临时画布上，跨域图片也能用。

interface Particle {
  /** 原图上的取样位置与大小（图片自身像素） */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** 起点（页面视口坐标）与大小 */
  x: number;
  y: number;
  size: number;
  vx: number;
  vy: number;
  delay: number;
  life: number;
  spin: number;
  color?: string;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let running: Array<{ ps: Particle[]; img?: HTMLImageElement; start: number; angle: number; cx: number; cy: number }> = [];
let raf = 0;

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '70' });
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
}

function resize() {
  if (!canvas || !ctx) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.round(innerWidth * dpr);
  const h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** 缓动：先快后慢地散开 */
const ease = (t: number) => 1 - Math.pow(1 - t, 2.2);

function frame(now: number) {
  if (!ctx || !canvas) return;
  resize();
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  running = running.filter((r) => {
    let alive = false;
    for (const p of r.ps) {
      const t = (now - r.start - p.delay) / p.life;
      if (t >= 1) continue;
      alive = true;
      const k = Math.max(0, t);
      const e = ease(k);
      const x = p.x + p.vx * e + Math.sin((k + p.spin) * 6) * 3 * k;
      const y = p.y + p.vy * e - 14 * k * k;
      const s = p.size * (1 - 0.55 * k);
      ctx!.globalAlpha = t < 0 ? 1 : Math.max(0, 1 - k * k * 1.15);
      if (r.img && !p.color) {
        ctx!.save();
        ctx!.translate(x, y);
        ctx!.rotate(r.angle + p.spin * k * 2);
        ctx!.drawImage(r.img, p.sx, p.sy, p.sw, p.sh, -s / 2, -s / 2, s, s);
        ctx!.restore();
      } else {
        ctx!.fillStyle = p.color ?? '#999';
        ctx!.fillRect(x - s / 2, y - s / 2, s, s);
      }
    }
    return alive;
  });
  ctx.globalAlpha = 1;
  if (running.length) raf = requestAnimationFrame(frame);
  else {
    raf = 0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
  }
}

/**
 * 让元素化为尘埃。el 是图标容器（里面有 img 就用图片取色，没有就用背景色），angle 为元素当前的旋转角（弧度）。
 * 返回动画大约的时长（毫秒）。
 */
export function disintegrate(el: HTMLElement, angle = 0): number {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  ensureCanvas();
  const rect = el.getBoundingClientRect();
  // 元素旋转后外框会变大；按未旋转时的边长取（容器是正方形）
  const side = el.offsetWidth || rect.width;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const img = el.querySelector('img');
  const usable = img && img.complete && img.naturalWidth > 0 ? img : undefined;
  const bg = getComputedStyle(el.firstElementChild ?? el).backgroundColor;

  // 颗粒大小随图标变化：小图标 2.5px，大图标 4px，总数控制在 ~900 以内
  const cell = Math.max(2.5, Math.min(4, side / 32));
  const n = Math.max(1, Math.floor(side / cell));
  const radius = side * 0.22;
  const ps: Particle[] = [];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // 图片在容器里的位置（AppIcon 对站点图标留了内边距）
  const ir = usable?.getBoundingClientRect();
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const lx = (i + 0.5) * cell - side / 2;
      const ly = (j + 0.5) * cell - side / 2;
      // 圆角外面的颗粒不要
      const ax = Math.abs(lx) - (side / 2 - radius);
      const ay = Math.abs(ly) - (side / 2 - radius);
      if (ax > 0 && ay > 0 && ax * ax + ay * ay > radius * radius) continue;
      let sx = 0,
        sy = 0,
        sw = 0,
        sh = 0,
        color: string | undefined;
      if (usable && ir) {
        // 映射到图片像素（图片可能比容器小一圈）
        const iw = usable.offsetWidth || ir.width;
        const ih = usable.offsetHeight || ir.height;
        const ox = (side - iw) / 2;
        const oy = (side - ih) / 2;
        const px = lx + side / 2 - ox;
        const py = ly + side / 2 - oy;
        if (px < 0 || py < 0 || px > iw || py > ih) color = bg;
        else {
          const kx = usable.naturalWidth / iw;
          const ky = usable.naturalHeight / ih;
          sx = (px - cell / 2) * kx;
          sy = (py - cell / 2) * ky;
          sw = cell * kx;
          sh = cell * ky;
        }
      } else color = bg;
      // 旋转后的屏幕位置
      const x = cx + lx * cos - ly * sin;
      const y = cy + lx * sin + ly * cos;
      // 从左到右依次飘走；越往右越晚，带一点随机
      const order = (lx + side / 2) / side;
      ps.push({
        sx,
        sy,
        sw,
        sh,
        x,
        y,
        size: cell * 1.05,
        vx: 30 + Math.random() * 70 + order * 30,
        vy: -(20 + Math.random() * 60),
        delay: order * 380 + Math.random() * 140,
        life: 650 + Math.random() * 450,
        spin: Math.random(),
        color,
      });
    }
  }
  running.push({ ps, img: usable, start: performance.now(), angle, cx, cy });
  if (!raf) raf = requestAnimationFrame(frame);
  return 1200;
}
