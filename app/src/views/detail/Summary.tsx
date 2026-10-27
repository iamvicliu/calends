import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { IconButton } from '../../components/ui.tsx';
import { renewalDates } from '../../../../shared/billing.ts';
import { addDays, billingPeriod, diffDays, effectiveStatus, memberAboard, phaseSubs } from '../../../../shared/billing.ts';
import { cnDateAuto, cnDateFull } from '../../../../shared/format.ts';
import type { AppState, ShareMember, Subscription } from '../../../../shared/types.ts';
import { CarMembers } from '../carpool/Members.tsx';
import { carRule } from '../../../../shared/carpool.ts';
import { presetCat } from '../../derive.ts';
import { copyText } from '../../toast.ts';
import { t } from '../../../../shared/i18n.ts';
import { detailForecast, detailHistoryEnd } from '../detail-data.ts';
import { Note, Panel, Prop } from '../../components/DetailKit.tsx';

/**
 * 本期：只画当前这一期，不画历史各期。左端本期开始，右端到期，填充到今天；
 * 刻度标最晚取消日，提前扣款时另标扣款日；试用期、赠送期换颜色和名称。
 * 刻度的日期写在下面一行图例里，不在条上叠标签
 */
export function PeriodBar({ sub, today }: { sub: Subscription; today: string }) {
  const st = effectiveStatus(sub, today);
  const next = detailForecast(sub, today).charges[0];
  if (!next) return null;
  const renewal = renewalDates(sub, addDays(today, 1));
  const bonus = sub.bonus && sub.bonus.from <= today && today <= sub.bonus.until ? sub.bonus : undefined;
  const bp = billingPeriod(sub, today);
  const kind: 'trial' | 'bonus' | 'paid' = st === 'trial' ? 'trial' : bonus ? 'bonus' : 'paid';
  const from = bonus ? bonus.from : bp.from > today ? today : bp.from;
  const end = bonus ? addDays(bonus.until, 1) : renewal.serviceExpires && renewal.serviceExpires > next.date ? renewal.serviceExpires : next.date;
  const span = Math.max(1, diffDays(from, end));
  const at = (d: string) => `${Math.min(100, Math.max(0, (diffDays(from, d) / span) * 100))}%`;
  const pct = Math.round(Math.min(1, Math.max(0, diffDays(from, today) / span)) * 100);
  const cancelBy = renewal.cancelBy && renewal.cancelBy >= today && renewal.cancelBy < end ? renewal.cancelBy : undefined;
  const charge = next.date > today && next.date < end ? next.date : undefined;
  return (
    <div className={`dt-period ${kind}`}>
      <p className="dt-period-h">
        <b>{t(`detail.period.${kind}`)}</b>
        <span>{t('detail.renewal.elapsed', { pct })}</span>
      </p>
      <div className="dt-period-bar" role="img" aria-label={t('detail.renewal.elapsed', { pct })}>
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
          {cancelBy && (
            <span className="cb">
              <i />
              {t('core.renewal.cancelBy')} {cnDateAuto(cancelBy, today)}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/** 详情：支付方式、订阅期间、账号、试用截止、付给谁与备注；金额、周期、分类、地区在标题，下次扣款在顶部四格 */
export function Summary({ sub, state, today }: { sub: Subscription; state: AppState; today: string }) {
  const [masked, setMasked] = useState(true);
  const st = effectiveStatus(sub, today);
  const lifetime = sub.cycle.unit === 'lifetime' && phaseSubs(sub).length === 1;
  const live = !['ended', 'terminated', 'lifetime', 'paused'].includes(st);
  const end = detailHistoryEnd(sub, today);
  return (
    <Panel className="dt-about">
      {live && <PeriodBar sub={sub} today={today} />}
      <dl className="dt-about-grid">
        {/* 计费中只画当前这一期；买断、已结束、暂停写订阅期间（买断的开始日就是那一笔扣款，不再重复） */}
        {!lifetime && !live && (
          <Prop className="dt-period-text" k={t('detail.field.period')}>
            {cnDateFull(sub.start)} – {end.unknown ? t('detail.field.endedUnknown') : end.date ? cnDateFull(end.date) : t('detail.field.present')}
          </Prop>
        )}
        {sub.account && (
          <Prop k={sub.category === presetCat('phone') ? t('editor.field.phone') : t('editor.field.account')}>
            {/* 点一下复制，登录时直接粘贴 */}
            <span className="icon-text">
              <button
                type="button"
                className="dt-copy"
                aria-label={t('detail.copy')}
                title={t('detail.copy')}
                onClick={() => void copyText(sub.account!, t('detail.copied'))}
              >
                <span data-private-account className={masked ? 'car-private' : undefined} aria-hidden={masked || undefined}>
                  {sub.account}
                </span>
              </button>
              <IconButton
                data-snapshot-hide
                aria-label={t(masked ? 'family.sheet.showPersonal' : 'family.sheet.hidePersonal')}
                aria-pressed={masked}
                onClick={() => setMasked(!masked)}
              >
                {masked ? <EyeOff size={17} /> : <Eye size={17} />}
              </IconButton>
            </span>
          </Prop>
        )}
        {/* 试用中顶部已写试用结束后的首次扣款，这里不再单列试用截止 */}
        {sub.trialEnd && st !== 'trial' && <Prop k={t('detail.field.trialEnd')}>{cnDateFull(sub.trialEnd)}</Prop>}
        {/* 加入别人的合租只有「付给谁」一项，放在详情里，不单独成卡 */}
        {sub.share?.role === 'member' && <Prop k={t('detail.share.payTo')}>{sub.share.ownerName ?? t('detail.share.host')}</Prop>}
      </dl>
      {/* 备注单独带一个标题，与上面的属性同一种「标签在上」写法，一眼看出这是备注；属私人信息，复制成图片时不带 */}
      {sub.notes && (
        <div className="dt-note-block" data-snapshot-hide>
          <span className="dt-note-k">{t('editor.field.notes')}</span>
          <Note text={sub.notes} />
        </div>
      )}
    </Panel>
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
