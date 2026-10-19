import { useMemo, useState } from 'preact/hooks';
import { chargesBetween, convert, cycleLabel, diffDays, effectiveStatus, monthlyGross, nextCharge, nthCharge, priceAt, uid } from '../../shared/billing.ts';
import { cnDateFull, CURRENCIES, money, relDays } from '../../shared/format.ts';
import type { AppState, Cycle, ShareMember, SubStatus, Subscription } from '../../shared/types.ts';
import { Icon, Sheet, SubIcon, Toggle } from '../components/ui.tsx';
import { api, deleteSub, run, saveSub } from '../store.ts';
import { confirmDelete } from './Wallet.tsx';

const CYCLES: Array<{ label: string; c: Cycle }> = [
  { label: '每月', c: { unit: 'month', every: 1 } },
  { label: '每年', c: { unit: 'year', every: 1 } },
  { label: '每季度', c: { unit: 'month', every: 3 } },
  { label: '每半年', c: { unit: 'month', every: 6 } },
  { label: '每周', c: { unit: 'week', every: 1 } },
  { label: '买断', c: { unit: 'lifetime', every: 1 } },
];

const STATUS: Array<[SubStatus, string]> = [
  ['active', '计费中'],
  ['trial', '试用中'],
  ['paused', '已暂停'],
  ['cancelled', '已取消'],
];

export function newSub(today: string): Subscription {
  return { id: uid(), name: '', category: '工具', tags: [], price: 0, currency: 'CNY', cycle: { unit: 'month', every: 1 }, start: today, status: 'active' };
}

export function Editor({ sub, state, today, onClose }: { sub: Subscription; state: AppState; today: string; onClose: () => void }) {
  const isNew = !state.subscriptions.some((s) => s.id === sub.id);
  const [f, setF] = useState<Subscription>(structuredClone(sub));
  const [view, setView] = useState<'edit' | 'detail'>(isNew || state.readonly ? (state.readonly ? 'detail' : 'edit') : 'detail');
  const up = (p: Partial<Subscription>) => setF((x) => ({ ...x, ...p }));
  const cats = useMemo(() => [...new Set(state.subscriptions.map((s) => s.category))], [state]);
  const base = state.settings.baseCurrency;

  const save = () =>
    run(async () => {
      const out: Subscription = { ...f, name: f.name.trim() };
      // 改价时自动记录价格历史，保证过往账单不被新价格覆盖
      if (!isNew && sub.price !== out.price) {
        const hist = out.priceHistory?.length ? [...out.priceHistory] : [{ from: sub.start, amount: sub.price }];
        hist.push({ from: today, amount: out.price });
        out.priceHistory = hist;
      }
      if (out.status === 'cancelled' && !out.end) out.end = today;
      if (out.status === 'paused' && !out.pausedAt) out.pausedAt = today;
      if (out.status !== 'paused') delete out.pausedAt;
      await saveSub(out);
      onClose();
    }, isNew ? '已添加' : '已保存');

  const foot =
    view === 'detail' ? (
      !state.readonly && (
        <>
          <span class="grow" />
          <button class="btn primary" onClick={() => setView('edit')}>
            编辑
          </button>
        </>
      )
    ) : (
      <>
        {!isNew && (
          <button
            class="btn danger"
            onClick={() =>
              confirmDelete(`删除「${sub.name}」？历史记录会一并清除；只是不再续费的话，建议改为「已取消」。`) &&
              run(async () => {
                await deleteSub(sub.id);
                onClose();
              }, '已删除')
            }
          >
            删除
          </button>
        )}
        <span class="grow" />
        <button class="btn" onClick={() => (isNew ? onClose() : setView('detail'))}>
          取消
        </button>
        <button class="btn primary" disabled={!f.name.trim()} onClick={save}>
          保存
        </button>
      </>
    );

  return (
    <Sheet
      title={
        <span class="hstack" style={{ gap: 12 }}>
          {(f.name || !isNew) && <SubIcon sub={f} size="sm" />}
          {isNew ? '添加订阅' : f.name || '订阅'}
        </span>
      }
      onClose={onClose}
      foot={foot}
    >
      {view === 'detail' ? <Detail sub={sub} state={state} today={today} base={base} /> : <Form f={f} up={up} state={state} cats={cats} today={today} />}
    </Sheet>
  );
}

