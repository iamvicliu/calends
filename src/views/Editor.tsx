import { useMemo, useRef, useState } from 'preact/hooks';
import { addDays, addMonths, nextCharge, nthCharge, uid } from '../../shared/billing.ts';
import { cnDateFull, money } from '../../shared/format.ts';
import type { AppState, Cycle, ShareMember, SubStatus, Subscription } from '../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { CAT_ICON, Cell, Group, Icon, Seg, Sheet, SubIcon, Toggle } from '../components/ui.tsx';
import { changePrice, syncLastPhase } from '../../shared/phases.ts';
import { ChangePanel } from '../components/ChangePanel.tsx';
import { MethodPicker } from '../components/MethodPicker.tsx';
import { ContactField } from './Members.tsx';
import { api, deleteSub, getState, mergeEdits, run, saveSub } from '../store.ts';
import { CurrencySelect, Picker, RegionSelect } from '../components/Picker.tsx';
import { searchCatalog, type CatalogItem } from '../catalog.ts';

const CYCLES: Array<[string, string, Cycle]> = [
  ['w1', '每周', { unit: 'week', every: 1 }],
  ['m1', '每月', { unit: 'month', every: 1 }],
  ['m3', '每季度', { unit: 'month', every: 3 }],
  ['m6', '每半年', { unit: 'month', every: 6 }],
  ['y1', '每年', { unit: 'year', every: 1 }],
  ['y2', '每两年', { unit: 'year', every: 2 }],
  ['lt', '买断', { unit: 'lifetime', every: 1 }],
];

const STATUS: Array<[SubStatus, string]> = [
  ['active', '计费中'],
  ['trial', '试用中'],
  ['paused', '已暂停'],
  ['cancelled', '已取消'],
];

