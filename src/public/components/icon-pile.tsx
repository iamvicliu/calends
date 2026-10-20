import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw } from 'lucide-react';
import type Matter from 'matter-js';
import type { Subscription } from '../../../shared/types.ts';
import { t } from '../../../shared/i18n.ts';
import { AppIcon } from './app-icon.tsx';
import { disintegrate } from './dust.ts';

/** 一个订阅：v 是它每月的花费（本位币），决定图标大小 */
export interface PileItem {
  s: Subscription;
  v: number;
}

const MIN = 36;
const MAX = 150;
/** 图标总面积占落地区域的比例：约六成，能堆两三层又不至于溢出 */
const FILL = 0.6;

/** 按每月花费占比定边长：面积与金额成正比，总面积按落地区域大小缩放，再夹在 MIN～MAX 之间 */
function sizes(items: PileItem[], width: number, height: number): number[] {
  const total = items.reduce((a, x) => a + Math.max(0, x.v), 0) || 1;
  const area = width * height * FILL;
  const max = Math.min(MAX, width * 0.3);
  return items.map((x) => Math.round(Math.min(max, Math.max(MIN, Math.sqrt((Math.max(0, x.v) / total) * area)))));
}

/**
 * 页脚下方的「订阅堆」。
 * 访客滚到页面最底、继续往下滑让这块落地区露出来时，图标才从屏幕顶端落下，越过页面内容（最上层），按真实物理堆在页脚下面。
 * 点一下消失一个；右上角的按钮让它们重新落下。物理引擎（matter-js）到这时才加载；系统开启「减少动态效果」时直接显示堆好的样子。
 */
