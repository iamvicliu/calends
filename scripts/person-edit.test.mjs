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
  // 共用的资料表单（ProfileFields）就地展开，像渲染一样查到里面的输入框
  if (typeof node.type === 'function') return nodes(node.type(node.props), match);
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
    'ConfirmButton',
  ])
    deps[name] = name;
  deps.ProfileFields = component('PersonProfile.tsx', 'ProfileFields', deps);
  const PersonSheet = component('PersonProfile.tsx', 'PersonSheet', deps);
  const render = () => {
    h.reset();
    return PersonSheet({ state, today: '2026-10-26', l: people.peopleLedger(state, '2026-10-26')[0], memberDialog: 'MemberDialog', onClose() {}, onOpen() {} });
  };
  return { render, saves, state: () => state };
}

test('family people tab opens the shared detail with the profile form on top and saved note updates it', async () => {
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
  for (const name of [
    'Toolbar',
    'Seg',
    'FamilyTabs',
    'MetricCards',
    'Metric',
    'Amount',
    'PersonRow',
    'PersonSheet',
    'MemberSheet',
    'IconButton',
    'Icon',
    'NewPersonSheet',
  ])
    deps[name] = name;
  const PeopleView = component('People.tsx', 'PeopleView', deps);
  const list = () => {
    listHooks.reset();
    return PeopleView({ state: h.state(), today: '2026-10-26', onOpen() {} });
  };
  // 桌面右上角与手机标题栏的 + 都是新建人员，而不是新建订阅
  const add = nodes(list(), (n) => n.type === 'IconButton' && n.props['aria-label'] === 'people.pick.new')[0];
  assert.equal(add.props['aria-label'], 'people.pick.new');
  assert.equal(nodes(list(), (n) => n.type === 'Toolbar')[0].props.addLabel, 'people.pick.new');
  add.props.onClick();
  assert.equal(nodes(list(), (n) => n.type === 'NewPersonSheet').length, 1);
  const row = nodes(list(), (n) => n.type === 'PersonRow')[0];
  row.props.onClick();
  assert.equal(nodes(list(), (n) => n.type === 'PersonSheet')[0].props.l.person.id, 'p');
  let tree = h.render();
  // 资料就在最上面，直接改；不再需要右上角「编辑」把人带过去
  assert.equal(tree.props.actions, undefined);
  const groups = nodes(tree, (n) => n.type === 'Group').map((n) => n.props.title);
  assert.ok(
    groups.indexOf('people.sheet.profile') >= 0 && groups.indexOf('people.sheet.profile') < groups.findIndex((x) => String(x).startsWith('people.sheet.in')),
  );
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

test('person car row opens member editing without a receipt form even when collection is overdue', () => {
  const h = harness();
  let tree = h.render();
  nodes(tree, (n) => n.type === 'button' && String(n.props.className).includes('pp-head'))[0].props.onClick();
  tree = h.render();
  const dialog = nodes(tree, (n) => n.type === 'MemberDialog')[0];
  const render = (editId) => {
    const hooksForMember = hooks();
    const MemberSheet = component('Members.tsx', 'MemberSheet', {
      ...hooksForMember,
      todayIn: () => '2026-10-26',
      memberStatus: () => ({ owe: true }),
      MemberForm: 'MemberForm',
      ReceiptForm: 'ReceiptForm',
    });
    return MemberSheet({ ...dialog.props, editId });
  };
  // 一律打开同一个成员弹窗；只有从某笔收款进来才叠上那一笔
  const open = (editId) => {
    const node = render(editId);
    return [node.type, JSON.stringify(node.props.initialReceipt ?? null)];
  };
  assert.deepEqual(open(), ['MemberForm', 'null']);
  assert.deepEqual(open('existing-receipt'), ['MemberForm', '{"edit":"existing-receipt"}']);
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

test('new person sheet uses the full profile form and saves note, avatar and color', async () => {
  const h = hooks();
  let state = fixture(),
    saved,
    opened;
  const avatar = 'data:image/webp;base64,fixture';
  const deps = {
    ...people,
    ...h,
    PERSON_COLORS,
    t: (s) => s,
    getState: () => state,
    useSubmit: () => [false, (fn) => fn()],
    run: async (fn) => {
      await fn();
    },
    savePerson: async (p) => {
      saved = p;
      state = { ...state, people: [...state.people, p] };
      return p;
    },
    compressAvatar: async () => avatar,
    toast() {},
  };
  for (const name of ['Sheet', 'Group', 'Cell', 'PersonAvatar', 'ContactField', 'ConfirmButton', 'Icon']) deps[name] = name;
  deps.ProfileFields = component('PersonProfile.tsx', 'ProfileFields', deps);
  const NewPersonSheet = component('People.tsx', 'NewPersonSheet', deps);
  const render = () => {
    h.reset();
    return NewPersonSheet({ onClose() {}, onSaved: (id) => (opened = id) });
  };
  const find = (match) => nodes(render(), match)[0];
  // 与人员详情同一套字段：头像、称呼、联系方式、备注、颜色
  assert.ok(find((n) => n.type === 'input' && n.props.type === 'file'));
  assert.ok(find((n) => n.type === 'ContactField'));
  find((n) => n.type === 'input' && n.props.placeholder === 'family.member.namePh').props.onChange({ target: { value: 'Fictional Wu' } });
  find((n) => n.type === 'input' && n.props.placeholder === 'people.sheet.notePh').props.onChange({ target: { value: 'fictional note' } });
  find((n) => n.props.role === 'radio' && n.props['aria-label'] === 'people.sheet.color 3').props.onClick();
  find((n) => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files: [{}], value: '' } });
  await Promise.resolve();
  await Promise.resolve();
  await nodes(render().props.foot, (n) => n.props?.className === 'btn primary')[0].props.onClick();
  assert.equal(saved.name, 'Fictional Wu');
  assert.equal(saved.note, 'fictional note');
  assert.equal(saved.avatar, avatar);
  assert.equal(saved.color, PERSON_COLORS[2]);
  assert.equal(opened, saved.id);
});
