import { useEffect, useState } from 'preact/hooks';
import { diffDays, effectiveStatus, monthlyGross, myShareFactor, nextCharge, priceAt } from '../../shared/billing.ts';
import { cnDate, money, relDays } from '../../shared/format.ts';
import { toBaseAt } from '../../shared/fx.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { Amount, Icon, PayBadge, Seg, SubIcon, Toolbar } from '../components/ui.tsx';
import { cancelSavings } from '../../shared/metrics.ts';
import { catColor, domainOf, toBase } from '../derive.ts';
import { perLabel } from './Overview.tsx';
import { Detail } from './Detail.tsx';

type Filter = 'live' | 'trial' | 'ended' | 'lifetime' | 'all';
type Sort = 'next' | 'cost' | 'name' | 'start';

const FILTERS: Array<[Filter, string]> = [
  ['live', '计费中'],
  ['trial', '试用'],
  ['lifetime', '买断'],
  ['ended', '已归档'],
  ['all', '全部'],
];

/** 宽屏时在右侧显示详情，窄屏点按弹出 */
function useWide() {
  const q = '(min-width: 1061px)';
  const [wide, setWide] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

function iconUrl(s: Subscription): string | undefined {
  if (s.category === '域名') return undefined;
  if (s.icon?.startsWith('http')) return s.icon;
  const d = domainOf(s.url);
  return d ? `https://www.google.com/s2/favicons?domain=${d}&sz=128` : undefined;
}

export function List({ state, today, onOpen, onEdit, onAdd, category }: { state: AppState; today: string; onOpen: (s: Subscription) => void; onEdit: (s: Subscription) => void; onAdd: () => void; category?: string }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>(category ? 'all' : 'live');
  const [sort, setSort] = useState<Sort>('next');
  const [selId, setSelId] = useState<string | null>(null);
  const [view, setViewRaw] = useState<'grid' | 'list'>(() => {
    try {
      return (localStorage.getItem('ledger:list-view') as 'grid' | 'list') || 'grid';
    } catch {
      return 'grid';
    }
  });
  // 金额显示：原币，或折算成人民币 / 美元（大字为目标币种，小字为原币）
  const [money2, setMoneyRaw] = useState<'orig' | 'CNY' | 'USD'>(() => {
    try {
      return (localStorage.getItem('ledger:list-ccy') as 'orig' | 'CNY' | 'USD') || 'orig';
    } catch {
      return 'orig';
    }
  });
  const setMoney = (v: 'orig' | 'CNY' | 'USD') => {
    setMoneyRaw(v);
    try {
      localStorage.setItem('ledger:list-ccy', v);
    } catch {
      /* ignore */
    }
  };
  const shown = (s: Subscription, n?: string): { value: number; ccy: string; sub?: string } => {
    const price = n ? priceAt(s, n) : s.price;
    const live = !['lifetime', 'ended'].includes(effectiveStatus(s, today));
    if (money2 === 'orig' || s.currency === money2) {
      return { value: price, ccy: s.currency, sub: s.currency !== base && live ? `≈ ${money(mo(s), base, { compact: true })}/月` : undefined };
    }
    return { value: toBaseAt(state, price, s.currency, undefined, money2), ccy: money2, sub: `原价 ${money(price, s.currency)}` };
  };
  const setView = (v: 'grid' | 'list') => {
    setViewRaw(v);
    try {
      localStorage.setItem('ledger:list-view', v);
    } catch {
      /* ignore */
    }
  };
  const wide = useWide();
  const base = state.settings.baseCurrency;

  const match = (s: Subscription) => {
    const st = effectiveStatus(s, today);
    if (category && s.category !== category) return false;
    if (filter === 'live' && !(st === 'active' || st === 'ending' || st === 'paused')) return false;
    if (filter === 'trial' && st !== 'trial') return false;
    if (filter === 'ended' && st !== 'ended') return false;
    if (filter === 'lifetime' && st !== 'lifetime') return false;
    if (q) {
      const m = state.methods.find((x) => x.id === s.methodId)?.name ?? '';
      const hay = `${s.name} ${s.category} ${s.tags.join(' ')} ${m} ${s.notes ?? ''} ${s.region ?? ''}`.toLowerCase();
      if (!q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  };
  const pool = state.subscriptions.filter((s) => !category || s.category === category);
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, 0])) as Record<Filter, number>;
  for (const s of pool) {
    const st = effectiveStatus(s, today);
    counts.all++;
    if (st === 'active' || st === 'ending' || st === 'paused') counts.live++;
    if (st === 'trial') counts.trial++;
    if (st === 'ended') counts.ended++;
    if (st === 'lifetime') counts.lifetime++;
  }
  const mo = (s: Subscription) => toBase(state, monthlyGross(s, today), s.currency) * myShareFactor(s);
  const rows = state.subscriptions.filter(match).sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'zh');
    if (sort === 'cost') return mo(b) - mo(a) || toBase(state, b.price, b.currency) - toBase(state, a.price, a.currency);
    if (sort === 'start') return b.start.localeCompare(a.start);
    return (nextCharge(a, today) ?? '9999').localeCompare(nextCharge(b, today) ?? '9999');
  });
  const sum = rows.reduce((a, s) => a + (effectiveStatus(s, today) === 'ended' ? 0 : mo(s)), 0);
  const saved = new Map(cancelSavings(state, today).items.map((x) => [x.sub.id, x.saved]));
  const sel = state.subscriptions.find((s) => s.id === selId) ?? rows[0];

  return (
    <>
      <Toolbar title={category ?? '全部订阅'} sub={`${rows.length} 项 · 每月 ${money(sum, base, { compact: true })} · 每年 ${money(sum * 12, base, { compact: true })}`}>
        <Seg
          small
          value={money2}
          onChange={setMoney}
          options={[
            ['orig', '原币'],
            ['CNY', '人民币'],
            ['USD', '美元'],
          ]}
        />
        <Seg
          small
          value={view}
          onChange={setView}
          options={[
            ['grid', '卡片'],
            ['list', '列表'],
          ]}
        />
        <select class="btn" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as Sort)} aria-label="排序">
          <option value="next">按下次扣款</option>
          <option value="cost">按月成本</option>
          <option value="name">按名称</option>
          <option value="start">按开始时间</option>
        </select>
        {!state.readonly && (
          <button class="icon-btn accent d-only" onClick={onAdd} aria-label="添加订阅">
            <Icon name="plus" />
          </button>
        )}
      </Toolbar>
      <div class="page fade-in">
        <div class="filters">
          <label class="search">
            <Icon name="search" />
            <input value={q} placeholder="搜索" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          </label>
        </div>
        <div class="chips" style={{ marginBottom: 16 }}>
          {FILTERS.map(([k, l]) => (
            <button key={k} class={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
              {l} <span class="n">{counts[k]}</span>
            </button>
          ))}
        </div>
        {rows.length === 0 && <div class="empty">没有匹配的订阅</div>}
        {view === 'grid' ? (
          <div class="sgrid">
            {rows.map((s) => {
              const st = effectiveStatus(s, today);
              const n = nextCharge(s, today);
              const d = n ? diffDays(today, n) : undefined;
              const m = state.methods.find((x) => x.id === s.methodId);
              const icon = iconUrl(s);
              return (
                <button key={s.id} class={`scard st-${st}`} onClick={() => onOpen(s)}>
                  <div class="sc-glow" style={icon ? { backgroundImage: `url("${icon}")` } : { background: `radial-gradient(circle at 30% 30%, ${catColor(s.category)}, transparent 70%)` }} />
                  <div class="sc-top">
                    <SubIcon sub={s} size={48} />
                    <span class="sc-flags">
                      {s.region && <span class="badge">{s.region}</span>}
                      {st === 'trial' && <span class="badge green">试用</span>}
                      {st === 'ending' && <span class="badge orange">到期不续</span>}
                      {st === 'paused' && <span class="badge">暂停</span>}
                      {st === 'ended' && <span class="badge">已退订</span>}
                      {st === 'lifetime' && <span class="badge">买断</span>}
                      {s.share?.role === 'owner' && s.share.members.length > 0 && <span class="badge blue">车主</span>}
                    </span>
                  </div>
                  <div class="sc-name">
                    <span>{s.name}</span>
                    {s.intro && s.intro.until > today && <Icon name="leaf" size={13} />}
                  </div>
                  <div class="sc-meta">
                    <span style={{ color: catColor(s.category) }}>{s.category}</span>
                    <PayBadge m={m} />
                  </div>
                  <div class="sc-price">
                    <Amount value={shown(s, n).value} ccy={shown(s, n).ccy} />
                    <span class="sc-per">/{perLabel(s)}</span>
                  </div>
                  <div class="sc-foot">
                    <span>{shown(s, n).sub ?? '\u00a0'}</span>
                    <span class={d != null && d <= 3 ? 'soon' : ''}>
                      {st === 'lifetime' ? s.start.slice(0, 7) : st === 'ended' ? (saved.get(s.id) ? <span class="green">省 {money(saved.get(s.id)!, base, { compact: true })}</span> : (s.end ?? '')) : n ? (d! <= 14 ? relDays(d!) : cnDate(n)) : ''}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
        <div class="split">
          <div>
            <div class="subcards">
              {rows.map((s) => {
                const st = effectiveStatus(s, today);
                const n = nextCharge(s, today);
                const d = n ? diffDays(today, n) : undefined;
                const m = state.methods.find((x) => x.id === s.methodId);
                return (
                  <button key={s.id} class={`subcard st-${st} ${wide && sel?.id === s.id ? 'sel' : ''}`} onClick={() => (wide ? setSelId(s.id) : onOpen(s))}>
                    <SubIcon sub={s} size={44} />
                    <div style={{ minWidth: 0 }}>
                      <div class="nm">
                        <span>{s.name}</span>
                        {s.intro && s.intro.until > today && <Icon name="leaf" size={13} />}
                        {st === 'trial' && <span class="badge green">试用</span>}
                        {st === 'ending' && <span class="badge orange">到期不续</span>}
                        {st === 'paused' && <span class="badge">暂停</span>}
                        {s.share?.role === 'owner' && s.share.members.length > 0 && <span class="badge blue">车主</span>}
                        {s.share?.role === 'member' && <span class="badge blue">上车</span>}
                      </div>
                      <div class="meta">
                        <span style={{ color: catColor(s.category), fontWeight: 600 }}>{s.category}</span>
                        <PayBadge m={m} />
                      </div>
                    </div>
                    <div class="rt">
                      <div>
                        <Amount value={shown(s, n).value} ccy={shown(s, n).ccy} />
                        <span class="muted" style={{ fontSize: 12 }}>
                          /{perLabel(s)}
                        </span>
                      </div>
                      {money2 !== 'orig' && s.currency !== money2 && <div class="orig">{shown(s, n).sub}</div>}
                      <div class={`when ${d != null && d <= 3 ? 'soon' : ''}`}>
                        {st === 'lifetime' ? `买断于 ${s.start.slice(0, 7)}` : st === 'ended' ? (saved.get(s.id) ? <span class="green">退订后省 {money(saved.get(s.id)!, base, { compact: true })}</span> : `结束于 ${s.end ?? '—'}`) : n ? `${d! <= 14 ? relDays(d!) : cnDate(n)}` : '—'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          {wide && sel && (
            <div class="split-detail">
              <Detail key={sel.id} sub={sel} state={state} today={today} onEdit={() => onEdit(sel)} />
            </div>
          )}
        </div>
        )}
      </div>
    </>
  );
}
