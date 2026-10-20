import { createPortal } from 'preact/compat';
import { useState } from 'preact/hooks';
import { chargesBetween, convert, currentPhase, phaseSubs, cycleLabel, diffDays, effectiveStatus, memberDues, monthlyGross, nextCharge, priceAt, upcomingPhase } from '../../shared/billing.ts';
import { cnDate, cnDateFull, flag, money, relDays } from '../../shared/format.ts';
import { chargeValue, rateOn } from '../../shared/fx.ts';
import type { AppState, Payment, Subscription } from '../../shared/types.ts';
import { PaymentSheet } from './PaymentSheet.tsx';
import { History } from '../components/History.tsx';
import { Amount, CatChip, Cell, Group, Icon, PayBadge, SubIcon } from '../components/ui.tsx';
import { catColor, domainOf } from '../derive.ts';
import { run, saveSub } from '../store.ts';
import { ChangeNote } from './List.tsx';
import { MiniGantt } from './Gantt.tsx';
import { SubShare } from './SubShare.tsx';
import { confirmPlan, dropPlan } from '../../shared/phases.ts';

const STATUS: Record<string, [string, string]> = {
  upcoming: ['未开始', 'blue'],
  active: ['计费中', 'green'],
  trial: ['试用中', 'green'],
  paused: ['已暂停', ''],
  ending: ['到期不续', 'orange'],
  ended: ['已归档', ''],
  lifetime: ['买断', 'blue'],
};

