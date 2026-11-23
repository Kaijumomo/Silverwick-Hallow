import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { townsfolkInformationFalse } from "@/abilities/characters/passiveRules";
import { captureFingerprint, type AbilityResolutionRequest } from "@/stores/abilityResolution";
import { createRulesQuery } from "@/stores/rulesQuery";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import type { STPlayerRecord } from "@/stores/types";
import type { V6Ctx } from "../ctx";
import { flash } from "../v6Store";

/**
 * SV-5 part 2a: the private Day visits of the Artist and the Savant (PO build approval 2026-11-23; proposal sections 14.3, 14.4, 27-29).
 * Q5 A: nothing is typed. The Storyteller whispers, as the pages say; the app records only what he tapped.
 *
 * - Artist (https://wiki.bloodontheclocktower.com/Artist): "Once per game, during the day, privately ask the Storyteller any yes/no
 *   question." The Day card row offers Yes, No and I don't know (the page's three whispered answers; "I don't know" uses the ability).
 *   One tap is the whole commit, one Undo: the ability is used through the Life boundary (which places the official NO ABILITY token)
 *   and the answer is recorded as a Storyteller-only manual information delivery. A question he cannot answer simply gets no tap (the
 *   page's "ask again" costs nothing), so there is no "Ask again" pill. A drunk or poisoned real Artist still spends the ability.
 * - Savant (https://wiki.bloodontheclocktower.com/Savant): "Each day, you may visit the Storyteller to learn 2 things in private: 1 is
 *   true & 1 is false." One "Told today" pill records that today's visit happened (a manual delivery stamped with this Day); the next
 *   Day it is gone because the stamp is read against the current Day. Nothing else is stored.
 *
 * Both rows are for the real character only (actual character, alive): a Drunk or a Marionette who believes they are the Artist or the
 * Savant, an evil bluffer and a Philosopher who gained the ability get no row (by hand). Never in Privacy Mode or an ended game. The
 * rows are optional, so they never raise the Day button's "!" (PO Q12 A): dayVisitRows is a list of its own, not dayActionRows.
 * Under a working Vortox both carry the existing "Vortox · false info" pill (the shared rule, read live); the app cannot check a
 * whispered answer, so the pill is the whole help.
 */

export const ARTIST_ANSWERS = ["Yes", "No", "I don't know"] as const;
export type ArtistAnswer = (typeof ARTIST_ANSWERS)[number];

const queryOf = (ctx: V6Ctx) => createRulesQuery(ctx.game, { registry: ctx.registry, script: ctx.script ?? null, semantics: CANONICAL_ABILITY_SEMANTICS });

/** The one guard both rows share: a seated, living holder of the real character, in the Day, outside Privacy Mode. */
function visitOpen(ctx: V6Ctx, player: STPlayerRecord | undefined, roleId: "artist" | "savant"): player is STPlayerRecord {
  return ctx.game.phase === "day" && !ctx.privacy && !ctx.ended && !!player && !player.isEmpty && !!player.participantId
    && player.alive && player.actualRole === roleId;
}

/** A living Artist whose once-per-game question is still unasked. */
export function artistMayAsk(ctx: V6Ctx, player: STPlayerRecord | undefined): boolean {
  return visitOpen(ctx, player, "artist") && !player!.abilityUsed;
}

/** The "Vortox · false info" pill: a living, sober and healthy Vortox makes this Townsfolk's information false (known only). */
export function visitFalseInformation(ctx: V6Ctx, roleId: "artist" | "savant"): boolean {
  const rule = townsfolkInformationFalse(queryOf(ctx), roleId);
  return rule.known && rule.value;
}

/** One manual resolution (one commit, one Undo): the Storyteller tapped it, so it is his record, labelled as such. */
function commit(ctx: V6Ctx, player: STPlayerRecord, roleId: "artist" | "savant", text: string, reason: string, spends: boolean): boolean {
  const { game } = ctx;
  if (useStorytellerStore.getState().game !== game) { flash("The game changed. Tap again."); return false; }
  const fingerprint = captureFingerprint(game, player.id);
  if (!fingerprint) { flash("The player changed. Tap again."); return false; }
  const recipient = fingerprint.actor;
  const request: AbilityResolutionRequest = {
    mode: "manual", fingerprint, roleId, reason,
    outcome: { operations: [
      ...(spends ? [{ domain: "life" as const, intents: [{ kind: "useAbility" as const, target: recipient }] }] : []),
      { domain: "manualInformation" as const, recipient, text },
    ] },
    context: { provenance: { sourcePlayer: player.id, sourceCharacter: roleId } },
  };
  const result = useStorytellerStore.getState().resolveAbility(request, CANONICAL_ABILITY_SEMANTICS, captureCharacterActionContext());
  if (!result.ok) { flash(result.message); return false; }
  return true;
}

/** The Artist's answer pill: records the answer, spends the ability (NO ABILITY follows from the use), and the row goes. */
export function answerArtist(ctx: V6Ctx, player: STPlayerRecord, answer: ArtistAnswer): void {
  if (!artistMayAsk(ctx, player)) { flash(`${player.name || "The Artist"} cannot ask a question right now.`); return; }
  if (!commit(ctx, player, "artist", answer, "The Artist's private question: the Storyteller's whispered answer", true)) return;
  flash(`${player.name || "The Artist"} was told “${answer}”. Their ability is used.`);
}