export function newSub(today: string, methodId?: string): Subscription {
  return { id: uid(), name: '', category: '工具', tags: [], price: 0, currency: 'CNY', cycle: { unit: 'month', every: 1 }, start: today, status: 'active', methodId };
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
        await saveSub(
          isNew
            ? out
            : mergeEdits(
                sub,
                out,
                getState().subscriptions.find((x) => x.id === sub.id),
              ),
        );
        onClose();
      },
      isNew ? '已添加' : '已保存',
    );

  return (
    <Sheet
      narrow
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
  const method = state.methods.find((m) => m.id === f.methodId);
  // 「更多选项」里有内容时默认展开，并在标题上列出已设置的项
  // 买断是一次性的：没有续费、状态、到期、提醒、优惠期这些概念，表单里不显示
  const lt = f.cycle.unit === 'lifetime';
  const extras = [f.intro && '首期优惠', f.bonus && '赠送时长', f.remindDays != null && '提醒', (f.url || f.manageUrl) && '链接', f.tags.length > 0 && '标签', f.notes && '备注'].filter(
    Boolean,
  ) as string[];
  const [more, setMore] = useState(extras.length > 0);
  const catOptions = [...new Set([...cats, f.category].filter(Boolean))];

  return (
    <div class="ed">
      {/* 一、是什么：图标 + 名称（输入时联想 App Store）+ 分类 */}
      <div class="ed-id">
        <SubIcon sub={{ ...f, name: f.name || '?' }} size={64} />
        <div class="ed-id-main">
          <NameField
            value={f.name}
            region={(f.region || method?.region || 'us').toLowerCase()}
            onInput={(name) => up({ name })}
            onPick={(h) =>
              up({
                // 「Spotify: Music and Podcasts」只取冒号、破折号前的产品名
                name: h.name.split(/\s*[:：|]\s*|\s[-–—]\s/)[0].trim(),
                icon: h.icon,
                url: f.url || h.url,
                // 只有粘贴的链接里带了地区才填，按名称搜时不猜
                ...(h.fromLink && !f.region && h.country !== 'cn' ? { region: h.country!.toUpperCase() } : {}),
                // 分类按 App Store 的类别给个默认值，已经选过的不动
                ...(!f.name.trim() || f.category === '工具' ? { category: GENRE_CAT[h.genre] ?? f.category } : {}),
              })
            }
            onPickCatalog={(c) => up({ name: c.name, icon: c.icon, url: f.url || c.url, category: c.category })}
          />
          <div class="ed-id-sub">
            <Picker
              value={f.category}
              onChange={(c) => (c === '__new' ? up({ category: window.prompt('新分类名称')?.trim() || f.category }) : up({ category: c }))}
              options={[
                ...catOptions.map((c) => ({ value: c, label: c, icon: <Icon name={CAT_ICON[c] ?? 'tag'} size={14} /> })),
                { value: '__new', label: '新建分类…', icon: <Icon name="plus" size={14} /> },
              ]}
              ariaLabel="分类"
              display={
                <>
                  <Icon name={CAT_ICON[f.category] ?? 'tag'} size={13} />
                  <span>{f.category || '选择分类'}</span>
                </>
              }
            />
          </div>
        </div>
      </div>

      {/* 二、怎么付钱 */}
      <Group title="计费">
        <Cell label="金额">
          <span class="ed-amount">
            <input class="num" inputMode="decimal" value={f.price || ''} placeholder="0.00" onInput={(e) => up({ price: Number(val(e)) || 0 })} />
            <CurrencySelect value={f.currency} onChange={(c) => up({ currency: c })} />
          </span>
        </Cell>
        <Cell label="周期">
          <Picker
            value={cycleKey}
            onChange={(k) => {
              const c = CYCLES.find(([key]) => key === k);
              if (c) up({ cycle: c[2] });
              else up({ cycle: { unit: 'month', every: 2 } });
            }}
            options={[...CYCLES.map(([k, l]) => ({ value: k, label: l })), { value: 'custom', label: '自定义…' }]}
            ariaLabel="周期"
          />
        </Cell>
        {cycleKey === 'custom' && (
          <Cell label="每">
            <input
              class="num"
              style={{ width: 60 }}
              inputMode="numeric"
              value={f.cycle.every}
              onInput={(e) => up({ cycle: { unit: f.cycle.unit === 'lifetime' ? 'month' : f.cycle.unit, every: Math.max(1, Number(val(e)) || 1) } })}
            />
            <Picker
              value={f.cycle.unit}
              onChange={(u) => up({ cycle: { unit: u as Cycle['unit'], every: f.cycle.every } })}
              options={[
                { value: 'day', label: '天' },
                { value: 'week', label: '周' },
                { value: 'month', label: '个月' },
                { value: 'year', label: '年' },
              ]}
              ariaLabel="单位"
            />
          </Cell>
        )}
        <Cell label="支付方式">
          <MethodPicker
            methods={state.methods}
            value={f.methodId}
            onChange={(id) => up({ methodId: id, ...(!f.region && state.methods.find((m) => m.id === id)?.region ? { region: state.methods.find((m) => m.id === id)!.region } : {}) })}
          />
        </Cell>
        <Cell label={f.cycle.unit === 'lifetime' ? '购买日期' : '开始日期'}>
          <DatePicker value={f.start} onChange={(v) => up({ start: v ?? today })} />
        </Cell>
        <Cell label="地区">
          <RegionSelect
            value={f.region}
            onChange={(r) => up({ region: r })}
            common={[...new Set([...state.subscriptions.flatMap((x) => [x.region, ...(x.phases ?? []).map((ph) => ph.region)]), ...state.methods.map((m) => m.region)].filter(Boolean) as string[])]}
          />
        </Cell>
      </Group>

      {/* 三、现在的状态 */}
      {!lt && (
        <Group title="状态">
          <div class="cell">
            <Seg value={f.status} onChange={(v) => up({ status: v })} options={STATUS} />
          </div>
          {f.status === 'trial' && (
            <Cell label="试用截止">
              <DatePicker value={f.trialEnd} clearable onChange={(v) => up({ trialEnd: v })} />
            </Cell>
          )}
          <Cell label="到期不续">
            <DatePicker value={f.end} clearable placeholder="不设置" onChange={(v) => up({ end: v })} />
          </Cell>
        </Group>
      )}

      {/* 四、谁在用 */}
      <Group title="谁在用" foot={f.proxy ? undefined : share?.role === 'member' ? '金额填你自己那一份' : share?.role === 'owner' ? `人均 ${money(perHead, f.currency)}` : undefined}>
        <div class="cell">
          <Seg
            value={f.proxy ? 'proxy' : share ? share.role : 'none'}
            onChange={(v) =>
              v === 'proxy'
                ? up({ share: undefined, proxy: { forName: f.proxy?.forName ?? '', entries: f.proxy?.entries ?? [] } })
                : up({ proxy: undefined, share: v === 'none' ? undefined : { seats: 6, members: [], ...share, role: v as 'owner' | 'member' } })
            }
            options={[
              ['none', '自用'],
              ['owner', '我发起'],
              ['member', '我加入'],
              ['proxy', '代付'],
            ]}
          />
        </div>
        {f.proxy && (
          <>
            <Cell label="替谁付">
              <input value={f.proxy.forName} placeholder="对方称呼" onInput={(e) => up({ proxy: { ...f.proxy!, forName: val(e) } })} />
            </Cell>
            <Cell label="联系方式">
              <ContactField
                via={f.proxy.contactVia ?? 'Telegram'}
                value={f.proxy.contact}
                onVia={(v) => up({ proxy: { ...f.proxy!, contactVia: v } })}
                onChange={(c) => up({ proxy: { ...f.proxy!, contactVia: f.proxy!.contactVia ?? 'Telegram', contact: c || undefined } })}
              />
            </Cell>
            <Cell label="备注">
              <input value={f.proxy.note ?? ''} placeholder="如：同事，月底转账" onInput={(e) => up({ proxy: { ...f.proxy!, note: val(e) || undefined } })} />
            </Cell>
          </>
        )}
        {share?.role === 'member' && (
          <Cell label="发起人">
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

      {/* 五、不常用的：折叠起来，标题上列出已设置的项 */}
      <button type="button" class={`ed-more ${more ? 'open' : ''}`} onClick={() => setMore(!more)} aria-expanded={more}>
        <span>更多选项</span>
        <small>{extras.length ? extras.join(' · ') : lt ? '链接、标签、备注' : '首期优惠、赠送时长、提醒、链接、标签、备注'}</small>
        <Icon name="down" size={14} />
      </button>
      {more && (
        <>
          {!lt && (
            <>
              <Group title="首期优惠">
                <Cell
                  label={
                    <span class="row" style={{ gap: 6 }}>
                      <Icon name="leaf" /> 有首期优惠
                    </span>
                  }
                >
                  <Toggle
                    checked={!!f.intro}
                    onChange={(v) => up({ intro: v ? { price: f.price, until: nthCharge(f.start, f.cycle.unit === 'lifetime' ? { unit: 'year', every: 1 } : f.cycle, 1) } : undefined })}
                  />
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
              <Group title="赠送时长" foot={f.bonus ? `${cnDateFull(f.bonus.until)} 起恢复扣款` : undefined}>
                <Cell
                  label={
                    <span class="row" style={{ gap: 6 }}>
                      <Icon name="receipt" /> 有赠送时长
                    </span>
                  }
                >
                  <Toggle
                    checked={!!f.bonus}
                    onChange={(v) => {
                      // 默认从下一次扣款日开始送一个周期
                      const from = f.cycle.unit === 'lifetime' ? today : (nextCharge(f, today) ?? nthCharge(f.start, f.cycle, 1));
                      up({ bonus: v ? { from, until: f.cycle.unit === 'lifetime' ? addMonths(from, 12) : nthCharge(from, f.cycle, 1) } : undefined });
                    }}
                  />
                </Cell>
                {f.bonus && (
                  <>
                    <Cell label="赠送开始">
                      <DatePicker value={f.bonus.from} onChange={(v) => up({ bonus: { ...f.bonus!, from: v ?? today } })} />
                    </Cell>
                    <Cell label="赠送到">
                      <DatePicker value={f.bonus.until} onChange={(v) => up({ bonus: { ...f.bonus!, until: v ?? today } })} />
                    </Cell>
                    <div class="cell bonus-quick">
                      {(
                        [
                          ['7 天', (d: string) => addDays(d, 7)],
                          ['1 个月', (d: string) => addMonths(d, 1)],
                          ['3 个月', (d: string) => addMonths(d, 3)],
                          ['半年', (d: string) => addMonths(d, 6)],
                          ['1 年', (d: string) => addMonths(d, 12)],
                        ] as Array<[string, (d: string) => string]>
                      ).map(([l, fn]) => (
                        <button key={l} type="button" class={`chip-btn ${f.bonus!.until === fn(f.bonus!.from) ? 'on' : ''}`} onClick={() => up({ bonus: { ...f.bonus!, until: fn(f.bonus!.from) } })}>
                          送 {l}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </Group>
              <Group title="提醒">
                <Cell
                  label={
                    <span class="row" style={{ gap: 6 }}>
                      <Icon name="bell" /> 提前天数
                    </span>
                  }
                >
                  <Picker
                    value={f.remindDays == null ? '' : String(f.remindDays)}
                    onChange={(v) => up({ remindDays: v === '' ? undefined : Number(v) })}
                    options={[
                      { value: '', label: `默认（${state.settings.remindDays} 天）` },
                      { value: '0', label: '到期当天' },
                      ...[1, 2, 3, 5, 7, 14, 30].map((n) => ({ value: String(n), label: `提前 ${n} 天` })),
                      { value: '-1', label: '不提醒' },
                    ]}
                    ariaLabel="提醒"
                  />
                </Cell>
              </Group>
            </>
          )}
          <Group title="链接与外观">
            <Cell label="网站">
              <input value={f.url ?? ''} placeholder="https://" onInput={(e) => up({ url: val(e) || undefined })} />
            </Cell>
            <Cell label="管理页">
              <input value={f.manageUrl ?? ''} placeholder="可选" onInput={(e) => up({ manageUrl: val(e) || undefined })} />
            </Cell>
            <Cell label="图标">
              <input value={f.icon ?? ''} placeholder="自动" onInput={(e) => up({ icon: val(e) || undefined })} />
            </Cell>
            {f.category === '域名' && (
              <Cell label="公开页显示域名" sub={f.showOnPublic ? '访客能看到完整域名' : '公开页打码显示'}>
                <Toggle checked={!!f.showOnPublic} onChange={(v) => up({ showOnPublic: v || undefined })} />
              </Cell>
            )}
          </Group>
          <Group title="标签与备注">
            <Cell label="标签">
              <input value={f.tags.join(' ')} placeholder="空格分隔" onInput={(e) => up({ tags: val(e).split(/\s+/).filter(Boolean) })} />
            </Cell>
            <div class="cell">
              <span class="cell-r">
                <textarea value={f.notes ?? ''} placeholder="备注，可选" onInput={(e) => up({ notes: (e.target as HTMLTextAreaElement).value || undefined })} />
              </span>
            </div>
          </Group>
        </>
      )}
    </div>
  );
}

interface AppHit {
  name: string;
  icon: string;
  url: string;
  seller: string;
  genre: string;
  /** 搜索用的商店地区，如 tr */
  country?: string;
  /** 地区是从粘贴的链接里读出来的 */
  fromLink?: boolean;
}

/** App Store 类别 → 账本分类 */
const GENRE_CAT: Record<string, string> = {
  Music: '音乐',
  Entertainment: '影音',
  'Photo & Video': '影音',
  Productivity: '效率',
  Utilities: '工具',
  'Developer Tools': '工具',
  Business: '效率',
  'Social Networking': '社交',
  Games: '游戏',
  Education: '教育',
  Shopping: '购物',
  Lifestyle: '日用',
  Finance: '日用',
  'Health & Fitness': '日用',
  Books: '教育',
  News: '影音',
  Reference: '教育',
};

/**
 * 名称输入：边输入边联想 App Store 里的 App（按订阅地区的商店搜），选中带出名称、图标和链接。
 * 也可以直接粘贴 App Store 链接，地区从链接里读（apps.apple.com/tr/app/…），不用另外选。
 */
function NameField({
  value,
  region,
  onInput,
  onPick,
  onPickCatalog,
}: {
  value: string;
  region: string;
  onInput: (v: string) => void;
  onPick: (h: AppHit) => void;
  onPickCatalog: (c: CatalogItem) => void;
}) {
  const [hits, setHits] = useState<AppHit[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const timer = useRef(0);
  const seq = useRef(0);
  // 常用服务（本地目录）马上出；App Store 的结果随后补在下面
  const local = /apps\.apple\.com\//i.test(value) ? [] : searchCatalog(value);
  const all: Array<{ c?: CatalogItem; h?: AppHit }> = [...local.map((c) => ({ c })), ...hits.map((h) => ({ h }))];
  const search = (q: string) => {
    window.clearTimeout(timer.current);
    const term = q.trim();
    setHi(0);
    setOpen(true);
    if (term.length < 2) return setHits([]);
    const fromLink = term.match(/apps\.apple\.com\/([a-z]{2})\//i)?.[1]?.toLowerCase();
    const country = fromLink ?? region;
    timer.current = window.setTimeout(async () => {
      const n = ++seq.current;
      try {
        const r = await api<{ results: AppHit[] }>(`/api/appstore/search?q=${encodeURIComponent(term)}&country=${country}`);
        if (n === seq.current) setHits(r.results.slice(0, 5).map((h) => ({ ...h, country, fromLink: !!fromLink })));
      } catch {
        /* 联想失败不影响手动输入 */
      }
    }, 350);
  };
  const pick = (x: { c?: CatalogItem; h?: AppHit }) => {
    if (x.c) onPickCatalog(x.c);
    else onPick(x.h!);
    setOpen(false);
    setHits([]);
  };
  return (
    <div class="ed-name">
      <input
        value={value}
        autoFocus={!value}
        placeholder="名称，或粘贴 App Store 链接"
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          onInput(v);
          search(v);
        }}
        onFocus={() => all.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !all.length) return;
          if (e.key === 'ArrowDown') setHi((i) => Math.min(all.length - 1, i + 1));
          else if (e.key === 'ArrowUp') setHi((i) => Math.max(0, i - 1));
          else if (e.key === 'Enter') pick(all[hi]);
          else if (e.key === 'Escape') setOpen(false);
          else return;
          e.preventDefault();
        }}
      />
      {open && all.length > 0 && (
        <div class="ed-suggest" role="listbox">
          {all.map((x, i) => (
            <div key={x.c ? `c-${x.c.name}` : `h-${x.h!.url}`}>
              {i === 0 && x.c && <div class="ed-suggest-h">常用服务 · 带出 logo、分类和官网</div>}
              {x.h && (i === 0 || all[i - 1].c) && (
                <div class="ed-suggest-h">
                  App Store · <img class="pk-flag" src={`/flags/${x.h.country}.png`} alt="" />
                </div>
              )}
              <button type="button" class={`hit ${i === hi ? 'hi' : ''}`} onMouseDown={(e) => e.preventDefault()} onMouseMove={() => setHi(i)} onClick={() => pick(x)}>
                {x.c ? (
                  <span class="ed-cat-ico">
                    <img src={x.c.icon} alt="" />
                  </span>
                ) : (
                  <SubIcon sub={{ name: x.h!.name, icon: x.h!.icon, category: '' }} size={32} />
                )}
                <span style={{ minWidth: 0 }}>
                  <b>{x.c ? x.c.name : x.h!.name}</b>
                  <small>{x.c ? `${x.c.category} · ${x.c.url.replace(/^https?:\/\//, '')}` : `${x.h!.seller} · ${x.h!.genre}`}</small>
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
