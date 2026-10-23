// 分类管理：设置里的「分类」列表（拖动排序、改名、换图标和颜色、删除并移走订阅），以及新建 / 编辑分类的弹层（订阅表单里「新建分类…」也用它）
import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useMemo, useState } from 'react';
import { CAT_COLORS, categoryColor, categoryCounts, type Category } from '../../../shared/categories.ts';
import { t } from '../../../shared/i18n.ts';
import type { AppState } from '../../../shared/types.ts';
import { CatGlyph } from '../components/CatGlyph.tsx';
import { CAT_ICON_GROUPS } from '../components/cat-icons.gen.ts';
import { Picker } from '../components/Picker.tsx';
import { IconButton, ask, Cell, Group, Icon, Sheet } from '../components/ui.tsx';
import { categories } from '../derive.ts';
import { run, saveCategories, toast } from '../store.ts';
import { useTextSearch } from '../use-search.ts';

/** 分类色块：分类色的浅底 + 同色图标 */
function CatTile({ cat, size = 30 }: { cat: Pick<Category, 'name' | 'icon' | 'color'>; size?: number }) {
  return (
    <span className="cat-tile" style={{ '--tint': categoryColor(cat, cat.name), '--s': `${size}px` } as Record<string, string>}>
      <CatGlyph icon={cat.icon} size={Math.round(size * 0.56)} />
    </span>
  );
}

/** 设置页里的入口：一行「管理分类」，右侧是前几个分类的图标 */
export function CategoriesGroup({ state }: { state: AppState }) {
  const [open, setOpen] = useState(false);
  const list = categories();
  return (
    <>
      <Group title={t('settings.cat.title')}>
        <Cell label={t('settings.cat.manage')} sub={t('settings.cat.count', { count: list.length })} onClick={() => setOpen(true)}>
          <span className="cat-peek">
            {list.slice(0, 5).map((c) => (
              <CatTile key={c.name} cat={c} size={22} />
            ))}
          </span>
        </Cell>
      </Group>
      {open && <CategoriesSheet state={state} onClose={() => setOpen(false)} />}
    </>
  );
}

function SortableRow({ cat, n, onOpen }: { cat: Category; n: number; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: cat.name });
  return (
    <div
      ref={setNodeRef as (el: HTMLDivElement | null) => void}
      className={`cell cat-row ${isDragging ? 'lifted' : ''}`}
      style={{ transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined, transition } as Record<string, string | undefined>}
    >
      <IconButton
        type="button"
        ref={setActivatorNodeRef as (el: HTMLButtonElement | null) => void}
        className="cat-grip"
        aria-label={t('settings.cat.dragHandle')}
        {...(attributes as unknown as Record<string, unknown>)}
        {...(listeners as Record<string, unknown>)}
      >
        <Icon name="grip" />
      </IconButton>
      <button type="button" className="cat-row-main" onClick={onOpen}>
        <CatTile cat={cat} />
        <span className="cat-row-name">{cat.name}</span>
        <span className="cat-row-n">{n ? t('settings.cat.subs', { count: n }) : t('settings.cat.unused')}</span>
        <Icon name="right" />
      </button>
    </div>
  );
}

/** 分类列表：拖动把手排序，点一行编辑 */
function CategoriesSheet({ state, onClose }: { state: AppState; onClose: () => void }) {
  const list = categories();
  const counts = useMemo(() => categoryCounts(state.subscriptions), [state.subscriptions]);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ro = !!state.readonly;
  return (
    <Sheet
      narrow
      title={t('settings.cat.title')}
      onClose={onClose}
      foot={
        !ro && (
          <>
            <span className="grow" />
            <button className="btn primary" onClick={() => setEditing('new')}>
              <Icon name="plus" /> {t('settings.cat.add')}
            </button>
          </>
        )
      }
    >
      <Group>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(e: DragEndEvent) => {
            if (!e.over || e.active.id === e.over.id) return;
            const names = list.map((c) => c.name);
            const next = arrayMove(list, names.indexOf(String(e.active.id)), names.indexOf(String(e.over.id)));
            run(() => saveCategories(next), t('settings.cat.toast.order'));
          }}
        >
          <SortableContext items={list.map((c) => c.name)} strategy={verticalListSortingStrategy} disabled={ro}>
            {list.map((c) => (
              <SortableRow key={c.name} cat={c} n={counts.get(c.name) ?? 0} onOpen={() => !ro && setEditing(c)} />
            ))}
          </SortableContext>
        </DndContext>
      </Group>
      {editing && <CategorySheet state={state} cat={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </Sheet>
  );
}

/** 图标选择：按主题分组、可搜索的线性图标。不提供 emoji：各系统显示不一致，Windows 上国旗等还会变成字母 */
function IconPicker({ value, onChange, tint }: { value?: string; onChange: (v: string) => void; tint: string }) {
  const [q, setQ] = useState('');
  const k = q.trim().toLowerCase();
  const matches = useTextSearch(Object.keys(CAT_ICON_GROUPS).map((g) => t(`settings.cat.group.${g}`)));
  const groups = Object.entries(CAT_ICON_GROUPS)
    .map(([g, names]) => {
      const label = t(`settings.cat.group.${g}`);
      // 按图标英文名搜，也按分组名搜（输入「出行」能找到车、飞机）
      return { g, label, names: k && !matches(k, label) ? names.filter((n) => n.replace(/-/g, ' ').includes(k)) : names };
    })
    .filter((x) => x.names.length);
  return (
    <div className="cat-picker" style={{ '--tint': tint } as Record<string, string>}>
      <label className="cp-search">
        <Icon name="search" />
        <input value={q} placeholder={t('settings.cat.search')} onChange={(e) => setQ((e.target as HTMLInputElement).value)} />
      </label>
      <div className="cat-icon-scroll">
        {groups.map((x) => (
          <section key={x.g}>
            <div className="cp-head">{x.label}</div>
            <div className="cat-grid">
              {x.names.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`cat-pick ${value === n ? 'on' : ''}`}
                  aria-pressed={value === n}
                  aria-label={n}
                  title={n}
                  onClick={() => onChange(n)}
                >
                  <CatGlyph icon={n} size={20} />
                </button>
              ))}
            </div>
          </section>
        ))}
        {!groups.length && <div className="cp-empty">{t('settings.cat.noMatch')}</div>}
      </div>
    </div>
  );
}

