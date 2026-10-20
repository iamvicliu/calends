import { useEffect, useRef, useState } from 'react';
import type { Subscription } from '../../../shared/types.ts';
import { t } from '../../../shared/i18n.ts';
import { AppIcon } from './app-icon.tsx';
import type Matter from 'matter-js';

/** 一个订阅：v 是它每月的花费（本位币），决定图标大小 */
export interface PileItem {
  s: Subscription;
  v: number;
}

const MIN = 36;
const MAX = 150;
/** 图标总面积占容器的比例：约六成，能堆两三层又不至于溢出 */
const FILL = 0.6;

/** 按每月花费占比定边长：面积与金额成正比，总面积按容器大小缩放，再夹在 MIN～MAX 之间 */
function sizes(items: PileItem[], width: number, height: number): number[] {
  const total = items.reduce((a, x) => a + Math.max(0, x.v), 0) || 1;
  const area = width * height * FILL;
  const max = Math.min(MAX, width * 0.3);
  return items.map((x) => Math.round(Math.min(max, Math.max(MIN, Math.sqrt((Math.max(0, x.v) / total) * area)))));
}

/**
 * 页面底部的「订阅堆」：图标从上方依次落下，按真实物理堆叠；点一下消失一个（刷新后复原）。
 * 物理引擎（matter-js）在区域进入视野时才加载；离开视野时暂停；系统开启「减少动态效果」时直接显示静止的堆。
 */
export function IconPile({ items, height = 280 }: { items: PileItem[]; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const nodes = useRef<Array<HTMLDivElement | null>>([]);
  const [visible, setVisible] = useState(false);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const removeRef = useRef<(i: number) => void>(() => {});

  // 进入视野才开始
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const started = useRef(false);
  const runner = useRef<{ pause: () => void; resume: () => void } | null>(null);
  useEffect(() => {
    if (!visible) {
      runner.current?.pause();
      return;
    }
    if (started.current) {
      runner.current?.resume();
      return;
    }
    started.current = true;
    let raf = 0;
    let disposed = false;
    void import('matter-js').then((M) => {
      if (disposed || !box.current) return;
      const { Engine, Bodies, Composite, Body } = M.default ?? M;
      const W = box.current.clientWidth;
      const H = height;
      const side = sizes(items, W, H);
      const engine = Engine.create({ gravity: { x: 0, y: 1.1 } });
      const wall = { isStatic: true, friction: 0.6 };
      Composite.add(engine.world, [
        Bodies.rectangle(W / 2, H + 50, W * 2, 100, wall),
        Bodies.rectangle(-50, H / 2, 100, H * 4, wall),
        Bodies.rectangle(W + 50, H / 2, 100, H * 4, wall),
      ]);
      // 从上方依次落下：先大后小，大的垫底更像真的堆起来
      const order = items.map((_, i) => i).sort((a, b) => side[b] - side[a]);
      const bodies: Array<Matter.Body | null> = items.map(() => null);
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const drop = (i: number, delayIndex: number) => {
        const s = side[i];
        const x = s / 2 + 8 + ((delayIndex * 0.6180339) % 1) * Math.max(1, W - s - 16);
        const b = Bodies.rectangle(x, -s - delayIndex * (reduce ? s : 0), s, s, {
          chamfer: { radius: s * 0.22 },
          restitution: 0.18,
          friction: 0.5,
          frictionAir: 0.012,
          density: 0.002,
          angle: ((delayIndex % 7) - 3) * 0.08,
        });
        bodies[i] = b;
        Composite.add(engine.world, b);
      };
      const timers: number[] = [];
      if (reduce) {
        // 不做动画：一次性放下并在后台模拟到静止
        order.forEach((i, n) => drop(i, n));
        for (let n = 0; n < 600; n++) Engine.update(engine, 1000 / 60);
      } else order.forEach((i, n) => timers.push(window.setTimeout(() => drop(i, n), 120 + n * 90)));

      removeRef.current = (i: number) => {
        const b = bodies[i];
        if (!b) return;
        bodies[i] = null;
        // 先让图标「啵」地缩小消失，再从物理世界移除，周围的图标随之落下
        const el = nodes.current[i];
        el?.animate(
          [
            { transform: el.style.transform, opacity: 1 },
            { transform: `${el.style.transform} scale(1.15)`, opacity: 0.9, offset: 0.35 },
            { transform: `${el.style.transform} scale(0)`, opacity: 0 },
          ],
          { duration: 260, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
        );
        window.setTimeout(() => Composite.remove(engine.world, b), 120);
        Body.setStatic(b, true);
      };

      let paused = false;
      let last = performance.now();
      const tick = (now: number) => {
        if (disposed) return;
        if (!paused) {
          Engine.update(engine, Math.min(32, now - last));
          bodies.forEach((b, i) => {
            const el = nodes.current[i];
            if (!b || !el) return;
            el.style.transform = `translate(${b.position.x - side[i] / 2}px, ${b.position.y - side[i] / 2}px) rotate(${b.angle}rad)`;
          });
        }
        last = now;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      runner.current = {
        pause: () => (paused = true),
        resume: () => {
          paused = false;
          last = performance.now();
        },
      };
      setReady(true);
      cleanup = () => {
        timers.forEach(clearTimeout);
        Composite.clear(engine.world, false);
        Engine.clear(engine);
      };
    });
    let cleanup = () => {};
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanup();
    };
    // 只在第一次进入视野时建立物理世界
  }, [visible]);

  const side = box.current ? sizes(items, box.current.clientWidth, height) : items.map(() => MIN);
  // 按下和抬起位置相近才算点击，避免滚动时误触
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const left = items.length - gone.size;

  return (
    <div className="relative">
      <div ref={box} className="relative w-full overflow-hidden select-none" style={{ height }} aria-label={t('public.pile.label')} role="img">
        {items.map((x, i) => (
          <div
            key={x.s.id}
            ref={(el) => {
              nodes.current[i] = el;
            }}
            className="absolute top-0 left-0 cursor-pointer will-change-transform"
            style={{ width: side[i], height: side[i], transform: 'translate(-9999px, 0)', visibility: ready && !gone.has(x.s.id) ? 'visible' : 'hidden' }}
            title={x.s.name}
            onPointerDown={(e) => (downAt.current = { x: e.clientX, y: e.clientY })}
            onPointerUp={(e) => {
              const d = downAt.current;
              downAt.current = null;
              if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
              removeRef.current(i);
              window.setTimeout(() => setGone((g) => new Set(g).add(x.s.id)), 280);
            }}
          >
            <AppIcon sub={x.s} size={side[i]} className="size-full rounded-[22%] shadow-[0_6px_16px_-6px_rgba(0,0,0,0.35)]" />
          </div>
        ))}
      </div>
      {ready && (
        <p className="mt-2 text-center text-[12px] text-muted-foreground">
          {left > 0 ? t('public.pile.hint') : t('public.pile.empty')}
        </p>
      )}
    </div>
  );
}
