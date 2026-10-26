import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transformSync } from 'oxc-transform-react';
import * as React from 'react';
import { extractUiFunction } from './ui-test-source.ts';
import * as people from '../shared/people.ts';
import { DEFAULT_SETTINGS, PERSON_COLORS } from '../shared/types.ts';
import { FALLBACK_FX } from '../shared/billing.ts';

function component(file, name, deps) {
  const result = transformSync(name + '.tsx', extractUiFunction(new URL('../app/src/views/' + file, import.meta.url), name), {
    lang: 'tsx',
    jsx: { runtime: 'classic' },
    reactCompiler: false,
  });
  assert.equal(result.fatal, false);
  return new Function('React', ...Object.keys(deps), result.code.replace(/export /g, '') + '; return ' + name)(React, ...Object.values(deps));
}
function hooks() {
  const values = [],
    refs = [];
  let cursor = 0,
    refCursor = 0;
  return {
    reset() {
      cursor = refCursor = 0;
    },
    useState(initial) {
      const i = cursor++;
      if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
      return [
        values[i],
        (v) => {
          values[i] = typeof v === 'function' ? v(values[i]) : v;
        },
      ];
    },
    useRef(initial) {
      return (refs[refCursor++] ??= { current: initial });
    },
  };
}
function nodes(node, match) {
  if (!React.isValidElement(node)) return [];
  return [...(match(node) ? [node] : []), ...React.Children.toArray(node.props.children).flatMap((n) => nodes(n, match))];
}
function fixture() {
  const person = { id: 'p', name: 'Fictional Lin', note: 'original note' };
  const sub = (id, account) => ({
    id,
    name: 'Fictional ' + id,
    category: '工具',
    tags: [],
    price: 60,
    currency: 'USD',
    cycle: { unit: 'month', every: 1 },
    start: '2026-01-01',
    status: 'active',
    share: { role: 'owner', seats: 3, since: '2026-01-01', members: [{ id: 'm-' + id, personId: 'p', name: person.name, share: 20, account }] },
  });
  return {
    subscriptions: [sub('a', 'account-a'), sub('b', 'account-b')],
    people: [person],
    methods: [],
    settings: { ...DEFAULT_SETTINGS, baseCurrency: 'USD' },
    fx: FALLBACK_FX,
  };
}
function harness() {
  let state = fixture();
  const h = hooks(),
    saves = [];
  const deps = {
    ...people,
    ...h,
    PERSON_COLORS,
    t: (s) => s,
    money: String,
    flow: String,
    cnDateAuto: String,
    contactText: (p) => p.contact ?? '',
    getState: () => state,
    run: async (fn) => {
      await fn();
    },
    savePerson: async (p) => {
      saves.push(p);
      state = { ...state, people: state.people.map((x) => (x.id === p.id ? p : x)) };
      return p;
    },
    saveSub: async (s) => {
      saves.push(s);
      state = { ...state, subscriptions: state.subscriptions.map((x) => (x.id === s.id ? s : x)) };
      return s;
    },
  };
  for (const name of [
    'PersonAvatar',
    'ContactLink',
    'Picker',
    'Sheet',
    'MetricCards',
    'Metric',
    'Cell',
    'Group',
    'IconButton',
    'Act',
    'Pencil',
    'Icon',
    'SubIcon',
    'ContactField',
    'EntrySheet',
    'LedgerSheet',
  ])
    deps[name] = name;
  const PersonSheet = component('PersonProfile.tsx', 'PersonSheet', deps);
  const render = () => {
    h.reset();
    return PersonSheet({ state, today: '2026-10-26', l: people.peopleLedger(state, '2026-10-26')[0], memberDialog: 'MemberDialog', onClose() {}, onOpen() {} });
  };
  return { render, saves, state: () => state };
}

