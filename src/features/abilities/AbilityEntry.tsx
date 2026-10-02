import { useMemo, useState } from "react";
import { buildRegistry } from "@/data/roleRegistry";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityDescriptor, type AbilitySemanticsRegistry, type AbilityTiming } from "@/abilities/semantics";
import { selectScriptById, useStorytellerStore } from "@/stores/storytellerStore";
import { wakeIdentity } from "@/stores/wakeIdentity";
import type { STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";
import { AbilityWorkspace } from "./AbilityWorkspace";
import { stepAbility } from "./abilityUi";

/**
 * Phase 10F (SOL-10F-L3): the Storyteller-private ability entry point for a
 * participant outside the Night Order -- the Day (e.g. a public Day claim), and
 * any Live Play moment. Progressive disclosure in the Player Drawer:
 * Abilities -> Use ability... -> the SAME AbilityWorkspace, the SAME
 * coordinator and the SAME one-commit resolveAbility. There is no second
 * (Day) resolver: timing applicability comes from the verified descriptor, and
 * anything unmodeled goes to the explicit Manual path.
 *
 * Rendered only inside the drawer body, which Privacy Mode replaces with a
 * privacy shell -- so the open workspace and every draft unmount with it.
 */

/** Descriptor timings that may act in the current Live Play phase. */
export function timingsForPhase(game: Pick<StorytellerLobbyRecord, "phase" | "day">): AbilityTiming[] {
  if (game.phase === "day") return ["day", "triggered", "passive"];
  if (game.phase === "night") return [game.day === 1 ? "firstNight" : "otherNight", "triggered", "passive"];
  return [];
}

export const actsNow = (descriptor: AbilityDescriptor, game: Pick<StorytellerLobbyRecord, "phase" | "day">): boolean =>
  descriptor.timing.some((timing) => timingsForPhase(game).includes(timing));

type Props = {
  player: STPlayerRecord;
  /** Verified semantics (defaults to the canonical registry; tests may pass fixtures). */
  semantics?: AbilitySemanticsRegistry;
};

export function AbilityEntry({ player, semantics = CANONICAL_ABILITY_SEMANTICS }: Props) {
  const game = useStorytellerStore((s) => s.game);
  const script = useStorytellerStore((s) => (game ? selectScriptById(s, game.scriptId) : undefined));
  const registry = useMemo(() => (script ? buildRegistry(script) : null), [script]);
  const [open, setOpen] = useState<"guided" | "manual" | null>(null);
  if (!game || !script || !registry || (game.phase !== "night" && game.phase !== "day")) return null;
  if (player.isEmpty || !player.participantId || !player.actualRole) return null;

  // The ability performed: the participant's own, or their simulated wake.
  const wake = wakeIdentity(player, registry);
  const roleId = wake?.simulated ? wake.shownRoleId : player.actualRole;
  const roleName = registry.get(roleId)?.name ?? roleId;
  const ability = stepAbility(roleId, registry, semantics);
  const descriptor = ability.kind === "guided" && actsNow(ability.descriptor, game) ? ability.descriptor : null;
  const unavailable = ability.kind === "guided" && !descriptor
    ? `${roleName} has no verified ${game.phase === "day" ? "Day" : "Night"} ability.`
    : ability.kind === "manual" ? ability.reason : null;

  return (
    <section className="drawer-section ability-entry">
      <details>
        <summary className="drawer-section-title">Abilities</summary>
        <div className="ability-entry-body">
          {descriptor ? (
            <button className="btn btn-sm btn-gold" onClick={() => setOpen("guided")}>Use ability… ({roleName})</button>
          ) : (
            <p className="behavior-help">{unavailable}</p>
          )}
          <button className="btn btn-sm" onClick={() => setOpen("manual")}>Resolve manually / unmodeled interaction</button>
        </div>
      </details>
      {open && (
        <AbilityWorkspace game={game} script={script} registry={registry} semantics={semantics}
          target={{ actorId: player.id, roleId, roleName }}
          descriptor={open === "guided" ? descriptor : null}
          manualReason={open === "manual" ? (unavailable ?? "") : ""}
          onClose={() => setOpen(null)}
          onResolved={() => setOpen(null)} />
      )}
    </section>
  );
}
