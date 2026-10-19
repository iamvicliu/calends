import { chargesBetween, convert, cycleLabel, diffDays, effectiveStatus, memberDues, monthlyGross, nextCharge, priceAt } from '../../shared/billing.ts';
import { cnDateFull, money, relDays } from '../../shared/format.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { Amount, Cell, Group, Icon, PayBadge, SubIcon } from '../components/ui.tsx';
import { catColor, domainOf } from '../derive.ts';
import { run, saveSub } from '../store.ts';

const STATUS: Record<string, [string, string]> = {
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
  const method = state.methods.find((m) => m.id === sub.methodId);
  const history = chargesBetween(sub, sub.start, today, today);
  const total = history.reduce((a, c) => a + (convert(c.amount, c.currency, base, state.fx) || 0), 0);
  const monthly = monthlyGross(sub, today);
  const remind = sub.remindDays ?? state.settings.remindDays;
  const icon = sub.icon?.startsWith('http') ? sub.icon : domainOf(sub.url) ? `https://www.google.com/s2/favicons?domain=${domainOf(sub.url)}&sz=128` : undefined;
  const [label, tone] = STATUS[st];
  const ro = !!state.readonly;
  const dues = memberDues(sub, today);

  return (
    <div class="detail">
      <div class="d-hero">
        {icon ? <div class="d-hero-bg" style={{ backgroundImage: `url("${icon}")` }} /> : <div class="d-hero-bg tint" style={{ '--tint': catColor(sub.category) } as Record<string, string>} />}
        <SubIcon sub={sub} size={72} />
        <h2>{sub.name}</h2>
        <div class="price">
          <Amount value={next ? priceAt(sub, next) : sub.price} ccy={sub.currency} />
          {cycleLabel(sub.cycle)}
          {sub.currency !== base && ` · ≈ ${money(convert(sub.price, sub.currency, base, state.fx), base)}`}
        </div>
        <div class="d-actions">
          <span class={`badge ${tone}`} style={{ alignSelf: 'center', fontSize: 12, padding: '4px 9px' }}>
            {label}
          </span>
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
          {sub.url && (
            <a class="btn" href={sub.url} target="_blank" rel="noreferrer">
              <Icon name="link" /> 官网
            </a>
          )}
        </div>
      </div>
      <div class="d-body">
        <Group title="摘要">
          <Cell label="金额">{money(sub.price, sub.currency)}</Cell>
          <Cell label="计费周期">{cycleLabel(sub.cycle)}</Cell>
          {sub.cycle.unit !== 'lifetime' && <Cell label="月均 / 年均">{`${money(monthly, sub.currency)} / ${money(monthly * 12, sub.currency, { compact: true })}`}</Cell>}
          <Cell label="分类">
            <span class="badge" style={{ background: `color-mix(in srgb, ${catColor(sub.category)} 16%, transparent)`, color: catColor(sub.category) }}>
              {sub.category}
            </span>
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
          {sub.end && <Cell label={st === 'ended' ? '结束于' : '到期不续'}>{cnDateFull(sub.end)}</Cell>}
          {sub.trialEnd && <Cell label="试用截止">{cnDateFull(sub.trialEnd)}</Cell>}
          {sub.region && <Cell label="地区">{sub.region}</Cell>}
          <Cell label="累计支付">
            {money(total, base)} · {history.length} 笔
          </Cell>
        </Group>

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
          <Group title={sub.share.role === 'owner' ? `拼车 · 我是车主（${sub.share.members.length + 1}/${sub.share.seats}）` : '拼车 · 我上车'}>
            {sub.share.role === 'member' && <Cell label="付给">{sub.share.ownerName ?? '车主'}</Cell>}
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

        {(sub.priceHistory?.length ?? 0) > 1 && (
          <Group title="价格历史">
            {sub.priceHistory!.map((p) => (
              <Cell key={p.from} label={`${p.from} 起`}>
                {money(p.amount, sub.currency)}
              </Cell>
            ))}
          </Group>
        )}

        {history.length > 0 && (
          <Group title={`扣款记录 · ${history.length} 笔`} foot={history.length > 8 ? '仅显示最近 8 笔' : undefined}>
            {history
              .slice(-8)
              .reverse()
              .map((c) => (
                <Cell key={c.date} label={cnDateFull(c.date)}>
                  {money(c.amount, c.currency)}
                </Cell>
              ))}
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
    </div>
  );
}
