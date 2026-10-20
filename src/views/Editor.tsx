import { useRef, useState } from 'react';
import { addDays, addMonths, nextCharge, nthCharge, uid } from '../../shared/billing.ts';
import { cnDateFull, money } from '../../shared/format.ts';
import { t } from '../../shared/i18n.ts';
import type { AppState, Cycle, ShareMember, SubStatus, Subscription } from '../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { CatIcon, Cell, Group, Icon, Seg, Sheet, SubIcon, Toggle } from '../components/ui.tsx';
import { categories, isDomainCat, presetCat } from '../derive.ts';
import { CategorySheet } from './Categories.tsx';
import { changePrice, syncPhase, toEditForm } from '../../shared/phases.ts';
import { ChangePanel, cycleName, CYCLES as RENEW_CYCLES } from '../components/ChangePanel.tsx';
import { MethodPicker } from '../components/MethodPicker.tsx';
import { ContactField } from './Members.tsx';
import { api, deleteSub, getState, mergeEdits, run, savePerson, saveSub } from '../store.ts';
import { linkPerson, PersonPicker } from './People.tsx';
import { CurrencySelect, Picker, RegionSelect } from '../components/Picker.tsx';
import { searchCatalog, type CatalogItem } from '../catalog.ts';

const CYCLES: Array<[string, Cycle]> = [...RENEW_CYCLES, ['lt', { unit: 'lifetime', every: 1 }]];

const STATUS: SubStatus[] = ['active', 'trial', 'paused', 'cancelled'];

export function newSub(today: string, methodId?: string, currency = 'USD'): Subscription {
  return {
    id: uid(),
    name: '',
    category: presetCat('tools'),
    tags: [],
    price: 0,
    currency,
    cycle: { unit: 'month', every: 1 },
    start: today,
    status: 'active',
    methodId,
  };
}

export function confirmDelete(msg: string): boolean {
  return window.confirm(msg);
}

export function Editor({ sub, state, today, onClose }: { sub: Subscription; state: AppState; today: string; onClose: () => void }) {
  const isNew = !state.subscriptions.some((s) => s.id === sub.id);
  // 有多个阶段时，表单显示今天所在的阶段
  const [f, setFRaw] = useState<Subscription>(() => toEditForm(structuredClone(sub), today));
  // 历程操作会改写价格；记录操作后的价格，用来判断表单里的价格是否又被手动改过
  const [basePrice, setBasePrice] = useState(f.price);
  const setF = (next: Subscription) => {
    const form = toEditForm(next, today);
    setFRaw(form);
    setBasePrice(form.price);
  };
  const up = (p: Partial<Subscription>) => setFRaw((x) => ({ ...x, ...p }));
  // 有未保存的修改时，关闭前确认一下
  const [initial] = useState(() => JSON.stringify(f));
  const close = () => (JSON.stringify(f) === initial || confirmDelete(t('editor.confirmDiscard'))) && onClose();

  const save = () =>
    run(
      async () => {
        let out: Subscription = { ...f, name: f.name.trim() };
        // 直接改了价格框：视为今天起调价，过往账单保持原价
        if (!isNew && basePrice !== out.price) out = changePrice(syncPhase({ ...out, price: basePrice }, today), today, out.price);
        else out = syncPhase(out, today);
        if (out.status === 'cancelled' && !out.end) out.end = today;
        if (out.status === 'paused' && !out.pausedAt) out.pausedAt = today;
        if (out.status !== 'paused') delete out.pausedAt;
        // 代付对象：新的人先建档，已有的人改了资料等订阅保存后再同步
        const px = out.proxy;
        const link: Awaited<ReturnType<typeof linkPerson>> = px
          ? await linkPerson(state, px.personId, px.forName, px.contact ? (px.contactVia ?? 'Telegram') : undefined, px.contact)
          : {};
        if (px) out = { ...out, proxy: { ...px, forName: px.forName.trim(), personId: link.id } };
        await saveSub(
          isNew
            ? out
            : mergeEdits(
                sub,
                out,
                getState().subscriptions.find((x) => x.id === sub.id),
              ),
        );
        if (link.after) await savePerson(link.after);
        onClose();
      },
      t(isNew ? 'editor.toast.added' : 'editor.toast.saved'),
    );

  return (
    <Sheet
      narrow
      title={isNew ? t('editor.addTitle') : t('editor.editTitle', { name: sub.name })}
      onClose={close}
      foot={
        <>
          {!isNew && (
            <button
              className="btn danger"
              onClick={() =>
                confirmDelete(t('editor.confirmDelete', { name: sub.name })) &&
                run(
                  async () => {
                    await deleteSub(sub.id);
                    onClose();
                  },
                  // 删了还能撤销：把删掉的订阅原样存回去
                  { text: t('editor.toast.deleted'), action: { label: t('ui.undo'), onClick: () => void run(() => saveSub(sub), t('ui.restored')) } },
                )
              }
            >
              {t('common.delete')}
            </button>
          )}
          <span className="grow" />
          <button className="btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!f.name.trim()} onClick={save}>
            {isNew ? t('common.add') : t('common.done')}
          </button>
        </>
      }
    >
      <Form f={f} up={up} state={state} today={today} />
      {!isNew && (
        <div style={{ marginTop: 18 }}>
          <ChangePanel f={f} setF={setF} state={state} today={today} />
        </div>
      )}
    </Sheet>
  );
}

