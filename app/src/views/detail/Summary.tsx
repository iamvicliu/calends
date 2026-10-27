import { renewalDates } from '../../../../shared/billing.ts';
import { addDays, billingPeriod, diffDays, effectiveStatus, memberAboard, phaseSubs } from '../../../../shared/billing.ts';
import { cnDateAuto, cnDateFull } from '../../../../shared/format.ts';
import type { AppState, ShareMember, Subscription } from '../../../../shared/types.ts';
import { CarMembers } from '../carpool/Members.tsx';
import { carRule, collectionPeriod } from '../../../../shared/carpool.ts';
import { t } from '../../../../shared/i18n.ts';
import { detailForecast, detailHistoryEnd } from '../detail-data.ts';
import { Note, Panel, Prop } from '../../components/DetailKit.tsx';

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

/** 详情：本期进度（我发起的合租另并排收费周期）、订阅期间、试用截止与付给谁；账号只在编辑里，备注放在详情最下面 */
export function Summary({ sub, state, today }: { sub: Subscription; state: AppState; today: string }) {
  const st = effectiveStatus(sub, today);
  const lifetime = sub.cycle.unit === 'lifetime' && phaseSubs(sub).length === 1;
  const live = !['ended', 'terminated', 'lifetime', 'paused'].includes(st);
  const end = detailHistoryEnd(sub, today);
  const collect = live && sub.share?.role === 'owner' ? collectionPeriod(sub, carRule(state, sub, today).billEvery, today) : undefined;
  return (
    <Panel className="dt-about">
      {live &&
        (collect ? (
          <div className="dt-period-pair">
            <PeriodBar sub={sub} today={today} split />
            <Bar kind="collect" title={t('detail.period.collect')} from={collect.from} end={collect.next} today={today} short />
          </div>
        ) : (
          <PeriodBar sub={sub} today={today} />
        ))}
      <dl className="dt-about-grid">
        {/* 计费中只画当前这一期；买断、已结束、暂停写订阅期间（买断的开始日就是那一笔扣款，不再重复） */}
        {!lifetime && !live && (
          <Prop className="dt-period-text" k={t('detail.field.period')}>
            {cnDateFull(sub.start)} – {end.unknown ? t('detail.field.endedUnknown') : end.date ? cnDateFull(end.date) : t('detail.field.present')}
          </Prop>
        )}
        {/* 试用中顶部已写试用结束后的首次扣款，这里不再单列试用截止 */}
        {sub.trialEnd && st !== 'trial' && <Prop k={t('detail.field.trialEnd')}>{cnDateFull(sub.trialEnd)}</Prop>}
        {/* 加入别人的合租只有「付给谁」一项，放在详情里，不单独成卡 */}
        {sub.share?.role === 'member' && <Prop k={t('detail.share.payTo')}>{sub.share.ownerName ?? t('detail.share.host')}</Prop>}
      </dl>
    </Panel>
  );
}

/** 备注不关键，放在详情最下面；属私人信息，复制成图片时不带 */
export function NoteBlock({ sub }: { sub: Subscription }) {
  if (!sub.notes) return null;
  return (
    <div data-snapshot-hide>
      <Panel title={t('editor.field.notes')} className="dt-note-panel">
        <Note text={sub.notes} />
      </Panel>
    </div>
  );
}

/**
 * 合租：和合租详情用同一张成员表（收费、迷你时间线、收款状态），点一行看成员、记收款；
 * 标题右边进合租详情看收付款明细。只有我发起的合租才有这一块
 */
export function ShareCard({
  sub,
  state,
  today,
  onCar,
  onMember,
}: {
  sub: Subscription;
  state: AppState;
  today: string;
  onCar: () => void;
  onMember: (m?: ShareMember) => void;
}) {
  const share = sub.share;
  if (share?.role !== 'owner') return null;
  return (
    <Panel
      title={t('detail.share.owner', { count: share.members.filter((m) => memberAboard(m, today)).length + 1, seats: share.seats })}
      className="dt-share"
      aside={
        <button type="button" className="dt-link" onClick={onCar}>
          {t('detail.share.open')} ›
        </button>
      }
    >
      <CarMembers state={state} s={sub} today={today} onMember={onMember} billEvery={carRule(state, sub, today).billEvery} />
    </Panel>
  );
}
