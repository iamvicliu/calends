import { StopPanel } from '../components/StopPanel.tsx';
import { base } from '../base.ts';
import { createPortal } from 'react-dom';
import { Fragment, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, Copy, ExternalLink, X, Pause, Pencil, Play, Plus, Settings2, Share, StickyNote, TrendingDown, TrendingUp } from 'lucide-react';
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
import { chargeValue, convertOn, rateOn } from '../../../shared/fx.ts';
import type { AppState, Payment, ShareMember, Subscription } from '../../../shared/types.ts';
import { CarSheet } from './Carpool.tsx';
import { carLedger, MemberSheet } from './Members.tsx';
import { PaymentSheet } from './PaymentSheet.tsx';
import { CatIcon, PayBadge, Seg, Sheet, SubIcon } from '../components/ui.tsx';
import { catColor, presetCat, toBase } from '../derive.ts';
import { FLAGS } from '../display.ts';
import { run, saveSub, toast } from '../store.ts';
import { snapshot } from '../snapshot.ts';
import { SubShare } from './SubShare.tsx';
import { confirmPlan, dropPlan, reactivate } from '../../../shared/phases.ts';
import { t } from '../../../shared/i18n.ts';
import { useMoneyPair } from '../components/MoneyPair.tsx';
import { ChargeChart, type ChartLane } from './DetailChart.tsx';
import './detail.css';