test('family people tab opens the shared detail, header edit reaches the existing profile form and saved note updates it', async () => {
  const h = harness(),
    listHooks = hooks();
  const deps = {
    ...people,
    ...listHooks,
    locale: () => 'en',
    t: String,
    copyParts: String,
    usePhone: () => false,
    isMarked: () => false,
    PEOPLE_DIR: { owed: 'desc', received: 'desc', lastPaid: 'desc', name: 'asc' },
  };
  for (const name of ['Toolbar', 'Seg', 'FamilyTabs', 'MetricCards', 'Metric', 'Amount', 'PersonRow', 'PersonSheet', 'MemberSheet']) deps[name] = name;
  const PeopleView = component('People.tsx', 'PeopleView', deps);
  const list = () => {
    listHooks.reset();
    return PeopleView({ state: h.state(), today: '2026-10-26', onOpen() {} });
  };
  const row = nodes(list(), (n) => n.type === 'PersonRow')[0];
  row.props.onClick();
  assert.equal(nodes(list(), (n) => n.type === 'PersonSheet')[0].props.l.person.id, 'p');
  let tree = h.render();
  const edit = nodes(tree.props.actions, (n) => n.type === 'Act' && n.props.label === 'detail.action.edit')[0];
  assert.ok(edit, 'detail header must expose the same primary Edit action as subscription details');
  assert.equal(edit.props.primary, true);
  const name = nodes(tree, (n) => n.type === 'input' && n.props.placeholder === 'family.member.namePh')[0];
  let focused = false,
    scrolled = false;
  name.props.ref.current = {
    scrollIntoView() {
      scrolled = true;
    },
    focus() {
      focused = true;
    },
  };
  edit.props.onClick();
  assert.ok(scrolled && focused, 'header edit reveals and focuses the existing form');
  nodes(tree, (n) => n.type === 'input' && n.props.placeholder === 'people.sheet.notePh')[0].props.onChange({ target: { value: 'updated fictional note' } });
  tree = h.render();
  const save = nodes(tree.props.foot, (n) => n.type === 'button' && n.props.className === 'btn primary')[0];
  assert.equal(save.props.disabled, false);
  await save.props.onClick();
  tree = h.render();
  assert.equal(h.state().people[0].note, 'updated fictional note');
  assert.equal(nodes(tree, (n) => n.type === 'input' && n.props.placeholder === 'people.sheet.notePh')[0].props.value, 'updated fictional note');
  assert.equal(nodes(tree.props.foot, (n) => n.props.className === 'btn primary')[0].props.disabled, true);
});

test('per-car account exposes an edit affordance, saves only that relationship and preserves concurrent receipts', async () => {
  const h = harness();
  let tree = h.render();
  const account = nodes(tree, (n) => n.type === 'button' && n.props['aria-label'] === 'Fictional a\nfamily.member.editAccount')[0];
  assert.ok(nodes(account, (n) => n.type === 'Pencil').length, 'editable account must look actionable');
  account.props.onClick();
  tree = h.render();
  nodes(tree, (n) => n.type === 'input' && n.props['aria-label'] === 'Fictional a\nfamily.member.account')[0].props.onChange({
    target: { value: ' revised-a ' },
  });
  const receipt = { id: 'concurrent-receipt', date: '2026-10-26', amount: 20, currency: 'USD', periods: ['2026-10-01'] };
  h.state().subscriptions[0].share.members[0].receipts = [receipt];
  tree = h.render();
  await nodes(tree.props.foot, (n) => n.props.className === 'btn primary')[0].props.onClick();
  assert.equal(h.state().subscriptions[0].share.members[0].account, 'revised-a');
  assert.equal(h.state().subscriptions[1].share.members[0].account, 'account-b');
  assert.deepEqual(h.state().subscriptions[0].share.members[0].receipts, [receipt]);
  assert.equal(h.saves.length, 1);
  assert.ok(nodes(h.render(), (n) => n.type === 'button' && n.props.title === 'revised-a').length);
});

test('person car row explicitly opens member editing even when collection is overdue', () => {
  const h = harness();
  let tree = h.render();
  nodes(tree, (n) => n.type === 'button' && n.props.className === 'pp-item-l')[0].props.onClick();
  tree = h.render();
  const dialog = nodes(tree, (n) => n.type === 'MemberDialog')[0];
  assert.equal(dialog.props.collect, false);
  const render = (collect, editId) => {
    const hooksForMember = hooks();
    const MemberSheet = component('Members.tsx', 'MemberSheet', {
      ...hooksForMember,
      todayIn: () => '2026-10-26',
      memberStatus: () => ({ owe: true }),
      MemberForm: 'MemberForm',
      ReceiptForm: 'ReceiptForm',
    });
    return MemberSheet({ ...dialog.props, collect, editId });
  };
  // 一律打开同一个成员弹窗；是否叠上收款表单由 initialReceipt 决定
  const open = (collect, editId) => {
    const node = render(collect, editId);
    return [node.type, JSON.stringify(node.props.initialReceipt ?? null)];
  };
  assert.deepEqual(open(false), ['MemberForm', 'null']);
  assert.deepEqual(open(undefined), ['MemberForm', '{}']);
  assert.deepEqual(open(true), ['MemberForm', '{}']);
  assert.deepEqual(open(false, 'existing-receipt'), ['MemberForm', '{"edit":"existing-receipt"}']);
});

test('linked-member and proxy profile entry uses the same current person detail; read-only has no Edit action', () => {
  const h = harness();
  const PersonProfileSheet = component('PersonProfile.tsx', 'PersonProfileSheet', { ...people, PersonSheet: 'PersonSheet' });
  const profile = PersonProfileSheet({ state: h.state(), today: '2026-10-26', personId: 'p', memberDialog: 'MemberSheet', onClose() {}, onOpen() {} });
  assert.equal(profile.type, 'PersonSheet');
  assert.equal(profile.props.l.person.id, 'p');
  assert.equal(profile.props.memberDialog, 'MemberSheet');
  h.state().readonly = true;
  const tree = h.render();
  assert.equal(tree.props.actions, undefined);
  assert.equal(nodes(tree, (n) => n.type === 'Pencil').length, 0);
});
