import { PersonAvatar, personFor } from '../components/PersonAvatar.tsx';
import { ShareAvatars } from '../components/ShareAvatars.tsx';
import {
  addDays,
  chargesBetween,
  collectionAnchor,
  cycleLabel,
  effectiveStatus,
  memberDues,
  memberAboard,
  nextCharge,
  memberBillMonths,
  memberCollection,
  memberUnpaidFrom,
} from '../../../shared/billing.ts';
import { Fragment, useState } from 'react';
import { createPortal } from 'react-dom';
import { flow, billLabel, cnDate, cnDateAuto, cnDateFull, money } from '../../../shared/format.ts';
import { t } from '../../../shared/i18n.ts';
import { chargeValue, toBaseAt } from '../../../shared/fx.ts';
import type { AppState, ShareMember, Subscription } from '../../../shared/types.ts';
import { carLedger, contactText, contactValue, MemberSheet, memberFee, perBill } from './Members.tsx';
import { applyCarRule, carRule, followsCar } from '../../../shared/carpool.ts';
import type { CarRule } from '../../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { CurrencySelect } from '../components/Picker.tsx';
import { CardTitle, Amount, Cell, Group, Icon, NameLink, NumInput, Seg, Sheet, StatusPill, SubIcon, Toolbar, useWidth } from '../components/ui.tsx';
import { toBase } from '../derive.ts';
import { run, saveSub, usePref } from '../store.ts';
import { FamilyTabs } from './People.tsx';

const CAR_FILTERS = ['all', 'live', 'owe', 'settled', 'ended'] as const;
type CarFilter = (typeof CAR_FILTERS)[number];

