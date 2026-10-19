import { Fragment } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { addDays, cycleLabel, diffDays, effectiveStatus, monthlyGross, myShareFactor, nextCharge, parseDay, priceAt, runwayFor, totals } from '../../shared/billing.ts';
import { cnDate, money, relDays } from '../../shared/format.ts';
import { BALANCE_KINDS, type AppState, type Subscription } from '../../shared/types.ts';
import { Amount, Icon, PayBadge, Seg, SubIcon, tipProps, Toolbar } from '../components/ui.tsx';
import { allCharges, breakdown, catColor, liveSubs, PERIOD_LABEL, PERIOD_UNIT, periodRange, sumBase, toBase, type Period } from '../derive.ts';
import { RunwayCard } from './Wallet.tsx';

const PERIODS: Array<[Period, string]> = [
  ['day', '日'],
  ['week', '周'],
  ['month', '月'],
  ['year', '年'],
];

function loadPeriod(): Period {
  try {
    return (localStorage.getItem('ledger:period') as Period) || 'month';
  } catch {
    return 'month';
  }
}

const PER: Record<string, string> = { day: '天', week: '周', month: '月', year: '年' };
export function perLabel(s: Subscription): string {
  if (s.cycle.unit === 'lifetime') return '买断';
  return s.cycle.every === 1 ? PER[s.cycle.unit] : cycleLabel(s.cycle).replace('每', '');
}

