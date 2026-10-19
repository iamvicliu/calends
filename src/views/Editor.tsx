import { useMemo, useState } from 'preact/hooks';
import { nthCharge, uid } from '../../shared/billing.ts';
import { CURRENCIES, money } from '../../shared/format.ts';
import type { AppState, Cycle, ShareMember, SubStatus, Subscription } from '../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { Cell, Group, Icon, Seg, Sheet, SubIcon, Toggle } from '../components/ui.tsx';
import { changePrice, syncLastPhase } from '../../shared/phases.ts';
import { ChangePanel } from '../components/ChangePanel.tsx';
import { api, deleteSub, run, saveSub } from '../store.ts';

const CYCLES: Array<[string, string, Cycle]> = [
  ['m1', '每月', { unit: 'month', every: 1 }],
  ['y1', '每年', { unit: 'year', every: 1 }],
  ['m3', '每季度', { unit: 'month', every: 3 }],
  ['m6', '每半年', { unit: 'month', every: 6 }],
  ['w1', '每周', { unit: 'week', every: 1 }],
  ['lt', '买断', { unit: 'lifetime', every: 1 }],
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

export function confirmDelete(msg: string): boolean {
  return window.confirm(msg);
}

export function Editor({ sub, state, today, onClose }: { sub: Subscription; state: AppState; today: string; onClose: () => void }) {
  const isNew = !state.subscriptions.some((s) => s.id === sub.id);
  const [f, setFRaw] = useState<Subscription>(structuredClone(sub));
  // 历程操作会改写价格；记录操作后的价格，用来判断表单里的价格是否又被手动改过
  const [basePrice, setBasePrice] = useState(sub.price);
  const setF = (next: Subscription) => {
    setFRaw(next);
    setBasePrice(next.price);
  };
  const up = (p: Partial<Subscription>) => setFRaw((x) => ({ ...x, ...p }));
  const cats = useMemo(() => [...new Set(state.subscriptions.map((s) => s.category))], [state]);

  const save = () =>
    run(
      async () => {
        let out: Subscription = { ...f, name: f.name.trim() };
        // 直接改了价格框：视为今天起调价，过往账单保持原价
        if (!isNew && basePrice !== out.price) out = changePrice(syncLastPhase({ ...out, price: basePrice }), today, out.price);
        else out = syncLastPhase(out);
        if (out.status === 'cancelled' && !out.end) out.end = today;
        if (out.status === 'paused' && !out.pausedAt) out.pausedAt = today;
        if (out.status !== 'paused') delete out.pausedAt;
        await saveSub(out);
        onClose();
      },
      isNew ? '已添加' : '已保存',
    );

  return (
    <Sheet
      title={isNew ? '添加订阅' : `编辑「${sub.name}」`}
      onClose={onClose}
      foot={
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
          <button class="btn" onClick={onClose}>
            取消
          </button>
          <button class="btn primary" disabled={!f.name.trim()} onClick={save}>
            {isNew ? '添加' : '完成'}
          </button>
        </>
      }
    >
      <Form f={f} up={up} state={state} cats={cats} today={today} />
      {!isNew && (
        <div style={{ marginTop: 18 }}>
          <ChangePanel f={f} setF={setF} state={state} today={today} />
        </div>
      )}
    </Sheet>
  );
}

function Form({ f, up, state, cats, today }: { f: Subscription; up: (p: Partial<Subscription>) => void; state: AppState; cats: string[]; today: string }) {
  const cycleKey = CYCLES.find(([, , c]) => c.unit === f.cycle.unit && c.every === f.cycle.every)?.[0] ?? 'custom';
  const share = f.share;
  const setShare = (p: Partial<NonNullable<Subscription['share']>> | null) => up({ share: p === null ? undefined : { role: 'owner', seats: 6, members: [], ...share, ...p } });
  const setMember = (i: number, p: Partial<ShareMember>) => setShare({ members: share!.members.map((m, j) => (j === i ? { ...m, ...p } : m)) });
  const perHead = share && share.seats > 0 ? Math.round((f.price / share.seats) * 100) / 100 : 0;
  const val = (e: Event) => (e.target as HTMLInputElement).value;

  return (
    <div class="stack" style={{ gap: 18 }}>
      <div class="row" style={{ justifyContent: 'center', padding: '6px 0 0' }}>
        <SubIcon sub={{ ...f, name: f.name || '?' }} size={64} />
      </div>
      <AppStoreSearch onPick={(r) => up({ name: f.name || r.name.split(/\s[-–—:：]\s?/)[0], icon: r.icon, url: r.url })} region={f.region} />
      <div class="form-cols">
        <div>
          <Group title="基本信息">
            <Cell label="名称">
              <input value={f.name} autoFocus={!f.name} placeholder="必填" onInput={(e) => up({ name: val(e) })} />
            </Cell>
            <Cell label="分类">
              <input list="cats" value={f.category} onInput={(e) => up({ category: val(e) })} />
              <datalist id="cats">
                {cats.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Cell>
            <Cell label="标签">
              <input value={f.tags.join(' ')} placeholder="空格分隔" onInput={(e) => up({ tags: val(e).split(/\s+/).filter(Boolean) })} />
            </Cell>
            <Cell label="网站">
              <input value={f.url ?? ''} placeholder="https://" onInput={(e) => up({ url: val(e) || undefined })} />
            </Cell>
            <Cell label="图标">
              <input value={f.icon ?? ''} placeholder="Emoji 或图片链接" onInput={(e) => up({ icon: val(e) || undefined })} />
            </Cell>
            <Cell label="地区">
              <input value={f.region ?? ''} placeholder="如 TR" onInput={(e) => up({ region: val(e).toUpperCase() || undefined })} />
            </Cell>
            {f.category === '域名' && (
              <Cell label="公开页显示域名" sub={f.showOnPublic ? '访客能看到完整域名' : '公开页打码显示'}>
                <Toggle checked={!!f.showOnPublic} onChange={(v) => up({ showOnPublic: v || undefined })} />
              </Cell>
            )}
          </Group>

          <Group title="首期优惠" foot={f.intro ? '截止日前按优惠价计费，之后恢复原价；提醒邮件会注明恢复原价。' : '如首年半价、首月 ¥1 等'}>
            <Cell label={<span class="row" style={{ gap: 6 }}><Icon name="leaf" /> 有首期优惠</span>}>
              <Toggle checked={!!f.intro} onChange={(v) => up({ intro: v ? { price: f.price, until: nthCharge(f.start, f.cycle.unit === 'lifetime' ? { unit: 'year', every: 1 } : f.cycle, 1) } : undefined })} />
            </Cell>
            {f.intro && (
              <>
                <Cell label="优惠价">
                  <input class="num" inputMode="decimal" value={f.intro.price} onInput={(e) => up({ intro: { ...f.intro!, price: Number(val(e)) || 0 } })} />
                </Cell>
                <Cell label="优惠截止">
                  <DatePicker value={f.intro.until} onChange={(v) => up({ intro: { ...f.intro!, until: v ?? today } })} />
                </Cell>
              </>
            )}
          </Group>

          <Group title="备注">
            <div class="cell">
              <span class="cell-r">
                <textarea value={f.notes ?? ''} placeholder="可选" onInput={(e) => up({ notes: (e.target as HTMLTextAreaElement).value || undefined })} />
              </span>
            </div>
          </Group>
        </div>

        <div>
          <Group title="计费">
            <Cell label="金额">
              <input class="num" inputMode="decimal" value={f.price || ''} placeholder="0.00" onInput={(e) => up({ price: Number(val(e)) || 0 })} />
            </Cell>
            <Cell label="币种">
              <select value={f.currency} onChange={(e) => up({ currency: val(e) })}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Cell>
            <Cell label="支付方式">
              <select value={f.methodId ?? ''} onChange={(e) => up({ methodId: val(e) || undefined })}>
                <option value="">未指定</option>
                {state.methods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Cell>
            <Cell label="周期">
              <select
                value={cycleKey}
                onChange={(e) => {
                  const c = CYCLES.find(([k]) => k === val(e));
                  if (c) up({ cycle: c[2] });
                  else up({ cycle: { unit: 'month', every: 2 } });
                }}
              >
                {CYCLES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
                <option value="custom">自定义…</option>
              </select>
            </Cell>
            {cycleKey === 'custom' && (
              <Cell label="每">
                <input class="num" style={{ width: 60 }} inputMode="numeric" value={f.cycle.every} onInput={(e) => up({ cycle: { unit: f.cycle.unit === 'lifetime' ? 'month' : f.cycle.unit, every: Math.max(1, Number(val(e)) || 1) } })} />
                <select value={f.cycle.unit} onChange={(e) => up({ cycle: { unit: val(e) as Cycle['unit'], every: f.cycle.every } })}>
                  <option value="day">天</option>
                  <option value="week">周</option>
                  <option value="month">个月</option>
                  <option value="year">年</option>
                </select>
              </Cell>
            )}
            <Cell label={f.cycle.unit === 'lifetime' ? '购买日期' : '开始日期'}>
              <DatePicker value={f.start} onChange={(v) => up({ start: v ?? today })} />
            </Cell>
          </Group>

          <Group title="状态">
            <div class="cell">
              <Seg value={f.status} onChange={(v) => up({ status: v })} options={STATUS} />
            </div>
            {f.status === 'trial' && (
              <Cell label="试用截止">
                <DatePicker value={f.trialEnd} clearable onChange={(v) => up({ trialEnd: v })} />
              </Cell>
            )}
            <Cell label="到期不续" sub="之后不再扣款">
              <DatePicker value={f.end} clearable placeholder="不设置" onChange={(v) => up({ end: v })} />
            </Cell>
          </Group>

          <Group title="提醒" foot={`默认提前 ${state.settings.remindDays} 天，在 ${String(state.settings.notifyHour).padStart(2, '0')}:05 发邮件。`}>
            <Cell label={<span class="row" style={{ gap: 6 }}><Icon name="bell" /> 提前天数</span>}>
              <select value={f.remindDays ?? ''} onChange={(e) => up({ remindDays: val(e) === '' ? undefined : Number(val(e)) })}>
                <option value="">默认（{state.settings.remindDays} 天）</option>
                <option value="0">到期当天</option>
                {[1, 2, 3, 5, 7, 14, 30].map((n) => (
                  <option key={n} value={n}>
                    提前 {n} 天
                  </option>
                ))}
                <option value="-1">不提醒</option>
              </select>
            </Cell>
          </Group>

          <Group title="拼车 / 分摊" foot={share?.role === 'member' ? '「金额」填你每期付给车主的那一份。' : share?.role === 'owner' ? `人均 ${money(perHead, f.currency)}，我的份额会自动扣除成员分摊。` : undefined}>
            <div class="cell">
              <Seg
                value={share ? share.role : 'none'}
                onChange={(v) => setShare(v === 'none' ? null : { role: v as 'owner' | 'member' })}
                options={[
                  ['none', '不拼'],
                  ['owner', '我是车主'],
                  ['member', '我上车'],
                ]}
              />
            </div>
            {share?.role === 'member' && (
              <Cell label="车主">
                <input value={share.ownerName ?? ''} placeholder="付给谁" onInput={(e) => setShare({ ownerName: val(e) || undefined })} />
              </Cell>
            )}
            {share?.role === 'owner' && (
              <>
                <Cell label="总席位（含自己）">
                  <input class="num" inputMode="numeric" value={share.seats} onInput={(e) => setShare({ seats: Math.max(1, Number(val(e)) || 1) })} />
                </Cell>
                {share.members.map((m, i) => (
                  <div key={m.id} class="member-edit">
                    <input value={m.name} placeholder={`成员 ${i + 1}`} onInput={(e) => setMember(i, { name: val(e) })} />
                    <input class="num" inputMode="decimal" value={m.share} title="每期份额" onInput={(e) => setMember(i, { share: Number(val(e)) || 0 })} />
                    <span class="wide">
                      <DatePicker value={m.paidUntil} clearable placeholder="已付至" onChange={(v) => setMember(i, { paidUntil: v })} />
                    </span>
                    <button class="icon-btn" style={{ width: 26, height: 26 }} aria-label="移除" onClick={() => setShare({ members: share.members.filter((_, j) => j !== i) })}>
                      <Icon name="x" />
                    </button>
                  </div>
                ))}
                {share.members.length < share.seats - 1 && (
                  <button class="cell tap" style={{ color: 'var(--accent)' }} onClick={() => setShare({ members: [...share.members, { id: uid(), name: '', share: perHead }] })}>
                    <Icon name="plus" /> 添加成员
                  </button>
                )}
              </>
            )}
          </Group>
        </div>
      </div>
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
  const [country, setCountry] = useState((region || 'cn').toLowerCase());
  const [hits, setHits] = useState<AppHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ results: AppHit[] }>(`/api/appstore/search?q=${encodeURIComponent(q)}&country=${country}`);
      setHits(r.results);
    } catch {
      setHits([]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group title="从 App Store 导入">
      <div class="cell" style={{ gap: 8 }}>
        <label class="search" style={{ background: 'var(--fill-2)' }}>
          <Icon name="search" />
          <input value={q} placeholder="搜索 App，或粘贴 App Store 链接" onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), search())} />
        </label>
        <select class="btn" value={country} onChange={(e) => setCountry((e.target as HTMLSelectElement).value)} aria-label="商店地区">
          {[
            ['cn', '中国'],
            ['us', '美国'],
            ['tr', '土耳其'],
            ['ng', '尼日利亚'],
            ['ph', '菲律宾'],
            ['hk', '香港'],
            ['jp', '日本'],
          ].map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <button class="btn primary" disabled={busy || !q.trim()} onClick={search}>
          {busy ? '搜索中' : '搜索'}
        </button>
      </div>
      {hits && hits.length === 0 && <div class="cell muted">没有找到</div>}
      {hits?.map((h) => (
        <button
          key={h.url}
          class="hit"
          onClick={() => {
            onPick(h);
            setHits(null);
            setQ('');
          }}
        >
          <SubIcon sub={{ name: h.name, icon: h.icon, category: '' }} size={36} />
          <span style={{ minWidth: 0 }}>
            <b>{h.name}</b>
            <small>{h.seller}</small>
          </span>
        </button>
      ))}
    </Group>
  );
}
