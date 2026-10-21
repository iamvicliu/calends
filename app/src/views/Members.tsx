import { useState } from 'react';
import { addDays, addMonths, todayIn, uid, memberUnpaidFrom } from '../../../shared/billing.ts';
import { toBaseAt } from '../../../shared/fx.ts';
import { cnDate, cnDateFull, money } from '../../../shared/format.ts';
import type { AppState, MemberPayment, ShareMember, Subscription } from '../../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { Cell, Group, Icon, Seg, Sheet, Toggle } from '../components/ui.tsx';
import { confirmDelete } from './Editor.tsx';
import { getState, run, savePerson, saveSub } from '../store.ts';
import { linkPerson, PersonPicker } from './People.tsx';
import { refsFor } from '../../../shared/people.ts';
import { carLedger, memberFee, shareFromFee } from '../../../shared/carpool.ts';

export { carLedger, memberFee };
import { CurrencySelect, Picker } from '../components/Picker.tsx';
import { t, type Params } from '../../../shared/i18n.ts';

// 渠道值存进数据里（微信、邮箱等保持中文代码），显示时再翻译
const CONTACT_VIA = ['Telegram', '微信', 'WhatsApp', '邮箱', '手机', 'X', 'Discord', '其他'];
const VIA_KEY: Record<string, string> = { 微信: 'wechat', 邮箱: 'email', 手机: 'phone', 其他: 'other' };
/** 渠道的显示名：Telegram 等专名原样，微信、邮箱等按当前语言 */
export const viaLabel = (via: string): string => (VIA_KEY[via] ? t(`family.contact.via.${VIA_KEY[via]}`) : via);
const CONTACT_HINT: Record<string, string> = { Telegram: '@username', WhatsApp: '+63 …', 邮箱: 'name@example.com', 手机: '+86 …', X: '@handle' };
const contactHint = (via: string): string | undefined =>
  via === '微信' ? t('family.contact.hint.wechat') : via === 'Discord' ? t('family.contact.hint.discord') : CONTACT_HINT[via];

/** 按收费周期选文案：常用周期各有一条，其余走 custom（带 count） */
export const perBill = (key: string, months = 1, params: Params = {}): string =>
  t(`${key}.${[1, 3, 6, 12].includes(months) ? `m${months}` : 'custom'}`, { count: months, ...params });

/** 用户名前面带 @ 的渠道：输入框里固定显示 @，存的时候去掉 */
const AT_VIA = new Set(['Telegram', 'X']);
const bare = (id: string) => id.replace(/^@+/, '');

/** 成员联系方式的一行文字：「Telegram @abc」 */
export function contactText(m: Pick<ShareMember, 'contactVia' | 'contact' | 'tg'>): string {
  const via = m.contactVia ?? (m.tg ? 'Telegram' : '');
  const id = m.contact ?? m.tg;
  if (!id) return '';
  const shown = AT_VIA.has(via) ? `@${bare(id)}` : id;
  return via && via !== '其他' ? `${viaLabel(via)} ${shown}` : shown;
}

/** 联系方式输入：渠道选择 + 账号；Telegram、X 固定显示 @，能直接打开的渠道后面带一个跳转按钮 */
export function ContactField({ via, value, onVia, onChange }: { via: string; value?: string; onVia: (v: string) => void; onChange: (id: string) => void }) {
  const at = AT_VIA.has(via);
  const url = contactUrl(via, value);
  return (
    <span className="contact-field">
      <Picker value={via} onChange={onVia} options={CONTACT_VIA.map((c) => ({ value: c, label: viaLabel(c) }))} ariaLabel={t('family.contact.viaAria')} />
      {at && <span className="contact-at">@</span>}
      <input
        value={at ? bare(value ?? '') : (value ?? '')}
        autoCapitalize="off"
        inputMode={via === '邮箱' ? 'email' : via === '手机' ? 'tel' : 'text'}
        placeholder={at ? bare(contactHint(via) ?? '') : (contactHint(via) ?? t('family.contact.hint.generic'))}
        onChange={(e) => {
          const v = (e.target as HTMLInputElement).value.trim();
          onChange(at ? bare(v) : v);
        }}
      />
      {url && (
        <a
          className="icon-btn contact-go"
          href={url}
          target="_blank"
          rel="noreferrer"
          aria-label={t('family.contact.open', { via: viaLabel(via) })}
          title={t('family.contact.open', { via: viaLabel(via) })}
        >
          <Icon name="link" />
        </a>
      )}
    </span>
  );
}