function Detail({ sub, state, today, base }: { sub: Subscription; state: AppState; today: string; base: string }) {
  const st = effectiveStatus(sub, today);
  const next = nextCharge(sub, today);
  const method = state.methods.find((m) => m.id === sub.methodId);
  const history = chargesBetween(sub, sub.start, today, today);
  const total = history.reduce((a, c) => a + (convert(c.amount, c.currency, base, state.fx) || 0), 0);
  const label: Record<string, string> = { active: '计费中', trial: '试用中', paused: '已暂停', ending: '到期不续', ended: '已结束', lifetime: '买断' };
  const monthly = monthlyGross(sub, today);
  return (
    <div class="stack" style={{ gap: 22 }}>
      <div class="hstack" style={{ alignItems: 'flex-end' }}>
        <div>
          <div class="hero-num" style={{ fontSize: 52 }}>
            {money(sub.price, sub.currency)}
          </div>
          <div class="muted" style={{ marginTop: 6 }}>
            {cycleLabel(sub.cycle)}
            {sub.currency !== base && ` · ≈ ${money(convert(sub.price, sub.currency, base, state.fx), base)}`}
          </div>
        </div>
        <span class="spacer" />
        <span class={`badge ${st === 'ended' ? '' : st === 'ending' || st === 'trial' ? 'warn' : 'ok'}`} style={{ fontSize: 12, padding: '6px 9px' }}>
          {label[st]}
        </span>
      </div>
      <dl class="kv">
        {next && (
          <>
            <dt>下次扣款</dt>
            <dd>
              {cnDateFull(next)} · {relDays(diffDays(today, next))}
            </dd>
          </>
        )}
        {sub.cycle.unit !== 'lifetime' && (
          <>
            <dt>月均 / 年均</dt>
            <dd>
              {money(monthly, sub.currency)} / {money(monthly * 12, sub.currency)}
            </dd>
          </>
        )}
        <dt>支付方式</dt>
        <dd>{method?.name ?? '未指定'}</dd>
        <dt>开始</dt>
        <dd>{sub.start}</dd>
        {sub.end && (
          <>
            <dt>结束</dt>
            <dd>{sub.end}</dd>
          </>
        )}
        {sub.intro && (
          <>
            <dt>🌿 首期优惠</dt>
            <dd>
              {money(sub.intro.price, sub.currency)} 至 {sub.intro.until}
            </dd>
          </>
        )}
        {next && priceAt(sub, next) !== sub.price && (
          <>
            <dt>下期金额</dt>
            <dd>{money(priceAt(sub, next), sub.currency)}</dd>
          </>
        )}
        {sub.trialEnd && (
          <>
            <dt>试用至</dt>
            <dd>{sub.trialEnd}</dd>
          </>
        )}
        <dt>分类</dt>
        <dd>
          {sub.category}
          {sub.tags.length ? ` · ${sub.tags.join(' ')}` : ''}
        </dd>
        {sub.region && (
          <>
            <dt>地区</dt>
            <dd>{sub.region}</dd>
          </>
        )}
        <dt>累计支付</dt>
        <dd>
          {money(total, base)} · {history.length} 笔
        </dd>
        {sub.share && (
          <>
            <dt>拼车</dt>
            <dd>
              {sub.share.role === 'owner' ? `车主 · ${sub.share.members.length + 1}/${sub.share.seats} 人` : `成员${sub.share.ownerName ? ` · 付给 ${sub.share.ownerName}` : ''}`}
            </dd>
          </>
        )}
      </dl>
      {sub.url && (
        <a class="btn sm" href={sub.url} target="_blank" rel="noreferrer" style={{ alignSelf: 'flex-start' }}>
          <Icon name="link" /> 打开官网
        </a>
      )}
      {sub.notes && <div class="codebox" style={{ fontFamily: 'var(--sans)', fontSize: 13.5 }}>{sub.notes}</div>}
      {(sub.priceHistory?.length ?? 0) > 1 && (
        <div>
          <div class="eyebrow" style={{ marginBottom: 6 }}>
            价格历史
          </div>
          {sub.priceHistory!.map((p) => (
            <div key={p.from} class="log-row">
              <span>{p.from} 起</span>
              <span class="num">{money(p.amount, sub.currency)}</span>
            </div>
          ))}
        </div>
      )}
      {history.length > 0 && (
        <div>
          <div class="eyebrow" style={{ marginBottom: 6 }}>
            扣款记录 · {history.length}
          </div>
          {history
            .slice(-12)
            .reverse()
            .map((c) => (
              <div key={c.date} class="log-row">
                <span class="num muted">{c.date}</span>
                <span class="num">{money(c.amount, c.currency)}</span>
              </div>
            ))}
          {history.length > 12 && <div class="soft" style={{ fontSize: 12, marginTop: 6 }}>仅显示最近 12 笔</div>}
        </div>
      )}
    </div>
  );
}

