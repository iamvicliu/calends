import { useState } from 'react';
import { todayIn } from '../../../shared/billing.ts';
import type { AppState, ShareMember, Subscription } from '../../../shared/types.ts';
import { ReceiptForm } from './MemberReceipt.tsx';
import { MemberForm } from './MemberForm.tsx';
import { memberStatus } from './member-status.ts';

/**
 * 合租成员的统一入口：任何地方点成员、点「收款」、点某一笔收款都打开它。
 * 欠款的成员先到收款表单（应收与实际收款），其余打开成员表单；两者可以互相切换，不再有第三套表单。
 */
export function MemberSheet({
  state,
  s,
  member,
  collect,
  editId,
  onClose,
  onOpenSub,
}: {
  state: AppState;
  s: Subscription;
  member?: ShareMember;
  /** 从「收款」进来：直接记一笔 */
  collect?: boolean;
  /** 从收款表点某一笔进来：直接打开这笔收款（或免收）的编辑 */
  editId?: string;
  onClose: () => void;
  /** 收款表单顶部「查看详情」：打开这条订阅的详情 */
  onOpenSub?: () => void;
}) {
  const today = todayIn(state.settings.timezone);
  // 保存后表单读账本里的最新数据：收款列表、已付至都以它为准
  const live = state.subscriptions.find((x) => x.id === s.id) ?? s;
  const m = member && (live.share?.members.find((x) => x.id === member.id) ?? member);
  const [view, setView] = useState<'member' | 'receipt'>(() => {
    if (!m) return 'member';
    if (editId) return 'receipt';
    const st = memberStatus(state, live, m, today);
    return collect || (!m.exempt && !st.gone && st.owe) ? 'receipt' : 'member';
  });
  if (m && view !== 'member')
    return <ReceiptForm state={state} s={live} member={m} editId={editId} onDone={onClose} onMember={() => setView('member')} onOpenSub={onOpenSub} />;
  return <MemberForm memberDialog={MemberSheet} state={state} s={live} member={m} onClose={onClose} />;
}
