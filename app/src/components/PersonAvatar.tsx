import { useState } from 'react';
import { colorFor } from '../../../shared/people.ts';
import type { AppState, Person } from '../../../shared/types.ts';
import './person-avatar.css';

export function personFor(state: AppState, personId: string | undefined, name: string): Person {
  return state.people?.find((p) => p.id === personId) ?? { id: personId ?? '', name };
}

/** Shared private-person image with a per-source load-failure fallback. */
export function PersonAvatar({ p, size = 36 }: { p: Pick<Person, 'name' | 'color' | 'id' | 'avatar'>; size?: number }) {
  const [failed, setFailed] = useState<string>();
  const source = /^data:image\/(png|webp);base64,/.test(p.avatar ?? '') ? p.avatar : undefined;
  return (
    <span className={`pp-ava c-${p.color ?? colorFor(p.id || p.name)}`} style={{ width: size, height: size, fontSize: 'var(--fs-1)' }} aria-hidden="true">
      {source && failed !== source ? (
        <img src={source} alt="" referrerPolicy="no-referrer" onError={() => setFailed(source)} />
      ) : (
        [...(p.name.trim() || '?')][0].toUpperCase()
      )}
    </span>
  );
}
