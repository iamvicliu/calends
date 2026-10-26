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

test('compiled payment renders the whole new form including its unused delete callback', () => {
  const source = readFileSync(new URL('../app/src/views/PaymentSheet.tsx', import.meta.url), 'utf8');
  const code = transformSync('PaymentSheet.tsx', source, { lang: 'tsx', jsx: { runtime: 'classic' }, reactCompiler: true })
    .code.replace(/^import .*;$/gm, '')
    .replace('export function PaymentSheet', 'function PaymentSheet');
  const deps = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    _c: (n) => Array(n).fill(Symbol.for('react.memo_cache_sentinel')),
    useState: (v) => [v, () => {}],
    currentPhase: (s) => s,
    chargesBetween: () => [],
    currencyDecimals: () => 2,
    useSubmit: () => [false, () => {}],
    getState: () => ({ methods: [], settings: { baseCurrency: 'CNY' } }),
    settlementCurrencyOf: () => 'CNY',
    t: String,
    money: String,
  };
  for (const name of ['Sheet', 'MoneyInput', 'Seg', 'Cell', 'Group', 'IconButton', 'Icon', 'DatePicker', 'CurrencySelect', 'Picker', 'MethodPicker'])
    deps[name] = name;
  const PaymentSheet = new Function(...Object.keys(deps), code + ';return PaymentSheet;')(...Object.values(deps));
  assert.doesNotThrow(() => PaymentSheet({ sub: { price: 10, currency: 'USD', start: '2026-10-01' }, today: '2026-10-25', onClose() {} }));
});