export function Detail({ sub, state, today, onEdit }: { sub: Subscription; state: AppState; today: string; onEdit: () => void }) {
  const base = state.settings.baseCurrency;
  const st = effectiveStatus(sub, today);
  const next = nextCharge(sub, today);
  // 显示今天生效的那一段（换区前仍是旧区的价格与支付方式），未来的变更单独列出
  const cur = currentPhase(sub, today);
  const up = upcomingPhase(sub, today);
  const method = state.methods.find((m) => m.id === cur.methodId);
  const upMethod = up && state.methods.find((m) => m.id === up.methodId);
  const history = chargesBetween(sub, sub.start, today, today);
  const total = history.reduce((a, c) => a + chargeValue(state, c), 0);
  const totalCny = history.reduce((a, c) => a + chargeValue(state, c, 'CNY'), 0);
  const totalUsd = history.reduce((a, c) => a + chargeValue(state, c, 'USD'), 0);
  const monthly = monthlyGross(sub, today);
  const remind = sub.remindDays ?? state.settings.remindDays;
  const icon = sub.category === '域名' ? undefined : sub.icon?.startsWith('http') ? sub.icon : domainOf(sub.url) ? `https://www.google.com/s2/favicons?domain=${domainOf(sub.url)}&sz=128` : undefined;
  const [label, tone] = STATUS[st];
  const ro = !!state.readonly;
  const dues = memberDues(sub, today);
  const [allCharges, setAllCharges] = useState(false);
  const [pay, setPay] = useState<{ pay?: Payment; index?: number } | null>(null);
  const [share, setShare] = useState(false);

  const actions = (
    <>
          {!ro && (
            <button class="btn" onClick={onEdit}>
              <Icon name="edit" /> 编辑
            </button>
          )}
          {!ro && sub.cycle.unit !== 'lifetime' && st !== 'ended' && (
            <button
              class="btn"
              onClick={() =>
                run(
                  () => saveSub(sub.status === 'paused' ? { ...sub, status: 'active', pausedAt: undefined } : { ...sub, status: 'paused', pausedAt: today }),
                  sub.status === 'paused' ? '已恢复计费' : '已暂停，不再推算后续扣款',
                )
              }
            >
              <Icon name={sub.status === 'paused' ? 'play' : 'pause'} /> {sub.status === 'paused' ? '恢复' : '暂停'}
            </button>
          )}
          {sub.manageUrl && (
            <a class="btn" href={sub.manageUrl} target="_blank" rel="noreferrer">
              <Icon name="gear" /> 管理
            </a>
          )}
          {sub.url && (
            <a class="btn" href={sub.url} target="_blank" rel="noreferrer">
              <Icon name="link" /> 官网
            </a>
          )}
      <button class="btn" onClick={() => setShare(true)}>
        <Icon name="share" /> 分享
      </button>
    </>
  );
  const story = !!(sub.phases?.length || (sub.priceHistory?.length ?? 0) > 1);

  return (
    <div class="detail">
      {/* 宽屏：操作按钮放在右上角 */}
      <div class="d-top">{actions}</div>
      <div class="d-side">
      <div class="d-hero">
        {icon ? <div class="d-hero-bg" style={{ backgroundImage: `url("${icon}")` }} /> : <div class="d-hero-bg tint" style={{ '--tint': catColor(sub.category) } as Record<string, string>} />}
        <SubIcon sub={sub} size={72} />
        <h2>
          {sub.name}
          <span class={`badge ${tone} d-status`}>{label}</span>
        </h2>
        <div class="price">
          <Amount value={next && (!cur.end || next < cur.end) ? priceAt(sub, next) : cur.price} ccy={cur.currency} />
          {cycleLabel(cur.cycle)}
          {cur.currency !== base && ` · ≈ ${money(convert(cur.price, cur.currency, base, state.fx), base)}`}
        </div>
        {up && <ChangeNote cur={cur} up={up} st={st} today={today} state={state} />}
        <div class="d-actions">{actions}</div>
      </div>
      <Stats sub={sub} state={state} today={today} total={total} count={history.length} alt={base === 'CNY' ? money(totalUsd, 'USD', { compact: true }) : base === 'USD' ? money(totalCny, 'CNY', { compact: true }) : undefined} />
      {story && (
        <div class="d-mini">
          <div class="d-mini-h">历程</div>
          <MiniGantt sub={sub} state={state} today={today} />
        </div>
      )}
      </div>
      <div class="d-body">
        <Group title="摘要">
          <Cell label="金额">{money(cur.price, cur.currency)}</Cell>
          <Cell label="计费周期">{cycleLabel(cur.cycle)}</Cell>
          {cur.cycle.unit !== 'lifetime' && <Cell label="月均 / 年均">{`${money(monthly, cur.currency)} / ${money(monthly * 12, cur.currency, { compact: true })}`}</Cell>}
          <Cell label="分类">
            <CatChip cat={sub.category} />
          </Cell>
          <Cell label="支付方式">
            <PayBadge m={method} />
          </Cell>
          <Cell label="开始日期">{cnDateFull(sub.start)}</Cell>
          {next && (
            <Cell label="下次到期">
              {cnDateFull(next)} · {relDays(diffDays(today, next))}
            </Cell>
          )}
          {sub.expires && !sub.end && (
            <Cell label="服务到期" sub={next && next < sub.expires ? '自动续费会在到期前扣款' : undefined}>
              {cnDateFull(sub.expires)} · {relDays(diffDays(today, sub.expires))}
            </Cell>
          )}
          {sub.end && <Cell label={st === 'ended' ? '结束于' : '到期不续'}>{cnDateFull(sub.end)}</Cell>}
          {sub.trialEnd && <Cell label="试用截止">{cnDateFull(sub.trialEnd)}</Cell>}
          {cur.region && <Cell label="地区">{`${flag(cur.region)} ${cur.region}`.trim()}</Cell>}
        </Group>


        {up && (
          <Group
            title={up.planned ? '计划变更 · 还没确定' : st === 'upcoming' ? '即将开始' : '即将变更'}
          >
            <Cell label="生效日期">
              {cnDateFull(up.start)} · {relDays(diffDays(today, up.start))}
            </Cell>
            {up.region !== cur.region && up.region && <Cell label="地区">{`${cur.region && st !== 'upcoming' ? `${flag(cur.region)} ${cur.region} → ` : ''}${flag(up.region)} ${up.region}`}</Cell>}
            <Cell label="金额">
              {st !== 'upcoming' && (up.price !== cur.price || up.currency !== cur.currency) ? `${money(cur.price, cur.currency)} → ` : ''}
              {money(up.price, up.currency)} · {cycleLabel(up.cycle)}
            </Cell>
            <Cell label="支付方式">
              <PayBadge m={upMethod} />
            </Cell>
            {up.planned && !ro && (
              <div class="cell plan-actions">
                <button class="btn" onClick={() => run(() => saveSub(dropPlan(sub, up.start)), `不切换了，${cnDateFull(up.start)} 到期后不再续`)}>
                  不切换了
                </button>
                <button class="btn primary" onClick={() => run(() => saveSub(confirmPlan(sub, up.start)), '已确认切换')}>
                  <Icon name="check" /> 确认切换
                </button>
              </div>
            )}
          </Group>
        )}

        {(sub.phases?.length || (sub.priceHistory?.length ?? 0) > 1) && (
          <Group title="历程">
            <History sub={sub} state={state} today={today} />
          </Group>
        )}

        {sub.intro && (
          <Group title="首期优惠">
            <Cell label={<span class="row" style={{ gap: 6, color: 'var(--green)' }}><Icon name="leaf" /> 优惠价</span>}>{money(sub.intro.price, sub.currency)}</Cell>
            <Cell label="优惠截止">{cnDateFull(sub.intro.until)}</Cell>
            <Cell label="之后恢复">{money(sub.price, sub.currency)}</Cell>
          </Group>
        )}

        {sub.cycle.unit !== 'lifetime' && st !== 'ended' && (
          <Group title="提醒">
            <Cell label={<span class="row" style={{ gap: 8 }}><Icon name="bell" /> 邮件提醒</span>}>
              {remind < 0 ? '已关闭' : remind === 0 ? `到期当天 ${String(state.settings.notifyHour).padStart(2, '0')}:05` : `提前 ${remind} 天 ${String(state.settings.notifyHour).padStart(2, '0')}:05`}
            </Cell>
          </Group>
        )}

        {sub.share && (
          <Group title={sub.share.role === 'owner' ? `合租 · 我发起（${sub.share.members.length + 1}/${sub.share.seats}）` : '合租 · 我加入'}>
            {sub.share.role === 'member' && <Cell label="付给">{sub.share.ownerName ?? '发起人'}</Cell>}
            {sub.share.role === 'owner' && (
              <>
                <Cell label="我的份额">{money(sub.price - sub.share.members.reduce((a, m) => a + m.share, 0), sub.currency)}</Cell>
                {dues.map((d) => (
                  <Cell key={d.member.id} label={d.member.name || '未命名'} sub={d.member.paidUntil ? `已付至 ${d.member.paidUntil}` : '尚未收款'}>
                    {d.periodsOwed > 0 ? <span style={{ color: 'var(--orange)', fontWeight: 600 }}>待收 {money(d.owed, sub.currency)}</span> : <span style={{ color: 'var(--green)' }}>已结清</span>}
                  </Cell>
                ))}
              </>
            )}
          </Group>
        )}


        {history.length > 0 && (
          <Group title={`扣款记录 · ${history.length} 笔`}>
            {history
              .slice(allCharges ? 0 : -12)
              .reverse()
              .map((c, i) => {
                const r = rateOn(state.fxHistory, c.currency, c.date);
                const cny = rateOn(state.fxHistory, 'CNY', c.date);
                // 同一天可能有多笔（如重复扣款），用当天的序号定位
                const index = history.filter((x) => x.date === c.date).indexOf(c);
                return (
                  <div
                    key={`${c.date}-${i}`}
                    class={`charge-row ${ro ? '' : 'editable'} ${c.kind ?? ''}`}
                    onClick={() => !ro && setPay({ pay: { date: c.date, amount: c.kind === 'failed' ? currentPhase(sub, c.date).price : c.amount, kind: c.kind, settled: c.settled, note: c.note }, index })}
                  >
                    <span class="cr-date">
                      {c.date}
                      {c.kind && <em class={`cr-kind ${c.kind}`}>{{ refund: '退款', adjust: '补差', failed: '失败' }[c.kind]}</em>}
                    </span>
                    <b>{money(c.amount, c.currency)}</b>
                    <span class="cr-conv">
                      {c.settled && <span class="cr-settled">卡上 {money(c.settled.amount, c.settled.currency)} · </span>}
                      {c.currency !== 'CNY' && money(chargeValue(state, c, 'CNY'), 'CNY')}
                      {c.currency !== 'CNY' && c.currency !== 'USD' && ' · '}
                      {c.currency !== 'USD' && money(chargeValue(state, c, 'USD'), 'USD')}
                      {c.currency !== 'USD' && r && cny && (
                        <small>
                          1 {c.currency} = {((1 / r.rate) * cny.rate).toFixed(c.currency === 'NGN' ? 5 : 4)} CNY{r.date !== c.date ? ` · ${r.date}` : ''}
                        </small>
                      )}
                    </span>
                  </div>
                );
              })}
            {!ro && (
              <button class="cell more-row" onClick={() => setPay({})}>
                <Icon name="plus" size={14} /> 记一笔（退款、补差、扣款失败、卡上实扣…）
              </button>
            )}
            {history.length > 12 && (
              <button class="cell more-row" onClick={() => setAllCharges(!allCharges)}>
                {allCharges ? '只看最近 12 笔' : `显示全部 ${history.length} 笔`}
              </button>
            )}
          </Group>
        )}

        {sub.notes && (
          <Group title="备注">
            <div class="cell" style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6 }}>
              {sub.notes}
            </div>
          </Group>
        )}
      </div>
      {/* 挂到 body：详情本身可能在弹层里，嵌套的弹层放在里面会被裁切 */}
      {share && createPortal(<SubShare sub={sub} state={state} today={today} onClose={() => setShare(false)} />, document.body)}
      {pay && createPortal(<PaymentSheet sub={sub} today={today} edit={pay.pay ? { pay: pay.pay, index: pay.index ?? 0 } : undefined} onClose={() => setPay(null)} />, document.body)}
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
  // 实际在订的天数：各段到今天（或结束日）为止，不算断档
  const active = vs.reduce((a, v) => {
    if (v.start > today) return a;
    const end = v.end && v.end < today ? v.end : today;
    return a + Math.max(0, diffDays(v.start, end));
  }, 0);
  const gaps = vs.slice(1).filter((v, i) => vs[i].end && vs[i].end! < v.start).length;
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
    <div class="d-stats">
      <div>
        <small>累计花了</small>
        <b>{money(total, base, { compact: true })}</b>
        <span>
          {count} 笔{alt ? ` · ${alt}` : ''}
        </span>
      </div>
      <div>
        <small>{lifetime ? '买了' : '订了'}</small>
        <b>{years ? `${years} 年${months ? ` ${months} 个月` : ''}` : months ? `${months} 个月` : `${active} 天`}</b>
        <span>{gaps ? `中间断过 ${gaps} 次` : `${cnDate(sub.start)} 起`}</span>
      </div>
      {!lifetime && (
        <div>
          <small>实际每月</small>
          <b>{money(perMonth, base, { compact: true })}</b>
          <span>累计 ÷ 在订的月数</span>
        </div>
      )}
      <div>
        <small>{change != null ? '价格变化' : '变过'}</small>
        <b class={change != null ? (change > 0.005 ? 'up' : change < -0.005 ? 'down' : '') : ''}>
          {change != null ? (Math.abs(change) < 0.005 ? '没变' : `${change > 0 ? '+' : '−'}${Math.round(Math.abs(change) * 100)}%`) : `${vs.length - 1} 次`}
        </b>
        <span>{change != null ? `${money(p0, first.currency, { compact: true })} → ${money(p1, cur.currency, { compact: true })}` : '换区、换套餐或换支付方式'}</span>
      </div>
    </div>
  );
}
