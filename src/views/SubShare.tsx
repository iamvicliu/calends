import { chargesBetween, currentPhase, cycleLabel, diffDays, effectiveStatus, phaseSubs, priceAt } from '../../shared/billing.ts';
import { cnDate, flag, money } from '../../shared/format.ts';

/** 不是今年的日期带上年份 */
const when = (d: string, today: string) => (d.slice(0, 4) === today.slice(0, 4) ? cnDate(d) : `${d.slice(0, 4)}年${cnDate(d)}`);
import { chargeValue } from '../../shared/fx.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { ShareSheet } from '../components/ShareSheet.tsx';
import { SubIcon } from '../components/ui.tsx';
import { catColor } from '../derive.ts';

type Style = 'card' | 'receipt' | 'timeline' | 'poster' | 'years';
const STYLES: Array<[Style, string]> = [
  ['card', '卡片'],
  ['receipt', '小票'],
  ['timeline', '历程'],
  ['poster', '海报'],
  ['years', '逐年'],
];

/** 一个订阅的完整故事：花了多少、订了多久、换过几次、每年多少 */
function story(state: AppState, sub: Subscription, today: string) {
  const base = state.settings.baseCurrency;
  const charges = chargesBetween(sub, sub.start, today, today).filter((c) => c.kind !== 'failed');
  const values = charges.map((c) => chargeValue(state, c));
  const total = values.reduce((a, v) => a + v, 0);
  const vs = phaseSubs(sub);
  const active = vs.reduce((a, v) => (v.start > today ? a : a + Math.max(0, diffDays(v.start, v.end && v.end < today ? v.end : today))), 0);
  const gaps = vs.slice(1).flatMap((v, i) => (vs[i].end && vs[i].end! < v.start ? [{ from: vs[i].end!, to: v.start, days: diffDays(vs[i].end!, v.start) }] : []));
  const years = new Map<string, number>();
  charges.forEach((c, i) => years.set(c.date.slice(0, 4), (years.get(c.date.slice(0, 4)) ?? 0) + values[i]));
  const first = vs[0];
  const cur = currentPhase(sub, today);
  const p0 = priceAt(first, first.start);
  const p1 = priceAt(cur, today < cur.start ? cur.start : today);
  const same = first.currency === cur.currency && first.cycle.unit === cur.cycle.unit && first.cycle.every === cur.cycle.every && p0 > 0;
  const y = Math.floor(active / 365);
  const mo = Math.floor((active % 365) / 30.44);
  return {
    base,
    charges,
    values,
    total,
    vs,
    cur,
    active,
    gaps,
    years: [...years].sort((a, b) => a[0].localeCompare(b[0])),
    duration: y ? `${y} 年${mo ? ` ${mo} 个月` : ''}` : mo ? `${mo} 个月` : `${active} 天`,
    perMonth: active > 0 ? total / Math.max(1, active / 30.44) : 0,
    perDay: active > 0 ? total / active : 0,
    change: same ? p1 / p0 - 1 : undefined,
    p0,
    p1,
    status: effectiveStatus(sub, today),
  };
}
type Story = ReturnType<typeof story>;
interface Ctx {
  sub: Subscription;
  st: Story;
  hide: boolean;
  m: (v: number, ccy?: string) => string;
  today: string;
}

const STATUS_TEXT: Record<string, string> = { active: '订阅中', ending: '到期不续', trial: '试用中', paused: '已暂停', ended: '已退订', lifetime: '已买断', upcoming: '即将开始' };
const changeText = (st: Story, m: Ctx['m']) =>
  st.change == null ? `换过 ${st.vs.length - 1} 次` : Math.abs(st.change) < 0.005 ? '价格没变过' : `${st.change > 0 ? '涨了' : '降了'} ${Math.round(Math.abs(st.change) * 100)}%`;

/** 单个订阅的分享图 */
export function SubShare({ sub, state, today, onClose }: { sub: Subscription; state: AppState; today: string; onClose: () => void }) {
  const st = story(state, sub, today);
  return (
    <ShareSheet
      title={`分享「${sub.name}」`}
      styles={STYLES}
      storageKey="ledger:sub-share-style"
      base={st.base}
      fileName={(l) => `${sub.name}-${l}.png`}
      onClose={onClose}
      render={(style, { hide, m }) => {
        const ctx: Ctx = { sub, st, hide, m, today };
        return style === 'card' ? <SCard {...ctx} /> : style === 'receipt' ? <SReceipt {...ctx} /> : style === 'timeline' ? <STimeline {...ctx} /> : style === 'poster' ? <SPoster {...ctx} /> : <SYears {...ctx} />;
      }}
    />
  );
}

