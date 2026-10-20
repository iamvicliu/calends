import { useState } from 'preact/hooks';
import { uid } from '../../shared/billing.ts';
import { cnDateAuto, money } from '../../shared/format.ts';
import { t } from '../../shared/i18n.ts';
import { colorFor, peopleLedger, refsFor, type PersonItem, type PersonLedger } from '../../shared/people.ts';
import { proxyRows } from '../../shared/proxy.ts';
import { PERSON_COLORS, type AppState, type Person, type ShareMember, type Subscription } from '../../shared/types.ts';
import { Picker } from '../components/Picker.tsx';
import { Amount, Cell, Group, Icon, Seg, Sheet, SubIcon, Toolbar } from '../components/ui.tsx';
import { go } from '../router.ts';
import { deletePerson, mergePerson, run, savePerson } from '../store.ts';
import { confirmDelete } from './Editor.tsx';
import { ContactField, contactText, contactUrl, MemberSheet, viaLabel } from './Members.tsx';
import { EntrySheet, LedgerSheet } from './Proxy.tsx';

/** 头像：称呼的第一个字 + 这个人的颜色 */
export function PersonAvatar({ p, size = 36 }: { p: Pick<Person, 'name' | 'color' | 'id'>; size?: number }) {
  return (
    <span class={`pp-ava c-${p.color ?? colorFor(p.id || p.name)}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {[...(p.name.trim() || '?')][0].toUpperCase()}
    </span>
  );
}

/** 选人：已有的人（可搜索）或「新的人」；选中已有的人时把称呼、联系方式带过去 */
export function PersonPicker({ state, value, onPick }: { state: AppState; value?: string; onPick: (p: Person | undefined) => void }) {
  const people = [...(state.people ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Picker
      value={value && people.some((p) => p.id === value) ? value : ''}
      search={people.length > 6}
      ariaLabel={t('people.pick.aria')}
      onChange={(v) => onPick(people.find((p) => p.id === v))}
      options={[
        { value: '', label: t('people.pick.new'), icon: <Icon name="plus" size={14} /> },
        ...people.map((p) => ({ value: p.id, label: p.name, hint: contactText(p) || undefined, icon: <PersonAvatar p={p} size={20} /> })),
      ]}
    />
  );
}

/**
 * 保存成员 / 代付之前调用：还没建档的人先建档，返回 personId；
 * 已有的人改了称呼或联系方式时返回 after，等订阅保存后再 savePerson，把改动同步到其他地方。
 */
export async function linkPerson(
  state: AppState,
  personId: string | undefined,
  name: string,
  contactVia: string | undefined,
  contact: string | undefined,
): Promise<{ id?: string; after?: Person }> {
  const n = name.trim();
  if (!n) return { id: personId };
  const c = contact?.trim() || undefined;
  const v = c ? contactVia : undefined;
  const cur = personId ? state.people?.find((p) => p.id === personId) : undefined;
  if (!cur) {
    const id = personId ?? uid();
    await savePerson({ id, name: n, contactVia: v, contact: c, color: colorFor(id) });
    return { id };
  }
  const changed = cur.name !== n || cur.contact !== c || (!!c && cur.contactVia !== v);
  return { id: cur.id, after: changed ? { ...cur, name: n, contactVia: v, contact: c } : undefined };
}

/** 合租页顶部的分段：合租 / 人 */
export function FamilyTabs({ tab }: { tab: 'plans' | 'people' }) {
  return (
    <Seg
      small
      value={tab}
      onChange={(v) => go(v === 'people' ? 'family/people' : 'family')}
      options={[
        ['plans', t('people.tab.plans')],
        ['people', t('people.tab.people')],
      ]}
    />
  );
}

/** 联系按钮：Telegram、WhatsApp、邮箱、手机等能直接打开的渠道 */
function ContactLink({ p }: { p: Person }) {
  const url = contactUrl(p.contactVia ?? '', p.contact);
  if (!url) return null;
  const label = t('family.contact.open', { via: viaLabel(p.contactVia ?? '') });
  return (
    <a class="icon-btn" href={url} target="_blank" rel="noreferrer" aria-label={label} title={label} onClick={(e) => e.stopPropagation()}>
      <Icon name="link" />
    </a>
  );
}

/** 一笔关系的一行说明：合租已付至哪天 / 代付欠几期 */
function itemLine(i: PersonItem, today: string): string {
  const kind = t(`people.kind.${i.kind}`);
  if (i.member?.left && i.member.left <= today) return `${kind} · ${t('people.item.left')}`;
  if (!i.active && i.kind === 'proxy') return `${kind} · ${t('people.item.ended')}`;
  if (i.member?.exempt) return `${kind} · ${t('family.pool.exempt')}`;
  if (i.periodsOwed > 0) return `${kind} · ${t('people.item.owedPeriods', { count: i.periodsOwed })}`;
  if (i.kind === 'share') return `${kind} · ${i.paidUntil ? t('people.item.paidUntil', { date: cnDateAuto(i.paidUntil, today) }) : t('people.item.noPay')}`;
  return `${kind} · ${t('family.pool.settled')}`;
}

/** 人：每个人在哪些合租、代付里，现在欠多少、至今收回多少、最近一次收款 */
export function PeopleView({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  const book = peopleLedger(state, today);
  const [open, setOpen] = useState<string | null>(null);
  const owing = book.filter((l) => l.owed > 0.005);
  const owed = owing.reduce((a, l) => a + l.owed, 0);
  const received = book.reduce((a, l) => a + l.received, 0);
  const inShare = book.filter((l) => l.items.some((i) => i.kind === 'share')).length;
  const inProxy = book.filter((l) => l.items.some((i) => i.kind === 'proxy')).length;
  const current = open ? book.find((l) => (l.person.id || l.person.name) === open) : undefined;
  return (
    <>
      <Toolbar title={t('people.title')}>
        <FamilyTabs tab="people" />
      </Toolbar>
      <div class="page fade-in stack">
        <div class="grid g-3">
          <div class="card stat">
            <div class="stat-label">{t('people.stat.owed')}</div>
            <div class="stat-value" style={{ color: owed > 0 ? 'var(--orange)' : undefined }}>
              <Amount value={owed} ccy={base} />
            </div>
            <div class="stat-sub">{owing.length ? t('people.stat.owedSub', { count: owing.length }) : t('people.stat.allSettled')}</div>
          </div>
          <div class="card stat">
            <div class="stat-label">{t('people.stat.received')}</div>
            <div class="stat-value">
              <Amount value={received} ccy={base} />
            </div>
            <div class="stat-sub">{t('people.stat.receivedSub')}</div>
          </div>
          <div class="card stat">
            <div class="stat-label">{t('people.stat.count')}</div>
            <div class="stat-value">
              <span class="amt">{book.length}</span>
            </div>
            <div class="stat-sub">{t('people.stat.countSub', { share: inShare, proxy: inProxy })}</div>
          </div>
        </div>
        {book.length === 0 ? (
          <div class="card empty">
            <b>{t('people.empty.title')}</b>
            {t('people.empty.body')}
          </div>
        ) : (
          <div class="grid g-2">
            {book.map((l) => (
              <PersonCard key={l.person.id || l.person.name} l={l} base={base} today={today} onClick={() => setOpen(l.person.id || l.person.name)} />
            ))}
          </div>
        )}
      </div>
      {current && <PersonSheet state={state} today={today} l={current} onOpen={onOpen} onClose={() => setOpen(null)} />}
    </>
  );
}

function PersonCard({ l, base, today, onClick }: { l: PersonLedger; base: string; today: string; onClick: () => void }) {
  const p = l.person;
  const contact = contactText(p);
  const live = l.items.filter((i) => i.active);
  return (
    <div
      class="card pp-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick())}
    >
      <div class="pp-top">
        <PersonAvatar p={p} size={44} />
        <div class="pp-id">
          <div class="ph-name">{p.name}</div>
          <div class="muted ph-meta">{contact || p.note || t('people.card.noContact')}</div>
        </div>
        <ContactLink p={p} />
      </div>
      <div class="ph-chips">
        {l.items.length === 0 && (
          <span class="muted" style={{ fontSize: 13 }}>
            {t('people.card.nothing')}
          </span>
        )}
        {l.items.map((i) => (
          <span key={`${i.kind}-${i.sub.id}-${i.member?.id ?? ''}`} class={`pp-chip ${i.active ? '' : 'off'}`} title={itemLine(i, today)}>
            <SubIcon sub={i.sub} size={16} />
            {i.sub.name}
            {i.periodsOwed > 0 && <i class="dot" />}
          </span>
        ))}
      </div>
      <div class="proxy-facts">
        <div>
          <small>{l.periodsOwed ? t('people.item.owedPeriods', { count: l.periodsOwed }) : t('people.sheet.owed')}</small>
          <b class={l.owed > 0.005 ? 'warn' : 'done'}>{l.owed > 0.005 ? money(l.owed, base, { compact: true }) : t('family.pool.settled')}</b>
        </div>
        <div>
          <small>{t('people.sheet.received')}</small>
          <b>{money(l.received, base, { compact: true })}</b>
        </div>
        <div>
          <small>{t('people.sheet.last')}</small>
          <b class={l.lastPaid ? '' : 'muted'}>{l.lastPaid ? cnDateAuto(l.lastPaid, today) : '—'}</b>
        </div>
      </div>
      {live.length !== l.items.length && live.length > 0 && <div class="muted pp-foot">{t('people.card.past', { count: l.items.length - live.length })}</div>}
    </div>
  );
}

/** 一个人的详情：资料（改了处处生效）、每个合租 / 代付的明细与快捷记收款、合并与删除 */
function PersonSheet({
  state,
  today,
  l,
  onOpen,
  onClose,
}: {
  state: AppState;
  today: string;
  l: PersonLedger;
  onOpen: (s: Subscription) => void;
  onClose: () => void;
}) {
  const base = state.settings.baseCurrency;
  const stored = l.person.id ? state.people?.find((p) => p.id === l.person.id) : undefined;
  const [f, setF] = useState<Person>(() => ({ ...l.person }));
  const up = (p: Partial<Person>) => setF({ ...f, ...p });
  const via = f.contactVia ?? 'Telegram';
  const dirty =
    !!stored &&
    JSON.stringify({ ...stored, contactVia: stored.contact ? stored.contactVia : undefined }) !==
      JSON.stringify({ ...f, contactVia: f.contact ? f.contactVia : undefined });
  const refs = l.person.id ? refsFor(state.subscriptions, l.person.id).length : l.items.length;
  const others = (state.people ?? []).filter((p) => p.id !== l.person.id).sort((a, b) => a.name.localeCompare(b.name));
  const [member, setMember] = useState<{ s: Subscription; m: ShareMember; collect?: boolean } | null>(null);
  const [ledger, setLedger] = useState<Subscription | null>(null);
  const [entry, setEntry] = useState<{ s: Subscription; row: ReturnType<typeof proxyRows>[number] } | null>(null);
  const ro = !!state.readonly;
  const val = (e: Event) => (e.target as HTMLInputElement).value;
  const live = (s: Subscription) => state.subscriptions.find((x) => x.id === s.id) ?? s;

  const save = () =>
    run(async () => {
      await savePerson({ ...f, name: f.name.trim(), contactVia: f.contact ? via : undefined });
    }, t('family.member.saved'));
  /** 记收款：合租打开成员的收款表单，代付打开最早一期没收的 */
  const record = (i: PersonItem) => {
    const s = live(i.sub);
    if (i.kind === 'share') {
      const m = s.share?.members.find((x) => x.id === i.member!.id);
      if (m) setMember({ s, m, collect: true });
      return;
    }
    const open = proxyRows(state, s, today).filter((r) => r.receivedBase == null);
    if (open.length) setEntry({ s, row: open[open.length - 1] });
    else setLedger(s);
  };
  const tap = (i: PersonItem) => {
    const s = live(i.sub);
    if (i.kind === 'share') {
      const m = s.share?.members.find((x) => x.id === i.member!.id);
      if (m) setMember({ s, m });
    } else setLedger(s);
  };

  return (
    <Sheet
      narrow
      title={l.person.name}
      onClose={onClose}
      foot={
        stored && !ro ? (
          <>
            {refs === 0 && (
              <button
                class="btn plain"
                style={{ color: 'var(--red)' }}
                onClick={() =>
                  confirmDelete(t('people.sheet.confirmDelete', { name: stored.name })) &&
                  run(async () => {
                    await deletePerson(stored.id);
                    onClose();
                  }, t('family.member.deleted'))
                }
              >
                {t('family.member.delete')}
              </button>
            )}
            <span class="grow" />
            <button class="btn" onClick={onClose}>
              {t('family.member.cancel')}
            </button>
            <button class="btn primary" disabled={!dirty || !f.name.trim()} onClick={save}>
              {t('family.member.save')}
            </button>
          </>
        ) : undefined
      }
    >
      <div class="stack">
        <div class="ld-head">
          <PersonAvatar p={f} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div class="ph-name">{f.name || l.person.name}</div>
            <div class="muted ph-meta">{contactText(f) || t('people.card.noContact')}</div>
          </div>
          <ContactLink p={f} />
        </div>

        <div class="proxy-facts">
          <div>
            <small>{t('people.sheet.owed')}</small>
            <b class={l.owed > 0.005 ? 'warn' : 'done'}>{l.owed > 0.005 ? money(l.owed, base, { compact: true }) : t('family.pool.settled')}</b>
          </div>
          <div>
            <small>{t('people.sheet.received')}</small>
            <b>{money(l.received, base, { compact: true })}</b>
          </div>
          <div>
            <small>{t('people.sheet.last')}</small>
            <b>{l.lastPaid ? cnDateAuto(l.lastPaid, today) : '—'}</b>
          </div>
        </div>

        <Group title={t('people.sheet.in', { count: l.items.length })} foot={l.items.length ? undefined : t('people.sheet.inEmpty')}>
          {l.items.map((i) => (
            <div key={`${i.kind}-${i.sub.id}-${i.member?.id ?? ''}`} class={`cell pp-item ${i.active ? '' : 'off'}`}>
              <button class="pp-item-l" disabled={ro} onClick={() => tap(i)}>
                <SubIcon sub={i.sub} size={30} />
                <span>
                  {i.sub.name}
                  <small>{itemLine(i, today)}</small>
                </span>
              </button>
              <span class="cell-r">
                <span class="pp-amt">
                  {i.owed > 0.005 ? (
                    <b style={{ color: 'var(--orange)' }}>{money(i.owed, base)}</b>
                  ) : (
                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>{t('family.pool.settled')}</span>
                  )}
                  <small>{t('people.item.received', { amount: money(i.received, base, { compact: true }) })}</small>
                </span>
                {!ro && !i.member?.exempt && (i.active || i.periodsOwed > 0) && (
                  <button class={`btn ${i.periodsOwed > 0 ? 'tinted' : ''} pp-collect`} onClick={() => record(i)}>
                    <Icon name="check" /> {t('family.pool.collect')}
                  </button>
                )}
              </span>
            </div>
          ))}
        </Group>

        {stored && (
          <Group title={t('people.sheet.profile')} foot={refs > 1 ? t('people.sheet.syncFoot', { count: refs }) : undefined}>
            <Cell label={t('family.member.name')}>
              <input value={f.name} disabled={ro} placeholder={t('family.member.namePh')} onInput={(e) => up({ name: val(e) })} />
            </Cell>
            <Cell label={t('family.member.contact')}>
              <ContactField
                via={via}
                value={f.contact}
                onVia={(v) => up({ contactVia: v })}
                onChange={(c) => up({ contactVia: via, contact: c || undefined })}
              />
            </Cell>
            <Cell label={t('family.member.note')}>
              <input value={f.note ?? ''} disabled={ro} placeholder={t('people.sheet.notePh')} onInput={(e) => up({ note: val(e) || undefined })} />
            </Cell>
            <Cell label={t('people.sheet.color')}>
              <span class="pp-colors" role="radiogroup" aria-label={t('people.sheet.color')}>
                {PERSON_COLORS.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={(f.color ?? colorFor(f.id)) === c}
                    aria-label={`${t('people.sheet.color')} ${i + 1}`}
                    class={`pp-dot c-${c} ${(f.color ?? colorFor(f.id)) === c ? 'on' : ''}`}
                    onClick={() => up({ color: c })}
                  />
                ))}
              </span>
            </Cell>
          </Group>
        )}

        {stored && !ro && others.length > 0 && (
          <Group foot={t('people.sheet.mergeFoot')}>
            <Cell label={t('people.sheet.merge')}>
              <Picker
                value=""
                search={others.length > 6}
                ariaLabel={t('people.sheet.merge')}
                display={<span>{t('people.sheet.mergePick')}</span>}
                onChange={(into) => {
                  const target = others.find((p) => p.id === into);
                  if (!target || !confirmDelete(t('people.sheet.mergeConfirm', { from: stored.name, into: target.name }))) return;
                  run(
                    async () => {
                      await mergePerson(stored.id, target.id);
                      onClose();
                    },
                    t('people.sheet.merged', { name: target.name }),
                  );
                }}
                options={others.map((p) => ({ value: p.id, label: p.name, hint: contactText(p) || undefined, icon: <PersonAvatar p={p} size={20} /> }))}
              />
            </Cell>
          </Group>
        )}
      </div>
      {member && (
        <MemberSheet
          state={state}
          s={live(member.s)}
          member={live(member.s).share?.members.find((x) => x.id === member.m.id) ?? member.m}
          collect={member.collect}
          onClose={() => setMember(null)}
        />
      )}
      {ledger && <LedgerSheet state={state} s={live(ledger)} onOpen={onOpen} onClose={() => setLedger(null)} />}
      {entry && <EntrySheet state={state} s={live(entry.s)} row={entry.row} onClose={() => setEntry(null)} />}
    </Sheet>
  );
}
