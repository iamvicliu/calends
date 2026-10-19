import { useEffect, useMemo, useState } from 'preact/hooks';
import { cycleLabel, diffDays, effectiveStatus, nextCharge, todayIn } from '../../shared/billing.ts';
import { cnDate, money } from '../../shared/format.ts';
import { cancelSavings, contributionOn, mrrSeries } from '../../shared/metrics.ts';
import { toBaseAt } from '../../shared/fx.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { AreaChart } from '../components/charts.tsx';
import { Amount, Icon, SubIcon, TipLayer } from '../components/ui.tsx';
import { allCharges, catColor, sumBase } from '../derive.ts';
import { Spending, Statement } from './Overview.tsx';
import { Composition, perLabel } from './Report.tsx';

/** 对外公开的只读账本：数据已在服务端脱敏 */
export function PublicPage() {
  const [state, setState] = useState<AppState | null>(null);
  const [err, setErr] = useState<string>();
  useEffect(() => {
    fetch('/api/public')
      .then(async (r) => {
        const body = (await r.json()) as AppState & { error?: string };
        if (!r.ok) throw new Error(body.error ?? '加载失败');
        setState(body);
      })
      .catch((e) => setErr(e.message));
  }, []);
  if (err)
    return (
      <div class="login">
        <div class="login-card">
          <img src="/icons/icon-192.png" alt="" />
          <h1>订阅账本</h1>
          <p>{err}</p>
        </div>
      </div>
    );
  if (!state) return <div class="login" />;
  return <PublicBody state={state} />;
}

