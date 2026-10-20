import { useState } from 'preact/hooks';
import { addDays, addMonths, chargesBetween, currentPhase, cycleDays, monthlyGross, todayIn, uid } from '../../shared/billing.ts';
import { chargeValue, toBaseAt } from '../../shared/fx.ts';
import { billLabel, cnDate, cnDateFull, money } from '../../shared/format.ts';
import type { AppState, MemberPayment, ShareMember, Subscription } from '../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { Cell, Group, Icon, Seg, Sheet, Toggle } from '../components/ui.tsx';
import { confirmDelete } from './Editor.tsx';
import { run, saveSub } from '../store.ts';
import { CurrencySelect, Picker } from '../components/Picker.tsx';

export const CONTACT_VIA = ['Telegram', '微信', 'WhatsApp', '邮箱', '手机', 'X', 'Discord', '其他'];
export const CONTACT_HINT: Record<string, string> = { Telegram: '@username', 微信: '微信号', WhatsApp: '+63 …', 邮箱: 'name@example.com', 手机: '+86 …', X: '@handle', Discord: '用户名' };

/** 用户名前面带 @ 的渠道：输入框里固定显示 @，存的时候去掉 */
const AT_VIA = new Set(['Telegram', 'X']);
const bare = (id: string) => id.replace(/^@+/, '');

/** 成员联系方式的一行文字：「Telegram @abc」 */
export function contactText(m: Pick<ShareMember, 'contactVia' | 'contact' | 'tg'>): string {
  const via = m.contactVia ?? (m.tg ? 'Telegram' : '');
  const id = m.contact ?? m.tg;
  if (!id) return '';
  const shown = AT_VIA.has(via) ? `@${bare(id)}` : id;
  return via && via !== '其他' ? `${via} ${shown}` : shown;
}

