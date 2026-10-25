import { copyParts } from '../components/copy.tsx';
import { PersonAvatar, personFor } from '../components/PersonAvatar.tsx';
import { useState } from 'react';
import {
  addDays,
  addMonths,
  cycleLabel,
  todayIn,
  uid,
  memberUnpaidFrom,
  memberBillMonths,
  memberCollection,
  memberDues,
  memberLedger,
  memberPeriods,
  collectionAnchor,
  diffDays,
  LIFETIME_BILL_MONTHS,
} from '../../../shared/billing.ts';
import { flow, cnDate, cnDateFull, money } from '../../../shared/format.ts';
import type { AppState, CarRule, Person, Receipt, ShareMember, Subscription } from '../../../shared/types.ts';
import { isSettled, paidThrough, putRecord, removeRecord, resolveKey, setOpening, type Receivable } from '../../../shared/receivables.ts';
import { isReceipt, PeriodStrip, ReceivableSheet, recordPeriods } from './Receivable.tsx';
import { DatePicker } from '../components/DatePicker.tsx';
import { IconButton, ask, Cell, Group, Icon, NumInput, Seg, Sheet, Stepper, SubIcon, Toggle, useSubmit } from '../components/ui.tsx';
import { getState, run, savePerson, saveSub } from '../store.ts';
import { linkPerson, PersonProfileSheet } from './People.tsx';
import {
  carLedger,
  periodsTotal,
  carRule,
  followCarRule,
  followsCar,
  memberFee,
  changeMemberFee,
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

/** 按收费周期选文案：常用周期各有一条，买断只收一次（once），其余走 custom（带 count） */
export const perBill = (key: string, months = 1, params: Params = {}): string =>
  t(`${key}.${months >= LIFETIME_BILL_MONTHS ? 'once' : [1, 3, 6, 12].includes(months) ? `m${months}` : 'custom'}`, { count: months, ...params });

/**
 * 收费标准：周期（按月 / 按季 / 半年 / 按年）+ 每期金额与币种。
 * 订阅编辑器的「我发起」、转为合租、车的收费规则、成员的自定义收费共用，四处长得一样
 */
export function FeeRuleFields({ value, onChange }: { value: CarRule; onChange: (r: CarRule) => void }) {
  return (
    <>
      <div className="cell">
        <Seg
          value={String(value.billEvery)}
          onChange={(v) => onChange({ ...value, billEvery: Number(v) })}
          options={[
            ['1', t('family.member.seg.m1')],
            ['3', t('family.member.seg.m3')],
            ['6', t('family.member.seg.m6')],
            ['12', t('family.member.seg.m12')],
          ]}
        />
      </div>
      <Cell label={perBill('family.member.feeLabel', value.billEvery)}>
        <span className="contact-field">
          <NumInput ccy={value.currency} className="num" value={value.fee} placeholder="0" onValue={(n) => onChange({ ...value, fee: n ?? 0 })} />
          <CurrencySelect value={value.currency} onChange={(c) => onChange({ ...value, currency: c })} ariaLabel={t('family.member.feeCcyAria')} />
        </span>
      </Cell>
    </>
  );
}

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

/**
 * 合租成员的统一入口：任何地方点成员、点「收款」、点某一笔收款都打开它。
 * 欠款的成员先到收款表单（应收与实际收款），其余打开成员表单；两者可以互相切换，不再有第三套表单。
 */
export function MemberSheet({
  state,
  s,
  member,
  collect,
  editId,
  onClose,
  onOpenSub,
}: {
  state: AppState;
  s: Subscription;
  member?: ShareMember;
  /** 从「收款」进来：直接记一笔 */
  collect?: boolean;
  /** 从收款表点某一笔进来：直接打开这笔收款（或免收）的编辑 */
  editId?: string;
  onClose: () => void;
  /** 收款表单顶部「查看详情」：打开这条订阅的详情 */
  onOpenSub?: () => void;
}) {
  const today = todayIn(state.settings.timezone);
  // 保存后表单读账本里的最新数据：收款列表、已付至都以它为准
  const live = state.subscriptions.find((x) => x.id === s.id) ?? s;
  const m = member && (live.share?.members.find((x) => x.id === member.id) ?? member);
  const [view, setView] = useState<'member' | 'receipt'>(() => {
    if (!m) return 'member';
    if (editId) return 'receipt';
    const st = memberStatus(state, live, m, today);
    return collect || (!m.exempt && !st.gone && st.owe) ? 'receipt' : 'member';
  });
  if (m && view !== 'member')
    return <ReceiptForm state={state} s={live} member={m} editId={editId} onDone={onClose} onMember={() => setView('member')} onOpenSub={onOpenSub} />;
  return <MemberForm state={state} s={live} member={m} onClose={onClose} />;
}

/** 成员的本期：与订阅详情的本期进度同一套样式，左端本期开始、右端结束，填充到今天；欠款时橙色 */
function MemberPeriod({ from, until, paid, today }: { from: string; until: string; paid: boolean; today: string }) {
  const span = Math.max(1, diffDays(from, addDays(until, 1)));
  const pct = Math.round(Math.min(1, Math.max(0, diffDays(from, today) / span)) * 100);
  return (
    <div className={`dt-period ${paid ? 'paid' : 'due'}`}>
      <p className="dt-period-h">
        <b>{t(paid ? 'family.collect.periodPaid' : 'family.pool.owed')}</b>
        <span>{t('detail.renewal.elapsed', { pct })}</span>
      </p>
      <div className="dt-period-bar" role="img" aria-label={t('detail.renewal.elapsed', { pct })}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className="dt-period-ends">
        <span>{cnDateFull(from)}</span>
        <span>{cnDateFull(until)}</span>
      </p>
    </div>
  );
}

/**
 * 成员的称呼：没关联人员时是输入框，打字时下面联想名册里的人，选中即关联；不选就按输入的称呼新建。
 * 已关联时显示成头像加名字的胶囊，× 解除关联、可以重新输入或换人
 */
function PersonNameField({
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

/** 把一个成员的收款、免收写回账本：以账本里最新的成员为底，只换这两项 */
async function saveReceivable(s: Subscription, memberId: string, r: Receivable) {
  const current = getState().subscriptions.find((x) => x.id === s.id) ?? s;
  const sh = current.share!;
  const members = sh.members.map((x) => (x.id === memberId ? { ...x, receipts: r.receipts, waivers: r.waivers } : x));
  await saveSub({ ...current, share: { ...sh, collectFrom: collectionAnchor(current), members } });
}

/** 成员的各期：算到十年后，可以提前收 */
const memberLedgerAhead = (state: AppState, s: Subscription, m: ShareMember, today: string) =>
  memberLedger(s, m, today, state.settings.collectCurrency ?? state.settings.baseCurrency, addMonths(today, 120));

/**
 * 收款表单（全站唯一）：上面是这辆车和收费标准（只读），下面勾选这笔钱抵扣哪几期、实际收了多少。
 * 传 editId 时是修改已记的那一笔（收款或免收），可删除。
 */
function ReceiptForm({
  state,
  s,
  member: m,
  editId,
  preset,
  onDone,
  onMember,
  onOpenSub,
}: {
  state: AppState;
  s: Subscription;
  member: ShareMember;
  editId?: string;
  preset?: string[];
  onDone: () => void;
  onMember?: () => void;
  onOpenSub?: () => void;
}) {
  const today = todayIn(state.settings.timezone);
  const cur = memberFee(state, s, m, today);
  const collectCcy = state.settings.collectCurrency ?? state.settings.baseCurrency;
  const edit = [...(m.receipts ?? []), ...(m.waivers ?? [])].find((x) => x.id === editId);
  const name = m.name || t('family.member.defaultName');
  return (
    <ReceivableSheet
      state={state}
      today={today}
      title={
        <span className="icon-text">
          <PersonAvatar p={personFor(state, m.personId, m.name)} size={24} />
          {name}
        </span>
      }
      head={
        <>
          {/* 从合租页进来时标明是哪辆车：同一个人可能在好几辆车上 */}
          {onOpenSub && (
            <div className="collect-sub">
              <SubIcon sub={s} size={32} />
              <span className="collect-sub-id">
                <b>{s.name}</b>
                <small>
                  {money(s.price, s.currency)} {cycleLabel(s.cycle)}
                </small>
              </span>
              <button type="button" className="collect-sub-link" onClick={onOpenSub}>
                {t('family.collect.viewSub')}
              </button>
            </div>
          )}
          {!m.exempt && (
            <Group>
              <Cell label={t('family.member.feeGroup')}>
                <span className="muted">{perBill('family.pool.perFee', memberBillMonths(s, m, today), { fee: money(cur.amount, cur.currency) })}</span>
              </Cell>
            </Group>
          )}
        </>
      }
      ledger={(through) => memberLedger(s, m, today, collectCcy, through).periods}
      record={m}
      edit={edit}
      preset={preset}
      save={(r) => saveReceivable(s, m.id, r)}
      onDone={onDone}
      extraFoot={
        onMember && (
          <button className="btn plain" onClick={onMember}>
            {t('family.collect.editMember')}
          </button>
        )
      }
    />
  );
}

/**
 * 成员表单（新增与编辑同一个）：是谁 → 座位 → 收费 → 收款。
 * 人员本身的称呼、联系方式属于人员，已关联时在人员详情里改；这里是「这个人在这辆车上的座位」。
 * 新增时可以顺手记首笔收款，大部分情况一次填完。
 */
function MemberForm({ state, s, member, onClose }: { state: AppState; s: Subscription; member?: ShareMember; onClose: () => void }) {
  const today = todayIn(state.settings.timezone);
  const isNew = !member;
  const once = s.cycle.unit === 'lifetime';
  // 收款默认币种：设置里的「合租收款币种」，缺省同本位币
  const collectCcy = state.settings.collectCurrency ?? state.settings.baseCurrency;
  const [f, setF] = useState<ShareMember>(() => {
    // 早期单独记的 Telegram 并入通用的联系方式
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
  const up = (p: Partial<ShareMember>) => setF(updateMemberLeave(f, p));
  const via = f.contactVia ?? 'Telegram';
  const setVia = (v: string) => up({ contactVia: v });
  const setContact = (c: string) => up({ contactVia: via, contact: c || undefined, tg: undefined });
  const val = (e: { target: EventTarget | null }) => (e.target as HTMLInputElement).value;

  // 收费：跟随车 / 自定义 / 不分摊。老数据收费与车不一致时视为自定义
  const rule = carRule(state, s, today);
  const initialMode: 'follow' | 'custom' | 'exempt' = member?.exempt ? 'exempt' : !member || followsCar(state, s, member, today) ? 'follow' : 'custom';
  const [mode, setMode] = useState(initialMode);
  const cur = memberFee(state, s, f, today);
  const [fee, setFee] = useState({ amount: cur.amount, currency: cur.currency, billEvery: memberBillMonths(s, f, today) });
  const [feeFrom, setFeeFrom] = useState(today);
  const feeEdited = fee.amount !== cur.amount || fee.currency !== cur.currency || fee.billEvery !== memberBillMonths(s, f, today);
  // 新成员从加入日起按选定的收费；已有成员从生效日起调价，历史收款不变
  const start = isNew ? (f.joined ?? today) : feeFrom;
  const withFee = (m: ShareMember): ShareMember => {
    if (mode === 'exempt') return { ...m, exempt: true };
    const base = { ...m, exempt: undefined };
    if (mode === 'follow') return isNew || initialMode !== 'follow' ? followCarRule(state, s, base, start, today) : { ...base, custom: undefined };
    const custom = { ...base, custom: true as const };
    return feeEdited ? changeMemberFee(state, s, custom, { from: start, fee: fee.amount, currency: fee.currency, billEvery: fee.billEvery }, today) : custom;
  };
  const rateChanged = !isNew && mode !== 'exempt' && (mode === 'follow' ? initialMode !== 'follow' : initialMode !== 'custom' || feeEdited);

  // 期初已付至：默认只看已付至；点「调整」改这个日期，这天及之前没记收款的期算开始记账前已收清（null 表示没改过，undefined 表示清空）
  const [openingEdit, setOpeningEdit] = useState<string | undefined | null>(null);
  const draft = (): ShareMember => {
    const m = withFee(f);
    // 收款、免收以账本为准：收款表单另行保存，这里只在调整了已付至时改期初结清
    const r = { ...m, receipts: member?.receipts, waivers: member?.waivers };
    return openingEdit === null ? r : { ...r, ...setOpening(r, memberPeriods(s, r, openingEdit ?? today, collectCcy), openingEdit) };
  };
  const next = draft();
  const ledger = memberLedgerAhead(state, s, next, today);

  // 新成员可以顺手记首笔收款：从首期起按期数预填，金额、币种、日期都能改
  const [firstPay, setFirstPay] = useState(false);
  const [firstPeriods, setFirstPeriods] = useState(1);
  const firstOpen = ledger.periods.filter((p) => !isSettled(p));
  const firstKeys = firstOpen.slice(0, firstPeriods).map((p) => p.key);
  const suggested = { date: today, ...periodsTotal(state, firstOpen.slice(0, firstPeriods)) };
  const [payEdit, setPayEdit] = useState<{ date?: string; amount?: number; currency?: string; note?: string }>({});
  const pay = { ...suggested, ...payEdit };
  const payInvalid = !Number.isFinite(pay.amount) || pay.amount < 0 || !firstKeys.length;
  const firstUntil = firstOpen[Math.min(firstPeriods, firstOpen.length) - 1]?.until;

  const first = memberCollection(s, f, f.joined ?? s.share?.since ?? s.start, collectCcy);
  // 同一个人还出现在别的合租、代付里：已关联名册里的人，称呼、联系方式只读，改人员资料去人员详情
  const linked = !!f.personId && !!state.people?.some((p) => p.id === f.personId);
  const [profile, setProfile] = useState(false);
  // 收款与免收记录，新的在前；期初结清单独一行，不能当收款编辑
  const records = [...(member?.receipts ?? []), ...(member?.waivers ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const received = member ? memberCashFlows(member).reduce((a, p) => a + memberFlowValue(state, p, collectCcy), 0) : 0;
  const st = memberStatus(state, { ...s, share: { ...s.share!, members: s.share!.members.map((x) => (x.id === next.id ? next : x)) } }, next, today);
  const [receipt, setReceipt] = useState<{ edit?: string; preset?: string[] } | null>(null);
  const [adjustPaid, setAdjustPaid] = useState(false);
  // 已付至按没退出算：退出后还有已付的天数时照样显示到那期期末，算退款要看
  const paidUntil = next.left ? paidThrough(memberLedgerAhead(state, s, { ...next, left: undefined }, today).periods) : paidThrough(ledger.periods);
  // 本期：今天所在的那一期
  const currentPeriod = ledger.periods.find((p) => p.from <= today && p.until >= today);

  // 同一笔收款复制给其他成员：大家每期交的一样，不用一个个重填。对方这几期都还空着才能复制
  const others = (s.share?.members ?? []).filter((x) => x.id !== f.id);
  const [copying, setCopying] = useState<string | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const copyable = (o: ShareMember, r: Receipt) => {
    const l = memberLedgerAhead(state, s, o, today);
    return r.periods.every((k) => l.periods.some((p) => p.key === resolveKey(l.periods, k) && !isSettled(p)));
  };
  const startCopy = (r: Receipt) => {
    setTargets(others.filter((o) => copyable(o, r)).map((o) => o.id));
    setCopying(r.id);
  };
  const copyTo = (r: Receipt) => {
    const current = getState().subscriptions.find((x) => x.id === s.id) ?? s;
    const sh = current.share!;
    run(
      async () => {
        const members = sh.members.map((o) =>
          targets.includes(o.id) ? { ...o, ...putRecord(o, 'receipt', { ...r, id: uid() }, memberLedgerAhead(state, current, o, today).periods) } : o,
        );
        await saveSub({ ...current, share: { ...sh, collectFrom: collectionAnchor(current), members } });
        setCopying(null);
      },
      t('family.member.copied', { count: targets.length }),
    );
  };
  const removeRecordById = (id: string) =>
    run(() => saveReceivable(s, f.id, id === 'opening' ? setOpening(member!, [], undefined) : removeRecord(member!, id)), t('receivable.toastRemoved'));

  const [busy, submit] = useSubmit();
  const save = () =>
    run(
      async () => {
        // 新的人先建档；已有的人改了称呼或联系方式，订阅保存后再同步到他的其他合租、代付
        const link = await linkPerson(state, f.personId, f.name, f.contact ? via : undefined, f.contact);
        const current = getState().subscriptions.find((x) => x.id === s.id) ?? s;
        const sh = current.share!;
        const stored = sh.members.find((x) => x.id === next.id);
        const base: ShareMember = { ...next, name: f.name.trim(), account: f.account?.trim() || undefined, personId: link.id };
        // 收款、免收以账本里最新的为准（期间可能在收款表单里记过），只叠加这里调整的期初结清和首笔收款
        const latest = { ...base, receipts: stored?.receipts, waivers: stored?.waivers };
        const opened =
          openingEdit === null ? latest : { ...latest, ...setOpening(latest, memberPeriods(current, latest, openingEdit ?? today, collectCcy), openingEdit) };
        const out: ShareMember =
          isNew && firstPay
            ? {
                ...opened,
                ...putRecord(
                  opened,
                  'receipt',
                  { id: uid(), date: pay.date, amount: pay.amount, currency: pay.currency, periods: firstKeys, ...(pay.note ? { note: pay.note } : {}) },
                  memberLedgerAhead(state, current, opened, today).periods,
                ),
              }
            : opened;
        await saveSub({
          ...current,
          share: {
            ...sh,
            collectFrom: collectionAnchor(current),
            members: stored ? sh.members.map((x) => (x.id === out.id ? out : x)) : [...sh.members, out],
          },
        });
        if (link.after) await savePerson(link.after);
        onClose();
      },
      isNew ? t('family.member.added') : t('family.member.saved'),
    );

  return (
    <Sheet
      narrow
      title={isNew ? t('family.member.titleNew', { name: s.name }) : member.name || t('family.member.group')}
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
        {/* 一、是谁：新建或从人员里选；已关联的人只读，资料在人员详情里改 */}
        <Group
          title={t('family.member.group')}
          action={
            linked && !state.readonly ? (
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

        {/* 四、收款：新成员可以顺手记首笔；已有成员看记录、记一笔、改某一笔，都走同一个收款表单 */}
        {isNew ? (
          mode !== 'exempt' && (
            <Group
              title={t('family.member.firstPay')}
              foot={firstPay && !once && firstUntil ? t('family.collect.next', { date: cnDateFull(addDays(firstUntil, 1)) }) : undefined}
            >
              <Cell label={t('family.member.firstPayToggle')}>
                <Toggle checked={firstPay} onChange={setFirstPay} />
              </Cell>
              {firstPay && (
                <>
                  <Cell label={t('family.member.receivedOn')}>
                    <DatePicker value={pay.date} onChange={(v) => setPayEdit({ ...payEdit, date: v ?? today })} />
                  </Cell>
                  <Cell label={t('family.member.amount')}>
                    <span className="contact-field">
                      <NumInput className="num" ccy={pay.currency} value={pay.amount} onValue={(n) => setPayEdit({ ...payEdit, amount: n ?? 0 })} />
                      <CurrencySelect value={pay.currency} onChange={(c) => setPayEdit({ ...payEdit, currency: c })} ariaLabel={t('family.member.currency')} />
                    </span>
                  </Cell>
                  {!once && (
                    <>
                      <Cell label={t('family.collect.periods')}>
                        <Stepper
                          label={t('family.collect.periods')}
                          value={firstPeriods}
                          min={1}
                          max={Math.max(1, Math.min(24, firstOpen.length))}
                          unit={(n) => t('family.collect.periodUnit', { count: n })}
                          onChange={setFirstPeriods}
                        />
                      </Cell>
                      {firstUntil && (
                        <Cell label={t('family.collect.until')}>
                          <span>{cnDateFull(firstUntil)}</span>
                        </Cell>
                      )}
                    </>
                  )}
                  <Cell label={t('family.member.note')}>
                    <input
                      value={pay.note ?? ''}
                      placeholder={t('family.member.notePh')}
                      onChange={(e) => setPayEdit({ ...payEdit, note: val(e) || undefined })}
                    />
                  </Cell>
                </>
              )}
            </Group>
          )
        ) : (
          <>
            {/* 本期：和订阅详情同一条进度（开始、结束、已过多少），已付实色、欠款橙色；下面一格一期，哪几期没收一眼可见 */}
            {/* 已退出的成员不再有本期，只留已付到（算退款要看） */}
            {mode !== 'exempt' && (
              <Group
                title={st.gone ? undefined : t('detail.period.paid')}
                foot={
                  adjustPaid
                    ? t('receivable.openingHint')
                    : st.gone
                      ? undefined
                      : st.owe
                        ? `${st.late > 0 ? `${t('family.quick.late', { count: st.late })}\n` : ''}${t('family.quick.owe', { amount: st.owed, date: cnDateFull(st.next.from) })}`
                        : once
                          ? t('family.pool.settled')
                          : t('family.quick.settled', { date: cnDateFull(st.next.from) })
                }
              >
                {!st.gone && currentPeriod && (
                  <div className="cell member-period">
                    <MemberPeriod from={currentPeriod.from} until={currentPeriod.until} paid={isSettled(currentPeriod)} today={today} />
                  </div>
                )}
                {!once && (
                  <div className="cell">
                    <PeriodStrip
                      periods={ledger.periods}
                      today={today}
                      onPick={(p) =>
                        p.receipt && !p.receipt.opening
                          ? setReceipt({ edit: p.receipt.id })
                          : p.waiver
                            ? setReceipt({ edit: p.waiver.id })
                            : !isSettled(p) && setReceipt({ preset: [p.key] })
                      }
                    />
                  </div>
                )}
                {/* 已付至：从第一期起连续结清到哪天；点「调整」改期初已付至 */}
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
              </Group>
            )}
            {/* 收款记录只放记录；记一笔放在最下面 */}
            <Group
              title={t('family.member.payments', { count: records.length })}
              foot={
                (records.length > 1 || !!member!.leaveRefund || (isReceipt(records[0]) && records[0].currency !== collectCcy)) &&
                t('family.member.receivedTotal', { amount: flow(received, collectCcy) })
              }
            >
              {ledger.unmatched.length > 0 && <div className="cell muted">{t('receivable.unmatchedNote', { count: ledger.unmatched.length })}</div>}
              {records.map((r) => {
                const opening = isReceipt(r) && r.opening;
                return (
                  <div key={r.id} className="cell member-pay">
                    <button
                      type="button"
                      className="cell-l member-pay-edit"
                      disabled={opening}
                      onClick={() => setReceipt({ edit: r.id })}
                      aria-label={t('family.member.editPayAria')}
                    >
                      {isReceipt(r) && !opening ? (
                        <span className="green">{flow(r.amount, r.currency)}</span>
                      ) : (
                        <span>{t(opening ? 'receivable.opening' : 'receivable.waived')}</span>
                      )}
                      <small>
                        {copyParts(opening ? recordPeriods(r, ledger.periods) : `${cnDateFull(r.date)}\n${recordPeriods(r, ledger.periods)}`)}
                        {copyParts(r.note ? `\n${r.note}` : '')}
                      </small>
                    </button>
                    <span className="cell-r">
                      {isReceipt(r) && !opening && others.length > 0 && (
                        <IconButton
                          className={`${copying === r.id ? 'on' : ''}`}
                          aria-label={t('family.member.copyAria')}
                          title={t('family.member.copyAria')}
                          onClick={() => (copying === r.id ? setCopying(null) : startCopy(r))}
                        >
                          <Icon name="copy" />
                        </IconButton>
                      )}
                      <IconButton aria-label={t('family.member.removePayAria')} onClick={() => removeRecordById(r.id)}>
                        <Icon name="x" />
                      </IconButton>
                    </span>
                    {copying === r.id && isReceipt(r) && (
                      <div className="copy-pay" data-submit=".btn.primary">
                        {others.map((o) => {
                          const dup = !copyable(o, r);
                          const until = paidThrough(memberLedgerAhead(state, s, o, today).periods);
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
                                {dup ? t('family.member.dup') : until ? t('family.member.paidUntilDate', { date: cnDate(until) }) : t('family.member.noPay')}
                              </small>
                            </label>
                          );
                        })}
                        <div className="sheet-actions">
                          <button className="btn" onClick={() => setCopying(null)}>
                            {t('family.member.cancel')}
                          </button>
                          <button className="btn primary" disabled={!targets.length} onClick={() => copyTo(r)}>
                            {t('family.member.copyN', { count: targets.length })}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {member!.leaveRefund && (
                <Cell label={t('family.sheet.refund')}>
                  <span>
                    {cnDateFull(member!.leaveRefund.date)}
                    {copyParts(member!.leaveRefund.note ? `\n${member!.leaveRefund.note}` : '')}
                  </span>
                  <b>{flow(-member!.leaveRefund.amount, member!.leaveRefund.currency)}</b>
                </Cell>
              )}
              {mode !== 'exempt' && (
                <button type="button" className="cell tap member-pay-add" onClick={() => setReceipt({})}>
                  <Icon name="plus" /> {t('family.quick.backCollect')}
                </button>
              )}
            </Group>
          </>
        )}
      </div>
      {/* 记一笔、改某一笔：叠在成员表单上，存完回到这里，成员表单里没保存的修改不丢 */}
      {receipt !== null && member && (
        <ReceiptForm state={state} s={s} member={member} editId={receipt.edit} preset={receipt.preset} onDone={() => setReceipt(null)} />
      )}
      {profile && f.personId && (
        <PersonProfileSheet
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

/** 成员一行的收款状态：逾期几天 / 待收 / 已结清，合租表格和收费弹窗共用 */
export function memberStatus(state: AppState, s: Subscription, m: ShareMember, today: string) {
  const collect = state.settings.collectCurrency ?? state.settings.baseCurrency;
  const d = memberDues(s, today, collect, state).find((x) => x.member.id === m.id);
  const next = memberCollection(s, m, memberUnpaidFrom(s, m), collect);
  const owe = !!d && d.periodsOwed > 0;
  // 本期：今天所在的这个人自己的收费期；还没加入或已经退出时取最早没结清的一期
  const now = memberLedger(s, m, today, collect).periods.find((p) => p.from <= today && p.until >= today);
  const period = now ? { from: now.from, until: now.until, paid: isSettled(now) } : { from: next.from, until: next.until, paid: false };
  return {
    owe,
    period,
    owed: owe ? money(d!.owed, d!.currency) : '',
    late: owe && next.from < today ? diffDays(next.from, today) : 0,
    next,
    gone: !!m.left && next.from >= m.left,
  };
}

/** 成员时间条上的一段：已收、免收（含免费）、该收没收（到今天为止）、还没到期的下一期，以及退出后没用完的已付天数 */
export interface MemberSegment {
  from: string;
  until: string;
  kind: 'paid' | 'due' | 'future' | 'unused' | 'waived';
}

/**
 * 成员在时间窗口内的各期：按这个人自己的收费周期切分，每期按收款、免收推算状态，可以不连续。
 * 已退出的截到退出前一天；不分摊的没有分段。
 */
export function memberSegments(s: Subscription, m: ShareMember, today: string, start: string, end: string): MemberSegment[] {
  if (m.exempt) return [];
  const stop = m.left ? addDays(m.left, -1) : end;
  const out: MemberSegment[] = [];
  const push = (from: string, until: string, kind: MemberSegment['kind']) => {
    const a = from < start ? start : from;
    const b = [until, stop, end].sort()[0];
    if (a <= b) out.push({ from: a, until: b, kind });
  };
  const { periods } = memberLedger(s, m, today, s.currency, end);
  let future = false;
  for (const p of periods) {
    if (p.until < start || p.from > end) continue;
    if (p.status === 'upcoming') {
      // 还没到期的只画下一期
      if (future) continue;
      future = true;
    }
    push(p.from, p.until, p.status === 'paid' ? 'paid' : p.status === 'due' ? 'due' : p.status === 'upcoming' ? 'future' : 'waived');
  }
  // 退出时已付到退出日之后、又没退钱：退出后到已付至的那段画成没用完
  const paid =
    m.left && !m.leaveRefund
      ? memberLedger(s, { ...m, left: undefined }, today, s.currency, m.left).periods.filter((p) => p.status === 'paid' && p.until >= m.left!)
      : [];
  if (paid.length) {
    const from = [m.left!, start].sort().at(-1)!;
    const last = paid.at(-1)!.until;
    const until = last < end ? last : end;
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