/**
 * 新建或编辑一个分类。改名会同步到该分类下的所有订阅；删除时把订阅移到另一个分类。
 * onSaved：保存后的分类名（订阅表单用它选中刚建的分类）。
 */
export function CategorySheet({ state, cat, onClose, onSaved }: { state: AppState; cat?: Category; onClose: () => void; onSaved?: (name: string) => void }) {
  const list = categories();
  const [name, setName] = useState(cat?.name ?? '');
  const [icon, setIcon] = useState(cat?.icon ?? 'tag');
  // 新分类默认取一个还没怎么用过的颜色
  const [color, setColor] = useState<string | undefined>(() => {
    if (cat) return cat.color;
    const used = new Map<string, number>(CAT_COLORS.map((c) => [c, 0]));
    for (const c of list) if (c.color && used.has(c.color)) used.set(c.color, used.get(c.color)! + 1);
    return [...used.entries()].sort((a, b) => a[1] - b[1])[0][0];
  });
  const n = cat ? state.subscriptions.filter((s) => s.category === cat.name).length : 0;
  const others = list.filter((c) => c.name !== cat?.name);
  const [deleting, setDeleting] = useState(false);
  const [target, setTarget] = useState(others[0]?.name ?? '');
  const tint = categoryColor({ name, color }, name || '?');

  const save = () => {
    const v = name.trim();
    if (!v) return toast(t('settings.cat.error.empty'), true);
    if (others.some((c) => c.name === v)) return toast(t('settings.cat.error.duplicate', { name: v }), true);
    const next: Category = { ...cat, name: v, icon, color };
    const renamed = !!cat && cat.name !== v;
    void run(async () => {
      const changed = await saveCategories(cat ? list.map((c) => (c.name === cat.name ? next : c)) : [...list, next], renamed ? { [cat.name]: v } : {});
      toast(changed ? t('settings.cat.toast.renamed', { count: changed }) : t(cat ? 'settings.cat.toast.saved' : 'settings.cat.toast.created'));
      onSaved?.(v);
      onClose();
    });
  };
  const remove = async () => {
    if (!cat) return;
    if (!n && !(await ask(t('settings.cat.confirmDelete', { name: cat.name })))) return;
    void run(async () => {
      await saveCategories(others, n ? { [cat.name]: target } : {});
      onClose();
    }, t('settings.cat.toast.deleted'));
  };

  return (
    <Sheet
      narrow
      title={t(cat ? 'settings.cat.edit' : 'settings.cat.add')}
      onClose={onClose}
      foot={
        <>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="cat-hero">
          <CatTile cat={{ name: name || '?', icon, color }} size={56} />
          <input
            className="cat-name"
            value={name}
            maxLength={40}
            placeholder={t('settings.cat.namePlaceholder')}
            aria-label={t('settings.cat.name')}
            autoFocus={!cat}
            onChange={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </div>
        <Group title={t('settings.cat.color')}>
          <div className="cat-swatches" role="radiogroup" aria-label={t('settings.cat.color')}>
            {CAT_COLORS.map((c, i) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`${t('settings.cat.color')} ${i + 1}`}
                className={`cat-swatch ${color === c ? 'on' : ''}`}
                style={{ '--tint': `var(--${c})` } as Record<string, string>}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </Group>
        <Group title={t('settings.cat.icon')}>
          <IconPicker value={icon} onChange={setIcon} tint={tint} />
        </Group>
        {cat && others.length > 0 && (
          <Group>
            {deleting && n > 0 && (
              <Cell label={t('settings.cat.moveTo', { count: n })}>
                <Picker
                  value={target}
                  onChange={setTarget}
                  options={others.map((c) => ({ value: c.name, label: c.name, icon: <CatGlyph icon={c.icon} size={14} /> }))}
                  ariaLabel={t('settings.cat.moveTo', { count: n })}
                />
              </Cell>
            )}
            <button
              className="cell tap"
              style={{ justifyContent: 'center', color: 'var(--red)' }}
              onClick={() => (n && !deleting ? setDeleting(true) : remove())}
            >
              {deleting && n > 0 ? t('common.delete') : t('settings.cat.delete')}
            </button>
          </Group>
        )}
      </div>
    </Sheet>
  );
}
