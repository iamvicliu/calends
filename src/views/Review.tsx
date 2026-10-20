import { useMemo, useState } from 'preact/hooks';
import { addDays, totals } from '../../shared/billing.ts';
import { money } from '../../shared/format.ts';
import { chargeValue } from '../../shared/fx.ts';
import { cancelSavings, yearReview, type YearReview } from '../../shared/metrics.ts';
import type { AppState } from '../../shared/types.ts';
import { packCircles } from '../components/charts.tsx';
import { ShareSheet } from '../components/ShareSheet.tsx';
import { Seg, SubIcon } from '../components/ui.tsx';
import { allCharges, catColor } from '../derive.ts';

type Style = 'receipt' | 'poster' | 'card' | 'stars';
const STYLES: Array<[Style, string]> = [
  ['poster', '海报'],
  ['receipt', '小票'],
  ['card', '卡片'],
  ['stars', '星图'],
];

interface Ctx {
  r: YearReview;
  year: string;
  name: string;
  ongoing: boolean;
  m: (v: number) => string;
  /** 不显示金额：用占比、笔数、时长代替 */
  hide: boolean;
  /** 占这一年总花费的百分比 */
  pct: (v: number) => string;
  mrr: number;
  saved: number;
  /** 这一年按支付方式分的花费 */
  byMethod: Array<{ name: string; sum: number }>;
  /** 小票底部的一句话：从数据里随机挑 */
  tip: string;
  today: string;
}

/** 年度回顾分享：选一种样式，生成图片后复制或下载 */
export function Review({ state, today, onClose }: { state: AppState; today: string; onClose: () => void }) {
  const years: string[] = [];
  const first = state.subscriptions.reduce((m, s) => (s.start < m ? s.start : m), today).slice(0, 4);
  for (let y = Number(today.slice(0, 4)); y >= Number(first) && years.length < 4; y--) years.push(String(y));
  const [year, setYear] = useState(years[0]);
  const r = useMemo(() => yearReview(state, today, year), [state, today, year]);
  const t = totals(state, today);
  const saved = cancelSavings(state, today)
    .items.filter((x) => x.since.startsWith(year))
    .reduce((a, x) => a + x.saved, 0);
  const pct = (v: number) => `${r.total > 0 ? Math.round((v / r.total) * 100) : 0}%`;
  const base = state.settings.baseCurrency;
  const byMethod = useMemo(() => {
    const from = `${year}-01-01`;
    const to = `${year}-12-31` < today ? `${year}-12-31` : today;
    const sums = new Map<string, number>();
    for (const c of allCharges(state, from, to, today)) {
      const name = state.methods.find((x) => x.id === c.sub.methodId)?.name ?? '未指定';
      sums.set(name, (sums.get(name) ?? 0) + chargeValue(state, c));
    }
    return [...sums].map(([name, sum]) => ({ name, sum })).sort((a, b) => b.sum - a.sum);
  }, [state, today, year]);
  // 底部一句话：都是从这一年的数据里算出来的，打开一次换一句
  const [seed] = useState(() => Math.random());
  const tipsFor = (hide: boolean) => {
    const out: string[] = [];
    const top = r.items[0];
    if (top) out.push(`${top.sub.name} 一个就占了全年的 ${pct(top.sum)}`);
    if (r.longest) out.push(`${r.longest.sub.name} 已经陪了你 ${Math.max(1, Math.floor(r.longest.days / 365))} 年多`);
    if (r.busiestMonth) out.push(`${Number(r.busiestMonth.month.slice(5))} 月是花得最多的一个月`);
    if (r.newSubs.length || r.ended.length) out.push(`这一年新开 ${r.newSubs.length} 个、退订 ${r.ended.length} 个`);
    if (r.currencies > 1) out.push(`这一年用 ${r.currencies} 种货币付过订阅`);
    const soon = allCharges(state, today, addDays(today, 30), today).length;
    if (soon) out.push(`接下来 30 天还有 ${soon} 笔扣款，记得看看还要不要`);
    if (!hide && base === 'CNY' && r.perDay >= 1) out.push(`平均每天 ${money(r.perDay, base)}，差不多 ${Math.max(1, Math.round(r.perDay / 15))} 杯奶茶`);
    if (!hide && saved > 1) out.push(`今年的退订已经帮你省下 ${money(saved, base, { compact: true })}`);
    return out.length ? out[Math.floor(seed * out.length)] : '订阅这件事，记清楚就是省钱';
  };
  return (
    <ShareSheet
      title="分享年度回顾"
      styles={STYLES}
      storageKey="ledger:share-style"
      base={state.settings.baseCurrency}
      fileName={(l) => `订阅年度回顾-${year}-${l}.png`}
      top={years.length > 1 && <Seg value={year} onChange={setYear} options={years.map((y) => [y, y] as [string, string])} />}
      onClose={onClose}
      render={(style, { hide, m }) => {
        const ctx: Ctx = { r, year, name: state.settings.displayName || '我', ongoing: year === today.slice(0, 4), m, hide, pct, mrr: t.mrr, saved, byMethod, tip: tipsFor(hide), today };
        return style === 'receipt' ? <Receipt {...ctx} /> : style === 'poster' ? <Poster {...ctx} /> : style === 'card' ? <Card {...ctx} /> : <Stars {...ctx} />;
      }}
    />
  );
}