/** 卡片：深色，总额 + 四格指标 + 一条按阶段着色的时间条 */
function SCard({ sub, st, hide, m, today }: Ctx) {
  const start = st.vs[0].start;
  const span = Math.max(1, diffDays(start, today));
  const colors = ['#7c9bf5', '#3dd68c', '#ff8b3e', '#bf7af0', '#2dd4bf', '#f472b6'];
  return (
    <div class="sc">
      <div class="sc-head">
        <SubIcon sub={sub} size={44} proxied />
        <div>
          <b>{sub.name}</b>
          <span>
            {STATUS_TEXT[st.status]} · {when(start, today)} 起
          </span>
        </div>
      </div>
      <small class="sc-k">{hide ? '一起走过' : '一共花了'}</small>
      <div class="sc-big">{hide ? st.duration : m(st.total)}</div>
      <div class="sc-grid">
        <div>
          <small>{hide ? '扣款' : '订了'}</small>
          <b>{hide ? `${st.charges.length} 次` : st.duration}</b>
        </div>
        <div>
          <small>{hide ? '断过' : '实际每月'}</small>
          <b>{hide ? `${st.gaps.length} 次` : m(st.perMonth)}</b>
        </div>
        <div>
          <small>价格</small>
          <b>{changeText(st, m)}</b>
        </div>
        <div>
          <small>{hide ? '阶段' : '扣款'}</small>
          <b>{hide ? `${st.vs.length} 段` : `${st.charges.length} 次`}</b>
        </div>
      </div>
      <div class="sc-bar">
        {st.vs.map((v, i) => {
          const end = v.end && v.end < today ? v.end : today;
          if (v.start > today) return null;
          return <i key={v.start} style={{ left: `${(diffDays(start, v.start) / span) * 100}%`, width: `${Math.max(1, (diffDays(v.start, end) / span) * 100)}%`, background: colors[i % colors.length] }} />;
        })}
      </div>
      <div class="sc-foot">
        <span>
          {when(start, today)} — 今天
        </span>
        <span>calends.example.com</span>
      </div>
    </div>
  );
}

/** 小票：逐笔列出扣款，最后合计；隐藏金额时列出每期的地区和日期 */
function SReceipt({ sub, st, hide, m, today }: Ctx) {
  const rows = st.charges.map((c, i) => ({ c, v: st.values[i] })).reverse();
  const shown = rows.slice(0, 14);
  const rest = rows.slice(14);
  const bars = Array.from({ length: 46 }, (_, i) => 1 + ((Math.round(st.total) * 7 + st.charges.length * 13 + i * 31) % 4));
  return (
    <div class="rc">
      <div class="rc-shop">{sub.name}</div>
      <div class="rc-sub">SUBSCRIPTION RECEIPT</div>
      <div class="rc-meta">
        <span>{when(st.vs[0].start, today)} 起</span>
        <span>{STATUS_TEXT[st.status]}</span>
      </div>
      <div class="rc-cut" />
      {shown.map(({ c, v }, i) => (
        <div key={i} class="rc-row">
          <span class="rc-d">{c.date}</span>
          <span class="rc-n">{c.kind === 'refund' ? '退款' : c.sub.region ? `${flag(c.sub.region)} ${c.sub.region}` : cycleLabel(c.sub.cycle)}</span>
          <span class="rc-v">{hide ? (c.kind === 'refund' ? '退' : `第 ${rows.length - i} 期`) : m(c.amount, c.currency)}</span>
          {!hide && c.currency !== st.base && <span class="rc-x">≈{m(v)}</span>}
        </div>
      ))}
      {rest.length > 0 && (
        <div class="rc-row">
          <span class="rc-d">··</span>
          <span class="rc-n">更早 {rest.length} 笔</span>
          <span class="rc-v">{hide ? '' : m(rest.reduce((a, x) => a + x.v, 0))}</span>
        </div>
      )}
      <div class="rc-cut" />
      <div class="rc-sum">
        <span>{hide ? '时长 TIME' : '合计 TOTAL'}</span>
        <b>{hide ? st.duration : m(st.total)}</b>
      </div>
      <div class="rc-kv">
        <span>扣款笔数</span>
        <span>{st.charges.length} 笔</span>
      </div>
      <div class="rc-kv">
        <span>{hide ? '换区 / 换套餐' : '实际每月'}</span>
        <span>{hide ? `${st.vs.length - 1} 次` : m(st.perMonth)}</span>
      </div>
      <div class="rc-kv">
        <span>价格</span>
        <span>{changeText(st, m)}</span>
      </div>
      <div class="rc-cut" />
      <div class="rc-bars">
        {bars.map((w, i) => (
          <i key={i} style={{ width: w, marginRight: i % 3 === 0 ? 2 : 1 }} />
        ))}
      </div>
      <div class="rc-thanks">谢谢惠顾 · 下期见</div>
      <div class="rc-site">calends.example.com</div>
    </div>
  );
}

