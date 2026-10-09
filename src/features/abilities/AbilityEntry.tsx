import { useMemo, useState } from "react";
import { buildRegistry } from "@/data/roleRegistry";
import { CANONICAL_ABILITY_SEMANTICS, type AbilitySemanticsRegistry } from "@/abilities/semantics";
import { selectScriptById, useStorytellerStore } from "@/stores/storytellerStore";
import { wakeIdentity } from "@/stores/wakeIdentity";
import type { STPlayerRecord } from "@/stores/types";
import { AbilityWorkspace } from "./AbilityWorkspace";
import { pathAbility } from "./abilityUi";
import { automationEligibility } from "@/abilities/automationEligibility";
import { createRulesQuery } from "@/stores/rulesQuery";

/**
 * Phase 10F (SOL-10F-L3): the Storyteller-private ability entry point for a
 * participant outside the Night Order. Progressive disclosure in the Player
 * Drawer: Abilities -> Use ability... -> the SAME AbilityWorkspace, the SAME
 * coordinator and the SAME one-commit resolveAbility. There is no second
 * (Day) resolver.
 *
 * SOL-10F-L3-R1: a guided ability is offered here only when the shared
 * invocation-eligibility contract (src/abilities/invocation.ts, the one the
 * coordinator enforces for the "dayEntry" path) admits it: Day phase, explicit
 * `day` timing, a `publicClaim` / `procedure` invocation. Triggered / passive
 * timing and invocation `none` are never offered; Night abilities run from the
 * Night Order. Anything else goes to the explicit Manual path, which stays
 * available in every live phase.
 *
 * Rendered only inside the drawer body, which Privacy Mode replaces with a
 * privacy shell -- so the open workspace and every draft unmount with it.
 */

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
  const [manualAction, setManualAction] = useState<string | null>(null);
  if (!game || !script || !registry || (game.phase !== "night" && game.phase !== "day")) return null;
  if (player.isEmpty || !player.participantId || !player.actualRole) return null;

  // The ability performed: the participant's own, or their simulated wake.
  const wake = wakeIdentity(player, registry);
  const roleId = wake?.simulated ? wake.shownRoleId : player.actualRole;
  const roleName = registry.get(roleId)?.name ?? roleId;
  const ability = pathAbility(roleId, registry, semantics, "dayEntry", game);
  const actionKey = `${game.code}:${game.day}:${game.phase}:${player.participantId}:${roleId}`;
  const descriptor = ability.kind === "guided" && manualAction !== actionKey && automationEligibility({
    query: createRulesQuery(game, { script, registry, semantics }), descriptor: ability.descriptor,
    actor: { playerId: player.id, participantId: player.participantId }, roleId, simulated: wake?.simulated,
  }).kind === "automated" ? ability.descriptor : null;
  const unavailable = ability.kind === "manual" ? `${roleName}: ${ability.reason}` : null;

  return (
    <section className="drawer-section ability-entry">
      <details>
        <summary className="drawer-section-title">Abilities</summary>
        <div className="ability-entry-body">
          {descriptor ? (
            <button className="btn btn-sm btn-gold" onClick={() => setOpen("guided")}>Use ability… ({roleName})</button>
          ) : (
            <p className="behavior-help">{registry.get(roleId)?.ability}</p>
          )}
          <details><summary>Advanced corrections</summary>
            <button className="btn btn-sm" onClick={() => setOpen("manual")}>Record outcome…</button>
          </details>
        </div>
      </details>
      {open && (
        <AbilityWorkspace game={game} script={script} registry={registry} semantics={semantics}
          target={{ actorId: player.id, roleId, roleName, invocationPath: "dayEntry" }}
          descriptor={open === "guided" ? descriptor : null}
          manualReason={open === "manual" ? (unavailable ?? "") : ""}
          strictGameplay={open === "guided"} onManualRequired={() => { setManualAction(actionKey); setOpen(null); }}
          onClose={() => setOpen(null)}
          onResolved={() => setOpen(null)} />
      )}
    </section>
  );
}
