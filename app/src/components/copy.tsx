import type { ReactNode } from 'react';
import './copy.css';

/** Translation templates separate independent facts with newlines, never user-name punctuation. */
export function copyParts(value: ReactNode): ReactNode {
  if (typeof value !== 'string' || !value.includes('\n')) return value;
  return (
    <span className="copy-parts">
      {value.split('\n').map((part, i) => (
        <span key={i}>{part}</span>
      ))}
    </span>
  );
}
