import { useMemberForm, refundInvalid } from './member/useMemberForm.ts';
import { FirstReceiptFields, PeriodPop } from './member/Receipts.tsx';

import { PersonAvatar, personFor } from '../components/PersonAvatar.tsx';
import { useState } from 'react';
import { calendarSpan, collectionAnchor } from '../../../shared/billing.ts';
import { cnDate, cnDateFull, money } from '../../../shared/format.ts';
import type { AppState, Person, ShareMember, Subscription } from '../../../shared/types.ts';
import { isSettled, type LedgerPeriod } from '../../../shared/receivables.ts';
import { PeriodStrip } from './Receivable.tsx';
import { DatePicker } from '../components/DatePicker.tsx';
import { IconButton, Cell, Group } from '../components/ui.tsx';
import { ask, Sheet } from '../components/overlays.tsx';
import { Icon } from '../components/icons.tsx';
import { NumInput, Seg } from '../components/inputs.tsx';
import { getState, saveSub } from '../store.ts';
import { run } from '../toast.ts';

import { PersonProfileSheet } from './PersonProfile.tsx';
import { suggestedLeaveRefund, updateMemberLeave } from '../../../shared/carpool.ts';
import { CurrencySelect, Picker } from '../components/Picker.tsx';
import { t } from '../../../shared/i18n.ts';
import { ContactField, contactText } from '../components/Contact.tsx';
import { perBill } from './member-fields.tsx';
import { FeeRuleFields } from './member-fields.tsx';

import { ReceiptForm } from './MemberReceipt.tsx';

/**
 * 成员的称呼：没关联人员时是输入框，打字时下面联想名册里的人，选中即关联；不选就按输入的称呼新建。
 * 已关联时显示成头像加名字的胶囊，× 解除关联、可以重新输入或换人
 */
