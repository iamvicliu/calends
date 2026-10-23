import { memberCashFlows, memberFlowValue } from './carpool.ts';
// 人：合租成员与代付对象的统一名册。
// 成员、代付上存 personId 指向名册；原来的称呼、联系方式保留为镜像副本，老数据和只认副本的地方（提醒邮件、导出）照常工作。
// 应收按人汇总时，直接复用合租（memberDues）与代付（proxyRows）各自的算法，只是换个维度加起来。
import { effectiveStatus, memberDues, memberAboard } from './billing.ts';
import { toBaseAt } from './fx.ts';
import { proxyRows } from './proxy.ts';
import { PERSON_COLORS, type AppState, type Person, type PersonColor, type ShareMember, type Subscription } from './types.ts';

// ---------- 归一化：判断两条记录是不是同一个人 ----------

/** 称呼：全角半角统一、去首尾空白、合并空格、不分大小写 */
export const normName = (s: string | undefined): string => (s ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** 联系方式：渠道 + 账号；Telegram、X 去掉 @，手机、WhatsApp 只留数字。没有账号时为空串 */
export function normContact(via?: string, contact?: string, tg?: string): string {
  const v = via ?? (tg ? 'Telegram' : '');
  const raw = (contact ?? tg ?? '').normalize('NFKC').trim().toLowerCase();
  if (!raw) return '';
  const id = v === 'Telegram' || v === 'X' ? raw.replace(/^@+/, '') : v === '手机' || v === 'WhatsApp' ? raw.replace(/\D/g, '') : raw.replace(/\s+/g, '');
  return id ? `${v}:${id}` : '';
}

/** 一个人的身份键：称呼 + 联系方式 */
export const personKey = (name: string | undefined, via?: string, contact?: string, tg?: string): string =>
  `${normName(name)}|${normContact(via, contact, tg)}`;

/** FNV-1a 短哈希：自动建档的人用它当 id，同样的数据算出同样的 id，并发迁移也不会重复建档 */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export const colorFor = (seed: string): PersonColor => PERSON_COLORS[hash(seed) % PERSON_COLORS.length];

// ---------- 引用：订阅里哪些地方指向人 ----------

/** 一处引用：某个合租的某位成员，或某个代付的对象 */
export type PersonRef = { kind: 'member'; sub: Subscription; member: ShareMember } | { kind: 'proxy'; sub: Subscription };

function refsOf(subs: Subscription[]): PersonRef[] {
  const out: PersonRef[] = [];
  for (const s of subs) {
    for (const m of s.share?.members ?? []) out.push({ kind: 'member', sub: s, member: m });
    if (s.proxy) out.push({ kind: 'proxy', sub: s });
  }
  return out;
}

/** 引用上的镜像副本：称呼与联系方式（早期的 tg 字段视为 Telegram） */
function refInfo(r: PersonRef): { personId?: string; name: string; contactVia?: string; contact?: string } {
  if (r.kind === 'proxy')
    return { personId: r.sub.proxy!.personId, name: r.sub.proxy!.forName ?? '', contactVia: r.sub.proxy!.contactVia, contact: r.sub.proxy!.contact };
  const m = r.member;
  return { personId: m.personId, name: m.name ?? '', contactVia: m.contactVia ?? (m.tg && !m.contact ? 'Telegram' : undefined), contact: m.contact ?? m.tg };
}

/** 某个人在哪些合租、代付里出现 */
export const refsFor = (subs: Subscription[], personId: string): PersonRef[] => refsOf(subs).filter((r) => refInfo(r).personId === personId);

/** 把一组引用改写成新的样子，返回改动过的订阅（同一订阅的多处改动合并在一起） */
function rewrite(subs: Subscription[], fn: (r: PersonRef) => Partial<ShareMember> | undefined): Subscription[] {
  const changed: Subscription[] = [];
  for (const s of subs) {
    let next = s;
    if (s.share?.members.length) {
      const members = s.share.members.map((m) => {
        const p = fn({ kind: 'member', sub: s, member: m });
        return p ? { ...m, ...p } : m;
      });
      if (members.some((m, i) => m !== s.share!.members[i])) next = { ...next, share: { ...s.share, members } };
    }
    if (s.proxy) {
      const p = fn({ kind: 'proxy', sub: s });
      if (p) {
        const { name, ...rest } = p;
        next = { ...next, proxy: { ...s.proxy, ...rest, ...(name !== undefined ? { forName: name } : {}) } };
      }
    }
    if (next !== s && JSON.stringify(next) !== JSON.stringify(s)) changed.push(next);
  }
  return changed;
}

// ---------- 自动建档：一次性迁移，可重复执行 ----------

/**
 * 给还没关联到人的成员、代付找到对应的人；找不到就建档。只做「补上 personId」，不改动任何原有字段。
 * - 称呼 + 联系方式都一样 → 同一个人；
 * - 没填联系方式的，若同名的人只有一个，就归到他名下；同名的有好几个时单独建档，留给用户手动合并；
 * - 没有称呼的不建档；personId 指向已不存在的人时当作未关联重新处理（数据只会更全，不会丢）。
 * 已全部关联时返回空的改动，可以放心在每次读取时调用。
 */
export function linkPeople(people: Person[], subs: Subscription[]): { people: Person[]; created: Person[]; subs: Subscription[] } {
  const ids = new Set(people.map((p) => p.id));
  const byKey = new Map<string, string>();
  const byName = new Map<string, Set<string>>();
  const addName = (n: string, id: string) => {
    if (!byName.has(n)) byName.set(n, new Set());
    byName.get(n)!.add(id);
  };
  for (const p of people) {
    const k = personKey(p.name, p.contactVia, p.contact);
    if (!byKey.has(k)) byKey.set(k, p.id);
    addName(normName(p.name), p.id);
  }
  const created: Person[] = [];
  const create = (k: string, info: ReturnType<typeof refInfo>): string => {
    const id = `p${hash(k).toString(36)}`;
    if (!ids.has(id)) {
      ids.add(id);
      created.push({
        id,
        name: info.name.trim(),
        contactVia: info.contact ? info.contactVia : undefined,
        contact: info.contact || undefined,
        color: colorFor(k),
      });
    }
    byKey.set(k, id);
    addName(normName(info.name), id);
    return id;
  };
  const pending = refsOf(subs).filter((r) => {
    const i = refInfo(r);
    return normName(i.name) && (!i.personId || !ids.has(i.personId));
  });
  const assign = new Map<string, string>();
  const refId = (r: PersonRef) => (r.kind === 'proxy' ? `proxy:${r.sub.id}` : `member:${r.sub.id}:${r.member.id}`);
  // 先处理有联系方式的，再让只有称呼的去认领
  const withContact = pending.filter((r) => normContact(refInfo(r).contactVia, refInfo(r).contact));
  const nameOnly = pending.filter((r) => !withContact.includes(r));
  for (const r of withContact) {
    const i = refInfo(r);
    const k = personKey(i.name, i.contactVia, i.contact);
    assign.set(refId(r), byKey.get(k) ?? create(k, i));
  }
  for (const r of nameOnly) {
    const i = refInfo(r);
    const n = normName(i.name);
    const same = byName.get(n);
    const k = `${n}|`;
    assign.set(refId(r), same?.size === 1 ? [...same][0] : (byKey.get(k) ?? create(k, i)));
  }
  const changed = assign.size ? rewrite(subs, (r) => (assign.has(refId(r)) ? { personId: assign.get(refId(r)) } : undefined)) : [];
  return { people: created.length ? [...people, ...created] : people, created, subs: changed };
}

// ---------- 改一个人：处处生效 ----------

/** 把这个人的称呼、联系方式同步到所有引用他的成员、代付上，返回改动过的订阅 */
export function syncPerson(subs: Subscription[], p: Person): Subscription[] {
  return rewrite(subs, (r) => {
    if (refInfo(r).personId !== p.id) return undefined;
    // 镜像副本整体换成名册里的：清掉旧的 tg，联系方式跟着人走
    return r.kind === 'member'
      ? { name: p.name, contactVia: p.contact ? p.contactVia : undefined, contact: p.contact || undefined, tg: undefined }
      : { name: p.name, contactVia: p.contact ? p.contactVia : undefined, contact: p.contact || undefined };
  });
}

/** 合并两个人：from 的所有引用改指向 into，再按 into 同步副本；from 从名册里去掉 */
export function mergePeople(people: Person[], subs: Subscription[], fromId: string, intoId: string): { people: Person[]; subs: Subscription[] } {
  const into = people.find((p) => p.id === intoId);
  if (!into || fromId === intoId) return { people, subs: [] };
  const moved = rewrite(subs, (r) => (refInfo(r).personId === fromId ? { personId: intoId } : undefined));
  const all = subs.map((s) => moved.find((x) => x.id === s.id) ?? s);
  const synced = syncPerson(all, into);
  const ids = new Set([...moved, ...synced].map((s) => s.id));
  return { people: people.filter((p) => p.id !== fromId), subs: all.map((s) => synced.find((x) => x.id === s.id) ?? s).filter((s) => ids.has(s.id)) };
}

/** 显示用：引用对应的人；没关联（或名册里找不到）时用副本拼一个 */
function personOf(state: Pick<AppState, 'people'>, r: PersonRef): Person {
  const i = refInfo(r);
  return state.people?.find((p) => p.id === i.personId) ?? { id: '', name: i.name, contactVia: i.contactVia, contact: i.contact };
}

// ---------- 应收：按人汇总 ----------

export interface PersonItem {
  kind: 'share' | 'proxy';
  sub: Subscription;
  member?: ShareMember;
  /** 现在欠我多少（本位币） */
  owed: number;
  /** 欠几期 */
  periodsOwed: number;
  /** 至今收回多少（本位币，按收款当天汇率） */
  received: number;
  lastPaid?: string;
  /** 合租：已付至；代付：无 */
  paidUntil?: string;
  /** 还在进行：成员没退出、订阅没停 */
  active: boolean;
}

export interface PersonLedger {
  person: Person;
  items: PersonItem[];
  owed: number;
  periodsOwed: number;
  received: number;
  lastPaid?: string;
}

/** 一笔合租关系的账：欠款来自 memberDues，收回来自成员的收款记录 */
function shareItem(state: AppState, s: Subscription, m: ShareMember, today: string, dues: ReturnType<typeof memberDues>): PersonItem {
  const d = dues.find((x) => x.member.id === m.id);
  const pays = m.payments ?? [];
  const flows = memberCashFlows(m);
  return {
    kind: 'share',
    sub: s,
    member: m,
    owed: d && !m.exempt ? (Number.isFinite(d.owed) ? toBaseAt(state, d.owed, d.currency) : NaN) : 0,
    periodsOwed: d && !m.exempt ? d.periodsOwed : 0,
    received: flows.reduce((a, p) => a + memberFlowValue(state, p), 0),
    lastPaid: pays.reduce<string | undefined>((a, p) => (!a || p.date > a ? p.date : a), undefined),
    paidUntil: m.paidUntil,
    active: !!d && memberAboard(m, today) && ['active', 'ending', 'trial'].includes(effectiveStatus(s, today)),
  };
}

/** 一笔代付的账：每期实扣与收回来自 proxyRows */
function proxyItem(state: AppState, s: Subscription, today: string): PersonItem {
  const rows = proxyRows(state, s, today);
  const open = rows.filter((r) => r.receivedBase == null);
  const done = rows.filter((r) => r.receivedBase != null);
  return {
    kind: 'proxy',
    sub: s,
    owed: open.reduce((a, r) => a + r.chargedBase, 0),
    periodsOwed: open.length,
    received: done.reduce((a, r) => a + r.receivedBase!, 0),
    lastPaid: done.reduce<string | undefined>((a, r) => {
      const d = r.entry?.receivedOn ?? r.date;
      return !a || d > a ? d : a;
    }, undefined),
    active: !['ended', 'terminated'].includes(effectiveStatus(s, today)),
  };
}

/**
 * 每个人的应收总账：在哪些合租 / 代付里、现在欠多少、至今收回多少、最近一次收款。
 * 只统计我发起的合租（我向成员收钱）与代付；没关联到名册的引用按副本里的称呼单独成行，不会漏算。
 * 欠得多的排在前面，其余按称呼排序。
 */
export function peopleLedger(state: AppState, today: string): PersonLedger[] {
  const book = new Map<string, PersonLedger>();
  for (const p of state.people ?? []) book.set(p.id, { person: p, items: [], owed: 0, periodsOwed: 0, received: 0 });
  const dues = new Map<string, ReturnType<typeof memberDues>>();
  for (const r of refsOf(state.subscriptions)) {
    if (r.kind === 'member' && r.sub.share?.role !== 'owner') continue;
    const person = personOf(state, r);
    if (!person.id && !normName(person.name)) continue;
    const key = person.id || `~${personKey(person.name, person.contactVia, person.contact)}`;
    if (!book.has(key)) book.set(key, { person, items: [], owed: 0, periodsOwed: 0, received: 0 });
    if (r.kind === 'member' && !dues.has(r.sub.id))
      dues.set(r.sub.id, memberDues(r.sub, today, state.settings.collectCurrency ?? state.settings.baseCurrency, state));
    const item = r.kind === 'member' ? shareItem(state, r.sub, r.member, today, dues.get(r.sub.id)!) : proxyItem(state, r.sub, today);
    const l = book.get(key)!;
    l.items.push(item);
    l.owed += item.owed;
    l.periodsOwed += item.periodsOwed;
    l.received += item.received;
    if (item.lastPaid && (!l.lastPaid || item.lastPaid > l.lastPaid)) l.lastPaid = item.lastPaid;
  }
  for (const l of book.values()) l.items.sort((a, b) => Number(b.active) - Number(a.active) || b.owed - a.owed || a.sub.name.localeCompare(b.sub.name));
  return [...book.values()].sort(
    (a, b) => (b.owed > 0.005 ? 1 : 0) - (a.owed > 0.005 ? 1 : 0) || b.owed - a.owed || a.person.name.localeCompare(b.person.name),
  );
}

/** Roster presentation only: never alter the underlying ledger or its financial totals. */
export type PeopleSort = 'owed' | 'received' | 'lastPaid' | 'name';
export function peopleListRows(
  book: PersonLedger[],
  {
    filter = 'all',
    sort = 'owed',
    dir = 'desc',
    locale,
  }: { filter?: 'all' | 'owe' | 'settled'; sort?: PeopleSort; dir?: 'asc' | 'desc'; locale?: string } = {},
): PersonLedger[] {
  const byName = (a: PersonLedger, b: PersonLedger) => a.person.name.localeCompare(b.person.name, locale);
  return book
    .filter((l) => filter === 'all' || (Number.isFinite(l.owed) && (filter === 'owe' ? l.owed > 0.005 : l.owed <= 0.005)))
    .sort((a, b) => {
      if (sort === 'name') return (dir === 'asc' ? 1 : -1) * byName(a, b);
      if (sort === 'lastPaid') {
        // Missing dates stay last in either direction.
        if (!a.lastPaid || !b.lastPaid) return Number(!!b.lastPaid) - Number(!!a.lastPaid) || byName(a, b);
        return (dir === 'asc' ? 1 : -1) * a.lastPaid.localeCompare(b.lastPaid) || byName(a, b);
      }
      if (!Number.isFinite(a[sort]) || !Number.isFinite(b[sort])) return Number(Number.isFinite(b[sort])) - Number(Number.isFinite(a[sort])) || byName(a, b);
      return (dir === 'asc' ? 1 : -1) * (a[sort] - b[sort]) || (b.lastPaid ?? '').localeCompare(a.lastPaid ?? '') || byName(a, b);
    });
}