/** 两端对齐的一行：左边名称、右边金额，中间用空格撑开（小票打印机的排法） */
function Line({ l, r, b }: { l: string; r: string; b?: boolean }) {
  return (
    <div class={`rp-line ${b ? 'b' : ''}`}>
      <span>{l}</span>
      <span>{r}</span>
    </div>
  );
}

/** 小票：热敏纸机打风格。店名、机号、流水，逐项明细、按支付方式合计，底部条码和一句从数据里挑的话 */
function Receipt({ r, year, name, ongoing, m, hide, pct, byMethod, tip, today }: Ctx) {
  const items = r.items.slice(0, 12);
  const rest = r.items.slice(12);
  const restSum = rest.reduce((a, x) => a + x.sum, 0);
  const bars = Array.from({ length: 52 }, (_, i) => 1 + ((Math.round(r.total) * 7 + r.charges * 13 + i * 31) % 4));
  const amt = (v: number) => (hide ? pct(v) : m(v));
  const no = `${year}${String(r.charges).padStart(4, '0')}`;
  return (
    <div class="rp">
      <div class="rp-c rp-shop">{name} 订阅商店</div>
      <div class="rp-c">SUBSCRIPTION STORE</div>
      <div class="rp-c rp-small">年度结算单 · {ongoing ? `截至 ${today}` : `${year} 全年`}</div>
      <div class="rp-rule">{"=".repeat(60)}</div>
      <Line l={`单号 ${no}`} r={`机号 01`} />
      <Line l={`收银 ${name}`} r={ongoing ? today : `${year}-12-31`} />
      <div class="rp-rule">{"-".repeat(60)}</div>
      <Line l="品名" r={hide ? '占比' : '金额'} />
      <div class="rp-rule">{"-".repeat(60)}</div>
      {items.map((x) => (
        <Line key={x.sub.id} l={x.sub.name} r={amt(x.sum)} />
      ))}
      {rest.length > 0 && <Line l={`其余 ${rest.length} 项`} r={amt(restSum)} />}
      <div class="rp-rule">{"-".repeat(60)}</div>
      <Line l={`共 ${r.items.length} 项 / ${r.charges} 笔`} r="" />
      {!hide && <Line l="合计" r={m(r.total)} b />}
      <div class="rp-rule">{"-".repeat(60)}</div>
      {byMethod.slice(0, 5).map((x) => (
        <Line key={x.name} l={x.name} r={amt(x.sum)} />
      ))}
      <div class="rp-rule">{"=".repeat(60)}</div>
      <div class="rp-bars">
        {bars.map((w, i) => (
          <i key={i} style={{ width: w, marginRight: i % 3 === 0 ? 2 : 1 }} />
        ))}
      </div>
      <div class="rp-c rp-small">{no}</div>
      <div class="rp-tip">* {tip} *</div>
      <div class="rp-c rp-small">calends.example.com</div>
    </div>
  );
}

/** 海报：大字年份 + 总额，下面是这一年所有订阅的图标，按花费分大中小三档，整齐地铺满 */
function Poster({ r, year, name, ongoing, m, hide, pct }: Ctx) {
  const glow = r.items.slice(0, 3).map((x) => catColor(x.sub.category));
  // 第一名占 3×3，接下来四个占 2×2，其余 1×1；dense 排布让格子自动补齐
  const span = (i: number) => (i === 0 ? 3 : i < 5 ? 2 : 1);
  return (
    <div class="ps" style={{ '--g1': glow[0] ?? '#6366f1', '--g2': glow[1] ?? '#ec4899', '--g3': glow[2] ?? '#f59e0b' } as Record<string, string>}>
      <div class="ps-year">{year}</div>
      <div class="ps-kicker">{name}的订阅年度报告</div>
      <div class="ps-total">{hide ? `${r.items.length} 个订阅` : m(r.total)}</div>
      <div class="ps-line">
        {ongoing ? '今年到目前为止' : '这一年'}
        {hide ? `一共 ${r.charges} 次扣款 · ${r.currencies} 种货币` : `花在 ${r.items.length} 个订阅上 · ${r.charges} 次扣款`}
      </div>
      <div class="ps-wall">
        {r.items.map((x, i) => (
          <span key={x.sub.id} class={`s${span(i)}`} title={x.sub.name}>
            <SubIcon sub={x.sub} size={span(i) === 3 ? 96 : span(i) === 2 ? 60 : 30} proxied />
          </span>
        ))}
      </div>
      <div class="ps-top">
        <small>花得最多</small>
        <b>{r.items[0]?.sub.name ?? '—'}</b>
        <span>{r.items[0] ? (hide ? `占全年 ${pct(r.items[0].sum)}` : `${m(r.items[0].sum)} · 占全年 ${pct(r.items[0].sum)}`) : ''}</span>
      </div>
      <div class="ps-foot">
        <span>{hide ? `新开 ${r.newSubs.length} · 退订 ${r.ended.length}` : `日均 ${m(r.perDay)}`}</span>
        <span>calends.example.com</span>
      </div>
    </div>
  );
}

