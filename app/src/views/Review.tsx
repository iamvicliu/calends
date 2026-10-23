import { copyParts } from '../components/copy.tsx';
import { useMemo, useState } from 'react';
import { totals } from '../../../shared/billing.ts';
import { money, monthLabel } from '../../../shared/format.ts';
import { t } from '../../../shared/i18n.ts';
import { chargeValue } from '../../../shared/fx.ts';
import { cancelSavings, yearReview, type YearReview } from '../../../shared/metrics.ts';
import type { AppState } from '../../../shared/types.ts';
import { packCircles } from '../components/charts.tsx';
import { ShareSheet } from '../components/ShareSheet.tsx';
import { MetricCards, Metric, Seg, SubIcon } from '../components/ui.tsx';
import { allCharges, catColor } from '../derive.ts';

type Style = 'receipt' | 'poster' | 'card' | 'stars';
const STYLES = (): Array<[Style, string]> => [
  ['poster', t('review.style.poster')],
  ['receipt', t('review.style.receipt')],
  ['card', t('review.style.card')],
  ['stars', t('review.style.stars')],
];

interface Ctx {
  r: YearReview;
  year: string;
  /** 所有格：「张三」/「Alex's」；没填名字时是「我」/「My」 */
  whose: string;
  ongoing: boolean;
  m: (v: number) => string;
  /** 不显示金额：用占比、笔数、时长代替 */
  hide: boolean;
  /** 占这一年总花费的百分比 */
  pct: (v: number) => string;
  mrr: number;
  saved: string;
  /** 这一年按支付方式分的花费 */
  byMethod: Array<{ name: string; sum: number }>;
  today: string;
}

/** 年度回顾分享：选一种样式，生成图片后复制或下载 */
export function Review({ state, today, onClose }: { state: AppState; today: string; onClose: () => void }) {
  const years: string[] = [];
  const first = state.subscriptions.reduce((m, s) => (s.start < m ? s.start : m), today).slice(0, 4);
  for (let y = Number(today.slice(0, 4)); y >= Number(first) && years.length < 4; y--) years.push(String(y));
  const [year, setYear] = useState(years[0]);
  const r = useMemo(() => yearReview(state, today, year), [state, today, year]);
  const tot = totals(state, today);
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
      const name = state.methods.find((x) => x.id === c.sub.methodId)?.name ?? t('review.unassigned');
      sums.set(name, (sums.get(name) ?? 0) + chargeValue(state, c));
    }
    return [...sums].map(([name, sum]) => ({ name, sum })).sort((a, b) => b.sum - a.sum);
  }, [state, today, year]);
  return (
    <ShareSheet
      title={t('review.title')}
      styles={STYLES()}
      prefKey="share-style"
      base={state.settings.baseCurrency}
      fileName={(l) => t('review.fileName', { year, style: l })}
      top={years.length > 1 && <Seg value={year} onChange={setYear} options={years.map((y) => [y, y] as [string, string])} />}
      onClose={onClose}
      render={(style, { hide, m }) => {
        const dn = state.settings.displayName;
        const ctx: Ctx = {
          r,
          year,
          whose: dn ? t('review.whose', { name: dn }) : t('review.whoseSelf'),
          ongoing: year === today.slice(0, 4),
          m,
          hide,
          pct,
          mrr: tot.mrr,
          saved: saved ? money(saved, base, { compact: true }) : '',
          byMethod,
          today,
        };
        return style === 'receipt' ? (
          <Receipt {...ctx} />
        ) : style === 'poster' ? (
          <Poster {...ctx} />
        ) : style === 'card' ? (
          <Card {...ctx} />
        ) : (
          <Stars {...ctx} />
        );
      }}
    />
  );
}

function ReviewLoss({ r, hide, m }: Pick<Ctx, 'r' | 'hide' | 'm'>) {
  return !hide && r.stopLoss !== 0 ? (
    <div className="review-loss">{Number.isFinite(r.stopLoss) ? t('review.stopLoss', { amount: m(-r.stopLoss) }) : t('core.stop.fxMissing')}</div>
  ) : null;
}

/** 两端对齐的一行：左边名称、右边金额，中间用空格撑开（小票打印机的排法） */
function Line({ l, r, b }: { l: string; r: string; b?: boolean }) {
  return (
    <div className={`rp-line ${b ? 'b' : ''}`}>
      <span>{l}</span>
      <span>{r}</span>
    </div>
  );
}