function PublicBody({ state }: { state: AppState }) {
  const today = todayIn(state.settings.timezone);
  const base = state.settings.baseCurrency;
  const first = state.subscriptions.reduce((m, s) => (s.start < m ? s.start : m), today);
  const months = Math.ceil(diffDays(first.slice(0, 8) + '01', today) / 30.4375) + 1;
  const series = useMemo(() => mrrSeries(state, today, months, true), [state]);
  const spent = useMemo(() => sumBase(state, allCharges(state, first, today, today)), [state]);
  const live = state.subscriptions
    .map((s) => ({ s, v: contributionOn(state, s, today) }))
    .filter((x) => ['active', 'ending', 'trial', 'paused'].includes(effectiveStatus(x.s, today)))
    .sort((a, b) => b.v - a.v);
  const lifetime = state.subscriptions.filter((s) => s.cycle.unit === 'lifetime');
  const ended = cancelSavings(state, today).items;
  const years: Array<{ y: string; v: number }> = [];
  for (let y = Number(first.slice(0, 4)); y <= Number(today.slice(0, 4)); y++) {
    const to = `${y}-12-31` < today ? `${y}-12-31` : today;
    years.push({ y: String(y), v: sumBase(state, allCharges(state, `${y}-01-01`, to, today)) });
  }
  const ymax = Math.max(1, ...years.map((y) => y.v));
  const methodName = (s: Subscription) => state.methods.find((m) => m.id === s.methodId)?.name;

  return (
    <div class="pub">
      <header class="pub-top">
        <div class="sb-mark">
          <img src="/icons/icon-192.png" alt="" />
          {state.settings.displayName} 的订阅
        </div>
      </header>

      <Statement state={state} today={today} onOpen={() => {}} />
      <p class="pub-lede" style={{ marginTop: 22 }}>
        {live.length} 个订阅正在计费，另有 {lifetime.length} 个买断。从 {first.slice(0, 4)} 年 {Number(first.slice(5, 7))} 月开始，按每笔扣款当天的汇率，一共付了 <b>{money(spent, base, { compact: true })}</b>。
      </p>

      <section class="pub-sec">
        <Spending state={state} today={today} onOpen={() => {}} />
      </section>

      <section class="pub-sec">
        <div class="card">
          <div class="card-h">
            <h3>每月订阅支出的变化</h3>
            <span class="meta">按当时汇率</span>
          </div>
          <AreaChart
            values={series.map((p) => p.mrr)}
            labels={series.map((p) => (p.month.endsWith('-01') ? p.month.slice(0, 4) : ''))}
            tip={(i) => (
              <>
                <b>{series[i].month}</b> · {money(series[i].mrr, base, { compact: true })}/月
              </>
            )}
          />
        </div>
      </section>

      <section class="pub-sec">
        <Composition state={state} today={today} onOpen={() => {}} />
      </section>

      <section class="pub-sec grid g-2">
        <div class="card">
          <div class="card-h">
            <h3>每年花了多少</h3>
            <span class="meta">按当天汇率</span>
          </div>
          {years.map((y) => (
            <div key={y.y} class="pub-year">
              <span>{y.y}</span>
              <div class="hb-track">
                <div class="hb-fill" style={{ width: `${Math.max(10, (y.v / ymax) * 100)}%`, background: y.y === today.slice(0, 4) ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 40%, var(--card))' }} />
              </div>
              <b>{money(y.v, base, { compact: true })}</b>
            </div>
          ))}
        </div>
        <div class="card">
          <div class="card-h">
            <h3>退订与买断</h3>
          </div>
          {ended.slice(0, 6).map((x) => (
            <div key={x.sub.id} class="pub-mini">
              <SubIcon sub={x.sub} size={26} />
              <span class="pm-name">{x.sub.name}</span>
              <small class="green">退订后省 {money(x.saved, base, { compact: true })}</small>
            </div>
          ))}
          {lifetime.map((s) => (
            <div key={s.id} class="pub-mini">
              <SubIcon sub={s} size={26} />
              <span class="pm-name">{s.name}</span>
              <small>买断 {money(s.price, s.currency)}</small>
            </div>
          ))}
        </div>
      </section>

      <section class="pub-sec">
        <FxCard state={state} today={today} live={live} />
      </section>

      <section class="pub-sec">
        <h2>正在订阅 · {live.length}</h2>
        <div class="pub-list">
          {live.map(({ s, v }) => {
            const n = nextCharge(s, today);
            return (
              <div key={s.id} class="pub-row">
                <SubIcon sub={s} size={40} />
                <div class="pub-name">
                  <b>{s.name}</b>
                  <span class="pn-sub">
                    <i style={{ background: catColor(s.category) }} />
                    {s.category}
                    {methodName(s) ? ` · ${methodName(s)}` : ''}
                  </span>
                </div>
                <div class="pub-price">
                  <b>
                    <Amount value={s.price} ccy={s.currency} />
                    <small>/{perLabel(s)}</small>
                  </b>
                  <span class="pp-sub">
                    {s.currency !== base ? `≈ ${money(v, base, { compact: true })}/月` : cycleLabel(s.cycle)}
                    {n ? ` · ${cnDate(n)}续费` : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <footer class="pub-foot">
        <span>
          <Icon name="globe" size={14} /> 外币金额：过去的按扣款当天汇率，未来的按今天汇率折算为 {base}
        </span>
        <span>未上线项目的域名、银行卡等信息已隐藏</span>
      </footer>
      <TipLayer />
    </div>
  );
}

/** 汇率：各币种在每月支出里的占比，以及过去一年的涨跌 */
function FxCard({ state, today, live }: { state: AppState; today: string; live: Array<{ s: Subscription; v: number }> }) {
  const base = state.settings.baseCurrency;
  const total = live.reduce((a, x) => a + x.v, 0);
  const by = new Map<string, number>();
  for (const x of live) by.set(x.s.currency, (by.get(x.s.currency) ?? 0) + x.v);
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const rows = [...by.entries()].sort((a, b) => b[1] - a[1]);
  const perUnit = (ccy: string, date?: string) => toBaseAt(state, 1, ccy, date, base);
  return (
    <div class="card">
      <div class="card-h">
        <h3>汇率</h3>
        <span class="meta">每月支出里的币种构成 · 对 {base} 一年涨跌</span>
      </div>
      <div class="fx-rows">
        {rows.map(([ccy, v]) => {
          const now = perUnit(ccy);
          const then = perUnit(ccy, yearAgo);
          const chg = ccy === base || !then ? 0 : (now - then) / then;
          return (
            <div key={ccy} class="fx-row">
              <b>{ccy}</b>
              <div class="hb-track">
                <div class="hb-fill" style={{ width: `${Math.max(6, (v / total) * 100)}%`, background: 'var(--accent)' }} />
              </div>
              <span class="fx-share">{Math.round((v / total) * 100)}%</span>
              <span class="fx-rate">{ccy === base ? '—' : `1 ${ccy} = ${now < 0.1 ? now.toFixed(4) : now.toFixed(3)} ${base}`}</span>
              <span class={`fx-chg ${chg > 0.005 ? 'up' : chg < -0.005 ? 'down' : ''}`}>{ccy === base ? '' : `${chg > 0 ? '+' : ''}${(chg * 100).toFixed(1)}%`}</span>
            </div>
          );
        })}
      </div>
      <p class="card-note">外币贬值时，以这个币种计价的订阅就变便宜。过去的扣款按扣款当天汇率入账，未来的按今天汇率估算。</p>
    </div>
  );
}
