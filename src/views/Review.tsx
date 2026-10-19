import { useState } from 'preact/hooks';
import { totals } from '../../shared/billing.ts';
import { money } from '../../shared/format.ts';
import { cancelSavings, yearReview } from '../../shared/metrics.ts';
import type { AppState } from '../../shared/types.ts';
import { Amount, Seg, Sheet, SubIcon } from '../components/ui.tsx';

/** 年度回顾：一张可以截图分享的卡片 */
export function Review({ state, today, onClose }: { state: AppState; today: string; onClose: () => void }) {
  const base = state.settings.baseCurrency;
  const years: string[] = [];
  const first = state.subscriptions.reduce((m, s) => (s.start < m ? s.start : m), today).slice(0, 4);
  for (let y = Number(today.slice(0, 4)); y >= Number(first) && years.length < 4; y--) years.push(String(y));
  const [year, setYear] = useState(years[0]);
  const r = yearReview(state, today, year);
  const t = totals(state, today);
  const saved = cancelSavings(state, today).items.filter((x) => x.since.startsWith(year));
  const top = r.top[0]?.sum ?? 1;
  const ongoing = year === today.slice(0, 4);
  const coffee = r.total / 30; // 一杯 ¥30 的咖啡
  return (
    <Sheet narrow title="年度回顾" onClose={onClose}>
      <div class="stack">
        <Seg value={year} onChange={setYear} options={years.map((y) => [y, y] as [string, string])} />
        <div class="review">
          <div class="rv-head">
            <span>{year}</span>
            <span>{state.settings.displayName} 的订阅</span>
          </div>
          <div class="rv-big">
            <small>{ongoing ? '今年到目前为止' : '这一年'}，订阅一共花了</small>
            <Amount value={r.total} ccy={base} compact />
            <span>
              {r.charges} 次扣款 · 平均每天 {money(r.perDay, base)}
              {base === 'CNY' && coffee >= 1 ? ` · 约等于 ${Math.round(coffee)} 杯咖啡` : ''}
            </span>
          </div>
          <div class="rv-sec">
            <div class="rv-label">花得最多</div>
            {r.top.map((x, i) => (
              <div key={x.sub.id} class="rv-bar">
                <span class="rv-rank">{i + 1}</span>
                <SubIcon sub={x.sub} size={26} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div class="rv-name">
                    <span>{x.sub.name}</span>
                    <b>{money(x.sum, base, { compact: true })}</b>
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
                <span>{money(r.busiestMonth.sum, base, { compact: true })}</span>
              </div>
            )}
            <div>
              <small>新开 / 退订</small>
              <b>
                {r.newSubs.length} / {r.ended.length}
              </b>
              <span>{saved.length ? `退订已省 ${money(saved.reduce((a, x) => a + x.saved, 0), base, { compact: true })}` : '没有退订'}</span>
            </div>
            <div>
              <small>用到的币种</small>
              <b>{r.currencies} 种</b>
              <span>现在每月 {money(t.mrr, base, { compact: true })}</span>
            </div>
          </div>
          <div class="rv-foot">calends.example.com</div>
        </div>
        <small class="muted" style={{ textAlign: 'center' }}>
          截图即可分享
        </small>
      </div>
    </Sheet>
  );
}