/** 能直接打开的联系链接：Telegram → t.me，X → x.com，WhatsApp → wa.me，邮箱、手机走系统 */
export function contactUrl(via: string, id?: string): string | undefined {
  if (!id) return undefined;
  if (via === 'Telegram') return `https://t.me/${bare(id)}`;
  if (via === 'X') return `https://x.com/${bare(id)}`;
  if (via === 'WhatsApp') return `https://wa.me/${id.replace(/\D/g, '')}`;
  if (via === '邮箱') return `mailto:${id}`;
  if (via === '手机') return `tel:${id.replace(/[^\d+]/g, '')}`;
  return undefined;
}

/** 覆盖期：给定起始日，按收费周期算出结束日（含） */
const coverEnd = (from: string, months: number) => addDays(addMonths(from, months), -1);

/** 成员资料与收款记录：TG、联系方式、来源、服务账号、收费周期，以及每一笔收款 */
export function MemberSheet({
  state,
  s,
  member,
  collect,
  onClose,
}: {
  state: AppState;
  s: Subscription;
  member?: ShareMember;
  collect?: boolean;
  onClose: () => void;
}) {
  const today = todayIn(state.settings.timezone);
  const isNew = !member;
  // 早期单独记的 Telegram 并入通用的联系方式
  // 收款默认币种：设置里的「合租收款币种」，缺省同本位币
  const base = state.settings.collectCurrency ?? state.settings.baseCurrency;
  const [f, setF] = useState<ShareMember>(() => {
    const init =
      member?.tg && !member.contact
        ? { ...member, contactVia: 'Telegram', contact: member.tg, tg: undefined }
        : (member ?? { id: uid(), name: '', share: Math.round((s.price / Math.max(1, s.share?.seats ?? 1)) * 100) / 100, billEvery: 1 });
    // 老数据只有每期份额：换算成「每次收多少人民币」
    const fee = memberFee(state, s, init);
    return { ...init, fee: fee.amount, feeCurrency: fee.currency };
  });
  const up = (p: Partial<ShareMember>) => setF({ ...f, ...p });
  const via = f.contactVia ?? 'Telegram';
  const setVia = (v: string) => up({ contactVia: v, ...(v === '邮箱' && f.contact && !f.account ? { account: f.contact } : {}) });
  // 联系方式选的是邮箱且还没填受邀邮箱时，顺手填上
  const setContact = (c: string) =>
    up({
      contactVia: via,
      contact: c || undefined,
      tg: undefined,
      ...(via === '邮箱' && (!f.account || f.account === f.contact) ? { account: c || undefined } : {}),
    });
  const val = (e: { target: EventTarget | null }) => (e.target as HTMLInputElement).value;
  const [adding, setAdding] = useState(!!collect);
  const months = f.billEvery ?? 1;
  const freshPay = (m: ShareMember): MemberPayment => {
    const from = memberUnpaidFrom(s, m);
    return { date: today, amount: m.fee ?? 0, currency: m.feeCurrency ?? base, from, until: coverEnd(from, m.billEvery ?? 1) };
  };
  const [pay, setPay] = useState<MemberPayment>(() => freshPay(f));
  // 改收费周期或金额时，份额跟着换算
  const setFee = (p: { fee?: number; feeCurrency?: string; billEvery?: number }) => {
    const next = { ...f, ...p };
    next.share = shareFromFee(state, s, next.fee ?? 0, next.feeCurrency ?? base, next.billEvery ?? 1);
    setF(next);
    if (!adding) setPay(freshPay(next));
  };

  const save = (next: ShareMember, msg: string) => {
    const sh = s.share!;
    const members = sh.members.some((x) => x.id === next.id) ? sh.members.map((x) => (x.id === next.id ? next : x)) : [...sh.members, next];
    return run(async () => {
      await saveSub({ ...s, share: { ...sh, members } });
    }, msg);
  };
  const addPayment = () => {
    const payments = [...(f.payments ?? []), pay].sort((a, b) => a.date.localeCompare(b.date));
    const paidUntil = !f.paidUntil || pay.until > f.paidUntil ? pay.until : f.paidUntil;
    const next = { ...f, payments, paidUntil };
    setF(next);
    setAdding(false);
    if (!isNew) save(next, t('family.member.toastPaid', { name: f.name || t('family.member.defaultName'), amount: money(pay.amount, pay.currency) }));
  };
  const removePayment = (i: number) => {
    const payments = (f.payments ?? []).filter((_, k) => k !== i);
    const next = { ...f, payments, paidUntil: payments.length ? payments.reduce((a, p) => (p.until > a ? p.until : a), payments[0].until) : f.paidUntil };
    setF(next);
    if (!isNew) save(next, t('family.member.paymentRemoved'));
  };

  // 同一笔收款复制给其他成员：大家每期交的一样，不用一个个重填
  const others = (s.share?.members ?? []).filter((x) => x.id !== f.id);
  const [copying, setCopying] = useState<number | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const startCopy = (i: number) => {
    const p = f.payments![i];
    setTargets(others.filter((o) => !o.payments?.some((x) => x.date === p.date && x.until === p.until && x.amount === p.amount)).map((o) => o.id));
    setCopying(i);
  };
  const copyTo = (p: MemberPayment) => {
    const sh = s.share!;
    const members = sh.members.map((m) => {
      if (m.id === f.id) return f;
      if (!targets.includes(m.id)) return m;
      const payments = [...(m.payments ?? []), { ...p }].sort((a, b) => a.date.localeCompare(b.date));
      return { ...m, payments, paidUntil: !m.paidUntil || p.until > m.paidUntil ? p.until : m.paidUntil };
    });
    run(
      async () => {
        await saveSub({ ...s, share: { ...sh, members } });
        setCopying(null);
      },
      t('family.member.copied', { count: targets.length }),
    );
  };

  // 同一个人还出现在别的合租、代付里：改称呼或联系方式会一起改
  const linkedElsewhere = f.personId
    ? refsFor(state.subscriptions, f.personId).filter((r) => !(r.kind === 'member' && r.sub.id === s.id && r.member.id === f.id)).length
    : 0;
  const payments = (f.payments ?? []).slice().reverse();
  const received = (f.payments ?? []).reduce((a, p) => a + toBaseAt(state, p.amount, p.currency, p.date, base), 0);

  return (
    <Sheet
      narrow
      title={isNew ? t('family.member.titleNew', { name: s.name }) : f.name || t('family.member.group')}
      onClose={onClose}
      foot={
        <>
          {!isNew && (
            <button
              className="btn plain"
              style={{ color: 'var(--red)' }}
              onClick={() =>
                confirmDelete(t('family.member.confirmDelete', { name: f.name || t('family.member.unnamed') })) &&
                run(async () => {
                  await saveSub({ ...s, share: { ...s.share!, members: s.share!.members.filter((x) => x.id !== f.id) } });
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
          <button
            className="btn primary"
            disabled={!f.name.trim()}
            onClick={() =>
              run(
                async () => {
                  // 新的人先建档；已有的人改了称呼或联系方式，订阅保存后再同步到他的其他合租、代付
                  const link = await linkPerson(state, f.personId, f.name, f.contact ? via : undefined, f.contact);
                  const next = { ...f, name: f.name.trim(), personId: link.id };
                  const sh = getState().subscriptions.find((x) => x.id === s.id)?.share ?? s.share!;
                  await saveSub({
                    ...s,
                    share: {
                      ...sh,
                      members: sh.members.some((x) => x.id === next.id) ? sh.members.map((x) => (x.id === next.id ? next : x)) : [...sh.members, next],
                    },
                  });
                  if (link.after) await savePerson(link.after);
                  onClose();
                },
                isNew ? t('family.member.added') : t('family.member.saved'),
              )
            }
          >
            {isNew ? t('family.member.add') : t('family.member.save')}
          </button>
        </>
      }
    >
      <div className="stack">
        <Group title={t('family.member.group')} foot={linkedElsewhere > 0 ? t('people.field.syncFoot', { count: linkedElsewhere }) : undefined}>
          {(state.people?.length ?? 0) > 0 && (
            <Cell label={t('people.field.person')}>
              <PersonPicker
                state={state}
                value={f.personId}
                onPick={(p) =>
                  p
                    ? up({ personId: p.id, name: p.name, contactVia: p.contactVia, contact: p.contact, tg: undefined })
                    : f.personId && up({ personId: undefined, name: '', contact: undefined, tg: undefined })
                }
              />
            </Cell>
          )}
          <Cell label={t('family.member.name')}>
            <input value={f.name} autoFocus={isNew} placeholder={t('family.member.namePh')} onChange={(e) => up({ name: val(e) })} />
          </Cell>
          <Cell label={t('family.member.contact')}>
            <ContactField via={via} value={f.contact} onVia={setVia} onChange={setContact} />
          </Cell>
          <Cell label={t('family.member.account')}>
            <input
              inputMode="email"
              autoCapitalize="off"
              value={f.account ?? ''}
              placeholder={t('family.member.accountPh', { name: s.name })}
              onChange={(e) => up({ account: val(e).trim() || undefined })}
            />
          </Cell>
          <Cell label={t('family.member.joined')}>
            <DatePicker
              value={f.joined}
              clearable
              placeholder={s.share?.since ? t('family.member.joinedPh', { date: s.share.since }) : t('family.member.notSet')}
              onChange={(v) => up({ joined: v })}
            />
          </Cell>
          <Cell label={t('family.member.left')}>
            <DatePicker value={f.left} clearable placeholder={t('family.member.leftPh')} onChange={(v) => up({ left: v })} />
          </Cell>
        </Group>

        <Group title={t('family.member.feeGroup')}>
          <div className="cell">
            <Seg
              value={String(months)}
              onChange={(v) => setFee({ billEvery: Number(v) })}
              options={[
                ['1', t('family.member.seg.m1')],
                ['3', t('family.member.seg.m3')],
                ['6', t('family.member.seg.m6')],
                ['12', t('family.member.seg.m12')],
              ]}
            />
          </div>
          <Cell label={perBill('family.member.feeLabel', months)}>
            <span className="contact-field">
              <CurrencySelect value={f.feeCurrency ?? base} onChange={(c) => setFee({ feeCurrency: c })} ariaLabel={t('family.member.feeCcyAria')} />
              <input className="num" inputMode="decimal" value={f.fee ?? ''} placeholder="0" onChange={(e) => setFee({ fee: Number(val(e)) || 0 })} />
            </span>
          </Cell>
          <Cell label={<span>{t('family.member.exempt')}</span>}>
            <Toggle checked={!!f.exempt} onChange={(v) => up({ exempt: v || undefined })} />
          </Cell>
        </Group>

        <Group title={t('family.member.other')}>
          <Cell label={t('family.member.source')}>
            <input value={f.source ?? ''} placeholder={t('family.member.sourcePh')} onChange={(e) => up({ source: val(e) || undefined })} />
          </Cell>
        </Group>

        <Group
          title={t('family.member.payments', { count: (f.payments ?? []).length })}
          foot={received ? t('family.member.receivedTotal', { amount: money(received, base) }) : undefined}
        >
          <Cell label={t('family.member.paidUntil')}>
            <DatePicker value={f.paidUntil} clearable placeholder={t('family.member.paidUntilPh')} onChange={(v) => up({ paidUntil: v })} />
          </Cell>
          {payments.map((p) => {
            const i = (f.payments ?? []).indexOf(p);
            return (
              <div key={`${p.date}-${i}`} className="cell member-pay">
                <span className="cell-l">
                  {money(p.amount, p.currency)}
                  <small>
                    {p.from
                      ? t('family.member.payCover', { date: cnDateFull(p.date), from: cnDate(p.from), until: cnDate(p.until) })
                      : t('family.member.payCoverTo', { date: cnDateFull(p.date), until: cnDate(p.until) })}
                    {p.note ? ` · ${p.note}` : ''}
                  </small>
                </span>
                <span className="cell-r">
                  {others.length > 0 && (
                    <button
                      className={`icon-btn ${copying === i ? 'on' : ''}`}
                      style={{ width: 26, height: 26 }}
                      aria-label={t('family.member.copyAria')}
                      title={t('family.member.copyAria')}
                      onClick={() => (copying === i ? setCopying(null) : startCopy(i))}
                    >
                      <Icon name="copy" />
                    </button>
                  )}
                  <button className="icon-btn" style={{ width: 26, height: 26 }} aria-label={t('family.member.removePayAria')} onClick={() => removePayment(i)}>
                    <Icon name="x" />
                  </button>
                </span>
                {copying === i && (
                  <div className="copy-pay">
                    {others.map((o) => {
                      const dup = o.payments?.some((x) => x.date === p.date && x.until === p.until && x.amount === p.amount);
                      return (
                        <label key={o.id} className={`copy-target ${dup ? 'dup' : ''}`}>
                          <input
                            type="checkbox"
                            disabled={dup}
                            checked={!dup && targets.includes(o.id)}
                            onChange={(e) => setTargets((e.target as HTMLInputElement).checked ? [...targets, o.id] : targets.filter((x) => x !== o.id))}
                          />
                          <span>{o.name || t('family.member.unnamed')}</span>
                          <small>
                            {dup
                              ? t('family.member.dup')
                              : o.paidUntil
                                ? t('family.member.paidUntilDate', { date: cnDate(o.paidUntil) })
                                : t('family.member.noPay')}
                          </small>
                        </label>
                      );
                    })}
                    <div className="copy-actions">
                      <button className="btn" onClick={() => setCopying(null)}>
                        {t('family.member.cancel')}
                      </button>
                      <button className="btn primary" disabled={!targets.length} onClick={() => copyTo(p)}>
                        {t('family.member.copyN', { count: targets.length })}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {adding ? (
            <>
              <Cell label={t('family.member.amount')}>
                <input className="num" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: Number(val(e)) || 0 })} />
              </Cell>
              <Cell label={t('family.member.currency')}>
                <CurrencySelect value={pay.currency} onChange={(c) => setPay({ ...pay, currency: c })} />
              </Cell>
              <Cell label={t('family.member.coverFrom')}>
                <DatePicker value={pay.from} onChange={(v) => v && setPay({ ...pay, from: v, until: coverEnd(v, months) })} />
              </Cell>
              <Cell
                label={
                  <span>
                    {t('family.member.coverTo')}
                    <small className="muted" style={{ display: 'block', fontSize: 12 }}>
                      {perBill('family.member.coverAuto', months)}
                    </small>
                  </span>
                }
              >
                <DatePicker value={pay.until} onChange={(v) => setPay({ ...pay, until: v ?? pay.until })} />
              </Cell>
              <Cell label={t('family.member.receivedOn')}>
                <DatePicker value={pay.date} onChange={(v) => setPay({ ...pay, date: v ?? today })} />
              </Cell>
              <Cell label={t('family.member.note')}>
                <input value={pay.note ?? ''} placeholder={t('family.member.notePh')} onChange={(e) => setPay({ ...pay, note: val(e) || undefined })} />
              </Cell>
              <div className="cell" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn" onClick={() => setAdding(false)}>
                  {t('family.member.cancel')}
                </button>
                <button className="btn primary" disabled={!pay.amount} onClick={addPayment}>
                  {t('family.member.record')}
                </button>
              </div>
            </>
          ) : (
            <button
              className="cell tap"
              style={{ color: 'var(--accent)' }}
              onClick={() => {
                setPay(freshPay(f));
                setAdding(true);
              }}
            >
              <Icon name="plus" /> {perBill('family.member.recordBtn', months, { fee: money(f.fee ?? 0, f.feeCurrency ?? base) })}
            </button>
          )}
        </Group>
      </div>
    </Sheet>
  );
}