function Form({ f, up, state, today }: { f: Subscription; up: (p: Partial<Subscription>) => void; state: AppState; today: string }) {
  const cycleKey = CYCLES.find(([, c]) => c.unit === f.cycle.unit && c.every === f.cycle.every)?.[0] ?? 'custom';
  const share = f.share;
  const setShare = (p: Partial<NonNullable<Subscription['share']>> | null) =>
    up({ share: p === null ? undefined : { role: 'owner', seats: 6, members: [], ...share, ...p } });
  const setMember = (i: number, p: Partial<ShareMember>) => setShare({ members: share!.members.map((m, j) => (j === i ? { ...m, ...p } : m)) });
  const perHead = share && share.seats > 0 ? Math.round((f.price / share.seats) * 100) / 100 : 0;
  const val = (e: { target: EventTarget | null }) => (e.target as HTMLInputElement).value;
  const method = state.methods.find((m) => m.id === f.methodId);
  // 「更多选项」里有内容时默认展开，并在标题上列出已设置的项
  // 买断是一次性的：没有续费、状态、到期、提醒、优惠期这些概念，表单里不显示
  const lt = f.cycle.unit === 'lifetime';
  const extras = [
    f.intro && t('editor.more.intro'),
    f.bonus && t('editor.more.bonus'),
    f.remindDays != null && t('editor.more.remind'),
    (f.url || f.manageUrl) && t('editor.more.links'),
    f.tags.length > 0 && t('editor.more.tags'),
    f.notes && t('editor.more.notes'),
  ].filter(Boolean) as string[];
  const [more, setMore] = useState(extras.length > 0);
  // 分类表的顺序；表单里的分类万一不在表里（刚被删掉），也留着它
  const catOptions = [...new Set([...categories().map((c) => c.name), f.category].filter(Boolean))];
  const [newCat, setNewCat] = useState(false);

  return (
    <div className="ed">
      {/* 一、是什么：图标 + 名称（输入时联想 App Store）+ 分类 */}
      <div className="ed-id">
        <SubIcon sub={{ ...f, name: f.name || '?' }} size={64} />
        <div className="ed-id-main">
          <NameField
            value={f.name}
            region={(f.region || method?.region || 'us').toLowerCase()}
            onChange={(name) => up({ name })}
            onPick={(h) =>
              up({
                // 「Spotify: Music and Podcasts」只取冒号、破折号前的产品名
                name: h.name.split(/\s*[:：|]\s*|\s[-–—]\s/)[0].trim(),
                icon: h.icon,
                url: f.url || h.url,
                // 只有粘贴的链接里带了地区才填，按名称搜时不猜
                ...(h.fromLink && !f.region && h.country !== 'cn' ? { region: h.country!.toUpperCase() } : {}),
                // 分类按 App Store 的类别给个默认值，已经选过的不动
                ...(!f.name.trim() || f.category === presetCat('tools') ? { category: GENRE_CAT[h.genre] ? presetCat(GENRE_CAT[h.genre]) : f.category } : {}),
              })
            }
            onPickCatalog={(c) => up({ name: c.name, icon: c.icon, url: f.url || c.url, category: c.category })}
          />
          <div className="ed-id-sub">
            <Picker
              value={f.category}
              onChange={(c) => (c === '__new' ? setNewCat(true) : up({ category: c }))}
              options={[
                ...catOptions.map((c) => ({ value: c, label: c, icon: <CatIcon cat={c} size={14} /> })),
                { value: '__new', label: t('editor.category.new'), icon: <Icon name="plus" size={14} /> },
              ]}
              ariaLabel={t('editor.field.category')}
              display={
                <>
                  <CatIcon cat={f.category} size={13} />
                  <span>{f.category || t('editor.category.choose')}</span>
                </>
              }
            />
          </div>
        </div>
      </div>

      {/* 二、怎么付钱 */}
      <Group title={t('editor.group.billing')}>
        <Cell label={t('editor.field.amount')}>
          <span className="ed-amount">
            <input className="num" inputMode="decimal" value={f.price || ''} placeholder="0.00" onChange={(e) => up({ price: Number(val(e)) || 0 })} />
            <CurrencySelect value={f.currency} onChange={(c) => up({ currency: c })} />
          </span>
        </Cell>
        <Cell label={t('editor.field.cycle')}>
          <Picker
            value={cycleKey}
            onChange={(k) => {
              const c = CYCLES.find(([key]) => key === k);
              if (c) up({ cycle: c[1] });
              else up({ cycle: { unit: 'month', every: 2 } });
            }}
            options={[...CYCLES.map(([k]) => ({ value: k, label: cycleName(k) })), { value: 'custom', label: cycleName('custom') }]}
            ariaLabel={t('editor.field.cycle')}
          />
        </Cell>
        {cycleKey === 'custom' && (
          <Cell label={t('editor.unit.every')}>
            <input
              className="num"
              style={{ width: 60 }}
              inputMode="numeric"
              value={f.cycle.every}
              onChange={(e) => up({ cycle: { unit: f.cycle.unit === 'lifetime' ? 'month' : f.cycle.unit, every: Math.max(1, Number(val(e)) || 1) } })}
            />
            <Picker
              value={f.cycle.unit}
              onChange={(u) => up({ cycle: { unit: u as Cycle['unit'], every: f.cycle.every } })}
              options={[
                { value: 'day', label: t('editor.unit.day', { count: f.cycle.every }) },
                { value: 'week', label: t('editor.unit.week', { count: f.cycle.every }) },
                { value: 'month', label: t('editor.unit.month', { count: f.cycle.every }) },
                { value: 'year', label: t('editor.unit.year', { count: f.cycle.every }) },
              ]}
              ariaLabel={t('editor.unit.label')}
            />
          </Cell>
        )}
        <Cell label={t('editor.field.method')}>
          <MethodPicker
            methods={state.methods}
            value={f.methodId}
            onChange={(id) =>
              up({
                methodId: id,
                ...(!f.region && state.methods.find((m) => m.id === id)?.region ? { region: state.methods.find((m) => m.id === id)!.region } : {}),
              })
            }
          />
        </Cell>
        <Cell label={t(f.cycle.unit === 'lifetime' ? 'editor.field.purchased' : 'editor.field.start')}>
          <DatePicker value={f.start} onChange={(v) => up({ start: v ?? today })} />
        </Cell>
        <Cell label={t('editor.field.region')}>
          <RegionSelect
            value={f.region}
            onChange={(r) => up({ region: r })}
            common={[
              ...new Set(
                [...state.subscriptions.flatMap((x) => [x.region, ...(x.phases ?? []).map((ph) => ph.region)]), ...state.methods.map((m) => m.region)].filter(
                  Boolean,
                ) as string[],
              ),
            ]}
          />
        </Cell>
      </Group>

      {/* 三、现在的状态 */}
      {!lt && (
        <Group title={t('editor.group.status')}>
          <div className="cell">
            <Seg value={f.status} onChange={(v) => up({ status: v })} options={STATUS.map((s) => [s, t(`editor.status.${s}`)] as [SubStatus, string])} />
          </div>
          {f.status === 'trial' && (
            <Cell label={t('editor.field.trialEnd')}>
              <DatePicker value={f.trialEnd} clearable onChange={(v) => up({ trialEnd: v })} />
            </Cell>
          )}
          <Cell label={t('editor.field.end')}>
            <DatePicker value={f.end} clearable placeholder={t('editor.field.notSet')} onChange={(v) => up({ end: v })} />
          </Cell>
        </Group>
      )}

      {/* 四、谁在用 */}
      <Group
        title={t('editor.group.who')}
        foot={
          f.proxy
            ? undefined
            : share?.role === 'member'
              ? t('editor.share.memberHint')
              : share?.role === 'owner'
                ? t('editor.share.perHead', { amount: money(perHead, f.currency) })
                : undefined
        }
      >
        <div className="cell">
          <Seg
            value={f.proxy ? 'proxy' : share ? share.role : 'none'}
            onChange={(v) =>
              v === 'proxy'
                ? up({ share: undefined, proxy: { forName: f.proxy?.forName ?? '', entries: f.proxy?.entries ?? [] } })
                : up({ proxy: undefined, share: v === 'none' ? undefined : { seats: 6, members: [], ...share, role: v as 'owner' | 'member' } })
            }
            options={[
              ['none', t('editor.share.none')],
              ['owner', t('editor.share.owner')],
              ['member', t('editor.share.member')],
              ['proxy', t('editor.share.proxy')],
            ]}
          />
        </div>
        {f.proxy && (
          <>
            {(state.people?.length ?? 0) > 0 && (
              <Cell label={t('people.field.person')}>
                <PersonPicker
                  state={state}
                  value={f.proxy.personId}
                  onPick={(p) =>
                    p
                      ? up({ proxy: { ...f.proxy!, personId: p.id, forName: p.name, contactVia: p.contactVia, contact: p.contact } })
                      : f.proxy!.personId && up({ proxy: { ...f.proxy!, personId: undefined, forName: '', contact: undefined } })
                  }
                />
              </Cell>
            )}
            <Cell label={t('editor.proxy.for')}>
              <input value={f.proxy.forName} placeholder={t('editor.proxy.forPlaceholder')} onChange={(e) => up({ proxy: { ...f.proxy!, forName: val(e) } })} />
            </Cell>
            <Cell label={t('editor.proxy.contact')}>
              <ContactField
                via={f.proxy.contactVia ?? 'Telegram'}
                value={f.proxy.contact}
                onVia={(v) => up({ proxy: { ...f.proxy!, contactVia: v } })}
                onChange={(c) => up({ proxy: { ...f.proxy!, contactVia: f.proxy!.contactVia ?? 'Telegram', contact: c || undefined } })}
              />
            </Cell>
            <Cell label={t('editor.field.notes')}>
              <input
                value={f.proxy.note ?? ''}
                placeholder={t('editor.proxy.notePlaceholder')}
                onChange={(e) => up({ proxy: { ...f.proxy!, note: val(e) || undefined } })}
              />
            </Cell>
          </>
        )}
        {share?.role === 'member' && (
          <Cell label={t('editor.share.ownerName')}>
            <input
              value={share.ownerName ?? ''}
              placeholder={t('editor.share.ownerPlaceholder')}
              onChange={(e) => setShare({ ownerName: val(e) || undefined })}
            />
          </Cell>
        )}
        {share?.role === 'owner' && (
          <>
            <Cell label={t('editor.share.seats')}>
              <input className="num" inputMode="numeric" value={share.seats} onChange={(e) => setShare({ seats: Math.max(1, Number(val(e)) || 1) })} />
            </Cell>
            {share.members.map((m, i) => (
              <div key={m.id} className="member-edit">
                <input value={m.name} placeholder={t('editor.share.memberN', { n: i + 1 })} onChange={(e) => setMember(i, { name: val(e) })} />
                <input
                  className="num"
                  inputMode="decimal"
                  value={m.share}
                  title={t('editor.share.perPeriod')}
                  onChange={(e) => setMember(i, { share: Number(val(e)) || 0 })}
                />
                <span className="wide">
                  <DatePicker value={m.paidUntil} clearable placeholder={t('editor.share.paidUntil')} onChange={(v) => setMember(i, { paidUntil: v })} />
                </span>
                <button
                  className="icon-btn"
                  style={{ width: 26, height: 26 }}
                  aria-label={t('editor.share.remove')}
                  onClick={() => setShare({ members: share.members.filter((_, j) => j !== i) })}
                >
                  <Icon name="x" />
                </button>
              </div>
            ))}
            {share.members.length < share.seats - 1 && (
              <button
                className="cell tap"
                style={{ color: 'var(--accent)' }}
                onClick={() => setShare({ members: [...share.members, { id: uid(), name: '', share: perHead }] })}
              >
                <Icon name="plus" /> {t('editor.share.addMember')}
              </button>
            )}
          </>
        )}
      </Group>

      {/* 五、不常用的：折叠起来，标题上列出已设置的项 */}
      <button type="button" className={`ed-more ${more ? 'open' : ''}`} onClick={() => setMore(!more)} aria-expanded={more}>
        <span>{t('editor.more.title')}</span>
        <small>{extras.length ? extras.join(' · ') : t(lt ? 'editor.more.summaryLt' : 'editor.more.summary')}</small>
        <Icon name="down" size={14} />
      </button>
      {more && (
        <>
          {!lt && (
            <>
              <Group title={t('editor.more.intro')}>
                <Cell
                  label={
                    <span className="row" style={{ gap: 6 }}>
                      <Icon name="leaf" /> {t('editor.intro.has')}
                    </span>
                  }
                >
                  <Toggle
                    checked={!!f.intro}
                    onChange={(v) =>
                      up({
                        intro: v
                          ? { price: f.price, until: nthCharge(f.start, f.cycle.unit === 'lifetime' ? { unit: 'year', every: 1 } : f.cycle, 1) }
                          : undefined,
                      })
                    }
                  />
                </Cell>
                {f.intro && (
                  <>
                    <Cell label={t('editor.intro.price')}>
                      <input
                        className="num"
                        inputMode="decimal"
                        value={f.intro.price}
                        onChange={(e) => up({ intro: { ...f.intro!, price: Number(val(e)) || 0 } })}
                      />
                    </Cell>
                    <Cell label={t('editor.intro.until')}>
                      <DatePicker value={f.intro.until} onChange={(v) => up({ intro: { ...f.intro!, until: v ?? today } })} />
                    </Cell>
                  </>
                )}
              </Group>
              <Group title={t('editor.more.bonus')} foot={f.bonus ? t('editor.bonus.resume', { date: cnDateFull(f.bonus.until) }) : undefined}>
                <Cell
                  label={
                    <span className="row" style={{ gap: 6 }}>
                      <Icon name="receipt" /> {t('editor.bonus.has')}
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
                    <Cell label={t('editor.bonus.from')}>
                      <DatePicker value={f.bonus.from} onChange={(v) => up({ bonus: { ...f.bonus!, from: v ?? today } })} />
                    </Cell>
                    <Cell label={t('editor.bonus.until')}>
                      <DatePicker value={f.bonus.until} onChange={(v) => up({ bonus: { ...f.bonus!, until: v ?? today } })} />
                    </Cell>
                    <div className="cell bonus-quick">
                      {(
                        [
                          ['d7', (d: string) => addDays(d, 7)],
                          ['m1', (d: string) => addMonths(d, 1)],
                          ['m3', (d: string) => addMonths(d, 3)],
                          ['m6', (d: string) => addMonths(d, 6)],
                          ['y1', (d: string) => addMonths(d, 12)],
                        ] as Array<[string, (d: string) => string]>
                      ).map(([l, fn]) => (
                        <button
                          key={l}
                          type="button"
                          className={`chip-btn ${f.bonus!.until === fn(f.bonus!.from) ? 'on' : ''}`}
                          onClick={() => up({ bonus: { ...f.bonus!, until: fn(f.bonus!.from) } })}
                        >
                          {t(`editor.bonus.quick.${l}`)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </Group>
              <Group title={t('editor.more.remind')}>
                <Cell
                  label={
                    <span className="row" style={{ gap: 6 }}>
                      <Icon name="bell" /> {t('editor.remind.days')}
                    </span>
                  }
                >
                  <Picker
                    value={f.remindDays == null ? '' : String(f.remindDays)}
                    onChange={(v) => up({ remindDays: v === '' ? undefined : Number(v) })}
                    options={[
                      { value: '', label: t('editor.remind.default', { count: state.settings.remindDays }) },
                      { value: '0', label: t('editor.remind.sameDay') },
                      ...[1, 2, 3, 5, 7, 14, 30].map((n) => ({ value: String(n), label: t('editor.remind.before', { count: n }) })),
                      { value: '-1', label: t('editor.remind.never') },
                    ]}
                    ariaLabel={t('editor.more.remind')}
                  />
                </Cell>
              </Group>
            </>
          )}
          <Group title={t('editor.group.links')}>
            <Cell label={t('editor.field.url')}>
              <input value={f.url ?? ''} placeholder="https://" onChange={(e) => up({ url: val(e) || undefined })} />
            </Cell>
            <Cell label={t('editor.field.manageUrl')}>
              <input value={f.manageUrl ?? ''} placeholder={t('editor.field.optional')} onChange={(e) => up({ manageUrl: val(e) || undefined })} />
            </Cell>
            <Cell label={t('editor.field.icon')}>
              <input value={f.icon ?? ''} placeholder={t('editor.field.auto')} onChange={(e) => up({ icon: val(e) || undefined })} />
            </Cell>
            {isDomainCat(f.category) && (
              <Cell label={t('editor.field.showDomain')} sub={t(f.showOnPublic ? 'editor.field.showDomainOn' : 'editor.field.showDomainOff')}>
                <Toggle label={t('editor.field.showDomain')} checked={!!f.showOnPublic} onChange={(v) => up({ showOnPublic: v || undefined })} />
              </Cell>
            )}
          </Group>
          <Group title={t('editor.group.tags')}>
            <Cell label={t('editor.more.tags')}>
              <input
                value={f.tags.join(' ')}
                placeholder={t('editor.field.tagsPlaceholder')}
                onChange={(e) => up({ tags: val(e).split(/\s+/).filter(Boolean) })}
              />
            </Cell>
            <div className="cell">
              <span className="cell-r">
                <textarea
                  value={f.notes ?? ''}
                  placeholder={t('editor.field.notesPlaceholder')}
                  onChange={(e) => up({ notes: (e.target as HTMLTextAreaElement).value || undefined })}
                />
              </span>
            </div>
          </Group>
        </>
      )}
      {newCat && <CategorySheet state={state} onClose={() => setNewCat(false)} onSaved={(name) => up({ category: name })} />}
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

/** App Store 类别 → 账本分类（内置分类代码） */
const GENRE_CAT: Record<string, string> = {
  Music: 'music',
  Entertainment: 'media',
  'Photo & Video': 'media',
  Productivity: 'productivity',
  Utilities: 'tools',
  'Developer Tools': 'developer',
  'Graphics & Design': 'design',
  Business: 'productivity',
  'Social Networking': 'social',
  Games: 'games',
  Education: 'education',
  Shopping: 'shopping',
  Lifestyle: 'daily',
  Finance: 'finance',
  'Health & Fitness': 'health',
  Medical: 'health',
  Books: 'news',
  'Magazines & Newspapers': 'news',
  News: 'news',
  Reference: 'education',
};

/**
 * 名称输入：边输入边联想 App Store 里的 App（按订阅地区的商店搜），选中带出名称、图标和链接。
 * 也可以直接粘贴 App Store 链接，地区从链接里读（apps.apple.com/tr/app/…），不用另外选。
 */
function NameField({
  value,
  region,
  onChange: onInput,
  onPick,
  onPickCatalog,
}: {
  value: string;
  region: string;
  onChange: (v: string) => void;
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
    <div className="ed-name">
      <input
        value={value}
        autoFocus={!value}
        placeholder={t('editor.name.placeholder')}
        onChange={(e) => {
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
          // 只关联想框，不让 Esc 冒泡去关整个编辑器
          e.preventDefault();
          e.stopPropagation();
        }}
      />
      {open && all.length > 0 && (
        <div className="ed-suggest" role="listbox">
          {all.map((x, i) => (
            <div key={x.c ? `c-${x.c.name}` : `h-${x.h!.url}`}>
              {i === 0 && x.c && <div className="ed-suggest-h">{t('editor.name.catalog')}</div>}
              {x.h && (i === 0 || all[i - 1].c) && (
                <div className="ed-suggest-h">
                  App Store · <img className="pk-flag" src={`/flags/${x.h.country}.png`} alt="" />
                </div>
              )}
              <button
                type="button"
                className={`hit ${i === hi ? 'hi' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => setHi(i)}
                onClick={() => pick(x)}
              >
                {x.c ? (
                  <span className="ed-cat-ico">
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
