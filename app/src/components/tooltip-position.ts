/** Position measured chart tips inside the viewport, flipping below a trigger near the top. */
export function tooltipPosition(
  anchor: { x: number; top: number; bottom: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const gap = 8;
  const clamp = (n: number, max: number) => Math.max(gap, Math.min(n, max - gap));
  const above = anchor.top - tip.height - gap;
  return {
    left: clamp(anchor.x - tip.width / 2, viewport.width - tip.width),
    top: clamp(above >= gap ? above : anchor.bottom + gap, viewport.height - tip.height),
  };
}
