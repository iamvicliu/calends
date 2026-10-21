import { StopBadge } from '../components/StopPanel.tsx';
import { base } from '../base.ts';
import { useEffect, useState } from 'react';
import { activePhases, currentPhase, diffDays, effectiveStatus, monthlyMine, nextCharge, priceAt, upcomingPhase } from '../../../shared/billing.ts';
import { cnDate, money, relDays } from '../../../shared/format.ts';
import { toBaseAt } from '../../../shared/fx.ts';
import type { AppState, Subscription } from '../../../shared/types.ts';
import { Amount, CatChip, CatIcon, Icon, MethodMark, PayBadge, Seg, SubIcon, Toolbar } from '../components/ui.tsx';
import { proxyOwed } from './Proxy.tsx';
import { locale, t } from '../../../shared/i18n.ts';
import { tx } from '../i18n.ts';
import { cancelSavings } from '../../../shared/metrics.ts';
import { catColor, categories, isDomainCat, subImage, toBase } from '../derive.ts';
import { useIconTint } from '../iconTint.ts';
import { useOrig } from '../display.ts';
import { Gantt } from './Gantt.tsx';
import { perLabel } from './Overview.tsx';
import { Picker } from '../components/Picker.tsx';
import { usePref } from '../store.ts';

type Filter = 'live' | 'upcoming' | 'trial' | 'paused' | 'ended' | 'terminated' | 'lifetime' | 'all';
type Sort = 'next' | 'cost' | 'name' | 'start';
type Dir = 'asc' | 'desc';
/** 各排序的默认方向：最近扣款在前、最贵在前、名称 A→Z、最新开始在前 */
const DEFAULT_DIR: Record<Sort, Dir> = { next: 'asc', cost: 'desc', name: 'asc', start: 'desc' };
type View = 'grid' | 'list' | 'gantt';
const isSort = (v: string): v is Sort => ['next', 'cost', 'name', 'start'].includes(v);
const isDir = (v: string): v is Dir => v === 'asc' || v === 'desc';
const isView = (v: string): v is View => ['grid', 'list', 'gantt'].includes(v);

const FILTERS = (): Array<[Filter, string]> => [
  ['all', t('list.all')],
  ['live', t('list.status.active')],
  ['upcoming', t('list.status.upcoming')],
  ['trial', t('list.status.trialShort')],
  ['paused', t('list.status.paused')],
  ['lifetime', t('list.status.lifetime')],
  ['ended', t('list.status.ended')],
  ['terminated', t('list.status.terminated')],
];

/** 「订阅中」只算正在计费的（含到期不续）；试用、暂停各自单独一类，和概览、公开页的计数一致 */
const statusOf = (st: string): Filter => (st === 'active' || st === 'ending' ? 'live' : (st as Filter));

