// UI contract harnesses keep their lightweight React tree while exercising the real metric slots.
import { readFileSync } from 'node:fs';
import { transformSync } from 'oxc-transform-react';

export function metricComponents(React: unknown) {
  const source = readFileSync(new URL('../app/src/components/ui.tsx', import.meta.url), 'utf8');
  const slots = source.slice(source.indexOf('export function MetricCards'), source.indexOf('/** 页面工具栏'));
  const result = transformSync('metric-slots.tsx', slots, { lang: 'tsx', jsx: { runtime: 'classic' }, reactCompiler: false });
  if (result.fatal) throw new Error('Metric slots did not compile');
  const Children = { toArray: (children: unknown) => [children].flat(Infinity).filter((child) => child != null && typeof child !== 'boolean') };
  return new Function('React', 'Children', `${result.code.replace(/export /g, '')}; return { MetricCards, Metric };`)(React, Children);
}
