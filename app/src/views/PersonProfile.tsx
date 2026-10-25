import { popupOpen, sheetSubmitKey } from '../keyboard.ts';
import { useRef, useState } from 'react';
import { PersonAvatar } from '../components/PersonAvatar.tsx';
import { compressAvatar } from '../handoff.ts';
import { flow, cnDateAuto, money } from '../../../shared/format.ts';
import { t } from '../../../shared/i18n.ts';
import { colorFor, peopleLedger, refsFor, type PersonItem, type PersonLedger } from '../../../shared/people.ts';
import { proxyRows } from '../../../shared/proxy.ts';
import { PERSON_COLORS, type AppState, type Person, type ShareMember, type Subscription } from '../../../shared/types.ts';
import { Picker } from '../components/Picker.tsx';
import { MetricCards, Metric, Cell, Group, IconButton } from '../components/ui.tsx';
import { ask, Sheet } from '../components/overlays.tsx';
import { Icon } from '../components/icons.tsx';
import { SubIcon } from '../components/marks.tsx';
import { copyText, toast, run } from '../toast.ts';
import { deletePerson, getState, mergePerson, savePerson, saveSub } from '../store.ts';
import type { MemberSheet } from './Members.tsx';
import { ContactField, contactText, contactUrl, viaLabel } from '../components/Contact.tsx';
import { EntrySheet, LedgerSheet } from './proxy/sheets.tsx';
import './people-list.css';

/** 联系按钮：Telegram、WhatsApp、邮箱、手机等能直接打开的渠道 */
export function ContactLink({ p }: { p: Person }) {
  const url = contactUrl(p.contactVia ?? '', p.contact);
  if (!url) return null;
  const label = t('family.contact.open', { via: viaLabel(p.contactVia ?? '') });
  return (
    <a className="icon-btn" href={url} target="_blank" rel="noreferrer" aria-label={label} title={label} onClick={(e) => e.stopPropagation()}>
      <Icon name="link" />
    </a>
  );
}

/** 一个人的详情：资料（改了处处生效）、每个合租 / 代付的明细与快捷记收款、合并与删除 */
/** 从合租成员、代付对象那里打开某个人员的详情：在这里改称呼、联系方式、头像，所有引用他的地方一起变 */
export function PersonProfileSheet({
  memberDialog: MemberDialog,
  state,
  today,
  personId,
  onOpen,
  onClose,
}: {
  memberDialog: typeof MemberSheet;
  state: AppState;
  today: string;
  personId: string;
  onOpen: (s: Subscription) => void;
  onClose: () => void;
}) {
  const l = peopleLedger(state, today).find((x) => x.person.id === personId);
  return l ? <PersonSheet memberDialog={MemberDialog} state={state} today={today} l={l} onOpen={onOpen} onClose={onClose} /> : null;
}

