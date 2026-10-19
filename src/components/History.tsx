import { cycleLabel, diffDays, phaseSubs } from '../../shared/billing.ts';
import { money } from '../../shared/format.ts';
import type { AppState, Subscription } from '../../shared/types.ts';

/** 订阅历程：阶段（地区/币种/价格/支付方式）、阶段内调价、断更空档 */
export function History({ sub, state, today }: { sub: Subscription; state: AppState; today: string }) {
  const vs = phaseSubs(sub);
  const hasStory = vs.length > 1 || (vs[0].priceHistory?.length ?? 0) > 1;
  if (!hasStory) return null;
  const method = (id?: string) => state.methods.find((m) => m.id === id)?.name;
  const items: preact.JSX.Element[] = [];
  vs.forEach((v, i) => {
    const prev = vs[i - 1];
    if (prev?.end && prev.end < v.start) {
      const months = Math.round(diffDays(prev.end, v.start) / 30.4375);
      items.push(
        <li key={`gap${i}`} class="h-gap">
          <span>断更 {months >= 1 ? `${months} 个月` : `${diffDays(prev.end, v.start)} 天`}</span>
        </li>,
      );
    }
    const live = !v.end || v.end > today;
    const hist = (v.priceHistory ?? []).slice().sort((a, b) => a.from.localeCompare(b.from));
    items.push(
      <li key={`p${i}`} class={`h-phase ${live && v.start <= today ? 'now' : ''}`}>
        <div class="h-range">
          {v.start} → {v.end ? v.end : '至今'}
        </div>
        <div class="h-plan">
          {v.region && <span class="badge">{v.region}</span>}
          <b>{money(v.price, v.currency)}</b> {cycleLabel(v.cycle)}
          {method(v.methodId) && <span class="muted"> · {method(v.methodId)}</span>}
        </div>
        {hist.length > 1 && (
          <ul class="h-prices">
            {hist.map((p, k) => (
              <li key={p.from}>
                {k === 0 ? '起始' : `${p.from} 调价`} · {money(p.amount, v.currency)}
                {k > 0 && hist[k - 1].amount > 0 && <em class={p.amount > hist[k - 1].amount ? 'up' : 'down'}>{p.amount > hist[k - 1].amount ? '+' : ''}{Math.round(((p.amount - hist[k - 1].amount) / hist[k - 1].amount) * 100)}%</em>}
              </li>
            ))}
          </ul>
        )}
      </li>,
    );
  });
  return <ol class="history">{items.reverse()}</ol>;
}