/** 状态角标的色调；文案见 list.status.* */
const TONE: Record<string, string> = {
  upcoming: 'acc',
  active: 'ok',
  trial: 'ok',
  paused: '',
  ending: 'warn',
  ended: '',
  terminated: 'bad',
  lifetime: 'acc',
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
      {flat ? '0%' : `${pct > 0 ? '+' : '−'}${(Math.abs(pct) * 100).toFixed(Math.abs(pct) < 0.1 ? 1 : 0)}%`}
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
 * 窄屏：一排等宽的大圆按钮，图标下面写名称，方便手指点
 */
function Act({
  icon,
  label,
  onClick,
  href,
  round,
  desk,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  round?: boolean;
  desk?: boolean;
}) {
  const inner = (
    <>
      <i className="dt-act-i">{icon}</i>
      <span className="dt-act-l">{label}</span>
    </>
  );
  const cls = `dt-act ${round ? 'round' : ''} ${desk ? 'desk' : ''}`;
  return href ? (
    <a className={cls} href={href} target="_blank" rel="noreferrer" title={label} aria-label={label}>
      {inner}
    </a>
  ) : (
    <button className={cls} onClick={onClick} title={label} aria-label={label}>
      {inner}
    </button>
  );
}

/** 把详情复制成图片：和弹窗一样的圆角，圆角外透明；去掉顶部按钮 */
function copyImage(el: HTMLElement) {
  const sheet = el.closest<HTMLElement>('.sheet') ?? el;
  const blob = snapshot(el, {
    radius: getComputedStyle(sheet).borderRadius,
    filter: (n) => !(n instanceof Element && n.matches('.dt-actions, .dt-close, .dt-add')),
  }).then((b) => b!);
  // Safari 要求在点击的同一个调用里拿到 ClipboardItem，所以传 Promise 进去
  void run(() => navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]), t('detail.toast.imageCopied'));
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
        <div className="dt-ph">
          <h3>{title}</h3>
          {aside && <div className="dt-aside">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Detail({ sub, state, today, onEdit, onClose }: { sub: Subscription; state: AppState; today: string; onEdit: () => void; onClose: () => void }) {
  const pair = useMoneyPair(state);
  const st = effectiveStatus(sub, today);
  const next = nextCharge(sub, today);
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
  const big = pair(nowPrice, cur.currency, { compact: false, plain: true });

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
  // 买断（一段、不合租）没有走势、未来扣款和历程可看：换成窄的单列，不留半屏空白
  const compact = sub.cycle.unit === 'lifetime' && phaseSubs(sub).length === 1 && !sub.share;
  const actions = (
    <>
      {!ro && <Act icon={<Pencil size={15} />} label={t('detail.action.edit')} onClick={onEdit} />}
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
      {sub.url && <Act icon={<ExternalLink size={15} />} label={t('detail.action.website')} href={sub.url} round />}
      {typeof ClipboardItem !== 'undefined' && (
        <Act icon={<Copy size={15} />} label={t('detail.action.copyImage')} onClick={() => copyImage(root.current!)} round desk />
      )}
      <Act icon={<Share size={15} />} label={t('detail.action.share')} onClick={() => setShare(true)} round />
    </>
  );

  return (
    <div className={`dt ${compact ? 'compact' : ''}`} ref={root}>
      <header className="dt-head">
        <SubIcon sub={sub} size={48} />
        <div className="dt-id">
          <h2>
            <span className="dt-name">{sub.name}</span>
            <span className={`dt-badge dot ${TONE[st]}`}>
              <i />
              {t(`list.status.${st}`)}
            </span>
          </h2>
          <div className="dt-meta">
            <b>
              {big.main} {cycleLabel(cur.cycle)}
            </b>
            {big.alt && (
              <>
                <s>·</s>
                {big.alt}
              </>
            )}
            {cur.region && (
              <>
                <s>·</s>
                <Region cc={cur.region} />
              </>
            )}
            <s>·</s>
            <CatTag cat={sub.category} />
          </div>
        </div>
        <div className="dt-actions">{actions}</div>
        <button className="dt-btn icon dt-close" onClick={onClose} title={t('ui.close')} aria-label={t('ui.close')}>
          <X size={17} />
        </button>
      </header>

      {/* 主栏放要扫读的数字、走势和扣款；右侧窄栏放属性与历程（参考 Stripe、Linear 的详情页） */}
      <div className="dt-body">
        <div className="dt-main">
          <Kpis sub={sub} state={state} today={today} history={history} />
          {!compact && <Trendline sub={sub} state={state} today={today} history={history} />}
          {!compact && <Upcoming sub={sub} state={state} today={today} />}
          <Charges sub={sub} state={state} history={history} onRow={editPay} onAdd={ro ? undefined : () => setPay({})} />
        </div>
        <div className="dt-side">
          <Outcome sub={sub} state={state} today={today} />
          <Details sub={sub} state={state} today={today} onCar={() => setCar(true)} />
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
                run(async () => {
                  await saveSub(next);
                  setStopping(false);
                })
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

/** 历程里停止那一条只写原因和损失，完整信息在顶部的停止卡片 */
const stopLine = (v: Subscription, state: AppState, today: string) => {
  const sm = state.readonly ? undefined : stopSummary(v, today);
  if (!sm) return undefined;
  return (
    [sm.kind === 'terminate' ? sm.reason : '', sm.unusedValue > 0 ? `${t('core.stop.lossTitle')} ${flow(-sm.unusedValue, v.currency)}` : '']
      .filter(Boolean)
      .join(' · ') || undefined
  );
};

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
    <div className="dt-kpis">
      <div className="dt-panel dt-kpi">
        <div className="dt-kpi-top">
          <small>{t('detail.stats.spent')}</small>
          <span className="dt-badge">{t('detail.stats.count', { count: history.length })}</span>
        </div>
        <div className="dt-kpi-val">
          <b>{flow(-total, base, { compact: true })}</b>
        </div>
      </div>
      <div className="dt-panel dt-kpi">
        <div className="dt-kpi-top">
          <small>{lifetime ? t('detail.stats.owned') : t('detail.stats.subscribed')}</small>
          {gaps > 0 && <span className="dt-badge warn">{t('detail.stats.gaps', { count: gaps })}</span>}
        </div>
        <div className="dt-kpi-val">
          <b>{duration}</b>
        </div>
      </div>
      <div className="dt-panel dt-kpi">
        <div className="dt-kpi-top">
          <small>{lifetime ? t('detail.kpi.amortized') : young ? t('detail.kpi.expectedMonthly') : t('detail.stats.perMonth')}</small>
          {!lifetime && <Trend pct={perTrend} />}
        </div>
        <div className="dt-kpi-val">
          {/* 买断：花的钱摊到拥有的每个月，越用越便宜 */}
          <b>{flow(-(lifetime ? total / Math.max(1, active / 30.44) : perMonth), base, { compact: true })}</b>
        </div>
      </div>
    </div>
  );
}

/**
 * 未来 12 个月的扣款：12 根小柱看节奏，下面列出最近几笔（日期、距今、原币与折合），合计一年大约多少。
 * 新订阅还没有历史时，这块是左栏的主要内容。
 */
function Upcoming({ sub, state, today }: { sub: Subscription; state: AppState; today: string }) {
  const base = state.settings.baseCurrency;
  const end = addMonths(today, 12);
  const cs = chargesBetween(sub, addDays(today, 1), end, today).filter((c) => !c.kind);
  if (['ended', 'terminated'].includes(effectiveStatus(sub, today)) || sub.cycle.unit === 'lifetime') return null;
  // 本月剩下的 + 往后 12 个月，共 13 格：年付订阅一年后的那笔也落在格子里
  const labels = Array.from({ length: 13 }, (_, i) => addMonths(`${today.slice(0, 7)}-01`, i).slice(0, 7));
  const vals = cs.map((c) => ({ c, v: chargeValue(state, c, base) }));
  const bars = labels.map((m) => vals.filter((x) => x.c.date.startsWith(m)).reduce((a, x) => a + (x.v || 0), 0));
  const total = vals.reduce((a, x) => a + (x.v || 0), 0);
  const max = Math.max(...bars, 1);
  const show = vals.slice(0, 5);
  return (
    <Panel
      className="dt-upcoming"
      title={t('detail.upcoming.title')}
      aside={cs.length ? t('detail.upcoming.total', { amount: flow(-total, base), count: cs.length }) : undefined}
    >
      {cs.length > 0 ? (
        <>
          <div className="dt-up-bars" aria-hidden="true">
            {bars.map((v, i) => (
              <div key={labels[i]} className={v ? 'on' : ''}>
                <i style={{ height: `${v ? Math.max(14, (v / max) * 100) : 6}%` }} />
                <small>{Number(labels[i].slice(5))}</small>
              </div>
            ))}
          </div>
          <ul className="dt-up-list">
            {show.map(({ c, v }) => (
              <li key={`${c.date}-${c.sub.start}`}>
                <span className="d">
                  <b>{cnDateFull(c.date)}</b>
                  <small>{relDays(diffDays(today, c.date))}</small>
                </span>
                <span className="a">
                  <b className={c.amount < 0 ? 'dt-in' : undefined}>{flow(-c.amount, c.currency)}</b>
                  {c.currency !== base && Number.isFinite(v) && <small style={v < 0 ? { color: 'var(--dt-ok)' } : undefined}>≈ {flow(-v, base)}</small>}
                </span>
              </li>
            ))}
          </ul>
          {cs.length > show.length && <div className="dt-up-more">{t('detail.upcoming.more', { count: cs.length - show.length })}</div>}
        </>
      ) : (
        <div className="dt-empty">{t('detail.upcoming.none')}</div>
      )}
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
                  {c.currency !== base && rate && rb && ` · 1 ${c.currency} = ${((1 / rate.rate) * rb.rate).toFixed(c.currency === 'NGN' ? 5 : 4)} ${base}`}
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
        {[`${money(v.price, v.currency)} ${cycleLabel(v.cycle)}`, m?.name].filter(Boolean).join(' · ')}
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
    const hist = (v.priceHistory ?? []).slice().sort((a, b) => a.from.localeCompare(b.from));
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
  const nx = nextCharge(sub, today);
  if (nx && nx > today && !['ended', 'terminated'].includes(effectiveStatus(sub, today)))
    evs.push({
      date: nx,
      title: t('detail.ev.next'),
      sub: `${flow(-priceAt(sub, nx), currentPhase(sub, nx).currency)} · ${relDays(diffDays(today, nx))}`,
      future: true,
    });
  const up = upcomingPhase(sub, today);
  if (up?.planned) evs.push({ date: up.start, title: t('detail.up.planned'), sub: plan(up), future: true });
  for (const v of vs) {
    if (v.stop)
      evs.push({
        date: v.stop.date,
        title: t(v.stop.kind === 'terminate' ? 'core.stop.terminate' : 'core.stop.cancel'),
        sub: stopLine(v, state, today),
        tone: v.stop.kind === 'terminate' ? 'bad' : 'ink',
      });
    if (!state.readonly)
      for (const p of v.payments ?? [])
        if (p.kind === 'refund')
          evs.push({
            date: p.date,
            title: t('editor.payment.kind.refund'),
            sub: flow(-p.amount, v.currency),
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
      aside={`${t('detail.ev.phases', { count: vs.length })} · ${gaps ? t('detail.stats.gaps', { count: gaps }) : t('detail.kpi.noGaps')}`}
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

/** 合租座位：我、在车的成员、空位各一格 */
function Seats({ share, today }: { share: NonNullable<Subscription['share']>; today: string }) {
  const live = share.members.filter((m) => memberAboard(m, today));
  const free = Math.max(0, share.seats - live.length - 1);
  return (
    <div className="dt-seats">
      <div className="dt-seat-row">
        <span className="dt-seat me">{t('detail.share.me')}</span>
        {live.map((m) => (
          <span key={m.id} className={`dt-seat ${m.exempt ? 'exempt' : 'taken'}`} title={m.name}>
            {[...m.name][0]?.toUpperCase()}
          </span>
        ))}
        {Array.from({ length: free }, (_, i) => (
          <span key={`f${i}`} className="dt-seat free" />
        ))}
      </div>
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
        {hint && <small>{hint}</small>}
      </dd>
    </div>
  );
}

/** 停止卡片：放在顶部，一句话说清怎么停的、退了多少、亏了多少；每个停止阶段各一张 */
function Outcome({ sub, state, today }: { sub: Subscription; state: AppState; today: string }) {
  const stopped = phaseSubs(sub).filter((phase) => phase.stop);
  const base = state.settings.baseCurrency;
  if (state.readonly || !stopped.length) return null;
  return (
    <>
      {stopped.map((phase) => {
        const sm = stopSummary(phase, today)!;
        return (
          <section key={phase.start} className={`dt-panel dt-outcome ${sm.kind === 'terminate' ? 'bad' : ''} ${sm.unusedValue > 0 ? 'loss' : ''}`}>
            <div className="dt-ph">
              <h3>{t(sm.kind === 'terminate' ? 'core.stop.terminate' : 'report.stops.cancel')}</h3>
              {sm.kind === 'terminate' && sm.reason && <div className="dt-aside">{sm.reason}</div>}
            </div>
            {sm.unusedValue > 0 && (
              <div className="dt-oc-loss">
                <b>{flow(-sm.unusedValue, phase.currency)}</b>
                <small>
                  {[
                    t('core.stop.lossTitle'),
                    t('core.stop.lossDays', { count: sm.wastedDays }),
                    phase.currency !== base ? `≈ ${flow(-toBase(state, sm.unusedValue, phase.currency), base)}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </div>
            )}
            <dl className="dt-props">
              <Prop k={t('core.stop.date')}>{cnDateFull(sm.date)}</Prop>
              <Prop k={t('detail.stop.paidThrough')}>{cnDateFull(sm.paidThrough)}</Prop>
              <Prop k={t('core.stop.refundAmount')} hint={sm.refundStatus === 'full' ? t('core.stop.fullyRefunded') : undefined}>
                {sm.refunded > 0 ? <span className="dt-in">{flow(sm.refunded, phase.currency)}</span> : t('core.stop.refundNo')}
              </Prop>
            </dl>
          </section>
        );
      })}
    </>
  );
}

/** 详情：金额、周期、分类、支付方式、日期等，以及并行、计划变更、优惠、合租、提醒和备注 */
function Details({ sub, state, today, onCar }: { sub: Subscription; state: AppState; today: string; onCar: () => void }) {
  const st = effectiveStatus(sub, today);
  const cur = currentPhase(sub, today);
  const up = upcomingPhase(sub, today);
  const ro = !!state.readonly;
  const next = nextCharge(sub, today);
  const method = methodOf(state, cur.methodId);
  const parallel = sub.phases?.length ? activePhases(sub, today).filter((v) => v.start !== cur.start) : [];
  const dues = memberDues(sub, today, state.settings.collectCurrency ?? state.settings.baseCurrency);
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
          <Prop k={t('detail.field.start')}>{cnDateFull(sub.start)}</Prop>
          {next && (
            <Prop k={t('detail.field.next')} hint={relDays(diffDays(today, next))}>
              {cnDateFull(next)}
            </Prop>
          )}
          {sub.expires && !sub.end && (
            <Prop k={t('detail.field.expires')} hint={next && next < sub.expires ? t('detail.field.expiresHint') : relDays(diffDays(today, sub.expires))}>
              {cnDateFull(sub.expires)}
            </Prop>
          )}
          {sub.end && <Prop k={['ended', 'terminated'].includes(st) ? t('detail.field.endedOn') : t('list.status.ending')}>{cnDateFull(sub.end)}</Prop>}
          {sub.trialEnd && <Prop k={t('detail.field.trialEnd')}>{cnDateFull(sub.trialEnd)}</Prop>}
        </dl>
        {sub.notes && (
          <div className="dt-note">
            <StickyNote size={14} />
            <p>{sub.notes}</p>
          </div>
        )}
      </Panel>

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
                {money(v.price, v.currency)} · {cycleLabel(v.cycle)}
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
              {money(up.price, up.currency)} · {cycleLabel(up.cycle)}
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
          {sub.share.role === 'owner' && <Seats share={sub.share} today={today} />}
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
  history,
  onRow,
  onAdd,
}: {
  sub: Subscription;
  state: AppState;
  history: Charge[];
  onRow: (c: Charge) => void;
  onAdd?: () => void;
}) {
  const base = state.settings.baseCurrency;
  const [all, setAll] = useState(false);
  const multi = phaseSubs(sub).length > 1;
  const rows = history.map((c) => ({ c, b: chargeValue(state, c, base) })).reverse();
  const shown = all ? rows : rows.slice(0, 24);
  const years = [...new Set(shown.map((r) => r.c.date.slice(0, 4)))];
  // 只有一年时不分组，标题里已经有笔数
  const grouped = new Set(rows.map((r) => r.c.date.slice(0, 4))).size > 1;
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
            return (
              <Fragment key={y}>
                {grouped && (
                  <div className="dt-grp">
                    <span>
                      <b>{y}</b>
                      {t('detail.stats.count', { count: ys.length })}
                    </span>
                    <span className={ys.reduce((a, r) => a + (r.b || 0), 0) < 0 ? 'dt-in' : undefined}>
                      {flow(-ys.reduce((a, r) => a + (r.b || 0), 0), base)}
                    </span>
                  </div>
                )}
                {shown
                  .filter((r) => r.c.date.startsWith(y))
                  .map(({ c, b }, i) => (
                    <div
                      key={`${c.date}-${c.sub.start}-${i}`}
                      className={`dt-tr dt-row ${onAdd ? 'edit' : ''} ${c.kind ?? ''}`}
                      onClick={() => onAdd && onRow(c)}
                      title={c.note}
                    >
                      <span className="d">{c.date.slice(5)}</span>
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
      {rows.length > 24 && (
        <div className="dt-tfoot">
          <button className="dt-link" onClick={() => setAll(!all)}>
            {all ? t('detail.charges.recentN', { count: 24 }) : t('detail.charges.all', { count: history.length })}
          </button>
        </div>
      )}
    </Panel>
  );
}