export function PersonNameField({
  state,
  name,
  linked,
  autoFocus,
  onType,
  onPick,
}: {
  state: AppState;
  name: string;
  linked: boolean;
  autoFocus?: boolean;
  onType: (name: string) => void;
  onPick: (p: Person | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  if (linked)
    return (
      <span className="pn-chip">
        <b className="text-ellipsis">{name}</b>
        <IconButton aria-label={t('family.member.unlinkPerson')} title={t('family.member.unlinkPerson')} onClick={() => onPick(undefined)}>
          <Icon name="x" size={12} />
        </IconButton>
      </span>
    );
  const q = name.trim().toLowerCase();
  const people = (state.people ?? [])
    .filter((p) => !q || p.name.toLowerCase().includes(q) || contactText(p).toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 6);
  const show = open && people.length > 0;
  return (
    <span className="pn-field">
      <input
        value={name}
        autoFocus={autoFocus}
        placeholder={t(people.length || !q ? 'family.member.namePickPh' : 'family.member.namePh')}
        onChange={(e) => {
          onType(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === 'ArrowDown') setHi((i) => Math.min(people.length - 1, i + 1));
          else if (e.key === 'ArrowUp') setHi((i) => Math.max(0, i - 1));
          else if (e.key === 'Enter') onPick(people[hi]);
          else if (e.key === 'Escape') setOpen(false);
          else return;
          // 只操作联想框，不让 Esc、回车冒泡去关弹窗或提交
          e.preventDefault();
          e.stopPropagation();
        }}
      />
      {show && (
        <div className="ed-suggest pn-suggest" role="listbox">
          <div className="ed-suggest-h">{t('family.member.pickPerson')}</div>
          {people.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={`hit ${i === hi ? 'hi' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setHi(i)}
              onClick={() => onPick(p)}
            >
              <PersonAvatar p={p} size={24} />
              <span style={{ minWidth: 0 }}>
                <b>{p.name}</b>
                {contactText(p) && <small>{contactText(p)}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * 成员表单（新增与编辑同一个）：是谁 → 座位 → 收费 → 收款。
 * 人员本身的称呼、联系方式属于人员，已关联时在人员详情里改；这里是「这个人在这辆车上的座位」。
 * 新增时可以顺手记首笔收款，大部分情况一次填完。
 */
export function MemberForm({
  memberDialog,
  state,
  s,
  member,
  initialReceipt,
  onOpenSub,
  onClose,
}: {
  memberDialog: typeof import('./Members.tsx').MemberSheet;
  state: AppState;
  s: Subscription;
  member?: ShareMember;
  /** 打开时就叠上的收款表单（见 MemberSheet） */
  initialReceipt?: { edit?: string; preset?: string[] } | null;
  /** 收款表单顶部「查看详情」 */
  onOpenSub?: () => void;
  onClose: () => void;
}) {
  const context = useMemberForm({ memberDialog, state, s, member, initialReceipt, onClose });
  // 已有成员：资料、座位、收费收在「编辑资料」里，默认收起；不分摊的成员没有收款可看，直接展开
  const [seatFeeOpen, setSeatFeeOpen] = useState(() => !!member?.exempt);
  const [cell, setCell] = useState<{ period: LedgerPeriod; anchor: HTMLElement } | null>(null);
  const {
    today,
    isNew,
    once,
    f,
    setF,
    up,
    via,
    setVia,
    setContact,
    val,
    rule,
    mode,
    setMode,
    fee,
    setFee,
    feeFrom,
    setFeeFrom,
    rateChanged,
    openingEdit,
    setOpeningEdit,
    next,
    ledger,
    firstPay,
    payInvalid,
    first,
    linked,
    profile,
    setProfile,
    st,
    receipt,
    setReceipt,
    adjustPaid,
    setAdjustPaid,
    paidUntil,
    busy,
    submit,
    save,
  } = context;
  // 加入时长：从加入日期算到退出日期（还在合租就到今天），几年几个月几天
  const joinedOn = f.joined ?? s.share?.since ?? s.start;
  const span = calendarSpan(joinedOn, f.left && f.left < today ? f.left : today);
  const tenure =
    joinedOn <= today
      ? [
          span.years && t('detail.stats.years', { count: span.years }),
          span.months && t('detail.stats.months', { count: span.months }),
          (span.days || (!span.years && !span.months)) && t('detail.stats.days', { count: span.days }),
        ]
          .filter(Boolean)
          .join(' ')
      : undefined;
  // 是谁：新增和已有成员都放最前面
  const whoGroup = (
    <>
      {/* 一、是谁：新建或从人员里选；已关联的人只读，资料在人员详情里改 */}
      <Group
        title={t('family.member.group')}
        action={
          linked ? (
            <button type="button" className="btn plain" onClick={() => setProfile(true)}>
              {t('people.field.editProfile')}
            </button>
          ) : undefined
        }
      >
        {/* 称呼与人员合在一个输入框：打字时联想已有的人，选中就带出联系方式（和唯一用过的账号）；不选就是新建 */}
        <Cell
          label={
            <span className="row">
              <PersonAvatar p={personFor(state, f.personId, f.name)} size={28} />
              {t('family.member.name')}
            </span>
          }
        >
          <PersonNameField
            state={state}
            name={f.name}
            linked={linked}
            autoFocus={isNew}
            onType={(name) => up({ name })}
            onPick={(p) => {
              if (!p) return up({ personId: undefined, name: '', contactVia: undefined, contact: undefined, tg: undefined });
              // 这个人在别的车上只用过一个账号时一起带出来，可以再改
              const used = [
                ...new Set(
                  state.subscriptions
                    .flatMap((x) => x.share?.members ?? [])
                    .filter((m) => m.personId === p.id && m.account)
                    .map((m) => m.account!),
                ),
              ];
              up({
                personId: p.id,
                name: p.name,
                contactVia: p.contactVia,
                contact: p.contact,
                tg: undefined,
                ...(!f.account && used.length === 1 ? { account: used[0] } : {}),
              });
            }}
          />
        </Cell>
        <Cell label={t('family.member.contact')}>
          {linked ? (
            <span className="muted">{contactText(f) || t('people.field.noContact')}</span>
          ) : (
            <ContactField via={via} value={f.contact} onVia={setVia} onChange={setContact} />
          )}
        </Cell>
        {/* 账号属于这个座位（同一个人在不同车上可能不同），但添加时和称呼、联系方式一起填，所以放在这里 */}
        <Cell label={t('family.member.accountHere')}>
          <input autoCapitalize="off" value={f.account ?? ''} placeholder={t('family.member.accountPhShort')} onChange={(e) => up({ account: val(e) })} />
        </Cell>
      </Group>
    </>
  );
  // 座位、收费：建成员时就定好，之后很少改；已有成员默认收起，标题下一行摘要
  const seatFeeGroups = (
    <>
      {/* 二、座位：哪天上车、首期怎么算、哪天下车 */}
      <Group title={t('family.member.seatGroup')}>
        <Cell label={t('family.member.joined')}>
          <DatePicker
            value={f.joined}
            clearable
            placeholder={s.share?.since ? t('family.member.joinedPh', { date: cnDateFull(s.share.since) }) : t('family.member.notSet')}
            onChange={(v) => up({ joined: v })}
          />
        </Cell>
        {!isNew && tenure && (
          <Cell label={t('family.member.tenure')}>
            <span className="muted">{tenure}</span>
          </Cell>
        )}
        {first.partial && mode !== 'exempt' && !ledger.periods.some((p) => p.key === first.from && p.status === 'paid') && (
          <>
            {/* 首期起止写在「首期方式」标签下面；折算出的金额是首期金额的占位，不再单独一行提示 */}
            <Cell label={t('family.member.firstPeriod')} sub={`${cnDate(first.from)} – ${cnDate(first.until)}`}>
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
        <Cell label={t('family.member.source')}>
          <input value={f.source ?? ''} placeholder={t('family.member.sourcePh')} onChange={(e) => up({ source: val(e) || undefined })} />
        </Cell>
        {!isNew && <MemberLeaveFields state={state} s={s} member={f} onChange={up} />}
      </Group>

      {/* 三、收费：跟随车 / 自定义 / 不分摊；已有成员改了才问从哪天生效 */}
      <Group title={t('family.member.feeGroup')} foot={rateChanged ? t('family.collect.feeHelp') : undefined}>
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
          <FeeRuleFields
            value={{ billEvery: fee.billEvery, fee: fee.amount, currency: fee.currency }}
            onChange={(r) => setFee({ billEvery: r.billEvery, amount: r.fee, currency: r.currency })}
          />
        )}
        {rateChanged && (
          <Cell label={t('family.collect.feeFrom')}>
            <DatePicker value={feeFrom} onChange={(v) => v && setFeeFrom(v)} />
          </Cell>
        )}
        {/* 调价记录：今天生效的那条就是上面的「收费」，不再重复列出 */}
        {(member?.feeHistory ?? [])
          .filter((point, i, all) => !(point.from <= today && !all.slice(i + 1).some((x) => x.from <= today)))
          .map((point) => (
            <Cell key={point.from} label={cnDateFull(point.from)}>
              <span className="muted">{perBill('family.pool.perFee', point.billEvery, { fee: money(point.fee, point.currency) })}</span>
            </Cell>
          ))}
      </Group>
    </>
  );
  return (
    <Sheet
      narrow
      title={isNew ? t('family.member.titleNew', { name: s.name }) : s.name}
      onClose={onClose}
      foot={
        <>
          {!isNew && (
            <button
              className="btn plain"
              style={{ color: 'var(--red)' }}
              disabled={busy}
              onClick={async () =>
                (await ask(t('family.member.confirmDelete', { name: f.name || t('family.member.unnamed') }))) &&
                submit(() =>
                  run(async () => {
                    const current = getState().subscriptions.find((x) => x.id === s.id) ?? s;
                    await saveSub({
                      ...current,
                      share: { ...current.share!, collectFrom: collectionAnchor(current), members: current.share!.members.filter((x) => x.id !== f.id) },
                    });
                    onClose();
                  }, t('family.member.deleted')),
                )
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
            disabled={busy || !f.name.trim() || refundInvalid(s, next) || (isNew && firstPay && payInvalid)}
            onClick={() => void submit(save)}
          >
            {isNew ? t('family.member.add') : t('family.member.save')}
          </button>
        </>
      }
    >
      <div className="stack">
        {isNew ? (
          <>
            {whoGroup}
            {seatFeeGroups}
            {mode !== 'exempt' && <FirstReceiptFields context={context} />}
          </>
        ) : (
          <>
            {/* 一、是谁 */}
            {whoGroup}
            {/* 二、收款：一格一期，点已收的格子看明细；已付至和记一笔跟在下面；欠款默认勾欠的期，结清了默认勾下一期（预收） */}
            {mode !== 'exempt' && (
              <Group
                title={t('receivable.modeReceipt')}
                foot={
                  [
                    st.gone || !st.owe
                      ? once && !st.gone
                        ? t('family.pool.settled')
                        : ''
                      : `${st.late > 0 ? `${t('family.quick.late', { count: st.late })}\n` : ''}${t('family.quick.owe', { amount: st.owed, date: cnDateFull(st.next.from) })}`,
                    adjustPaid ? t('receivable.openingHint') : '',
                    ledger.unmatched.length ? t('receivable.unmatchedNote', { count: ledger.unmatched.length }) : '',
                  ]
                    .filter(Boolean)
                    .join('\n') || undefined
                }
              >
                {!once && (
                  <div className="cell">
                    <PeriodStrip
                      mode="months"
                      periods={ledger.periods}
                      today={today}
                      onPick={(p, anchor) => (p.receipt || p.waiver ? setCell({ period: p, anchor }) : !isSettled(p) && setReceipt({ preset: [p.key] }))}
                    />
                  </div>
                )}
                {/* 已付至：从第一期起连续结清到哪天；点「调整」改期初已付至 */}
                {!once && (
                  <Cell label={t('family.member.paidUntil')}>
                    {adjustPaid ? (
                      <DatePicker value={openingEdit ?? undefined} clearable placeholder={t('family.pool.noPay')} onChange={setOpeningEdit} />
                    ) : (
                      <>
                        <span className={paidUntil ? '' : 'muted'}>{paidUntil ? cnDateFull(paidUntil) : t('family.pool.noPay')}</span>
                        <button
                          type="button"
                          className="btn plain"
                          onClick={() => {
                            const last = member?.receipts?.find((r) => r.opening)?.periods.at(-1);
                            setOpeningEdit(ledger.periods.find((p) => p.key === last)?.until);
                            setAdjustPaid(true);
                          }}
                        >
                          {t('family.collect.adjustPaid')}
                        </button>
                      </>
                    )}
                  </Cell>
                )}
                {!st.gone && (
                  <button type="button" className="cell tap member-pay-add" onClick={() => setReceipt({})}>
                    <Icon name="plus" /> {t('family.quick.backCollect')}
                  </button>
                )}
              </Group>
            )}
            {/* 三、座位与收费：建成员时定好，之后很少改；平时只读两行，点开才是完整表单 */}
            {seatFeeOpen ? (
              seatFeeGroups
            ) : (
              <Group title={t('family.collect.seatFee')}>
                <Cell label={t('family.member.joined')} onClick={() => setSeatFeeOpen(true)}>
                  {cnDateFull(joinedOn)}
                </Cell>
                {tenure && (
                  <Cell label={t('family.member.tenure')} onClick={() => setSeatFeeOpen(true)}>
                    {tenure}
                  </Cell>
                )}
                {f.left && (
                  <Cell label={t('family.member.left')} onClick={() => setSeatFeeOpen(true)}>
                    {cnDateFull(f.left)}
                  </Cell>
                )}
                <Cell label={t('family.member.feeGroup')} onClick={() => setSeatFeeOpen(true)}>
                  {mode === 'custom'
                    ? perBill('family.pool.perFee', fee.billEvery, { fee: money(fee.amount, fee.currency) })
                    : perBill('family.pool.perFee', rule.billEvery, { fee: money(rule.fee, rule.currency) })}
                </Cell>
              </Group>
            )}
          </>
        )}
      </div>
      {cell && <PeriodPop context={context} period={cell.period} anchor={cell.anchor} onClose={() => setCell(null)} />}
      {/* 记一笔、改某一笔：叠在成员表单上，存完回到这里，成员表单里没保存的修改不丢 */}
      {receipt !== null && member && (
        <ReceiptForm state={state} s={s} member={member} editId={receipt.edit} preset={receipt.preset} onOpenSub={onOpenSub} onDone={() => setReceipt(null)} />
      )}
      {profile && f.personId && (
        <PersonProfileSheet
          memberDialog={memberDialog}
          state={state}
          today={today}
          personId={f.personId}
          onOpen={() => setProfile(false)}
          onClose={() => {
            setProfile(false);
            // 人员资料改过后，把这里的称呼、联系方式副本对齐到最新
            const p = getState().people?.find((x) => x.id === f.personId);
            if (p) setF((c) => ({ ...c, name: p.name, contactVia: p.contactVia, contact: p.contact, tg: undefined }));
          }}
        />
      )}
    </Sheet>
  );
}

/** 下车退款仅记录用户确认的实退；选择退还时才填入建议值。 */

export function MemberLeaveFields({
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
                  <NumInput className="num" ccy={r.currency} value={r.amount} onValue={(n) => onChange({ leaveRefund: { ...r, amount: n ?? 0 } })} />
                  <CurrencySelect value={r.currency} onChange={(currency) => onChange({ leaveRefund: { ...r, currency } })} />
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
