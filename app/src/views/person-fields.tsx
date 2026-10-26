import { PersonAvatar } from '../components/PersonAvatar.tsx';
import { t } from '../../../shared/i18n.ts';
import { personLink } from '../../../shared/people.ts';
import { type AppState, type Person } from '../../../shared/types.ts';
import { Picker } from '../components/Picker.tsx';
import { Icon } from '../components/icons.tsx';
import { Seg } from '../components/inputs.tsx';
import { go } from '../router.ts';
import { savePerson } from '../store.ts';
import { contactText } from '../components/Contact.tsx';
import './people-list.css';

export function PersonPicker({ state, value, onPick }: { state: AppState; value?: string; onPick: (p: Person | undefined) => void }) {
  const people = [...(state.people ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Picker
      value={value && people.some((p) => p.id === value) ? value : ''}
      search={people.length > 6}
      ariaLabel={t('people.pick.aria')}
      onChange={(v) => onPick(people.find((p) => p.id === v))}
      options={[
        { value: '', label: t('people.pick.new'), icon: <Icon name="plus" size={14} /> },
        ...people.map((p) => ({ value: p.id, label: p.name, hint: contactText(p) || undefined, icon: <PersonAvatar p={p} size={20} /> })),
      ]}
    />
  );
}

/**
 * 保存成员 / 代付之前调用：按 personLink 的规则关联已有的人（含同名复用），还没建档的先建档，返回 personId；
 * 已有的人改了称呼或联系方式时返回 after，等订阅保存后再 savePerson，把改动同步到其他地方。
 */
export async function linkPerson(
  state: AppState,
  personId: string | undefined,
  name: string,
  contactVia: string | undefined,
  contact: string | undefined,
): Promise<{ id?: string; after?: Person }> {
  const link = personLink(state.people ?? [], { personId, name, contactVia, contact });
  if (link.created) await savePerson(link.created);
  return { id: link.id, after: link.after };
}

/** 合租页顶部的分段：合租 / 人 */
export function FamilyTabs({ tab }: { tab: 'plans' | 'people' }) {
  return (
    <Seg
      small
      value={tab}
      onChange={(v) => go(v === 'people' ? 'family/people' : 'family')}
      options={[
        ['plans', t('people.tab.plans')],
        ['people', t('people.tab.people')],
      ]}
    />
  );
}
