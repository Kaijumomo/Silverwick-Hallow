// Centralised jinx table. Jinxes are pair-rule reminders that fire when both
// roles are in play together. We do NOT enforce them at runtime; the reason
// text is the rule, surfaced in setup, the storyteller grimoire, and the
// public display.
//
// Pairs are stored unordered: (a, b) and (b, a) are the same jinx. Lookup
// helpers normalize the order so callers don't need to.

import type { RoleId, Script } from "@/stores/types";

export type Jinx = {
  a: RoleId;
  b: RoleId;
  reason: string;
};

// Publisher toolmaker assets, pinned with the canonical role/night data.
import officialJinxes from "./canonical/jinxes.json";
export const JINXES: Jinx[] = officialJinxes.flatMap(role =>
  role.jinx.map(jinx => ({ a: role.id, b: jinx.id, reason: jinx.reason }))
);

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

function pairKey(a: RoleId, b: RoleId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const byPair = new Map<string, Jinx>();
for (const j of JINXES) byPair.set(pairKey(j.a, j.b), j);

export function jinxBetween(a: RoleId, b: RoleId): Jinx | undefined {
  return byPair.get(pairKey(a, b));
}

/**
 * Return all jinxes whose pair is fully present in `roleIds`. Order of `a`/`b`
 * inside each returned Jinx is arbitrary — render them by name, not position.
 */
export function activeJinxesFor(roleIds: Iterable<RoleId>): Jinx[] {
  const present = new Set(roleIds);
  const out: Jinx[] = [];
  for (const j of JINXES) {
    if (present.has(j.a) && present.has(j.b)) out.push(j);
  }
  return out;
}

/**
 * Convenience: jinxes for a script's character list, optionally augmented by
 * any extra ids (e.g. selected Lorics or Travellers in play).
 */
export function jinxesForScript(script: Script, extraIds: RoleId[] = []): Jinx[] {
  const ids = [
    ...script.characters.map((c) => c.id),
    ...(script.fabled ?? []).map((f) => f.id),
    ...extraIds,
  ];
  return activeJinxesFor(ids);
}
