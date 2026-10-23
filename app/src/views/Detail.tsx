import { CopyImageButton } from '../components/CopyImageButton.tsx';
import { copyParts } from '../components/copy.tsx';
import { renewalDates } from '../../../shared/billing.ts';
import { StopPanel } from '../components/StopPanel.tsx';
import { base } from '../base.ts';
import { createPortal } from 'react-dom';
import { Fragment, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, ExternalLink, X, Pause, Pencil, Play, Plus, Settings2, Share, StickyNote, TrendingDown, TrendingUp } from 'lucide-react';
import {
  activePhases,
  addDays,
  addMonths,
  chargesBetween,
  coveredUntil,
  currentPhase,
  cycleLabel,
  diffDays,
  effectiveStatus,
  isGap,
  memberDues,
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
import { flow, cnDateFull, money, relDays, weekdayOf } from '../../../shared/format.ts';
import { stopLosses } from '../../../shared/metrics.ts';
import { chargeValue, convertOn, rateOn } from '../../../shared/fx.ts';
import type { AppState, Payment, ShareMember, Subscription } from '../../../shared/types.ts';
import { CarSheet } from './Carpool.tsx';
import { carLedger, MemberSheet } from './Members.tsx';
import { PaymentSheet } from './PaymentSheet.tsx';
import { MetricCards, Metric, CardTitle, IconButton, CatIcon, PayBadge, RegionTag, Seg, Sheet, subRegion, SubIcon } from '../components/ui.tsx';
import { catColor, presetCat, toBase } from '../derive.ts';
import { FLAGS } from '../display.ts';
import { run, saveSub, toast } from '../store.ts';
import { snapshot } from '../snapshot.ts';
import { SubShare } from './SubShare.tsx';
import { confirmPlan, dropPlan, pricePoints, reactivate } from '../../../shared/phases.ts';
import { t } from '../../../shared/i18n.ts';
import { useMoneyPair } from '../components/MoneyPair.tsx';
import { ChargeChart, type ChartLane } from './DetailChart.tsx';
import { detailChargeHistory, detailForecast } from './detail-data.ts';
import { ShareAvatars } from '../components/ShareAvatars.tsx';
import './detail.css';

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

/** 分类：分类色 + 图标 + 名称 */
function CatTag({ cat }: { cat: string }) {
  return (
    <span className="dt-cat" style={{ '--tint': catColor(cat) } as Record<string, string>}>
      <CatIcon cat={cat} size={12} />
      {cat}
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

function Panel({
  title,
  aside,
  children,
  className = '',
  onClick,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <section
      className={`dt-panel ${className} ${onClick ? 'dt-tap' : ''}`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()) : undefined}
    >
      {title && (
        <div className="dt-ph row">
          <CardTitle>{title}</CardTitle>
          {aside && <div className="dt-aside">{copyParts(aside)}</div>}
        </div>
      )}
      {children}
    </section>
  );
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
  // 最多五行（含可见年份头）才进侧栏：短记录填补摘要下方，返佣等密集记录留在走势下方，避免侧栏过长。
  // 以默认年份计数；展开全部历史时保持位置，避免交互后卡片跳栏。
  const sidebarCharges = !compact && !showForecast && detailChargeHistory(history, today).defaultRowCount <= 5;
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

  return (
    <Sheet
      bare
      label={sub.name}
      onClose={onClose}
      actions={
        <>
          {sub.url && <Act icon={<ExternalLink size={15} />} label={t('detail.action.website')} href={sub.url} round />}
          <CopyImageButton render={() => detailImage(root.current!)} />
          <Act icon={<Share size={15} />} label={t('detail.action.share')} onClick={() => setShare(true)} round />
        </>
      }
    >
      <div className={`dt ${compact ? 'compact' : ''}`} ref={root}>
        <header className="dt-head">
          <SubIcon sub={sub} size={48} proxied />
          <div className="dt-id">
            <h2>
              <span className="dt-name">{sub.name}</span>
              {st !== 'active' && st !== 'lifetime' && (
                <span className={`dt-badge dot ${TONE[st]}`}>
                  <i />
                  {t(`list.status.${st}`)}
                </span>
              )}
            </h2>
            <div className="dt-meta">
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
              <CatTag cat={sub.category} />
            </div>
          </div>
          <div className="sheet-actions dt-actions">{actions}</div>
        </header>

        {/* 无预测卡片且默认记录较少时，宽屏把扣款记录放到摘要下方；窄屏仍按数字、走势、扣款、摘要排列 */}
        <div className="dt-body">
          <div className="dt-main">
            <Kpis sub={sub} state={state} today={today} history={history} />
            {!compact && <Trendline sub={sub} state={state} today={today} history={history} />}
            {!sidebarCharges && (
              <div className={`dt-billing ${showForecast ? 'has-forecast' : ''}`}>
                {!compact && showForecast && <Upcoming sub={sub} state={state} today={today} />}
                {charges}
              </div>
            )}
          </div>
          <div className={`dt-side ${sidebarCharges ? 'has-charges' : ''}`}>
            <Outcome sub={sub} state={state} today={today} />
            <Details sub={sub} state={state} today={today} onCar={() => setCar(true)} afterSummary={sidebarCharges ? charges : undefined} />
            {!compact && <Events sub={sub} state={state} today={today} />}
          </div>
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
        {member &&
          createPortal(<MemberSheet state={state} s={sub} member={member.m} collect={member.collect} onClose={() => setMember(null)} />, document.body)}
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
    </Sheet>
  );
}

/** 正常扣款（不含退款、补差、失败，也不含记成负数的返佣、抵扣）：走势和「每笔」都只看这些 */
const regular = (h: Charge[]) => h.filter((c) => !c.kind && c.amount > 0);

/**
 * 指标卡：累计花了多少、订了多久（扣掉断档）、按实际算每月多少。
 * 累计按每笔扣款当天的汇率；合租发起人这里是付出去的全额，成员分摊在「合租」页看。
 */
function Kpis({ sub, state, today, history }: { sub: Subscription; state: AppState; today: string; history: Charge[] }) {
  const base = state.settings.baseCurrency;
  const vals = history.map((c) => chargeValue(state, c, base));
  const total = vals.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0);
  const per = regular(history)
    .map((c) => chargeValue(state, c, base))
    .filter(Number.isFinite);
  // 实际在订的天数：各段到今天（或结束日）为止，不算断档，并行的不重复计
  const served = servedTime(sub, today);
  const active = served.days;
  const gaps = served.gaps.length;
  const years = Math.floor(active / 365);
  const months = Math.floor((active % 365) / 30.44);
  const lifetime = sub.cycle.unit === 'lifetime' && phaseSubs(sub).length === 1;
  // 订了不到一个月（或只有一笔）时，「实际每月」没有意义：改用标价折算的预计每月
  const young = active < 30 || per.length < 2;
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

  return (
    <MetricCards>
      {history.length !== 1 && <Metric label={t('detail.stats.spent')} value={flow(-total, base, { compact: true })} />}
      <Metric
        label={lifetime ? t('detail.stats.owned') : t('detail.stats.subscribed')}
        value={duration}
        accessory={gaps > 0 ? <span className="dt-badge warn">{t('detail.stats.gaps', { count: gaps })}</span> : undefined}
      />
      <Metric
        label={lifetime ? t('detail.kpi.amortized') : young ? t('detail.kpi.expectedMonthly') : t('detail.stats.perMonth')}
        value={flow(-(lifetime ? total / Math.max(1, active / 30.44) : perMonth), base, { compact: true })}
        accessory={!lifetime ? <Trend pct={perTrend} /> : undefined}
      />
    </MetricCards>
  );
}

/** 月付/季付保留节奏图；稀疏扣款由摘要展示下次日期。 */
function Upcoming({ sub, state, today }: { sub: Subscription; state: AppState; today: string }) {
  const base = state.settings.baseCurrency;
  const { sparse, charges: cs } = detailForecast(sub, today);
  if (sparse || !cs.length) return null;
  const labels = Array.from({ length: 13 }, (_, i) => addMonths(`${today.slice(0, 7)}-01`, i).slice(0, 7));
  const vals = cs.map((c) => ({ c, v: chargeValue(state, c, base) }));
  const bars = labels.map((m) => vals.filter((x) => x.c.date.startsWith(m)).reduce((a, x) => a + x.v, 0));
  const total = vals.reduce((a, x) => a + x.v, 0);
  const max = Math.max(...bars, 1);
  const show = vals.slice(0, 5);
  return (
    <Panel
      className="dt-upcoming"
      title={t('detail.upcoming.title')}
      aside={Number.isFinite(total) ? t('detail.upcoming.total', { amount: flow(-total, base), count: cs.length }) : undefined}
    >
      <div className="dt-up-bars" aria-hidden="true">
        {bars.map((v, i) => (
          <div key={labels[i]} className={v ? 'on' : ''}>
            <i style={{ height: `${v ? Math.max(14, (v / max) * 100) : 6}%` }} />
            <small>{Number(labels[i].slice(5))}</small>
          </div>
        ))}
      </div>
      <div className="dt-tbl">
        {show.map(({ c, v }, i) => (
          <div className="dt-tr dt-row" key={`${c.date}-${c.sub.start}-${i}`}>
            <span className="d">
              <time>{c.date}</time>
              <small>{relDays(diffDays(today, c.date))}</small>
            </span>
            <span className={`o ${c.amount < 0 ? 'dt-in' : ''}`}>{c.currency !== base ? flow(-c.amount, c.currency) : ''}</span>
            <span className={`c ${v < 0 ? 'dt-in' : ''}`}>
              {c.currency !== base ? '≈ ' : ''}
              {Number.isFinite(v) ? flow(-v, base) : '—'}
            </span>
          </div>
        ))}
      </div>
      {cs.length > show.length && <div className="dt-up-more">{t('detail.upcoming.more', { count: cs.length - show.length })}</div>}
    </Panel>
  );
}

type Unit = 'base' | 'usd' | 'orig';
type Range = 'all' | '1y' | '6m';

/** 每笔扣款折算后的走势，和标价（按首笔汇率）对比，看出是涨价还是汇率在动 */
function Trendline({ sub, state, today, history }: { sub: Subscription; state: AppState; today: string; history: Charge[] }) {
  const base = state.settings.baseCurrency;
  const [unit, setUnit] = useState<Unit>('base');
  const [range, setRange] = useState<Range>('all');
  const reg = regular(history);
  const ccys = [...new Set(reg.map((c) => c.currency))];
  const single = ccys.length === 1;
  const u: Unit = unit === 'orig' && !single ? 'base' : unit;
  const ccy = u === 'base' ? base : u === 'usd' ? 'USD' : ccys[0];
  const lastDay = reg[reg.length - 1]?.date ?? today;
  const since = range === 'all' ? '' : addMonths(lastDay, range === '1y' ? -12 : -6);
  // 每段首笔的日期：标价按那天的汇率折算
  const firstOf = new Map<string, string>();
  for (const c of reg) if (!firstOf.has(c.sub.start)) firstOf.set(c.sub.start, c.date);
  const rows = reg
    .filter((c) => c.date >= since)
    .map((c) => {
      const v = u === 'orig' ? (c.settled ? NaN : c.amount) : chargeValue(state, c, ccy);
      const price = priceAt(c.sub, c.date);
      const list = u === 'orig' ? price : convertOn(price, c.currency, ccy, firstOf.get(c.sub.start)!, state.fxHistory, state.fx);
      return { c, date: c.date, v: Number.isFinite(v) ? v : c.amount, list: Number.isFinite(list) ? list : undefined };
    });
  if (reg.length < 2) return null;

  // 坐标轴是刻度，不是收支，不带正负号
  const fmt = (v: number) => money(v, ccy, { compact: true });
  const first = rows[0];
  const last = rows[rows.length - 1];
  const vsFirst = rows.length > 1 && first.v > 0 ? last.v / first.v - 1 : undefined;
  const lanesSrc = phaseSubs(sub);
  const laneIdx = phaseLanes(lanesSrc);
  const methodIds = [...new Set(lanesSrc.map((v) => v.methodId ?? ''))];
  const lanes: ChartLane[] = lanesSrc.map((v, i) => {
    const m = methodOf(state, v.methodId);
    return {
      key: v.start,
      from: v.start,
      to: v.end && v.end < today ? v.end : today,
      lane: laneIdx[i],
      color: LANE_COLORS[methodIds.indexOf(v.methodId ?? '') % LANE_COLORS.length],
      label: (
        <>
          {v.region && <Region cc={v.region} />}
          {money(v.price, v.currency)} {cycleLabel(v.cycle)}
        </>
      ),
      aside: m?.name,
    };
  });
  const unitOpts: Array<[Unit, string]> = [
    ['base', base],
    ...(single && ccys[0] !== base && ccys[0] !== 'USD' ? [['orig', t('detail.chart.orig')] as [Unit, string]] : []),
  ];
  const spanDays = diffDays(reg[0].date, lastDay);

  return (
    <Panel
      className="dt-chart"
      title={t('detail.chart.title', { ccy: u === 'orig' ? t('detail.chart.orig') : ccy })}
      aside={
        <>
          {unitOpts.length > 1 && <Seg small value={u} onChange={setUnit} options={unitOpts} />}
          {spanDays > 240 && (
            <Seg
              small
              value={range}
              onChange={setRange}
              options={[
                ['all', t('detail.chart.all')],
                ['1y', t('detail.chart.y1')],
                ...(spanDays > 400 ? [['6m', t('detail.chart.m6')] as [Range, string]] : []),
              ]}
            />
          )}
        </>
      }
    >
      <div className="dt-headline">
        <b>{flow(-last.v, ccy)}</b>
        <Trend pct={vsFirst} />
      </div>
      {rows.length > 1 ? (
        <ChargeChart
          points={rows}
          fmt={fmt}
          lanes={lanes}
          tip={(i) => {
            const r = rows[i];
            const c = r.c;
            const m = methodOf(state, c.sub.methodId);
            const rate = rateOn(state.fxHistory, c.currency, c.date);
            const rb = rateOn(state.fxHistory, base, c.date);
            return (
              <>
                <div className="cc-tip-h">
                  <b>{cnDateFull(c.date)}</b>
                  <span>{weekdayOf(c.date)}</span>
                </div>
                <div className="cc-tip-r">
                  <i className="k-v" />
                  <span>{t('detail.chart.perCharge')}</span>
                  <b>{flow(-r.v, ccy)}</b>
                </div>
                {r.list != null && (
                  <div className="cc-tip-r">
                    <i className="k-l" />
                    <span>{u === 'orig' ? t('detail.chart.listOrig') : t('detail.chart.list')}</span>
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
                    c.currency !== base && rate && rb && `\n1 ${c.currency} = ${((1 / rate.rate) * rb.rate).toFixed(c.currency === 'NGN' ? 5 : 4)} ${base}`,
                  )}
                </div>
              </>
            );
          }}
        />
      ) : (
        <div className="dt-empty">{t('detail.chart.few')}</div>
      )}
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
      sub: sub.share.role === 'owner' ? t('detail.share.owner', { count: sub.share.members.length + 1, seats: sub.share.seats }) : t('detail.share.member'),
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
  if (sub.end && !sub.stop)
    evs.push({ date: sub.end, title: sub.end <= today ? t('detail.ev.ended') : t('detail.ev.ending'), tone: 'ink', future: sub.end > today });
  // 一条时间线，新的在上
  evs.sort((a, b) => b.date.localeCompare(a.date));

  // 只有「开始订阅」一条时，没什么可看的
  if (evs.length < 2) return null;
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
            <div>
              <b>{e.title}</b>
              {e.sub && <small style={e.tone === 'ok' ? { color: 'var(--dt-ok)' } : undefined}>{e.sub}</small>}
            </div>
            <time>{e.date}</time>
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

/** 合租卡片共用的头像组；详情只放大尺寸、减小重叠，空位用文字提示。 */
function Seats({ sub, state, today }: { sub: Subscription; state: AppState; today: string }) {
  const share = sub.share!;
  const live = share.members.filter((m) => memberAboard(m, today));
  const free = Math.max(0, share.seats - live.length - 1);
  return (
    <div className="dt-seats">
      <ShareAvatars sub={sub} state={state} today={today} size={36} overlap={2} />
      <small>{free ? t('detail.share.seatsLeft', { count: free, seats: share.seats }) : t('detail.share.seatsFull', { seats: share.seats })}</small>
    </div>
  );
}

function Prop({ k, children, hint }: { k: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="dt-prop">
      <dt>{k}</dt>
      <dd>
        {children}
        {hint && <small>{copyParts(hint)}</small>}
      </dd>
    </div>
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
        return (
          <section key={phase.start} className={`dt-panel dt-outcome ${sm.kind === 'terminate' ? 'bad' : ''} ${sm.unusedValue > 0 ? 'loss' : ''}`}>
            <div className="dt-ph row">
              <CardTitle>{t(sm.kind === 'terminate' ? 'core.stop.terminate' : 'report.stops.cancel')}</CardTitle>
              {sm.kind === 'terminate' && sm.reason && <div className="dt-aside">{sm.reason}</div>}
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
            <dl className="dt-props">
              <Prop k={t('core.stop.date')}>{cnDateFull(sm.date)}</Prop>
              <Prop k={t('detail.stop.paidThrough')}>{cnDateFull(sm.paidThrough)}</Prop>
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

/** 详情：金额、周期、分类、支付方式、日期等，以及并行、计划变更、优惠、合租、提醒和备注 */
function Details({
  sub,
  state,
  today,
  onCar,
  afterSummary,
}: {
  sub: Subscription;
  state: AppState;
  today: string;
  onCar: () => void;
  afterSummary?: ReactNode;
}) {
  const st = effectiveStatus(sub, today);
  const cur = currentPhase(sub, today);
  const up = upcomingPhase(sub, today);
  const ro = !!state.readonly;

  const nextBill = detailForecast(sub, today).charges[0];
  const renewal = renewalDates(sub, addDays(today, 1));
  const method = methodOf(state, cur.methodId);
  const parallel = sub.phases?.length ? activePhases(sub, today).filter((v) => v.start !== cur.start) : [];
  const dues = memberDues(sub, today, state.settings.collectCurrency ?? state.settings.baseCurrency, state);
  return (
    <>
      <Panel title={t('detail.summary')}>
        <dl className="dt-props">
          {/* 金额、周期、分类、地区已在标题下方，这里不再重复 */}
          <Prop k={t('detail.field.method')}>
            <PayBadge m={method} />
          </Prop>
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
          {/* 买断的开始日就是扣款记录里那一笔，不再重复 */}
          {!(sub.cycle.unit === 'lifetime' && phaseSubs(sub).length === 1) && <Prop k={t('detail.field.start')}>{cnDateFull(sub.start)}</Prop>}
          {nextBill && (
            <Prop k={t('detail.ev.next')} hint={relDays(diffDays(today, nextBill.date))}>
              {cnDateFull(nextBill.date)}
            </Prop>
          )}
          {/* 没有提前扣款时，服务到期就是下次扣款那天，不重复显示 */}
          {renewal.serviceExpires && !sub.end && renewal.serviceExpires !== nextBill?.date && (
            <Prop k={t('detail.field.expires')} hint={relDays(diffDays(today, renewal.serviceExpires))}>
              {cnDateFull(renewal.serviceExpires)}
            </Prop>
          )}
          {renewal.cancelBy && (
            <Prop k={t('core.renewal.cancelBy')} hint={relDays(diffDays(today, renewal.cancelBy))}>
              {cnDateFull(renewal.cancelBy)}
            </Prop>
          )}
          {sub.end && !sub.stop && (
            <Prop k={['ended', 'terminated'].includes(st) ? t('detail.field.endedOn') : t('list.status.ending')}>{cnDateFull(sub.end)}</Prop>
          )}
          {sub.trialEnd && <Prop k={t('detail.field.trialEnd')}>{cnDateFull(sub.trialEnd)}</Prop>}
        </dl>
        {sub.notes && (
          <div className="dt-note">
            <StickyNote size={14} />
            <p>{sub.notes}</p>
          </div>
        )}
      </Panel>

      {afterSummary}
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
        <Panel title={up.planned ? t('detail.up.planned') : st === 'upcoming' ? t('detail.up.starting') : t('detail.up.changing')}>
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
          {up.planned && !ro && (
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
          )}
        </Panel>
      )}

      {sub.intro && (
        <Panel title={t('detail.intro.title')}>
          <dl className="dt-props one">
            <Prop k={t('detail.intro.price')}>{money(sub.intro.price, sub.currency)}</Prop>
            <Prop k={t('detail.intro.until')}>{cnDateFull(sub.intro.until)}</Prop>
            <Prop k={t('detail.intro.then')}>{money(sub.price, sub.currency)}</Prop>
          </dl>
        </Panel>
      )}

      {sub.share && (
        <Panel
          title={
            sub.share.role === 'owner' ? t('detail.share.owner', { count: sub.share.members.length + 1, seats: sub.share.seats }) : t('detail.share.member')
          }
          // 我发起的合租：整块点开合租弹窗，看收付明细
          onClick={sub.share.role === 'owner' ? onCar : undefined}
          aside={sub.share.role === 'owner' ? <span className="dt-more">{t('detail.share.open')} ›</span> : undefined}
        >
          {sub.share.role === 'owner' && <Seats sub={sub} state={state} today={today} />}
          <dl className="dt-props one">
            {sub.share.role === 'member' && <Prop k={t('detail.share.payTo')}>{sub.share.ownerName ?? t('detail.share.host')}</Prop>}
            {sub.share.role === 'owner' && (
              <>
                {(() => {
                  // 成员交的比总价还多时，不显示负的份额，直接说多收了多少
                  const mine = sub.price - sub.share.members.reduce((a, m) => a + (m.exempt || !memberAboard(m, today) ? 0 : m.share), 0);
                  return mine >= 0 ? (
                    <Prop k={t('detail.share.myShare')}>{money(mine, sub.currency)}</Prop>
                  ) : (
                    <Prop k={t('detail.share.myShare')}>
                      <span className="dt-in">{t('detail.share.surplus', { amount: flow(-mine, sub.currency) })}</span>
                    </Prop>
                  );
                })()}
                {dues.map((d) => (
                  <Prop
                    key={d.member.id}
                    k={d.member.name || t('detail.share.unnamed')}
                    hint={d.member.paidUntil ? t('detail.share.paidUntil', { date: d.member.paidUntil }) : t('detail.share.unpaid')}
                  >
                    {d.periodsOwed > 0 ? (
                      <span className="dt-owed">{t('detail.share.owed', { amount: money(d.owed, d.currency) })}</span>
                    ) : (
                      <span className="dt-settled">{t('detail.share.settled')}</span>
                    )}
                  </Prop>
                ))}
              </>
            )}
          </dl>
        </Panel>
      )}
    </>
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
  const [all, setAll] = useState(false);
  const multi = phaseSubs(sub).length > 1;
  const rows = history.map((c) => ({ c, b: chargeValue(state, c, base) })).reverse();
  const thisYear = today.slice(0, 4);
  const { defaultYear, grouped } = detailChargeHistory(history, today);
  const shown = all ? rows : rows.filter((r) => r.c.date.startsWith(defaultYear));
  const years = [...new Set(shown.map((r) => r.c.date.slice(0, 4)))];
  return (
    <Panel
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
      {history.length > 0 && (
        <div className="dt-tbl">
          {years.map((y) => {
            const ys = rows.filter((r) => r.c.date.startsWith(y));
            const total = ys.reduce((a, r) => a + r.b, 0);
            return (
              <Fragment key={y}>
                {grouped && (
                  <div className="dt-grp">
                    <span>
                      <b>{y}</b>
                      {t('detail.stats.count', { count: ys.length })}
                    </span>
                    <span className={total < 0 ? 'dt-in' : undefined}>{Number.isFinite(total) ? flow(-total, base) : '—'}</span>
                  </div>
                )}
                {shown
                  .filter((r) => r.c.date.startsWith(y))
                  .map(({ c, b }, i) => (
                    <div
                      key={`${c.date}-${c.sub.start}-${i}`}
                      className={`dt-tr dt-row ${onRow ? 'edit' : ''} ${c.kind ?? ''}`}
                      onClick={() => onRow?.(c)}
                      title={c.note}
                    >
                      {/* 分年时组头已有年份；不分组且不是今年的（如多年前的买断）要带上年份 */}
                      <span className="d">
                        <time dateTime={c.date}>{grouped || c.date.startsWith(thisYear) ? c.date.slice(5) : c.date}</time>
                        <small>{relDays(diffDays(today, c.date))}</small>
                      </span>
                      <span className="o">
                        {c.currency !== base || c.settled ? flow(-c.amount, c.currency) : ''}
                        {c.kind && <em className={`dt-kind ${c.kind}`}>{t(`detail.charges.kind.${c.kind}`)}</em>}
                        {multi && c.sub.region && !c.kind && <em className="dt-kind">{c.sub.region}</em>}
                      </span>
                      <span className="c">{Number.isFinite(b) ? flow(-b, base) : '—'}</span>
                    </div>
                  ))}
              </Fragment>
            );
          })}
        </div>
      )}
      {grouped && (
        <div className="dt-tfoot">
          <button className="dt-link" onClick={() => setAll(!all)} aria-expanded={all}>
            {all ? t('report.checkup.less') : t('detail.charges.all', { count: history.length })}
          </button>
        </div>
      )}
    </Panel>
  );
}