/** 小票：热敏纸机打风格。店名、机号、流水，逐项明细、按支付方式合计，底部条码和一句从数据里挑的话 */
function Receipt({ r, year, whose, ongoing, m, hide, pct, byMethod, today }: Ctx) {
  const items = r.items.slice(0, 12);
  const rest = r.items.slice(12);
  const restSum = rest.reduce((a, x) => a + x.sum, 0);
  const bars = Array.from({ length: 52 }, (_, i) => 1 + ((Math.round(r.total) * 7 + r.charges * 13 + i * 31) % 4));
  const amt = (v: number) => (hide ? pct(v) : m(-v));
  const no = `${year}${String(r.charges).padStart(4, '0')}`;
  return (
    <div className="rp">
      <div className="rp-c rp-shop">{copyParts(t('review.receipt.shop', { whose }).trim())}</div>
      <div className="rp-c rp-small">{copyParts(ongoing ? t('review.receipt.asOf', { date: today }) : t('review.receipt.fullYear', { year }))}</div>
      <div className="rp-rule">{'='.repeat(60)}</div>
      <div className="rp-rule">{'-'.repeat(60)}</div>
      <Line l={t('review.receipt.item')} r={hide ? t('review.receipt.share') : t('review.receipt.amount')} />
      <div className="rp-rule">{'-'.repeat(60)}</div>
      {items.map((x) => (
        <Line key={x.sub.id} l={x.sub.name} r={amt(x.sum)} />
      ))}
      {rest.length > 0 && <Line l={t('review.receipt.rest', { count: rest.length })} r={amt(restSum)} />}
      <div className="rp-rule">{'-'.repeat(60)}</div>
      <Line l={t('review.receipt.count', { items: r.items.length, charges: r.charges })} r="" />
      {!hide && <Line l={t('review.receipt.total')} r={m(-r.total)} b />}
      {!hide && <div style={{ fontSize: 'var(--fs-1)' }}>{t('review.spendBasis')}</div>}
      <ReviewLoss r={r} hide={hide} m={m} />
      <div className="rp-rule">{'-'.repeat(60)}</div>
      {byMethod.slice(0, 5).map((x) => (
        <Line key={x.name} l={x.name} r={amt(x.sum)} />
      ))}
      <div className="rp-rule">{'='.repeat(60)}</div>
      <div className="rp-bars">
        {bars.map((w, i) => (
          <i key={i} style={{ width: w, marginRight: i % 3 === 0 ? 2 : 1 }} />
        ))}
      </div>
      <div className="rp-c rp-small">{no}</div>
      <div className="rp-c rp-small">{location.host}</div>
    </div>
  );
}

/** 海报：大字年份 + 总额，下面是这一年所有订阅的图标，按花费分大中小三档，整齐地铺满 */
function Poster({ r, year, whose, ongoing, m, hide, pct }: Ctx) {
  const glow = r.items.slice(0, 3).map((x) => catColor(x.sub.category));
  // 第一名占 3×3，接下来四个占 2×2，其余 1×1；dense 排布让格子自动补齐
  const span = (i: number) => (i === 0 ? 3 : i < 5 ? 2 : 1);
  return (
    <div className="ps" style={{ '--g1': glow[0] ?? 'var(--c1)', '--g2': glow[1] ?? 'var(--c7)', '--g3': glow[2] ?? 'var(--c10)' } as Record<string, string>}>
      <div className="ps-year">{year}</div>
      <div className="ps-kicker">{copyParts(t('review.poster.kicker', { whose }).trim())}</div>
      <div className="ps-total">{hide ? t('review.n.subs', { count: r.items.length }) : m(-r.total)}</div>
      {!hide && <div style={{ fontSize: 'var(--fs-1)' }}>{t('review.spendBasis')}</div>}
      <ReviewLoss r={r} hide={hide} m={m} />
      <div className="ps-line">
        {copyParts(
          t(`review.poster.${ongoing ? 'ongoing' : 'year'}${hide ? 'Hidden' : ''}`, {
            charges: t('review.n.charges', { count: r.charges }),
            currencies: t('review.n.currencies', { count: r.currencies }),
            subs: t('review.n.subs', { count: r.items.length }),
          }),
        )}
      </div>
      <div className="ps-wall">
        {r.items.map((x, i) => (
          <span key={x.sub.id} className={`s${span(i)}`} title={x.sub.name}>
            <SubIcon sub={x.sub} size={span(i) === 3 ? 96 : span(i) === 2 ? 60 : 30} proxied />
          </span>
        ))}
      </div>
      <div className="ps-top">
        <small>{t('review.topSpend')}</small>
        <b>{r.items[0]?.sub.name ?? '—'}</b>
        <span>
          {copyParts(
            r.items[0]
              ? hide
                ? t('review.ofYear', { pct: pct(r.items[0].sum) })
                : `${m(-r.items[0].sum)}\n${t('review.ofYear', { pct: pct(r.items[0].sum) })}`
              : '',
          )}
        </span>
      </div>
      <div className="ps-foot">
        <span>
          {copyParts(
            hide ? t('review.poster.newEnded', { added: r.newSubs.length, ended: r.ended.length }) : t('review.poster.perDay', { amount: m(-r.perDay) }),
          )}
        </span>
        <span>{location.host}</span>
      </div>
    </div>
  );
}

