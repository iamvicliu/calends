import { advancePaid, cycleLabel, effectiveStatus, memberDues, monthlyGross, myShareFactor, nextCharge } from '../../shared/billing.ts';
import { cnDate, money } from '../../shared/format.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { Amount, Cell, Group, Icon, SubIcon, Toolbar } from '../components/ui.tsx';
import { toBase } from '../derive.ts';
import { run, saveSub } from '../store.ts';

export function Carpool({ state, today, onOpen, onEdit }: { state: AppState; today: string; onOpen: (s: Subscription) => void; onEdit: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  const live = (s: Subscription) => ['active', 'ending', 'trial', 'paused'].includes(effectiveStatus(s, today));
  const owned = state.subscriptions.filter((s) => s.share?.role === 'owner' && live(s));
  const joined = state.subscriptions.filter((s) => s.share?.role === 'member' && live(s));
  const recover = owned.reduce((a, s) => a + toBase(state, monthlyGross(s, today) * (1 - myShareFactor(s)), s.currency), 0);
  const owedAll = owned.flatMap((s) => memberDues(s, today)).filter((d) => d.periodsOwed > 0);
  const owedSum = owedAll.reduce((a, d) => a + toBase(state, d.owed, d.sub.currency), 0);
  const ro = !!state.readonly;
  const candidates = state.subscriptions.filter((s) => !s.share && live(s) && s.tags.some((t) => /合租|拼车|家庭|family/i.test(t)));

  return (
    <>
      <Toolbar title="拼车" sub="实际成本 = 全价 − 成员分摊" />
      <div class="page fade-in stack">
        <div class="grid g-3">
          <div class="card stat">
            <div class="stat-label">每月回血</div>
            <div class="stat-value">
              <Amount value={recover} ccy={base} />
            </div>
            <div class="stat-sub">每年 {money(recover * 12, base, { compact: true })}</div>
          </div>
          <div class="card stat">
            <div class="stat-label">待收</div>
            <div class="stat-value" style={{ color: owedSum > 0 ? 'var(--orange)' : undefined }}>
              <Amount value={owedSum} ccy={base} />
            </div>
            <div class="stat-sub">{owedAll.length} 位成员未结清</div>
          </div>
          <div class="card stat">
            <div class="stat-label">车队</div>
            <div class="stat-value">
              <span class="amt">
                {owned.length}
                <small> 开 · </small>
                {joined.length}
                <small> 上</small>
              </span>
            </div>
            <div class="stat-sub">我开的车 · 我上的车</div>
          </div>
        </div>

        {owned.length === 0 && (
          <div class="card empty">
            <b>还没有开车</b>
            在订阅编辑页把「拼车」设为「我是车主」，添加成员与每期份额。
          </div>
        )}
        <div class="grid g-2">
          {owned.map((s) => {
            const sh = s.share!;
            const dues = memberDues(s, today);
            const next = nextCharge(s, today);
            return (
              <div key={s.id} class="card stack" style={{ gap: 14 }}>
                <button class="row" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => onOpen(s)}>
                  <SubIcon sub={s} size={46} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{s.name}</div>
                    <div class="muted" style={{ fontSize: 13 }}>
                      {money(s.price, s.currency)} {cycleLabel(s.cycle)}
                      {next ? ` · 下次 ${cnDate(next)}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Amount value={s.price * myShareFactor(s)} ccy={s.currency} />
                    <div class="muted" style={{ fontSize: 12 }}>
                      我的份
                    </div>
                  </div>
                </button>
                <div class="seats">
                  <span class="seat me">我</span>
                  {sh.members.map((m) => {
                    const owe = dues.find((d) => d.member.id === m.id)?.periodsOwed;
                    return (
                      <span key={m.id} class={`seat ${owe ? 'owe' : 'on'}`} title={m.name}>
                        {[...(m.name || '?')][0]}
                      </span>
                    );
                  })}
                  {Array.from({ length: Math.max(0, sh.seats - 1 - sh.members.length) }, (_, i) => (
                    <span key={i} class="seat">
                      +
                    </span>
                  ))}
                </div>
                {sh.members.length === 0 && !ro && (
                  <button class="btn tinted" style={{ alignSelf: 'flex-start' }} onClick={() => onEdit(s)}>
                    <Icon name="plus" /> 添加成员（{sh.seats - 1} 个空位）
                  </button>
                )}
                <div>
                  {dues.map((d) => (
                    <div key={d.member.id} class="member">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{d.member.name || '未命名'}</div>
                        <div class="muted" style={{ fontSize: 12 }}>
                          {d.member.paidUntil ? `已付至 ${d.member.paidUntil}` : '尚未收款'}
                          {d.member.contact ? ` · ${d.member.contact}` : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: 13.5 }}>
                        {d.periodsOwed > 0 ? <b style={{ color: 'var(--orange)' }}>待收 {money(d.owed, s.currency)}</b> : <span style={{ color: 'var(--green)', fontWeight: 600 }}>已结清</span>}
                        <div class="muted" style={{ fontSize: 12 }}>
                          每期 {money(d.member.share, s.currency)}
                        </div>
                      </div>
                      {!ro && (
                        <button
                          class={`btn ${d.periodsOwed > 0 ? 'primary' : ''}`}
                          onClick={() =>
                            run(
                              () =>
                                saveSub({
                                  ...s,
                                  share: { ...sh, members: sh.members.map((m) => (m.id === d.member.id ? { ...m, paidUntil: advancePaid(s, m.paidUntil, today) } : m)) },
                                }),
                              `已记 ${d.member.name || '成员'} 收款 1 期`,
                            )
                          }
                        >
                          <Icon name="check" /> 收 1 期
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {joined.length > 0 && (
          <Group title="我上的车">
            {joined.map((s) => (
              <Cell key={s.id} label={<span class="row"><SubIcon sub={s} size={30} />{s.name}</span>} sub={undefined} onClick={() => onOpen(s)}>
                付给 {s.share?.ownerName ?? '车主'} · {money(s.price, s.currency)}
              </Cell>
            ))}
          </Group>
        )}

        {candidates.length > 0 && !ro && (
          <Group title="可能在拼车" foot="这些订阅带有「合租」等标签，点进去在编辑页设置车主或成员。">
            {candidates.map((s) => (
              <Cell key={s.id} label={<span class="row"><SubIcon sub={s} size={30} />{s.name}</span>} onClick={() => onEdit(s)}>
                {money(s.price, s.currency)}
              </Cell>
            ))}
          </Group>
        )}
      </div>
    </>
  );
}
