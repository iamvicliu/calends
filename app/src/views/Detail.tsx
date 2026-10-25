import { CopyImageButton } from '../components/CopyImageButton.tsx';
import { copyParts } from '../components/copy.tsx';
import { YearLedger, YearMethods } from '../components/YearLedger.tsx';
import { renewalDates, chargeMethodId } from '../../../shared/billing.ts';
import { StopPanel } from '../components/StopPanel.tsx';
import { base } from '../base.ts';
import { createPortal } from 'react-dom';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, ExternalLink, X, Pause, Pencil, Play, Plus, Settings2, Share, TrendingDown, TrendingUp } from 'lucide-react';
import {
  activePhases,
  addDays,
  addMonths,
  billingPeriod,
  chargesBetween,
  coveredUntil,
  currentPhase,
  cycleDays,
  cycleLabel,
  diffDays,
  effectiveStatus,
  isGap,
  monthlyGross,
  memberAboard,
  nextCharge,
  phaseLanes,
  phaseSubs,
  priceAt,
  servedTime,
  stopSummary,
  upcomingPhase,
  type Charge,
} from '../../../shared/billing.ts';
import { flow, cnDate, cnDateAuto, cnDateFull, money, relDays, weekdayOf } from '../../../shared/format.ts';
import { stopLosses } from '../../../shared/metrics.ts';
import { netCost, transferredStop, transfersOf, transferSign, transferValue } from '../../../shared/transfers.ts';
import { chargeValue, convertOn, rateOn } from '../../../shared/fx.ts';
import type { AppState, Payment, ShareMember, Subscription } from '../../../shared/types.ts';
import { CarMembers, CarSheet } from './Carpool.tsx';
import { carRule } from '../../../shared/carpool.ts';
import { carLedger, MemberSheet } from './Members.tsx';
import { PaymentSheet } from './PaymentSheet.tsx';
import { MetricCards, Metric, CardTitle, IconButton, CatChip, PayBadge, RegionTag, Seg, Sheet, subRegion, SubIcon } from '../components/ui.tsx';
import { presetCat, toBase } from '../derive.ts';
import { FLAGS } from '../display.ts';
import { run, saveSub, toast } from '../store.ts';
import { snapshot } from '../snapshot.ts';
import { SubShare } from './SubShare.tsx';
import { confirmPlan, dropPlan, pricePoints, reactivate } from '../../../shared/phases.ts';
import { t } from '../../../shared/i18n.ts';
import { useMoneyPair } from '../components/MoneyPair.tsx';
import { ChargeBars, type ChartLane } from './DetailChart.tsx';
import { detailForecast } from './detail-data.ts';
import { DetailHead, DetailSheet, Note, Panel, Prop } from '../components/DetailKit.tsx';
import { TransferSheet } from '../components/TransferSheet.tsx';
import type { Transfer } from '../../../shared/types.ts';

/** 状态角标的色调；文案见 list.status.* */
const TONE: Record<string, string> = {
  upcoming: 'acc',
  trial: 'ok',
  paused: '',
  ending: 'warn',
  ended: '',
  terminated: 'bad',
};
const LANE_COLORS = ['var(--c1)', 'var(--c6)', 'var(--c5)', 'var(--c3)', 'var(--c4)', 'var(--c7)'];

/** 涨跌角标：花费类数字，降了是好事（绿），涨了是坏事（红） */
function Trend({ pct }: { pct: number | undefined }) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const flat = Math.abs(pct) < 0.005;
  const cls = flat ? '' : pct < 0 ? 'ok' : 'bad';
  return (
    <span className={`dt-badge ${cls}`}>
      {flat ? <ArrowRight size={12} /> : pct < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
      {flat ? '0%' : `${(Math.abs(pct) * 100).toFixed(Math.abs(pct) < 0.1 ? 1 : 0)}%`}
    </span>
  );
}

/** 地区：国旗小图 + 代码（emoji 国旗在部分系统上显示成字母） */
function Region({ cc }: { cc: string }) {
  const k = cc.toLowerCase();
  return (
    <span className="dt-region">
      {FLAGS.has(k) && <img src={base(`/flags/${k}.png`)} alt="" />}
      {cc.toUpperCase()}
    </span>
  );
}

const methodOf = (state: AppState, id?: string) => state.methods.find((m) => m.id === id);

/**
 * 详情顶部的操作按钮。宽屏：常用的带文字（胶囊），次要的只有图标（正圆）；
 * 窄屏：同高的胶囊与圆形图标操作，空间不足时整项换行
 */
function Act({
  icon,
  label,
  onClick,
  href,
  round,
  primary,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  round?: boolean;
  primary?: boolean;
}) {
  const inner = (
    <>
      <i className="dt-act-i">{icon}</i>
      <span className="dt-act-l">{label}</span>
    </>
  );
  const cls = `${round ? 'icon-btn dt-round' : 'btn dt-act'} ${primary ? 'primary' : ''}`;
  return href ? (
    <a className={cls} href={href} target="_blank" rel="noreferrer" title={label} aria-label={label}>
      {inner}
    </a>
  ) : round ? (
    <IconButton className="dt-round" onClick={onClick} title={label} aria-label={label}>
      {inner}
    </IconButton>
  ) : (
    <button className={cls} onClick={onClick} title={label} aria-label={label}>
      {inner}
    </button>
  );
}

/** 把详情复制成图片：和弹窗一样的圆角，圆角外透明；去掉顶部按钮 */
function detailImage(el: HTMLElement) {
  const sheet = el.closest<HTMLElement>('.sheet') ?? el;
  return snapshot(el, {
    radius: getComputedStyle(sheet).borderRadius,
    filter: (n) => !(n instanceof Element && n.matches('.dt-actions, .dt-add')),
  }).then((b) => b!);
}