/** 卡片：原来的深色年度回顾卡 */
function Card({ r, year, whose, ongoing, m, mrr, saved, hide, pct }: Ctx) {
  const top = r.top[0]?.sum ?? 1;
  return (
    <div className="review">
      <div className="rv-head">
        <span>{year}</span>
        <span>{copyParts(t('review.card.head', { whose }).trim())}</span>
      </div>
      <div className="rv-big">
        <small>{t(`review.card.intro.${ongoing ? 'ongoing' : 'year'}${hide ? 'Hidden' : ''}`)}</small>
        <span className="rv-total">{hide ? t('review.n.subs', { count: r.items.length }) : m(-r.total)}</span>
        {!hide && <small>{t('review.spendBasis')}</small>}
        <ReviewLoss r={r} hide={hide} m={m} />
        <span>
          {copyParts(
            hide
              ? `${t('review.n.charges', { count: r.charges })}\n${t('review.n.currencies', { count: r.currencies })}`
              : `${t('review.n.charges', { count: r.charges })}\n${t('review.card.perDay', { amount: m(-r.perDay) })}`,
          )}
        </span>
      </div>
      <div className="rv-sec">
        <div className="rv-label">{t('review.topSpend')}</div>
        {r.top.map((x, i) => (
          <div key={x.sub.id} className="rv-bar">
            <span className="rv-rank">{i + 1}</span>
            <SubIcon sub={x.sub} size={26} proxied />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="rv-name">
                <span>{x.sub.name}</span>
                <b>{hide ? pct(x.sum) : m(-x.sum)}</b>
              </div>
              <div className="rv-track">
                <i style={{ width: `${(x.sum / top) * 100}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <MetricCards>
        {r.longest && (
          <Metric
            label={t('review.card.longest')}
            value={r.longest.sub.name}
            note={t('review.card.duration', { y: Math.floor(r.longest.days / 365), m: Math.floor((r.longest.days % 365) / 30) })}
          />
        )}
        {r.busiestMonth && (
          <Metric
            label={t('review.card.busiest')}
            value={t('review.card.month', {
              n: Number(r.busiestMonth.month.slice(5)),
              month: monthLabel(r.busiestMonth.month.slice(0, 7), { year: false, long: true }),
            })}
            note={hide ? t('review.ofYear', { pct: pct(r.busiestMonth.sum) }) : m(-r.busiestMonth.sum)}
          />
        )}
        <Metric
          label={t('review.card.newEnded')}
          value={
            <>
              {r.newSubs.length} / {r.ended.length}
            </>
          }
          note={
            saved && !hide
              ? t('review.card.saved', { amount: saved })
              : r.ended.length
                ? t('review.card.ended', { count: r.ended.length })
                : t('review.card.noneEnded')
          }
        />
        <Metric
          label={t('review.card.currencies')}
          value={t('review.card.currencyCount', { count: r.currencies })}
          note={hide ? t('review.n.charges', { count: r.charges }) : t('review.card.nowMonthly', { amount: m(-mrr) })}
        />
      </MetricCards>
      <div className="rv-foot">{location.host}</div>
    </div>
  );
}

/** 星图：每个订阅一个圆，面积按这一年花的钱 */
function Stars({ r, year, whose, m, hide, pct }: Ctx) {
  const items = r.items.slice(0, 24);
  // 接近正方形地排布；坐标按宽度归一，高度 = h × 宽
  const bubbles = packCircles(
    items.map((x) => x.sum),
    1.1,
  ) as Array<{ x: number; y: number; r: number; i: number; h: number }>;
  const W = 312;
  return (
    <div className="st">
      <div className="st-head">
        <span>{copyParts(t('review.stars.head', { year, whose }).trim())}</span>
        <b>{hide ? t('review.n.subs', { count: r.items.length }) : m(-r.total)}</b>
      </div>
      {!hide && <div style={{ fontSize: 'var(--fs-1)' }}>{t('review.spendBasis')}</div>}
      <ReviewLoss r={r} hide={hide} m={m} />
      <div className="st-map" style={{ height: (bubbles[0]?.h ?? 1) * W }}>
        {bubbles.map((b) => {
          const x = items[b.i];
          const d = b.r * 2 * W;
          return (
            <span key={x.sub.id} className="st-b" style={{ left: (b.x - b.r) * W, top: (b.y - b.r) * W, width: d, height: d }}>
              <SubIcon sub={x.sub} size={Math.max(12, Math.round(d * 0.48))} proxied />
              {d > 70 && <small>{hide ? pct(x.sum) : m(-x.sum)}</small>}
            </span>
          );
        })}
      </div>
      <div className="st-foot">
        <span>{t('review.stars.foot')}</span>
        <span>{location.host}</span>
      </div>
    </div>
  );
}
