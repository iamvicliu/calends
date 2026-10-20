import { useLayoutEffect, useRef } from 'react';
import NumberFlowElement, { define } from 'number-flow';

define('number-flow', NumberFlowElement);

/**
 * 滚动数字：直接驱动 NumberFlow 的 Web Component。
 * 官方 React 封装依赖 React 的属性处理，在 preact/compat 下不生效，所以这里用 ref 设属性。
 */
export function Num({ value, prefix, suffix, digits = 0, className }: { value: number; prefix?: string; suffix?: string; digits?: number; className?: string }) {
  const ref = useRef<NumberFlowElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.locales = 'en-US';
    el.format = { maximumFractionDigits: digits, minimumFractionDigits: digits };
    el.numberPrefix = prefix;
    el.numberSuffix = suffix;
    el.update(value);
  }, [value, prefix, suffix, digits]);
  return <number-flow ref={ref} class={className} />;
}

declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      'number-flow': HTMLAttributes<NumberFlowElement>;
    }
  }
}