export function IconPile({ items, height = 300 }: { items: PileItem[]; height?: number }) {
  // 换一个 key 就整个重建物理世界，图标重新落下
  const [epoch, setEpoch] = useState(0);
  const [gone, setGone] = useState(0);
  const zone = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  // 预热时就量好落地区、算好每个图标的边长并渲染出来（先隐藏），开始落下时只剩物理计算，不再整体重排
  const [side, setSide] = useState<number[] | null>(null);

  // 提前一屏预热：下载物理引擎、预渲染图标并加载图片，真正落下时就不会边加载边卡
  useEffect(() => {
    const el = zone.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        void import('matter-js');
        const r = el.getBoundingClientRect();
        setSide(sizes(items, r.width, r.height));
      },
      { rootMargin: '0px 0px 1000px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [items]);

  // 落地区大半露出来（也就是已经滚过页脚）才开始落
  useEffect(() => {
    const el = zone.current;
    if (!el || armed) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setArmed(true), { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, [armed]);

  return (
    <div ref={zone} className="relative" style={{ height }} aria-label={t('public.pile.label')} role="img">
      {side && <PileStage key={epoch} items={items} side={side} go={armed} zone={zone} onGone={setGone} />}
      {gone > 0 && (
        <button
          type="button"
          onClick={() => {
            setGone(0);
            setEpoch((n) => n + 1);
          }}
          className="absolute top-2 right-0 z-[61] flex size-8 items-center justify-center rounded-full bg-card text-muted-foreground shadow-sm ring-1 ring-foreground/10 transition hover:text-foreground"
          aria-label={t('public.pile.reset')}
          title={t('public.pile.reset')}
        >
          <RotateCcw className="size-4" />
        </button>
      )}
    </div>
  );
}

/** 物理世界用页面坐标：图标层挂在 body 上、铺满整个文档、位于最上层，落地区的底边就是地面 */
function PileStage({
  items,
  side,
  go,
  zone,
  onGone,
}: {
  items: PileItem[];
  side: number[];
  go: boolean;
  zone: { current: HTMLDivElement | null };
  onGone: (n: number) => void;
}) {
  const nodes = useRef<Array<HTMLDivElement | null>>([]);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const removeRef = useRef<(i: number) => void>(() => {});
  useEffect(() => onGone(gone.size), [gone, onGone]);

  useEffect(() => {
    if (!go) return;
    let raf = 0;
    let disposed = false;
    let cleanup = () => {};
    void import('matter-js').then((mod) => {
      const el = zone.current;
      if (disposed || !el) return;
      const { Engine, Bodies, Composite } = ((mod as { default?: typeof Matter }).default ?? mod) as typeof Matter;
      const r = el.getBoundingClientRect();
      const left = r.left + scrollX;
      const W = r.width;
      const floor = r.bottom + scrollY;
      const sz = side;

      const engine = Engine.create({ gravity: { x: 0, y: 1.2 } });
      const wall = { isStatic: true, friction: 0.6 };
      // 两侧的墙从屏幕顶端以上一直到地面，图标落下时不会飞出落地区
      const top = scrollY - 2000;
      const wallH = floor - top;
      Composite.add(engine.world, [
        Bodies.rectangle(left + W / 2, floor + 50, W + 200, 100, wall),
        Bodies.rectangle(left - 50, top + wallH / 2, 100, wallH, wall),
        Bodies.rectangle(left + W + 50, top + wallH / 2, 100, wallH, wall),
      ]);

      // 从当前屏幕的顶端依次落下：先大后小，大的垫底更像真的堆起来
      const order = items.map((_, i) => i).sort((a, b) => sz[b] - sz[a]);
      const bodies: Array<Matter.Body | null> = items.map(() => null);
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const drop = (i: number, n: number) => {
        const s = sz[i];
        const x = left + s / 2 + 8 + ((n * 0.6180339) % 1) * Math.max(1, W - s - 16);
        const y = reduce ? floor - s * (1 + n * 0.5) : scrollY - s;
        const b = Bodies.rectangle(x, y, s, s, {
          chamfer: { radius: s * 0.22 },
          restitution: 0.2,
          friction: 0.5,
          frictionAir: 0.008,
          density: 0.002,
          angle: ((n % 7) - 3) * 0.1,
        });
        bodies[i] = b;
        Composite.add(engine.world, b);
        // 落下的这一刻才显示，图片早已加载好
        const node = nodes.current[i];
        if (node) {
          node.style.transform = `translate(${x - s / 2}px, ${y - s / 2}px)`;
          node.style.visibility = 'visible';
        }
      };
      const timers: number[] = [];
      if (reduce) {
        order.forEach((i, n) => drop(i, n));
        for (let n = 0; n < 900; n++) Engine.update(engine, 1000 / 60);
      } else order.forEach((i, n) => timers.push(window.setTimeout(() => drop(i, n), n * 70)));

      removeRef.current = (i: number) => {
        const b = bodies[i];
        if (!b) return;
        bodies[i] = null;
        // 化为尘埃：图标切成颗粒从左到右飘散，原图标立刻隐藏，物理体移除后周围的图标落下补位
        const node = nodes.current[i];
        if (node) {
          disintegrate(node, b.angle);
          node.style.visibility = 'hidden';
        }
        Composite.remove(engine.world, b);
      };

      // 固定步长推进物理（1/60 秒一步），帧率波动时也走得匀，不会忽快忽慢
      const STEP = 1000 / 60;
      let last = performance.now();
      let acc = 0;
      const tick = (now: number) => {
        if (disposed) return;
        acc = Math.min(acc + (now - last), STEP * 4);
        last = now;
        while (acc >= STEP) {
          Engine.update(engine, STEP);
          acc -= STEP;
        }
        bodies.forEach((b, i) => {
          const node = nodes.current[i];
          if (!b || !node) return;
          node.style.transform = `translate(${b.position.x - sz[i] / 2}px, ${b.position.y - sz[i] / 2}px) rotate(${b.angle}rad)`;
        });
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      cleanup = () => {
        timers.forEach(clearTimeout);
        Composite.clear(engine.world, false);
        Engine.clear(engine);
      };
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanup();
    };
    // 物理世界只在挂载时建立一次；重新落下靠父组件换 key
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [go]);

  // 按下和抬起位置相近才算点击，避免滚动时误触
  const downAt = useRef<{ x: number; y: number } | null>(null);

  // 图标层挂在 body 上、按文档坐标定位、盖在所有内容之上；层本身不挡点击，只有图标可以点
  return createPortal(
    <div className="pointer-events-none absolute top-0 left-0 z-[60] w-0">
      {items.map((x, i) => (
        <div
          key={x.s.id}
          ref={(el) => {
            nodes.current[i] = el;
          }}
          className="pointer-events-auto absolute top-0 left-0 cursor-pointer will-change-transform select-none"
          style={{ width: side[i], height: side[i], transform: 'translate(-9999px, 0)', visibility: 'hidden' }}
          title={x.s.name}
          onPointerDown={(e) => (downAt.current = { x: e.clientX, y: e.clientY })}
          onPointerUp={(e) => {
            const d = downAt.current;
            downAt.current = null;
            if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
            removeRef.current(i);
            window.setTimeout(() => setGone((g) => new Set(g).add(x.s.id)), 50);
          }}
        >
          <AppIcon sub={x.s} size={side[i]} eager className="size-full rounded-[22%] shadow-[0_6px_16px_-6px_rgba(0,0,0,0.35)]" />
        </div>
      ))}
    </div>,
    document.body,
  );
}
