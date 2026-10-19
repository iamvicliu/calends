import { useMemo } from 'preact/hooks';
import { addDays, addMonths, cycleLabel, diffDays, effectiveStatus, nextCharge, parseDay, runwayFor, totals } from '../../shared/billing.ts';
import { cnDate, money, relDays, symbol } from '../../shared/format.ts';
import { BALANCE_KINDS, type AppState, type Subscription } from '../../shared/types.ts';
import { SectionHead, SubIcon, tipProps } from '../components/ui.tsx';
import { allCharges, breakdown, catColor, earliest, lifetimeByYear, liveSubs, monthSeries, spentSince, toBase } from '../derive.ts';
import { RunwayCard } from './Wallet.tsx';

function Big({ value, ccy }: { value: number; ccy: string }) {
  const s = Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return (
    <span class="hero-num">
      <span class="minus">−</span>
      <span class="cur">{symbol(ccy).trim()}</span>
      {s}
    </span>
  );
}

export function Overview({ state, today, onOpen, onReceipt }: { state: AppState; today: string; onOpen: (s: Subscription) => void; onReceipt: () => void }) {
  const base = state.settings.baseCurrency;
  const t = totals(state, today);
  const first = earliest(state) ?? today;
  const year = today.slice(0, 4);
  const life = useMemo(() => spentSince(state, first, today), [state, today]);
  const ytd = useMemo(() => spentSince(state, `${year}-01-01`, today), [state, today]);
  const series = useMemo(() => monthSeries(state, today), [state, today]);
  const live = liveSubs(state, today);
  const firstSub = state.subscriptions.find((s) => s.start === first);
  const cats = breakdown(state, today, (s) => s.category);
  const methods = breakdown(state, today, (s) => state.methods.find((m) => m.id === s.methodId)?.name ?? '未指定');
  const years = lifetimeByYear(state, today);
  const runways = state.methods.map((m) => runwayFor(m, state, today)).filter((r) => r != null);
  const catKeys = cats.map((c) => c.key);
  const unsetBalance = state.methods.filter((m) => BALANCE_KINDS.includes(m.kind) && m.balance == null && state.subscriptions.some((s) => s.methodId === m.id && live.includes(s)));

  const upcoming = allCharges(state, today, addDays(today, 30), today);
  const upcomingSum = upcoming.reduce((a, c) => a + toBase(state, c.amount, c.currency), 0);
  const nextYear = allCharges(state, addDays(today, 1), addMonths(today, 12), today).reduce((a, c) => a + toBase(state, c.amount, c.currency), 0);

  const max = Math.max(1, ...series.map((m) => m.total));
  const ended = state.subscriptions.filter((s) => effectiveStatus(s, today) === 'ended').length;
  const lifetimeBuys = state.subscriptions.filter((s) => s.cycle.unit === 'lifetime').length;
  const [fy, fm] = first.split('-');

  return (
    <div class="wrap fade-in">
      <div class="eyebrow">Subscription Ledger · {fy}—{year}</div>
      <h1 class="h1">
        每个月，订阅从我这里<em>拿走</em>
      </h1>
      <div class="hero-figure">
        <Big value={t.mrr} ccy={base} />
        <div class="hero-unit">
          负 MRR / 月<b>{t.activeCount} 项正在计费</b>
        </div>
      </div>
      <p class="lede">
        第一笔是 {firstSub?.name ?? '—'}，{fy} 年 {Number(fm)} 月。记录了 {state.subscriptions.length} 项服务，{live.length} 项仍在扣款
        {ended ? `，${ended} 项已经停掉` : ''}
        {lifetimeBuys ? `，另有 ${lifetimeBuys} 个买断` : ''}。
        {t.recoverMrr > 1 ? ` 拼车每月回血 ${money(t.recoverMrr, base, { compact: true })}。` : ''}
      </p>

      <div class="kpis">
        <div class="kpi hl">
          <div class="kpi-label">负 ARR · 年化</div>
          <div class="kpi-value">
            <small>−{symbol(base)}</small>
            {Math.round(t.mrr * 12).toLocaleString()}
          </div>
          <div class="kpi-sub">每天 {money(t.mrr / 30.4375, base)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">{year} 已付</div>
          <div class="kpi-value">
            <small>{symbol(base)}</small>
            {Math.round(ytd.total).toLocaleString()}
          </div>
          <div class="kpi-sub">{ytd.count} 笔扣款</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">累计已付</div>
          <div class="kpi-value">
            <small>{symbol(base)}</small>
            {Math.round(life.total).toLocaleString()}
          </div>
          <div class="kpi-sub">{life.count} 笔 · 自 {fy}</div>
        </div>
        <div class={`kpi ${t.recoverMrr > 1 ? 'good' : ''}`}>
          <div class="kpi-label">未来 12 个月</div>
          <div class="kpi-value">
            <small>{symbol(base)}</small>
            {Math.round(nextYear).toLocaleString()}
          </div>
          <div class="kpi-sub">{t.recoverMrr > 1 ? `拼车回血 ${money(t.recoverMrr * 12, base, { compact: true })}/年` : '按当前订阅预测'}</div>
        </div>
      </div>
      <div class="ccy-line">
        {Object.entries(life.byCcy)
          .filter(([, v]) => v > 0)
          .sort((a, b) => toBase(state, b[1], b[0]) - toBase(state, a[1], a[0]))
          .map(([c, v], i) => (
            <span key={c}>
              {i > 0 && ' · '}
              <b>{c}</b> {money(v, c)}
            </span>
          ))}
      </div>

      <div class="strip">
        <div class="strip-head">
          <span>扣款 · 过去 24 个月 + 未来 12 个月</span>
          <button class="btn sm ghost" style={{ height: 'auto', padding: 0, font: 'inherit', letterSpacing: 'inherit', color: 'var(--muted)' }} onClick={onReceipt}>
            生成账单小票 →
          </button>
        </div>
        <div class="strip-bars">
          {series.map((m) => (
            <div
              key={m.key}
              class={`strip-col ${m.projected ? 'future' : ''} ${m.key === today.slice(0, 7) ? 'now' : ''}`}
              {...tipProps(() => (
                <>
                  <b>{m.key.replace('-', ' 年 ')} 月</b> · {m.count} 笔
                  <br />
                  {money(m.total, base, { compact: true })}
                  {m.projected ? ' · 预测' : ''}
                </>
              ))}
            >
              {catKeys
                .concat(Object.keys(m.byCat).filter((k) => !catKeys.includes(k)))
                .filter((k) => m.byCat[k])
                .map((k) => (
                  <div key={k} class="seg" style={{ height: `${(m.byCat[k] / max) * 100}%`, background: catColor(k) }} />
                ))}
            </div>
          ))}
        </div>
        <div class="strip-axis">
          {series.map((m, i) => (
            <span key={m.key}>{m.key.endsWith('-01') || i === 0 ? (m.key.endsWith('-01') ? m.key.slice(0, 4) : '') : m.key === today.slice(0, 7) ? '▲' : ''}</span>
          ))}
        </div>
      </div>

      {/* 01 即将扣款 */}
      <section class="section">
        <SectionHead no="01" label="Upcoming" title="接下来 30 天" meta={`${upcoming.length} 笔 · 约 ${money(upcomingSum, base, { compact: true })}`} />
        <DueTimeline state={state} today={today} />
        <div class="ledger">
          {upcoming.length === 0 && <div class="empty">未来 30 天没有扣款，享受这份安静。</div>}
          {upcoming.map((c) => {
            const d = diffDays(today, c.date);
            const m = state.methods.find((x) => x.id === c.sub.methodId);
            return (
              <button key={c.sub.id + c.date} class="row has-when" onClick={() => onOpen(c.sub)}>
                <SubIcon sub={c.sub} />
                <div class="row-main" style={{ minWidth: 0 }}>
                  <div class="row-title">
                    {c.sub.name}
                    {c.sub.share?.role === 'owner' && c.sub.share.members.length > 0 && <span class="badge accent">拼车</span>}
                  </div>
                  <div class="row-sub">
                    {m?.name ?? '未指定支付'} · {cycleLabel(c.sub.cycle)}
                  </div>
                </div>
                <div class="leader" />
                <div class="row-amt">
                  <div class="a">{money(c.amount, c.currency)}</div>
                  {c.currency !== base && <div class="b">≈ {money(toBase(state, c.amount, c.currency), base)}</div>}
                </div>
                <div class={`row-when ${d <= 3 ? 'soon' : ''}`}>
                  <div class="a">{relDays(d)}</div>
                  <div class="b">{cnDate(c.date)}</div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 02 余额续航 */}
      {unsetBalance.length > 0 && !state.readonly && (
        <a class="card card-pad hstack" href="#/wallet" style={{ marginTop: 40, textDecoration: 'none', gap: 14 }}>
          <span class="ico" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: 0 }}>
            ¤
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span class="row-title" style={{ display: 'block' }}>
              {unsetBalance.map((m) => m.name).join('、')} 尚未设置余额
            </span>
            <span class="row-sub" style={{ display: 'block' }}>
              填入礼品卡 / 话费余额后，就能推演每期扣多少、还能撑多久，并在不足前邮件提醒。
            </span>
          </span>
          <span class="btn sm">去设置 →</span>
        </a>
      )}
      {runways.length > 0 && (
        <section class="section">
          <SectionHead no="02" label="Runway" title="余额还能扣多久" meta="App Store 礼品卡、手机话费等预充值账户，按订阅扣款逐期推演" />
          <div class="grid-2">
            {runways.map((r) => (
              <RunwayCard key={r.method.id} r={r} today={today} state={state} />
            ))}
          </div>
        </section>
      )}

      {/* 03 分类 */}
      <section class="section">
        <SectionHead no="03" label="By category" title="钱花在哪儿" meta="按月折算，扣除拼车分摊后的个人成本" />
        <ShareList rows={cats} total={t.mrr} base={base} color={catColor} />
      </section>

      {/* 04 支付方式 */}
      <section class="section">
        <SectionHead no="04" label="By payment" title="从哪儿付出去" meta="银行卡、支付宝、App Store 余额、话费，各自承担的月成本" />
        <ShareList rows={methods} total={t.mrr} base={base} color={(_, i) => `var(--c${(i % 10) + 1})`} />
      </section>

      {/* 05 时间线 */}
      <section class="section">
        <SectionHead no="05" label="Timeline" title="时间线" meta="实心为仍在计费，浅色为已结束，◆ 为买断" />
        <Gantt state={state} today={today} onOpen={onOpen} />
      </section>

      {/* 06 按年 */}
      <section class="section">
        <SectionHead
          no="06"
          label="By year"
          title="按年"
          meta={years.length > 1 ? `${year} 年已付 ${money(years[years.length - 1].paid, base, { compact: true })}，年底前还会扣 ${money(years[years.length - 1].projected, base, { compact: true })}` : undefined}
        />
        <YearBars rows={years} base={base} year={year} />
      </section>

      <div class="footnote">
        <span>非 {base} 金额按当前汇率折算 · 汇率更新于 {state.fx.fetchedAt.slice(0, 10)}</span>
        <span>负 MRR = 每月为订阅付出的钱</span>
      </div>
    </div>
  );
}

function ShareList({ rows, total, base, color }: { rows: { key: string; mrr: number; count: number }[]; total: number; base: string; color: (k: string, i: number) => string }) {
  if (!rows.length) return <div class="empty">暂无数据</div>;
  return (
    <>
      <div class="sharebar">
        {rows.map((r, i) => (
          <span key={r.key} style={{ flex: Math.max(r.mrr, total * 0.004), background: color(r.key, i) }} />
        ))}
      </div>
      <div class="ledger" style={{ borderTop: 0 }}>
        {rows.map((r, i) => (
          <div key={r.key} class="row" style={{ gridTemplateColumns: '14px minmax(0,auto) 1fr auto auto' }}>
            <span style={{ display: 'block', width: 10, height: 10, borderRadius: 3, background: color(r.key, i) }} />
            <div style={{ minWidth: 0 }}>
              <div class="row-title">{r.key}</div>
              <div class="row-sub">{r.count} 项</div>
            </div>
            <div class="leader" />
            <div class="row-amt">
              <div class="a">{money(r.mrr, base, { compact: true })}</div>
              <div class="b">/ 月</div>
            </div>
            <div class="pct" style={{ color: color(r.key, i) }}>
              {total > 0 ? ((r.mrr / total) * 100).toFixed(1) : '0'}%
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function DueTimeline({ state, today }: { state: AppState; today: string }) {
  const days = 30;
  const charges = allCharges(state, today, addDays(today, days), today);
  const byDay = new Map<string, typeof charges>();
  for (const c of charges) byDay.set(c.date, [...(byDay.get(c.date) ?? []), c]);
  const pos = (d: string) => `calc(18px + (100% - 36px) * ${diffDays(today, d) / days})`;
  return (
    <div class="due">
      <div class="due-track" />
      {Array.from({ length: days + 1 }, (_, i) => {
        const d = addDays(today, i);
        const wk = new Date(parseDay(d)).getUTCDay() === 1;
        return (
          <span key={d}>
            <i class={`due-tick ${wk ? 'wk' : ''}`} style={{ left: pos(d) }} />
            {(wk || (i === days && new Date(parseDay(d)).getUTCDay() > 3)) && i > 1 && (
              <span class="due-lab" style={{ left: pos(d) }}>
                {Number(d.slice(5, 7))}/{Number(d.slice(8))}
              </span>
            )}
          </span>
        );
      })}
      <div class="due-today" style={{ left: '18px' }} />
      {[...byDay.entries()].map(([d, list]) => (
        <div
          key={d}
          class="due-dot"
          style={{ left: pos(d) }}
          {...tipProps(() => (
            <>
              <b>{cnDate(d, true)}</b>
              {list.map((c) => (
                <div key={c.sub.id}>
                  {c.sub.name} · {money(c.amount, c.currency)}
                </div>
              ))}
            </>
          ))}
        >
          {list.slice(0, 3).map((c) => (
            <SubIcon key={c.sub.id} sub={c.sub} size="sm" />
          ))}
        </div>
      ))}
    </div>
  );
}

function Gantt({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const subs = [...state.subscriptions].sort((a, b) => a.start.localeCompare(b.start));
  if (!subs.length) return <div class="empty">还没有订阅</div>;
  const from = subs[0].start.slice(0, 4) + '-01-01';
  const to = addMonths(today, 4);
  const span = diffDays(from, to);
  const x = (d: string) => `${(Math.max(0, Math.min(span, diffDays(from, d))) / span) * 100}%`;
  const years: string[] = [];
  for (let y = Number(from.slice(0, 4)); `${y}-01-01` <= to; y++) years.push(`${y}-01-01`);
  return (
    <div class="card gantt">
      <div class="g-axis">
        <div />
        <div class="lane">
          {years.map((y) => (
            <span key={y} class="yr" style={{ left: x(y) }}>
              {y.slice(0, 4)}
            </span>
          ))}
        </div>
      </div>
      <div class="gantt-grid">
        <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'var(--gl, 150px) 1fr', pointerEvents: 'none' }} class="g-overlay">
          <div />
          <div style={{ position: 'relative' }}>
            {years.map((y) => (
              <i key={y} class="g-vline" style={{ left: x(y) }} />
            ))}
            <i class="g-now" style={{ left: x(today) }} />
          </div>
        </div>
        {subs.map((s) => {
          const st = effectiveStatus(s, today);
          const tint = catColor(s.category);
          const end = s.end && s.end < today ? s.end : today;
          const live = st === 'active' || st === 'trial' || st === 'ending';
          const n = nextCharge(s, today);
          return (
            <div key={s.id} class="g-row" style={{ cursor: 'pointer' }} onClick={() => onOpen(s)}>
              <div class="g-name">
                <SubIcon sub={s} size="xs" />
                <span>{s.name}</span>
              </div>
              <div class="g-lane" style={{ '--tint': tint } as never}>
                {s.cycle.unit === 'lifetime' ? (
                  <i class="g-life" style={{ left: x(s.start) }} {...tipProps(() => `${s.name} · 买断 ${money(s.price, s.currency)} · ${s.start}`)} />
                ) : (
                  <i
                    class={`g-bar ${live ? (st === 'ending' ? '' : 'fade') : st === 'paused' ? 'paused' : 'ended'}`}
                    style={{ left: x(s.start), width: `calc(${x(live ? (s.end ?? to) : end)} - ${x(s.start)})` }}
                    {...tipProps(() => (
                      <>
                        <b>{s.name}</b> · {money(s.price, s.currency)} {cycleLabel(s.cycle)}
                        <br />
                        {s.start} → {live ? (s.end ?? (n ? `下次 ${n}` : '')) : end}
                      </>
                    ))}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function YearBars({ rows, base, year }: { rows: ReturnType<typeof lifetimeByYear>; base: string; year: string }) {
  const max = Math.max(1, ...rows.map((r) => r.paid + r.projected));
  return (
    <div class="ledger">
      {rows.map((r) => (
        <div key={r.year} class={`yrow ${r.year === year ? 'cur' : ''}`}>
          <span class="num muted">{r.year}</span>
          <div class="ybar" style={{ display: 'flex' }}>
            <span style={{ width: `${(r.paid / max) * 100}%` }} />
            {r.projected > 0 && <span class="proj" style={{ width: `${(r.projected / max) * 100}%`, borderRadius: 0 }} />}
          </div>
          <div class="row-amt">
            <div class="a">{money(r.paid, base, { compact: true })}</div>
            <div class="b">{r.year === year && r.projected > 0 ? `+ ${money(r.projected, base, { compact: true })} 待扣` : `${r.count} 笔`}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