export function List({
  state,
  today,
  onOpen,
  onAdd,
  category,
}: {
  state: AppState;
  today: string;
  onOpen: (s: Subscription) => void;
  onAdd: () => void;
  category?: string;
}) {
  // 全部订阅页的状态筛选记在服务端；分类页默认看全部状态，只在本页有效
  const [savedFilter, setSavedFilter] = usePref<Filter>('list-status', 'live', (v): v is Filter => FILTERS().some(([k]) => k === v));
  const [catFilter, setCatFilter] = useState<Filter>('all');
  const filter = category ? catFilter : savedFilter;
  const setFilter = (v: Filter) => (category ? setCatFilter(v) : setSavedFilter(v));
  const [cat, setCat] = useState<string>(category ?? 'all');
  const [pay, setPay] = useState<string>('all');
  const [q, setQ] = useState('');
  useEffect(() => setCat(category ?? 'all'), [category]);
  // 排序、方向、视图存在服务端，多台设备一致；切换到另一种排序时用它的默认方向，再点同一种则反转
  const [sort, setSort] = usePref<Sort>('list-sort', 'next', isSort);
  const [dir, setDir] = usePref<Dir>('list-dir', DEFAULT_DIR[sort], isDir);
  const chooseSort = (k: Sort) => {
    setSort(k);
    setDir(DEFAULT_DIR[k]);
  };
  const toggleSort = (k: Sort) => (k === sort ? setDir(dir === 'asc' ? 'desc' : 'asc') : chooseSort(k));
  const [view, setView] = usePref<View>('list-view', 'grid', isView);
  // 金额显示：原币，或折算成侧边栏选的货币（大字为折算后，小字为原币）
  const orig = useOrig();
  const money2 = orig ? 'orig' : state.settings.baseCurrency;
  // 显示今天生效的那一段：下次扣款落在下一段时，金额仍按当前这段，变更另起一行提示
  const shown = (s: Subscription, n?: string): { value: number; ccy: string; sub?: string } => {
    const cur = currentPhase(s, today);
    s = cur;
    if (n && cur.end && n >= cur.end) n = undefined;
    const price = n ? priceAt(s, n) : s.price;
    const live = !['lifetime', 'ended', 'terminated'].includes(effectiveStatus(s, today));
    if (money2 === 'orig' || s.currency === money2) {
      return {
        value: price,
        ccy: s.currency,
        sub: s.proxy
          ? t('list.proxyExcluded')
          : live && (s.currency !== base || s.cycle.unit !== 'month' || s.cycle.every !== 1)
            ? t('list.perMonthApprox', { amount: money(mo(s), base, { compact: true }) })
            : undefined,
      }; // 外币或不是按月付的，都折成每月多少
    }
    return { value: toBaseAt(state, price, s.currency, undefined, money2), ccy: money2, sub: t('list.originalPrice', { amount: money(price, s.currency) }) };
  };
  const base = state.settings.baseCurrency;

  // 多维筛选：状态、分类、支付方式；每个选项的数字按「其他维度已选条件」计算
  // 代付是替别人付的，不进「全部订阅」，在「代付」页单独管
  const mine = state.subscriptions.filter((s) => !s.proxy);
  const payOf = (s: Subscription) => currentPhase(s, today).methodId ?? 'none';
  // 搜索也是一个筛选条件：名称、分类、标签、备注、地区、支付方式、网址都能搜，各维度的计数随之变化
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const methodName = new Map(state.methods.map((m) => [m.id, m.name]));
  const haystack = (s: Subscription) =>
    [s.name, s.category, ...s.tags, s.notes, s.region, s.url, methodName.get(payOf(s))].filter(Boolean).join(' ').toLowerCase();
  const hit = (s: Subscription, skip?: 'status' | 'cat' | 'pay') => {
    if (words.length && !words.every((w) => haystack(s).includes(w))) return false;
    if (skip !== 'status' && filter !== 'all' && statusOf(effectiveStatus(s, today)) !== filter) return false;
    if (skip !== 'cat' && cat !== 'all' && s.category !== cat) return false;
    if (skip !== 'pay' && pay !== 'all' && payOf(s) !== pay) return false;
    return true;
  };
  const match = (s: Subscription) => hit(s);
  const facet = <K extends string>(skip: 'status' | 'cat' | 'pay', key: (s: Subscription) => K) => {
    const n = new Map<string, number>();
    let all = 0;
    for (const s of mine) {
      if (!hit(s, skip)) continue;
      all++;
      n.set(key(s), (n.get(key(s)) ?? 0) + 1);
    }
    n.set('all', all);
    return n;
  };
  const statusN = facet('status', (s) => statusOf(effectiveStatus(s, today)));
  const catN = facet('cat', (s) => s.category);
  const payN = facet('pay', payOf);
  // 按分类表的顺序（设置里可拖动调整）
  const cats = categories()
    .map((c) => c.name)
    .filter((c) => mine.some((s) => s.category === c));
  const dirty = filter !== 'live' || cat !== (category ?? 'all') || pay !== 'all' || !!q;
  const mo = (s: Subscription) => monthlyMine(state, s, today);
  // 先按升序比较，再按方向翻转；没有下次扣款的始终排在最后
  const asc = (a: Subscription, b: Subscription) => {
    if (sort === 'name') return a.name.localeCompare(b.name, locale());
    if (sort === 'cost') return mo(a) - mo(b) || toBase(state, a.price, a.currency) - toBase(state, b.price, b.currency);
    if (sort === 'start') return a.start.localeCompare(b.start);
    return (nextCharge(a, today) ?? '').localeCompare(nextCharge(b, today) ?? '');
  };
  const rows = mine.filter(match).sort((a, b) => {
    if (sort === 'next') {
      const na = nextCharge(a, today);
      const nb = nextCharge(b, today);
      if (!na || !nb) return na ? -1 : nb ? 1 : 0;
    }
    return dir === 'asc' ? asc(a, b) : asc(b, a);
  });
  const sum = rows.reduce((a, s) => a + (['ended', 'terminated'].includes(effectiveStatus(s, today)) ? 0 : mo(s)), 0);
  const saved = new Map(cancelSavings(state, today).items.map((x) => [x.sub.id, x.saved]));

  return (
    <>
      <Toolbar
        title={category ?? t('list.title')}
        sub={t('list.summary', { count: rows.length, monthly: money(sum, base, { compact: true }), yearly: money(sum * 12, base, { compact: true }) })}
      >
        <label className="tb-search">
          <Icon name="search" />
          <input
            type="search"
            value={q}
            placeholder={t('list.search')}
            aria-label={t('list.search')}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && q && (e.stopPropagation(), setQ(''))}
          />
          {q && (
            <button type="button" className="tb-search-x" onClick={() => setQ('')} aria-label={t('common.clear')}>
              <Icon name="x" size={14} />
            </button>
          )}
        </label>
        <Seg
          small
          value={view}
          onChange={setView}
          options={[
            ['grid', t('list.view.grid')],
            ['list', t('list.view.list')],
            ['gantt', t('list.view.gantt')],
          ]}
        />
        <Picker
          variant="btn"
          value={sort}
          onChange={chooseSort}
          ariaLabel={t('list.sort.label')}
          options={
            [
              { value: 'next', label: t('list.sort.next') },
              { value: 'cost', label: t('list.sort.cost') },
              { value: 'name', label: t('list.sort.name') },
              { value: 'start', label: t('list.sort.start') },
            ] as Array<{ value: Sort; label: string }>
          }
        />
        <button
          type="button"
          className="icon-btn"
          onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')}
          aria-label={dir === 'asc' ? t('list.sort.asc') : t('list.sort.desc')}
          title={dir === 'asc' ? t('list.sort.asc') : t('list.sort.desc')}
        >
          <Icon name={dir === 'asc' ? 'sort-asc' : 'sort-desc'} />
        </button>
        {!state.readonly && (
          <button className="icon-btn accent d-only page-add" onClick={onAdd} aria-label={t('list.add')}>
            <Icon name="plus" />
          </button>
        )}
      </Toolbar>
      <div className="page fade-in">
        <div className="facets">
          {dirty && (
            <button
              className="facet-clear"
              onClick={() => {
                setFilter('live');
                setCat(category ?? 'all');
                setPay('all');
                setQ('');
              }}
            >
              {t('list.clear')}
            </button>
          )}
          <FacetRow
            label={t('list.facet.status')}
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            options={FILTERS().map(([k, l]) => ({ key: k, label: l, n: statusN.get(k) ?? 0 }))}
          />
          <FacetRow
            label={t('list.facet.category')}
            value={cat}
            onChange={setCat}
            options={[
              { key: 'all', label: t('list.all'), n: catN.get('all') ?? 0 },
              ...cats.map((c) => ({ key: c, label: c, icon: <CatIcon cat={c} size={13} />, n: catN.get(c) ?? 0 })),
            ]}
          />
          <FacetRow
            label={t('list.facet.pay')}
            value={pay}
            onChange={setPay}
            options={[
              { key: 'all', label: t('list.all'), n: payN.get('all') ?? 0 },
              ...state.methods.map((m) => ({ key: m.id, label: m.name, icon: <MethodMark m={m} size={16} />, n: payN.get(m.id) ?? 0 })),
              { key: 'none', label: t('list.unassigned'), n: payN.get('none') ?? 0 },
            ]}
          />
        </div>
        {rows.length === 0 && <div className="empty">{t('list.empty')}</div>}
        {view === 'gantt' ? (
          rows.length > 0 && <Gantt rows={rows} state={state} today={today} onOpen={onOpen} />
        ) : view === 'grid' ? (
          <div className="sgrid">
            {rows.map((s) => {
              const st = effectiveStatus(s, today);
              const n = nextCharge(s, today);
              const d = n ? diffDays(today, n) : undefined;
              const cur = currentPhase(s, today);
              const up = upcomingPhase(s, today);
              const m = state.methods.find((x) => x.id === cur.methodId);
              return (
                <button key={s.id} className={`scard st-${st}`} onClick={() => onOpen(s)}>
                  <CardGlow sub={s} />
                  <div className="sc-top">
                    <SubIcon sub={s} size={48} />
                    <span className="sc-flags">
                      {cur.region && <span className="badge">{cur.region}</span>}
                      {st === 'upcoming' && <span className="badge blue">{t('list.status.upcoming')}</span>}
                      {st === 'trial' && <span className="badge green">{t('list.status.trialShort')}</span>}
                      {st === 'ending' && <span className="badge orange">{t('list.status.ending')}</span>}
                      {st === 'paused' && <span className="badge">{t('list.status.pausedShort')}</span>}
                      {st === 'ended' && <span className="badge">{t('list.status.ended')}</span>}
                      {st === 'terminated' && <span className="badge">{t('list.status.terminated')}</span>}
                      <StopBadge sub={s} today={today} readonly={state.readonly} />
                      {st === 'lifetime' && <span className="badge">{t('list.status.lifetime')}</span>}
                      {s.share?.role === 'owner' && <span className="badge blue">{t('list.badge.share')}</span>}
                      {s.share?.role === 'member' && <span className="badge blue">{t('list.badge.joined')}</span>}
                      {s.proxy && <ProxyBadge state={state} s={s} today={today} />}
                    </span>
                  </div>
                  <div className="sc-name">
                    <span>{s.name}</span>
                    {s.intro && s.intro.until > today && <Icon name="leaf" size={13} />}
                  </div>
                  <div className="sc-meta">
                    <CatChip cat={s.category} />
                    <PayBadge m={m} />
                  </div>
                  <div className="sc-price">
                    <Amount value={shown(s, n).value} ccy={shown(s, n).ccy} />
                    <span className="sc-per">/{perLabel(cur)}</span>
                  </div>
                  {up && <ChangeNote cur={cur} up={up} st={st} today={today} state={state} />}
                  <ParallelNote sub={s} cur={cur} today={today} />
                  <div className="sc-foot">
                    <span>{shown(s, n).sub ?? '\u00a0'}</span>
                    <span className={d != null && d <= 3 ? 'soon' : ''}>
                      {st === 'lifetime' ? (
                        s.start.slice(0, 7)
                      ) : ['ended', 'terminated'].includes(st) ? (
                        saved.get(s.id) ? (
                          <span className="green">{t('list.saved', { amount: money(saved.get(s.id)!, base, { compact: true }) })}</span>
                        ) : (
                          (s.end ?? '')
                        )
                      ) : n ? (
                        d! <= 14 ? (
                          relDays(d!)
                        ) : (
                          cnDate(n)
                        )
                      ) : (
                        ''
                      )}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="ltable-wrap">
            <div className="ltable" role="table">
              <div className="lt-row lt-head" role="row">
                {(
                  [
                    ['name', t('list.col.name')],
                    [null, t('list.col.category')],
                    [null, t('list.col.method')],
                    [null, t('list.col.amount')],
                    ['cost', t('list.col.monthly')],
                    ['start', t('list.col.start')],
                    ['next', t('list.col.next')],
                  ] as Array<[Sort | null, string]>
                ).map(([k, l]) =>
                  k ? (
                    <button
                      key={l}
                      className={`lt-sort ${sort === k ? 'on' : ''}`}
                      onClick={() => toggleSort(k)}
                      aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      {l}
                      {sort === k && <Icon name={dir === 'asc' ? 'sort-asc' : 'sort-desc'} size={12} />}
                    </button>
                  ) : (
                    <span key={l}>{l}</span>
                  ),
                )}
              </div>
              {rows.map((s) => {
                const st = effectiveStatus(s, today);
                const n = nextCharge(s, today);
                const d = n ? diffDays(today, n) : undefined;
                const cur = currentPhase(s, today);
                const up = upcomingPhase(s, today);
                const m = state.methods.find((x) => x.id === cur.methodId);
                const v = shown(s, n);
                const live = !['lifetime', 'ended', 'terminated'].includes(st);
                return (
                  <button key={s.id} className={`lt-row st-${st}`} role="row" onClick={() => onOpen(s)}>
                    <span className="lt-name">
                      <SubIcon sub={s} size={32} />
                      <span className="lt-title">
                        <span className="nm">
                          <b>{s.name}</b>
                          {s.intro && s.intro.until > today && <Icon name="leaf" size={13} />}
                          {cur.region && <span className="badge">{cur.region}</span>}
                          {st === 'upcoming' && <span className="badge blue">{t('list.status.upcoming')}</span>}
                          {st === 'trial' && <span className="badge green">{t('list.status.trialShort')}</span>}
                          {st === 'ending' && <span className="badge orange">{t('list.status.ending')}</span>}
                          {st === 'paused' && <span className="badge">{t('list.status.pausedShort')}</span>}
                          {st === 'ended' && <span className="badge">{t('list.status.ended')}</span>}
                          {st === 'terminated' && <span className="badge">{t('list.status.terminated')}</span>}
                          <StopBadge sub={s} today={today} readonly={state.readonly} />
                          {st === 'lifetime' && <span className="badge">{t('list.status.lifetime')}</span>}
                          {s.share?.role === 'owner' && s.share.members.length > 0 && <span className="badge blue">{t('list.badge.share')}</span>}
                          {s.share?.role === 'member' && <span className="badge blue">{t('list.badge.joined')}</span>}
                          {s.proxy && (
                            <span className="badge" title={t('list.badge.proxyFor', { name: s.proxy.forName || t('list.badge.someone') })}>
                              {t('list.badge.proxy')}
                            </span>
                          )}
                        </span>
                        {up && <ChangeNote cur={cur} up={up} st={st} today={today} state={state} />}
                        <ParallelNote sub={s} cur={cur} today={today} />
                      </span>
                    </span>
                    <span className="lt-cat">
                      <CatChip cat={s.category} />
                    </span>
                    <span className="lt-pay">
                      <PayBadge m={m} />
                    </span>
                    <span className="lt-amt">
                      <span>
                        <Amount value={v.value} ccy={v.ccy} />
                        <small>/{perLabel(cur)}</small>
                      </span>
                      {money2 !== 'orig' && s.currency !== money2 && <small>{v.sub}</small>}
                    </span>
                    <span className="lt-mo">{s.proxy ? <small>{t('list.notCounted')}</small> : live ? money(mo(s), base, { compact: true }) : '—'}</span>
                    <span className="lt-start">
                      {cnDate(s.start)}
                      <small>{s.start.slice(0, 4)}</small>
                    </span>
                    <span className={`lt-next ${d != null && d <= 3 ? 'soon' : ''}`}>
                      {st === 'lifetime' ? (
                        t('list.status.lifetime')
                      ) : ['ended', 'terminated'].includes(st) ? (
                        saved.get(s.id) ? (
                          <span className="green">{t('list.saved', { amount: money(saved.get(s.id)!, base, { compact: true }) })}</span>
                        ) : (
                          <>{tx('list.endedOn', { date: <small>{s.end ?? '—'}</small> })}</>
                        )
                      ) : n ? (
                        <>
                          {cnDate(n)}
                          <small>{relDays(d!)}</small>
                        </>
                      ) : (
                        '—'
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** 待生效变更的一行提示：「10月27日起 🇺🇸 $9.99/月 · 支付方式」，未来才开始的订阅写「10月27日开始」 */
function ChangeNote({ cur, up, st, today, state }: { cur: Subscription; up: Subscription; st: string; today: string; state: AppState }) {
  const d = diffDays(today, up.start);
  const when = d <= 14 ? relDays(d) : cnDate(up.start);
  const m = state.methods.find((x) => x.id === up.methodId);
  const parts = [
    up.region && up.region !== cur.region ? up.region : '',
    st === 'upcoming' || up.price !== cur.price || up.currency !== cur.currency ? `${money(up.price, up.currency)}/${perLabel(up)}` : '',
    up.methodId !== cur.methodId || st === 'upcoming' ? (m ? m.name : t('list.change.noMethod')) : '',
  ].filter(Boolean);
  return (
    <div className="change-note">
      <Icon name="right" size={12} />
      <span>
        {up.planned ? t('list.change.planned') : ''}
        {t(st === 'upcoming' ? 'list.change.starts' : 'list.change.from', { when })}
        {parts.length ? ` · ${parts.join(' · ')}` : ''}
      </span>
    </div>
  );
}

/** 换区后旧的那段还没到期、两边都在付钱：标出它是哪一段、用到哪天 */
function ParallelNote({ sub, cur, today }: { sub: Subscription; cur: Subscription; today: string }) {
  if (!sub.phases?.length) return null;
  const vs = activePhases(sub, today).filter((v) => v.start !== cur.start);
  if (!vs.length) return null;
  return (
    <div className="change-note parallel">
      <Icon name="copy" size={12} />
      <span>
        {vs
          .map((v) =>
            t('list.overlap.note', {
              what: v.region && v.region !== cur.region ? v.region : `${money(v.price, v.currency)}/${perLabel(v)}`,
              date: cnDate(v.end!),
            }),
          )
          .join(' · ')}
      </span>
    </div>
  );
}

/** 代付状态角标：有待收显示「代付 · 待收 N 期」，否则「代付 · 已结清」 */
function ProxyBadge({ state, s, today }: { state: AppState; s: Subscription; today: string }) {
  const n = proxyOwed(state, s, today);
  const name = s.proxy?.forName;
  const key = `list.proxyBadge.${n ? 'owed' : 'settled'}${name ? 'For' : ''}`;
  return (
    <span className={`badge ${n ? 'orange' : 'green'}`} title={s.proxy?.note}>
      {t(key, { count: n, name })}
    </span>
  );
}

/** 一行筛选：左边维度名，右边「全部」+ 各选项胶囊（数量在胶囊内；没有匹配的隐藏，已选中的保留）；再点已选中的回到「全部」，一行放不下时横向滑动 */
function FacetRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ key: string; label: string; n: number; icon?: React.ReactNode }>;
}) {
  return (
    <div className="facet-row">
      <span className="facet-label">{label}</span>
      <div className="facet-opts">
        {options
          .filter((o) => o.key === 'all' || o.n > 0 || o.key === value)
          .map((o) => (
            <button
              key={o.key}
              className={`facet ${value === o.key ? 'on' : ''} ${o.icon ? 'has-icon' : ''}`}
              aria-pressed={value === o.key}
              onClick={() => onChange(value === o.key && o.key !== 'all' ? 'all' : o.key)}
            >
              {o.icon}
              {o.label}
              <span className="n">×{o.n}</span>
            </button>
          ))}
      </div>
    </div>
  );
}

/**
 * 卡片顶部的光晕：用图标的主色（白底图标模糊后只剩一片白，所以不直接铺图片）；
 * 域名类用注册商图标（默认 Cloudflare）；取不到颜色时用分类色
 */
function CardGlow({ sub }: { sub: Subscription }) {
  const src = isDomainCat(sub.category)
    ? sub.icon?.startsWith('http')
      ? sub.icon
      : base('/brands/cloudflare.svg')
    : sub.icon?.startsWith('/')
      ? sub.icon
      : subImage(sub);
  const tint = useIconTint(src);
  return <div className="sc-glow" style={{ background: tint ?? catColor(sub.category) }} />;
}
