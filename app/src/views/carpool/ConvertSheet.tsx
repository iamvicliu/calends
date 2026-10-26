import { useState } from 'react';
import { money } from '../../../../shared/format.ts';
import { t } from '../../../../shared/i18n.ts';
import type { AppState, Subscription } from '../../../../shared/types.ts';
import { FeeRuleFields } from '../member-fields.tsx';
import { carRule } from '../../../../shared/carpool.ts';
import type { CarRule } from '../../../../shared/types.ts';
import { Cell, Group } from '../../components/ui.tsx';
import { Seg, Stepper, useSubmit } from '../../components/inputs.tsx';
import { Sheet } from '../../components/overlays.tsx';
import { run } from '../../toast.ts';
import { saveSub } from '../../store.ts';

/** 常见家庭方案的席位数（含自己） */
export function defaultSeats(name: string): number {
  return /1password/i.test(name) ? 5 : 6;
}

/** 一步转为合租：选身份与席位，保存后在上面补成员 */
export function ConvertSheet({ state, s, today, onClose }: { state: AppState; s: Subscription; today: string; onClose: () => void }) {
  const [role, setRole] = useState<'owner' | 'member'>('owner');
  const [seats, setSeats] = useState(defaultSeats(s.name));
  const [ownerName, setOwnerName] = useState('');
  const perHead = seats > 0 ? s.price / seats : s.price;
  // 我发起时一起定收费标准：默认按价格和席位推算，改了就用改的（之后在合租详情的收费规则里也是这一份）
  const [rule, setRule] = useState<CarRule | null>(null);
  const shown = rule ?? carRule(state, { ...s, share: { role: 'owner', seats, members: [] } }, today);
  const [busy, submit] = useSubmit();
  return (
    <Sheet
      narrow
      title={t('family.convert.title', { name: s.name })}
      onClose={onClose}
      foot={
        <>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            {t('family.convert.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              submit(() =>
                run(
                  async () => {
                    await saveSub({
                      ...s,
                      share:
                        role === 'owner'
                          ? { role, seats, members: [], since: today, rule: shown }
                          : { role, seats, members: [], ownerName: ownerName.trim() || undefined, since: today },
                    });
                    onClose();
                  },
                  role === 'owner' ? t('family.convert.toastOwner') : t('family.convert.toastMember'),
                ),
              )
            }
          >
            {t('family.convert.submit')}
          </button>
        </>
      }
    >
      <div className="stack">
        <Seg
          value={role}
          onChange={setRole}
          options={[
            ['owner', t('family.convert.roleOwner')],
            ['member', t('family.convert.roleMember')],
          ]}
        />
        <Group foot={role === 'owner' ? t('family.convert.footOwner', { count: seats, amount: money(perHead, s.currency) }) : t('family.convert.footMember')}>
          <Cell label={t('family.convert.seats')}>
            <Stepper
              label={t('family.convert.seats')}
              value={seats}
              min={1}
              max={50}
              unit={(n) => t('family.convert.seatUnit', { count: n })}
              onChange={setSeats}
            />
          </Cell>
          {role === 'owner' && <FeeRuleFields value={shown} onChange={setRule} />}
          {role === 'member' && (
            <Cell label={t('family.convert.owner')}>
              <input value={ownerName} placeholder={t('family.convert.ownerPh')} onChange={(e) => setOwnerName((e.target as HTMLInputElement).value)} />
            </Cell>
          )}
        </Group>
      </div>
    </Sheet>
  );
}
