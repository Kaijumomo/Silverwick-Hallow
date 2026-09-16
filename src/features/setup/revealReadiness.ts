import { shownRoleFilter } from "@/stores/identity";
import type { PlayerId, STPlayerRecord } from "@/stores/types";
import type { SetupContext } from "./setupContext";

export type RevealReadiness = {
  ready: boolean;
  readyCount: number;
  totalCount: number;
  /** Ordinary player ids whose shown identity still needs Storyteller
   * configuration before initial Reveal can complete. */
  pendingIds: PlayerId[];
};

function playerRevealReady(p: STPlayerRecord, context: SetupContext): boolean {
  if (!p.actualRole || !p.shownRole) return false;
  const shownDef = context.registry?.get(p.shownRole);
  if (!shownDef) return false;
  const filter = shownRoleFilter(p.behaviorMode);
  return !filter || filter(shownDef);
}

/**
 * The single domain-level readiness calculation for initial role Reveal.
 * For each occupied ordinary player: an actual role must exist, an intended
 * shown identity must be set, and — for a concealed identity (Drunk,
 * Marionette, Lunatic, ...) — that shown identity must satisfy the same
 * central policy PlayerDrawer's picker already constrains choices to (see
 * shownRoleFilter in stores/identity.ts). A normal role is ready the moment
 * Deal assigns it, since dealtIdentity() already set its shown identity.
 *
 * Reusable by the Setup UI, the revealRoles() command, tests, and (where
 * appropriate) projection safety — never re-derived independently.
 */
export function initialRevealReadiness(context: SetupContext): RevealReadiness {
  const { ordinary } = context;
  const pendingIds = ordinary.filter((p) => !playerRevealReady(p, context)).map((p) => p.id);
  return {
    ready: pendingIds.length === 0,
    readyCount: ordinary.length - pendingIds.length,
    totalCount: ordinary.length,
    pendingIds,
  };
}
