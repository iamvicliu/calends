import type { AppState } from './types.ts';

export interface ToolFailure {
  id: string;
  name: string;
  args: Record<string, unknown>;
  error: string;
}
export interface AssistantOutcome {
  status: 'complete' | 'partial' | 'limit';
  drafts: number;
  failures: Array<Pick<ToolFailure, 'id' | 'name' | 'error'>>;
}
export interface WriteVerification {
  status: 'verified' | 'unverified';
  fields: string[];
}

function canonical(value: unknown): string {
  return (
    JSON.stringify(value, (_key, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([k, x]) => x !== undefined && k !== 'updatedAt' && k !== 'createdAt')
              .sort(([a], [b]) => a.localeCompare(b)),
          )
        : v,
    ) ?? 'undefined'
  );
}

/** Only intended entity/setting changes are checked; unrelated concurrent edits are allowed. */
export function writeMismatches(before: AppState, expected: AppState, actual: AppState): string[] {
  const fields: string[] = [];
  for (const key of ['subscriptions', 'methods', 'people'] as const) {
    const a = new Map((before[key] ?? []).map((x) => [x.id, x]));
    const b = new Map((expected[key] ?? []).map((x) => [x.id, x]));
    const c = new Map((actual[key] ?? []).map((x) => [x.id, x]));
    for (const id of new Set([...a.keys(), ...b.keys()]))
      if (canonical(a.get(id)) !== canonical(b.get(id)) && canonical(b.get(id)) !== canonical(c.get(id))) fields.push(`${key}.${id}`);
  }
  for (const key of ['settings', 'prefs'] as const) {
    const a = (before[key] ?? {}) as Record<string, unknown>;
    const b = (expected[key] ?? {}) as Record<string, unknown>;
    const c = (actual[key] ?? {}) as Record<string, unknown>;
    for (const field of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (canonical(a[field]) !== canonical(b[field]) && canonical(b[field]) !== canonical(c[field])) fields.push(`${key}.${field}`);
  }
  return fields;
}

/** Recover a failed operation only when the same tool, target and dated operation succeeds. */
export function remainingFailures(failures: ToolFailure[], name: string, args: Record<string, unknown>, result: unknown): ToolFailure[] {
  const r = (result ?? {}) as {
    subscription?: { id?: string; name?: string };
    created?: { id?: string; name?: string };
    after?: { id?: string; name?: string };
    id?: string;
    name?: string;
  };
  const refs = (a: Record<string, unknown>): unknown[] => {
    const s = a.subscription;
    return typeof s === 'object' && s ? [(s as { id?: string }).id, (s as { name?: string }).name] : [s, a.method, a.person, a.name];
  };
  const identities = new Set(
    [...refs(args), r.subscription?.id, r.subscription?.name, r.created?.id, r.created?.name, r.after?.id, r.after?.name, r.id, r.name].filter(Boolean),
  );
  const selector = (a: Record<string, unknown>) =>
    Object.fromEntries([
      ...['action', 'member', 'at', 'from', 'original_from', 'date', 'replace', 'delete', 'charge', 'periods', 'top_up_index', 'top_up_action']
        .filter((k) => a[k] !== undefined)
        .map((k) => [k, a[k]]),
      ['fields', Object.keys((a.set ?? {}) as object).sort()],
    ]);
  return failures.filter((f) => {
    if (f.name !== name) return true;
    // Malformed JSON has no recoverable target/selector. A valid retry of that tool resolves it.
    if (!Object.keys(f.args).length) return false;
    if (canonical(selector(f.args)) !== canonical(selector(args))) return true;
    const targets = refs(f.args).filter(Boolean);
    return targets.length > 0 && !targets.some((target) => identities.has(target));
  });
}

/** Stop a dependent confirmation batch at the first failure or unverified write. */
export async function confirmInOrder<T>(items: T[], confirm: (item: T) => Promise<boolean>): Promise<void> {
  for (const item of items) if (!(await confirm(item))) break;
}
