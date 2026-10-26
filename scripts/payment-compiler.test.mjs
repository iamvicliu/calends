import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'oxc-transform-react';

test('compiled new payment initializes settlement without an edit record', () => {
  const source = readFileSync(new URL('../app/src/views/PaymentSheet.tsx', import.meta.url), 'utf8');
  const compiled = transformSync('PaymentSheet.tsx', source, { lang: 'tsx', jsx: { runtime: 'classic' }, reactCompiler: true });
  assert.equal(compiled.fatal, false);
  const code = compiled.code.replace(/^import .*;$/gm, '').replace('export function PaymentSheet', 'function PaymentSheet');
  const initialized = Symbol('settlement initialized');
  let states = 0;
  const PaymentSheet = new Function('_c', 'useState', 'currentPhase', code + '; return PaymentSheet;')(
    (n) => Array(n).fill(Symbol.for('react.memo_cache_sentinel')),
    (initial) => {
      if (++states === 5) {
        assert.equal(initial, '');
        throw initialized;
      }
      return [initial, () => {}];
    },
    (s) => s,
  );
  assert.throws(
    () => PaymentSheet({ sub: { price: 10, currency: 'USD', start: '2026-10-01' }, today: '2026-10-25', onClose() {} }),
    (e) => e === initialized,
  );
});
