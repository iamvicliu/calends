import { createPortal } from 'react-dom';
import { useState } from 'react';
import {
  activePhases,
  chargesBetween,
  currentPhase,
  phaseSubs,
  cycleLabel,
  diffDays,
  effectiveStatus,
  memberDues,
  monthlyGross,
  nextCharge,
  priceAt,
  servedTime,
  upcomingPhase,
} from '../../shared/billing.ts';
import { cnDateAuto, cnDateFull, flag, money, relDays } from '../../shared/format.ts';
import { chargeValue, rateOn } from '../../shared/fx.ts';
import type { AppState, Payment, Subscription } from '../../shared/types.ts';
import { PaymentSheet } from './PaymentSheet.tsx';
import { History } from '../components/History.tsx';
import { CatChip, Cell, Group, Icon, PayBadge, SubIcon } from '../components/ui.tsx';
import { catColor, subImage, sumBase } from '../derive.ts';
import { run, saveSub } from '../store.ts';
import { ChangeNote, ParallelNote } from './List.tsx';
import { MiniGantt } from './Gantt.tsx';
import { SubShare } from './SubShare.tsx';
import { confirmPlan, dropPlan } from '../../shared/phases.ts';
import { t } from '../../shared/i18n.ts';
import { useMoneyPair } from '../components/MoneyPair.tsx';

/** 状态角标的色调；文案见 list.status.* */
const TONE: Record<string, string> = {
  upcoming: 'blue',
  active: 'green',
  trial: 'green',
  paused: '',
  ending: 'orange',
  ended: '',
  lifetime: 'blue',
};

