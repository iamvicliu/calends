import { PersonAvatar, personFor } from './PersonAvatar.tsx';
import type { CSSProperties } from 'react';
import { memberAboard, memberDues } from '../../../shared/billing.ts';
import type { AppState, ShareMember, Subscription } from '../../../shared/types.ts';
import { t } from '../../../shared/i18n.ts';
import { base } from '../base.ts';
import './share-avatars.css';

/** 合租卡片和详情共用的成员头像；含自己最多六个位置，超出后用 +N。 */
export function ShareAvatars({
  sub,
  state,
  today,
  size = 20,
  overlap = 3,
  max = 6,
  onMember,
}: {
  sub: Subscription;
  state: AppState;
  today: string;
  size?: number;
  overlap?: number;
  max?: number;
  onMember?: (member: ShareMember) => void;
}) {
  const members = sub.share!.members.filter((m) => memberAboard(m, today));
  const dues = memberDues(sub, today, state.settings.collectCurrency ?? state.settings.baseCurrency, state);
  const limit = Math.max(2, max);
  const shown = members.slice(0, members.length + 1 > limit ? limit - 2 : limit - 1);
  const extra = members.length - shown.length;
  return (
    <div className="share-avatars" style={{ '--avatar-size': `${size}px`, '--avatar-overlap': `${overlap}px` } as CSSProperties}>
      <span className="seat me" title={t('family.pool.me')}>
        <img src={state.settings.avatar || base('/icons/avatar.png')} alt={t('family.pool.me')} />
      </span>
      {shown.map((m) => {
        const owe = dues.find((d) => d.member.id === m.id)?.periodsOwed;
        const props = {
          className: `seat ${m.exempt ? 'free' : owe ? 'owe' : 'on'}`,
          title: m.exempt ? t('family.pool.exemptTitle', { name: m.name }) : m.name || t('detail.share.unnamed'),
        };
        const avatar = <PersonAvatar p={personFor(state, m.personId, m.name || '?')} size={size} />;
        return onMember ? (
          <button key={m.id} type="button" {...props} onClick={() => onMember(m)}>
            {avatar}
          </button>
        ) : (
          <span key={m.id} {...props}>
            {avatar}
          </span>
        );
      })}
      {extra > 0 && (
        <span
          className="seat"
          title={members
            .slice(shown.length)
            .map((m) => m.name || t('detail.share.unnamed'))
            .join(', ')}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}
