import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { transformSync } from 'oxc-transform-react';
import { extractUiFunction } from './ui-test-source.ts';
import * as billing from '../shared/billing.ts';
import * as format from '../shared/format.ts';
import * as proxy from '../shared/proxy.ts';
import * as totals from '../shared/fx-total.ts';
import { DEFAULT_SETTINGS } from '../shared/types.ts';

function compile(file, name, deps) {
  const result = transformSync(name + '.tsx', extractUiFunction(new URL('../app/src/views/' + file, import.meta.url), name), {
    lang: 'tsx',
    jsx: { runtime: 'classic' },
    reactCompiler: false,
  });
  assert.equal(result.fatal, false);
  return new Function('React', ...Object.keys(deps), result.code.replace(/export /g, '') + '; return ' + name)(React, ...Object.values(deps));
}
const nodes = (node, type) =>
  !React.isValidElement(node) ? [] : [...(node.type === type ? [node] : []), ...React.Children.toArray(node.props.children).flatMap((n) => nodes(n, type))];

test('proxy privacy masks identity and notes, suppresses period tooltips, and retains subscription navigation and capture boundary', async () => {
  const s = {
    id: 'fictional',
    name: 'Fictional proxy',
    category: '',
    tags: [],
    price: 12,
    currency: 'USD',
    cycle: { unit: 'month', every: 1 },
    start: '2026-10-01',
    status: 'active',
    proxy: { forName: 'Fictional Lin', contact: 'lin@example.test', note: 'Private note', personId: 'fictional-person' },
  };
  const state = { subscriptions: [s], methods: [], settings: DEFAULT_SETTINGS, fx: billing.FALLBACK_FX };
  let masked = false,
    cursor = 0,
    captured,
    opened,
    closed = false;
  const source = {};
  const deps = {
    ...billing,
    ...format,
    ...proxy,
    ...totals,
    t: (k) => k,
    useRef: () => ({ current: source }),
    useState: (v) =>
      cursor++ === 0
        ? [
            masked,
            (v) => {
              masked = v;
            },
          ]
        : [v, () => {}],
    rows: proxy.proxyRows,
    proxyStatus: () => ['ok', 'active'],
    contactText: (p) => p.contact,
    personFor: () => ({}),
    summarySnapshot: async (el) => {
      captured = el;
      return new Blob(['PNG']);
    },
  };
  for (const name of [
    'DetailSheet',
    'DetailHead',
    'MetricCards',
    'Metric',
    'OwedOrNet',
    'Facts',
    'Prop',
    'PersonAvatar',
    'PayBadge',
    'Note',
    'Panel',
    'Plus',
    'YearLedger',
    'EntrySheet',
    'ReceiptSheet',
    'ReceivedCell',
    'NameLink',
    'StatusPill',
    'SubIcon',
    'IconButton',
    'Eye',
    'EyeOff',
    'CopyImageButton',
  ])
    deps[name] = name;
  const Ledger = compile('proxy/sheets.tsx', 'LedgerSheet', deps);
  const render = () => {
    cursor = 0;
    return Ledger({
      state,
      s,
      onClose: () => {
        closed = true;
      },
      onOpen: (s) => {
        opened = s;
      },
    });
  };
  let tree = render();
  let head = nodes(tree, 'DetailHead')[0];
  let facts = nodes(tree, 'Facts')[0];
  assert.equal(nodes(facts.props.items, 'PersonAvatar').length, 1);
  const row = { receipt: { note: 'receipt secret' }, charge: { note: 'charge secret' } };
  assert.equal(nodes(tree, 'YearLedger')[0].props.rowTitle(row), 'receipt secret');
  assert.equal(nodes(facts, 'Note').length, 1);
  nodes(head.props.actions, 'IconButton')[0].props.onClick();
  tree = render();
  head = nodes(tree, 'DetailHead')[0];
  facts = nodes(tree, 'Facts')[0];
  assert.equal(nodes(head.props.actions, 'IconButton')[0].props['aria-label'], 'family.sheet.showPersonal');
  assert.equal(nodes(facts.props.items, 'PersonAvatar').length, 0);
  const privateText = nodes(facts.props.items, 'span').filter((n) => n.props.className === 'car-private');
  assert.equal(privateText.length, 2);
  assert.ok(privateText.every((n) => n.props['aria-hidden']));
  assert.equal(nodes(facts, 'span').find((n) => n.props.className === 'car-private').props.children, s.proxy.note);
  assert.equal(nodes(tree, 'YearLedger')[0].props.rowTitle(row), undefined);
  assert.equal(nodes(tree, 'Panel')[0].props.aside.props['data-snapshot-hide'], true);
  await nodes(head.props.actions, 'CopyImageButton')[0].props.render();
  assert.equal(captured, source);
  head.props.title.props.onClick();
  assert.equal(opened, s);
  assert.equal(closed, true);
  nodes(head.props.actions, 'IconButton')[0].props.onClick();
  assert.equal(nodes(render(), 'YearLedger')[0].props.rowTitle(row), 'receipt secret');
});

test('shared summary capture keeps masking in the detached clone and preserves carpool preparation', async () => {
  let options,
    prepared = false;
  const blob = new Blob(['PNG']);
  const summarySnapshot = compile('carpool-snapshot.ts', 'summarySnapshot', {
    snapshot: async (source, opts) => {
      options = opts;
      return source ? blob : null;
    },
  });
  assert.equal(
    await summarySnapshot({}, () => {
      prepared = true;
    }),
    blob,
  );
  assert.equal(options.width, 1000);
  const classes = [];
  options.prepare({ classList: { add: (c) => classes.push(c) } });
  assert.deepEqual(classes, ['car-snapshot']);
  assert.equal(prepared, true);
  await assert.rejects(summarySnapshot(null), /PNG/);
  let carPrepare;
  const carpoolSnapshot = compile('carpool-snapshot.ts', 'carpoolSnapshot', {
    summarySnapshot: async (_source, prepare) => {
      carPrepare = prepare;
      return blob;
    },
    fitTimelineLabels: () => {
      prepared = true;
    },
  });
  await carpoolSnapshot({});
  let removed = 0;
  prepared = false;
  carPrepare({ querySelectorAll: () => [{ remove: () => removed++ }] });
  assert.equal(removed, 2);
  assert.equal(prepared, true);
});
