import { copyParts } from '../components/copy.tsx';
import { PersonAvatar, personFor } from '../components/PersonAvatar.tsx';
import { useRef, useState } from 'react';
import {
  addDays,
  addMonths,
  cycleLabel,
  nextCharge,
  todayIn,
  uid,
  memberUnpaidFrom,
  memberBillMonths,
  memberCollection,
  memberDues,
  collectionAnchor,
  diffDays,
} from '../../../shared/billing.ts';
import { flow, cnDate, cnDateFull, money } from '../../../shared/format.ts';
import type { AppState, MemberPayment, ShareMember, Subscription } from '../../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { IconButton, ask, Cell, Group, Icon, NumInput, Seg, Sheet, SubIcon, Toggle } from '../components/ui.tsx';
import { getState, run, savePerson, saveSub } from '../store.ts';
import { linkPerson, PersonPicker } from './People.tsx';
import { refsFor } from '../../../shared/people.ts';
import {
  carLedger,
  carRule,
  followCarRule,
  followsCar,
  memberFee,
  changeMemberFee,
  refreshReceiptDraft,
  shareFromFee,
  suggestedLeaveRefund,
  updateMemberLeave,
  memberCashFlows,
  memberFlowValue,
} from '../../../shared/carpool.ts';

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
/** 只要联系方式本身（如 @name、手机号），不带「Telegram」「微信」等渠道名；列表里用 */
export function contactValue(m: Pick<ShareMember, 'contactVia' | 'contact' | 'tg'>): string {
  const via = m.contactVia ?? (m.tg ? 'Telegram' : '');
  const id = m.contact ?? m.tg;
  if (!id) return '';
  return AT_VIA.has(via) ? `@${bare(id)}` : id;
}

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