/** 卡片：原来的深色年度回顾卡 */
function Card({ r, year, name, ongoing, m, mrr, saved, hide, pct }: Ctx) {
  const top = r.top[0]?.sum ?? 1;
  return (
    <div class="review">
      <div class="rv-head">
        <span>{year}</span>
        <span>{name} 的订阅</span>
      </div>
      <div class="rv-big">
        <small>{ongoing ? '今年到目前为止' : '这一年'}，{hide ? '一共订了' : '订阅一共花了'}</small>
        <span class="rv-total">{hide ? `${r.items.length} 个订阅` : m(r.total)}</span>
        <span>{hide ? `${r.charges} 次扣款 · ${r.currencies} 种币种` : `${r.charges} 次扣款 · 平均每天 ${m(r.perDay)}`}</span>
      </div>
      <div class="rv-sec">
        <div class="rv-label">花得最多</div>
        {r.top.map((x, i) => (
          <div key={x.sub.id} class="rv-bar">
            <span class="rv-rank">{i + 1}</span>
            <SubIcon sub={x.sub} size={26} proxied />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div class="rv-name">
                <span>{x.sub.name}</span>
                <b>{hide ? pct(x.sum) : m(x.sum)}</b>
              </div>
              <div class="rv-track">
                <i style={{ width: `${(x.sum / top) * 100}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div class="rv-grid">
        {r.longest && (
          <div>
            <small>陪伴最久</small>
            <b>{r.longest.sub.name}</b>
            <span>
              {Math.floor(r.longest.days / 365)} 年 {Math.floor((r.longest.days % 365) / 30)} 个月
            </span>
          </div>
        )}
        {r.busiestMonth && (
          <div>
            <small>最贵的月份</small>
            <b>{Number(r.busiestMonth.month.slice(5))} 月</b>
            <span>{hide ? `占全年 ${pct(r.busiestMonth.sum)}` : m(r.busiestMonth.sum)}</span>
          </div>
        )}
        <div>
          <small>新开 / 退订</small>
          <b>
            {r.newSubs.length} / {r.ended.length}
          </b>
          <span>{saved && !hide ? `退订已省 ${m(saved)}` : r.ended.length ? `退订了 ${r.ended.length} 个` : '没有退订'}</span>
        </div>
        <div>
          <small>用到的币种</small>
          <b>{r.currencies} 种</b>
          <span>{hide ? `${r.charges} 次扣款` : `现在每月 ${m(mrr)}`}</span>
        </div>
      </div>
      <div class="rv-foot">calends.example.com</div>
    </div>
  );
}

/** 星图：每个订阅一个圆，面积按这一年花的钱 */
function Stars({ r, year, name, m, hide, pct }: Ctx) {
  const items = r.items.slice(0, 24);
  // 接近正方形地排布；坐标按宽度归一，高度 = h × 宽
  const bubbles = packCircles(
    items.map((x) => x.sum),
    1.1,
  ) as Array<{ x: number; y: number; r: number; i: number; h: number }>;
  const W = 312;
  return (
    <div class="st">
      <div class="st-head">
        <span>{year} · {name}的订阅星图</span>
        <b>{hide ? `${r.items.length} 个订阅` : m(r.total)}</b>
      </div>
      <div class="st-map" style={{ height: (bubbles[0]?.h ?? 1) * W }}>
        {bubbles.map((b) => {
          const x = items[b.i];
          const d = b.r * 2 * W;
          return (
            <span key={x.sub.id} class="st-b" style={{ left: (b.x - b.r) * W, top: (b.y - b.r) * W, width: d, height: d }}>
              <SubIcon sub={x.sub} size={Math.max(12, Math.round(d * 0.48))} proxied />
              {d > 70 && <small>{hide ? pct(x.sum) : m(x.sum)}</small>}
            </span>
          );
        })}
      </div>
      <div class="st-foot">
        <span>圆越大，这一年花得越多</span>
        <span>calends.example.com</span>
      </div>
    </div>
  );
}
