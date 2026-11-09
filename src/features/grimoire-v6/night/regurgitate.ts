import { regurgitable, SHABALOTH_ALIVE } from "@/abilities/characters/shabaloth";
import { bindingOf, type RulesQuery } from "@/stores/rulesQuery";
import { useStorytellerStore } from "@/stores/storytellerStore";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { StorytellerLobbyRecord } from "@/stores/types";

/**
 * The Shabaloth's optional regurgitation (https://wiki.bloodontheclocktower.com/Shabaloth): "A dead player you chose last night might
 * be regurgitated." The Storyteller decides at Dusk, before the Shabaloth wakes, by tapping one of last night's chosen dead players
 * on the grimoire. Nothing is asked when there is nothing to choose, and doing nothing is the default.
 */

export type DuskRegurgitation = { shabaloth: ParticipantBinding; candidates: { target: ParticipantBinding; effectId: string }[] };

/** The living, functioning Shabaloth that has chosen dead players to regurgitate, or null. */
export function duskRegurgitation(game: StorytellerLobbyRecord, query: RulesQuery): DuskRegurgitation | null {
  if (game.phase !== "night") return null;
  for (const player of Object.values(game.players)) {
    if (player.isEmpty || !player.participantId || player.actualRole !== "shabaloth") continue;
    const shabaloth = bindingOf(player);
    const candidates = regurgitable(query, shabaloth);
    if (candidates.length) return { shabaloth, candidates };
  }
  return null;
}

/**
 * Brings the chosen dead player back: alive with their vote and ability restored (the generic resurrection), and their Shabaloth
 * DEAD token replaced by the ALIVE token. Two store commands, so the first is rolled back if the second is refused.
 */
export function regurgitate(query: RulesQuery, game: StorytellerLobbyRecord, target: ParticipantBinding): { ok: true } | { ok: false; message: string } {
  const offer = duskRegurgitation(game, query);
  const candidate = offer?.candidates.find((item) => item.target.participantId === target.participantId);
  if (!offer || !candidate) return { ok: false, message: "That player cannot be regurgitated: only a dead player the Shabaloth chose last night can." };
  const store = useStorytellerStore.getState();
  const life = store.resolveLife({ intents: [{ kind: "resurrection", playerId: target.playerId }], context: { provenance: { sourceCharacter: "shabaloth" } } });
  if (!life.ok) return { ok: false, message: life.message };
  const effects = useStorytellerStore.getState().resolveEffects({ intents: [
    { kind: "remove", target, effectId: candidate.effectId },
    { kind: "apply", target, effect: { type: SHABALOTH_ALIVE, source: offer.shabaloth, sourceCharacter: "shabaloth", lifetime: { kind: "manual" } } },
  ] });
  if (!effects.ok) { useStorytellerStore.getState().undo(); return { ok: false, message: effects.message }; }
  return { ok: true };
}
