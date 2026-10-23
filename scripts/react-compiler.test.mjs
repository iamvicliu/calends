import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'oxc-transform-react';

// 高频重渲染的页面依赖 React Compiler 自动记忆化；编译器遇到不支持的写法会静默跳过整个组件，这里把跳过变成测试失败
const HOT = [
  'app/src/views/Gantt.tsx',
  'app/src/views/List.tsx',
  'app/src/views/Overview.tsx',
  'app/src/views/Calendar.tsx',
  'app/src/views/Report.tsx',
  'app/src/views/Wallet.tsx',
  'app/src/views/Carpool.tsx',
  'app/src/components/Timeline.tsx',
  'app/src/components/charts.tsx',
];

test('hot views compile under React Compiler without bailouts', () => {
  const failures = [];
  for (const file of HOT) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const result = transformSync(file, source, { lang: 'tsx', jsx: { runtime: 'automatic' }, reactCompiler: { panicThreshold: 'all_errors' } });
    for (const e of result.errors ?? [])
      failures.push(`${file}: ${e.codeframe.match(/,-\[([^\]]+)\]/)?.[1] ?? ''} ${(e.helpMessage ?? e.message).split('.')[0]}`);
  }
  assert.deepEqual(failures, []);
});
