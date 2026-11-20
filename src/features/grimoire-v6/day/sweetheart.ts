import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { SWEETHEART_PLAYER, sweetheartOpenDayDeath } from "@/abilities/characters/sweetheart";
import { captureFingerprint, type AbilityResolutionRequest, type ParticipantBinding } from "@/stores/abilityResolution";
import { createRulesQuery } from "@/stores/rulesQuery";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import { useTargetPicker, seatedParticipants } from "@/features/abilities/abilityUi";
import type { STPlayerRecord } from "@/stores/types";
import type { V6Ctx } from "../ctx";
import { flash } from "../v6Store";

/**
 * SV-1b: the Sweetheart's Day action (PO answer to Q1, 2026-11-14). "When you die, 1 player is drunk from now on."
 * https://wiki.bloodontheclocktower.com/Sweetheart -- when she dies in the Day, the Storyteller chooses at once on a Day actions row in
 * the Moonchild row's style, with the "!" on the Day button. The choice goes through the coordinator on the Day entry path (one commit,
 * one Undo) and marks the next Night's step for that death as done; if it is not made by nightfall, her Night step asks instead.
 */

const queryOf = (ctx: V6Ctx) => createRulesQuery(ctx.game, { registry: ctx.registry, script: ctx.script ?? null, semantics: CANONICAL_ABILITY_SEMANTICS });

/** The dead Sweetheart who died today and whose choice is not made yet. */
export function sweetheartAwaitingChoice(ctx: V6Ctx, player: STPlayerRecord | undefined): boolean {
  const { game } = ctx;
  if (game.phase !== "day" || ctx.privacy || ctx.ended || !player || player.isEmpty || player.alive || player.actualRole !== "sweetheart" || !player.participantId) return false;
  return !!sweetheartOpenDayDeath(queryOf(ctx), { playerId: player.id, participantId: player.participantId });
}

function resolve(ctx: V6Ctx, player: STPlayerRecord, chosen: ParticipantBinding[]) {
  const fingerprint = captureFingerprint(ctx.game, player.id);
  if (!fingerprint) return null;
  const request = { mode: "guided", invocationPath: "dayEntry", fingerprint, roleId: "sweetheart",
    inputs: { [SWEETHEART_PLAYER]: { kind: "participant", participants: chosen } } } as AbilityResolutionRequest;
  return useStorytellerStore.getState().resolveAbility(request, CANONICAL_ABILITY_SEMANTICS, captureCharacterActionContext());
}

/** Starts the board pick for the player who becomes drunk (or, for a Sweetheart with no ability now, records that nobody does). */
export function startSweetheartChoice(ctx: V6Ctx, player: STPlayerRecord): void {
  const { game } = ctx;
  if (!sweetheartAwaitingChoice(ctx, player)) return;
  const name = player.name || "The Sweetheart";
  const functions = queryOf(ctx).abilityFunctions({ playerId: player.id, participantId: player.participantId! });
  if (functions.known && !functions.value) {
    const result = resolve(ctx, player, []);
    flash(!result ? "The game changed. Choose again." : !result.ok ? result.message : `${name} is drunk or poisoned: nobody becomes drunk.`);
    return;
  }
  const eligible = new Set(seatedParticipants(game).filter((p) => p.participantId !== player.participantId).map((p) => p.participantId!));
  flash("Tap the player who becomes drunk.");
  useTargetPicker.getState().start("the Sweetheart's choice", (target) => {
    const current = useStorytellerStore.getState().game;
    if (!current || current !== game) { flash("The game changed. Choose again."); return; }
    const chosen = game.players[target.playerId];
    if (!chosen || chosen.participantId !== target.participantId) { flash("Choose a player."); return; }
    const result = resolve(ctx, player, [target]);
    flash(!result ? "The game changed. Choose again." : !result.ok ? result.message : `${chosen.name || "That player"} is drunk from now on.`);
  }, { owner: "sweetheart-choice", eligible });
}
