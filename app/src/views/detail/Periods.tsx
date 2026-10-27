import { addDays, billingPeriod, diffDays, effectiveStatus, renewalDates } from '../../../../shared/billing.ts';
import { carRule, collectionPeriod } from '../../../../shared/carpool.ts';
import { cnDateAuto } from '../../../../shared/format.ts';
import { t } from '../../../../shared/i18n.ts';
import type { AppState, Subscription } from '../../../../shared/types.ts';
import { detailForecast } from '../detail-data.ts';

/**
 * 本期：只画当前这一期，不画历史各期。左端本期开始，右端到期，填充到今天；
 * 刻度标最晚取消日，提前扣款时另标扣款日；试用期、赠送期换颜色和名称。
 * 刻度的日期写在下面一行图例里，不在条上叠标签。split 时与收费周期并排，标题改为「订阅周期」
 */
export function PeriodBar({ sub, today, split = false }: { sub: Subscription; today: string; split?: boolean }) {
  const st = effectiveStatus(sub, today);
  const next = detailForecast(sub, today).charges[0];
  if (!next) return null;
  const renewal = renewalDates(sub, addDays(today, 1));
  const bonus = sub.bonus && sub.bonus.from <= today && today <= sub.bonus.until ? sub.bonus : undefined;
  const bp = billingPeriod(sub, today);
  const kind: 'trial' | 'bonus' | 'paid' = st === 'trial' ? 'trial' : bonus ? 'bonus' : 'paid';
  const from = bonus ? bonus.from : bp.from > today ? today : bp.from;
  const end = bonus ? addDays(bonus.until, 1) : renewal.serviceExpires && renewal.serviceExpires > next.date ? renewal.serviceExpires : next.date;
  const cancelBy = renewal.cancelBy && renewal.cancelBy >= today && renewal.cancelBy < end ? renewal.cancelBy : undefined;
  const charge = next.date > today && next.date < end ? next.date : undefined;
  const title = t(split && kind === 'paid' ? 'detail.period.sub' : `detail.period.${kind}`);
  return <Bar kind={kind} title={title} from={from} end={end} today={today} short={split} cancelBy={cancelBy} charge={charge} />;
}

/** 一条周期进度：end 是下一期的第一天，图例写到前一天 */
function Bar({
  kind,
  title,
  from,
  end,
  today,
  short,
  cancelBy,
  charge,
}: {
  kind: string;
  title: string;
  from: string;
  end: string;
  today: string;
  short: boolean;
  cancelBy?: string;
  charge?: string;
}) {
  const span = Math.max(1, diffDays(from, end));
  const at = (d: string) => `${Math.min(100, Math.max(0, (diffDays(from, d) / span) * 100))}%`;
  const pct = Math.round(Math.min(1, Math.max(0, diffDays(from, today) / span)) * 100);
  return (
    <div className={`dt-period ${kind}`}>
      <p className="dt-period-h">
        <b>{title}</b>
        {/* 并排时位置窄，只写百分比 */}
        <span>{short ? `${pct}%` : t('detail.renewal.elapsed', { pct })}</span>
      </p>
      <div className="dt-period-bar" role="img" aria-label={`${title} ${t('detail.renewal.elapsed', { pct })}`}>
        <i style={{ width: `${pct}%` }} />
        {cancelBy && <b className="cb" style={{ left: at(cancelBy) }} />}
        {charge && <b className="ch" style={{ left: at(charge) }} />}
      </div>
      <p className="dt-period-ends">
        <span>{cnDateAuto(from, today)}</span>
        <span>{cnDateAuto(addDays(end, -1), today)}</span>
      </p>
      {cancelBy && (
        <p className="dt-period-keys">
          <span className="cb">
            <i />
            {t('core.renewal.cancelBy')} {cnDateAuto(cancelBy, today)}
          </span>
        </p>
      )}
    </div>
  );
}

/** 我发起且仍在计费的合租：今天所在的收款期；其余为 undefined */
export function collectNow(sub: Subscription, state: AppState, today: string) {
  const live = !['ended', 'terminated', 'lifetime', 'paused'].includes(effectiveStatus(sub, today));
  return live && sub.share?.role === 'owner' ? collectionPeriod(sub, carRule(state, sub, today).billEvery, today) : undefined;
}

/** 订阅周期与收费周期左右并排；订阅详情与合租详情共用 */
export function PeriodPair({ sub, today, collect }: { sub: Subscription; today: string; collect: { from: string; next: string } }) {
  return (
    <div className="dt-period-pair">
      <PeriodBar sub={sub} today={today} split />
      <Bar kind="collect" title={t('detail.period.collect')} from={collect.from} end={collect.next} today={today} short />
    </div>
  );
}
