// One-time Home -> Player join hand-off (Package 1).
//
// Home collects the player's name and lobby code, then opens the existing
// `?join=CODE` page. The name must never travel in the URL, so it is parked in
// sessionStorage for exactly one consumer: the existing join form.
//
// Guards against stale carry-over: the record is bound to the lobby code it was
// written for, expires quickly, is cleared as soon as the join screen mounts,
// and is also cleared whenever Home mounts.

import { canonicalJoin } from "@/firebase/lobby";

export const JOIN_PREFILL_KEY = "silverwick.joinPrefill.v1";
export const JOIN_PREFILL_TTL_MS = 2 * 60 * 1000;

type Stored = { name: string; code: string; at: number };

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Validates with the same rules the join itself uses, then stores. */
export function writeJoinPrefill(name: string, code: string, now = Date.now()): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const canonical = canonicalJoin(code, name);
    const record: Stored = { name: canonical.name, code: canonical.code, at: now };
    s.setItem(JOIN_PREFILL_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads (without clearing) the name pre-filled for `code`. Returns null for a
 * missing, malformed, expired or other-lobby record. Non-destructive so React
 * StrictMode's double initialisation cannot lose the value; callers clear it
 * from an effect via `clearJoinPrefill`.
 */
export function peekJoinPrefill(code: string | undefined, now = Date.now()): string | null {
  const s = storage();
  if (!s || !code) return null;
  try {
    const raw = s.getItem(JOIN_PREFILL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored> | null;
    if (!parsed || typeof parsed.name !== "string" || typeof parsed.code !== "string" || typeof parsed.at !== "number") return null;
    if (now - parsed.at > JOIN_PREFILL_TTL_MS || now < parsed.at) return null;
    const requested = canonicalJoin(code, parsed.name);
    if (requested.code !== parsed.code) return null;
    return requested.name;
  } catch {
    return null;
  }
}

export function clearJoinPrefill(): void {
  try {
    storage()?.removeItem(JOIN_PREFILL_KEY);
  } catch {
    /* storage unavailable: nothing to clear */
  }
}