/** 历程：竖向时间线，每段一个节点，断档单独一行 */
function STimeline({ sub, st, hide, m, today }: Ctx) {
  const items: Array<{ key: string; gap?: number; v?: Subscription; from: string; to?: string }> = [];
  st.vs.forEach((v, i) => {
    const g = st.gaps.find((x) => x.to === v.start);
    if (i && g) items.push({ key: `g${v.start}`, gap: g.days, from: g.from, to: g.to });
    items.push({ key: v.start, v, from: v.start, to: v.end });
  });
  return (
    <div class="tlc" style={{ '--tint': catColor(sub.category) } as Record<string, string>}>
      <div class="tlc-head">
        <SubIcon sub={sub} size={48} proxied />
        <div>
          <b>{sub.name}</b>
          <span>
            {st.duration} · {hide ? `${st.charges.length} 次扣款` : `共 ${m(st.total)}`}
          </span>
        </div>
      </div>
      <div class="tlc-list">
        {items.map((it) =>
          it.gap ? (
            <div key={it.key} class="tlc-gap">
              断了 {it.gap >= 60 ? `${Math.round(it.gap / 30.4)} 个月` : `${it.gap} 天`}
            </div>
          ) : (
            <div key={it.key} class={`tlc-item ${it.v!.planned ? 'planned' : ''}`}>
              <i />
              <div>
                <small>
                  {when(it.from, today)} — {it.to ? (it.to > today ? `${when(it.to, today)}（计划）` : when(it.to, today)) : '至今'}
                </small>
                <b>
                  {it.v!.region ? `${flag(it.v!.region)} ${it.v!.region} · ` : ''}
                  {hide ? cycleLabel(it.v!.cycle) : `${money(it.v!.price, it.v!.currency, { compact: true })} ${cycleLabel(it.v!.cycle)}`}
                </b>
                {(it.v!.priceHistory?.length ?? 0) > 1 && !hide && <span>期间调价 {it.v!.priceHistory!.map((p) => money(p.amount, it.v!.currency, { compact: true })).join(' → ')}</span>}
                {sub.phases?.find((ph) => ph.start === it.v!.start)?.note && <span>{sub.phases!.find((ph) => ph.start === it.v!.start)!.note}</span>}
              </div>
            </div>
          ),
        )}
      </div>
      <div class="tlc-foot">calends.example.com</div>
    </div>
  );
}

/** 海报：大图标 + 「陪伴了多久」 + 总额 */
function SPoster({ sub, st, hide, m }: Ctx) {
  return (
    <div class="sp" style={{ '--tint': catColor(sub.category) } as Record<string, string>}>
      <div class="sp-icon">
        <SubIcon sub={sub} size={112} proxied />
      </div>
      <div class="sp-name">{sub.name}</div>
      <div class="sp-k">陪伴了</div>
      <div class="sp-big">{st.duration}</div>
      <div class="sp-line">
        {hide ? `${st.charges.length} 次扣款 · ${changeText(st, m)}` : `一共 ${m(st.total)} · 平均每天 ${m(st.perDay)}`}
      </div>
      <div class="sp-chips">
        <span>{STATUS_TEXT[st.status]}</span>
        {st.gaps.length > 0 && <span>断过 {st.gaps.length} 次</span>}
        {st.vs.length > 1 && <span>换过 {st.vs.length - 1} 次</span>}
        {st.change != null && <span>{changeText(st, m)}</span>}
      </div>
      <div class="sp-foot">calends.example.com</div>
    </div>
  );
}

/** 逐年：每年花了多少的柱状图 */
function SYears({ sub, st, hide, m }: Ctx) {
  const max = Math.max(1, ...st.years.map(([, v]) => v));
  return (
    <div class="sy">
      <div class="sy-head">
        <SubIcon sub={sub} size={36} proxied />
        <div>
          <b>{sub.name}</b>
          <span>每年花了多少</span>
        </div>
      </div>
      <div class="sy-big">{hide ? st.duration : m(st.total)}</div>
      <div class="sy-bars">
        {st.years.map(([y, v]) => (
          <div key={y} class="sy-col">
            <span class="sy-v">{hide ? `${st.total > 0 ? Math.round((v / st.total) * 100) : 0}%` : m(v)}</span>
            <i style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
            <span class="sy-y">{y}</span>
          </div>
        ))}
      </div>
      <div class="sy-foot">
        <span>{st.charges.length} 次扣款 · {changeText(st, m)}</span>
        <span>calends.example.com</span>
      </div>
    </div>
  );
}