export function PersonSheet({
  memberDialog: MemberDialog,
  state,
  today,
  l,
  onOpen,
  onClose,
}: {
  memberDialog: typeof MemberSheet;
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
  const profile = (p: Person) => JSON.stringify([p.name, p.contact ? p.contactVia : undefined, p.contact, p.note, p.color, p.avatar]);
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [editingAccount, setEditingAccount] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const accountKey = (i: PersonItem) => `${i.sub.id}/${i.member!.id}`;
  const accountValue = (i: PersonItem) => accounts[accountKey(i)] ?? i.member?.account ?? '';
  const changedAccounts = l.items.filter((i) => i.member && accountValue(i).trim() !== (i.member.account ?? ''));
  const dirty = (!!stored && profile(stored) !== profile(f)) || changedAccounts.length > 0;
  const refs = l.person.id ? refsFor(state.subscriptions, l.person.id).length : l.items.length;
  const others = (state.people ?? []).filter((p) => p.id !== l.person.id).sort((a, b) => a.name.localeCompare(b.name));
  const [member, setMember] = useState<{ s: Subscription; m: ShareMember; collect?: boolean } | null>(null);
  const [ledger, setLedger] = useState<Subscription | null>(null);
  const [entry, setEntry] = useState<{ s: Subscription; row: ReturnType<typeof proxyRows>[number] } | null>(null);
  const ro = !!state.readonly;
  const fileInput = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const uploadAvatar = async (file?: File) => {
    if (!file || ro || !stored || busyRef.current) return;
    busyRef.current = true;
    setAvatarBusy(true);
    try {
      const avatar = await compressAvatar(file);
      setF((current) => ({ ...current, avatar }));
    } catch (error) {
      toast(error instanceof Error ? error.message : t('server.avatarInvalid'), 'error');
    } finally {
      busyRef.current = false;
      setAvatarBusy(false);
    }
  };
  const val = (e: { target: EventTarget | null }) => (e.target as HTMLInputElement).value;
  const live = (s: Subscription) => state.subscriptions.find((x) => x.id === s.id) ?? s;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await run(async () => {
        // 每次从当前状态取订阅，保留本弹窗打开后新增的收款及其他成员改动。
        for (const subId of new Set(changedAccounts.map((i) => i.sub.id))) {
          const current = getState().subscriptions.find((s) => s.id === subId);
          if (!current?.share) throw new Error(t('people.sheet.accountMissing'));
          const changes = changedAccounts.filter((i) => i.sub.id === subId);
          if (changes.some((i) => !current.share!.members.some((m) => m.id === i.member!.id))) throw new Error(t('people.sheet.accountMissing'));
          await saveSub({
            ...current,
            share: {
              ...current.share,
              members: current.share.members.map((m) => {
                const item = changes.find((i) => i.member!.id === m.id);
                return item ? { ...m, account: accountValue(item).trim() || undefined } : m;
              }),
            },
          });
        }
        if (stored && profile(stored) !== profile(f)) {
          const saved = await savePerson({ ...f, name: f.name.trim(), contactVia: f.contact ? via : undefined });
          setF((current) => (profile(current) === profile(f) ? saved : current));
        }
        setAccounts({});
        setEditingAccount(null);
      }, t('family.member.saved'));
    } finally {
      setSaving(false);
    }
  };
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
                className="btn plain"
                style={{ color: 'var(--red)' }}
                onClick={async () =>
                  (await ask(t('people.sheet.confirmDelete', { name: stored.name }))) &&
                  run(async () => {
                    await deletePerson(stored.id);
                    onClose();
                  }, t('family.member.deleted'))
                }
              >
                {t('family.member.delete')}
              </button>
            )}
            <span className="grow" />
            <button className="btn" onClick={onClose}>
              {t('family.member.cancel')}
            </button>
            <button className="btn primary" disabled={!dirty || !f.name.trim() || avatarBusy || saving} onClick={save}>
              {t('family.member.save')}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="stack">
        <div className="ld-head">
          {stored && !ro ? (
            <>
              <input
                ref={fileInput}
                type="file"
                hidden
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  void uploadAvatar(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="person-avatar-edit"
                aria-label={t('people.avatar.change')}
                title={t('people.avatar.help')}
                disabled={avatarBusy}
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void uploadAvatar(e.dataTransfer.files[0]);
                }}
                onPaste={(e) => {
                  const file = [...e.clipboardData.files][0];
                  if (file) {
                    e.preventDefault();
                    void uploadAvatar(file);
                  }
                }}
              >
                <PersonAvatar p={f} size={52} />
              </button>
            </>
          ) : (
            <PersonAvatar p={f} size={52} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ph-name text-ellipsis">{f.name || l.person.name}</div>
            <div className={`muted ph-meta ${contactText(f) ? '' : 'm-hide'}`}>{contactText(f) || t('people.card.noContact')}</div>
          </div>
          <ContactLink p={f} />
        </div>

        {/* 上传说明只放在头像的悬停提示里；有头像时这里只留「移除头像」 */}
        {stored && !ro && f.avatar && (
          <div className="row person-avatar-help">
            <span className="grow" />
            <button
              type="button"
              className="btn plain"
              disabled={avatarBusy}
              onClick={async () => {
                if (await ask(t('people.avatar.removeConfirm'))) setF((current) => ({ ...current, avatar: undefined }));
              }}
            >
              {t('people.avatar.remove')}
            </button>
          </div>
        )}
        <MetricCards>
          <Metric
            label={t('people.sheet.owed')}
            value={l.owed > 0.005 ? money(l.owed, base, { compact: true }) : t('family.pool.settled')}
            valueClassName={l.owed > 0.005 ? 'warn' : 'done'}
          />
          <Metric label={t('people.sheet.received')} value={flow(l.received, base, { compact: true })} valueClassName="green" />
          <Metric label={t('people.sheet.last')} value={l.lastPaid ? cnDateAuto(l.lastPaid, today) : '—'} />
        </MetricCards>

        <Group title={t('people.sheet.in', { count: l.items.length })} foot={l.items.length ? undefined : t('people.sheet.inEmpty')}>
          {/* 每一项是一张带标签的小表：头部订阅与状态，中间账号 / 已付至 / 已收，右下「收款」 */}
          {l.items.map((i) => {
            const canCollect = !ro && !i.member?.exempt && (i.active || i.periodsOwed > 0);
            const gone = !!i.member?.left && i.member.left <= today;
            return (
              <div key={`${i.kind}-${i.sub.id}-${i.member?.id ?? ''}`} className={`cell pp-item ${i.active ? '' : 'off'}`}>
                <div className="pp-row">
                  <button className="pp-item-l" disabled={ro || saving} onClick={() => tap(i)}>
                    <SubIcon sub={i.sub} size={30} />
                    <span>
                      {i.sub.name}
                      <small>{t(`people.kind.${i.kind}`)}</small>
                    </span>
                  </button>
                  {i.owed > 0.005 ? (
                    <b className="pp-state" style={{ color: 'var(--orange)' }}>
                      {t('family.pool.owedAmount', { amount: money(i.owed, base) })}
                    </b>
                  ) : (
                    <span className="pp-state" style={{ color: i.active ? 'var(--green)' : undefined }}>
                      {gone ? t('people.item.left') : !i.active ? t('people.item.ended') : t('family.pool.settled')}
                    </span>
                  )}
                </div>
                <dl className="pp-kv">
                  {i.member && (
                    <>
                      <dt>{t('family.member.accountHere')}</dt>
                      <dd className="pp-account" data-submit={editingAccount === accountKey(i) ? '' : undefined}>
                        {editingAccount === accountKey(i) ? (
                          <input
                            autoFocus
                            autoCapitalize="off"
                            aria-label={`${i.sub.name}\n${t('family.member.account')}`}
                            placeholder={t('family.member.accountPhShort')}
                            value={accountValue(i)}
                            disabled={saving}
                            onChange={(e) => setAccounts((draft) => ({ ...draft, [accountKey(i)]: e.target.value }))}
                            onBlur={() => setEditingAccount(null)}
                            onKeyDown={(e) => {
                              if (sheetSubmitKey(e.nativeEvent) && !popupOpen(e.currentTarget.ownerDocument)) {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditingAccount(null);
                              }
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className="pp-account-value text-ellipsis"
                            disabled={ro || saving || !stored}
                            aria-label={`${i.sub.name}\n${t('family.member.editAccount')}`}
                            title={accountValue(i).trim() || t('family.member.accountEmpty')}
                            onClick={() => setEditingAccount(accountKey(i))}
                          >
                            {accountValue(i).trim() || t('family.member.accountEmpty')}
                          </button>
                        )}
                        {accountValue(i).trim() && editingAccount !== accountKey(i) && (
                          <IconButton
                            aria-label={t('family.member.copyAccount')}
                            title={t('family.member.copyAccount')}
                            onClick={() => void copyText(accountValue(i).trim(), t('detail.copied'))}
                          >
                            <Icon name="copy" size={14} />
                          </IconButton>
                        )}
                      </dd>
                    </>
                  )}
                  {i.kind === 'share' ? (
                    <>
                      <dt>{t('family.member.paidUntil')}</dt>
                      <dd>
                        {i.member?.exempt
                          ? t('family.pool.exempt')
                          : i.periodsOwed > 0
                            ? t('people.item.owedPeriods', { count: i.periodsOwed })
                            : i.paidUntil
                              ? cnDateAuto(i.paidUntil, today)
                              : t('people.item.noPay')}
                      </dd>
                    </>
                  ) : (
                    <>
                      <dt>{t('people.sheet.last')}</dt>
                      <dd>{i.lastPaid ? cnDateAuto(i.lastPaid, today) : t('people.item.noPay')}</dd>
                    </>
                  )}
                  <dt>{t('people.sheet.received')}</dt>
                  <dd className={i.received ? 'green' : 'muted'}>{flow(i.received, base)}</dd>
                </dl>
                {canCollect && (
                  <div className="pp-row pp-actions">
                    <button className={`btn ${i.periodsOwed > 0 ? 'tinted' : ''} pp-collect`} onClick={() => record(i)}>
                      <Icon name="check" /> {t('family.pool.collect')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </Group>

        {stored && (
          <Group title={t('people.sheet.profile')} foot={refs > 1 ? t('people.sheet.syncFoot', { count: refs }) : undefined}>
            <Cell label={t('family.member.name')}>
              <input value={f.name} disabled={ro} placeholder={t('family.member.namePh')} onChange={(e) => up({ name: val(e) })} />
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
              <input value={f.note ?? ''} disabled={ro} placeholder={t('people.sheet.notePh')} onChange={(e) => up({ note: val(e) || undefined })} />
            </Cell>
            <Cell label={t(f.avatar ? 'people.avatar.fallbackColor' : 'people.sheet.color')}>
              <span className="pp-colors" role="radiogroup" aria-label={t('people.sheet.color')}>
                {PERSON_COLORS.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={(f.color ?? colorFor(f.id)) === c}
                    aria-label={`${t('people.sheet.color')} ${i + 1}`}
                    className={`pp-dot c-${c} ${(f.color ?? colorFor(f.id)) === c ? 'on' : ''}`}
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
                onChange={async (into) => {
                  const target = others.find((p) => p.id === into);
                  if (!target || !(await ask(t('people.sheet.mergeConfirm', { from: stored.name, into: target.name })))) return;
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
        <MemberDialog
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