/** 展开了哪些车卡（JSON 数组），解析失败当作都收起 */
function parseIds(raw: string): Set<string> {
  try {
    const v = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function Carpool({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  const [colsRef, colsWidth] = useWidth();
  const colCount = Math.max(1, Math.min(4, Math.floor((colsWidth + 16) / 356)));
  const live = (s: Subscription) => ['active', 'ending', 'trial', 'paused'].includes(effectiveStatus(s, today));
  const owned = state.subscriptions.filter((s) => s.share?.role === 'owner' && live(s));
  const joined = state.subscriptions.filter((s) => s.share?.role === 'member' && live(s));
  // 卡片按状态筛选；顶部的统计始终按进行中的合租算
  // 筛选记在服务端：切到别的页面再回来、换台设备都还是上次选的
  const [filter, setFilter] = usePref<CarFilter>('car-filter', 'live', (v): v is CarFilter => (CAR_FILTERS as readonly string[]).includes(v));
  const ended = state.subscriptions.filter((s) => s.share?.role === 'owner' && !live(s));
  const owes = (s: Subscription) => memberDues(s, today, state.settings.collectCurrency ?? state.settings.baseCurrency, state).some((d) => d.periodsOwed > 0);
  const groups: Record<CarFilter, Subscription[]> = {
    all: [...owned, ...ended],
    live: owned,
    owe: [...owned, ...ended].filter(owes),
    settled: owned.filter((s) => !owes(s)),
    ended,
  };
  // 有待收的在前，其余按下次扣款从近到远；已停止的排最后
  const nextOf = (s: Subscription) => nextCharge(s, addDays(today, 1)) ?? '9999-12-31';
  const shown = [...groups[filter]].sort(
    (a, b) => Number(!live(a)) - Number(!live(b)) || Number(!owes(a)) - Number(!owes(b)) || nextOf(a).localeCompare(nextOf(b)),
  );
  const books = new Map([...owned, ...ended].map((s) => [s.id, carLedger(state, s, today)]));
  const yearNet = owned.reduce((a, s) => a + books.get(s.id)!.yearNet, 0);
  const yearIncome = owned.reduce((a, s) => a + books.get(s.id)!.yearIncome, 0);
  const owedAll = [...owned, ...ended]
    .flatMap((s) => memberDues(s, today, state.settings.collectCurrency ?? state.settings.baseCurrency, state))
    .filter((d) => d.periodsOwed > 0);
  const owedSum = owedAll.reduce((a, d) => a + (Number.isFinite(d.owed) ? toBase(state, d.owed, d.currency) : NaN), 0);
  const ro = !!state.readonly;
  const [convert, setConvert] = useState<Subscription | null>(null);
  const [member, setMember] = useState<{ s: Subscription; m?: ShareMember; collect?: boolean } | null>(null);
  // 点开的那辆车：只存 id，弹窗里总读最新数据（收款后立即更新）
  const [sheet, setSheet] = useState<string | null>(null);
  const sheetSub = sheet ? state.subscriptions.find((x) => x.id === sheet) : undefined;
  // 车卡默认收起，只看净成本与座位；展开才看账本与成员明细
  const [openRaw, setOpen] = usePref<string>('car-open', '[]');
  const expanded = parseIds(openRaw);
  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(JSON.stringify([...next]));
  };
  const candidates = state.subscriptions.filter((s) => !s.share && !s.proxy && live(s) && s.tags.some((tag) => /合租|拼车|家庭|family|shared/i.test(tag)));

  return (
    <>
      <Toolbar title={t('family.pool.title')}>
        <Seg
          small
          value={filter}
          onChange={setFilter}
          options={CAR_FILTERS.map((f) => [f, `${t(`family.pool.filter.${f}`)} ${groups[f].length}`] as [CarFilter, string])}
        />
        {!ro && <FamilyTabs tab="plans" />}
      </Toolbar>
      <div className="page fade-in stack">
        <div className="grid g-3">
          <div className="card stat">
            <div className="stat-label">{yearNet < 0 ? t('family.pool.netGain') : t('family.pool.netCost')}</div>
            <div className="stat-value" style={{ color: yearNet < 0 ? 'var(--green)' : undefined }}>
              <Amount value={-yearNet} ccy={base} />
            </div>
            <div className="stat-sub" style={{ color: 'var(--green)' }}>
              {t('family.pool.yearIncome', { amount: flow(yearIncome, base, { compact: true }) })}
            </div>
          </div>
          <div className="card stat">
            <div className="stat-label">{t('family.pool.owed')}</div>
            <div className="stat-value" style={{ color: owedSum > 0 ? 'var(--orange)' : undefined }}>
              <Amount plain value={owedSum} ccy={base} />
            </div>
            <div className="stat-sub">{t('family.pool.owedSub', { count: owedAll.length })}</div>
          </div>
          <div className="card stat">
            <div className="stat-label">{t('family.pool.count')}</div>
            <div className="stat-value">
              <span className="amt car-plan-count">
                <span>
                  {owned.length}
                  <small>{t('family.pool.countStarted')}</small>
                </span>
                <span>
                  {joined.length}
                  <small>{t('family.pool.countJoined')}</small>
                </span>
              </span>
            </div>
            <div className="stat-sub">{t('family.pool.countSub')}</div>
          </div>
        </div>

        {owned.length + ended.length === 0 ? (
          <div className="card empty">
            <b>{t('family.pool.emptyTitle')}</b>
            {t('family.pool.emptyBody')}
          </div>
        ) : (
          shown.length === 0 && <div className="card empty">{t('family.pool.filter.none')}</div>
        )}
        {/* 列数随宽度变化（每列至少约 340px）；各列独立：展开一张卡只撑高它所在的那一列 */}
        <div className="car-cols" ref={colsRef} style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
          {Array.from({ length: colCount }, (_, col) => (
            <div className="car-col" key={col}>
              {shown.map((s, idx) => {
                if (idx % colCount !== col) return null;
                const sh = s.share!;
                const dues = memberDues(s, today, state.settings.collectCurrency ?? state.settings.baseCurrency, state);
                // 已退出的成员不占座，只在展开的明细里保留
                const onboard = sh.members.filter((m) => memberAboard(m, today));
                const free = Math.max(0, sh.seats - 1 - onboard.length);
                const next = nextCharge(s, addDays(today, 1));
                return (
                  // 整张卡片打开合租弹窗；里面的按钮、链接和订阅名各管各的
                  <div
                    key={s.id}
                    className={`card stack car-card ${live(s) ? '' : 'stopped'}`}
                    style={{ order: idx }}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => !(e.target as HTMLElement).closest('button, a, [role=link]') && setSheet(s.id)}
                    onKeyDown={(e) => e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setSheet(s.id))}
                  >
                    <div className="car-head">
                      <SubIcon sub={s} size={40} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="car-name">
                          <NameLink onClick={() => onOpen(s)}>{s.name}</NameLink>
                        </div>
                        <div className="muted car-sub">
                          {money(s.price, s.currency)} {cycleLabel(s.cycle)}
                          {next && live(s) ? ` · ${t('family.pool.next', { date: cnDate(next) })}` : ''}
                        </div>
                      </div>
                      {/* 只提示满没满车；空位的「+」放到展开后的「添加成员」 */}
                      {live(s) ? (
                        <span className={`car-seats ${free ? '' : 'full'}`}>
                          {free ? t('family.pool.seatsFree', { count: free }) : t('family.pool.seatsFull')}
                        </span>
                      ) : (
                        <StatusPill tone="stop">{t('family.pool.filter.ended')}</StatusPill>
                      )}
                    </div>
                    <div className="seats-row">
                      <ShareAvatars sub={s} state={state} today={today} onMember={ro ? undefined : (m) => setMember({ s, m })} />
                      {s.manageUrl && (
                        <a className="car-toggle" href={s.manageUrl} target="_blank" rel="noreferrer" title={t('family.pool.manageTitle')}>
                          <Icon name="gear" size={14} /> {t('family.pool.manage')}
                        </a>
                      )}
                      <button className={`car-toggle ${expanded.has(s.id) ? 'open' : ''}`} onClick={() => toggle(s.id)} aria-expanded={expanded.has(s.id)}>
                        {(() => {
                          const n = dues.filter((d) => d.periodsOwed > 0).length;
                          return n ? (
                            <span className="owe">{t('family.pool.owedN', { count: n })}</span>
                          ) : sh.members.length ? (
                            t('family.pool.settled')
                          ) : (
                            t('family.pool.noMembers')
                          );
                        })()}
                        <Icon name="down" size={14} />
                      </button>
                    </div>
                    <CarFacts book={books.get(s.id)!} base={base} />
                    {expanded.has(s.id) && (
                      <>
                        {!ro && free > 0 && live(s) && (
                          <button className="btn tinted" style={{ alignSelf: 'flex-start' }} onClick={() => setMember({ s })}>
                            <Icon name="plus" /> {t('family.pool.addMemberSeats', { count: free })}
                          </button>
                        )}
                        <MemberRows state={state} s={s} today={today} ro={ro} onMember={(m, c) => setMember({ s, m, collect: c })} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {joined.length > 0 && (
          <Group title={t('family.pool.joinedGroup')}>
            {joined.map((s) => (
              <Cell
                key={s.id}
                label={
                  <span className="row">
                    <SubIcon sub={s} size={30} />
                    {s.name}
                  </span>
                }
                sub={undefined}
                onClick={() => onOpen(s)}
              >
                {t('family.pool.payTo', { name: s.share?.ownerName ?? t('family.pool.ownerDefault'), amount: flow(-s.price, s.currency) })}
              </Cell>
            ))}
          </Group>
        )}

        {candidates.length > 0 && !ro && (
          <Group title={t('family.pool.maybeGroup')}>
            {candidates.map((s) => (
              <div key={s.id} className="cell">
                <span className="cell-l">
                  <span className="row">
                    <SubIcon sub={s} size={30} />
                    {s.name}
                  </span>
                </span>
                <span className="cell-r">
                  {money(s.price, s.currency)}
                  <button className="btn tinted" onClick={() => setConvert(s)}>
                    {t('family.pool.convert')}
                  </button>
                </span>
              </div>
            ))}
          </Group>
        )}
        {convert && <ConvertSheet s={convert} today={today} onClose={() => setConvert(null)} />}
        {sheetSub?.share && (
          <CarSheet
            state={state}
            s={sheetSub}
            today={today}
            ro={ro}
            book={books.get(sheetSub.id) ?? carLedger(state, sheetSub, today)}
            onClose={() => setSheet(null)}
            onOpenSub={() => {
              setSheet(null);
              onOpen(sheetSub);
            }}
            onMember={(m, c) => setMember({ s: sheetSub, m, collect: c })}
          />
        )}
        {member && (
          <MemberSheet
            state={state}
            s={state.subscriptions.find((x) => x.id === member.s.id) ?? member.s}
            member={member.m}
            collect={member.collect}
            onClose={() => setMember(null)}
            onOpenSub={() => {
              const sub = state.subscriptions.find((x) => x.id === member.s.id) ?? member.s;
              setMember(null);
              setSheet(null);
              onOpen(sub);
            }}
          />
        )}
      </div>
    </>
  );
}

/** 成员明细：收款状态、应收、收款按钮；车卡展开和合租弹窗共用 */
function MemberRows({
  state,
  s,
  today,
  ro,
  onMember,
  only,
}: {
  state: AppState;
  s: Subscription;
  today: string;
  ro: boolean;
  onMember: (m: ShareMember, collect?: boolean) => void;
  /** 只列一部分成员（合租弹窗里按收费周期分组时用） */
  only?: (m: ShareMember) => boolean;
}) {
  const dues = memberDues(s, today, state.settings.collectCurrency ?? state.settings.baseCurrency, state).filter((d) => !only || only(d.member));
  const collect = state.settings.collectCurrency ?? state.settings.baseCurrency;
  return (
    <div>
      {dues.map((d) => {
        const collection = memberCollection(s, d.member, memberUnpaidFrom(s, d.member), collect);
        return (
          <div
            key={d.member.id}
            className="member"
            role={ro ? undefined : 'button'}
            tabIndex={ro ? undefined : 0}
            onClick={(e) => {
              if (!ro && !(e.target as HTMLElement).closest('button')) {
                e.stopPropagation();
                onMember(d.member);
              }
            }}
            onKeyDown={(e) => {
              if (!ro && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                e.stopPropagation();
                onMember(d.member);
              }
            }}
          >
            {/* 一行称呼，一行动态日期：欠款写「应收 某日」，已结清写「下次应收 某日」；账号、周期在合租详情表格里看 */}
            <button className="member-info" disabled={ro} onClick={() => onMember(d.member)}>
              <div className="icon-text" style={{ fontWeight: 600, fontSize: 14 }}>
                <PersonAvatar p={personFor(state, d.member.personId, d.member.name)} size={28} />
                <span className="text-ellipsis member-label">{d.member.name || t('family.pool.unnamed')}</span>
                {d.member.left && d.member.left <= today && <span className="badge">{t('family.pool.leftOn', { date: cnDate(d.member.left) })}</span>}
              </div>
              <div className="muted member-dates">
                <span className={`text-ellipsis ${d.periodsOwed > 0 && collection.from <= today ? 'owe' : ''}`}>
                  {d.member.exempt
                    ? (d.member.note ?? t('family.pool.exemptNote'))
                    : d.member.left && collection.from >= d.member.left
                      ? t('family.pool.leftOn', { date: cnDateAuto(d.member.left, today) })
                      : t(d.periodsOwed > 0 ? 'family.pool.dueOn' : 'family.pool.nextDueOn', { date: cnDateAuto(collection.from, today) })}
                </span>
              </div>
            </button>
            <div className="member-amount num" style={{ textAlign: 'right', fontSize: 13.5 }}>
              {d.member.exempt ? (
                <span className="muted" style={{ fontWeight: 600 }}>
                  {t('family.pool.exempt')}
                </span>
              ) : d.periodsOwed > 0 ? (
                <b style={{ color: 'var(--orange)' }}>{money(collection.amount, collection.currency)}</b>
              ) : (
                <span className="muted">{t('family.pool.settled')}</span>
              )}
            </div>
            {/* 本期已收过的不再显示「收款」；要补记点这一行打开成员资料 */}
            {!ro && !d.member.exempt && d.periodsOwed > 0 && (
              <button className={`btn ${d.periodsOwed > 0 ? 'primary' : ''}`} onClick={() => onMember(d.member, true)}>
                <Icon name="check" /> {t('family.pool.collect')}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 只上移所有行共有的备注信息；无法识别的自由备注原样保留。 */
function receiptNotes(notes: (string | undefined)[]) {
  const raw = notes.map((note) => note ?? '');
  // 历史收款的次数/周期存在备注中，不从今天的成员收费标准反推历史。
  const parts = raw.map((note) => /^(第\s*\d+\s*次收款|Collection\s*#?\d+)(?:\s*[（(]([^（）()]+)[）)])?\s*(?:[·，,:：；;]\s*)?([\s\S]*)$/i.exec(note));
  if (raw.every((note) => note === raw[0])) {
    return { common: parts[0] ? parts[0].slice(1).filter(Boolean).join(' · ') : (raw[0] ?? ''), rows: raw.map(() => '') };
  }
  const commonNo = parts[0]?.[1] && parts.every((p) => p?.[1] === parts[0]![1]) ? parts[0][1] : '';
  const commonCycle = parts[0]?.[2] && parts.every((p) => p?.[2] === parts[0]![2]) ? parts[0][2] : '';
  if (!commonNo && !commonCycle) return { common: '', rows: raw };
  return {
    common: [commonNo, commonCycle].filter(Boolean).join(' · '),
    rows: parts.map((p) => [commonNo ? '' : p?.[1], commonCycle ? '' : p?.[2], p?.[3]].filter(Boolean).join(' · ')),
  };
}

/** 宽屏成员表：组头与成员共用列宽，账号直接取成员关系记录。 */
function MemberTable({
  state,
  s,
  today,
  ro,
  onMember,
  groups,
  groupOf,
}: {
  state: AppState;
  s: Subscription;
  today: string;
  ro: boolean;
  onMember: (m: ShareMember, collect?: boolean) => void;
  groups: ReadonlyArray<readonly [string, string, number]>;
  groupOf: (m: ShareMember) => string;
}) {
  const collect = state.settings.collectCurrency ?? state.settings.baseCurrency;
  const dues = memberDues(s, today, collect, state);
  return (
    <table role="table" className="car-member-table" aria-label={t('family.sheet.members')}>
      <thead role="rowgroup">
        <tr role="row">
          <th role="columnheader" scope="col">
            {t('family.sheet.member')}
          </th>
          <th role="columnheader" scope="col">
            {t('family.member.account')}
          </th>
          <th role="columnheader" scope="col">
            {t('family.member.contact')}
          </th>
          <th role="columnheader" scope="col" className="num">
            {t('family.sheet.fee')}
          </th>
          <th role="columnheader" scope="col">
            {t('family.sheet.nextCollection')}
          </th>
          <th role="columnheader" scope="col" className="num">
            {t('family.pool.filter.owe')}
          </th>
          <th role="columnheader" scope="col">
            {t('family.sheet.actions')}
          </th>
        </tr>
      </thead>
      {groups.map(([key, label, n]) => (
        <tbody role="rowgroup" key={key}>
          <tr role="row" className="car-member-group">
            <th role="rowheader" scope="rowgroup" colSpan={7}>
              {label} · {t('family.sheet.people', { count: n })}
            </th>
          </tr>
          {dues
            .filter((d) => groupOf(d.member) === key)
            .map((d) => {
              const m = d.member;
              const collection = memberCollection(s, m, memberUnpaidFrom(s, m), collect);
              const rate = memberFee(state, s, m, collection.from);
              const next = !m.exempt && (!m.left || collection.from < m.left);
              return (
                <tr
                  role="row"
                  key={m.id}
                  className="car-member-row"
                  tabIndex={ro ? undefined : 0}
                  aria-label={m.name || t('family.pool.unnamed')}
                  onClick={() => !ro && onMember(m)}
                  onKeyDown={(e) => {
                    if (!ro && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onMember(m);
                    }
                  }}
                >
                  <td role="cell">
                    <span className="car-member-name">
                      <PersonAvatar p={personFor(state, m.personId, m.name)} size={28} />
                      <span className="text-ellipsis" title={m.name}>
                        {m.name || t('family.pool.unnamed')}
                      </span>
                    </span>
                    {m.left && m.left <= today && <small className="muted">{t('family.pool.leftOn', { date: cnDate(m.left) })}</small>}
                  </td>
                  <td role="cell" className="muted">
                    <span className="text-ellipsis" title={m.account}>
                      {m.account || t('family.member.accountEmpty')}
                    </span>
                  </td>
                  <td role="cell" className="muted">
                    {/* 只写联系方式本身，渠道名放在悬停提示里 */}
                    <span className="text-ellipsis" title={contactText(m)}>
                      {m.account && m.account === (m.contact ?? m.tg) ? '—' : contactValue(m) || '—'}
                    </span>
                  </td>
                  <td role="cell" className="num">
                    {m.exempt ? '—' : money(rate.amount, rate.currency)}
                  </td>
                  {/* 已付至只比下次应收早一天，只留下次应收；到期未收用橙色 */}
                  <td role="cell" className={d.periodsOwed > 0 && collection.from <= today ? 'warn' : 'muted'}>
                    {next ? cnDateAuto(collection.from, today) : '—'}
                  </td>
                  <td role="cell" className="num">
                    {m.exempt ? (
                      <span className="muted">{t('family.pool.exempt')}</span>
                    ) : d.periodsOwed > 0 ? (
                      <b className="warn">{money(d.owed, d.currency)}</b>
                    ) : (
                      <span className="muted">{t('family.pool.settled')}</span>
                    )}
                  </td>
                  <td role="cell">
                    {!ro && !m.exempt && d.periodsOwed > 0 && (
                      <button
                        className="btn primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMember(m, true);
                        }}
                      >
                        {t('family.pool.collect')}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
        </tbody>
      ))}
    </table>
  );
}

/**
 * 合租弹窗：一辆车的全部信息。上面是基本信息和指标，中间是成员与收款，下面是历来所有收款；
 * 订阅本身（价格、阶段、扣款）点「查看订阅详情」切过去
 */
export function CarSheet({
  state,
  s,
  today,
  ro,
  book,
  onClose,
  onOpenSub,
  onMember,
}: {
  state: AppState;
  s: Subscription;
  today: string;
  ro: boolean;
  book: ReturnType<typeof carLedger>;
  onClose: () => void;
  onOpenSub: () => void;
  onMember: (m?: ShareMember, collect?: boolean) => void;
}) {
  const base = state.settings.baseCurrency;
  const sh = s.share!;
  const st = effectiveStatus(s, today);
  const stopped = ['ended', 'terminated'].includes(st);
  const next = nextCharge(s, addDays(today, 1));
  const onboard = sh.members.filter((m) => memberAboard(m, today));
  const free = Math.max(0, sh.seats - 1 - onboard.length);
  const owe = memberDues(s, today, state.settings.collectCurrency ?? state.settings.baseCurrency, state).filter((d) => d.periodsOwed > 0).length;
  const fmt = (v: number) => flow(v, base, { compact: true });
  const rule = carRule(state, s, today);
  const [editingRule, setEditingRule] = useState(false);
  const profit = -book.yearNet;
  const actual = -book.net;
  const groupOf = (m: ShareMember) => (m.exempt ? 'exempt' : `m${memberBillMonths(s, m, today)}`);
  const memberGroups = [...new Set(sh.members.map(groupOf))]
    .sort((a, b) => (a === 'exempt' ? 1 : b === 'exempt' ? -1 : Number(a.slice(1)) - Number(b.slice(1))))
    .map((k) => [k, k === 'exempt' ? t('family.pool.exempt') : billLabel(Number(k.slice(1))), sh.members.filter((m) => groupOf(m) === k).length] as const);
  // 历来所有收款，按这笔钱覆盖的那一期分组（同一期的人排在一起），新的期在前；已退出的成员也保留
  const receipts = sh.members.flatMap((m) => (m.payments ?? []).map((p) => ({ m, p, base: toBaseAt(state, p.amount, p.currency, p.date) })));
  const total = receipts.reduce((a, r) => a + r.base, 0);
  /** 期间：两端都在今年只写月日；只要有一端不在今年，两端都带年份，免得看成倒序 */
  // 分组条的区间一律带年份，跨年与不跨年的组格式一致
  const range = (a: string, b: string) => `${cnDateFull(a)} – ${cnDateFull(b)}`;
  // 我付出去的：发起合租以来这个订阅的每次扣款（没记发起日期就从订阅开始算），按年分组
  const [tab, setTab] = useState<'in' | 'out'>('in');
  const [openIn, setOpenIn] = useState<Set<string>>(() => new Set());
  const [openOut, setOpenOut] = useState<Set<string>>(() => new Set());
  const toggleGroup = (key: string, open: Set<string>, setOpen: (next: Set<string>) => void) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpen(next);
  };
  const tableHead = (columns: string[], keys: string[], open: Set<string>, setOpen: (next: Set<string>) => void) => {
    const allOpen = keys.length > 0 && keys.every((key) => open.has(key));
    return (
      <button
        type="button"
        className="ld-row ld-th car-ledger-head"
        aria-expanded={allOpen}
        aria-label={`${columns.join(' · ')} · ${t(allOpen ? 'family.sheet.collapseAll' : 'family.sheet.expandAll')}`}
        disabled={!keys.length}
        onClick={() => setOpen(new Set(allOpen ? [] : keys))}
      >
        <span>{columns[0]}</span>
        <span>{columns[1]}</span>
        <span>{columns[2]}</span>
      </button>
    );
  };
  const outs = chargesBetween(s, book.since ?? s.start, today, today)
    .filter((c) => c.kind !== 'failed')
    .map((c) => ({ c, base: chargeValue(state, c) }))
    .reverse();
  const outTotal = outs.reduce((a, r) => a + r.base, 0);
  const outYears = [...new Set(outs.map((r) => r.c.date.slice(0, 4)))].map((y) => {
    const list = outs.filter((r) => r.c.date.startsWith(y));
    return { y, list, sum: list.reduce((a, r) => a + r.base, 0) };
  });
  const byPeriod = new Map<string, typeof receipts>();
  for (const r of receipts) {
    const k = `${r.p.from ?? ''}|${r.p.until}`;
    byPeriod.set(k, [...(byPeriod.get(k) ?? []), r]);
  }
  const periods = [...byPeriod.entries()]
    .map(([key, list]) => ({
      key,
      from: list[0].p.from,
      until: list[0].p.until,
      list: list.sort((a, b) => a.p.date.localeCompare(b.p.date)),
      sum: list.reduce((a, r) => a + r.base, 0),
      notes: receiptNotes(list.map((r) => r.p.note)),
    }))
    .sort((a, b) => (b.from ?? b.until).localeCompare(a.from ?? a.until));
  return (
    <Sheet title={t('family.sheet.title')} onClose={onClose}>
      <div className="stack">
        <div className="ld-head">
          <SubIcon sub={s} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ph-name text-ellipsis">
              <NameLink onClick={onOpenSub}>{s.name}</NameLink>
            </div>
            <div className="muted ph-meta">
              {money(s.price, s.currency)} {cycleLabel(s.cycle)}
              {next && !stopped ? ` · ${t('family.pool.next', { date: cnDate(next) })}` : ''}
            </div>
          </div>
          <StatusPill tone={stopped ? 'stop' : owe ? 'owe' : 'ok'}>
            {stopped ? t('family.pool.filter.ended') : owe ? t('family.pool.owedN', { count: owe }) : t('family.pool.settled')}
          </StatusPill>
        </div>

        <div className="ld-top">
          <Group>
            <Cell label={t('family.sheet.seats')}>
              {t('family.sheet.seatsVal', { used: onboard.length + 1, total: sh.seats })}
              {free ? ` · ${t('family.pool.seatsFree', { count: free })}` : ''}
            </Cell>
            {/* 车的收款规则：跟随车的成员都按这个收；点开修改 */}
            <Cell label={t('family.rule.title')} onClick={ro ? undefined : () => setEditingRule(true)}>
              {t('family.rule.summary', {
                rule: perBill('family.pool.perFee', rule.billEvery, { fee: money(rule.fee, rule.currency) }),
                date: cnDate(collectionAnchor(s)),
              })}
            </Cell>
            <Cell label={t('family.sheet.since')}>{book.since ? cnDateFull(book.since) : '—'}</Cell>
            <Cell label={stopped ? t('proxy.stoppedAt') : t('proxy.nextCharge')}>
              {stopped ? (s.end ? cnDateFull(s.end) : '—') : next ? cnDateFull(next) : '—'}
            </Cell>
            {s.manageUrl && (
              <Cell label={t('family.pool.manage')} onClick={() => window.open(s.manageUrl, '_blank', 'noopener')}>
                {t('family.pool.manageTitle')}
              </Cell>
            )}
            <Cell label={t('proxy.subscription')} onClick={onOpenSub}>
              {t('proxy.viewDetail')}
            </Cell>
          </Group>
          <div className="proxy-facts four car-sheet-facts">
            <div>
              <small>{t('family.facts.cost')}</small>
              <b>{fmt(-book.yearCost)}</b>
            </div>
            <div>
              <small>{t('family.facts.income')}</small>
              <b className="green">{fmt(book.yearIncome)}</b>
            </div>
            <div>
              <small>{profit < 0 ? t('family.facts.loss') : t('family.facts.profit')}</small>
              <b className={profit >= 0 ? 'done' : 'loss'}>{fmt(profit)}</b>
            </div>
            <div>
              <small>{t('family.facts.sinceNone')}</small>
              {/* 还没收过款：只说付出了多少，别显示成「亏」或「赚 ¥0」 */}
              {book.received > 0 ? (
                <b className={actual >= 0 ? 'done' : 'loss'}>
                  {actual >= 0 ? t('family.facts.gain', { amount: fmt(actual) }) : t('family.facts.lost', { amount: fmt(actual) })}
                </b>
              ) : (
                <>
                  <b>{t('family.sheet.paidOut', { amount: fmt(-book.paid) })}</b>
                  <em className="warn">{t('family.sheet.noReceiptsYet')}</em>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="car-sheet-sec row">
          <CardTitle>{t('family.sheet.members')}</CardTitle>
          {!ro && free > 0 && !stopped && (
            <button className="btn tinted" onClick={() => onMember()}>
              <Icon name="plus" /> {t('family.pool.addMemberSeats', { count: free })}
            </button>
          )}
        </div>
        <div className="car-members">
          <MemberTable state={state} s={s} today={today} ro={ro} onMember={onMember} groups={memberGroups} groupOf={groupOf} />
          <div className="car-member-cards">
            {memberGroups.map(([key, label, n]) => (
              <div key={key} className="car-sheet-members">
                <div className="car-group-head">
                  {label} · {t('family.sheet.people', { count: n })}
                </div>
                <MemberRows state={state} s={s} today={today} ro={ro} onMember={onMember} only={(m) => groupOf(m) === key} />
              </div>
            ))}
          </div>
        </div>

        {/* 收进来的和我付出去的左右切换，两边对照看这辆车的钱 */}
        <div className="car-sheet-sec row">
          <Seg
            small
            value={tab}
            onChange={setTab}
            options={[
              ['in', t('family.sheet.tabIn', { count: receipts.length })],
              ['out', t('family.sheet.tabOut', { count: outs.length })],
            ]}
          />
          <span className={tab === 'in' ? 'green' : undefined}>{tab === 'in' ? fmt(total) : fmt(-outTotal)}</span>
        </div>
        {tab === 'out' ? (
          <div className="ld-table car-receipts car-receipts-out">
            {tableHead(
              [t('family.sheet.chargeDate'), t('proxy.table.charged'), t('proxy.table.cost')],
              outYears.map((g) => g.y),
              openOut,
              setOpenOut,
            )}
            {outYears.map((g) => (
              <Fragment key={g.y}>
                <button
                  type="button"
                  className="ld-row car-period"
                  aria-expanded={openOut.has(g.y)}
                  aria-label={t('calendar.yearTitle', { year: g.y })}
                  onClick={() => toggleGroup(g.y, openOut, setOpenOut)}
                >
                  <span className="car-period-title">
                    <b>{t('calendar.yearTitle', { year: g.y })}</b>
                  </span>
                  <span>{t('family.sheet.groupSum', { count: g.list.length, amount: fmt(-g.sum) })}</span>
                </button>
                {openOut.has(g.y) &&
                  g.list.map(({ c, base: v }, i) => (
                    <div key={`${c.date}-${i}`} className="ld-row">
                      <span className="ld-date">{cnDate(c.date)}</span>
                      <span>
                        <b className={c.amount < 0 ? 'green' : undefined}>{flow(-c.amount, c.currency)}</b>
                        {c.kind === 'refund' && <small>{t('family.sheet.refund')}</small>}
                      </span>
                      <span>
                        <b className={v < 0 ? 'green' : undefined}>{flow(-v, base)}</b>
                      </span>
                    </div>
                  ))}
              </Fragment>
            ))}
            {outs.length === 0 && (
              <div className="car-empty">
                <b>{t('family.sheet.noCharges')}</b>
              </div>
            )}
          </div>
        ) : (
          <div className="ld-table car-receipts">
            {tableHead(
              [t('family.sheet.member'), t('family.sheet.date'), t('family.sheet.amount')],
              periods.map((g) => g.key),
              openIn,
              setOpenIn,
            )}
            {periods.map((g) => (
              <Fragment key={g.key}>
                <button
                  type="button"
                  className="ld-row car-period"
                  aria-expanded={openIn.has(g.key)}
                  aria-label={[g.from ? range(g.from, g.until) : t('family.pool.paidUntil', { date: cnDateAuto(g.until, today) }), g.notes.common]
                    .filter(Boolean)
                    .join(' · ')}
                  onClick={() => toggleGroup(g.key, openIn, setOpenIn)}
                >
                  <span className="car-period-title">
                    <b>{g.from ? range(g.from, g.until) : t('family.pool.paidUntil', { date: cnDateAuto(g.until, today) })}</b>
                    {g.notes.common && <small>{g.notes.common}</small>}
                  </span>
                  <span className="green">{t('family.sheet.groupSum', { count: g.list.length, amount: fmt(g.sum) })}</span>
                </button>
                {openIn.has(g.key) &&
                  g.list.map(({ m, p, base: v }, i) => (
                    <button key={`${m.id}-${p.date}-${i}`} className="ld-row" disabled={ro} onClick={() => onMember(m)}>
                      <span>
                        <b>{m.name || t('family.pool.unnamed')}</b>
                        {g.notes.rows[i] && <small>{g.notes.rows[i]}</small>}
                      </span>
                      {/* 组标题已写年份，组内只写月日；和这一期不在同一年时才带年份 */}
                      <span className="ld-date">{p.date.slice(0, 4) === (g.from ?? g.until).slice(0, 4) ? cnDate(p.date) : cnDateFull(p.date)}</span>
                      <span>
                        <b className="green">{flow(p.amount, p.currency)}</b>
                        {p.currency !== base && <small style={{ color: 'var(--green)' }}>≈ {flow(v, base)}</small>}
                      </span>
                    </button>
                  ))}
              </Fragment>
            ))}
            {receipts.length === 0 && (
              <div className="car-empty">
                <b>{t('family.facts.noRecords')}</b>
                <span>{t('family.sheet.receiptHint')}</span>
              </div>
            )}
          </div>
        )}
      </div>
      {editingRule && createPortal(<CarRuleSheet state={state} s={s} today={today} rule={rule} onClose={() => setEditingRule(false)} />, document.body)}
    </Sheet>
  );
}

/** 常见家庭方案的席位数（含自己） */
function defaultSeats(name: string): number {
  if (/1password/i.test(name)) return 5;
  if (/spotify|youtube|apple one|icloud|netflix/i.test(name)) return 6;
  return 6;
}

/** 一步转为合租：选身份与席位，保存后在上面补成员 */
function ConvertSheet({ s, today, onClose }: { s: Subscription; today: string; onClose: () => void }) {
  const [role, setRole] = useState<'owner' | 'member'>('owner');
  const [seats, setSeats] = useState(defaultSeats(s.name));
  const [ownerName, setOwnerName] = useState('');
  const perHead = seats > 0 ? s.price / seats : s.price;
  return (
    <Sheet
      narrow
      title={t('family.convert.title', { name: s.name })}
      onClose={onClose}
      foot={
        <>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            {t('family.convert.cancel')}
          </button>
          <button
            className="btn primary"
            onClick={() =>
              run(
                async () => {
                  await saveSub({
                    ...s,
                    share:
                      role === 'owner'
                        ? { role, seats, members: [], since: today }
                        : { role, seats, members: [], ownerName: ownerName.trim() || undefined, since: today },
                  });
                  onClose();
                },
                role === 'owner' ? t('family.convert.toastOwner') : t('family.convert.toastMember'),
              )
            }
          >
            {t('family.convert.submit')}
          </button>
        </>
      }
    >
      <div className="stack">
        <Seg
          value={role}
          onChange={setRole}
          options={[
            ['owner', t('family.convert.roleOwner')],
            ['member', t('family.convert.roleMember')],
          ]}
        />
        <Group foot={role === 'owner' ? t('family.convert.footOwner', { count: seats, amount: money(perHead, s.currency) }) : t('family.convert.footMember')}>
          <Cell label={t('family.convert.seats')}>
            <input
              className="num"
              inputMode="numeric"
              value={seats}
              onChange={(e) => setSeats(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))}
            />
          </Cell>
          {role === 'member' && (
            <Cell label={t('family.convert.owner')}>
              <input value={ownerName} placeholder={t('family.convert.ownerPh')} onChange={(e) => setOwnerName((e.target as HTMLInputElement).value)} />
            </Cell>
          )}
        </Group>
      </div>
    </Sheet>
  );
}

/**
 * 合租账本，像一张小利润表：订阅一年花多少（成本）、成员一年交多少（收入）、两者之差（利润）。
 * 利润为负就是我自己用的那部分；下面一行是发起以来实际付出和收回的钱。
 */
/** 车卡上的数字：这辆车从发起到现在一共付出、收回多少，赚还是亏；按年的在弹窗里看 */
function CarFacts({ book, base }: { book: ReturnType<typeof carLedger>; base: string }) {
  const fmt = (v: number) => flow(v, base, { compact: true });
  const actual = -book.net;
  return (
    <div className="car-book">
      <div className="car-facts">
        <div>
          <small>{t('family.facts.paidAll')}</small>
          <b>{fmt(-book.paid)}</b>
        </div>
        <div>
          <small>{t('family.facts.receivedAll')}</small>
          <b className="green">{fmt(book.received)}</b>
        </div>
        <div>
          {book.received > 0 ? (
            <>
              <small>{actual >= 0 ? t('family.facts.netGain') : t('family.facts.netLoss')}</small>
              <b className={actual >= 0 ? 'gain' : 'loss'}>{fmt(actual)}</b>
            </>
          ) : (
            <>
              <small>{t('family.facts.sinceNone')}</small>
              <b className="warn">{t('family.sheet.noReceiptsYet')}</b>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 修改车的收款规则：周期、每次收多少、统一收款日；跟随车的成员从生效日起改用新标准 */
function CarRuleSheet({ state, s, today, rule, onClose }: { state: AppState; s: Subscription; today: string; rule: CarRule; onClose: () => void }) {
  const [draft, setDraft] = useState<CarRule>(rule);
  const [from, setFrom] = useState(today);
  const [anchor, setAnchor] = useState(collectionAnchor(s));
  const followers = (s.share?.members ?? []).filter((m) => followsCar(state, s, m, today) && (!m.left || m.left > today)).length;
  const save = () =>
    run(async () => {
      const next = applyCarRule(state, s, draft, from, today);
      await saveSub({ ...next, share: { ...next.share!, collectFrom: anchor } });
      onClose();
    }, t('family.member.saved'));
  return (
    <Sheet
      narrow
      title={t('family.rule.sheetTitle')}
      onClose={onClose}
      foot={
        <>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            {t('family.member.cancel')}
          </button>
          <button className="btn primary" disabled={!(draft.fee >= 0)} onClick={() => void save()}>
            {t('family.member.save')}
          </button>
        </>
      }
    >
      <div className="stack">
        <Group foot={t('family.rule.applyNote', { count: followers })}>
          <div className="cell">
            <Seg
              value={String(draft.billEvery)}
              onChange={(v) => setDraft({ ...draft, billEvery: Number(v) })}
              options={[
                ['1', t('family.member.seg.m1')],
                ['3', t('family.member.seg.m3')],
                ['6', t('family.member.seg.m6')],
                ['12', t('family.member.seg.m12')],
              ]}
            />
          </div>
          <Cell label={perBill('family.member.feeLabel', draft.billEvery)}>
            <span className="contact-field">
              <CurrencySelect value={draft.currency} onChange={(c) => setDraft({ ...draft, currency: c })} ariaLabel={t('family.member.feeCcyAria')} />
              <NumInput ccy={draft.currency} className="num" value={draft.fee} placeholder="0" onValue={(n) => setDraft({ ...draft, fee: n ?? 0 })} />
            </span>
          </Cell>
          <Cell label={t('family.rule.from')}>
            <DatePicker value={from} onChange={(v) => v && setFrom(v)} />
          </Cell>
          <Cell label={t('family.rule.anchor')}>
            <DatePicker value={anchor} onChange={(v) => v && setAnchor(v)} />
          </Cell>
        </Group>
      </div>
    </Sheet>
  );
}
