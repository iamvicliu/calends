import { useState, type CSSProperties } from 'react';
import { colorFor, isCustomColor } from '../../../shared/people.ts';
import type { AppState, Person } from '../../../shared/types.ts';
import './person-avatar.css';

export function personFor(state: AppState, personId: string | undefined, name: string): Person {
  return state.people?.find((p) => p.id === personId) ?? { id: personId ?? '', name };
}

/** Shared private-person image with a per-source load-failure fallback. */
export function PersonAvatar({ p, size = 36 }: { p: Pick<Person, 'name' | 'color' | 'id' | 'avatar'>; size?: number }) {
  const [failed, setFailed] = useState<string>();
  const source = /^data:image\/(png|webp);base64,/.test(p.avatar ?? '') ? p.avatar : undefined;
  // 预设色走主题里的 c-* 类（深色模式有各自的色阶）；色盘自选的直接当 --pc 用
  const color = p.color ?? colorFor(p.id || p.name);
  const custom = isCustomColor(color);
  return (
    <span
      className={`pp-ava ${custom ? '' : `c-${color}`}`}
      style={{ width: size, height: size, fontSize: 'var(--fs-1)', ...(custom ? { '--pc': color } : {}) } as CSSProperties}
      aria-hidden="true"
    >
      {source && failed !== source ? (
        <img src={source} alt="" referrerPolicy="no-referrer" onError={() => setFailed(source)} />
      ) : (
        [...(p.name.trim() || '?')][0].toUpperCase()
      )}
    </span>
  );
}
