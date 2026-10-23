import { CopyImageButton } from '../components/CopyImageButton.tsx';
import { copyParts } from '../components/copy.tsx';
import { PersonAvatar, personFor } from '../components/PersonAvatar.tsx';
import { ShareAvatars } from '../components/ShareAvatars.tsx';
import {
  addDays,
  addMonths,
  chargesBetween,
  collectionAnchor,
  cycleLabel,
  diffDays,
  effectiveStatus,
  memberDues,
  nextCharge,
  memberBillMonths,
  memberCollection,
  memberUnpaidFrom,
} from '../../../shared/billing.ts';
import { Fragment, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { carpoolSnapshot } from './carpool-snapshot.ts';
import { createPortal } from 'react-dom';
import { flow, billLabel, cnDate, cnDateAuto, cnDateFull, money, monthLabel } from '../../../shared/format.ts';
import { locale, t } from '../../../shared/i18n.ts';
import { tx } from '../i18n.ts';
import { chargeValue, convertOn } from '../../../shared/fx.ts';
import type { AppState, MemberPayment, ShareMember, Subscription } from '../../../shared/types.ts';
import { base } from '../base.ts';
import { SortControl } from '../components/SortControl.tsx';
import { carLedger, MemberBillingSheet, MemberSheet, memberFee, memberSegments, memberStatus, perBill } from './Members.tsx';
import { applyCarRule, carRule, followsCar, memberCashFlows, memberFlowValue } from '../../../shared/carpool.ts';
import type { CarRule } from '../../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { CurrencySelect } from '../components/Picker.tsx';
import {
  MetricCards,
  Metric,
  CardTitle,
  Amount,
  Cell,
  Group,
  Icon,
  IconButton,
  NameLink,
  NumInput,
  Seg,
  Sheet,
  StatusPill,
  SubIcon,
  tipProps,
  Toolbar,
  useWidth,
} from '../components/ui.tsx';
import { toBase } from '../derive.ts';
import { run, saveSub, usePref } from '../store.ts';
import { FamilyTabs } from './People.tsx';
import { carpoolRoster, carpoolTimeline } from '../../../shared/carpool-timeline.ts';
import { useTimelinePan } from './member-timeline-pan.ts';

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

type CarSort = 'owed' | 'net' | 'next' | 'name';
const isCarSort = (v: string): v is CarSort => ['owed', 'net', 'next', 'name'].includes(v);
/** 默认方向：待收多的在前、亏得多的在前、扣款近的在前、名称 A→Z */
const CAR_SORT_DIR: Record<CarSort, 'asc' | 'desc'> = { owed: 'desc', net: 'asc', next: 'asc', name: 'asc' };

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
  const books = new Map([...owned, ...ended].map((s) => [s.id, carLedger(state, s, today)]));
  // 排序与方向存在服务端；已停止的车始终排在最后。默认待收多的在前
  const [sort, setSort] = usePref<CarSort>('car-sort', 'owed', isCarSort);
  const [dir, setDir] = usePref<'asc' | 'desc'>('car-dir', CAR_SORT_DIR[sort], (v): v is 'asc' | 'desc' => v === 'asc' || v === 'desc');
  const chooseSort = (k: CarSort) => {
    setSort(k);
    setDir(CAR_SORT_DIR[k]);
  };
  const nextOf = (s: Subscription) => nextCharge(s, addDays(today, 1)) ?? '9999-12-31';
  const owedOf = (s: Subscription) =>
    memberDues(s, today, state.settings.collectCurrency ?? state.settings.baseCurrency, state)
      .filter((d) => d.periodsOwed > 0)
      .reduce((a, d) => a + (Number.isFinite(d.owed) ? toBase(state, d.owed, d.currency) : 0), 0);
  const netOf = (s: Subscription) => -books.get(s.id)!.yearNet;
  const asc = (a: Subscription, b: Subscription) =>
    sort === 'owed'
      ? owedOf(a) - owedOf(b)
      : sort === 'net'
        ? netOf(a) - netOf(b)
        : sort === 'name'
          ? a.name.localeCompare(b.name, locale())
          : nextOf(a).localeCompare(nextOf(b));
  const shown = [...groups[filter]].sort(
    (a, b) => Number(!live(a)) - Number(!live(b)) || (dir === 'asc' ? asc(a, b) : asc(b, a)) || nextOf(a).localeCompare(nextOf(b)),
  );
  const yearNet = owned.reduce((a, s) => a + books.get(s.id)!.yearNet, 0);
  const yearIncome = owned.reduce((a, s) => a + books.get(s.id)!.yearIncome, 0);
  const owedAll = [...owned, ...ended]
    .flatMap((s) => memberDues(s, today, state.settings.collectCurrency ?? state.settings.baseCurrency, state))
    .filter((d) => d.periodsOwed > 0);
  const owedSum = owedAll.reduce((a, d) => a + (Number.isFinite(d.owed) ? toBase(state, d.owed, d.currency) : NaN), 0);
  const ro = !!state.readonly;
  const [convert, setConvert] = useState<Subscription | null>(null);
  const [member, setMember] = useState<{ s: Subscription; m?: ShareMember; collect?: boolean; full?: boolean; pay?: MemberPayment } | null>(null);
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
        <SortControl
          value={sort}
          dir={dir}
          onSort={chooseSort}
          onDir={setDir}
          options={[
            { value: 'owed', label: t('family.sort.owed') },
            { value: 'net', label: t('family.sort.net') },
            { value: 'next', label: t('list.sort.next') },
            { value: 'name', label: t('list.sort.name') },
          ]}
        />
        {!ro && <FamilyTabs tab="plans" />}
      </Toolbar>
      <div className="page fade-in stack">
        <MetricCards>
          <Metric
            label={yearNet < 0 ? t('family.pool.netGain') : t('family.pool.netCost')}
            value={<Amount value={-yearNet} ccy={base} />}
            valueStyle={{ color: yearNet < 0 ? 'var(--green)' : undefined }}
            note={t('family.pool.yearIncome', { amount: flow(yearIncome, base, { compact: true }) })}
            noteStyle={{ color: 'var(--green)' }}
          />
          <Metric
            label={t('family.pool.owed')}
            value={<Amount plain value={owedSum} ccy={base} />}
            valueStyle={{ color: owedSum > 0 ? 'var(--orange)' : undefined }}
            note={t('family.pool.owedSub', { count: owedAll.length })}
          />
          <Metric
            label={t('family.pool.count')}
            value={
              <span className="amt car-plan-count">
                <span>
                  {owned.length}
                  <small>{copyParts(t('family.pool.countStarted'))}</small>
                </span>
                <span>
                  {joined.length}
                  <small>{t('family.pool.countJoined')}</small>
                </span>
              </span>
            }
          />
        </MetricCards>

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
                const free = carpoolRoster(s, today).vacancies;
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
                          {copyParts(next && live(s) ? `\n${t('family.pool.next', { date: cnDate(next) })}` : '')}
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
                {copyParts(t('family.pool.payTo', { name: s.share?.ownerName ?? t('family.pool.ownerDefault'), amount: flow(-s.price, s.currency) }))}
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
            onPayment={(m, pay) => setMember({ s: sheetSub, m, pay })}
          />
        )}
        {member?.m && !member.collect && !member.full && !member.pay && (
          <MemberBillingSheet
            state={state}
            s={state.subscriptions.find((x) => x.id === member.s.id) ?? member.s}
            member={member.m}
            onClose={() => setMember(null)}
            onMore={() => setMember({ ...member, full: true })}
          />
        )}
        {member && (!member.m || member.collect || member.full || member.pay) && (
          <MemberSheet
            state={state}
            s={state.subscriptions.find((x) => x.id === member.s.id) ?? member.s}
            member={member.m}
            collect={member.collect}
            editPay={member.pay}
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
  timeline,
  includeLeft = false,
  masked = false,
  win,
}: {
  state: AppState;
  s: Subscription;
  today: string;
  ro: boolean;
  onMember: (m: ShareMember, collect?: boolean) => void;
  /** 只列一部分成员（合租弹窗里按收费周期分组时用） */
  only?: (m: ShareMember) => boolean;
  /** 合租详情里在每人下方画时间条（与宽屏表格一致） */
  timeline?: boolean;
  includeLeft?: boolean;
  masked?: boolean;
  win?: ReturnType<typeof carpoolTimeline>;
}) {
  const dues = memberDues(s, today, state.settings.collectCurrency ?? state.settings.baseCurrency, state).filter(
    (d) => (includeLeft || !d.member.left || d.member.left > today) && (!only || only(d.member)),
  );
  const collect = state.settings.collectCurrency ?? state.settings.baseCurrency;
  return (
    <div>
      {dues.map((d) => {
        const collection = memberCollection(s, d.member, memberUnpaidFrom(s, d.member), collect);
        return (
          <div
            key={d.member.id}
            className={`member ${d.member.left && d.member.left <= today ? 'departed' : ''}`}
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
            <button className="member-info" aria-label={masked ? t('family.sheet.hiddenMember') : undefined} disabled={ro} onClick={() => onMember(d.member)}>
              <div className="icon-text" style={{ fontWeight: 600, fontSize: 'var(--fs-2)' }}>
                {masked ? (
                  <span className="car-private-avatar" style={{ width: 28, height: 28 }} />
                ) : (
                  <PersonAvatar p={personFor(state, d.member.personId, d.member.name)} size={28} />
                )}
                <span className={`text-ellipsis member-label ${masked ? 'car-private' : ''}`} aria-hidden={masked || undefined}>
                  {d.member.name || t('family.pool.unnamed')}
                </span>
                {d.member.left && d.member.left <= today && <span className="badge">{t('family.pool.leftOn', { date: cnDate(d.member.left) })}</span>}
              </div>
              <div className="muted member-dates">
                <span className={`text-ellipsis ${d.periodsOwed > 0 && collection.from <= today ? 'owe' : ''}`}>
                  {copyParts(
                    d.member.exempt
                      ? masked
                        ? t('family.pool.exemptNote')
                        : (d.member.note ?? t('family.pool.exemptNote'))
                      : d.member.left && collection.from >= d.member.left
                        ? t('family.pool.leftOn', { date: cnDateAuto(d.member.left, today) })
                        : d.periodsOwed > 0 && collection.from < today
                          ? `${t('family.quick.late', { count: diffDays(collection.from, today) })}\n${t('family.pool.dueOn', { date: cnDateFull(collection.from) })}`
                          : d.periodsOwed > 0
                            ? t('family.pool.dueOn', { date: cnDateFull(collection.from) })
                            : (() => {
                                const p = memberStatus(state, s, d.member, today).period;
                                return t('family.sheet.range', { from: cnDateFull(p.from), until: cnDateFull(p.until) });
                              })(),
                  )}
                </span>
              </div>
            </button>
            <div className="member-amount num" style={{ textAlign: 'right', fontSize: 'var(--fs-2)' }}>
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
            {timeline && win && <MemberTimeline s={s} m={d.member} today={today} win={win} />}
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
    return { common: parts[0] ? parts[0].slice(1).filter(Boolean).join('\n') : (raw[0] ?? ''), rows: raw.map(() => '') };
  }
  const commonNo = parts[0]?.[1] && parts.every((p) => p?.[1] === parts[0]![1]) ? parts[0][1] : '';
  const commonCycle = parts[0]?.[2] && parts.every((p) => p?.[2] === parts[0]![2]) ? parts[0][2] : '';
  if (!commonNo && !commonCycle) return { common: '', rows: raw };
  return {
    common: [commonNo, commonCycle].filter(Boolean).join('\n'),
    rows: parts.map((p) => [commonNo ? '' : p?.[1], commonCycle ? '' : p?.[2], p?.[3]].filter(Boolean).join('\n')),
  };
}

const pct = (d: string, win: { start: string; end: string }) => (diffDays(win.start, d) / Math.max(1, diffDays(win.start, win.end))) * 100;

/** 表头：季度刻度（1、4、7、10 月），1 月处只写年份，其余写月份，标签短、不会重叠 */
function TimelineAxis({ win }: { win: { start: string; end: string } }) {
  const marks: string[] = [];
  for (let d = `${win.start.slice(0, 7)}-01`; d <= win.end; d = addMonths(d, 1))
    if (d >= win.start && ['01', '04', '07', '10'].includes(d.slice(5, 7))) marks.push(d);
  return (
    <span className="mt-viewport mt-axis" aria-label={t('family.sheet.period')}>
      <span className="mt-inner">
        {marks.map((d) => (
          <span key={d} className={`mt-mark ${d.slice(5, 7) === '01' ? 'year' : ''}`} style={{ left: `${pct(d, win)}%` }}>
            {d.slice(5, 7) === '01' ? d.slice(0, 4) : monthLabel(d.slice(0, 7), { year: false })}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * 成员时间条：按这个人自己的周期切出各期，已付实心、该收没收红色斜纹、下一期浅灰斜纹，
 * 一条今天竖线贯穿所有行——周期长短、谁提前付了、谁拖了多久一眼可见。
 */
function MemberTimeline({ s, m, today, win, fee }: { s: Subscription; m: ShareMember; today: string; win: { start: string; end: string }; fee?: string }) {
  const segs = memberSegments(s, m, today, win.start, win.end);
  const label = { paid: t('family.timeline.paid'), due: t('family.timeline.due'), future: t('family.timeline.future'), unused: t('family.timeline.unused') };
  return (
    <span className={`mt-viewport mt-track ${m.exempt ? 'exempt' : ''}`}>
      <span className="mt-inner">
        {segs.map((g) => (
          <i
            key={`${g.from}-${g.kind}`}
            className={`mt-seg ${g.kind}`}
            style={{ left: `${pct(g.from, win)}%`, width: `${Math.max(0.6, pct(addDays(g.until, 1), win) - pct(g.from, win))}%` }}
            {...tipProps(() => (
              <>
                <b>
                  {label[g.kind]}
                  {fee && (
                    <>
                      <span className="copy-gap" aria-hidden="true" />
                      {fee}
                    </>
                  )}
                </b>
                <div>
                  {cnDateFull(g.from)} – {cnDateFull(g.until)}
                </div>
              </>
            ))}
          />
        ))}
        <i className="mt-today" style={{ left: `${pct(today, win)}%` }} />
      </span>
    </span>
  );
}

/** 宽屏成员表：每人的收费（周期、金额、跟随车与否）和收款状态；点一行改收费，点「收款」记一笔。 */
function MemberTable({
  state,
  s,
  today,
  ro,
  onMember,
  win,
  expanded,
  onToggle,
  masked,
}: {
  state: AppState;
  s: Subscription;
  today: string;
  ro: boolean;
  onMember: (m?: ShareMember, collect?: boolean) => void;
  win: ReturnType<typeof carpoolTimeline>;
  expanded: boolean;
  masked: boolean;
  onToggle: () => void;
}) {
  const roster = carpoolRoster(s, today);
  return (
    <table role="table" className="car-member-table" aria-label={t('family.sheet.members')}>
      <thead role="rowgroup">
        <tr role="row" className="table-head">
          <th role="columnheader" scope="col">
            {t('family.sheet.member')}
          </th>
          <th role="columnheader" scope="col">
            {t('family.sheet.fee')}
          </th>
          <th role="columnheader" scope="col" className="mt-head">
            <TimelineAxis win={win} />
          </th>
          <th role="columnheader" scope="col">
            {t('family.sheet.status')}
          </th>
          <th role="columnheader" scope="col">
            {t('family.sheet.actions')}
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {s.share?.role === 'owner' && <OwnerSeat state={state} table />}
        {[
          ...roster.active.filter((m) => !m.exempt),
          ...Array.from({ length: roster.vacancies }, () => null),
          ...roster.active.filter((m) => m.exempt),
          ...(expanded ? roster.departed : []),
        ].map((m, index) => {
          if (!m) return <Vacancy key={`vacancy-${index}`} ro={ro} onAdd={() => onMember()} table />;
          const st = memberStatus(state, s, m, today);
          const rate = memberFee(state, s, m, today);
          const left = !!m.left && m.left <= today;
          return (
            <tr
              role="row"
              key={m.id}
              className="car-member-row"
              data-readonly={ro || undefined}
              tabIndex={ro ? undefined : 0}
              aria-label={masked ? t('family.sheet.hiddenMember') : m.name || t('family.pool.unnamed')}
              onClick={() => !ro && onMember(m)}
              onKeyDown={(e) => {
                if (!ro && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onMember(m);
                }
              }}
            >
              <td role="cell">
                <span
                  className={`car-member-chip ${left ? 'left' : ''}`}
                  {...(masked
                    ? {}
                    : tipProps(() => (
                        <>
                          <b>{m.name || t('family.pool.unnamed')}</b>
                          {m.account && m.account !== m.name && <div>{m.account}</div>}
                          {left && <div>{t('family.pool.leftOn', { date: cnDateFull(m.left!) })}</div>}
                          {!m.exempt && <div className="muted">{t(followsCar(state, s, m, today) ? 'family.rule.follow' : 'family.rule.custom')}</div>}
                        </>
                      )))}
                >
                  {masked ? <span className="car-private-avatar" /> : <PersonAvatar p={personFor(state, m.personId, m.name)} size={24} />}
                  <span className={`text-ellipsis ${masked ? 'car-private' : ''}`} aria-hidden={masked || undefined}>
                    {m.name || t('family.pool.unnamed')}
                  </span>
                </span>
              </td>
              <td role="cell">
                {m.exempt ? (
                  <span className="muted">{t('family.pool.exempt')}</span>
                ) : (
                  <span className="car-member-fee">
                    {perBill('family.pool.perFee', memberBillMonths(s, m, today), { fee: money(rate.amount, rate.currency) })}
                  </span>
                )}
              </td>
              <td role="cell">
                <MemberTimeline s={s} m={m} today={today} win={win} fee={money(rate.amount, rate.currency)} />
              </td>
              <td role="cell">
                {m.exempt || st.gone ? (
                  <span className="muted">—</span>
                ) : st.owe ? (
                  <span className="car-member-lines">
                    <b className={st.late > 0 ? 'late' : 'warn'}>{st.late > 0 ? t('family.quick.late', { count: st.late }) : t('family.pool.owed')}</b>
                    <small className="muted">{t('family.pool.owedAmount', { amount: st.owed })}</small>
                  </span>
                ) : (
                  <span className="muted">{t('family.pool.settled')}</span>
                )}
              </td>
              <td role="cell">
                {!ro && !m.exempt && st.owe && (
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
      {roster.departed.length > 0 && (
        <tfoot>
          <tr>
            <td colSpan={5}>
              <DepartedToggle count={roster.departed.length} expanded={expanded} onToggle={onToggle} />
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function DepartedToggle({ count, expanded, onToggle }: { count: number; expanded: boolean; onToggle: () => void }) {
  return (
    <button className="btn car-departed-toggle" aria-expanded={expanded} onClick={onToggle}>
      {t('family.sheet.departed', { count })}
      <Icon name="down" size={14} />
    </button>
  );
}

/** 车主自己占的那一座：不收费、不可点，只表明席位 */
function OwnerSeat({ state, table = false }: { state: AppState; table?: boolean }) {
  const chip = (
    <span className="car-member-chip owner">
      <img className="owner-avatar" src={state.settings.avatar || base('/icons/avatar.png')} alt="" />
      <span className="text-ellipsis">{t('family.pool.me')}</span>
    </span>
  );
  return table ? (
    <tr role="row" className="car-member-row owner-seat">
      <td role="cell">{chip}</td>
      <td role="cell" className="muted">
        {t('family.sheet.ownerFee')}
      </td>
      <td role="cell" />
      <td role="cell" />
      <td role="cell" />
    </tr>
  ) : (
    <div className="member owner-seat">
      {chip}
      <span className="muted">{t('family.sheet.ownerFee')}</span>
    </div>
  );
}

function Vacancy({ ro, onAdd, table = false }: { ro: boolean; onAdd: () => void; table?: boolean }) {
  const props = {
    className: `car-vacancy ${table ? 'car-member-row' : 'member'}`,
    role: table ? 'row' : ro ? undefined : 'button',
    'data-readonly': ro || undefined,
    tabIndex: ro ? undefined : 0,
    'aria-label': t(ro ? 'family.sheet.vacancy' : 'family.sheet.addMember'),
    onClick: () => !ro && onAdd(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!ro && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onAdd();
      }
    },
  };
  const chip = (
    <span className="car-member-chip vacancy">
      <span className="vacancy-label">{t('family.sheet.vacancy')}</span>
      <span className="vacancy-add">{t('family.sheet.addMember')}</span>
    </span>
  );
  const track = (
    <span className="mt-viewport mt-track vacant">
      <span>{t('family.sheet.vacancyTrack')}</span>
    </span>
  );
  return table ? (
    <tr {...props}>
      <td role="cell">{chip}</td>
      <td role="cell" />
      <td role="cell">{track}</td>
      <td role="cell" />
      <td role="cell" />
    </tr>
  ) : (
    <div {...props}>
      {chip}
      {track}
    </div>
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
  onPayment,
}: {
  state: AppState;
  s: Subscription;
  today: string;
  ro: boolean;
  book: ReturnType<typeof carLedger>;
  onClose: () => void;
  onOpenSub: () => void;
  onMember: (m?: ShareMember, collect?: boolean) => void;
  /** 收款表点某一笔：直接编辑这笔收款 */
  onPayment?: (m: ShareMember, pay: MemberPayment) => void;
}) {
  const [masked, setMasked] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const base = state.settings.baseCurrency;
  const sh = s.share!;
  const st = effectiveStatus(s, today);
  const stopped = ['ended', 'terminated'].includes(st);
  const next = nextCharge(s, addDays(today, 1));
  const roster = carpoolRoster(s, today);
  const free = roster.vacancies;
  const dues = memberDues(s, today, state.settings.collectCurrency ?? state.settings.baseCurrency, state).filter((d) => d.periodsOwed > 0);
  const owe = dues.length;
  const oweSum = dues.reduce((a, d) => a + convertOn(d.owed, d.currency, base, today, undefined, state.fx), 0);
  const hasPending = oweSum > 0 || !Number.isFinite(oweSum);
  const fmt = (v: number) => flow(v, base, { compact: true });
  const rule = carRule(state, s, today);
  const [editingRule, setEditingRule] = useState(false);
  const [departedOpen, setDepartedOpen] = useState(false);
  const win = carpoolTimeline(s, today, rule.billEvery);
  const timelineRef = useTimelinePan(win);
  // 收款记录默认只列最近几期，期数多时再展开
  const [allPeriods, setAllPeriods] = useState(false);
  const profit = -book.yearNet;
  const actual = -book.net;
  const groupOf = (m: ShareMember) => (m.exempt ? 'exempt' : `m${memberBillMonths(s, m, today)}`);
  const memberGroups = [...new Set(roster.active.map(groupOf))]
    .sort((a, b) => (a === 'exempt' ? 1 : b === 'exempt' ? -1 : Number(a.slice(1)) - Number(b.slice(1))))
    .map((k) => [k, k === 'exempt' ? t('family.pool.exempt') : billLabel(Number(k.slice(1))), roster.active.filter((m) => groupOf(m) === k).length] as const);
  // 历来所有收款，按这笔钱覆盖的那一期分组（同一期的人排在一起），新的期在前；已退出的成员也保留
  const receipts = sh.members.flatMap((m) => memberCashFlows(m).map((p) => ({ m, p, base: memberFlowValue(state, p) })));
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
        className="ld-row ld-th car-ledger-head table-head"
        aria-expanded={allOpen}
        aria-label={`${columns.join('\n')}\n${t(allOpen ? 'family.sheet.collapseAll' : 'family.sheet.expandAll')}`}
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
    <Sheet
      title={t('family.sheet.title')}
      onClose={onClose}
      actions={
        <>
          <IconButton
            aria-label={t(masked ? 'family.sheet.showPersonal' : 'family.sheet.hidePersonal')}
            aria-pressed={masked}
            onClick={() => setMasked(!masked)}
          >
            {masked ? <EyeOff size={18} /> : <Eye size={18} />}
          </IconButton>
          <CopyImageButton render={() => carpoolSnapshot(summaryRef.current!)} />
        </>
      }
    >
      <div className="stack">
        <div className="stack car-summary" ref={summaryRef}>
          {/* 页头：名称（点开订阅）+ 一行概况；右侧直接显示收款规则并可修改 */}
          <div className="ld-head">
            <SubIcon sub={s} size={52} proxied />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ph-name text-ellipsis">
                <NameLink onClick={onOpenSub}>{s.name}</NameLink>
              </div>
              <div className="muted ph-meta">
                {copyParts(
                  [
                    `${money(s.price, s.currency)} ${cycleLabel(s.cycle)}`,
                    stopped ? '' : next ? t('family.pool.next', { date: cnDate(next) }) : '',
                    t('family.sheet.seatsVal', { used: roster.taken, total: sh.seats }),
                  ]
                    .filter(Boolean)
                    .join('\n'),
                )}
                {!stopped && roster.vacancies === 0 && <span className="car-seats full">{t('family.pool.seatsFull')}</span>}
              </div>
            </div>
            <div className="car-sheet-actions" data-snapshot-hide>
              {stopped ? (
                <StatusPill tone="stop">{t('family.pool.filter.ended')}</StatusPill>
              ) : (
                <button className="btn car-rule-btn" disabled={ro} onClick={() => setEditingRule(true)} title={t('family.rule.title')}>
                  {perBill('family.pool.perFee', rule.billEvery, { fee: money(rule.fee, rule.currency) })}
                  {!ro && <Icon name="right" size={14} />}
                </button>
              )}
            </div>
          </div>

          <MetricCards>
            <div>
              <small>{t('family.strip.paid')}</small>
              <b>{fmt(-book.paid)}</b>
              <span aria-hidden="true">&nbsp;</span>
            </div>
            <div>
              <small>{t('family.strip.received')}</small>
              <b className={book.received > 0 ? 'done' : undefined}>{fmt(book.received)}</b>
              <span aria-hidden="true">&nbsp;</span>
            </div>
            <div>
              <small>{t('family.strip.profit')}</small>
              <b className={actual > 0 ? 'done' : actual < 0 ? 'loss' : undefined}>{fmt(actual)}</b>
              <span>{tx('family.strip.annualApprox', { amount: <span className="nowrap">{fmt(profit)}</span> })}</span>
            </div>
            {hasPending && (
              <div>
                <small>{t('family.pool.owed')}</small>
                <b className="warn">{money(oweSum, base, { compact: true })}</b>
                <span>{t('family.pool.owedSub', { count: owe })}</span>
              </div>
            )}
          </MetricCards>

          <div className="car-sheet-sec row">
            <CardTitle>{t('family.sheet.members')}</CardTitle>
          </div>
          <div className="car-members" ref={timelineRef}>
            <MemberTable
              state={state}
              s={s}
              today={today}
              ro={ro}
              onMember={onMember}
              win={win}
              masked={masked}
              expanded={departedOpen}
              onToggle={() => setDepartedOpen(!departedOpen)}
            />
            <div className="car-member-cards">
              <TimelineAxis win={win} />
              {s.share?.role === 'owner' && <OwnerSeat state={state} />}
              {memberGroups
                .filter(([key]) => key !== 'exempt')
                .map(([key, label, n]) => (
                  <div key={key} className="car-sheet-members">
                    <div className="car-group-head">
                      {label} <span className="copy-gap" aria-hidden="true" /> {t('family.sheet.people', { count: n })}
                    </div>
                    <MemberRows
                      state={state}
                      s={s}
                      today={today}
                      ro={ro}
                      onMember={onMember}
                      only={(m) => groupOf(m) === key}
                      masked={masked}
                      timeline
                      win={win}
                    />
                  </div>
                ))}
              {Array.from({ length: free }, (_, i) => (
                <Vacancy key={i} ro={ro} onAdd={() => onMember()} />
              ))}
              {roster.active.some((m) => m.exempt) && (
                <div className="car-sheet-members">
                  <div className="car-group-head">{t('family.pool.exempt')}</div>
                  <MemberRows state={state} s={s} today={today} ro={ro} onMember={onMember} only={(m) => !!m.exempt} masked={masked} timeline win={win} />
                </div>
              )}
              {departedOpen && (
                <div className="car-sheet-members">
                  <MemberRows
                    state={state}
                    s={s}
                    today={today}
                    ro={ro}
                    onMember={onMember}
                    only={(m) => !!m.left && m.left <= today}
                    includeLeft
                    masked={masked}
                    timeline
                    win={win}
                  />
                </div>
              )}
              {roster.departed.length > 0 && (
                <DepartedToggle count={roster.departed.length} expanded={departedOpen} onToggle={() => setDepartedOpen(!departedOpen)} />
              )}
            </div>
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
                    <small>{t('detail.stats.count', { count: g.list.length })}</small>
                  </span>
                  {/* 与数据行同列合计：卡上实扣按原币种（混用币种时分别列出），成本按记账货币 */}
                  <span>
                    {copyParts(
                      [...g.list.reduce((m, { c }) => m.set(c.currency, (m.get(c.currency) ?? 0) + c.amount), new Map<string, number>())]
                        .map(([ccy, sum]) => flow(-sum, ccy))
                        .join('\n'),
                    )}
                  </span>
                  <span>{fmt(-g.sum)}</span>
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
            {(allPeriods ? periods : periods.slice(0, RECENT_PERIODS)).map((g) => (
              <Fragment key={g.key}>
                <button
                  type="button"
                  className="ld-row car-period"
                  aria-expanded={openIn.has(g.key)}
                  aria-label={[g.from ? range(g.from, g.until) : t('family.pool.paidUntil', { date: cnDateAuto(g.until, today) }), masked ? '' : g.notes.common]
                    .filter(Boolean)
                    .join('\n')}
                  onClick={() => toggleGroup(g.key, openIn, setOpenIn)}
                >
                  <span className="car-period-title">
                    <b>{g.from ? range(g.from, g.until) : t('family.pool.paidUntil', { date: cnDateAuto(g.until, today) })}</b>
                  </span>
                  <span className={g.sum > 0 ? 'green' : undefined}>{copyParts(t('family.sheet.groupSum', { count: g.list.length, amount: fmt(g.sum) }))}</span>
                </button>
                {openIn.has(g.key) &&
                  g.list.map(({ m, p, base: v }, i) => (
                    <button key={`${m.id}-${p.date}-${i}`} className="ld-row" disabled={ro} onClick={() => (onPayment ? onPayment(m, p) : onMember(m))}>
                      <span>
                        <b className={masked ? 'car-private' : undefined} aria-hidden={masked || undefined}>
                          {m.name || t('family.pool.unnamed')}
                        </b>
                        {p.kind === 'refund' && <small>{t('family.sheet.refund')}</small>}
                        {!masked && g.notes.rows[i] && <small>{copyParts(g.notes.rows[i])}</small>}
                      </span>
                      {/* 组标题已写年份，组内只写月日；和这一期不在同一年时才带年份 */}
                      <span className="ld-date">{p.date.slice(0, 4) === (g.from ?? g.until).slice(0, 4) ? cnDate(p.date) : cnDateFull(p.date)}</span>
                      <span>
                        <b className={p.amount >= 0 ? 'green' : undefined}>{flow(p.amount, p.currency)}</b>
                        {p.currency !== base && <small className={v >= 0 ? 'green' : undefined}>≈ {flow(v, base)}</small>}
                      </span>
                    </button>
                  ))}
              </Fragment>
            ))}
            {!allPeriods && periods.length > RECENT_PERIODS && (
              <button type="button" className="ld-row car-more" onClick={() => setAllPeriods(true)}>
                {t('family.sheet.showAllPeriods', { count: periods.length })}
              </button>
            )}
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

const RECENT_PERIODS = 4;

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
  const net = book.yearIncome - book.yearCost;
  // 卡片看这辆车现在每年的账：量级稳定、各车可比；累计历史放在详情页
  return (
    <div className="car-book">
      <MetricCards inline>
        <div>
          <small>{t('family.facts.yearCost')}</small>
          <b>{fmt(-book.yearCost)}</b>
        </div>
        <div>
          <small>{t('family.facts.yearIncome')}</small>
          <b className={book.yearIncome > 0 ? 'green' : undefined}>{fmt(book.yearIncome)}</b>
        </div>
        <div>
          <small>{t('family.strip.yearNet')}</small>
          <b className={net > 0 ? 'gain' : net < 0 ? 'loss' : undefined}>{fmt(net)}</b>
        </div>
      </MetricCards>
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
