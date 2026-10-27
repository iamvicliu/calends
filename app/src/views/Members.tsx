import { useState } from 'react';
import type { AppState, ShareMember, Subscription } from '../../../shared/types.ts';
import { MemberForm } from './MemberForm.tsx';

/**
 * 合租成员的统一入口：任何地方点成员、点某一笔收款都打开同一个成员弹窗。
 * 打开时不自动弹收款表单，收款由弹窗里的「记收款」或点没结清的格子发起；从某笔收款进来时直接改那一笔；
 * 新成员勾了「保存后记收款」时，存好后换成这个成员并打开收款表单。
 * 存完或关掉回到同一个弹窗，已结清的成员也在这里记预收，不再分成两套界面。
 */
export function MemberSheet({
  state,
  s,
  member,
  editId,
  onClose,
  onOpenSub,
}: {
  state: AppState;
  s: Subscription;
  member?: ShareMember;
  /** 从收款表点某一笔进来：直接打开这笔收款（或免收）的编辑 */
  editId?: string;
  onClose: () => void;
  /** 收款表单顶部「查看详情」：打开这条订阅的详情 */
  onOpenSub?: () => void;
}) {
  // 保存后弹窗读账本里的最新数据：收款列表、各期状态都以它为准
  const live = state.subscriptions.find((x) => x.id === s.id) ?? s;
  // 新成员勾了「保存后记收款」：存好后这个弹窗换成刚建的成员，并叠上收款表单
  const [added, setAdded] = useState<string | null>(null);
  const id = member?.id ?? added;
  const m = id ? (live.share?.members.find((x) => x.id === id) ?? member) : undefined;
  const [initialReceipt] = useState(() => (m && editId ? { edit: editId } : null));
  // 账本还没带上刚建的成员时先不画，免得退回成一张空白的新成员表单
  if (added && !m) return null;
  return (
    <MemberForm
      key={id ?? 'new'}
      memberDialog={MemberSheet}
      state={state}
      s={live}
      member={m}
      initialReceipt={added ? {} : initialReceipt}
      onOpenSub={onOpenSub}
      onClose={onClose}
      onAdded={setAdded}
    />
  );
}
