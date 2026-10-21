import type { Prefs } from './prefs.ts';

export const SYNC_INTERVAL = 30_000;
export const CHECK_THROTTLE = 1000;
export const PREF_GRACE = 5000;

export function shouldPoll(phase: string, readonly: boolean | undefined, visible: boolean): boolean {
  return (phase === 'ready' || phase === 'offline') && !readonly && visible;
}

export function shouldCheck(now: number, lastCheck: number, writes: number, online: boolean): boolean {
  return online && writes === 0 && now - lastCheck >= CHECK_THROTTLE;
}

export function canApplySnapshot(startWrites: number, writes: number, startSeq: number, seq: number, rev?: number, known?: number): boolean {
  return startWrites === 0 && writes === 0 && startSeq === seq && rev !== undefined && (known === undefined || rev >= known);
}

/** Out-of-order local responses may acknowledge only a continuous range of own writes. */
export function advanceRevision(known: number | undefined, ranges: Array<{ from: number; rev: number }>): number | undefined {
  if (known === undefined) return known;
  let next = known;
  for (;;) {
    const end = Math.max(next, ...ranges.filter((r) => r.from <= next && r.rev >= next).map((r) => r.rev));
    if (end === next) return next;
    next = end;
  }
}

/** Protect only recently edited/unsent keys; unrelated remote preferences still follow. */
export function syncedPrefs(remote: Prefs, local: Prefs, edits: ReadonlyMap<string, number>, queued: Prefs | Record<string, string | null>, now: number) {
  const prefs = { ...remote };
  let retryAt = 0;
  for (const key of new Set([...edits.keys(), ...Object.keys(queued)])) {
    const until = (edits.get(key) ?? -Infinity) + PREF_GRACE;
    if (!(key in queued) && now >= until) continue;
    if (local[key] === remote[key]) continue;
    if (local[key] === undefined) delete prefs[key];
    else prefs[key] = local[key];
    retryAt = Math.max(retryAt, until);
  }
  return { prefs, retryAt };
}
