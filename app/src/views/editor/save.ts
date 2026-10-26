import type { AppState, Subscription } from '../../../../shared/types.ts';
import { preserveRenewalHistory } from '../../../../shared/billing.ts';
import { changePrice, syncPhase } from '../../../../shared/phases.ts';
import { applyStopForm, type StopForm } from '../../../../shared/stop-form.ts';
import { applyCarRule, carRule, nextCollectionDay, sameRule } from '../../../../shared/carpool.ts';
import { mergeEdits } from '../../../../shared/ledger-edit.ts';
export function prepareEditorSave(sub: Subscription, f: Subscription, today: string, isNew: boolean, basePrice: number, stop?: StopForm): Subscription {
  let out: Subscription = { ...f, name: f.name.trim(), account: f.account?.trim() || undefined };
  if (!isNew) out = preserveRenewalHistory(sub, out, today);
  if (!isNew && basePrice !== out.price) out = changePrice(syncPhase({ ...out, price: basePrice }, today), today, out.price);
  else out = syncPhase(out, today);
  if (stop && out.cycle.unit !== 'lifetime') out = applyStopForm(out, stop, today);
  return out;
}

export function mergeEditorSave(
  state: AppState,
  sub: Subscription,
  out: Subscription,
  latest: Subscription | undefined,
  isNew: boolean,
  ruleFrom: string | undefined,
  today: string,
): Subscription {
  let final = isNew ? out : mergeEdits(sub, out, latest);
  // 合租：编辑器只管身份、席位、付给谁和收费标准；成员与收款以账本里最新的为准，收费标准改了按合租详情同一套规则同步给跟随车的成员
  if (!isNew && out.share && latest?.share && JSON.stringify(sub.share) !== JSON.stringify(out.share)) {
    const { members: _m, ...own } = out.share;
    final = { ...final, share: { ...latest.share, ...own, members: latest.share.members } };
    const rule = out.share.role === 'owner' ? out.share.rule : undefined;
    if (rule && !sameRule(rule, carRule(state, latest, today))) {
      // 新标准从下期收款日起执行；没改日期时按现在的节奏算
      const next = ruleFrom ?? nextCollectionDay(latest, rule.billEvery, today);
      const applied = applyCarRule(state, { ...final, share: { ...final.share!, rule: latest.share.rule } }, rule, next, today);
      final = { ...applied, share: { ...applied.share!, collectFrom: next } };
    }
  }

  return final;
}