export function Detail({ sub, state, today, onEdit }: { sub: Subscription; state: AppState; today: string; onEdit: () => void }) {
  // 大字 / 小字金额跟随显示货币设置
  const pair = useMoneyPair(state);
  const base = state.settings.baseCurrency;
  const st = effectiveStatus(sub, today);
  const next = nextCharge(sub, today);
  // 显示今天生效的那一段（换区前仍是旧区的价格与支付方式），未来的变更单独列出
  const cur = currentPhase(sub, today);
  const up = upcomingPhase(sub, today);
  const method = state.methods.find((m) => m.id === cur.methodId);
  const upMethod = up && state.methods.find((m) => m.id === up.methodId);
  const history = chargesBetween(sub, sub.start, today, today);
  const total = sumBase(state, history);
  const totalUsd = sumBase(state, history, 'USD');
  // 换区后旧的那段还没到期：两段同时在付钱，每月成本按两段之和
  const parallel = sub.phases?.length ? activePhases(sub, today).filter((v) => v.start !== cur.start) : [];
  const monthly = monthlyGross(sub, today, state.fx);
  const remind = sub.remindDays ?? state.settings.remindDays;
  const icon = subImage(sub);
  const label = t(`list.status.${st}`);
  const tone = TONE[st];
  const ro = !!state.readonly;
  const dues = memberDues(sub, today);
  const [allCharges, setAllCharges] = useState(false);
  const [pay, setPay] = useState<{ pay?: Payment; index?: number; phase?: string } | null>(null);
  const [share, setShare] = useState(false);

  const actions = (
    <>
      {!ro && (
        <button className="btn" onClick={onEdit}>
          <Icon name="edit" /> {t('detail.action.edit')}
        </button>
      )}
      {!ro && sub.cycle.unit !== 'lifetime' && st !== 'ended' && (
        <button
          className="btn"
          onClick={() =>
            run(
              () => saveSub(sub.status === 'paused' ? { ...sub, status: 'active', pausedAt: undefined } : { ...sub, status: 'paused', pausedAt: today }),
              sub.status === 'paused' ? t('detail.toast.resumed') : t('detail.toast.paused'),
            )
          }
        >
          <Icon name={sub.status === 'paused' ? 'play' : 'pause'} /> {sub.status === 'paused' ? t('detail.action.resume') : t('detail.action.pause')}
        </button>
      )}
      {sub.manageUrl && (
        <a className="btn" href={sub.manageUrl} target="_blank" rel="noreferrer">
          <Icon name="gear" /> {t('detail.action.manage')}
        </a>
      )}
      {sub.url && (
        <a className="btn" href={sub.url} target="_blank" rel="noreferrer">
          <Icon name="link" /> {t('detail.action.website')}
        </a>
      )}
      <button className="btn" onClick={() => setShare(true)}>
        <Icon name="share" /> {t('detail.action.share')}
      </button>
    </>
  );
  const story = !!(sub.phases?.length || (sub.priceHistory?.length ?? 0) > 1);

  return (
    <div className="detail">
      {/* 宽屏：操作按钮放在右上角 */}
      <div className="d-top">{actions}</div>
      <div className="d-side">
        <div className="d-hero">
          {icon ? (
            <div className="d-hero-bg" style={{ backgroundImage: `url("${icon}")` }} />
          ) : (
            <div className="d-hero-bg tint" style={{ '--tint': catColor(sub.category) } as Record<string, string>} />
          )}
          <SubIcon sub={sub} size={72} />
          <h2>
            {sub.name}
            <span className={`badge ${tone} d-status`}>{label}</span>
          </h2>
          <div className="price">
            {pair(next && (!cur.end || next < cur.end) ? priceAt(sub, next) : cur.price, cur.currency, { compact: false }).main}
            {cycleLabel(cur.cycle)}
            {pair(cur.price, cur.currency, { compact: false }).alt && ` · ${pair(cur.price, cur.currency, { compact: false }).alt}`}
          </div>
          {up && <ChangeNote cur={cur} up={up} st={st} today={today} state={state} />}
          <ParallelNote sub={sub} cur={cur} today={today} />
          <div className="d-actions">{actions}</div>
        </div>
        <Stats
          sub={sub}
          state={state}
          today={today}
          total={total}
          count={history.length}
          alt={base !== 'USD' ? money(totalUsd, 'USD', { compact: true }) : undefined}
        />
        {story && (
          <div className="d-mini">
            <div className="d-mini-h">{t('detail.history')}</div>
            <MiniGantt sub={sub} state={state} today={today} />
          </div>
        )}
      </div>
      <div className="d-body">
        <Group title={t('detail.summary')}>
          <Cell label={t('detail.field.amount')}>{money(cur.price, cur.currency)}</Cell>
          <Cell label={t('detail.field.cycle')}>{cycleLabel(cur.cycle)}</Cell>
          {cur.cycle.unit !== 'lifetime' && (
            <Cell
              label={t('detail.field.monthlyYearly')}
              sub={parallel.length ? t('detail.overlap.monthlyHint', { count: parallel.length + 1 }) : undefined}
            >{`${money(monthly, cur.currency)} / ${money(monthly * 12, cur.currency, { compact: true })}`}</Cell>
          )}
          <Cell label={t('detail.field.category')}>
            <CatChip cat={sub.category} />
          </Cell>
          <Cell label={t('detail.field.method')}>
            <PayBadge m={method} />
          </Cell>
          <Cell label={t('detail.field.start')}>{cnDateFull(sub.start)}</Cell>
          {next && (
            <Cell label={t('detail.field.next')}>
              {cnDateFull(next)} · {relDays(diffDays(today, next))}
            </Cell>
          )}
          {sub.expires && !sub.end && (
            <Cell label={t('detail.field.expires')} sub={next && next < sub.expires ? t('detail.field.expiresHint') : undefined}>
              {cnDateFull(sub.expires)} · {relDays(diffDays(today, sub.expires))}
            </Cell>
          )}
          {sub.end && <Cell label={st === 'ended' ? t('detail.field.endedOn') : t('list.status.ending')}>{cnDateFull(sub.end)}</Cell>}
          {sub.trialEnd && <Cell label={t('detail.field.trialEnd')}>{cnDateFull(sub.trialEnd)}</Cell>}
          {cur.region && <Cell label={t('detail.field.region')}>{`${flag(cur.region)} ${cur.region}`.trim()}</Cell>}
        </Group>

        {parallel.length > 0 && (
          <Group title={t('detail.overlap.title')}>
            {parallel.map((v) => (
              <Cell
                key={v.start}
                label={
                  <span className="row" style={{ gap: 6 }}>
                    {v.region ? `${flag(v.region)} ${v.region}` : t('detail.overlap.previous')}
                    <PayBadge m={state.methods.find((m) => m.id === v.methodId)} />
                  </span>
                }
                sub={t('detail.overlap.until', { date: cnDateFull(v.end!), rel: relDays(diffDays(today, v.end!)) })}
              >
                {money(v.price, v.currency)} · {cycleLabel(v.cycle)}
              </Cell>
            ))}
          </Group>
        )}

        {up && (
          <Group title={up.planned ? t('detail.up.planned') : st === 'upcoming' ? t('detail.up.starting') : t('detail.up.changing')}>
            <Cell label={t('detail.up.effective')}>
              {cnDateFull(up.start)} · {relDays(diffDays(today, up.start))}
            </Cell>
            {up.region !== cur.region && up.region && (
              <Cell
                label={t('detail.field.region')}
              >{`${cur.region && st !== 'upcoming' ? `${flag(cur.region)} ${cur.region} → ` : ''}${flag(up.region)} ${up.region}`}</Cell>
            )}
            <Cell label={t('detail.field.amount')}>
              {st !== 'upcoming' && (up.price !== cur.price || up.currency !== cur.currency) ? `${money(cur.price, cur.currency)} → ` : ''}
              {money(up.price, up.currency)} · {cycleLabel(up.cycle)}
            </Cell>
            <Cell label={t('detail.field.method')}>
              <PayBadge m={upMethod} />
            </Cell>
            {up.planned && !ro && (
              <div className="cell plan-actions">
                <button
                  className="btn"
                  onClick={() => run(() => saveSub(dropPlan(sub, up.start)), t('detail.plan.droppedToast', { date: cnDateFull(up.start) }))}
                >
                  {t('detail.plan.drop')}
                </button>
                <button className="btn primary" onClick={() => run(() => saveSub(confirmPlan(sub, up.start)), t('detail.plan.confirmedToast'))}>
                  <Icon name="check" /> {t('detail.plan.confirm')}
                </button>
              </div>
            )}
          </Group>
        )}

        {(sub.phases?.length || (sub.priceHistory?.length ?? 0) > 1) && (
          <Group title={t('detail.history')}>
            <History sub={sub} state={state} today={today} />
          </Group>
        )}

        {sub.intro && (
          <Group title={t('detail.intro.title')}>
            <Cell
              label={
                <span className="row" style={{ gap: 6, color: 'var(--green)' }}>
                  <Icon name="leaf" /> {t('detail.intro.price')}
                </span>
              }
            >
              {money(sub.intro.price, sub.currency)}
            </Cell>
            <Cell label={t('detail.intro.until')}>{cnDateFull(sub.intro.until)}</Cell>
            <Cell label={t('detail.intro.then')}>{money(sub.price, sub.currency)}</Cell>
          </Group>
        )}

        {sub.cycle.unit !== 'lifetime' && st !== 'ended' && (
          <Group title={t('detail.remind.title')}>
            <Cell
              label={
                <span className="row" style={{ gap: 8 }}>
                  <Icon name="bell" /> {t('detail.remind.email')}
                </span>
              }
            >
              {remind < 0
                ? t('detail.remind.off')
                : t(remind === 0 ? 'detail.remind.onDay' : 'detail.remind.before', {
                    count: remind,
                    time: `${String(state.settings.notifyHour).padStart(2, '0')}:05`,
                  })}
            </Cell>
          </Group>
        )}

        {sub.share && (
          <Group
            title={
              sub.share.role === 'owner' ? t('detail.share.owner', { count: sub.share.members.length + 1, seats: sub.share.seats }) : t('detail.share.member')
            }
          >
            {sub.share.role === 'member' && <Cell label={t('detail.share.payTo')}>{sub.share.ownerName ?? t('detail.share.host')}</Cell>}
            {sub.share.role === 'owner' && (
              <>
                <Cell label={t('detail.share.myShare')}>{money(sub.price - sub.share.members.reduce((a, m) => a + m.share, 0), sub.currency)}</Cell>
                {dues.map((d) => (
                  <Cell
                    key={d.member.id}
                    label={d.member.name || t('detail.share.unnamed')}
                    sub={d.member.paidUntil ? t('detail.share.paidUntil', { date: d.member.paidUntil }) : t('detail.share.unpaid')}
                  >
                    {d.periodsOwed > 0 ? (
                      <span style={{ color: 'var(--orange)', fontWeight: 600 }}>{t('detail.share.owed', { amount: money(d.owed, sub.currency) })}</span>
                    ) : (
                      <span style={{ color: 'var(--green)' }}>{t('detail.share.settled')}</span>
                    )}
                  </Cell>
                ))}
              </>
            )}
          </Group>
        )}

        {history.length > 0 && (
          <Group title={t('detail.charges.title', { count: history.length })}>
            {history
              .slice(allCharges ? 0 : -12)
              .reverse()
              .map((c, i) => {
                const r = rateOn(state.fxHistory, c.currency, c.date);
                const baseRate = rateOn(state.fxHistory, base, c.date);
                // 同一天可能有多笔（如重复扣款），用当天在同一段里的序号定位；并行的两段各算各的
                const index = history.filter((x) => x.date === c.date && x.sub.start === c.sub.start).indexOf(c);
                return (
                  <div
                    key={`${c.date}-${i}`}
                    className={`charge-row ${ro ? '' : 'editable'} ${c.kind ?? ''}`}
                    onClick={() =>
                      !ro &&
                      setPay({
                        pay: { date: c.date, amount: c.kind === 'failed' ? c.sub.price : c.amount, kind: c.kind, settled: c.settled, note: c.note },
                        index,
                        phase: sub.phases?.length ? c.sub.start : undefined,
                      })
                    }
                  >
                    <span className="cr-date">
                      {c.date}
                      {c.kind && <em className={`cr-kind ${c.kind}`}>{t(`detail.charges.kind.${c.kind}`)}</em>}
                    </span>
                    <b>{money(c.amount, c.currency)}</b>
                    <span className="cr-conv">
                      {c.settled && <span className="cr-settled">{t('detail.charges.onCard', { amount: money(c.settled.amount, c.settled.currency) })}</span>}
                      {c.currency !== base && money(chargeValue(state, c, base), base)}
                      {c.currency !== base && base !== 'USD' && c.currency !== 'USD' && ' · '}
                      {base !== 'USD' && c.currency !== 'USD' && money(chargeValue(state, c, 'USD'), 'USD')}
                      {c.currency !== base && r && baseRate && (
                        <small>
                          1 {c.currency} = {((1 / r.rate) * baseRate.rate).toFixed(c.currency === 'NGN' ? 5 : 4)} {base}
                          {r.date !== c.date ? ` · ${r.date}` : ''}
                        </small>
                      )}
                    </span>
                  </div>
                );
              })}
            {!ro && (
              <button className="cell more-row" onClick={() => setPay({})}>
                <Icon name="plus" size={14} /> {t('detail.charges.add')}
              </button>
            )}
            {history.length > 12 && (
              <button className="cell more-row" onClick={() => setAllCharges(!allCharges)}>
                {allCharges ? t('detail.charges.recent') : t('detail.charges.all', { count: history.length })}
              </button>
            )}
          </Group>
        )}

        {sub.notes && (
          <Group title={t('detail.notes')}>
            <div className="cell" style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6 }}>
              {sub.notes}
            </div>
          </Group>
        )}
      </div>
      {/* 挂到 body：详情本身可能在弹层里，嵌套的弹层放在里面会被裁切 */}
      {share && createPortal(<SubShare sub={sub} state={state} today={today} onClose={() => setShare(false)} />, document.body)}
      {pay &&
        createPortal(
          <PaymentSheet
            sub={sub}
            today={today}
            edit={pay.pay ? { pay: pay.pay, index: pay.index ?? 0, phase: pay.phase } : undefined}
            onClose={() => setPay(null)}
          />,
          document.body,
        )}
    </div>
  );
}