export function Overview({ state, today, onOpen, onReceipt, onAdd }: { state: AppState; today: string; onOpen: (s: Subscription) => void; onReceipt: () => void; onAdd: () => void }) {
  const [period, setPeriodRaw] = useState<Period>(loadPeriod);
  const setPeriod = (p: Period) => {
    setPeriodRaw(p);
    try {
      localStorage.setItem('ledger:period', p);
    } catch {
      /* ignore */
    }
  };
  const base = state.settings.baseCurrency;
  const t = totals(state, today);
  const [from, to] = periodRange(period, today);
  const charges = useMemo(() => allCharges(state, from, to, today), [state, from, to]);
  const due = sumBase(state, charges);
  const paid = sumBase(
    state,
    charges.filter((c) => !c.projected),
  );
  // 过去 12 个完整周期的平均
  const avg = useMemo(() => {
    let s = 0;
    for (let i = 1; i <= 12; i++) {
      const [a, b] = periodRange(period, today, -i);
      s += sumBase(state, allCharges(state, a, b, today));
    }
    return s / 12;
  }, [state, period, today]);
  const live = liveSubs(state, today).sort((a, b) => (nextCharge(a, today) ?? '9').localeCompare(nextCharge(b, today) ?? '9'));
  const runways = state.methods.map((m) => runwayFor(m, state, today)).filter((r) => r != null);
  const unset = state.methods.filter((m) => BALANCE_KINDS.includes(m.kind) && m.balance == null && live.some((s) => s.methodId === m.id));
  const unit = PERIOD_UNIT[period];
  const [y, mo] = today.split('-').map(Number);

  return (
    <>
      <Toolbar title="仪表板" sub={`${y}年${mo}月${Number(today.slice(8))}日 · ${t.activeCount} 个订阅计费中`}>
        <Seg value={period} options={PERIODS} onChange={setPeriod} />
        <button class="icon-btn" onClick={onReceipt} title="生成账单小票" aria-label="账单小票">
          <Icon name="receipt" />
        </button>
        {!state.readonly && (
          <button class="icon-btn accent d-only" onClick={onAdd} title="添加订阅（N）" aria-label="添加订阅">
            <Icon name="plus" />
          </button>
        )}
      </Toolbar>
      <div class="page fade-in stack">
        <div class="grid g-4">
          <div class="card stat hero">
            <div class="stat-label">每月订阅支出 · 负 MRR</div>
            <div class="stat-value">
              <Amount value={-t.mrr} ccy={base} />
            </div>
            <div class="stat-sub">
              年化 {money(-t.mrr * 12, base, { compact: true })} · 每天 {money(t.mrr / 30.4375, base)}
            </div>
          </div>
          <div class="card stat">
            <div class="stat-label">
              <Icon name="cal" />
              {PERIOD_LABEL[period]}应付
            </div>
            <div class="stat-value">
              <Amount value={due} ccy={base} />
            </div>
            <div class="stat-sub">
              已付 {money(paid, base, { compact: true })} · 待付 {money(due - paid, base, { compact: true })}
            </div>
          </div>
          <div class="card stat">
            <div class="stat-label">
              <Icon name="chart" />
              每{unit}平均
            </div>
            <div class="stat-value">
              <Amount value={avg} ccy={base} />
            </div>
            <div class="stat-sub">按过去 12 {unit === '月' ? '个月' : unit}计算</div>
          </div>
          <div class="card stat">
            <div class="stat-label">
              <Icon name="list" />
              {t.activeCount} 个订阅
            </div>
            <div class="stat-value">
              <span class="amt">
                {charges.length}
                <small> 笔费用</small>
              </span>
            </div>
            <div class="stat-sub">{t.recoverMrr > 1 ? `拼车每月回血 ${money(t.recoverMrr, base, { compact: true })}` : `${PERIOD_LABEL[period]}扣款笔数`}</div>
          </div>
        </div>

        <div class="tiles">
          {live.map((s) => {
            const n = nextCharge(s, today);
            const d = n ? diffDays(today, n) : undefined;
            const m = state.methods.find((x) => x.id === s.methodId);
            const price = n ? priceAt(s, n) : s.price;
            return (
              <button key={s.id} class="tile" onClick={() => onOpen(s)}>
                <SubIcon sub={s} size={42} />
                <div style={{ minWidth: 0 }}>
                  <div class="tile-name">
                    <span>{s.name}</span>
                    {s.intro && s.intro.until > today && <Icon name="leaf" />}
                  </div>
                  <div class="tile-price">
                    <Amount value={price} ccy={s.currency} />
                    <span class="per">/{perLabel(s)}</span>
                  </div>
                </div>
                <div class="tile-foot">
                  <PayBadge m={m} />
                  {n && <span class={`due ${d! <= 3 ? 'soon' : ''}`}>{d! <= 14 ? relDays(d!) : cnDate(n)}</span>}
                </div>
              </button>
            );
          })}
        </div>

        <div class="card">
          <DueAxis state={state} today={today} period={period} />
        </div>

        {unset.length > 0 && !state.readonly && (
          <a class="card row" href="#/wallet" style={{ gap: 14 }}>
            <span class="ico mono" style={{ '--tint': 'var(--c5)', '--s': '40px' } as Record<string, string>}>
              ¤
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontWeight: 600 }}>{unset.map((m) => m.name).join('、')} 还没有余额</b>
              <div class="muted" style={{ fontSize: 13 }}>
                填入礼品卡或话费余额，就能推算每期扣多少、还能撑多久，余额不够时邮件提醒。
              </div>
            </span>
            <span class="btn tinted">去设置</span>
          </a>
        )}

        <div class="grid g-2">
          <Breakdown title="分类明细" rows={breakdown(state, today, (s) => s.category)} total={t.mrr} base={base} color={catColor} />
          <Breakdown
            title="支付方式明细"
            rows={breakdown(state, today, (s) => state.methods.find((m) => m.id === s.methodId)?.name ?? '未指定')}
            total={t.mrr}
            base={base}
            color={(_, i) => `var(--c${((i + 2) % 10) + 1})`}
          />
        </div>

        <div class="grid g-2">
          <YearWidget state={state} today={today} />
          {runways.length > 0 ? (
            <div class="card">
              <div class="card-h">
                <h3>余额续航</h3>
                <a class="btn plain" href="#/wallet">
                  钱包
                </a>
              </div>
              <div class="stack">
                {runways.map((r) => (
                  <RunwayCard key={r.method.id} r={r} today={today} state={state} flat />
                ))}
              </div>
            </div>
          ) : (
            <Spent state={state} today={today} />
          )}
        </div>
        <Lifetime state={state} today={today} onOpen={onOpen} />
      </div>
    </>
  );
}

