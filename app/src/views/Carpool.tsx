import { CopyImageButton } from '../components/CopyImageButton.tsx';
import { DetailHead, DetailSheet, Panel } from '../components/DetailKit.tsx';
import { ChargeMethods, chargeMethodIds, YearLedger, YearMethods } from '../components/YearLedger.tsx';
import { copyParts } from '../components/copy.tsx';
import { PersonAvatar, personFor } from '../components/PersonAvatar.tsx';
import { ShareAvatars } from '../components/ShareAvatars.tsx';
import {
  addDays,
  addMonths,
  chargesBetween,
  cycleLabel,
  diffDays,
  effectiveStatus,
  memberDues,
  type MemberDue,
  nextCharge,
  memberBillMonths,
  memberCollection,
  memberUnpaidFrom,
  isStopped,
  collectCurrencyOf,
} from '../../../shared/billing.ts';
import { toBaseAt } from '../../../shared/fx.ts';
import { useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { carpoolSnapshot } from './carpool-snapshot.ts';
import { createPortal } from 'react-dom';
import { flow, billLabel, cnDate, cnDateAuto, cnDateFull, money, monthLabel, relDays } from '../../../shared/format.ts';
import { locale, t } from '../../../shared/i18n.ts';
import { tx } from '../i18n.ts';
import { chargeBaseOrNaN, convertOn } from '../../../shared/fx.ts';
import type { AppState, ShareMember, Subscription } from '../../../shared/types.ts';
import { base } from '../base.ts';
import { LtHead, nextSort, perMonths, PlanPrice, usePhone } from '../components/LtHead.tsx';
import { FeeRuleFields, MemberSheet, memberSegments, memberStatus, perBill } from './Members.tsx';
import {
  applyCarRule,
  carLedger,
  carRule,
  carYear,
  followsCar,
  memberCashFlows,
  memberFee,
  memberFlowValue,
  nextCollectionDay,
} from '../../../shared/carpool.ts';
import type { CarRule } from '../../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import {
  MetricCards,
  Metric,
  Amount,
  Cell,
  Group,
  Icon,
  IconButton,
  NameLink,
  Seg,
  Sheet,
  Stepper,
  StatusPill,
  SubIcon,
  tipProps,
  Toolbar,
  useSubmit,
  useWidth,
} from '../components/ui.tsx';
import { sortValue, toBase } from '../derive.ts';
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

type CarSort = 'owed' | 'net' | 'next' | 'name' | 'price' | 'paid' | 'received' | 'profit';
type CarView = 'grid' | 'list';
const isCarView = (v: string): v is CarView => v === 'grid' || v === 'list';
const isCarSort = (v: string): v is CarSort => ['owed', 'net', 'next', 'name', 'price', 'paid', 'received', 'profit'].includes(v);
/** 默认方向：待收多的在前、亏得多的在前、扣款近的在前、名称 A→Z；金额类大的在前，盈亏亏得多的在前 */
const CAR_SORT_DIR: Record<CarSort, 'asc' | 'desc'> = {
  owed: 'desc',
  net: 'asc',
  next: 'asc',
  name: 'asc',
  price: 'desc',
  paid: 'desc',
  received: 'desc',
  profit: 'asc',
};

