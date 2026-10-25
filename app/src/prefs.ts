import { useSyncExternalStore } from 'react';
import { storageKey } from './base.ts';
import { PREF_KEYS, type PrefKey } from '../../shared/prefs.ts';
import type { AppState } from '../../shared/types.ts';
type PreferenceAdapter = {
  state: () => AppState | undefined;
  noteEdit: (key: PrefKey) => void;
  notify: () => void;
  replacePrefs: (prefs: NonNullable<AppState['prefs']>) => void;
  queuePrefs: (patch: Record<string, string | null>) => void;
};
let adapter: PreferenceAdapter | undefined;
const listeners = new Set<() => void>();
export function configurePrefs(value: PreferenceAdapter) {
  adapter = value;
}
export function notifyPrefs() {
  listeners.forEach((fn) => fn());
}
function subscribePrefs(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
const PREF_LS = (k: string) => storageKey(`ledger:${k}`);
const PREF_MIGRATED = storageKey('ledger:prefs:migrated');

export function mirrorPrefs(state: AppState | undefined) {
  if (!state || state.readonly) return;
  try {
    for (const key of PREF_KEYS) {
      const value = state.prefs?.[key];
      if (value == null) localStorage.removeItem(PREF_LS(key));
      else localStorage.setItem(PREF_LS(key), value);
    }
  } catch {
    /* Private browsing. */
  }
}

function localPref(key: PrefKey): string | null {
  try {
    return localStorage.getItem(PREF_LS(key));
  } catch {
    return null;
  }
}

export function writePref(key: PrefKey, value: string | null) {
  adapter?.noteEdit(key);
  try {
    if (value == null) localStorage.removeItem(PREF_LS(key));
    else localStorage.setItem(PREF_LS(key), value);
  } catch {
    /* 隐私模式等 */
  }
  const st = adapter?.state();
  if (!st) return adapter ? adapter.notify() : notifyPrefs();
  const prefs = { ...st.prefs };
  if (value == null) delete prefs[key];
  else prefs[key] = value;
  adapter!.replacePrefs(prefs);
  if (!st.readonly) adapter!.queuePrefs({ [key]: value });
}

export function migratePrefs(state: AppState | undefined) {
  try {
    if (localStorage.getItem(PREF_MIGRATED)) return;
    localStorage.setItem(PREF_MIGRATED, '1');
  } catch {
    /* Private browsing. */
  }
  const patch: Record<string, string> = {};
  for (const k of PREF_KEYS) {
    if (state?.prefs?.[k] != null) continue;
    try {
      const v = localStorage.getItem(PREF_LS(k));
      if (v != null) patch[k] = v;
    } catch {
      return;
    }
  }
  if (!Object.keys(patch).length) return;
  return patch;
}

export function usePref<T extends string>(key: PrefKey, fallback: T, valid?: (v: string) => v is T): [T, (v: T | null) => void] {
  // 订阅实际偏好值；公开页没有 state 时，本机值变化也必须提供新的快照。
  const raw = useSyncExternalStore(subscribePrefs, () => (adapter?.state() ? (adapter.state()!.prefs?.[key] ?? null) : localPref(key)));
  const value = raw != null && (!valid || valid(raw)) ? (raw as T) : fallback;
  return [value, (v) => writePref(key, v)];
}
