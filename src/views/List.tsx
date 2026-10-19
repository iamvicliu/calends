import { useState } from 'preact/hooks';
import { cycleLabel, diffDays, effectiveStatus, monthlyGross, myShareFactor, nextCharge } from '../../shared/billing.ts';
import { cnDate, money, relDays } from '../../shared/format.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { Icon, SectionHead, SubIcon } from '../components/ui.tsx';
import { catColor, toBase } from '../derive.ts';

type Filter = 'live' | 'trial' | 'ended' | 'lifetime' | 'all';
type Sort = 'next' | 'cost' | 'name' | 'start';

const FILTERS: Array<[Filter, string]> = [
  ['live', '计费中'],
  ['trial', '试用'],
  ['lifetime', '买断'],
  ['ended', '已结束'],
  ['all', '全部'],
];

export function List({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('live');
  const [cat, setCat] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('next');
  const base = state.settings.baseCurrency;

  const match = (s: Subscription) => {
    const st = effectiveStatus(s, today);
    if (filter === 'live' && !(st === 'active' || st === 'ending' || st === 'paused')) return false;
    if (filter === 'trial' && st !== 'trial') return false;
    if (filter === 'ended' && st !== 'ended') return false;
    if (filter === 'lifetime' && st !== 'lifetime') return false;
    if (cat && s.category !== cat) return false;
    if (q) {
      const m = state.methods.find((x) => x.id === s.methodId)?.name ?? '';
      const hay = `${s.name} ${s.category} ${s.tags.join(' ')} ${m} ${s.notes ?? ''} ${s.region ?? ''}`.toLowerCase();
      if (!q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  };
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, 0])) as Record<Filter, number>;
  for (const s of state.subscriptions) {
    const st = effectiveStatus(s, today);
    counts.all++;
    if (st === 'active' || st === 'ending' || st === 'paused') counts.live++;
    if (st === 'trial') counts.trial++;
    if (st === 'ended') counts.ended++;
    if (st === 'lifetime') counts.lifetime++;
  }
  const cats = [...new Set(state.subscriptions.map((s) => s.category))];
  const mo = (s: Subscription) => toBase(state, monthlyGross(s, today), s.currency) * myShareFactor(s);
  const rows = state.subscriptions.filter(match).sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'zh');
    if (sort === 'cost') return mo(b) - mo(a) || toBase(state, b.price, b.currency) - toBase(state, a.price, a.currency);
    if (sort === 'start') return b.start.localeCompare(a.start);
    return (nextCharge(a, today) ?? '9999').localeCompare(nextCharge(b, today) ?? '9999');
  });
  const sum = rows.reduce((a, s) => a + (effectiveStatus(s, today) === 'ended' ? 0 : mo(s)), 0);

  return (
    <div class="wrap fade-in">
      <SectionHead no="■" label="All subscriptions" title="全部订阅" meta={`${rows.length} 项 · 月均 ${money(sum, base, { compact: true })} · 年均 ${money(sum * 12, base, { compact: true })}`} />
      <div class="toolbar">
        <label class="search">
          <Icon name="search" />
          <input value={q} placeholder="搜索名称、标签、支付方式…" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </label>
        <select class="select" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as Sort)}>
          <option value="next">按下次扣款</option>
          <option value="cost">按月成本</option>
          <option value="name">按名称</option>
          <option value="start">按开始时间</option>
        </select>
      </div>
      <div class="chips" style={{ marginBottom: 10 }}>
        {FILTERS.map(([k, l]) => (
          <button key={k} class={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
            {l} <span class="n">{counts[k]}</span>
          </button>
        ))}
      </div>
      <div class="chips" style={{ marginBottom: 22 }}>
        {cats.map((c) => (
          <button key={c} class={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(cat === c ? null : c)}>
            <span class="dot" style={{ background: catColor(c) }} />
            {c}
          </button>
        ))}
      </div>
      <div class="ledger">
        {rows.length === 0 && <div class="empty" style={{ marginTop: 16 }}>没有匹配的订阅</div>}
        {rows.map((s) => {
          const st = effectiveStatus(s, today);
          const n = nextCharge(s, today);
          const d = n ? diffDays(today, n) : undefined;
          const m = state.methods.find((x) => x.id === s.methodId);
          const badge =
            st === 'trial' ? <span class="badge warn">试用</span> : st === 'ending' ? <span class="badge warn">到期不续</span> : st === 'paused' ? <span class="badge">暂停</span> : st === 'ended' ? <span class="badge">已结束</span> : null;
          return (
            <button key={s.id} class={`row has-when st-${st}`} onClick={() => onOpen(s)}>
              <SubIcon sub={s} />
              <div class="row-main" style={{ minWidth: 0 }}>
                <div class="row-title">
                  {s.name}
                  {badge}
                  {s.intro && s.intro.until > today && <span class="badge ok">🌿 优惠</span>}
                  {s.share?.role === 'owner' && s.share.members.length > 0 && <span class="badge accent">车主</span>}
                  {s.share?.role === 'member' && <span class="badge accent">上车</span>}
                </div>
                <div class="row-sub">
                  {[m?.name, s.category, s.region].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div class="leader" />
              <div class="row-amt">
                <div class="a">{money(s.price, s.currency)}</div>
                <div class="b">
                  {cycleLabel(s.cycle)}
                  {s.currency !== base && st !== 'lifetime' ? ` · ≈${money(toBase(state, s.price, s.currency), base, { compact: true })}` : ''}
                </div>
              </div>
              <div class={`row-when ${d != null && d <= 3 ? 'soon' : ''}`}>
                <div class="a">{st === 'lifetime' ? '买断于' : st === 'ended' ? '结束于' : d != null ? relDays(d) : '—'}</div>
                <div class="b">{st === 'lifetime' ? s.start.slice(0, 7) : st === 'ended' ? (s.end ?? '—') : n ? cnDate(n) : '—'}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