export function Carpool({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  const [colsRef, colsWidth] = useWidth();
  const colCount = Math.max(1, Math.min(4, Math.floor((colsWidth + 16) / 356)));
  // 没有停止的车都算进行中：包括买断（没有到期）和还没开始的
  const live = (s: Subscription) => !isStopped(effectiveStatus(s, today));
  const owned = state.subscriptions.filter((s) => s.share?.role === 'owner' && live(s));
  const joined = state.subscriptions.filter((s) => s.share?.role === 'member' && live(s));
  // 卡片按状态筛选；顶部的统计始终按进行中的合租算
  // 筛选记在服务端：切到别的页面再回来、换台设备都还是上次选的
  const [filter, setFilter] = usePref<CarFilter>('car-filter', 'live', (v): v is CarFilter => (CAR_FILTERS as readonly string[]).includes(v));
  const ended = state.subscriptions.filter((s) => s.share?.role === 'owner' && !live(s));
  const all = [...owned, ...ended];
  const collect = collectCurrencyOf(state.settings);
  // 每辆车的成员待收、账、下次扣款只算一次：筛选、排序、统计、卡片与表格共用
  const duesBy = new Map(all.map((s) => [s.id, memberDues(s, today, collect, state)]));
  const duesOf = (s: Subscription) => duesBy.get(s.id) ?? memberDues(s, today, collect, state);
  const owes = (s: Subscription) => duesOf(s).some((d) => d.periodsOwed > 0);
  const groups: Record<CarFilter, Subscription[]> = {
    all,
    live: owned,
    owe: all.filter(owes),
    settled: owned.filter((s) => !owes(s)),
    ended,
  };
  const books = new Map(all.map((s) => [s.id, carLedger(state, s, today)]));
  // 排序与方向存在服务端；已停止的车始终排在最后。默认待收多的在前
  // 默认按状态：待收多的在前，已结清、已停止在后；表头不为默认排序标箭头
  const [sort, setSort] = usePref<CarSort>('car-sort', 'owed', isCarSort);
  const [dir, setDir] = usePref<'asc' | 'desc'>('car-dir', CAR_SORT_DIR[sort], (v): v is 'asc' | 'desc' => v === 'asc' || v === 'desc');
  // 表头三态：该列默认方向、反向、回到默认（按状态）
  const headSort = (k: CarSort) => {
    const [ns, nd] = nextSort(k, sort, dir, CAR_SORT_DIR, 'owed');
    setSort(ns);
    setDir(nd);
  };
  const [savedView, setView] = usePref<CarView>('car-view', 'grid', isCarView);
  const phone = usePhone();
  const view = phone ? 'grid' : savedView;
  const nextBy = new Map(all.map((s) => [s.id, nextCharge(s, addDays(today, 1)) ?? '9999-12-31']));
  const nextOf = (s: Subscription) => nextBy.get(s.id)!;
  const owedBy = new Map(
    all.map((s) => [
      s.id,
      duesOf(s)
        .filter((d) => d.periodsOwed > 0)
        // 算不出（缺汇率或缺金额）的一笔让合计为 NaN：状态胶囊只写「待收」，不写成少收的金额
        .reduce((a, d) => a + (Number.isFinite(d.owed) ? toBase(state, d.owed, d.currency) : NaN), 0),
    ]),
  );
  const owedOf = (s: Subscription) => owedBy.get(s.id)!;
  // 当年盈亏：今年成本（已扣 + 预计）对比成员今年的收入（已收 + 今年还该收）
  const years = new Map(all.map((s) => [s.id, carYear(state, s, today)]));
  const netOf = (s: Subscription) => years.get(s.id)!.net;
  const num = (v: number) => (Number.isFinite(v) ? v : 0);
  const value: Record<Exclude<CarSort, 'name' | 'next'>, (s: Subscription) => number> = {
    owed: owedOf,
    net: netOf,
    price: (s) => num(toBaseAt(state, s.price, s.currency)),
    paid: (s) => books.get(s.id)!.paid,
    received: (s) => books.get(s.id)!.received,
    profit: (s) => -books.get(s.id)!.net,
  };
  const asc = (a: Subscription, b: Subscription) =>
    sort === 'name'
      ? a.name.localeCompare(b.name, locale())
      : sort === 'next'
        ? nextOf(a).localeCompare(nextOf(b))
        : sortValue(value[sort](a)) - sortValue(value[sort](b));
  const shown = [...groups[filter]].sort(
    (a, b) => Number(!live(a)) - Number(!live(b)) || (dir === 'asc' ? asc(a, b) : asc(b, a)) || nextOf(a).localeCompare(nextOf(b)),
  );
  const yearNet = owned.reduce((a, s) => a + books.get(s.id)!.yearNet, 0);
  // 第三格的小字：进行中的车上一共坐了几位成员、还空几个位置
  const seated = owned.reduce((a, s) => a + carpoolRoster(s, today).active.length, 0);
  const openSeats = owned.reduce((a, s) => a + carpoolRoster(s, today).vacancies, 0);
  const yearIncome = owned.reduce((a, s) => a + books.get(s.id)!.yearIncome, 0);
  const owedAll = all.flatMap(duesOf).filter((d) => d.periodsOwed > 0);
  const owedSum = owedAll.reduce((a, d) => a + (Number.isFinite(d.owed) ? toBase(state, d.owed, d.currency) : NaN), 0);
  const [convert, setConvert] = useState<Subscription | null>(null);
  const [member, setMember] = useState<{ s: Subscription; m?: ShareMember; collect?: boolean; editId?: string } | null>(null);
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
        <FamilyTabs tab="plans" />
        {/* 卡片 / 列表切换固定在右上角最后一个；排序只在列表表头切换，对卡片同样生效 */}
        {!phone && (
          <Seg
            small
            value={view}
            onChange={setView}
            options={[
              ['grid', t('list.view.grid')],
              ['list', t('list.view.list')],
            ]}
          />
        )}
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
            note={t('family.pool.countNote', { members: seated, free: openSeats })}
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
        {view === 'list' && shown.length > 0 && (
          <CarTable
            state={state}
            today={today}
            rows={shown}
            books={books}
            years={years}
            live={live}
            duesOf={duesOf}
            owedOf={owedOf}
            sort={sort}
            dir={dir}
            onSort={headSort}
            onOpen={setSheet}
          />
        )}
        {/* 列数随宽度变化（每列至少约 340px）；各列独立：展开一张卡只撑高它所在的那一列 */}
        {view === 'grid' && (
          <div className="car-cols" ref={colsRef} style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
            {Array.from({ length: colCount }, (_, col) => (
              <div className="car-col" key={col}>
                {shown.map((s, idx) => {
                  if (idx % colCount !== col) return null;
                  const sh = s.share!;
                  const dues = duesOf(s);
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
                        <ShareAvatars sub={s} state={state} today={today} onMember={(m) => setMember({ s, m })} />
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
                          {free > 0 && live(s) && (
                            <button className="btn tinted" style={{ alignSelf: 'flex-start' }} onClick={() => setMember({ s })}>
                              <Icon name="plus" /> {t('family.pool.addMemberSeats', { count: free })}
                            </button>
                          )}
                          <MemberRows state={state} s={s} today={today} onMember={(m, c) => setMember({ s, m, collect: c })} />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

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

        {candidates.length > 0 && (
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
        {convert && <ConvertSheet state={state} s={convert} today={today} onClose={() => setConvert(null)} />}
        {sheetSub?.share && (
          <CarSheet
            state={state}
            s={sheetSub}
            today={today}

            book={books.get(sheetSub.id) ?? carLedger(state, sheetSub, today)}
            onClose={() => setSheet(null)}
            onOpenSub={() => {
              setSheet(null);
              onOpen(sheetSub);
            }}
            onMember={(m, c) => setMember({ s: sheetSub, m, collect: c })}
            onPayment={(m, editId) => setMember({ s: sheetSub, m, editId })}
          />
        )}
        {/* 点成员、点收款、点某一笔收款都打开同一个成员入口：欠款先记收款，其余是成员表单 */}
        {member && (
          <MemberSheet
            state={state}
            s={state.subscriptions.find((x) => x.id === member.s.id) ?? member.s}
            member={member.m}
            collect={member.collect}
            editId={member.editId}
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

/**
 * 合租的列表视图（桌面）：一行一辆车，比卡片多出套餐价格、收费标准、下次扣款与累计净额；点一行打开合租弹窗。
 * 各列按比例分宽度；表格变窄时先收起 data-p=2 的列，再收起 data-p=3。手机上不出表格，仍用卡片
 */
function CarTable({
  state,
  today,
  rows,
  books,
  years,
  live,
  duesOf,
  owedOf,
  sort,
  dir,
  onSort,
  onOpen,
}: {
  state: AppState;
  today: string;
  rows: Subscription[];
  books: Map<string, ReturnType<typeof carLedger>>;
  years: Map<string, ReturnType<typeof carYear>>;
  live: (s: Subscription) => boolean;
  duesOf: (s: Subscription) => MemberDue[];
  owedOf: (s: Subscription) => number;
  sort: CarSort;
  dir: 'asc' | 'desc';
  onSort: (k: CarSort) => void;
  onOpen: (id: string) => void;
}) {
  const base = state.settings.baseCurrency;
  const fmt = (v: number) => flow(v, base, { compact: true });
  return (
    <div className="ltable-wrap">
      <div className="ltable lt-x car-lt" role="table">
        <LtHead<CarSort>
          initial={['owed', CAR_SORT_DIR.owed]}
          sort={sort}
          dir={dir}
          onSort={onSort}
          cols={[
            { label: t('list.col.name'), sort: 'name' },
            { label: t('family.pool.members') },
            { label: t('family.pool.status'), sort: 'owed' },
            { label: t('list.col.planPrice'), sort: 'price', p: 3, num: true },
            { label: t('family.rule.title'), p: 2, num: true },
            { label: t('list.col.next'), sort: 'next', num: true },
            { label: t('family.pool.yearPnl'), sort: 'net', num: true },
            { label: t('family.pool.totalPnl'), sort: 'profit', num: true },
          ]}
        />
        {rows.map((s) => {
          const book = books.get(s.id)!;
          const on = live(s);
          const free = carpoolRoster(s, today).vacancies;
          const next = on ? nextCharge(s, addDays(today, 1)) : undefined;
          const dues = duesOf(s).filter((d) => d.periodsOwed > 0);
          const owed = owedOf(s);
          const year = years.get(s.id) ?? carYear(state, s, today);
          const rule = carRule(state, s, today);
          return (
            <button key={s.id} className={`lt-row ${on ? '' : 'st-ended'}`} role="row" onClick={() => onOpen(s.id)}>
              <span className="lt-name">
                <SubIcon sub={s} size={32} />
                <span className="lt-title">
                  <span className="nm">
                    <b>{s.name}</b>
                  </span>
                  {book.since && <small className="lt-sub">{t('family.strip.since', { date: cnDateFull(book.since) })}</small>}
                </span>
              </span>
              <span className="lt-members">
                {/* 家庭组一般最多 6 人：连同自己最多排 6 个头像；坐满不写，只标出空位 */}
                <ShareAvatars sub={s} state={state} today={today} size={22} max={6} />
                {on && free > 0 && <small>{t('family.pool.seatsFree', { count: free })}</small>}
              </span>
              {/* 状态胶囊：已停止 > 待收多少 > 已结清；还没有成员的写提示。放在左侧文字区，右边都是数字 */}
              <span className="lt-status">
                {!on ? (
                  <StatusPill tone="stop">{t('family.pool.filter.ended')}</StatusPill>
                ) : dues.length ? (
                  <StatusPill tone="owe">
                    {Number.isFinite(owed) ? t('family.pool.owedAmount', { amount: money(owed, base, { compact: true }) }) : t('family.pool.owed')}
                  </StatusPill>
                ) : s.share!.members.length ? (
                  <StatusPill tone="done">{t('family.pool.settled')}</StatusPill>
                ) : (
                  <StatusPill tone="notice">{t('family.pool.noMembers')}</StatusPill>
                )}
              </span>
              <PlanPrice state={state} s={s} today={today} cost={year.cost} />
              {/* 已停止的车：收费、下次扣款、每年净额都不再有意义，留空 */}
              <span className="lt-num" data-p={2}>
                {!on ? null : s.share!.members.length ? (
                  <>
                    {money(rule.fee, rule.currency)}/{perMonths(rule.billEvery)}
                  </>
                ) : (
                  <small>—</small>
                )}
              </span>
              <span className="lt-num">
                {!on ? null : next ? (
                  <>
                    {cnDate(next)}
                    <small>{relDays(diffDays(today, next))}</small>
                  </>
                ) : (
                  <small>—</small>
                )}
              </span>
              {/* 当年盈亏：今年的成本对比成员今年的收入，小字是收入；停止与买断的车同样有今年的账 */}
              <span className="lt-num">
                <span className={Math.abs(year.net) < 0.5 ? undefined : year.net > 0 ? 'gain' : 'loss'}>{fmt(year.net)}</span>
                <small>{t('family.pool.incomeShort', { amount: fmt(year.income) })}</small>
              </span>
              {/* 累计盈亏：发起至今收回减付出，与代付的盈亏同一口径；与左边的当年盈亏成对 */}
              <span className={`lt-num ${Math.abs(book.net) < 0.5 ? '' : book.net < 0 ? 'gain' : 'loss'}`}>
                {Math.abs(book.net) < 0.5 ? t('proxy.table.even') : fmt(-book.net)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 成员明细：收款状态、应收、收款按钮；车卡展开和合租弹窗共用 */
function MemberRows({
  state,
  s,
  today,
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
  onMember: (m: ShareMember, collect?: boolean) => void;
  /** 只列一部分成员（合租弹窗里按收费周期分组时用） */
  only?: (m: ShareMember) => boolean;
  /** 合租详情里在每人下方画时间条（与宽屏表格一致） */
  timeline?: boolean;
  includeLeft?: boolean;
  masked?: boolean;
  win?: ReturnType<typeof carpoolTimeline>;
}) {
  const dues = memberDues(s, today, collectCurrencyOf(state.settings), state).filter(
    (d) => (includeLeft || !d.member.left || d.member.left > today) && (!only || only(d.member)),
  );
  const collect = collectCurrencyOf(state.settings);
  return (
    <div>
      {dues.map((d) => {
        const collection = memberCollection(s, d.member, memberUnpaidFrom(s, d.member), collect);
        return (
          <div
            key={d.member.id}
            className={`member ${d.member.left && d.member.left <= today ? 'departed' : ''}`}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest('button')) {
                e.stopPropagation();
                onMember(d.member);
              }
            }}
            onKeyDown={(e) => {
              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                e.stopPropagation();
                onMember(d.member);
              }
            }}
          >
            {/* 一行称呼，一行动态日期：欠款写「应收 某日」，已结清写「下次应收 某日」；账号、周期在合租详情表格里看 */}
            <button className="member-info" aria-label={masked ? t('family.sheet.hiddenMember') : undefined} onClick={() => onMember(d.member)}>
              <div className="icon-text" style={{ fontWeight: 600, fontSize: 'var(--fs-2)' }}>
                <MemberAvatar state={state} m={d.member} size={28} masked={masked} />
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
          </div>
        );
      })}
    </div>
  );
}

/** 成员头像：隐藏个人信息时换成同尺寸的灰色占位，合租详情里所有成员头像都走这里，不会漏 */
function MemberAvatar({ state, m, size, masked }: { state: AppState; m: ShareMember; size: number; masked?: boolean }) {
  return masked ? (
    <span className="pp-ava car-private-avatar" style={{ width: size, height: size }} aria-hidden="true" />
  ) : (
    <PersonAvatar p={personFor(state, m.personId, m.name || '?')} size={size} />
  );
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
  const label = {
    paid: t('family.timeline.paid'),
    due: t('family.timeline.due'),
    future: t('family.timeline.future'),
    unused: t('family.timeline.unused'),
    waived: t('family.timeline.waived'),
  };
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
  onMember,
  win,
  expanded,
  onToggle,
  masked,
}: {
  state: AppState;
  s: Subscription;
  today: string;
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
        </tr>
      </thead>
      <tbody role="rowgroup">
        {s.share?.role === 'owner' && <OwnerSeat state={state} s={s} today={today} win={win} table />}
        {[
          // 空位永远在最后：车主、分摊成员、不分摊成员、（展开时）已退出成员之后
          ...roster.active.filter((m) => !m.exempt),
          ...roster.active.filter((m) => m.exempt),
          ...(expanded ? roster.departed : []),
          ...Array.from({ length: roster.vacancies }, () => null),
        ].map((m, index) => {
          if (!m) return <Vacancy key={`vacancy-${index}`} onAdd={() => onMember()} table />;
          const st = memberStatus(state, s, m, today);
          const rate = memberFee(state, s, m, today);
          const left = !!m.left && m.left <= today;
          return (
            <tr
              role="row"
              key={m.id}
              className="car-member-row"
              tabIndex={0}
              aria-label={masked ? t('family.sheet.hiddenMember') : m.name || t('family.pool.unnamed')}
              onClick={() => onMember(m)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
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
                  <MemberAvatar state={state} m={m} size={24} masked={masked} />
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
            </tr>
          );
        })}
      </tbody>
      {roster.departed.length > 0 && (
        <tfoot>
          <tr>
            <td colSpan={4}>
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
    <button type="button" className="car-departed-toggle" aria-expanded={expanded} onClick={onToggle}>
      {t('family.sheet.departed', { count })}
      <Icon name="down" size={14} />
    </button>
  );
}

/** 车主自己占的那一座：不收费、不可点，只表明席位 */
/**
 * 车主自己的迷你时间线：订阅本身的每一期（车主实际付给服务方的扣款），
 * 已扣的为实色，下一期预测为虚框；与成员的收款时间线共用同一条时间轴
 */
function OwnerTimeline({ state, s, today, win }: { state: AppState; s: Subscription; today: string; win: { start: string; end: string } }) {
  const charges = chargesBetween(s, addMonths(win.start, -24), win.end, today).filter((c) => !c.kind);
  const segs = charges
    .map((c, i) => {
      const until = addDays(charges[i + 1]?.date ?? nextCharge(s, addDays(c.date, 1)) ?? win.end, -1);
      return { c, from: c.date, until, kind: c.date <= today ? 'owner' : 'future' };
    })
    .filter((g) => g.until >= win.start && g.from <= win.end)
    // 预测只画下一期
    .filter((g, i, all) => g.kind === 'owner' || all.findIndex((x) => x.kind === 'future') === i);
  return (
    <span className="mt-viewport mt-track">
      <span className="mt-inner">
        {segs.map((g) => {
          const from = g.from < win.start ? win.start : g.from;
          const until = g.until > win.end ? win.end : g.until;
          return (
            <i
              key={g.from}
              className={`mt-seg ${g.kind}`}
              style={{ left: `${pct(from, win)}%`, width: `${Math.max(0.6, pct(addDays(until, 1), win) - pct(from, win))}%` }}
              {...tipProps(() => (
                <>
                  <b>{g.kind === 'owner' ? flow(-chargeBaseOrNaN(state, g.c), state.settings.baseCurrency) : t('family.timeline.future')}</b>
                  <div>
                    {cnDateFull(g.from)} – {cnDateFull(g.until)}
                  </div>
                </>
              ))}
            />
          );
        })}
        <i className="mt-today" style={{ left: `${pct(today, win)}%` }} />
      </span>
    </span>
  );
}

function OwnerSeat({
  state,
  s,
  today,
  win,
  table = false,
}: {
  state: AppState;
  s: Subscription;
  today: string;
  win: { start: string; end: string };
  table?: boolean;
}) {
  const chip = (
    <span className="car-member-chip owner">
      <img className="owner-avatar" src={state.settings.avatar || base('/icons/avatar.png')} alt="" />
      <span className="text-ellipsis">{t('family.pool.me')}</span>
    </span>
  );
  const line = <OwnerTimeline state={state} s={s} today={today} win={win} />;
  return table ? (
    <tr role="row" className="car-member-row owner-seat">
      <td role="cell">{chip}</td>
      <td role="cell" className="muted">
        {t('family.sheet.ownerFee')}
      </td>
      <td role="cell">{line}</td>
      <td role="cell" />
    </tr>
  ) : (
    <div className="member owner-seat">
      {chip}
      <span className="muted">{t('family.sheet.ownerFee')}</span>
      {line}
    </div>
  );
}

function Vacancy({ onAdd, table = false }: { onAdd: () => void; table?: boolean }) {
  const props = {
    className: `car-vacancy ${table ? 'car-member-row' : 'member'}`,
    role: table ? 'row' : 'button',
    tabIndex: 0,
    'aria-label': t('family.sheet.addMember'),
    onClick: () => onAdd(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onAdd();
      }
    },
  };
  const chip = (
    <span className="car-member-chip vacancy">
      {/* 和成员胶囊同一个样子：左边头像位（虚线空圈），右边文字 */}
      <span className="vacancy-ava" aria-hidden="true" />
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
    </tr>
  ) : (
    <div {...props}>
      {chip}
      {track}
    </div>
  );
}

/**
 * 合租成员：宽时成员表（收费、迷你时间线、收款状态），窄时按收费周期分组的卡片；
 * 合租详情与订阅详情共用，保证两处成员的样子一致
 */
export function CarMembers({
  state,
  s,
  today,
  onMember,
  masked = false,
  billEvery,
}: {
  state: AppState;
  s: Subscription;
  today: string;
  onMember: (m?: ShareMember, collect?: boolean) => void;
  masked?: boolean;
  billEvery: number;
}) {
  const [departedOpen, setDepartedOpen] = useState(false);
  const win = carpoolTimeline(s, today, billEvery);
  const timelineRef = useTimelinePan(win);
  const roster = carpoolRoster(s, today);
  const free = roster.vacancies;
  const groupOf = (m: ShareMember) => (m.exempt ? 'exempt' : `m${memberBillMonths(s, m, today)}`);
  const memberGroups = [...new Set(roster.active.map(groupOf))]
    .sort((a, b) => (a === 'exempt' ? 1 : b === 'exempt' ? -1 : Number(a.slice(1)) - Number(b.slice(1))))
    .map((k) => [k, k === 'exempt' ? t('family.pool.exempt') : billLabel(Number(k.slice(1))), roster.active.filter((m) => groupOf(m) === k).length] as const);
  return (
    <div className="car-members" ref={timelineRef}>
      <MemberTable
        state={state}
        s={s}
        today={today}

        onMember={onMember}
        win={win}
        masked={masked}
        expanded={departedOpen}
        onToggle={() => setDepartedOpen(!departedOpen)}
      />
      <div className="car-member-cards">
        <TimelineAxis win={win} />
        {s.share?.role === 'owner' && <OwnerSeat state={state} s={s} today={today} win={win} />}
        {memberGroups
          .filter(([key]) => key !== 'exempt')
          .map(([key, label, n]) => (
            <div key={key} className="car-sheet-members">
              <div className="car-group-head">
                {label} <span className="copy-gap" aria-hidden="true" /> {t('family.sheet.people', { count: n })}
              </div>
              <MemberRows state={state} s={s} today={today} onMember={onMember} only={(m) => groupOf(m) === key} masked={masked} timeline win={win} />
            </div>
          ))}
        {roster.active.some((m) => m.exempt) && (
          <div className="car-sheet-members">
            <div className="car-group-head">{t('family.pool.exempt')}</div>
            <MemberRows state={state} s={s} today={today} onMember={onMember} only={(m) => !!m.exempt} masked={masked} timeline win={win} />
          </div>
        )}
        {departedOpen && (
          <div className="car-sheet-members">
            <MemberRows
              state={state}
              s={s}
              today={today}

              onMember={onMember}
              only={(m) => !!m.left && m.left <= today}
              includeLeft
              masked={masked}
              timeline
              win={win}
            />
          </div>
        )}
        {Array.from({ length: free }, (_, i) => (
          <Vacancy key={i} onAdd={() => onMember()} />
        ))}
        {roster.departed.length > 0 && (
          <DepartedToggle count={roster.departed.length} expanded={departedOpen} onToggle={() => setDepartedOpen(!departedOpen)} />
        )}
      </div>
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
  book,
  onClose,
  onOpenSub,
  onMember,
  onPayment,
}: {
  state: AppState;
  s: Subscription;
  today: string;
  book: ReturnType<typeof carLedger>;
  onClose: () => void;
  onOpenSub: () => void;
  onMember: (m?: ShareMember, collect?: boolean) => void;
  /** 收款表点某一笔：直接编辑这笔收款 */
  onPayment?: (m: ShareMember, receiptId: string) => void;
}) {
  const [masked, setMasked] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const base = state.settings.baseCurrency;
  const sh = s.share!;
  const st = effectiveStatus(s, today);
  const stopped = isStopped(st);
  const next = nextCharge(s, addDays(today, 1));
  const roster = carpoolRoster(s, today);
  const dues = memberDues(s, today, collectCurrencyOf(state.settings), state).filter((d) => d.periodsOwed > 0);
  const owe = dues.length;
  const oweSum = dues.reduce((a, d) => a + convertOn(d.owed, d.currency, base, today, undefined, state.fx), 0);
  const hasPending = oweSum > 0 || !Number.isFinite(oweSum);
  const fmt = (v: number) => flow(v, base, { compact: true });
  const rule = carRule(state, s, today);
  const [editingRule, setEditingRule] = useState(false);
  const actual = -book.net;
  // 历来所有收款，已退出的成员也保留
  const receipts = sh.members.flatMap((m) => memberCashFlows(m).map((p) => ({ m, p, base: memberFlowValue(state, p) })));
  // 收款、付款切换：两张表都按年分组，与订阅详情的扣款记录同一套
  const [tab, setTab] = useState<'in' | 'out'>('in');
  const outs = chargesBetween(s, book.since ?? s.start, today, today)
    .filter((c) => c.kind !== 'failed')
    // 缺汇率的一笔为 NaN：行与年小计显示「—」
    .map((c) => ({ c, base: chargeBaseOrNaN(state, c) }))
    .reverse();
  return (
    <DetailSheet label={t('family.sheet.title')} onClose={onClose}>
      {/* 复制为图片取整张弹窗，收款表与按钮带 data-snapshot-hide 不入图 */}
      <div className="dt car-summary" ref={summaryRef}>
        <DetailHead
          icon={<SubIcon sub={s} size={48} proxied />}
          title={<NameLink onClick={onOpenSub}>{s.name}</NameLink>}
          badge={
            stopped ? (
              <StatusPill tone="stop">{t('family.pool.filter.ended')}</StatusPill>
            ) : (
              roster.vacancies === 0 && <span className="car-seats full">{t('family.pool.seatsFull')}</span>
            )
          }
          meta={
            <>
              <b>
                {money(s.price, s.currency)} {cycleLabel(s.cycle)}
              </b>
              {!stopped && next && <span>{t('family.pool.next', { date: cnDate(next) })}</span>}
              <span>{t('family.sheet.seatsVal', { used: roster.taken, total: sh.seats })}</span>
            </>
          }
          actions={
            <span className="dt-header-tools" data-snapshot-hide>
              {!stopped && (
                <button className="btn car-rule-btn" onClick={() => setEditingRule(true)} title={t('family.rule.title')}>
                  {perBill('family.pool.perFee', rule.billEvery, { fee: money(rule.fee, rule.currency) })}
                  <Icon name="right" size={14} />
                </button>
              )}
              <IconButton
                aria-label={t(masked ? 'family.sheet.showPersonal' : 'family.sheet.hidePersonal')}
                aria-pressed={masked}
                onClick={() => setMasked(!masked)}
              >
                {masked ? <EyeOff size={17} /> : <Eye size={17} />}
              </IconButton>
              <CopyImageButton render={() => carpoolSnapshot(summaryRef.current!)} />
            </span>
          }
          onClose={onClose}
        />
        <div className="dt-body">
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
              {/* 小字是当年盈亏，与列表的「当年盈亏」同一口径；买断的车也有今年的账 */}
              <span>{tx('family.strip.thisYear', { amount: <span className="nowrap">{fmt(carYear(state, s, today).net)}</span> })}</span>
            </div>
            {hasPending && (
              <div>
                <small>{t('family.pool.owed')}</small>
                <b className="warn">{money(oweSum, base, { compact: true })}</b>
                <span>{t('family.pool.owedSub', { count: owe })}</span>
              </div>
            )}
          </MetricCards>

          {/* 与订阅详情一样：成员表、收付款表各在一张卡片里，标题在卡片内 */}
          {/* 成员卡片不加标题：表头第一列已经是「成员」 */}
          <Panel className="dt-share car-members-panel">
            <CarMembers state={state} s={s} today={today} onMember={onMember} masked={masked} billEvery={rule.billEvery} />
          </Panel>

          {/* 收进来的和我付出去的切换着看；表格与订阅详情的扣款记录同一套（YearLedger） */}
          {/* 与代付的逐期明细同一种卡片：标题在左，收款 / 付款切换在右 */}
          <Panel
            className="dt-charges car-ledger"
            title={t('family.sheet.ledgerTitle')}
            aside={
              <span data-snapshot-hide>
                <Seg
                  small
                  value={tab}
                  onChange={setTab}
                  options={[
                    ['in', t('family.sheet.tabIn', { count: receipts.length })],
                    ['out', t('family.sheet.tabOut', { count: outs.length })],
                  ]}
                />
              </span>
            }
          >
            <div data-snapshot-hide>
              {tab === 'out' ? (
                outs.length ? (
                  <YearLedger
                    key="out"
                    items={outs}
                    dateOf={(r) => r.c.date}
                    head={[t('family.sheet.chargeDate'), t('detail.field.method'), t('proxy.table.charged'), t('proxy.table.cost')]}
                    yearCells={(ys) => {
                      const total = ys.reduce((a, r) => a + r.base, 0);
                      return {
                        second: <YearMethods ids={chargeMethodIds(ys.map((r) => r.c))} state={state} />,
                        orig: copyParts(
                          [...ys.reduce((m, { c }) => m.set(c.currency, (m.get(c.currency) ?? 0) + c.amount), new Map<string, number>())]
                            .map(([ccy, sum]) => flow(-sum, ccy))
                            .join('\n'),
                        ),
                        base: Number.isFinite(total) ? flow(-total, base) : '—',
                      };
                    }}
                    row={({ c, base: v }) => ({
                      date: <time dateTime={c.date}>{cnDateFull(c.date)}</time>,
                      second: <ChargeMethods c={c} state={state} />,
                      orig: (
                        <>
                          {flow(-c.amount, c.currency)}
                          {c.kind === 'refund' && <em className="dt-kind refund">{t('family.sheet.refund')}</em>}
                        </>
                      ),
                      base: Number.isFinite(v) ? flow(-v, base) : '—',
                    })}
                    rowKey={({ c }, i) => `${c.date}-${i}`}
                  />
                ) : (
                  <div className="car-empty">
                    <b>{t('family.sheet.noCharges')}</b>
                  </div>
                )
              ) : receipts.length ? (
                <YearLedger
                  key="in"
                  keepSecond
                  items={[...receipts].sort((x, y) => y.p.date.localeCompare(x.p.date))}
                  dateOf={(r) => r.p.date}
                  head={[t('family.sheet.date'), t('family.sheet.member'), t('family.sheet.amount'), t('list.col.inBase', { ccy: base })]}
                  yearCells={(ys) => ({
                    // 这一年交过钱的人：与付款表的支付方式一样，一个人写胶囊，几个人把头像叠在一起，悬停看名单
                    second: (() => {
                      const who = [...new Map(ys.map((r) => [r.m.id, r.m])).values()];
                      if (who.length === 1)
                        return (
                          <span className="who-chip">
                            <MemberAvatar state={state} m={who[0]} size={16} masked={masked} />
                            <span className={masked ? 'car-private' : undefined} aria-hidden={masked || undefined}>
                              {who[0].name || t('family.pool.unnamed')}
                            </span>
                          </span>
                        );
                      return (
                        <span className="dt-ava-stack" title={masked ? undefined : who.map((m) => m.name || t('family.pool.unnamed')).join('\n')}>
                          {who.slice(0, 6).map((m) => (
                            <MemberAvatar key={m.id} state={state} m={m} size={20} masked={masked} />
                          ))}
                          {who.length > 6 && <small>+{who.length - 6}</small>}
                        </span>
                      );
                    })(),
                    orig: copyParts(
                      [...ys.reduce((m, { p }) => m.set(p.currency, (m.get(p.currency) ?? 0) + p.amount), new Map<string, number>())]
                        .map(([ccy, sum]) => flow(sum, ccy))
                        .join('\n'),
                    ),
                    base: flow(
                      ys.reduce((a, r) => a + r.base, 0),
                      base,
                    ),
                  })}
                  row={({ m, p, base: v }) => ({
                    date: <time dateTime={p.date}>{cnDateFull(p.date)}</time>,
                    // 人员一律用胶囊
                    second: (
                      <span className="who-chip">
                        <MemberAvatar state={state} m={m} size={16} masked={masked} />
                        <span className={masked ? 'car-private' : undefined} aria-hidden={masked || undefined}>
                          {m.name || t('family.pool.unnamed')}
                        </span>
                      </span>
                    ),
                    orig: (
                      <>
                        {flow(p.amount, p.currency)}
                        {p.kind === 'refund' && <em className="dt-kind refund">{t('family.sheet.refund')}</em>}
                      </>
                    ),
                    base: flow(v, base),
                  })}
                  rowKey={({ m, p }, i) => `${m.id}-${p.date}-${i}`}
                  rowTitle={({ p }) => (masked ? undefined : p.note)}
                  onRow={({ m, p }) => (onPayment && p.kind === 'receipt' ? onPayment(m, p.id) : onMember(m))}
                />
              ) : (
                <div className="car-empty">
                  <b>{t('family.facts.noRecords')}</b>
                  <span>{t('family.sheet.receiptHint')}</span>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
      {editingRule && createPortal(<CarRuleSheet state={state} s={s} today={today} rule={rule} onClose={() => setEditingRule(false)} />, document.body)}
    </DetailSheet>
  );
}

/** 常见家庭方案的席位数（含自己） */
function defaultSeats(name: string): number {
  return /1password/i.test(name) ? 5 : 6;
}

/** 一步转为合租：选身份与席位，保存后在上面补成员 */
function ConvertSheet({ state, s, today, onClose }: { state: AppState; s: Subscription; today: string; onClose: () => void }) {
  const [role, setRole] = useState<'owner' | 'member'>('owner');
  const [seats, setSeats] = useState(defaultSeats(s.name));
  const [ownerName, setOwnerName] = useState('');
  const perHead = seats > 0 ? s.price / seats : s.price;
  // 我发起时一起定收费标准：默认按价格和席位推算，改了就用改的（之后在合租详情的收费规则里也是这一份）
  const [rule, setRule] = useState<CarRule | null>(null);
  const shown = rule ?? carRule(state, { ...s, share: { role: 'owner', seats, members: [] } }, today);
  const [busy, submit] = useSubmit();
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
            disabled={busy}
            onClick={() =>
              submit(() =>
                run(
                  async () => {
                    await saveSub({
                      ...s,
                      share:
                        role === 'owner'
                          ? { role, seats, members: [], since: today, rule: shown }
                          : { role, seats, members: [], ownerName: ownerName.trim() || undefined, since: today },
                    });
                    onClose();
                  },
                  role === 'owner' ? t('family.convert.toastOwner') : t('family.convert.toastMember'),
                ),
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
            <Stepper
              label={t('family.convert.seats')}
              value={seats}
              min={1}
              max={50}
              unit={(n) => t('family.convert.seatUnit', { count: n })}
              onChange={setSeats}
            />
          </Cell>
          {role === 'owner' && <FeeRuleFields value={shown} onChange={setRule} />}
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
  // 下期收款日：新标准从这天起执行，也是全车往后的收款节奏；默认按现在的节奏算出的下一次
  const [next, setNext] = useState(nextCollectionDay(s, rule.billEvery, today));
  const followers = (s.share?.members ?? []).filter((m) => followsCar(state, s, m, today) && (!m.left || m.left > today)).length;
  const [busy, submit] = useSubmit();
  const save = () =>
    run(async () => {
      const applied = applyCarRule(state, s, draft, next, today);
      await saveSub({ ...applied, share: { ...applied.share!, collectFrom: next } });
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
          <button className="btn primary" disabled={busy || !(draft.fee >= 0)} onClick={() => void submit(save)}>
            {t('family.member.save')}
          </button>
        </>
      }
    >
      <div className="stack">
        <Group foot={t('family.rule.applyNote', { count: followers })}>
          <FeeRuleFields value={draft} onChange={setDraft} />
          <Cell label={t('family.rule.nextDay')}>
            <DatePicker value={next} onChange={(v) => v && setNext(v)} />
          </Cell>
        </Group>
      </div>
    </Sheet>
  );
}