/** 到期时间轴：按所选周期铺开刻度，图标落在扣款日 */
function DueAxis({ state, today, period }: { state: AppState; today: string; period: Period }) {
  // 「日」周期太短，时间轴改为展示未来 7 天
  const [from, to] = period === 'day' ? [today, addDays(today, 6)] : periodRange(period, today);
  const charges = allCharges(state, from, to, today);
  const span = diffDays(from, to) + 1;
  const pos = (d: string) => `${((diffDays(from, d) + 0.5) / span) * 100}%`;
  const byKey = new Map<string, typeof charges>();
  for (const c of charges) {
    const k = period === 'year' ? c.date.slice(0, 7) + '-15' : c.date;
    byKey.set(k, [...(byKey.get(k) ?? []), c]);
  }
  const ticks: Array<{ d: string; label: string; today: boolean }> = [];
  if (period === 'year') {
    for (let m = 1; m <= 12; m++) {
      const d = `${from.slice(0, 4)}-${String(m).padStart(2, '0')}-15`;
      ticks.push({ d, label: `${m}月`, today: today.slice(5, 7) === d.slice(5, 7) });
    }
  } else {
    for (let i = 0; i < span; i++) {
      const d = addDays(from, i);
      const day = Number(d.slice(8));
      const show = span <= 7 || day === 1 || day % 5 === 0 || d === today;
      if (show) ticks.push({ d, label: span <= 7 ? `周${'一二三四五六日'[(new Date(parseDay(d)).getUTCDay() + 6) % 7]}` : String(day), today: d === today });
    }
  }
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (
    <>
      <div class="due-head">
        <span>{period === 'year' ? `${fy}年` : `${fm}月${Number(from.slice(8))}日`}</span>
        <span>
          {charges.length} 笔 · {money(sumBase(state, charges), state.settings.baseCurrency, { compact: true })}
        </span>
        <span>{period === 'year' ? '12月' : `${ty !== fy ? ty + '年' : ''}${tm}月${Number(to.slice(8))}日`}</span>
      </div>
      <div class="due-axis">
        <div class="line" />
        {ticks.map((t) => (
          <Fragment key={t.d}>
            <i class="tick" style={{ left: pos(t.d) }} />
            <span class={`lab ${t.today ? 'today' : ''}`} style={{ left: pos(t.d) }}>
              {t.label}
            </span>
          </Fragment>
        ))}
        {today >= from && today <= to && <i class="now" style={{ left: pos(today) }} />}
        {[...byKey.entries()].map(([d, list]) => (
          <div
            key={d}
            class="pin"
            style={{ left: pos(d) }}
            {...tipProps(() => (
              <>
                <b>{period === 'year' ? `${Number(d.slice(5, 7))}月` : cnDate(d, true)}</b>
                {list.slice(0, 8).map((c) => (
                  <div key={c.sub.id + c.date}>
                    {c.sub.name} · {money(c.amount, c.currency)}
                  </div>
                ))}
                {list.length > 8 && <div>…共 {list.length} 笔</div>}
              </>
            ))}
          >
            {list.slice(0, period === 'year' ? 3 : 2).map((c) => (
              <SubIcon key={c.sub.id + c.date} sub={c.sub} size={period === 'month' ? 22 : 26} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function Breakdown({ title, rows, total, base, color }: { title: string; rows: { key: string; mrr: number; count: number }[]; total: number; base: string; color: (k: string, i: number) => string }) {
  const [mode, setMode] = useState<'bar' | 'pie'>('bar');
  const max = Math.max(1, ...rows.map((r) => r.mrr));
  let acc = 0;
  return (
    <div class="card">
      <div class="card-h">
        <h3>{title}</h3>
        <Seg
          small
          value={mode}
          onChange={setMode}
          options={[
            ['bar', '条形'],
            ['pie', '饼图'],
          ]}
        />
      </div>
      {rows.length === 0 && <div class="empty">暂无数据</div>}
      {mode === 'bar' ? (
        <div class="hbars">
          {rows.map((r, i) => (
            <Fragment key={r.key}>
              <div class="hb-l">
                {r.key}
                <small>{money(r.mrr, base, { compact: true })}/月</small>
              </div>
              <div class="hb-track">
                <div class="hb-fill" style={{ width: `${Math.max(8, (r.mrr / max) * 100)}%`, background: color(r.key, i) }}>
                  {total > 0 ? Math.round((r.mrr / total) * 100) : 0}%
                </div>
              </div>
            </Fragment>
          ))}
        </div>
      ) : (
        <div class="donut-wrap">
          <svg viewBox="0 0 42 42" width="150" height="150" style={{ transform: 'rotate(-90deg)' }}>
            {rows.map((r, i) => {
              const pct = total > 0 ? (r.mrr / total) * 100 : 0;
              const len = Math.max(0, pct - 0.8);
              const el = <circle key={r.key} cx="21" cy="21" r="15.915" fill="none" stroke={color(r.key, i)} stroke-width="6" stroke-linecap="round" stroke-dasharray={`${len} ${100 - len}`} stroke-dashoffset={-acc} />;
              acc += pct;
              return el;
            })}
          </svg>
          <div class="legend">
            {rows.map((r, i) => (
              <div key={r.key}>
                <i style={{ background: color(r.key, i) }} />
                {r.key}
                <b>{total > 0 ? ((r.mrr / total) * 100).toFixed(1) : 0}%</b>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 年度小组件：大数字 + 12 个月柱 */
function YearWidget({ state, today }: { state: AppState; today: string }) {
  const base = state.settings.baseCurrency;
  const y = today.slice(0, 4);
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = `${y}-${String(i + 1).padStart(2, '0')}`;
    const [a, b] = periodRange('month', `${m}-15`);
    const cs = allCharges(state, a, b, today);
    return { m, sum: sumBase(state, cs), n: cs.length };
  });
  const total = months.reduce((a, b) => a + b.sum, 0);
  const paidCs = allCharges(state, `${y}-01-01`, today, today);
  const paid = sumBase(state, paidCs);
  const max = Math.max(1, ...months.map((m) => m.sum));
  const cur = today.slice(0, 7);
  return (
    <div class="card">
      <div class="card-h">
        <h3>{y} 年</h3>
        <span class="meta">每月支出</span>
      </div>
      <div class="row" style={{ alignItems: 'flex-end', gap: 22, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 34, lineHeight: 1.1 }}>
            <Amount value={total} ccy={base} />
          </div>
          <div class="muted" style={{ fontSize: 13, marginTop: 4 }}>
            全年 {months.reduce((a, b) => a + b.n, 0)} 笔
          </div>
          <div class="muted" style={{ fontSize: 13, marginTop: 12, lineHeight: 1.6 }}>
            已付 {money(paid, base, { compact: true })} · {paidCs.length} 笔
            <br />
            占全年 {total > 0 ? Math.round((paid / total) * 100) : 0}%
          </div>
        </div>
        <div class="minibars" style={{ flex: 1, minWidth: 220 }}>
          {months.map((m, i) => (
            <div key={m.m} class={`mb ${m.m === cur ? 'cur' : m.m > cur ? 'future' : ''}`} {...tipProps(() => `${i + 1}月 · ${money(m.sum, base, { compact: true })} · ${m.n} 笔`)}>
              <i style={{ height: `${Math.max(3, (m.sum / max) * 76)}px` }} />
              <span>{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 历年累计 */
function Spent({ state, today }: { state: AppState; today: string }) {
  const base = state.settings.baseCurrency;
  const first = state.subscriptions.reduce((m, s) => (s.start < m ? s.start : m), today);
  const rows: Array<{ y: string; v: number; n: number }> = [];
  for (let y = Number(first.slice(0, 4)); y <= Number(today.slice(0, 4)); y++) {
    const cs = allCharges(state, `${y}-01-01`, `${y}-12-31` < today ? `${y}-12-31` : today, today);
    rows.push({ y: String(y), v: sumBase(state, cs), n: cs.length });
  }
  const total = rows.reduce((a, r) => a + r.v, 0);
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <div class="card">
      <div class="card-h">
        <h3>累计已付</h3>
        <span class="meta">自 {first.slice(0, 4)} 年</span>
      </div>
      <div style={{ fontSize: 34, lineHeight: 1.1, marginBottom: 14 }}>
        <Amount value={total} ccy={base} />
      </div>
      <div class="hbars">
        {rows.map((r) => (
          <Fragment key={r.y}>
            <div class="hb-l">
              {r.y}
              <small>{r.n} 笔</small>
            </div>
            <div class="hb-track">
              <div class="hb-fill" style={{ width: `${Math.max(12, (r.v / max) * 100)}%`, background: r.y === today.slice(0, 4) ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 45%, var(--card))' }}>
                {money(r.v, base, { compact: true })}
              </div>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** 订阅生命线：每个订阅从开始到结束（或至今）的区间 */
function Lifetime({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const subs = [...state.subscriptions].sort((a, b) => a.start.localeCompare(b.start));
  if (!subs.length) return null;
  const from = subs[0].start.slice(0, 4) + '-01-01';
  const to = `${Number(today.slice(0, 4)) + 1}-01-01`;
  const span = diffDays(from, to);
  const x = (d: string) => (Math.max(0, Math.min(span, diffDays(from, d))) / span) * 100;
  const years: number[] = [];
  for (let yy = Number(from.slice(0, 4)); yy <= Number(today.slice(0, 4)); yy++) years.push(yy);
  const base = state.settings.baseCurrency;
  return (
    <div class="card">
      <div class="card-h">
        <h3>订阅时间线</h3>
        <span class="meta">
          {subs.length} 个订阅 · 自 {from.slice(0, 4)} 年
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(104px, 180px) minmax(0, 1fr)', rowGap: 2, alignItems: 'center' }}>
        <div />
        <div style={{ position: 'relative', height: 20 }}>
          {years.map((yy) => (
            <span key={yy} class="soft" style={{ position: 'absolute', left: `${x(`${yy}-01-01`)}%`, fontSize: 11, fontWeight: 600, paddingLeft: 3 }}>
              {yy}
            </span>
          ))}
        </div>
        {subs.map((s) => {
          const st = effectiveStatus(s, today);
          const live = st === 'active' || st === 'trial' || st === 'ending';
          const end = live ? today : s.end && s.end < today ? s.end : today;
          const mo = toBase(state, monthlyGross(s, today), s.currency) * myShareFactor(s);
          return (
            <Fragment key={s.id}>
              <button class="side-item" style={{ padding: '3px 6px', fontSize: 12.5 }} onClick={() => onOpen(s)}>
                <SubIcon sub={s} size={20} />
                <span style={{ color: live || st === 'lifetime' ? 'var(--label)' : 'var(--label-3)' }}>{s.name}</span>
              </button>
              <div style={{ position: 'relative', height: 24 }}>
                {years.map((yy) => (
                  <i key={yy} style={{ position: 'absolute', top: 0, bottom: 0, left: `${x(`${yy}-01-01`)}%`, width: 1, background: 'var(--sep)' }} />
                ))}
                <i style={{ position: 'absolute', top: 0, bottom: 0, left: `${x(today)}%`, width: 1.5, background: 'var(--accent)', opacity: 0.5 }} />
                {st === 'lifetime' ? (
                  <i
                    style={{ position: 'absolute', top: 7, left: `calc(${x(s.start)}% - 5px)`, width: 10, height: 10, borderRadius: 3, transform: 'rotate(45deg)', background: catColor(s.category) }}
                    {...tipProps(() => `${s.name} · 买断 ${money(s.price, s.currency)} · ${s.start}`)}
                  />
                ) : (
                  <i
                    style={{
                      position: 'absolute',
                      top: 7,
                      height: 10,
                      borderRadius: 5,
                      left: `${x(s.start)}%`,
                      width: `max(8px, ${x(end) - x(s.start)}%)`,
                      background: catColor(s.category),
                      opacity: live ? 1 : 0.28,
                    }}
                    {...tipProps(() => `${s.name} · ${s.start} → ${live ? '至今' : end}${live ? ` · ${money(mo, base, { compact: true })}/月` : ''}`)}
                  />
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