export function Detail({ sub, state, today, onEdit, onClose }: { sub: Subscription; state: AppState; today: string; onEdit: () => void; onClose: () => void }) {
  const pair = useMoneyPair(state);
  const st = effectiveStatus(sub, today);
  const next = nextCharge(sub, addDays(today, 1));
  // 显示今天生效的那一段（换区前仍是旧区的价格与支付方式），未来的变更单独列出
  const cur = currentPhase(sub, today);
  const history = chargesBetween(sub, sub.start, today, today);
  const ro = !!state.readonly;
  const [pay, setPay] = useState<{ pay?: Payment; index?: number; phase?: string } | null>(null);
  const [stopping, setStopping] = useState(false);
  const [share, setShare] = useState(false);
  // 合租弹窗：从详情的合租区点进去，看收了多少、付了多少；成员资料再叠一层
  const [car, setCar] = useState(false);
  const [member, setMember] = useState<{ m?: ShareMember; collect?: boolean } | null>(null);
  const [transfer, setTransfer] = useState<{ index?: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const nowPrice = next && (!cur.end || next < cur.end) ? priceAt(sub, next) : cur.price;
  const forecast = detailForecast(sub, today);
  const showForecast = !forecast.sparse && forecast.charges.length > 0;
  const once = sub.cycle.unit === 'lifetime' && phaseSubs(sub).length === 1;
  // 买断按买下那天的汇率折算，与扣款记录、摊到每月同一口径；按今天汇率会和记录里的金额对不上
  const big = pair(nowPrice, cur.currency, { compact: false, plain: true, date: once ? history[0]?.date : undefined });

  const editPay = (c: Charge) => {
    if (ro) return;
    // 同一天可能有多笔（如重复扣款），用当天在同一段里的序号定位；并行的两段各算各的
    const index = history.filter((x) => x.date === c.date && x.sub.start === c.sub.start).indexOf(c);
    setPay({
      pay: { date: c.date, amount: c.kind === 'failed' ? c.sub.price : c.amount, kind: c.kind, settled: c.settled, note: c.note },
      index,
      phase: sub.phases?.length ? c.sub.start : undefined,
    });
  };

  const paused = sub.status === 'paused';
  // 买断，或刚开始的长周期订阅（一段、不合租，不到两笔扣款画不出走势，也没有未来扣款图）：
  // 主栏只剩指标卡，换成窄的单列，不留半屏空白
  const compact = phaseSubs(sub).length === 1 && !sub.share && (sub.cycle.unit === 'lifetime' || (!showForecast && regular(history).length < 2));
  const charges = (
    <Charges
      sub={sub}
      state={state}
      today={today}
      history={history}
      onRow={ro ? undefined : editPay}
      // 买断已有那一笔就不再提示记一笔，行仍可点开修改
      onAdd={ro || (once && history.length) ? undefined : () => setPay({})}
    />
  );
  const events = !compact ? <Events sub={sub} state={state} today={today} /> : null;
  const actions = (
    <>
      {!ro && sub.cycle.unit !== 'lifetime' && !['ended', 'terminated'].includes(st) && (
        <Act
          icon={paused ? <Play size={15} /> : <Pause size={15} />}
          label={paused ? t('detail.action.resume') : t('detail.action.pause')}
          onClick={() =>
            run(
              () => saveSub(paused ? { ...sub, status: 'active', pausedAt: undefined } : { ...sub, status: 'paused', pausedAt: today }),
              paused ? t('detail.toast.resumed') : t('detail.toast.paused'),
            )
          }
        />
      )}
      {!ro && sub.cycle.unit !== 'lifetime' && !['ended', 'terminated'].includes(st) && (
        <Act icon={<X size={15} />} label={t('core.stop.title')} onClick={() => setStopping(true)} />
      )}
      {!ro && sub.stop?.kind === 'cancel' && (
        <Act icon={<Play size={15} />} label={t('core.stop.restore')} onClick={() => run(() => saveSub(reactivate(sub, today)), t('detail.toast.resumed'))} />
      )}
      {!ro && st === 'terminated' && <Act icon={<Plus size={15} />} label={t('editor.change.resume')} onClick={onEdit} />}
      {sub.manageUrl && <Act icon={<Settings2 size={15} />} label={t('detail.action.manage')} href={sub.manageUrl} />}
      {!ro && <Act primary icon={<Pencil size={15} />} label={t('detail.action.edit')} onClick={onEdit} />}
    </>
  );
  const utilityActions = (
    <>
      {sub.url && <Act icon={<ExternalLink size={15} />} label={t('detail.action.website')} href={sub.url} round />}
      <CopyImageButton render={() => detailImage(root.current!)} />
      <Act icon={<Share size={15} />} label={t('detail.action.share')} onClick={() => setShare(true)} round />
    </>
  );

  const content = (
    <div className={`dt ${compact ? 'compact' : ''}`} ref={root}>
      <DetailHead
        icon={<SubIcon sub={sub} size={48} proxied />}
        title={sub.name}
        badge={
          st !== 'active' &&
          st !== 'lifetime' && (
            <span className={`dt-badge dot ${TONE[st]}`}>
              <i />
              {t(`list.status.${st}`)}
            </span>
          )
        }
        meta={
          <>
            <b>
              {big.main} {st !== 'lifetime' && cycleLabel(cur.cycle)}
            </b>
            {big.alt && <span>{big.alt}</span>}
            <RegionTag
              cc={subRegion(
                cur,
                state.methods.find((x) => x.id === cur.methodId),
              )}
            />
            {sub.category && <CatChip cat={sub.category} />}
          </>
        }
        actions={
          <>
            {actions}
            <span className="dt-header-tools">{utilityActions}</span>
          </>
        }
        onClose={onClose}
      />

      {/*
          顶部四格随状态变：下次扣款、本期进度、累计、每月；下面单列分节，
          提醒仍是卡片，其余（走势、记录、合租、详情、历程）用分隔线隔开
        */}
      <div className="dt-body dt-flow">
        <Kpis sub={sub} state={state} today={today} history={history} />
        {/* 指标下面：本期进度与属性（不加标题），然后是扣款走势、提醒和记录 */}
        <Summary sub={sub} state={state} today={today} />
        {!compact && <Timeline sub={sub} state={state} today={today} history={history} />}
        <Notices sub={sub} state={state} today={today} />
        {/* 合租比扣款记录重要，放在前面 */}
        <ShareCard sub={sub} state={state} today={today} onCar={() => setCar(true)} onMember={(m, collect) => setMember({ m, collect })} />
        {charges}
        <Transfers sub={sub} state={state} onRow={ro ? undefined : (index) => setTransfer({ index })} onAdd={ro ? undefined : () => setTransfer({})} />
        {events}
      </div>

      {/* 挂到 body：详情本身在弹层里，嵌套的弹层放在里面会被裁切 */}
      {stopping &&
        createPortal(
          <Sheet title={t('core.stop.title')} narrow onClose={() => setStopping(false)}>
            <StopPanel
              sub={sub}
              today={today}
              onApply={(next) =>
                run(
                  async () => {
                    await saveSub(next);
                    setStopping(false);
                  },
                  next.stop ? t('core.stop.stoppedDone') : next.end ? t('core.stop.nonrenewDone', { date: cnDateFull(next.end) }) : t('detail.toast.resumed'),
                )
              }
            />
          </Sheet>,
          document.body,
        )}
      {share && createPortal(<SubShare sub={sub} state={state} today={today} onClose={() => setShare(false)} />, document.body)}
      {car &&
        sub.share?.role === 'owner' &&
        createPortal(
          <CarSheet
            state={state}
            s={sub}
            today={today}
            ro={ro}
            book={carLedger(state, sub, today)}
            onClose={() => setCar(false)}
            onOpenSub={() => setCar(false)}
            onMember={(m, collect) => setMember({ m, collect })}
          />,
          document.body,
        )}
      {member && createPortal(<MemberSheet state={state} s={sub} member={member.m} collect={member.collect} onClose={() => setMember(null)} />, document.body)}
      {transfer &&
        createPortal(
          <TransferSheet
            list={sub.transfers ?? []}
            index={transfer.index}
            currency={cur.currency}
            today={today}
            onSave={(next: Transfer[]) => void run(() => saveSub({ ...sub, transfers: next.length ? next : undefined }), t('detail.transfer.saved'))}
            onClose={() => setTransfer(null)}
          />,
          document.body,
        )}
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
  return (
    <DetailSheet label={sub.name} onClose={onClose}>
      {content}
    </DetailSheet>
  );
}

/**
 * 转让收付：二手转入付给原主的钱、转出收到的钱，与扣款记录同一张表（日期 · 类型 · 原币 · 折合）；
 * 金额只在这里出现，顶部「净花费」只写合计。转入是支出（负），转出是收入（正）
 */
function Transfers({ sub, state, onRow, onAdd }: { sub: Subscription; state: AppState; onRow?: (index: number) => void; onAdd?: () => void }) {
  const base = state.settings.baseCurrency;
  const list = sub.transfers ?? [];
  if (!list.length) return null;
  const rows = transfersOf(sub)
    .map((tr) => ({ tr, index: list.indexOf(tr), v: -transferSign(tr) * transferValue(state, tr, base) }))
    .reverse();
  return (
    <Panel
      className="dt-charges dt-transfers"
      title={t('detail.transfer.title')}
      aside={
        onAdd && (
          <button className="dt-btn sm dt-add" onClick={onAdd} title={t('detail.transfer.addTitle')}>
            <Plus size={14} /> {t('detail.charges.addShort')}
          </button>
        )
      }
    >
      <YearLedger
        items={rows}
        dateOf={(r) => r.tr.date}
        keepSecond
        head={[t('detail.transfer.head.date'), t('detail.transfer.kind.label'), t('detail.transfer.head.amount'), t('detail.transfer.head.base', { ccy: base })]}
        yearCells={(ys) => {
          const total = ys.reduce((a, r) => a + r.v, 0);
          return {
            second: null,
            orig: copyParts(
              [...ys.reduce((m, r) => m.set(r.tr.currency, (m.get(r.tr.currency) ?? 0) - transferSign(r.tr) * r.tr.amount), new Map<string, number>())]
                .map(([ccy, sum]) => flow(sum, ccy))
                .join('\n'),
            ),
            base: Number.isFinite(total) ? flow(total, base) : '—',
            baseClass: total > 0 ? 'dt-in' : undefined,
          };
        }}
        row={({ tr, v }) => ({
          date: <time dateTime={tr.date}>{cnDateFull(tr.date)}</time>,
          second: <span className={`dt-kind transfer ${tr.kind}`}>{t(`detail.transfer.kind.${tr.kind}`)}</span>,
          orig: flow(-transferSign(tr) * tr.amount, tr.currency, Number.isInteger(tr.amount) ? { decimals: 0 } : {}),
          base: Number.isFinite(v) ? flow(v, base) : '—',
          baseClass: v > 0 ? 'dt-in' : undefined,
        })}
        rowKey={({ index }) => `t${index}`}
        rowTitle={({ tr }) => tr.note}
        onRow={onRow && (({ index }) => onRow(index))}
      />
    </Panel>
  );
}

/** 正常扣款（不含退款、补差、失败，也不含记成负数的返佣、抵扣）：走势和「每笔」都只看这些 */
const regular = (h: Charge[]) => h.filter((c) => !c.kind && c.amount > 0);

/**
 * 顶部四格，内容跟着状态走：
 * 计费中、试用中是 下次扣款 · 订了多久 · 累计 · 每月；已结束是 结束于 · 订了多久 · 累计 · 每月；
 * 买断、暂停没有下一笔，是 订了多久 · 累计 · 每月。
 * 累计按每笔扣款当天的汇率；合租发起人这里是付出去的全额，成员分摊在「合租」页看。
 */
function Kpis({ sub, state, today, history }: { sub: Subscription; state: AppState; today: string; history: Charge[] }) {
  const base = state.settings.baseCurrency;
  const st = effectiveStatus(sub, today);
  // 累计 = 服务付款 + 转入 − 转出；有一笔转让缺汇率就不能求和：显示「—」，不能把缺的那笔当 0
  const cost = netCost(state, sub, today, base);
  const transferred = transfersOf(sub).some((tr) => tr.date <= today);
  const total = cost.net;
  const per = regular(history)
    .map((c) => chargeValue(state, c, base))
    .filter(Number.isFinite);
  // 实际在订的天数：各段到今天（或结束日）为止，不算断档，并行的不重复计
  const served = servedTime(sub, today);
  // 有转让时按持有期：最早转入起，转出那天止
  const active = transferred ? cost.days : served.days;
  const gaps = served.gaps.length;
  // 按平均月长取整：11-24 到次年 10-24 是 11 个月，不能因为差几天算成 10 个月
  const span = active < 30 ? 0 : Math.round(active / 30.4375);
  const years = Math.floor(span / 12);
  const months = span % 12;
  const lifetime = sub.cycle.unit === 'lifetime' && phaseSubs(sub).length === 1;
  // 订了不到一个月（或只有一笔）时，「实际每月」没有意义：改用标价折算的预计每月
  // An incomplete imported history cannot establish an average over the original service lifetime.
  const young = !!sub.estimateFrom || active < 30 || (per.length < 2 && !transferred);
  const perMonth = young
    ? toBase(state, monthlyGross(currentPhase(sub, today), today, state.fx), currentPhase(sub, today).currency)
    : total / Math.max(1, active / 30.44);
  const perTrend = !young && per.length > 1 && per[0] > 0 ? per[per.length - 1] / per[0] - 1 : undefined;
  const duration =
    active < 1
      ? t('detail.kpi.startedToday')
      : years
        ? months
          ? t('detail.stats.yearsMonths', { years, months })
          : t('detail.stats.years', { count: years })
        : months
          ? t('detail.stats.months', { count: months })
          : t('detail.stats.days', { count: active });
  const amount = (v: number) => (Number.isFinite(v) ? flow(-v, base, { compact: true }) : '—');
  // 每月：买断按订了多久平摊，其余按实际（或刚开始时按标价预计）
  const monthly = lifetime ? total / Math.max(1, active / 30.44) : perMonth;

  const next = ['ended', 'terminated', 'lifetime', 'paused'].includes(st) ? undefined : detailForecast(sub, today).charges[0];
  const nextValue = next ? chargeValue(state, next, base) : NaN;
  // 停止的订阅由下方停止卡片写停止日，这里不再重复
  const ended = ['ended', 'terminated'].includes(st) && sub.end && !phaseSubs(sub).some((p) => p.stop);
  const durationCell = (
    <Metric
      label={transferred ? t('detail.transfer.held') : lifetime ? t('detail.stats.owned') : t('detail.stats.subscribed')}
      value={duration}
      note={gaps > 0 ? t('detail.stats.gaps', { count: gaps }) : t('detail.period.since', { date: cnDateFull(transferred ? cost.from : sub.start) })}
    />
  );

  return (
    <MetricCards>
      {next ? (
        <Metric
          label={st === 'trial' ? t('detail.renewal.afterTrial') : t('detail.ev.next')}
          value={cnDateAuto(next.date, today)}
          note={copyParts([Number.isFinite(nextValue) ? flow(-nextValue, base) : '—', relDays(diffDays(today, next.date))].join('\n'))}
        />
      ) : ended ? (
        <Metric label={t('detail.field.endedOn')} value={cnDateAuto(sub.end!, today)} note={relDays(diffDays(today, sub.end!))} />
      ) : (
        durationCell
      )}
      {(next || ended) && durationCell}
      {/* 只有一笔时累计就是那一笔，扣款记录里已有，不再占一格 */}
      {/* 导入边界之前的历史没有记录：没有一笔时写「—」，小字说明只算导入之后 */}
      {/* 有转让时是净花费：转入、转出各自的金额在下方转让卡片，这里只写合计 */}
      {(history.length !== 1 || transferred) && (
        <Metric
          label={transferred ? t(total < 0 ? 'detail.transfer.netGain' : 'detail.transfer.net') : t('detail.stats.spent')}
          value={sub.estimateFrom && !history.length && !transferred ? '—' : amount(total)}
          note={
            sub.estimateFrom
              ? t('settings.import.history')
              : transferred
                ? copyParts([t('detail.stats.count', { count: history.length }), t('detail.transfer.included')].join('\n'))
                : t('detail.stats.count', { count: history.length })
          }
        />
      )}
      <Metric
        label={lifetime ? t('detail.kpi.amortizedCost') : young ? t('detail.kpi.expectedMonthly') : t('detail.stats.perMonth')}
        value={sub.estimateFrom && lifetime && !history.length ? '—' : lifetime ? t('detail.kpi.perMonthValue', { amount: amount(monthly) }) : amount(monthly)}
        // 与其他格一样三行：折到每天多少；算不出来就不写这一行
        note={Number.isFinite(monthly) ? t('detail.kpi.perDay', { amount: flow(-monthly / 30.44, base) }) : undefined}
        accessory={!lifetime ? <Trend pct={perTrend} /> : undefined}
      />
    </MetricCards>
  );
}

type Range = 'all' | '1y' | '6m';

/**
 * 扣款时间轴：今天之前是每笔实际扣款，之后是预测，中间一条「今天」虚线。
 * 预测长度按周期：月付及更短看半年，更长的看一个周期（至少半年、至多两年）。
 * 下次扣款的日期与金额在顶部四格；买断、已结束、暂停没有预测，只画过去。
 */
function Timeline({ sub, state, today, history }: { sub: Subscription; state: AppState; today: string; history: Charge[] }) {
  const base = state.settings.baseCurrency;
  const st = effectiveStatus(sub, today);
  const cur = currentPhase(sub, today);
  const reg = regular(history);
  const live = !['ended', 'terminated', 'lifetime', 'paused'].includes(st);
  const next = live ? detailForecast(sub, today).charges[0] : undefined;
  const days = cycleDays(cur.cycle);
  // 暂停、已结束、买断没有预测：时间轴只画到今天
  let until = live ? addDays(today, days <= 31 ? 183 : Math.min(731, Math.max(183, Math.ceil(days) + 1))) : today;
  if (next && next.date > until) until = next.date;
  const future = live ? chargesBetween(sub, addDays(today, 1), until, today).filter((c) => !c.kind) : [];

  // 只有范围内至少三笔、且比全部少时才给这个范围：两年付、年付这类稀疏记录不显示无意义的「1 年 / 6 个月」
  const within = (months: number) => reg.filter((c) => c.date >= addMonths(today, -months)).length;
  const ranges: Array<[Range, string]> = [
    ['all', t('detail.chart.all')],
    ...(
      [
        ['1y', t('detail.chart.y1'), 12],
        ['6m', t('detail.chart.m6'), 6],
      ] as const
    )
      .filter(([, , m]) => within(m) >= 3 && within(m) < reg.length)
      .map(([k, l]) => [k, l] as [Range, string]),
  ];
  // 月付及更短默认看最近一年，柱子不至于挤成一片；更长的周期默认看全部
  const [range, setRange] = useState<Range>(() => (days <= 31 && ranges.some(([k]) => k === '1y') ? '1y' : 'all'));
  const since = range === 'all' ? '' : addMonths(today, range === '1y' ? -12 : -6);
  const past = reg.filter((c) => c.date >= since);
  // 单位：记账货币，或（所有扣款同一种外币时）原币；原币下卡上另币种结算的那笔没有原币实扣，按标价画
  const ccys = [...new Set([...reg, ...future].map((c) => c.currency))];
  const origCcy = ccys.length === 1 && ccys[0] !== base ? ccys[0] : undefined;
  const [unit, setUnit] = useState<'base' | 'orig'>('base');
  // 图表在柱子太密时按月、季、年汇总，图例里写明一根柱代表多久的合计
  const [bucket, setBucket] = useState(0);
  const ccy = unit === 'orig' && origCcy ? origCcy : base;
  // 标价参照：每一段按它首笔扣款那天的汇率折算，柱子高出或低于这条线就是汇率带来的涨跌
  const firstOf = new Map<string, string>();
  for (const c of reg) if (!firstOf.has(c.sub.start)) firstOf.set(c.sub.start, c.date);
  const each = [...past.map((c) => ({ c, future: false })), ...future.map((c) => ({ c, future: true }))].map((r) => {
    const price = priceAt(r.c.sub, r.c.date);
    const list = ccy === base ? convertOn(price, r.c.currency, base, firstOf.get(r.c.sub.start) ?? r.c.date, state.fxHistory, state.fx) : price;
    const v = ccy === base ? chargeValue(state, r.c, base) : r.c.amount;
    // 首期优惠：这一笔按优惠价扣，原价减去的部分在柱顶画成虚框（按这一笔同样的折算比例）
    const regularPrice = r.c.sub.intro && r.c.date < r.c.sub.intro.until && !r.c.kind ? priceAt({ ...r.c.sub, intro: undefined }, r.c.date) : undefined;
    const full = regularPrice && r.c.amount > 0 && regularPrice > r.c.amount ? (v * regularPrice) / r.c.amount : undefined;
    return {
      ...r,
      date: r.c.date,
      phase: r.c.sub.start,
      v,
      list: Number.isFinite(list) ? list : undefined,
      full: full != null && Number.isFinite(full) ? full : undefined,
    };
  });
  // 标价与实际几乎一样（同币种、未调价）时不画参照线，免得压在柱顶上重复
  const showList = each.some((r) => r.list != null && Number.isFinite(r.v) && Math.abs(r.list - r.v) > Math.abs(r.v) * 0.005);
  // 柱子太密时由图表按宽度自动按月、季、年汇总，这里给出每一笔
  const rows = showList ? each : each.map((r) => ({ ...r, list: undefined }));
  if (rows.length < 2) return null;

  // 横轴从第一根柱到最后一根柱（或今天），两端留同样的边距，左右对称；不按预测窗口的末端留白
  const first = rows[0].date < today ? rows[0].date : today;
  const lastBar = rows[rows.length - 1].date > today ? rows[rows.length - 1].date : today;
  const pad = Math.max(4, Math.round(diffDays(first, lastBar) * 0.03));
  const from = addDays(first, -pad);
  const to = addDays(lastBar, pad);
  const fmt = (v: number) => money(v, ccy, { compact: true });
  const lanesSrc = phaseSubs(sub);
  const laneIdx = phaseLanes(lanesSrc);
  const methodIds = [...new Set(lanesSrc.map((v) => v.methodId ?? ''))];
  const lanes: ChartLane[] = lanesSrc.map((v, i) => ({
    key: v.start,
    from: v.start,
    // 方案色带：计费中的延伸到预测末端；暂停、已结束的画到今天（或那一段的结束日）为止
    to: [v.end ?? to, live ? to : today].sort()[0],
    lane: laneIdx[i],
    color: LANE_COLORS[methodIds.indexOf(v.methodId ?? '') % LANE_COLORS.length],
    label: (
      <>
        {v.region && <Region cc={v.region} />}
        {money(v.price, v.currency)} {cycleLabel(v.cycle)}
      </>
    ),
    short: (
      <>
        {v.region && <Region cc={v.region} />}
        {money(v.price, v.currency)}
      </>
    ),
    aside: methodOf(state, v.methodId)?.name,
  }));
  const planned = each.filter((r) => r.future).reduce((a, r) => a + r.v, 0);

  return (
    <Panel
      className="dt-chart"
      title={t('detail.chart.title', { ccy })}
      aside={
        <>
          {origCcy && (
            <Seg
              small
              value={unit}
              onChange={setUnit}
              options={[
                ['base', base],
                ['orig', origCcy],
              ]}
            />
          )}
          {ranges.length > 1 && <Seg small value={range} onChange={setRange} options={ranges} />}
        </>
      }
    >
      <ChargeBars
        bars={rows}
        from={from}
        to={to}
        today={today}
        todayLabel={t('calendar.today')}
        fmt={fmt}
        lanes={lanes}
        onBucket={setBucket}
        tip={(idx, summed) => {
          // 汇总柱（太密时按月、季、年合计）：写起止日期、笔数与合计
          if (summed && idx.length > 1) {
            const sum = idx.reduce((a, i) => a + rows[i].v, 0);
            return (
              <>
                <div className="cc-tip-h">
                  <b>
                    {cnDateFull(rows[idx[0]].c.date)} – {cnDateFull(rows[idx[idx.length - 1]].c.date)}
                  </b>
                </div>
                <div className="cc-tip-r">
                  <i className={rows[idx[0]].future ? 'k-f' : 'k-v'} />
                  <span>{t('detail.stats.count', { count: idx.length })}</span>
                  <b>{Number.isFinite(sum) ? flow(-sum, ccy) : '—'}</b>
                </div>
              </>
            );
          }
          // 挨在一起的几笔（换方案、换卡、并行方案）：逐笔列出
          if (idx.length > 1) {
            const sum = idx.reduce((a, i) => a + rows[i].v, 0);
            return (
              <>
                <div className="cc-tip-h">
                  <b>{cnDateFull(rows[idx[0]].c.date)}</b>
                  <span>{t('detail.stats.count', { count: idx.length })}</span>
                </div>
                {idx.map((i) => {
                  const r = rows[i];
                  return (
                    <div className="cc-tip-r" key={i}>
                      <i className={r.future ? 'k-f' : 'k-v'} />
                      <span>
                        {copyParts(
                          [cnDate(r.c.date), methodOf(state, chargeMethodId(r.c))?.name ?? t('ui.method.none'), r.c.sub.region ?? '']
                            .filter(Boolean)
                            .join('\n'),
                        )}
                      </span>
                      <b>{Number.isFinite(r.v) ? flow(-r.v, ccy) : '—'}</b>
                    </div>
                  );
                })}
                <div className="cc-tip-f">{Number.isFinite(sum) ? flow(-sum, ccy) : '—'}</div>
              </>
            );
          }
          const r = rows[idx[0]];
          const c = r.c;
          const m = methodOf(state, chargeMethodId(c));
          const rate = rateOn(state.fxHistory, c.currency, c.date);
          const rb = rateOn(state.fxHistory, base, c.date);
          return (
            <>
              <div className="cc-tip-h">
                <b>{cnDateFull(c.date)}</b>
                <span>{weekdayOf(c.date)}</span>
              </div>
              <div className="cc-tip-r">
                <i className={r.future ? 'k-f' : 'k-v'} />
                <span>{r.future ? t('detail.timeline.planned') : t('detail.chart.perCharge')}</span>
                <b>{Number.isFinite(r.v) ? flow(-r.v, ccy) : '—'}</b>
              </div>
              {r.full != null && (
                <div className="cc-tip-r">
                  <i className="k-f" />
                  <span>{t('detail.chart.regular')}</span>
                  <b className="m">{money(r.full, ccy)}</b>
                </div>
              )}
              {r.list != null && (
                <div className="cc-tip-r">
                  <i className="k-l" />
                  <span>{ccy === base ? t('detail.chart.list') : t('detail.chart.listOrig')}</span>
                  <b className="m">{money(r.list, ccy)}</b>
                </div>
              )}
              {c.currency !== ccy && (
                <div className="cc-tip-r">
                  <i />
                  <span>{t('detail.chart.origAmount')}</span>
                  <b className="m">{flow(-c.amount, c.currency)}</b>
                </div>
              )}
              <div className="cc-tip-f">
                {m?.name ?? t('ui.method.none')}
                {copyParts(
                  !r.future &&
                    ccy === base &&
                    c.currency !== base &&
                    rate &&
                    rb &&
                    `\n1 ${c.currency} = ${((1 / rate.rate) * rb.rate).toFixed(c.currency === 'NGN' ? 5 : 4)} ${base}`,
                )}
              </div>
            </>
          );
        }}
      />
      {/* 图例：实色是已扣，虚框是预测；预测合计按今天的汇率 */}
      <div className="dt-legend">
        <span>
          <i className="k-v" />
          {t('detail.timeline.paid')}
        </span>
        {bucket > 0 && <span>{t(`detail.chart.bucket.m${bucket}`)}</span>}
        {each.some((r) => r.full != null) && (
          <span>
            <i className="k-f" />
            {t('detail.chart.saved')}
          </span>
        )}
        {showList && (
          <span>
            <i className="k-l" />
            {ccy === base ? t('detail.chart.list') : t('detail.chart.listOrig')}
          </span>
        )}
        {future.length > 0 && (
          <span>
            <i className="k-f" />
            {t('detail.timeline.planned')}
            {copyParts(t('detail.upcoming.total', { count: future.length, amount: Number.isFinite(planned) ? flow(-planned, ccy) : '—' }))}
          </span>
        )}
      </div>
    </Panel>
  );
}

interface Ev {
  date: string;
  title: string;
  sub?: ReactNode;
  tone?: 'acc' | 'ok' | 'warn' | 'bad' | 'ink';
  future?: boolean;
}

/** 历程：开始、换方案、调价、断档、暂停、结束，以及计划中的变更 */
function Events({ sub, state, today }: { sub: Subscription; state: AppState; today: string }) {
  const [all, setAll] = useState(false);
  const vs = phaseSubs(sub);
  const plan = (v: Subscription) => {
    const m = methodOf(state, v.methodId);
    return (
      <span className="dt-inline">
        {v.region && <Region cc={v.region} />}
        {copyParts([`${money(pricePoints(v)[0].amount, v.currency)} ${cycleLabel(v.cycle)}`, m?.name].filter(Boolean).join('\n'))}
      </span>
    );
  };
  const evs: Ev[] = [];
  vs.forEach((v, i) => {
    const until = coveredUntil(vs, i);
    if (i > 0 && isGap(until, v.start)) {
      const days = diffDays(until!, v.start);
      const months = Math.round(days / 30.4375);
      evs.push({
        date: until!,
        title: t('detail.ev.gap'),
        sub: months >= 1 ? t('editor.history.gapMonths', { count: months }) : t('editor.history.gapDays', { count: days }),
        tone: 'warn',
      });
    }
    if (v.start <= today || !v.planned)
      evs.push({
        date: v.start,
        title: i === 0 ? t('detail.ev.start') : t('detail.ev.switch'),
        sub: plan(v),
        tone: 'acc',
        future: v.start > today,
      });
    const hist = pricePoints(v);
    hist.forEach((p, k) => {
      if (!k || p.from === v.start) return;
      const prev = hist[k - 1].amount;
      evs.push({
        date: p.from,
        title: t('detail.ev.price'),
        sub: `${money(prev, v.currency)} → ${money(p.amount, v.currency)}${prev > 0 ? ` (${p.amount > prev ? '+' : '−'}${Math.round(Math.abs(p.amount / prev - 1) * 100)}%)` : ''}`,
        tone: p.amount > prev ? 'bad' : 'ok',
        future: p.from > today,
      });
    });
  });
  if (sub.intro && sub.intro.until <= today) evs.push({ date: sub.intro.until, title: t('detail.intro.title'), sub: t('detail.ev.introEnd') });
  if (sub.trialEnd) evs.push({ date: sub.trialEnd, title: t('detail.field.trialEnd'), future: sub.trialEnd > today });
  if (sub.pausedAt && sub.status === 'paused') evs.push({ date: sub.pausedAt, title: t('detail.ev.paused'), tone: 'warn' });
  if (sub.share?.since)
    evs.push({
      date: sub.share.since,
      title: t('detail.ev.shareStart'),
      sub:
        sub.share.role === 'owner'
          ? t('detail.share.owner', { count: sub.share.members.filter((m) => memberAboard(m, today)).length + 1, seats: sub.share.seats })
          : t('detail.share.member'),
      tone: 'ok',
    });
  const up = upcomingPhase(sub, today);
  if (up?.planned) evs.push({ date: up.start, title: t('detail.up.planned'), sub: plan(up), future: true });
  for (const v of vs) {
    if (v.stop)
      evs.push({
        date: v.stop.date,
        title: t(v.stop.kind === 'terminate' ? 'core.stop.terminate' : 'core.stop.cancel'),
        sub: !state.readonly && v.stop.kind === 'terminate' ? v.stop.reason : undefined,
        tone: v.stop.kind === 'terminate' ? 'bad' : 'ink',
      });
    if (!state.readonly)
      for (const p of v.payments ?? [])
        if (p.kind === 'refund')
          evs.push({
            date: p.date,
            title: t('editor.payment.kind.refund'),
            tone: 'ok',
            future: p.date > today,
          });
  }
  // 转让只记发生了什么，金额在转让卡片里
  for (const tr of transfersOf(sub))
    evs.push({ date: tr.date, title: t(`detail.transfer.kind.${tr.kind}`), sub: state.readonly ? undefined : tr.note, tone: tr.kind === 'sell' ? 'ok' : 'acc', future: tr.date > today });
  if (sub.end && !sub.stop)
    evs.push({ date: sub.end, title: sub.end <= today ? t('detail.ev.ended') : t('detail.ev.ending'), tone: 'ink', future: sub.end > today });
  // 一条时间线，新的在上
  evs.sort((a, b) => b.date.localeCompare(a.date));

  // 只有开始订阅、开始合租这类一两条时，开始日已在摘要、方案在走势下方，不单独成卡
  if (evs.length < 3) return null;
  const shown = all || evs.length <= 6 ? evs : evs.slice(0, 6);
  const gaps = servedTime(sub, today).gaps.length;
  return (
    <Panel
      className="dt-events"
      title={t('detail.history')}
      aside={`${t('detail.ev.phases', { count: vs.length })}\n${gaps ? t('detail.stats.gaps', { count: gaps }) : t('detail.kpi.noGaps')}`}
    >
      <ol className="dt-evs">
        {shown.map((e, i) => (
          <li key={`${e.date}-${i}`} className={`dt-ev ${e.future ? 'fut' : ''} ${e.tone ?? ''}`}>
            <i />
            {/* 日期在前、事件与说明紧跟在同一行，不再把日期推到最右边 */}
            <time dateTime={e.date}>{cnDateFull(e.date)}</time>
            <div>
              <b>{e.title}</b>
              {e.sub && <small style={e.tone === 'ok' ? { color: 'var(--dt-ok)' } : undefined}>{e.sub}</small>}
            </div>
          </li>
        ))}
      </ol>
      {evs.length > shown.length && (
        <button className="dt-link" onClick={() => setAll(true)}>
          {t('detail.ev.more', { count: evs.length - shown.length })}
        </button>
      )}
    </Panel>
  );
}

/** 停止卡片：放在顶部，一句话说清怎么停的、退了多少、亏了多少；每个停止阶段各一张 */
function Outcome({ sub, state, today }: { sub: Subscription; state: AppState; today: string }) {
  const stopped = phaseSubs(sub).filter((phase) => phase.stop);
  const losses = stopLosses({ ...state, subscriptions: [sub] }, today).items;
  const base = state.settings.baseCurrency;
  if (state.readonly || !stopped.length) return null;
  return (
    <>
      {stopped.map((phase) => {
        const sm = stopSummary(phase, today)!;
        const loss = losses.find((item) => item.phase.start === phase.start);
        // 转出时剩余服务随转让收回：不写已付未用损失，改写转出日
        const sold = transferredStop(phase);
        if (sold) sm.unusedValue = 0;
        return (
          <section key={phase.start} className={`dt-panel dt-outcome ${sm.kind === 'terminate' ? 'bad' : ''} ${sm.unusedValue > 0 ? 'loss' : ''}`}>
            <div className="dt-ph row">
              <CardTitle>{t(sm.kind === 'terminate' ? 'core.stop.terminate' : 'report.stops.cancel')}</CardTitle>
            </div>
            {sm.unusedValue > 0 && (
              <div className="dt-oc-loss">
                <b>{flow(-(loss?.loss ?? sm.unusedValue), phase.currency)}</b>
                <small>
                  {copyParts(
                    [
                      t('core.stop.lossTitle'),
                      t('core.stop.lossDays', { count: sm.wastedDays }),
                      phase.currency !== base
                        ? `≈ ${flow(-(loss?.lossBase ?? convertOn(sm.unusedValue, phase.currency, base, sm.date, state.fxHistory, state.fx)), base)}`
                        : '',
                    ]
                      .filter(Boolean)
                      .join('\n'),
                  )}
                </small>
              </div>
            )}
            {/* 停用原因是一句话，跟在金额下面，不挤到标题行最右边 */}
            {sm.kind === 'terminate' && sm.reason && <p className="dt-oc-reason">{sm.reason}</p>}
            <dl className="dt-props">
              <Prop k={t('core.stop.date')}>{cnDateFull(sm.date)}</Prop>
              <Prop k={t('detail.stop.paidThrough')}>{cnDateFull(sm.paidThrough)}</Prop>
              {sold && <Prop k={t('detail.transfer.kind.sell')}>{cnDateFull(sold.date)}</Prop>}
              <Prop k={t('editor.payment.kind.refund')}>
                {sm.refunded > 0 ? (
                  <span className="dt-in">
                    {(phase.payments ?? []).filter((p) => p.kind === 'refund' && p.date >= sm.date && p.date <= today).length > 1
                      ? flow(sm.refunded, phase.currency)
                      : t(sm.refundStatus === 'full' ? 'core.stop.fullyRefunded' : 'core.stop.partial', { money: '' }).trim()}
                  </span>
                ) : (
                  t('core.stop.refundNo')
                )}
              </Prop>
            </dl>
          </section>
        );
      })}
    </>
  );
}

/**
 * 本期：只画当前这一期，不画历史各期。左端本期开始，右端到期，填充到今天；
 * 刻度标最晚取消日，提前扣款时另标扣款日；试用期、赠送期换颜色和名称。
 * 刻度的日期写在下面一行图例里，不在条上叠标签
 */
function PeriodBar({ sub, today }: { sub: Subscription; today: string }) {
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
      {(cancelBy || charge) && (
        <p className="dt-period-keys">
          {cancelBy && (
            <span className="cb">
              <i />
              {t('core.renewal.cancelBy')} {cnDateAuto(cancelBy, today)}
            </span>
          )}
          {charge && (
            <span className="ch">
              <i />
              {t('detail.ev.next')} {cnDateAuto(charge, today)}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/** 详情：支付方式、订阅期间、账号、试用截止、付给谁与备注；金额、周期、分类、地区在标题，下次扣款在顶部四格 */
function Summary({ sub, state, today }: { sub: Subscription; state: AppState; today: string }) {
  const st = effectiveStatus(sub, today);
  const lifetime = sub.cycle.unit === 'lifetime' && phaseSubs(sub).length === 1;
  const live = !['ended', 'terminated', 'lifetime', 'paused'].includes(st);
  return (
    <Panel className="dt-about">
      {live && <PeriodBar sub={sub} today={today} />}
      <dl className="dt-about-grid">
        {/* 计费中只画当前这一期；买断、已结束、暂停写订阅期间（买断的开始日就是那一笔扣款，不再重复） */}
        {!lifetime && !live && (
          <Prop className="dt-period-text" k={t('detail.field.period')}>
            {cnDateFull(sub.start)} – {sub.end ? cnDateFull(sub.end) : t('detail.field.present')}
          </Prop>
        )}
        {sub.account && (
          <Prop k={sub.category === presetCat('phone') ? t('editor.field.phone') : t('editor.field.account')}>
            {/* 点一下复制，登录时直接粘贴 */}
            <button
              type="button"
              className="dt-copy"
              title={t('detail.copy')}
              onClick={() => void navigator.clipboard?.writeText(sub.account!).then(() => toast(t('detail.copied')))}
            >
              {sub.account}
            </button>
          </Prop>
        )}
        {/* 试用中顶部已写试用结束后的首次扣款，这里不再单列试用截止 */}
        {sub.trialEnd && st !== 'trial' && <Prop k={t('detail.field.trialEnd')}>{cnDateFull(sub.trialEnd)}</Prop>}
        {/* 加入别人的合租只有「付给谁」一项，放在详情里，不单独成卡 */}
        {sub.share?.role === 'member' && <Prop k={t('detail.share.payTo')}>{sub.share.ownerName ?? t('detail.share.host')}</Prop>}
      </dl>
      {/* 备注单独带一个标题，与上面的属性同一种「标签在上」写法，一眼看出这是备注 */}
      {sub.notes && (
        <div className="dt-note-block">
          <span className="dt-note-k">{t('editor.field.notes')}</span>
          <Note text={sub.notes} />
        </div>
      )}
    </Panel>
  );
}

/** 提醒：停止结果、并行方案、即将变更或计划变更、首期优惠；有结论或待操作，放在指标下方通栏 */
function Notices({ sub, state, today }: { sub: Subscription; state: AppState; today: string }) {
  const st = effectiveStatus(sub, today);
  const cur = currentPhase(sub, today);
  const up = upcomingPhase(sub, today);
  const ro = !!state.readonly;
  const parallel = sub.phases?.length ? activePhases(sub, today).filter((v) => v.start !== cur.start) : [];
  return (
    <div className="dt-notices">
      <Outcome sub={sub} state={state} today={today} />
      {parallel.length > 0 && (
        <Panel title={t('detail.overlap.title')}>
          <dl className="dt-props one">
            {parallel.map((v) => (
              <Prop
                key={v.start}
                k={
                  <span className="dt-inline">
                    {v.region ? <Region cc={v.region} /> : t('detail.overlap.previous')}
                    <PayBadge m={methodOf(state, v.methodId)} />
                  </span>
                }
                hint={t('detail.overlap.until', { date: cnDateFull(v.end!), rel: relDays(diffDays(today, v.end!)) })}
              >
                {money(v.price, v.currency)} <span className="copy-gap" aria-hidden="true" /> {cycleLabel(v.cycle)}
              </Prop>
            ))}
          </dl>
        </Panel>
      )}

      {up && (
        <Panel
          title={up.planned ? t('detail.up.planned') : st === 'upcoming' ? t('detail.up.starting') : t('detail.up.changing')}
          // 待确认的计划：取舍按钮放在标题右侧，结论和操作同一眼看到
          aside={
            up.planned && !ro ? (
              <div className="dt-plan">
                <button
                  className="dt-btn"
                  onClick={() => run(() => saveSub(dropPlan(sub, up.start)), t('detail.plan.droppedToast', { date: cnDateFull(up.start) }))}
                >
                  {t('detail.plan.drop')}
                </button>
                <button className="dt-btn dark" onClick={() => run(() => saveSub(confirmPlan(sub, up.start)), t('detail.plan.confirmedToast'))}>
                  {t('detail.plan.confirm')}
                </button>
              </div>
            ) : undefined
          }
        >
          <dl className="dt-props one">
            <Prop k={t('detail.up.effective')} hint={relDays(diffDays(today, up.start))}>
              {cnDateFull(up.start)}
            </Prop>
            {up.region !== cur.region && up.region && (
              <Prop k={t('detail.field.region')}>
                <span className="dt-inline">
                  {cur.region && st !== 'upcoming' && (
                    <>
                      <Region cc={cur.region} /> →
                    </>
                  )}
                  <Region cc={up.region} />
                </span>
              </Prop>
            )}
            <Prop k={t('detail.field.amount')}>
              {st !== 'upcoming' && (up.price !== cur.price || up.currency !== cur.currency) ? `${money(cur.price, cur.currency)} → ` : ''}
              {money(up.price, up.currency)} <span className="copy-gap" aria-hidden="true" /> {cycleLabel(up.cycle)}
            </Prop>
            <Prop k={t('detail.field.method')}>
              <PayBadge m={methodOf(state, up.methodId)} />
            </Prop>
          </dl>
        </Panel>
      )}

      {/* 首期优惠还没结束才提醒；结束后写在历程里，图表里也画了省下的部分 */}
      {sub.intro && sub.intro.until > today && (
        <Panel title={t('detail.intro.title')}>
          <dl className="dt-props one">
            <Prop k={t('detail.intro.price')}>{money(sub.intro.price, sub.currency)}</Prop>
            <Prop k={t('detail.intro.until')}>{cnDateFull(sub.intro.until)}</Prop>
            <Prop k={t('detail.intro.then')}>{money(priceAt({ ...sub, intro: undefined }, sub.intro.until), sub.currency)}</Prop>
          </dl>
        </Panel>
      )}
    </div>
  );
}

/**
 * 合租：和合租详情用同一张成员表（收费、迷你时间线、收款状态），点一行看成员、记收款；
 * 标题右边进合租详情看收付款明细。只有我发起的合租才有这一块
 */
function ShareCard({
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
  onMember: (m?: ShareMember, collect?: boolean) => void;
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
      <CarMembers state={state} s={sub} today={today} ro={!!state.readonly} onMember={onMember} billEvery={carRule(state, sub, today).billEvery} />
    </Panel>
  );
}

/** 扣款记录：按年分组（组头带合计），日期 · 原币 · 折合本位币；点一行改这笔 */
function Charges({
  sub,
  state,
  today,
  history,
  onRow,
  onAdd,
}: {
  sub: Subscription;
  state: AppState;
  today: string;
  history: Charge[];
  onRow?: (c: Charge) => void;
  onAdd?: () => void;
}) {
  const base = state.settings.baseCurrency;
  const multi = phaseSubs(sub).length > 1;
  const rows = history.map((c) => ({ c, b: chargeValue(state, c, base) })).reverse();
  // 卡上实扣的原币：这张表里某个币种的金额都是整数（如奈拉、日元整价扣款）就不写 .00，省出宽度
  const whole = new Set([...new Set(rows.map((r) => r.c.currency))].filter((ccy) => rows.every((r) => r.c.currency !== ccy || Number.isInteger(r.c.amount))));
  const orig = (v: number, ccy: string) => flow(v, ccy, whole.has(ccy) ? { decimals: 0 } : {});
  return (
    <Panel
      // 还没有记录时只是一条带「记一笔」的细条，不进列表网格被拉高
      className="dt-charges"
      title={t('detail.charges.title', { count: history.length })}
      // 记一笔放在标题右侧，不额外占一行
      aside={
        onAdd && (
          <button className="dt-btn sm dt-add" onClick={onAdd} title={t('detail.charges.add')}>
            <Plus size={14} /> {t('detail.charges.addShort')}
          </button>
        )
      }
    >
      {sub.estimateFrom && <p className="muted dt-import-note">{t('settings.import.history')}</p>}
      {/* 与合租的收款、付款表同一套表格（YearLedger）：表头、按年分组带小计、日期写全 */}
      {history.length > 0 && (
        <YearLedger
          items={rows}
          dateOf={(r) => r.c.date}
          head={[t('proxy.table.date'), t('detail.field.method'), t('proxy.table.charged'), t('proxy.table.cost')]}
          yearCells={(ys) => {
            const total = ys.reduce((a, r) => a + r.b, 0);
            return {
              // 这一年用过的支付方式：一种时与下面的行一样写胶囊，几种时把卡的图标叠在一起
              second: <YearMethods ids={[...new Set(ys.map((r) => chargeMethodId(r.c) ?? ''))]} state={state} />,
              // 卡上实扣按原币合计；一年里有几种币种时逐个列出，不留空
              orig: copyParts(
                [...ys.reduce((m, r) => m.set(r.c.currency, (m.get(r.c.currency) ?? 0) + r.c.amount), new Map<string, number>())]
                  .map(([ccy, sum]) => orig(-sum, ccy))
                  .join('\n'),
              ),
              base: Number.isFinite(total) ? flow(-total, base) : '—',
              baseClass: total < 0 ? 'dt-in' : undefined,
            };
          }}
          row={({ c, b }) => ({
            // 日期写全，不再加「几天前」
            date: <time dateTime={c.date}>{cnDateFull(c.date)}</time>,
            second: <PayBadge m={methodOf(state, chargeMethodId(c))} />,
            orig: (
              <>
                {orig(-c.amount, c.currency)}
                {c.kind && <em className={`dt-kind ${c.kind}`}>{t(`detail.charges.kind.${c.kind}`)}</em>}
                {multi && c.sub.region && !c.kind && <em className="dt-kind">{c.sub.region}</em>}
              </>
            ),
            base: Number.isFinite(b) ? flow(-b, base) : '—',
          })}
          rowKey={({ c }, i) => `${c.date}-${c.sub.start}-${i}`}
          rowClass={({ c }) => c.kind ?? ''}
          rowTitle={({ c }) => c.note}
          onRow={onRow && (({ c }) => onRow(c))}
        />
      )}
    </Panel>
  );
}
