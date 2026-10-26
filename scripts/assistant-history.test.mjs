import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transformSync } from 'oxc-transform-react';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { extractUiFunction } from './ui-test-source.ts';

test('historical assistant errors show no retry while current errors remain actionable', () => {
  const source = extractUiFunction(new URL('../app/src/views/Assistant.tsx', import.meta.url), 'ErrorCard');
  const code = transformSync('ErrorCard.tsx', source, { lang: 'tsx', jsx: { runtime: 'classic' }, reactCompiler: false }).code.replace(/export /g, '');
  const ErrorCard = new Function('React', 'CircleAlert', 'RotateCcw', 't', code + ';return ErrorCard;')(React, () => null, () => null, (k) => k);
  const error = { kind: 'network', message: 'Fictional interruption' };
  const render = (onRetry) => renderToStaticMarkup(React.createElement(ErrorCard, { error, onRetry, onSetup() {} }));
  assert.ok(!render(undefined).includes('assistant.retry'));
  assert.ok(render(() => {}).includes('assistant.retry'));
});
