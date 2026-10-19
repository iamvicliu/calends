import { useEffect, useMemo, useState } from 'preact/hooks';
import { addMonths, diffDays, effectiveStatus, nextCharge, todayIn, totals } from '../../shared/billing.ts';
import { cnDate, money } from '../../shared/format.ts';
import { chargeValue, toBaseAt } from '../../shared/fx.ts';
import { cancelSavings, contributionOn } from '../../shared/metrics.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { SubIcon, tipProps, TipLayer } from '../components/ui.tsx';
import { allCharges, periodRange, sumBase } from '../derive.ts';
import { perLabel } from './Report.tsx';

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
      <main class="pp">
        <p class="pp-muted">{err}</p>
      </main>
    );
  if (!state) return <main class="pp" />;
  return <PublicBody state={state} />;
}

/** 灰阶：占比越大颜色越深 */
const shade = (i: number, n: number) => `color-mix(in srgb, var(--label) ${Math.round(88 - (i / Math.max(1, n - 1)) * 70)}%, var(--bg))`;

function PublicBody({ state }: { state: AppState }) {
  const today = todayIn(state.settings.timezone);
  const base = state.settings.baseCurrency;
  const t = totals(state, today);
  const first = state.subscriptions.reduce((m, s) => (s.start < m ? s.start : m), today);
  const spent = useMemo(() => sumBase(state, allCharges(state, first, today, today)), [state]);

  const live = state.subscriptions
    .map((s) => ({ s, v: contributionOn(state, s, today) }))
    .filter((x) => ['active', 'ending', 'trial', 'paused'].includes(effectiveStatus(x.s, today)))
    .sort((a, b) => b.v - a.v);
  const lifetime = state.subscriptions.filter((s) => s.cycle.unit === 'lifetime');
  const ended = cancelSavings(state, today).items;

  // 构成：按分类
  const cats = new Map<string, { v: number; subs: typeof live }>();
  for (const x of live) {
    const c = cats.get(x.s.category) ?? { v: 0, subs: [] };
    c.v += x.v;
    c.subs.push(x);
    cats.set(x.s.category, c);
  }
  const catList = [...cats.entries()].sort((a, b) => b[1].v - a[1].v);
  const top = catList[0];

  // 近 12 个月 + 后 3 个月
  const months = useMemo(
    () =>
      Array.from({ length: 15 }, (_, i) => {
        const m = addMonths(today.slice(0, 8) + '01', i - 11).slice(0, 7);
        const [a, b] = periodRange('month', `${m}-15`);
        return { m, v: allCharges(state, a, b, today).reduce((x, c) => x + chargeValue(state, c), 0) };
      }),
    [state, today],
  );
  const mMax = Math.max(1, ...months.map((x) => x.v));
  const cur = today.slice(0, 7);

  // 汇率
  const byCcy = new Map<string, number>();
  for (const x of live) byCcy.set(x.s.currency, (byCcy.get(x.s.currency) ?? 0) + x.v);
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const fx = [...byCcy.entries()]
    .filter(([c]) => c !== base)
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => {
      const now = toBaseAt(state, 1, c, undefined, base);
      const then = toBaseAt(state, 1, c, yearAgo, base);
      return { c, share: v / t.mrr, now, chg: then ? (now - then) / then : 0 };
    });

  const sinceYears = Math.max(1, Math.round(diffDays(first, today) / 365));
  const fmt = (v: number) => money(v, base, { compact: true });

  return (
    <main class="pp">
      <header class="pp-head">
        <img src="/icons/avatar.png" alt="" />
        <div>
          <b>{state.settings.displayName}</b>
          <span>订阅账本</span>
        </div>
      </header>

      <section class="pp-hero">
        <div class="pp-label">每月订阅支出</div>
        <div class="pp-big">{money(t.mrr, base, { compact: true })}</div>
        <p class="pp-lede">
          我同时在付 <b>{live.length}</b> 个订阅，一年大约 <b>{fmt(t.mrr * 12)}</b>。
          {top ? (
            <>
              其中 <b>{Math.round((top[1].v / t.mrr) * 100)}%</b> 花在{/^[A-Za-z]/.test(top[0]) ? ` ${top[0]} ` : top[0]}上。
            </>
          ) : null}
          从 {first.slice(0, 4)} 年开始的 {sinceYears} 年里，按每笔扣款当天的汇率，一共付了 <b>{fmt(spent)}</b>。
        </p>
      </section>

      <section class="pp-sec">
        <h2>构成</h2>
        <div class="pp-bar">
          {catList.map(([k, c], i) => (
            <i key={k} style={{ flexGrow: c.v, background: shade(i, catList.length) }} {...tipProps(() => `${k} · ${fmt(c.v)}/月`)} />
          ))}
        </div>
        <ul class="pp-legend">
          {catList.map(([k, c], i) => (
            <li key={k}>
              <i style={{ background: shade(i, catList.length) }} />
              <span>{k}</span>
              <em>{fmt(c.v)}</em>
              <small>{Math.round((c.v / t.mrr) * 100)}%</small>
            </li>
          ))}
        </ul>
      </section>

      <section class="pp-sec">
        <h2>每月扣款</h2>
        <div class="pp-cols">
          {months.map((x) => (
            <div key={x.m} class={`pp-col ${x.m === cur ? 'cur' : x.m > cur ? 'next' : ''}`} {...tipProps(() => `${x.m} · ${fmt(x.v)}${x.m > cur ? ' · 预计' : ''}`)}>
              <i style={{ height: `${Math.max(2, (x.v / mMax) * 100)}%` }} />
              <span>{x.m.endsWith('-01') ? x.m.slice(2, 4) + '年' : Number(x.m.slice(5))}</span>
            </div>
          ))}
        </div>
        <p class="pp-note">过去 12 个月与之后 3 个月，空心为预计。</p>
      </section>

      <section class="pp-sec">
        <h2>正在订阅</h2>
        {catList.map(([k, c]) => (
          <div key={k} class="pp-group">
            <h3>{k}</h3>
            {c.subs.map(({ s, v }) => (
              <Row key={s.id} s={s} v={v} base={base} today={today} />
            ))}
          </div>
        ))}
      </section>

      {(ended.length > 0 || lifetime.length > 0) && (
        <section class="pp-sec">
          <h2>退订与买断</h2>
          {ended.slice(0, 8).map((x) => (
            <div key={x.sub.id} class="pp-row">
              <SubIcon sub={x.sub} size={22} />
              <span class="pp-name">{x.sub.name}</span>
              <span class="pp-right">退订后省 {fmt(x.saved)}</span>
            </div>
          ))}
          {lifetime.map((s) => (
            <div key={s.id} class="pp-row">
              <SubIcon sub={s} size={22} />
              <span class="pp-name">{s.name}</span>
              <span class="pp-right">买断 {money(s.price, s.currency)}</span>
            </div>
          ))}
        </section>
      )}

      {fx.length > 0 && (
        <section class="pp-sec">
          <h2>汇率</h2>
          {fx.map((f) => (
            <div key={f.c} class="pp-row pp-fx">
              <span class="pp-name">{f.c}</span>
              <span class="pp-mid">{Math.round(f.share * 100)}% 的支出</span>
              <span class="pp-mid">
                1 {f.c} = {f.now < 0.1 ? f.now.toFixed(4) : f.now.toFixed(3)} {base}
              </span>
              <span class={`pp-right ${f.chg > 0.005 ? 'up' : f.chg < -0.005 ? 'down' : ''}`}>
                {f.chg > 0 ? '+' : ''}
                {(f.chg * 100).toFixed(1)}%
              </span>
            </div>
          ))}
          <p class="pp-note">与一年前相比。外币贬值时，以它计价的订阅就变便宜。</p>
        </section>
      )}

      <footer class="pp-foot">
        <span>过去的扣款按当天汇率，未来按今天汇率折算为 {base}。未上线项目的域名、银行卡等信息已隐藏。</span>
        <a href="https://example.com">example.com</a>
      </footer>
      <TipLayer />
    </main>
  );
}

function Row({ s, v, base, today }: { s: Subscription; v: number; base: string; today: string }) {
  const n = nextCharge(s, today);
  return (
    <div class="pp-row">
      <SubIcon sub={s} size={22} />
      <span class="pp-name">
        {s.name}
        {s.region && <small>{s.region}</small>}
      </span>
      <span class="pp-mid">{n ? `${cnDate(n)}续费` : ''}</span>
      <span class="pp-conv">{s.currency !== base ? `≈ ${money(v, base, { compact: true })}/月` : ''}</span>
      <span class="pp-right">
        {money(s.price, s.currency)}
        <small>/{perLabel(s)}</small>
      </span>
    </div>
  );
}
