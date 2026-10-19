import { advancePaid, cycleLabel, effectiveStatus, memberDues, monthlyGross, myShareFactor, nextCharge } from '../../shared/billing.ts';
import { cnDate, money } from '../../shared/format.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { Icon, SectionHead, SubIcon } from '../components/ui.tsx';
import { toBase } from '../derive.ts';
import { run, saveSub } from '../store.ts';

export function Carpool({ state, today, onOpen, onNew }: { state: AppState; today: string; onOpen: (s: Subscription) => void; onNew: () => void }) {
  const base = state.settings.baseCurrency;
  const live = (s: Subscription) => ['active', 'ending', 'trial', 'paused'].includes(effectiveStatus(s, today));
  const owned = state.subscriptions.filter((s) => s.share?.role === 'owner' && live(s));
  const joined = state.subscriptions.filter((s) => s.share?.role === 'member' && live(s));
  const recover = owned.reduce((a, s) => a + toBase(state, monthlyGross(s, today) * (1 - myShareFactor(s)), s.currency), 0);
  const owedAll = owned.flatMap((s) => memberDues(s, today)).filter((d) => d.periodsOwed > 0);
  const owedSum = owedAll.reduce((a, d) => a + toBase(state, d.owed, d.sub.currency), 0);
  const ro = !!state.readonly;

  return (
    <div class="wrap fade-in">
      <SectionHead no="■" label="Carpool" title="拼车与分摊" meta="我开的车向成员收钱，上的车按份付钱。实际成本 = 全价 − 成员分摊。" />
      <div class="kpis" style={{ marginTop: 0 }}>
        <div class="kpi good">
          <div class="kpi-label">每月回血</div>
          <div class="kpi-value">{money(recover, base, { compact: true })}</div>
          <div class="kpi-sub">{owned.length} 辆车</div>
        </div>
        <div class={`kpi ${owedSum > 0 ? 'hl' : ''}`}>
          <div class="kpi-label">待收</div>
          <div class="kpi-value">{money(owedSum, base, { compact: true })}</div>
          <div class="kpi-sub">{owedAll.length} 位成员</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">已上车</div>
          <div class="kpi-value">{joined.length}</div>
          <div class="kpi-sub">作为成员</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">年回血</div>
          <div class="kpi-value">{money(recover * 12, base, { compact: true })}</div>
          <div class="kpi-sub">按当前分摊</div>
        </div>
      </div>

      <section class="section" style={{ marginTop: 56 }}>
        <div class="eyebrow" style={{ marginBottom: 16 }}>
          我是车主 · {owned.length}
        </div>
        {owned.length === 0 && (
          <div class="empty">
            <b>还没有开车</b>
            在订阅的编辑页把「拼车」设为「我是车主」，添加成员和每期份额。
            {!ro && (
              <div style={{ marginTop: 14 }}>
                <button class="btn primary" onClick={onNew}>
                  <Icon name="plus" /> 添加一辆车
                </button>
              </div>
            )}
          </div>
        )}
        <div class="grid-2">
          {owned.map((s) => {
            const sh = s.share!;
            const dues = memberDues(s, today);
            const next = nextCharge(s, today);
            const mine = s.price * myShareFactor(s);
            return (
              <div key={s.id} class="card card-pad stack" style={{ gap: 14 }}>
                <div class="hstack" style={{ cursor: 'pointer' }} onClick={() => onOpen(s)}>
                  <SubIcon sub={s} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div class="row-title">{s.name}</div>
                    <div class="row-sub">
                      {money(s.price, s.currency)} {cycleLabel(s.cycle)}
                      {next ? ` · 下次 ${cnDate(next)}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div class="num" style={{ fontWeight: 600 }}>
                      {money(mine, s.currency)}
                    </div>
                    <div class="soft" style={{ fontSize: 11.5 }}>
                      我的份
                    </div>
                  </div>
                </div>
                <div class="seats">
                  <span class="seat me" title="我">
                    我
                  </span>
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
                {sh.members.length === 0 && <div class="muted" style={{ fontSize: 13 }}>还有 {sh.seats - 1} 个空位，点上方卡片添加成员。</div>}
                <div>
                  {dues.map((d) => (
                    <div key={d.member.id} class="member">
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{d.member.name || '未命名'}</div>
                        <div class="soft" style={{ fontSize: 12 }}>
                          {d.member.paidUntil ? `已付至 ${d.member.paidUntil}` : '尚未收款'}
                          {d.member.contact ? ` · ${d.member.contact}` : ''}
                        </div>
                      </div>
                      <div class="num" style={{ textAlign: 'right', fontSize: 13.5 }}>
                        {d.periodsOwed > 0 ? <span class="warn">待收 {money(d.owed, s.currency)}</span> : <span class="ok">已结清</span>}
                        <div class="soft" style={{ fontSize: 11.5 }}>
                          每期 {money(d.member.share, s.currency)}
                        </div>
                      </div>
                      {!ro && (
                        <button
                          class="btn sm"
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
      </section>

      <section class="section" style={{ marginTop: 56 }}>
        <div class="eyebrow" style={{ marginBottom: 16 }}>
          我上的车 · {joined.length}
        </div>
        {joined.length === 0 ? (
          <div class="empty">没有作为成员加入的订阅。</div>
        ) : (
          <div class="ledger">
            {joined.map((s) => (
              <button key={s.id} class="row" onClick={() => onOpen(s)}>
                <SubIcon sub={s} />
                <div style={{ minWidth: 0 }}>
                  <div class="row-title">{s.name}</div>
                  <div class="row-sub">付给 {s.share?.ownerName ?? '车主'}</div>
                </div>
                <div class="leader" />
                <div class="row-amt">
                  <div class="a">{money(s.price, s.currency)}</div>
                  <div class="b">{cycleLabel(s.cycle)}</div>
                </div>
                <div class="row-when">
                  <div class="a">下次</div>
                  <div class="b">{nextCharge(s, today) ? cnDate(nextCharge(s, today)!) : '—'}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
