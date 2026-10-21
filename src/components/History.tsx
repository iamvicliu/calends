import { addDays, coveredUntil, cycleLabel, diffDays, isGap, phaseLanes, phaseSubs } from '../../shared/billing.ts';
import { cnDateFull, money } from '../../shared/format.ts';
import { t } from '../../shared/i18n.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { DatePicker } from './DatePicker.tsx';
import { PayBadge } from './ui.tsx';

/**
 * 订阅历程：阶段（地区/币种/价格/支付方式）、阶段内调价、断更空档。
 * 时间上重叠的阶段（换区后旧区域还没到期）画在第二条轨道上，并标出并行了多少天；
 * 给了 onEnd 时（编辑页）每段的结束日可以直接改
 */
export function History({
  sub,
  state,
  today,
  onEnd,
}: {
  sub: Subscription;
  state: AppState;
  today: string;
  onEnd?: (start: string, end: string | undefined) => void;
}) {
  const vs = phaseSubs(sub);
  const hasStory = vs.length > 1 || (vs[0].priceHistory?.length ?? 0) > 1;
  if (!hasStory) return null;
  const method = (id?: string) => state.methods.find((m) => m.id === id);
  const lanes = phaseLanes(vs);
  const laned = lanes.some((l) => l > 0);
  const editable = !!onEnd && !!sub.phases?.length;
  const items: React.JSX.Element[] = [];
  vs.forEach((v, i) => {
    // 断更看前面各段最晚跑到哪天：并行的旧段还没到期就不算断
    const until = coveredUntil(vs, i);
    if (i > 0 && isGap(until, v.start)) {
      const months = Math.round(diffDays(until!, v.start) / 30.4375);
      items.push(
        <li key={`gap${i}`} className="h-gap">
          <span>{months >= 1 ? t('editor.history.gapMonths', { count: months }) : t('editor.history.gapDays', { count: diffDays(until!, v.start) })}</span>
        </li>,
      );
    }
    const parallel = i > 0 && until && until > v.start ? diffDays(v.start, v.end && v.end < until ? v.end : until) : 0;
    const live = !v.end || v.end > today;
    const hist = (v.priceHistory ?? []).slice().sort((a, b) => a.from.localeCompare(b.from));
    const raw = sub.phases?.find((p) => p.start === v.start);
    const isLast = i === vs.length - 1;
    items.push(
      <li key={`p${i}`} className={`h-phase ${live && v.start <= today ? 'now' : ''} ${lanes[i] > 0 ? 'lane' : ''} ${editable ? 'edit' : ''}`}>
        {editable && !v.stop ? (
          <div className="h-range h-edit">
            <span>{cnDateFull(v.start)} →</span>
            <DatePicker
              value={raw?.end}
              clearable
              min={addDays(v.start, 1)}
              placeholder={isLast ? t('editor.history.now') : t('editor.overlap.endAuto')}
              onChange={(d) => onEnd!(v.start, d)}
            />
            {v.planned && <span className="badge">{t('editor.overlap.planned')}</span>}
          </div>
        ) : (
          <div className="h-range">
            {v.start > today
              ? v.end
                ? t('editor.history.plannedRange', { start: cnDateFull(v.start), end: cnDateFull(v.end) })
                : t('editor.history.plannedFrom', { start: cnDateFull(v.start) })
              : t('editor.history.range', { start: cnDateFull(v.start), end: v.end ? cnDateFull(v.end) : t('editor.history.now') })}
          </div>
        )}
        <div className="h-plan">
          {v.region && <span className="badge">{v.region}</span>}
          <b>{money(v.price, v.currency)}</b> {cycleLabel(v.cycle)}
          {method(v.methodId) && <PayBadge m={method(v.methodId)} />}
          {parallel > 0 && <span className="badge blue h-par">{t('editor.overlap.parallel', { count: parallel })}</span>}
        </div>
        {hist.length > 1 && (
          <ul className="h-prices">
            {hist.map((p, k) => (
              <li key={p.from}>
                {k === 0 ? t('editor.history.initial') : t('editor.history.priceChange', { date: p.from })} · {money(p.amount, v.currency)}
                {k > 0 && hist[k - 1].amount > 0 && (
                  <em className={p.amount > hist[k - 1].amount ? 'up' : 'down'}>
                    {p.amount > hist[k - 1].amount ? '+' : ''}
                    {Math.round(((p.amount - hist[k - 1].amount) / hist[k - 1].amount) * 100)}%
                  </em>
                )}
              </li>
            ))}
          </ul>
        )}
      </li>,
    );
  });
  return <ol className={`history ${laned ? 'laned' : ''}`}>{items.reverse()}</ol>;
}
