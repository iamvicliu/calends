import { useEffect, useState } from 'preact/hooks';
import { currentPhase, diffDays, effectiveStatus, monthlyMine, nextCharge, priceAt, upcomingPhase } from '../../shared/billing.ts';
import { cnDate, flag, money, relDays } from '../../shared/format.ts';
import { toBaseAt } from '../../shared/fx.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { Amount, catIcon, CatChip, Icon, MethodMark, PayBadge, Seg, SubIcon, Toolbar } from '../components/ui.tsx';
import { proxyOwed } from './Proxy.tsx';
import { t } from '../../shared/i18n.ts';
import { tx } from '../i18n.ts';
import { cancelSavings } from '../../shared/metrics.ts';
import { subImage, toBase } from '../derive.ts';
import { useOrig } from '../display.ts';
import { Gantt } from './Gantt.tsx';
import { perLabel } from './Overview.tsx';
import { Picker } from '../components/Picker.tsx';

type Filter = 'live' | 'upcoming' | 'trial' | 'ended' | 'lifetime' | 'all';
type Sort = 'next' | 'cost' | 'name' | 'start';

const FILTERS = (): Array<[Filter, string]> => [
  ['all', t('list.all')],
  ['live', t('list.status.active')],
  ['upcoming', t('list.status.upcoming')],
  ['trial', t('list.status.trialShort')],
  ['lifetime', t('list.status.lifetime')],
  ['ended', t('list.status.ended')],
];

const statusOf = (st: string): Filter => (st === 'active' || st === 'ending' || st === 'paused' ? 'live' : (st as Filter));


