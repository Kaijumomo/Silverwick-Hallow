import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { KLUTZ_TARGET, klutzLearnedDeath, klutzVerdict } from "@/abilities/characters/klutz";
import { captureFingerprint, type AbilityResolutionRequest } from "@/stores/abilityResolution";
import { createRulesQuery } from "@/stores/rulesQuery";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import { useTargetPicker, seatedParticipants } from "@/features/abilities/abilityUi";
import type { STPlayerRecord } from "@/stores/types";
import type { V6Ctx } from "../ctx";
import { flash } from "../v6Store";

/**
 * SV-1c: the Klutz's public Day choice (https://wiki.bloodontheclocktower.com/Klutz), on the Moonchild's Day row and "!" (PO direction,
 * 2026-11-12). The Storyteller taps the row, then the living player the Klutz chose. One coordinator commit (Day entry): the use, and for
 * a sober and healthy Klutz the fact the End control's "!" reads. Undo brings the row back. The row is offered only on the Day the Klutz
 * learned they died; after nightfall it is gone and the ability with it.
 */

const queryOf = (ctx: V6Ctx) => createRulesQuery(ctx.game, { registry: ctx.registry, script: ctx.script ?? null, semantics: CANONICAL_ABILITY_SEMANTICS });

/** The dead Klutz who learned they died during last night or today, and has not chosen yet. */
export function klutzAwaitingChoice(ctx: V6Ctx, player: STPlayerRecord | undefined): boolean {
  const { game } = ctx;
  if (game.phase !== "day" || ctx.privacy || ctx.ended || !player || player.isEmpty || player.alive || player.actualRole !== "klutz" || player.abilityUsed || !player.participantId) return false;
  return klutzLearnedDeath(queryOf(ctx), { playerId: player.id, participantId: player.participantId });
}

/** Starts the board pick for the living player the Klutz publicly chose. */
export function startKlutzChoice(ctx: V6Ctx, player: STPlayerRecord): void {
  const { game } = ctx;
  if (!klutzAwaitingChoice(ctx, player)) return;
  const klutz = { playerId: player.id, participantId: player.participantId! };
  const eligible = new Set(seatedParticipants(game).filter((p) => p.alive).map((p) => p.participantId!));
  flash(`Tap the player ${player.name || "the Klutz"} publicly chose.`);
  useTargetPicker.getState().start("the Klutz's choice", (target) => {
    const current = useStorytellerStore.getState().game;
    if (!current || current !== game) { flash("The game changed. Choose again."); return; }
    const chosen = game.players[target.playerId];
    if (!chosen || chosen.participantId !== target.participantId || !chosen.alive) { flash("Choose a living player."); return; }
    const fingerprint = captureFingerprint(game, player.id);
    if (!fingerprint) { flash("The game changed. Choose again."); return; }
    const query = queryOf(ctx);
    const functions = query.abilityFunctions(klutz);
    const request = { mode: "guided", invocationPath: "dayEntry", fingerprint, roleId: "klutz",
      inputs: { [KLUTZ_TARGET]: { kind: "participant", participants: [target] } },
      // The recorded fact names the Klutz as its source (SV-5 reads it).
      context: { provenance: { sourcePlayer: player.id, sourceCharacter: "klutz" } } } as AbilityResolutionRequest;
    const result = useStorytellerStore.getState().resolveAbility(request, CANONICAL_ABILITY_SEMANTICS, captureCharacterActionContext());
    if (!result.ok) { flash(result.message); return; }
    const name = chosen.name || "That player";
    const { verdict } = klutzVerdict(query, klutz, target, functions.known && functions.value);
    flash(verdict === "impaired" ? `${player.name || "The Klutz"} is drunk or poisoned: nothing happens.`
      : verdict === "ruling" ? `${name} may register as good or evil: your ruling.`
        : verdict === "loses" ? `${name} is evil: the Klutz’s team loses.` : `${name} is good: nothing happens.`);
  }, { owner: "klutz-choice", eligible });
}