/** 成员资料与收款记录：TG、联系方式、来源、服务账号、收费周期，以及每一笔收款 */
export function MemberSheet({
  state,
  s,
  member,
  collect,
  editPay,
  onClose,
  onOpenSub,
}: {
  state: AppState;
  s: Subscription;
  member?: ShareMember;
  collect?: boolean;
  /** 从收款表点某一笔进来：直接打开这笔收款的编辑表单 */
  editPay?: MemberPayment;
  onClose: () => void;
  /** 记收款弹窗顶部「查看详情」：打开这条订阅的详情 */
  onOpenSub?: () => void;
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
        : (member ??
          (() => {
            // 新成员默认跟随车的收款规则
            const r = carRule(state, s, today);
            return {
              id: uid(),
              name: '',
              share: shareFromFee(state, s, r.fee, r.currency, r.billEvery),
              fee: r.fee,
              feeCurrency: r.currency,
              billEvery: r.billEvery,
              joined: today,
            };
          })());
    // 老数据只有每期份额：换算成「每次收多少人民币」
    const fee = memberFee(state, s, init, today);
    return { ...init, fee: fee.amount, feeCurrency: fee.currency };
  });
  const up = (p: Partial<ShareMember>) => {
    const next = updateMemberLeave(f, p);
    setF(next);
    if (adding && ['joined', 'left', 'firstPeriod', 'firstAmount', 'paidUntil'].some((key) => key in p))
      setPay((draft) => refreshReceiptDraft(draft, freshPay(next), payMoneyEdited));
  };
  const via = f.contactVia ?? 'Telegram';
  const setVia = (v: string) => up({ contactVia: v });
  const setContact = (c: string) => up({ contactVia: via, contact: c || undefined, tg: undefined });
  const val = (e: { target: EventTarget | null }) => (e.target as HTMLInputElement).value;
  const [adding, setAdding] = useState(!!collect);
  // 从「收款」按钮进来：只显示记一笔收款的小表单，不展开成员资料；需要时再切到完整资料
  const [quick, setQuick] = useState((!!collect || !!editPay) && !isNew);
  // 正在修改的那一笔收款（f.payments 下标）；backToFull 表示从资料页的收款列表进来，保存后回到资料页
  const [editing, setEditing] = useState<number | null>(() => {
    if (!editPay) return null;
    const i = (member?.payments ?? []).findIndex((p) => p.date === editPay.date && p.until === editPay.until && p.amount === editPay.amount);
    return i < 0 ? null : i;
  });
  const [backToFull, setBackToFull] = useState(false);
  const [feeFrom, setFeeFrom] = useState(today);
  // 收费方式：跟随车的规则，或这个人自定义周期与金额（老数据收费与车不一致时视为自定义）
  const rule = carRule(state, s, today);
  const [feeMode, setFeeMode] = useState<'follow' | 'custom'>(() => (!member || followsCar(state, s, member, today) ? 'follow' : 'custom'));
  const [feeBase, setFeeBase] = useState<ShareMember | null>(null);
  const feeSection = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const months = memberBillMonths(s, f, feeFrom);
  const editFee = memberFee(state, s, f, feeFrom);
  const freshPay = (m: ShareMember, from = memberUnpaidFrom(s, m)): MemberPayment => {
    const period = memberCollection(s, m, from, base);
    return { date: today, amount: period.amount, currency: period.currency, from, until: period.until };
  };
  const [pay, setPay] = useState<MemberPayment>(() => (editing != null ? { ...f.payments![editing] } : freshPay(f)));
  const [payMoneyEdited, setPayMoneyEdited] = useState(false);
  const first = memberCollection(s, f, f.joined ?? s.share?.since ?? s.start, base);
  // 改收费周期或金额时，份额跟着换算
  const setFee = (p: { fee?: number; feeCurrency?: string; billEvery?: number }, from = feeFrom) => {
    const original = feeBase ?? f;
    setFeeBase(original);
    const next = changeMemberFee(
      state,
      s,
      { ...f, fee: original.fee, feeCurrency: original.feeCurrency, billEvery: original.billEvery, feeHistory: original.feeHistory, share: original.share },
      {
        from: isNew ? (f.joined ?? today) : from,
        fee: p.fee ?? editFee.amount,
        currency: p.feeCurrency ?? editFee.currency,
        billEvery: p.billEvery ?? months,
      },
      today,
    );
    setF(next);
    setPay((draft) => refreshReceiptDraft(draft, freshPay(next, draft.from), payMoneyEdited));
  };

  const save = (next: ShareMember, msg: string) => {
    const current = getState().subscriptions.find((x) => x.id === s.id) ?? s;
    const sh = current.share!;
    const members = sh.members.some((x) => x.id === next.id) ? sh.members.map((x) => (x.id === next.id ? next : x)) : [...sh.members, next];
    return run(async () => {
      await saveSub({ ...current, share: { ...sh, collectFrom: collectionAnchor(s), members } });
      setF(next);
      setAdding(false);
      if (quick) onClose();
    }, msg);
  };
  const addPayment = async () => {
    if (saving) return;
    const payments = [...(f.payments ?? []), pay].sort((a, b) => a.date.localeCompare(b.date));
    const paidUntil = !f.paidUntil || pay.until > f.paidUntil ? pay.until : f.paidUntil;
    const next = { ...f, payments, paidUntil };
    if (isNew) {
      setF(next);
      setAdding(false);
      return;
    }
    setSaving(true);
    try {
      await save(next, t('family.member.toastPaid', { name: f.name || t('family.member.defaultName'), amount: flow(pay.amount, pay.currency) }));
    } finally {
      setSaving(false);
    }
  };
  // 修改一笔收款：替换原记录，已付至按全部记录重算（单独填过更晚的已付至仍保留）
  const updatePayment = async (i: number) => {
    if (saving) return;
    const old = f.payments ?? [];
    const recordedUntil = old.reduce((a, p) => (p.until > a ? p.until : a), '');
    const knownUntil = f.paidUntil && f.paidUntil > recordedUntil ? f.paidUntil : '';
    const payments = old.map((p, k) => (k === i ? pay : p)).sort((a, b) => a.date.localeCompare(b.date));
    const paidUntil = payments.reduce((a, p) => (p.until > a ? p.until : a), knownUntil) || undefined;
    const next = { ...f, payments, paidUntil };
    const current = getState().subscriptions.find((x) => x.id === s.id) ?? s;
    const sh = current.share!;
    setSaving(true);
    try {
      await run(async () => {
        await saveSub({ ...current, share: { ...sh, collectFrom: collectionAnchor(s), members: sh.members.map((x) => (x.id === next.id ? next : x)) } });
        setF(next);
        leaveEdit();
      }, t('family.member.toastPayEdited'));
    } finally {
      setSaving(false);
    }
  };
  const startEdit = (i: number) => {
    setEditing(i);
    setPay({ ...(f.payments ?? [])[i] });
    setBackToFull(true);
    setQuick(true);
  };
  // 离开编辑：从资料页进来的回到资料页，从收款表直达的关掉
  const leaveEdit = () => {
    setEditing(null);
    if (backToFull) {
      setQuick(false);
      setBackToFull(false);
      setPay(freshPay(f));
    } else onClose();
  };
  const removePayment = (i: number) => {
    const payments = (f.payments ?? []).filter((_, k) => k !== i);
    const recordedUntil = (f.payments ?? []).reduce((a, p) => (p.until > a ? p.until : a), '');
    // 单独填过更晚的已付至时，删除较早的补记不能抹掉它。
    const knownUntil = f.paidUntil && f.paidUntil > recordedUntil ? f.paidUntil : '';
    const paidUntil = payments.reduce((a, p) => (p.until > a ? p.until : a), knownUntil) || undefined;
    const next = { ...f, payments, paidUntil };
    setF(next);
    if (!isNew) save(next, t('family.member.paymentRemoved'));
  };

  // 同一笔收款复制给其他成员：大家每期交的一样，不用一个个重填
  const others = (state.subscriptions.find((x) => x.id === s.id)?.share?.members ?? s.share?.members ?? []).filter((x) => x.id !== f.id);
  const [copying, setCopying] = useState<number | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const startCopy = (i: number) => {
    const p = f.payments![i];
    setTargets(others.filter((o) => !o.payments?.some((x) => x.date === p.date && x.until === p.until && x.amount === p.amount)).map((o) => o.id));
    setCopying(i);
  };
  const copyTo = (p: MemberPayment) => {
    const current = getState().subscriptions.find((x) => x.id === s.id) ?? s;
    const sh = current.share!;
    const members = sh.members.map((m) => {
      if (m.id === f.id) return f;
      if (!targets.includes(m.id)) return m;
      const payments = [...(m.payments ?? []), { ...p }].sort((a, b) => a.date.localeCompare(b.date));
      return { ...m, payments, paidUntil: !m.paidUntil || p.until > m.paidUntil ? p.until : m.paidUntil };
    });
    run(
      async () => {
        await saveSub({ ...current, share: { ...sh, collectFrom: collectionAnchor(s), members } });
        setCopying(null);
      },
      t('family.member.copied', { count: targets.length }),
    );
  };

  // 同一个人还出现在别的合租、代付里：改称呼或联系方式会一起改
  const linkedElsewhere = f.personId
    ? refsFor(state.subscriptions, f.personId).filter((r) => !(r.kind === 'member' && r.sub.id === s.id && r.member.id === f.id)).length
    : 0;
  const payments = (f.payments ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));
  const received = memberCashFlows(f).reduce((a, p) => a + memberFlowValue(state, p, base), 0);

  const payInvalid =
    saving ||
    !Number.isFinite(pay.amount) ||
    pay.amount < 0 ||
    !pay.from ||
    pay.until < pay.from ||
    (!!f.left && pay.from >= f.left) ||
    (!!s.end && pay.from > s.end);
  if (quick)
    return (
      <Sheet
        narrow
        title={t(editing != null ? 'family.collect.editTitle' : 'family.collect.title', { name: f.name || t('family.member.defaultName') })}
        onClose={editing != null ? leaveEdit : onClose}
        foot={
          <>
            {editing != null && (
              <button
                className="btn danger"
                style={{ marginRight: 'auto' }}
                onClick={() => {
                  removePayment(editing);
                  leaveEdit();
                }}
              >
                {t('common.delete')}
              </button>
            )}
            <button className="btn" onClick={editing != null ? leaveEdit : onClose}>
              {t('family.member.cancel')}
            </button>
            <button className="btn primary" disabled={payInvalid} onClick={() => (editing != null ? updatePayment(editing) : addPayment())}>
              {editing != null ? t('common.save') : t('family.member.record')}
            </button>
          </>
        }
      >
        <div className="stack">
          {/* 人员与订阅同样是圆角卡片：头像、称呼，下面一行成员账号 */}
          <div className="collect-sub">
            <PersonAvatar p={personFor(state, f.personId, f.name)} size={32} />
            <span className="collect-sub-id">
              <b>{f.name}</b>
              {/* 收款时要核对的是他在这辆车上的成员账号，联系方式在资料里看 */}
              <small className={f.account ? undefined : 'muted'}>
                {f.account ? `${t('family.member.account')} ${f.account}` : t('family.member.accountEmpty')}
              </small>
            </span>
            <button type="button" className="collect-sub-link" onClick={() => setQuick(false)}>
              {t('family.collect.editMember')}
            </button>
          </div>
          {/* 同一个人可能在多辆车上：顶部单独一行标明是哪个订阅 */}
          <div className="collect-sub">
            <SubIcon sub={s} size={32} />
            <span className="collect-sub-id">
              <b>{s.name}</b>
              <small>
                {money(s.price, s.currency)} {cycleLabel(s.cycle)}
                {copyParts(nextCharge(s, today) ? `\n${t('family.pool.next', { date: cnDate(nextCharge(s, today)!) })}` : '')}
              </small>
            </span>
            {onOpenSub && (
              <button type="button" className="collect-sub-link" onClick={onOpenSub}>
                {t('family.collect.viewSub')}
              </button>
            )}
          </div>
          <Group>
            <Cell label={t('family.member.feeGroup')}>
              <span>
                {perBill('family.pool.perFee', memberBillMonths(s, f, pay.from), {
                  fee: money(memberFee(state, s, f, pay.from).amount, memberFee(state, s, f, pay.from).currency),
                })}
              </span>
              <button
                className="btn plain"
                onClick={() => {
                  setQuick(false);
                  requestAnimationFrame(() => feeSection.current?.scrollIntoView({ block: 'start' }));
                }}
              >
                {t('family.collect.changeFee')}
              </button>
            </Cell>
            <Cell label={t('family.member.paidUntil')}>{f.paidUntil ? cnDateFull(f.paidUntil) : t('family.member.notSet')}</Cell>
            <Cell label={t('family.collect.lastPayment')}>
              {copyParts(payments[0] ? `${cnDateFull(payments[0].date)}\n${money(payments[0].amount, payments[0].currency)}` : t('family.pool.noPay'))}
            </Cell>
          </Group>
          <Group
            foot={`${t('family.collect.covers', { from: cnDateFull(pay.from ?? pay.date), until: cnDateFull(pay.until) })}\n${t('family.collect.next', { date: cnDateFull(addDays(pay.until, 1)) })}`}
          >
            <Cell label={t('family.member.receivedOn')}>
              <DatePicker value={pay.date} onChange={(v) => setPay({ ...pay, date: v ?? today })} />
            </Cell>
            <Cell label={t('family.member.amount')}>
              <NumInput
                className="num"
                ccy={pay.currency}
                value={pay.amount}
                onValue={(n) => {
                  setPayMoneyEdited(true);
                  setPay({ ...pay, amount: n ?? 0 });
                }}
              />
            </Cell>
            <Cell label={t('family.member.currency')}>
              <CurrencySelect
                value={pay.currency}
                onChange={(c) => {
                  setPayMoneyEdited(true);
                  setPay({ ...pay, currency: c });
                }}
              />
            </Cell>
            {/* 默认按这个人的收费周期算出；可以改成任意日期，每个人的到期日不必统一 */}
            <Cell label={t('family.collect.until')}>
              <DatePicker value={pay.until} min={pay.from} onChange={(v) => setPay({ ...pay, until: v ?? pay.until })} />
            </Cell>
            <Cell label={t('family.member.note')}>
              <input value={pay.note ?? ''} placeholder={t('family.member.notePh')} onChange={(e) => setPay({ ...pay, note: val(e) || undefined })} />
            </Cell>
          </Group>
        </div>
      </Sheet>
    );

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
              onClick={async () =>
                (await ask(t('family.member.confirmDelete', { name: f.name || t('family.member.unnamed') }))) &&
                run(async () => {
                  await saveSub({ ...s, share: { ...s.share!, collectFrom: collectionAnchor(s), members: s.share!.members.filter((x) => x.id !== f.id) } });
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
            disabled={!f.name.trim() || refundInvalid(s, f)}
            onClick={() =>
              run(
                async () => {
                  // 新的人先建档；已有的人改了称呼或联系方式，订阅保存后再同步到他的其他合租、代付
                  const link = await linkPerson(state, f.personId, f.name, f.contact ? via : undefined, f.contact);
                  const next = {
                    ...f,
                    name: f.name.trim(),
                    account: f.account?.trim() || undefined,
                    personId: link.id,
                    custom: feeMode === 'custom' && !f.exempt ? true : undefined,
                  };
                  const sh = getState().subscriptions.find((x) => x.id === s.id)?.share ?? s.share!;
                  await saveSub({
                    ...s,
                    share: {
                      ...sh,
                      collectFrom: collectionAnchor(s),
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
          <Cell
            label={
              <span className="row">
                <PersonAvatar p={personFor(state, f.personId, f.name)} size={28} />
                {t('family.member.name')}
              </span>
            }
          >
            <input value={f.name} autoFocus={isNew} placeholder={t('family.member.namePh')} onChange={(e) => up({ name: val(e) })} />
          </Cell>
          <Cell label={t('family.member.contact')}>
            <ContactField via={via} value={f.contact} onVia={setVia} onChange={setContact} />
          </Cell>
          <Cell label={t('family.member.account')}>
            <input
              autoCapitalize="off"
              value={f.account ?? ''}
              placeholder={t('family.member.accountPh', { name: s.name })}
              onChange={(e) => up({ account: val(e) })}
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
          {first.partial && !f.exempt && !f.payments?.some((p) => p.from === first.from && p.until >= first.until) && (
            <>
              <div className="cell">
                <small className="muted">
                  {copyParts(
                    t('family.member.firstSummary', {
                      from: cnDate(first.from),
                      until: cnDate(first.until),
                      mode: t(`family.member.firstMode.${f.firstPeriod ?? 'prorate'}`),
                      amount: money(first.amount, first.currency),
                    }),
                  )}
                </small>
              </div>
              <Cell label={t('family.member.firstPeriod')}>
                <Picker
                  value={f.firstPeriod ?? 'prorate'}
                  onChange={(v) => up({ firstPeriod: v as ShareMember['firstPeriod'], firstAmount: undefined })}
                  options={['prorate', 'full', 'free'].map((value) => ({ value, label: t(`family.member.firstMode.${value}`) }))}
                />
              </Cell>
              {f.firstPeriod !== 'free' && (
                <Cell label={t('family.member.firstAmount')}>
                  <NumInput
                    ccy={first.currency}
                    className="num"
                    value={f.firstAmount}
                    placeholder={String(first.amount)}
                    onValue={(n) => up({ firstAmount: n })}
                  />
                </Cell>
              )}
            </>
          )}
          {!isNew && <MemberLeaveFields state={state} s={s} member={f} onChange={up} />}
        </Group>

        <div ref={feeSection} className="member-fee-section">
          <Group title={t(isNew ? 'family.member.feeGroup' : 'family.collect.adjustFee')} foot={t('family.collect.feeHelp')}>
            {!isNew && (
              <Cell label={t('family.collect.feeFrom')}>
                <DatePicker
                  value={feeFrom}
                  onChange={(v) => {
                    if (!v) return;
                    if (feeBase) setFee({}, v);
                    setFeeFrom(v);
                  }}
                />
              </Cell>
            )}
            {!f.exempt && (
              <div className="cell">
                <Seg
                  value={feeMode}
                  onChange={(v) => {
                    setFeeMode(v);
                    if (v === 'follow') {
                      const next = followCarRule(state, s, f, isNew ? (f.joined ?? today) : feeFrom, today);
                      setF(next);
                      setPay((draft) => refreshReceiptDraft(draft, freshPay(next, draft.from), payMoneyEdited));
                    }
                  }}
                  options={[
                    ['follow', t('family.rule.follow')],
                    ['custom', t('family.rule.custom')],
                  ]}
                />
              </div>
            )}
            {feeMode === 'follow' && !f.exempt ? (
              <Cell label={t('family.member.feeGroup')}>
                <span className="muted">
                  {t('family.rule.followValue', { rule: perBill('family.pool.perFee', rule.billEvery, { fee: money(rule.fee, rule.currency) }) })}
                </span>
              </Cell>
            ) : (
              <>
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
                    <CurrencySelect value={editFee.currency} onChange={(c) => setFee({ feeCurrency: c })} ariaLabel={t('family.member.feeCcyAria')} />
                    <NumInput ccy={editFee.currency} className="num" value={editFee.amount} placeholder="0" onValue={(n) => setFee({ fee: n ?? 0 })} />
                  </span>
                </Cell>
              </>
            )}
            <Cell label={<span>{t('family.member.exempt')}</span>}>
              <Toggle checked={!!f.exempt} onChange={(v) => up({ exempt: v || undefined })} />
            </Cell>
            {(f.feeHistory ?? []).map((point) => (
              <Cell key={point.from} label={cnDateFull(point.from)}>
                {perBill('family.pool.perFee', point.billEvery, { fee: money(point.fee, point.currency) })}
              </Cell>
            ))}
          </Group>
        </div>

        <Group title={t('family.member.other')}>
          <Cell label={t('family.member.source')}>
            <input value={f.source ?? ''} placeholder={t('family.member.sourcePh')} onChange={(e) => up({ source: val(e) || undefined })} />
          </Cell>
        </Group>

        <Group
          submit={adding ? '.btn.primary' : undefined}
          title={t('family.member.payments', { count: (f.payments ?? []).length })}
          foot={
            payments.length > 1 || !!f.leaveRefund || (payments[0] && payments[0].currency !== base) ? (
              <span className={received > 0 ? 'green' : undefined}>{t('family.member.receivedTotal', { amount: flow(received, base) })}</span>
            ) : undefined
          }
        >
          <Cell label={t('family.member.paidUntil')}>
            <DatePicker
              value={f.paidUntil}
              clearable
              placeholder={t(f.payments?.length ? 'family.member.notSet' : 'family.member.paidUntilPh')}
              onChange={(v) => up({ paidUntil: v })}
            />
          </Cell>
          {payments.map((p) => {
            const i = (f.payments ?? []).indexOf(p);
            return (
              <div key={`${p.date}-${i}`} className="cell member-pay">
                <button type="button" className="cell-l member-pay-edit" onClick={() => startEdit(i)} aria-label={t('family.member.editPayAria')}>
                  <span className="green">{flow(p.amount, p.currency)}</span>
                  <small>
                    {copyParts(
                      p.from
                        ? t('family.member.payCover', { date: cnDateFull(p.date), from: cnDate(p.from), until: cnDate(p.until) })
                        : t('family.member.payCoverTo', { date: cnDateFull(p.date), until: cnDate(p.until) }),
                    )}
                    {copyParts(p.note ? `\n${p.note}` : '')}
                  </small>
                </button>
                <span className="cell-r">
                  {others.length > 0 && (
                    <IconButton
                      className={`${copying === i ? 'on' : ''}`}

                      aria-label={t('family.member.copyAria')}
                      title={t('family.member.copyAria')}
                      onClick={() => (copying === i ? setCopying(null) : startCopy(i))}
                    >
                      <Icon name="copy" />
                    </IconButton>
                  )}
                  <IconButton aria-label={t('family.member.removePayAria')} onClick={() => removePayment(i)}>
                    <Icon name="x" />
                  </IconButton>
                </span>
                {copying === i && (
                  <div className="copy-pay" data-submit=".btn.primary">
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
                    <div className="sheet-actions">
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
          {f.leaveRefund && (
            <Cell label={t('family.sheet.refund')}>
              <span>
                {cnDateFull(f.leaveRefund.date)}
                {copyParts(f.leaveRefund.note ? `\n${f.leaveRefund.note}` : '')}
              </span>
              <b>{flow(-f.leaveRefund.amount, f.leaveRefund.currency)}</b>
            </Cell>
          )}
          {adding ? (
            <>
              <Cell label={t('family.member.amount')}>
                <NumInput
                  className="num"
                  ccy={pay.currency}
                  value={pay.amount}
                  onValue={(n) => {
                    setPayMoneyEdited(true);
                    setPay({ ...pay, amount: n ?? 0 });
                  }}
                />
              </Cell>
              <Cell label={t('family.member.currency')}>
                <CurrencySelect
                  value={pay.currency}
                  onChange={(c) => {
                    setPayMoneyEdited(true);
                    setPay({ ...pay, currency: c });
                  }}
                />
              </Cell>
              <Cell label={t('family.member.coverFrom')}>
                <DatePicker value={pay.from} onChange={(v) => v && setPay(refreshReceiptDraft(pay, freshPay(f, v), payMoneyEdited))} />
              </Cell>
              <Cell label={t('family.member.coverTo')}>
                <DatePicker value={pay.until} onChange={(v) => setPay({ ...pay, until: v ?? pay.until })} />
              </Cell>
              <Cell label={t('family.member.receivedOn')}>
                <DatePicker value={pay.date} onChange={(v) => setPay({ ...pay, date: v ?? today })} />
              </Cell>
              <Cell label={t('family.member.note')}>
                <input value={pay.note ?? ''} placeholder={t('family.member.notePh')} onChange={(e) => setPay({ ...pay, note: val(e) || undefined })} />
              </Cell>
              <div className="cell sheet-actions">
                <button className="btn" onClick={() => setAdding(false)}>
                  {t('family.member.cancel')}
                </button>
                <button className="btn primary" disabled={payInvalid} onClick={addPayment}>
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
                setPayMoneyEdited(false);
                setAdding(true);
              }}
            >
              <Icon name="plus" /> {copyParts(t('family.member.recordNext', { amount: money(freshPay(f).amount, freshPay(f).currency) }))}
            </button>
          )}
        </Group>
      </div>
    </Sheet>
  );
}

/** 成员一行的收款状态：逾期几天 / 待收 / 已结清，合租表格和收费弹窗共用 */
export function memberStatus(state: AppState, s: Subscription, m: ShareMember, today: string) {
  const collect = state.settings.collectCurrency ?? state.settings.baseCurrency;
  const d = memberDues(s, today, collect, state).find((x) => x.member.id === m.id);
  const next = memberCollection(s, m, memberUnpaidFrom(s, m), collect);
  const owe = !!d && d.periodsOwed > 0;
  // 本期：今天所在的这个人自己的收费期。欠款时从最早未付往后数到今天；已付到将来时是已付的最后一期
  let period = { from: next.from, until: next.until, paid: false };
  if (next.from > today) {
    const joined = m.joined ?? s.share?.since ?? s.start;
    const from = addMonths(next.from, -memberBillMonths(s, m, addDays(next.from, -1)));
    period = { from: from < joined ? joined : from, until: addDays(next.from, -1), paid: true };
  } else
    for (let guard = 0; period.until < today && guard < 600; guard++) {
      const c = memberCollection(s, m, addDays(period.until, 1), collect);
      period = { from: c.from, until: c.until, paid: false };
    }
  return {
    owe,
    period,
    owed: owe ? money(d!.owed, d!.currency) : '',
    late: owe && next.from < today ? diffDays(next.from, today) : 0,
    next,
    gone: !!m.left && next.from >= m.left,
  };
}

/** 成员时间条上的一段：已付的一期、该收没收的一期（到今天为止）、还没到期的下一期 */
export interface MemberSegment {
  from: string;
  until: string;
  kind: 'paid' | 'due' | 'future' | 'unused';
}

/**
 * 成员在时间窗口内的各期：按这个人自己的收费周期切分，已付到哪天、哪几期没收、下一期从哪天起。
 * 已退出的截到退出前一天；不分摊的没有分段。
 */
export function memberSegments(s: Subscription, m: ShareMember, today: string, start: string, end: string): MemberSegment[] {
  if (m.exempt) return [];
  const joined = m.joined ?? s.share?.since ?? s.start;
  const stop = m.left ? addDays(m.left, -1) : end;
  const out: MemberSegment[] = [];
  const push = (from: string, until: string, kind: MemberSegment['kind']) => {
    const a = from < start ? start : from;
    const b = [until, stop, end].sort()[0];
    if (a <= b) out.push({ from: a, until: b, kind });
  };
  // 已付：从加入起按周期切，切到已付至
  if (m.paidUntil) {
    let from = joined;
    for (let guard = 0; guard < 400 && from <= m.paidUntil && from <= end; guard++) {
      const c = memberCollection(s, { ...m, left: undefined }, from);
      push(c.from, c.until < m.paidUntil ? c.until : m.paidUntil, 'paid');
      from = addDays(c.until, 1);
    }
  }
  // 未付：从最早未付起，今天之前开始的算欠收，之后的只画下一期
  let from = memberUnpaidFrom(s, m);
  for (let guard = 0; guard < 400 && from <= end && from <= stop; guard++) {
    const c = memberCollection(s, m, from);
    const due = c.from <= today;
    push(c.from, c.until, due ? 'due' : 'future');
    if (!due) break;
    from = addDays(c.until, 1);
  }
  if (m.left && m.paidUntil && !m.leaveRefund) {
    const from = [m.left, joined, start].sort().at(-1)!;
    const until = m.paidUntil < end ? m.paidUntil : end;
    if (from <= until) out.push({ from, until, kind: 'unused' });
  }
  return out;
}

/** 下车退款仅记录用户确认的实退；选择退还时才填入建议值。 */
function refundInvalid(s: Subscription, m: ShareMember) {
  const r = m.leaveRefund;
  return !!r && (!m.left || !Number.isFinite(r.amount) || r.amount <= 0 || r.date < (m.joined ?? s.share?.since ?? s.start));
}

function MemberLeaveFields({
  state,
  s,
  member: m,
  onChange,
}: {
  state: AppState;
  s: Subscription;
  member: ShareMember;
  onChange: (p: Partial<ShareMember>) => void;
}) {
  const r = m.leaveRefund;
  return (
    <>
      <Cell label={t('family.member.left')}>
        <DatePicker
          value={m.left}
          clearable
          min={m.joined ?? s.share?.since ?? s.start}
          placeholder={t('family.member.leftPh')}
          onChange={(v) => onChange(updateMemberLeave(m, { left: v }))}
        />
      </Cell>
      {m.left && (
        <>
          <Cell label={t('family.refund.title')}>
            <Seg
              value={r ? 'refund' : 'none'}
              onChange={(v) => {
                const suggestion = suggestedLeaveRefund(state, s, m);
                onChange({
                  leaveRefund:
                    v === 'none'
                      ? undefined
                      : { amount: Number.isFinite(suggestion.amount) ? suggestion.amount : 0, currency: suggestion.currency, date: m.left! },
                });
              }}
              options={[
                ['none', t('family.refund.none')],
                ['refund', t('family.refund.unused')],
              ]}
            />
          </Cell>
          {r && (
            <>
              <Cell label={t('family.member.amount')}>
                <span className="contact-field">
                  <CurrencySelect value={r.currency} onChange={(currency) => onChange({ leaveRefund: { ...r, currency } })} />
                  <NumInput className="num" ccy={r.currency} value={r.amount} onValue={(n) => onChange({ leaveRefund: { ...r, amount: n ?? 0 } })} />
                </span>
              </Cell>
              <Cell label={t('family.refund.date')}>
                <DatePicker value={r.date} min={m.joined ?? s.share?.since ?? s.start} onChange={(date) => date && onChange({ leaveRefund: { ...r, date } })} />
              </Cell>
              <Cell label={t('family.member.note')}>
                <input value={r.note ?? ''} onChange={(e) => onChange({ leaveRefund: { ...r, note: e.target.value || undefined } })} />
              </Cell>
            </>
          )}
        </>
      )}
    </>
  );
}

/**
 * 合租表格里点成员打开的收费弹窗：只管跟随车 / 自定义 / 不分摊、收费周期和金额，以及已付到哪一期。
 * 已付期只选开始日，结束日按这个人的收费周期算出；称呼、联系方式、收款明细在「更多资料」里。
 */
export function MemberBillingSheet({
  state,
  s,
  member,
  onClose,
  onMore,
}: {
  state: AppState;
  s: Subscription;
  member: ShareMember;
  onClose: () => void;
  onMore: () => void;
}) {
  const today = todayIn(state.settings.timezone);
  const rule = carRule(state, s, today);
  const [mode, setMode] = useState<'follow' | 'custom' | 'exempt'>(member.exempt ? 'exempt' : followsCar(state, s, member, today) ? 'follow' : 'custom');
  const cur = memberFee(state, s, member, today);
  const [fee, setFeeDraft] = useState({ amount: cur.amount, currency: cur.currency, billEvery: memberBillMonths(s, member, today) });
  const [from, setFrom] = useState(today);
  const [leave, setLeave] = useState(member);
  // 已付期：从已付至倒推这一期的开始日
  const initialPaidFrom = member.paidUntil ? addMonths(addDays(member.paidUntil, 1), -memberBillMonths(s, member, member.paidUntil)) : undefined;
  const [paidFrom, setPaidFrom] = useState(initialPaidFrom);

  const draft = (): ShareMember => {
    let m: ShareMember = { ...member, left: leave.left, leaveRefund: leave.leaveRefund };
    if (mode === 'exempt') m = { ...m, exempt: true, custom: undefined, share: 0 };
    else if (mode === 'follow') m = followCarRule(state, s, { ...m, exempt: undefined }, from, today);
    else {
      const changed = fee.amount !== cur.amount || fee.currency !== cur.currency || fee.billEvery !== memberBillMonths(s, member, today) || member.exempt;
      m = { ...m, exempt: undefined, custom: true };
      if (changed) m = changeMemberFee(state, s, m, { from, fee: fee.amount, currency: fee.currency, billEvery: fee.billEvery }, today);
    }
    const paidUntil = paidFrom === initialPaidFrom ? member.paidUntil : paidFrom ? memberCollection(s, m, paidFrom).until : undefined;
    return { ...m, paidUntil };
  };
  const next = draft();
  const preview = { ...s, share: { ...s.share!, members: s.share!.members.map((x) => (x.id === next.id ? next : x)) } };
  const st = memberStatus(state, preview, next, today);
  const rateChanged =
    mode !== 'exempt' &&
    (mode === 'follow' ? !followsCar(state, s, member, today) : true) &&
    (() => {
      const r = memberFee(state, s, next, from);
      return r.amount !== cur.amount || r.currency !== cur.currency || memberBillMonths(s, next, from) !== memberBillMonths(s, member, today);
    })();

  return (
    <Sheet
      narrow
      title={
        <span className="icon-text">
          <PersonAvatar p={personFor(state, member.personId, member.name)} size={24} />
          {member.name || t('family.pool.unnamed')}
        </span>
      }
      onClose={onClose}
      foot={
        <>
          <button className="btn plain" onClick={onMore}>
            {t('family.quick.more')}
          </button>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            {t('family.member.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={refundInvalid(s, next)}
            onClick={() =>
              run(async () => {
                const current = getState().subscriptions.find((x) => x.id === s.id) ?? s;
                const sh = current.share!;
                await saveSub({
                  ...current,
                  share: { ...sh, collectFrom: collectionAnchor(current), members: sh.members.map((x) => (x.id === next.id ? next : x)) },
                });
                onClose();
              }, t('family.member.saved'))
            }
          >
            {t('family.member.save')}
          </button>
        </>
      }
    >
      <div className="stack">
        <Group title={t('family.sheet.fee')} foot={rateChanged ? t('family.collect.feeHelp') : undefined}>
          <div className="cell">
            <Seg
              value={mode}
              onChange={setMode}
              options={[
                ['follow', t('family.rule.follow')],
                ['custom', t('family.rule.custom')],
                ['exempt', t('family.member.exempt')],
              ]}
            />
          </div>
          {mode === 'follow' && (
            <Cell label={t('family.member.feeGroup')}>
              <span className="muted">{perBill('family.pool.perFee', rule.billEvery, { fee: money(rule.fee, rule.currency) })}</span>
            </Cell>
          )}
          {mode === 'custom' && (
            <>
              <div className="cell">
                <Seg
                  value={String(fee.billEvery)}
                  onChange={(v) => setFeeDraft({ ...fee, billEvery: Number(v) })}
                  options={[
                    ['1', t('family.member.seg.m1')],
                    ['3', t('family.member.seg.m3')],
                    ['6', t('family.member.seg.m6')],
                    ['12', t('family.member.seg.m12')],
                  ]}
                />
              </div>
              <Cell label={perBill('family.member.feeLabel', fee.billEvery)}>
                <span className="contact-field">
                  <CurrencySelect value={fee.currency} onChange={(c) => setFeeDraft({ ...fee, currency: c })} ariaLabel={t('family.member.feeCcyAria')} />
                  <NumInput ccy={fee.currency} className="num" value={fee.amount} placeholder="0" onValue={(n) => setFeeDraft({ ...fee, amount: n ?? 0 })} />
                </span>
              </Cell>
            </>
          )}
          {rateChanged && (
            <Cell label={t('family.collect.feeFrom')}>
              <DatePicker value={from} onChange={(v) => v && setFrom(v)} />
            </Cell>
          )}
        </Group>
        {mode !== 'exempt' && (
          <Group
            title={t('family.quick.paid')}
            foot={
              st.gone
                ? undefined
                : st.owe
                  ? `${st.late > 0 ? `${t('family.quick.late', { count: st.late })}\n` : ''}${t('family.quick.owe', { amount: st.owed, date: cnDateFull(st.next.from) })}`
                  : t('family.quick.settled', { date: cnDateFull(st.next.from) })
            }
          >
            <Cell label={t('family.quick.paidFrom')}>
              <DatePicker value={paidFrom} clearable placeholder={t('family.pool.noPay')} onChange={setPaidFrom} />
            </Cell>
            <Cell label={t('family.quick.paidTo')}>
              <span className={paidFrom ? '' : 'muted'}>{next.paidUntil ? cnDateFull(next.paidUntil) : '—'}</span>
            </Cell>
          </Group>
        )}
        <Group>
          <MemberLeaveFields state={state} s={s} member={next} onChange={(patch) => setLeave(updateMemberLeave(next, patch))} />
        </Group>
      </div>
    </Sheet>
  );
}