/**
 * 指标卡：累计花了多少、订了多久（扣掉断档）、按实际算每月多少、价格变化。
 * 累计按每笔扣款当天的汇率；合租发起人这里是付出去的全额，成员分摊在「合租」页看。
 */
function Stats({ sub, state, today, total, count, alt }: { sub: Subscription; state: AppState; today: string; total: number; count: number; alt?: string }) {
  const base = state.settings.baseCurrency;
  const vs = phaseSubs(sub);
  // 实际在订的天数：各段到今天（或结束日）为止，不算断档，并行的不重复计
  const served = servedTime(sub, today);
  const active = served.days;
  const gaps = served.gaps.length;
  const years = Math.floor(active / 365);
  const months = Math.floor((active % 365) / 30.44);
  const lifetime = sub.cycle.unit === 'lifetime' && vs.length === 1;
  const perMonth = active > 0 ? total / Math.max(1, active / 30.44) : 0;
  // 价格变化：同币种比第一次和现在；币种变过就说换过几次
  const first = vs[0];
  const cur = currentPhase(sub, today);
  const p0 = priceAt(first, first.start);
  const p1 = priceAt(cur, today < cur.start ? cur.start : today);
  const same = first.currency === cur.currency && first.cycle.unit === cur.cycle.unit && first.cycle.every === cur.cycle.every && p0 > 0;
  const change = same ? p1 / p0 - 1 : undefined;
  return (
    <div className="d-stats">
      <div>
        <small>{t('detail.stats.spent')}</small>
        <b>{money(total, base, { compact: true })}</b>
        <span>
          {t('detail.stats.count', { count })}
          {alt ? ` · ${alt}` : ''}
        </span>
      </div>
      <div>
        <small>{lifetime ? t('detail.stats.owned') : t('detail.stats.subscribed')}</small>
        <b>
          {years
            ? months
              ? t('detail.stats.yearsMonths', { years, months })
              : t('detail.stats.years', { count: years })
            : months
              ? t('detail.stats.months', { count: months })
              : t('detail.stats.days', { count: active })}
        </b>
        <span>{gaps ? t('detail.stats.gaps', { count: gaps }) : t('detail.stats.since', { date: cnDateAuto(sub.start, today) })}</span>
      </div>
      {!lifetime && (
        <div>
          <small>{t('detail.stats.perMonth')}</small>
          <b>{money(perMonth, base, { compact: true })}</b>
          <span>{t('detail.stats.perMonthHint')}</span>
        </div>
      )}
      <div>
        <small>{change != null ? t('detail.stats.priceChange') : t('detail.stats.changed')}</small>
        <b className={change != null ? (change > 0.005 ? 'up' : change < -0.005 ? 'down' : '') : ''}>
          {change != null
            ? Math.abs(change) < 0.005
              ? t('detail.stats.unchanged')
              : `${change > 0 ? '+' : '−'}${Math.round(Math.abs(change) * 100)}%`
            : t('detail.stats.times', { count: vs.length - 1 })}
        </b>
        <span>
          {change != null ? `${money(p0, first.currency, { compact: true })} → ${money(p1, cur.currency, { compact: true })}` : t('detail.stats.changeHint')}
        </span>
      </div>
    </div>
  );
}