export function List({ state, today, onOpen, onAdd, category }: { state: AppState; today: string; onOpen: (s: Subscription) => void; onAdd: () => void; category?: string }) {
  const [filter, setFilter] = useState<Filter>(category ? 'all' : 'live');
  const [cat, setCat] = useState<string>(category ?? 'all');
  const [pay, setPay] = useState<string>('all');
  useEffect(() => setCat(category ?? 'all'), [category]);
  const [sort, setSort] = useState<Sort>('next');
  const [view, setViewRaw] = useState<'grid' | 'list' | 'gantt'>(() => {
    try {
      return (localStorage.getItem('ledger:list-view') as 'grid' | 'list' | 'gantt') || 'grid';
    } catch {
      return 'grid';
    }
  });
  // 金额显示：原币，或折算成侧边栏选的货币（大字为折算后，小字为原币）
  const orig = useOrig();
  const money2 = orig ? 'orig' : state.settings.baseCurrency;
  // 显示今天生效的那一段：下次扣款落在下一段时，金额仍按当前这段，变更另起一行提示
  const shown = (s: Subscription, n?: string): { value: number; ccy: string; sub?: string } => {
    const cur = currentPhase(s, today);
    s = cur;
    if (n && cur.end && n >= cur.end) n = undefined;
    const price = n ? priceAt(s, n) : s.price;
    const live = !['lifetime', 'ended'].includes(effectiveStatus(s, today));
    if (money2 === 'orig' || s.currency === money2) {
      return { value: price, ccy: s.currency, sub: s.proxy ? t('list.proxyExcluded') : live && (s.currency !== base || s.cycle.unit !== 'month' || s.cycle.every !== 1) ? t('list.perMonthApprox', { amount: money(mo(s), base, { compact: true }) }) : undefined }; // 外币或不是按月付的，都折成每月多少
    }
    return { value: toBaseAt(state, price, s.currency, undefined, money2), ccy: money2, sub: t('list.originalPrice', { amount: money(price, s.currency) }) };
  };
  const setView = (v: 'grid' | 'list' | 'gantt') => {
    setViewRaw(v);
    try {
      localStorage.setItem('ledger:list-view', v);
    } catch {
      /* ignore */
    }
  };
  const base = state.settings.baseCurrency;

  // 多维筛选：状态、分类、支付方式；每个选项的数字按「其他维度已选条件」计算
  // 代付是替别人付的，不进「全部订阅」，在「代付」页单独管
  const mine = state.subscriptions.filter((s) => !s.proxy);
  const payOf = (s: Subscription) => currentPhase(s, today).methodId ?? 'none';
  const hit = (s: Subscription, skip?: 'status' | 'cat' | 'pay') => {
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
  const cats = [...new Set(mine.map((s) => s.category))].sort((x, y) => (catN.get(y) ?? 0) - (catN.get(x) ?? 0));
  const dirty = filter !== 'live' || cat !== (category ?? 'all') || pay !== 'all';
  const mo = (s: Subscription) => monthlyMine(state, s, today);
  const rows = mine.filter(match).sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'zh');
    if (sort === 'cost') return mo(b) - mo(a) || toBase(state, b.price, b.currency) - toBase(state, a.price, a.currency);
    if (sort === 'start') return b.start.localeCompare(a.start);
    return (nextCharge(a, today) ?? '9999').localeCompare(nextCharge(b, today) ?? '9999');
  });
  const sum = rows.reduce((a, s) => a + (effectiveStatus(s, today) === 'ended' ? 0 : mo(s)), 0);
  const saved = new Map(cancelSavings(state, today).items.map((x) => [x.sub.id, x.saved]));

  return (
    <>
      <Toolbar title={category ?? t('list.title')} sub={t('list.summary', { count: rows.length, monthly: money(sum, base, { compact: true }), yearly: money(sum * 12, base, { compact: true }) })}>
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
        <Picker variant="btn" value={sort} onChange={setSort} ariaLabel={t('list.sort.label')} options={[{ value: 'next', label: t('list.sort.next') }, { value: 'cost', label: t('list.sort.cost') }, { value: 'name', label: t('list.sort.name') }, { value: 'start', label: t('list.sort.start') }] as Array<{ value: Sort; label: string }>} />
        {!state.readonly && (
          <button class="icon-btn accent d-only" onClick={onAdd} aria-label={t('list.add')}>
            <Icon name="plus" />
          </button>
        )}
      </Toolbar>
      <div class="page fade-in">
        <div class="facets">
          {dirty && (
            <button
              class="facet-clear"
              onClick={() => {
                setFilter('live');
                setCat(category ?? 'all');
                setPay('all');
              }}
            >
              {t('list.clear')}
            </button>
          )}
          <FacetRow label={t('list.facet.status')} value={filter} onChange={(v) => setFilter(v as Filter)} options={FILTERS().map(([k, l]) => ({ key: k, label: l, n: statusN.get(k) ?? 0 }))} />
          <FacetRow label={t('list.facet.category')} value={cat} onChange={setCat} options={[{ key: 'all', label: t('list.all'), n: catN.get('all') ?? 0 }, ...cats.map((c) => ({ key: c, label: c, icon: <Icon name={catIcon(c)} size={13} />, n: catN.get(c) ?? 0 }))]} />
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
        {rows.length === 0 && <div class="empty">{t('list.empty')}</div>}
        {view === 'gantt' ? (
          rows.length > 0 && <Gantt rows={rows} state={state} today={today} onOpen={onOpen} />
        ) : view === 'grid' ? (
          <div class="sgrid">
            {rows.map((s) => {
              const st = effectiveStatus(s, today);
              const n = nextCharge(s, today);
              const d = n ? diffDays(today, n) : undefined;
              const cur = currentPhase(s, today);
              const up = upcomingPhase(s, today);
              const m = state.methods.find((x) => x.id === cur.methodId);
              const icon = subImage(s);
              return (
                <button key={s.id} class={`scard st-${st}`} onClick={() => onOpen(s)}>
                  <div class="sc-glow" style={icon ? { backgroundImage: `url("${icon}")` } : { background: 'var(--fill-2)' }} />
                  <div class="sc-top">
                    <SubIcon sub={s} size={48} />
                    <span class="sc-flags">
                      {cur.region && <span class="badge">{cur.region}</span>}
                      {st === 'upcoming' && <span class="badge blue">{t('list.status.upcoming')}</span>}
                      {st === 'trial' && <span class="badge green">{t('list.status.trialShort')}</span>}
                      {st === 'ending' && <span class="badge orange">{t('list.status.ending')}</span>}
                      {st === 'paused' && <span class="badge">{t('list.status.pausedShort')}</span>}
                      {st === 'ended' && <span class="badge">{t('list.status.ended')}</span>}
                      {st === 'lifetime' && <span class="badge">{t('list.status.lifetime')}</span>}
                      {s.share?.role === 'owner' && <span class="badge blue">{t('list.badge.share')}</span>}
                      {s.share?.role === 'member' && <span class="badge blue">{t('list.badge.joined')}</span>}
                      {s.proxy && <ProxyBadge state={state} s={s} today={today} />}
                    </span>
                  </div>
                  <div class="sc-name">
                    <span>{s.name}</span>
                    {s.intro && s.intro.until > today && <Icon name="leaf" size={13} />}
                  </div>
                  <div class="sc-meta">
                    <CatChip cat={s.category} />
                    <PayBadge m={m} />
                  </div>
                  <div class="sc-price">
                    <Amount value={shown(s, n).value} ccy={shown(s, n).ccy} />
                    <span class="sc-per">/{perLabel(cur)}</span>
                  </div>
                  {up && <ChangeNote cur={cur} up={up} st={st} today={today} state={state} />}
                  <div class="sc-foot">
                    <span>{shown(s, n).sub ?? '\u00a0'}</span>
                    <span class={d != null && d <= 3 ? 'soon' : ''}>
                      {st === 'lifetime' ? s.start.slice(0, 7) : st === 'ended' ? (saved.get(s.id) ? <span class="green">{t('list.saved', { amount: money(saved.get(s.id)!, base, { compact: true }) })}</span> : (s.end ?? '')) : n ? (d! <= 14 ? relDays(d!) : cnDate(n)) : ''}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div class="ltable-wrap">
          <div class="ltable" role="table">
            <div class="lt-row lt-head" role="row">
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
                  <button key={l} class={`lt-sort ${sort === k ? 'on' : ''}`} onClick={() => setSort(k)}>
                    {l}
                    {sort === k && <Icon name="down" size={11} />}
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
              const live = !['lifetime', 'ended'].includes(st);
              return (
                <button key={s.id} class={`lt-row st-${st}`} role="row" onClick={() => onOpen(s)}>
                  <span class="lt-name">
                    <SubIcon sub={s} size={32} />
                    <span class="lt-title">
                      <span class="nm">
                        <b>{s.name}</b>
                        {s.intro && s.intro.until > today && <Icon name="leaf" size={13} />}
                        {cur.region && <span class="badge">{cur.region}</span>}
                        {st === 'upcoming' && <span class="badge blue">{t('list.status.upcoming')}</span>}
                        {st === 'trial' && <span class="badge green">{t('list.status.trialShort')}</span>}
                        {st === 'ending' && <span class="badge orange">{t('list.status.ending')}</span>}
                        {st === 'paused' && <span class="badge">{t('list.status.pausedShort')}</span>}
                        {st === 'ended' && <span class="badge">{t('list.status.ended')}</span>}
                        {st === 'lifetime' && <span class="badge">{t('list.status.lifetime')}</span>}
                        {s.share?.role === 'owner' && s.share.members.length > 0 && <span class="badge blue">{t('list.badge.share')}</span>}
                        {s.share?.role === 'member' && <span class="badge blue">{t('list.badge.joined')}</span>}
                        {s.proxy && <span class="badge" title={t('list.badge.proxyFor', { name: s.proxy.forName || t('list.badge.someone') })}>{t('list.badge.proxy')}</span>}
                      </span>
                      {up && <ChangeNote cur={cur} up={up} st={st} today={today} state={state} />}
                    </span>
                  </span>
                  <span class="lt-cat">
                    <CatChip cat={s.category} />
                  </span>
                  <span class="lt-pay">
                    <PayBadge m={m} />
                  </span>
                  <span class="lt-amt">
                    <span>
                      <Amount value={v.value} ccy={v.ccy} />
                      <small>/{perLabel(cur)}</small>
                    </span>
                    {money2 !== 'orig' && s.currency !== money2 && <small>{v.sub}</small>}
                  </span>
                  <span class="lt-mo">{s.proxy ? <small>{t('list.notCounted')}</small> : live ? money(mo(s), base, { compact: true }) : '—'}</span>
                  <span class="lt-start">{cnDate(s.start)}<small>{s.start.slice(0, 4)}</small></span>
                  <span class={`lt-next ${d != null && d <= 3 ? 'soon' : ''}`}>
                    {st === 'lifetime' ? (
                      t('list.status.lifetime')
                    ) : st === 'ended' ? (
                      saved.get(s.id) ? <span class="green">{t('list.saved', { amount: money(saved.get(s.id)!, base, { compact: true }) })}</span> : <>{tx('list.endedOn', { date: <small>{s.end ?? '—'}</small> })}</>
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
export function ChangeNote({ cur, up, st, today, state }: { cur: Subscription; up: Subscription; st: string; today: string; state: AppState }) {
  const d = diffDays(today, up.start);
  const when = d <= 14 ? relDays(d) : cnDate(up.start);
  const m = state.methods.find((x) => x.id === up.methodId);
  const parts = [
    up.region && up.region !== cur.region ? `${flag(up.region)} ${up.region}` : '',
    st === 'upcoming' || up.price !== cur.price || up.currency !== cur.currency ? `${money(up.price, up.currency)}/${perLabel(up)}` : '',
    up.methodId !== cur.methodId || st === 'upcoming' ? (m ? m.name : t('list.change.noMethod')) : '',
  ].filter(Boolean);
  return (
    <div class="change-note">
      <Icon name="right" size={12} />
      <span>
        {up.planned ? t('list.change.planned') : ''}
        {t(st === 'upcoming' ? 'list.change.starts' : 'list.change.from', { when })}
        {parts.length ? ` · ${parts.join(' · ')}` : ''}
      </span>
    </div>
  );
}

/** 代付状态角标：有待收显示「代付 · 待收 N 期」，否则「代付 · 已结清」 */
function ProxyBadge({ state, s, today }: { state: AppState; s: Subscription; today: string }) {
  const n = proxyOwed(state, s, today);
  const name = s.proxy?.forName;
  const key = `list.proxyBadge.${n ? 'owed' : 'settled'}${name ? 'For' : ''}`;
  return <span class={`badge ${n ? 'orange' : 'green'}`} title={s.proxy?.note}>{t(key, { count: n, name })}</span>;
}

/** 一行筛选：左边维度名，右边「全部」+ 各选项胶囊（数量在胶囊内；没有匹配的隐藏，已选中的保留）；再点已选中的回到「全部」，一行放不下时横向滑动 */
function FacetRow({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ key: string; label: string; n: number; icon?: preact.ComponentChildren }> }) {
  return (
    <div class="facet-row">
      <span class="facet-label">{label}</span>
      <div class="facet-opts">
        {options
          .filter((o) => o.key === 'all' || o.n > 0 || o.key === value)
          .map((o) => (
            <button
              key={o.key}
              class={`facet ${value === o.key ? 'on' : ''} ${o.icon ? 'has-icon' : ''}`}
              aria-pressed={value === o.key}
              onClick={() => onChange(value === o.key && o.key !== 'all' ? 'all' : o.key)}
            >
              {o.icon}
              {o.label}
              <span class="n">×{o.n}</span>
            </button>
          ))}
      </div>
    </div>
  );
}