function Form({ f, up, state, cats, today }: { f: Subscription; up: (p: Partial<Subscription>) => void; state: AppState; cats: string[]; today: string }) {
  const cycleKey = (c: Cycle) => `${c.unit}:${c.every}`;
  const preset = CYCLES.find((x) => cycleKey(x.c) === cycleKey(f.cycle));
  const share = f.share;
  const setShare = (p: Partial<NonNullable<Subscription['share']>> | null) =>
    up({ share: p === null ? undefined : { role: 'owner', seats: 6, members: [], ...share, ...p } });
  const setMember = (i: number, p: Partial<ShareMember>) => setShare({ members: share!.members.map((m, j) => (j === i ? { ...m, ...p } : m)) });
  const perHead = share && share.seats > 0 ? Math.round((f.price / share.seats) * 100) / 100 : 0;
  return (
    <div class="form">
      <AppStoreSearch onPick={(r) => up({ name: f.name || r.name.split(/\s[-–—:：]\s?/)[0], icon: r.icon, url: r.url })} region={f.region} />
      <label class="field full">
        <span>名称</span>
        <input class="input" value={f.name} autoFocus={!f.name} placeholder="Spotify、ChatGPT Plus、iCloud+ …" onInput={(e) => up({ name: (e.target as HTMLInputElement).value })} />
      </label>
      <label class="field">
        <span>价格</span>
        <input class="input num" inputMode="decimal" value={f.price || ''} placeholder="0.00" onInput={(e) => up({ price: Number((e.target as HTMLInputElement).value) || 0 })} />
      </label>
      <label class="field">
        <span>币种</span>
        <select class="input" value={f.currency} onChange={(e) => up({ currency: (e.target as HTMLSelectElement).value })}>
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <div class="field full">
        <span>周期</span>
        <div class="chips">
          {CYCLES.map((x) => (
            <button key={x.label} type="button" class={`chip ${preset === x ? 'on' : ''}`} onClick={() => up({ cycle: x.c })}>
              {x.label}
            </button>
          ))}
          <span class="hstack" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <span class="muted" style={{ fontSize: 13 }}>
              每
            </span>
            <input
              class="input num"
              style={{ width: 56, height: 32 }}
              inputMode="numeric"
              value={f.cycle.unit === 'lifetime' ? '' : f.cycle.every}
              onInput={(e) => up({ cycle: { unit: f.cycle.unit === 'lifetime' ? 'month' : f.cycle.unit, every: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) } })}
            />
            <select
              class="input"
              style={{ width: 72, height: 32 }}
              value={f.cycle.unit === 'lifetime' ? 'month' : f.cycle.unit}
              onChange={(e) => up({ cycle: { unit: (e.target as HTMLSelectElement).value as Cycle['unit'], every: f.cycle.unit === 'lifetime' ? 1 : f.cycle.every } })}
            >
              <option value="day">天</option>
              <option value="week">周</option>
              <option value="month">月</option>
              <option value="year">年</option>
            </select>
          </span>
        </div>
      </div>
      <label class="field">
        <span>{f.cycle.unit === 'lifetime' ? '购买日期' : '首次扣款日'}</span>
        <input class="input" type="date" value={f.start} onInput={(e) => up({ start: (e.target as HTMLInputElement).value || today })} />
      </label>
      <label class="field">
        <span>支付方式</span>
        <select class="input" value={f.methodId ?? ''} onChange={(e) => up({ methodId: (e.target as HTMLSelectElement).value || undefined })}>
          <option value="">未指定</option>
          {state.methods.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <div class="field full">
        <span>状态</span>
        <div class="chips">
          {STATUS.map(([k, l]) => (
            <button key={k} type="button" class={`chip ${f.status === k ? 'on' : ''}`} onClick={() => up({ status: k })}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {f.status === 'trial' && (
        <label class="field">
          <span>试用结束</span>
          <input class="input" type="date" value={f.trialEnd ?? ''} onInput={(e) => up({ trialEnd: (e.target as HTMLInputElement).value || undefined })} />
        </label>
      )}
      <label class="field">
        <span>到期日（不再续费）</span>
        <input class="input" type="date" value={f.end ?? ''} onInput={(e) => up({ end: (e.target as HTMLInputElement).value || undefined })} />
      </label>
      <label class="field">
        <span>分类</span>
        <input class="input" list="cats" value={f.category} onInput={(e) => up({ category: (e.target as HTMLInputElement).value })} />
        <datalist id="cats">
          {cats.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label class="field">
        <span>标签</span>
        <input class="input" value={f.tags.join(' ')} placeholder="空格分隔" onInput={(e) => up({ tags: (e.target as HTMLInputElement).value.split(/\s+/).filter(Boolean) })} />
      </label>
      <label class="field">
        <span>图标</span>
        <input class="input" value={f.icon ?? ''} placeholder="Emoji 或图片 URL，留空自动取站点图标" onInput={(e) => up({ icon: (e.target as HTMLInputElement).value || undefined })} />
      </label>
      <label class="field">
        <span>官网</span>
        <input class="input" value={f.url ?? ''} placeholder="https://" onInput={(e) => up({ url: (e.target as HTMLInputElement).value || undefined })} />
      </label>
      <label class="field">
        <span>地区</span>
        <input class="input" value={f.region ?? ''} placeholder="App Store 区域，如 TR" onInput={(e) => up({ region: (e.target as HTMLInputElement).value.toUpperCase() || undefined })} />
      </label>
      <label class="field">
        <span>提前提醒（天）</span>
        <input
          class="input num"
          inputMode="numeric"
          value={f.remindDays ?? ''}
          placeholder={`默认 ${state.settings.remindDays}，-1 关闭`}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            up({ remindDays: v === '' ? undefined : Number(v) });
          }}
        />
      </label>

      <div class="fieldset full">
        <div class="fieldset-h">
          <span>🌿 首期优惠</span>
          <Toggle checked={!!f.intro} onChange={(v) => up({ intro: v ? { price: f.price, until: nthCharge(f.start, f.cycle.unit === 'lifetime' ? { unit: 'year', every: 1 } : f.cycle, 1) } : undefined })} />
        </div>
        {f.intro && (
          <div class="inline">
            <label class="field">
              <span>优惠价</span>
              <input class="input num" inputMode="decimal" value={f.intro.price} onInput={(e) => up({ intro: { ...f.intro!, price: Number((e.target as HTMLInputElement).value) || 0 } })} />
            </label>
            <label class="field">
              <span>优惠截止（不含）</span>
              <input class="input" type="date" value={f.intro.until} onInput={(e) => up({ intro: { ...f.intro!, until: (e.target as HTMLInputElement).value || today } })} />
            </label>
          </div>
        )}
        {f.intro && <small class="muted">截止日前的扣款按优惠价计算，之后恢复「价格」中的原价，提醒邮件会注明恢复原价。</small>}
      </div>

      <div class="fieldset full">
        <div class="fieldset-h">
          <span>拼车 / 分摊</span>
          <div class="seg-ctl">
            <button type="button" class={!share ? 'on' : ''} onClick={() => setShare(null)}>
              不拼
            </button>
            <button type="button" class={share?.role === 'owner' ? 'on' : ''} onClick={() => setShare({ role: 'owner' })}>
              我是车主
            </button>
            <button type="button" class={share?.role === 'member' ? 'on' : ''} onClick={() => setShare({ role: 'member' })}>
              我上车
            </button>
          </div>
        </div>
        {share?.role === 'member' && (
          <>
            <small class="muted">「价格」请填写你每期需要付给车主的那一份。</small>
            <label class="field">
              <span>车主</span>
              <input class="input" value={share.ownerName ?? ''} onInput={(e) => setShare({ ownerName: (e.target as HTMLInputElement).value || undefined })} />
            </label>
          </>
        )}
        {share?.role === 'owner' && (
          <>
            <div class="inline">
              <label class="field">
                <span>总席位（含自己）</span>
                <input class="input num" inputMode="numeric" value={share.seats} onInput={(e) => setShare({ seats: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) })} />
              </label>
              <div class="field">
                <span>人均</span>
                <div class="input num" style={{ display: 'flex', alignItems: 'center', background: 'var(--paper-2)' }}>
                  {money(perHead, f.currency)}
                </div>
              </div>
            </div>
            {share.members.map((m, i) => (
              <div key={m.id} class="inline" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label class="field" style={{ flex: '2 1 120px' }}>
                  <span>成员 {i + 1}</span>
                  <input class="input" value={m.name} placeholder="昵称" onInput={(e) => setMember(i, { name: (e.target as HTMLInputElement).value })} />
                </label>
                <label class="field" style={{ flex: '1 1 80px' }}>
                  <span>每期</span>
                  <input class="input num" inputMode="decimal" value={m.share} onInput={(e) => setMember(i, { share: Number((e.target as HTMLInputElement).value) || 0 })} />
                </label>
                <label class="field" style={{ flex: '1.4 1 120px' }}>
                  <span>已付至</span>
                  <input class="input" type="date" value={m.paidUntil ?? ''} onInput={(e) => setMember(i, { paidUntil: (e.target as HTMLInputElement).value || undefined })} />
                </label>
                <label class="field" style={{ flex: '1.4 1 120px' }}>
                  <span>联系方式</span>
                  <input class="input" value={m.contact ?? ''} placeholder="微信 / 邮箱" onInput={(e) => setMember(i, { contact: (e.target as HTMLInputElement).value || undefined })} />
                </label>
                <button type="button" class="icon-btn" aria-label="移除" onClick={() => setShare({ members: share.members.filter((_, j) => j !== i) })} style={{ flex: '0 0 38px' }}>
                  <Icon name="x" />
                </button>
              </div>
            ))}
            {share.members.length < share.seats - 1 && (
              <button type="button" class="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShare({ members: [...share.members, { id: uid(), name: '', share: perHead }] })}>
                <Icon name="plus" /> 添加成员
              </button>
            )}
          </>
        )}
      </div>

      <label class="field full">
        <span>备注</span>
        <textarea class="input" value={f.notes ?? ''} onInput={(e) => up({ notes: (e.target as HTMLTextAreaElement).value || undefined })} />
      </label>
    </div>
  );
}

interface AppHit {
  name: string;
  icon: string;
  url: string;
  seller: string;
  genre: string;
}

/** 从 App Store 搜索或粘贴链接，带出名称、图标与链接 */
function AppStoreSearch({ onPick, region }: { onPick: (r: AppHit) => void; region?: string }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<AppHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ results: AppHit[] }>(`/api/appstore/search?q=${encodeURIComponent(q)}&country=${(region || 'us').toLowerCase()}`);
      setHits(r.results);
    } catch {
      setHits([]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="field full">
      <span>从 App Store 导入（可选）</span>
      <div class="inline">
        <input
          class="input"
          value={q}
          placeholder="搜索 App 名称，或粘贴 App Store 链接"
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), search())}
        />
        <button type="button" class="btn" style={{ flex: '0 0 auto' }} disabled={busy} onClick={search}>
          {busy ? '搜索中…' : '搜索'}
        </button>
      </div>
      {hits && (
        <div class="chips" style={{ marginTop: 6 }}>
          {hits.length === 0 && <small class="soft">没有找到</small>}
          {hits.map((h) => (
            <button
              type="button"
              key={h.url}
              class="chip"
              onClick={() => {
                onPick(h);
                setHits(null);
                setQ('');
              }}
            >
              <img src={h.icon} alt="" width={18} height={18} style={{ borderRadius: 5 }} />
              {h.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