/** 联系方式输入：渠道选择 + 账号；Telegram、X 固定显示 @，能直接打开的渠道后面带一个跳转按钮 */
export function ContactField({ via, value, onVia, onChange }: { via: string; value?: string; onVia: (v: string) => void; onChange: (id: string) => void }) {
  const at = AT_VIA.has(via);
  const url = contactUrl(via, value);
  return (
    <span class="contact-field">
      <Picker value={via} onChange={onVia} options={CONTACT_VIA.map((c) => ({ value: c, label: c }))} ariaLabel="联系渠道" />
      {at && <span class="contact-at">@</span>}
      <input
        value={at ? bare(value ?? '') : (value ?? '')}
        autoCapitalize="off"
        inputMode={via === '邮箱' ? 'email' : via === '手机' ? 'tel' : 'text'}
        placeholder={at ? bare(CONTACT_HINT[via]) : (CONTACT_HINT[via] ?? '账号 / ID')}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value.trim();
          onChange(at ? bare(v) : v);
        }}
      />
      {url && (
        <a class="icon-btn contact-go" href={url} target="_blank" rel="noreferrer" aria-label={`打开 ${via}`} title={`打开 ${via}`}>
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
 * 合租账本：订阅本身多少钱、我付出去多少、从成员身上收回多少，算出净成本（负数就是赚了）。
 * 预计按年算：订阅一年的费用对比成员一年应交；实际从开始合租那天（缺省为最早一笔收款）累计。
 */
export function carLedger(state: AppState, s: Subscription, today: string) {
  const cur = currentPhase(s, today);
  const members = s.share?.members ?? [];
  const perYear = 365.25 / cycleDays(cur.cycle);
  const yearCost = toBaseAt(state, monthlyGross(cur, today) * 12, cur.currency);
  // 预计收入只算还在车上的；实际收回保留所有人（包括已退出的）的历史收款
  const yearIncome = members.reduce((a, m) => a + (m.exempt || (m.left && m.left <= today) ? 0 : toBaseAt(state, (m.share || 0) * perYear, cur.currency)), 0);
  const firstPay = members.flatMap((m) => m.payments ?? []).reduce<string | undefined>((a, p) => (!a || p.date < a ? p.date : a), undefined);
  const since = s.share?.since ?? firstPay;
  const paid = since ? chargesBetween(s, since, today, today).reduce((a, c) => a + chargeValue(state, c), 0) : 0;
  const received = members.flatMap((m) => m.payments ?? []).reduce((a, p) => a + toBaseAt(state, p.amount, p.currency, p.date), 0);
  return { yearCost, yearIncome, yearNet: yearCost - yearIncome, since, paid, received, net: paid - received };
}

/** 订阅一期大约几个月，用来把「每期份额」换算成按月 / 季 / 年收的金额 */
function cycleMonths(s: Subscription): number {
  return Math.max(0.25, cycleDays(s.cycle) / 30.4375);
}

/** 按收费周期应收的金额：每期份额 × 周期月数 ÷ 订阅一期的月数 */
export function billAmount(s: Subscription, m: ShareMember): number {
  return Math.round(((m.share || 0) * (m.billEvery ?? 1)) / cycleMonths(s) * 100) / 100;
}

/** 每次向这位成员收多少：填了收费标准就用它，否则由每期份额换算成本位币 */
export function memberFee(state: AppState, s: Subscription, m: ShareMember): { amount: number; currency: string } {
  const ccy = state.settings.collectCurrency ?? state.settings.baseCurrency;
  if (m.fee != null) return { amount: m.fee, currency: m.feeCurrency ?? ccy };
  return { amount: Math.round(toBaseAt(state, billAmount(s, m), s.currency, undefined, ccy)), currency: ccy };
}

/** 由收费标准反推每期份额（订阅币种），用于算我自己的份额与成员应交 */
function shareFromFee(state: AppState, s: Subscription, fee: number, ccy: string, billEvery: number): number {
  return Math.round(((toBaseAt(state, fee, ccy, undefined, s.currency) * cycleMonths(s)) / billEvery) * 100) / 100;
}

/** 覆盖期：给定起始日，按收费周期算出结束日（含） */
const coverEnd = (from: string, months: number) => addDays(addMonths(from, months), -1);
/** 下一笔默认从已付至的次日起 */
const nextFrom = (m: ShareMember, today: string) => (m.paidUntil ? addDays(m.paidUntil, 1) : today);

/** 成员资料与收款记录：TG、联系方式、来源、服务账号、收费周期，以及每一笔收款 */
export function MemberSheet({ state, s, member, collect, onClose }: { state: AppState; s: Subscription; member?: ShareMember; collect?: boolean; onClose: () => void }) {
  const today = todayIn(state.settings.timezone);
  const isNew = !member;
  // 早期单独记的 Telegram 并入通用的联系方式
  // 收款默认币种：设置里的「合租收款币种」，缺省同本位币
  const base = state.settings.collectCurrency ?? state.settings.baseCurrency;
  const [f, setF] = useState<ShareMember>(() => {
    const init = member?.tg && !member.contact ? { ...member, contactVia: 'Telegram', contact: member.tg, tg: undefined } : (member ?? { id: uid(), name: '', share: Math.round((s.price / Math.max(1, s.share?.seats ?? 1)) * 100) / 100, billEvery: 1 });
    // 老数据只有每期份额：换算成「每次收多少人民币」
    const fee = memberFee(state, s, init);
    return { ...init, fee: fee.amount, feeCurrency: fee.currency };
  });
  const up = (p: Partial<ShareMember>) => setF({ ...f, ...p });
  const via = f.contactVia ?? 'Telegram';
  const setVia = (v: string) => up({ contactVia: v, ...(v === '邮箱' && f.contact && !f.account ? { account: f.contact } : {}) });
  // 联系方式选的是邮箱且还没填受邀邮箱时，顺手填上
  const setContact = (c: string) => up({ contactVia: via, contact: c || undefined, tg: undefined, ...(via === '邮箱' && (!f.account || f.account === f.contact) ? { account: c || undefined } : {}) });
  const val = (e: Event) => (e.target as HTMLInputElement).value;
  const [adding, setAdding] = useState(!!collect);
  const months = f.billEvery ?? 1;
  const freshPay = (m: ShareMember): MemberPayment => {
    const from = nextFrom(m, today);
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
    if (!isNew) save(next, `已记 ${f.name || '成员'} 收款 ${money(pay.amount, pay.currency)}`);
  };
  const removePayment = (i: number) => {
    const payments = (f.payments ?? []).filter((_, k) => k !== i);
    const next = { ...f, payments, paidUntil: payments.length ? payments.reduce((a, p) => (p.until > a ? p.until : a), payments[0].until) : f.paidUntil };
    setF(next);
    if (!isNew) save(next, '已删除这笔收款');
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
    run(async () => {
      await saveSub({ ...s, share: { ...sh, members } });
      setCopying(null);
    }, `已复制给 ${targets.length} 位成员`);
  };

  const payments = (f.payments ?? []).slice().reverse();
  const received = (f.payments ?? []).reduce((a, p) => a + toBaseAt(state, p.amount, p.currency, p.date, base), 0);
  const unit = billLabel(months).slice(1);

  return (
    <Sheet
      narrow
      title={isNew ? `添加成员 · ${s.name}` : f.name || '成员'}
      onClose={onClose}
      foot={
        <>
          {!isNew && (
            <button
              class="btn plain"
              style={{ color: 'var(--red)' }}
              onClick={() =>
                confirmDelete(`彻底删除成员「${f.name || '未命名'}」？收款记录也会一起删除，账本里的收入会变少。\n只是不再合租的话，填「退出日」就好。`) &&
                run(async () => {
                  await saveSub({ ...s, share: { ...s.share!, members: s.share!.members.filter((x) => x.id !== f.id) } });
                  onClose();
                }, '已删除')
              }
            >
              删除
            </button>
          )}
          <span class="grow" />
          <button class="btn" onClick={onClose}>
            取消
          </button>
          <button
            class="btn primary"
            disabled={!f.name.trim()}
            onClick={async () => {
              await save({ ...f, name: f.name.trim() }, isNew ? '已添加成员' : '已保存');
              onClose();
            }}
          >
            {isNew ? '添加' : '保存'}
          </button>
        </>
      }
    >
      <div class="stack">
        <Group title="成员">
          <Cell label="称呼">
            <input value={f.name} autoFocus={isNew} placeholder="怎么称呼" onInput={(e) => up({ name: val(e) })} />
          </Cell>
          <Cell label="联系方式">
            <ContactField via={via} value={f.contact} onVia={setVia} onChange={setContact} />
          </Cell>
          <Cell label="受邀账号">
            <input inputMode="email" autoCapitalize="off" value={f.account ?? ''} placeholder={`拉进 ${s.name} 家庭组的邮箱或用户名`} onInput={(e) => up({ account: val(e).trim() || undefined })} />
          </Cell>
          <Cell label="加入日">
            <DatePicker value={f.joined} clearable placeholder={s.share?.since ? `同发起日 ${s.share.since}` : '不设置'} onChange={(v) => up({ joined: v })} />
          </Cell>
          <Cell label="退出日">
            <DatePicker value={f.left} clearable placeholder="还在合租" onChange={(v) => up({ left: v })} />
          </Cell>
        </Group>

        <Group title="收费标准">
          <div class="cell">
            <Seg
              value={String(months)}
              onChange={(v) => setFee({ billEvery: Number(v) })}
              options={[
                ['1', '按月'],
                ['3', '按季'],
                ['6', '半年'],
                ['12', '按年'],
              ]}
            />
          </div>
          <Cell label={`每${unit}收`}>
            <span class="contact-field">
              <CurrencySelect value={f.feeCurrency ?? base} onChange={(c) => setFee({ feeCurrency: c })} ariaLabel="收款币种" />
              <input class="num" inputMode="decimal" value={f.fee ?? ''} placeholder="0" onInput={(e) => setFee({ fee: Number(val(e)) || 0 })} />
            </span>
          </Cell>
          <Cell label={<span>不分摊</span>}>
            <Toggle checked={!!f.exempt} onChange={(v) => up({ exempt: v || undefined })} />
          </Cell>
        </Group>

        <Group title="其他">
          <Cell label="来源">
            <input value={f.source ?? ''} placeholder="哪个群 / 谁介绍的" onInput={(e) => up({ source: val(e) || undefined })} />
          </Cell>
        </Group>

        <Group title={`收款记录 · ${(f.payments ?? []).length} 笔`} foot={received ? `累计收到约 ${money(received, base)}` : undefined}>
          <Cell label="已付至">
            <DatePicker value={f.paidUntil} clearable placeholder="还没收过" onChange={(v) => up({ paidUntil: v })} />
          </Cell>
          {payments.map((p) => {
            const i = (f.payments ?? []).indexOf(p);
            return (
              <div key={`${p.date}-${i}`} class="cell member-pay">
                <span class="cell-l">
                  {money(p.amount, p.currency)}
                  <small>
                    {cnDateFull(p.date)} 收 · 覆盖 {p.from ? `${cnDate(p.from)}–` : '至 '}
                    {cnDate(p.until)}
                    {p.note ? ` · ${p.note}` : ''}
                  </small>
                </span>
                <span class="cell-r">
                  {others.length > 0 && (
                    <button class={`icon-btn ${copying === i ? 'on' : ''}`} style={{ width: 26, height: 26 }} aria-label="复制给其他成员" title="复制给其他成员" onClick={() => (copying === i ? setCopying(null) : startCopy(i))}>
                      <Icon name="copy" />
                    </button>
                  )}
                  <button class="icon-btn" style={{ width: 26, height: 26 }} aria-label="删除这笔收款" onClick={() => removePayment(i)}>
                    <Icon name="x" />
                  </button>
                </span>
                {copying === i && (
                  <div class="copy-pay">
                    {others.map((o) => {
                      const dup = o.payments?.some((x) => x.date === p.date && x.until === p.until && x.amount === p.amount);
                      return (
                        <label key={o.id} class={`copy-target ${dup ? 'dup' : ''}`}>
                          <input
                            type="checkbox"
                            disabled={dup}
                            checked={!dup && targets.includes(o.id)}
                            onChange={(e) => setTargets((e.target as HTMLInputElement).checked ? [...targets, o.id] : targets.filter((x) => x !== o.id))}
                          />
                          <span>{o.name || '未命名'}</span>
                          <small>{dup ? '已有这笔' : o.paidUntil ? `已付至 ${cnDate(o.paidUntil)}` : '尚未收款'}</small>
                        </label>
                      );
                    })}
                    <div class="copy-actions">
                      <button class="btn" onClick={() => setCopying(null)}>
                        取消
                      </button>
                      <button class="btn primary" disabled={!targets.length} onClick={() => copyTo(p)}>
                        复制给 {targets.length} 人
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {adding ? (
            <>
              <Cell label="金额">
                <input class="num" inputMode="decimal" value={pay.amount} onInput={(e) => setPay({ ...pay, amount: Number(val(e)) || 0 })} />
              </Cell>
              <Cell label="币种">
                <CurrencySelect value={pay.currency} onChange={(c) => setPay({ ...pay, currency: c })} />
              </Cell>
              <Cell label="覆盖开始">
                <DatePicker value={pay.from} onChange={(v) => v && setPay({ ...pay, from: v, until: coverEnd(v, months) })} />
              </Cell>
              <Cell label={<span>覆盖结束<small class="muted" style={{ display: 'block', fontSize: 12 }}>按{billLabel(months).slice(1)}自动算出，可改</small></span>}>
                <DatePicker value={pay.until} onChange={(v) => setPay({ ...pay, until: v ?? pay.until })} />
              </Cell>
              <Cell label="收到日期">
                <DatePicker value={pay.date} onChange={(v) => setPay({ ...pay, date: v ?? today })} />
              </Cell>
              <Cell label="备注">
                <input value={pay.note ?? ''} placeholder="可选，如 USDT 转账" onInput={(e) => setPay({ ...pay, note: val(e) || undefined })} />
              </Cell>
              <div class="cell" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <button class="btn" onClick={() => setAdding(false)}>
                  取消
                </button>
                <button class="btn primary" disabled={!pay.amount} onClick={addPayment}>
                  记下这笔
                </button>
              </div>
            </>
          ) : (
            <button
              class="cell tap"
              style={{ color: 'var(--accent)' }}
              onClick={() => {
                setPay(freshPay(f));
                setAdding(true);
              }}
            >
              <Icon name="plus" /> 记一笔收款（每{unit} {money(f.fee ?? 0, f.feeCurrency ?? base)}）
            </button>
          )}
        </Group>
      </div>
    </Sheet>
  );
}
