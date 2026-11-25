import { iconUrlFor } from "@/data/iconUrl";
import type { RoleRegistry } from "@/data/roleRegistry";
import type { NightStep } from "@/rules/night/nightOrder";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { StorytellerLobbyRecord, STPlayerRecord } from "@/stores/types";
import { ChoiceSlot } from "../choice/ChoiceParts";

/**
 * BM-1b: what the Sailor's Night card shows after the choice (https://wiki.bloodontheclocktower.com/Sailor). The choice is tapped on the
 * board and the "who is drunk?" ruling is the engine's tap-ruling card; afterwards one filled slot names the drunk player, read from
 * tonight's DRUNK Effect (so a reload keeps it and Undo removes it). A drunk or poisoned Sailor chooses and nobody becomes drunk, and one
 * plain line says so. Presentation only: nothing here records anything.
 */
export function SailorResult({ game, registry, query, step, done }: {
  game: StorytellerLobbyRecord; registry: RoleRegistry; query: RulesQuery | undefined; step: Extract<NightStep, { kind: "player" }>; done: boolean;
}) {
  const actor = game.players[step.playerId];
  if (!actor?.participantId || !done) return null;
  const nameOf = (p: STPlayerRecord) => p.name || `Seat ${p.seat + 1}`;
  let drunk: STPlayerRecord | undefined;
  for (const player of Object.values(game.players)) {
    if (player.isEmpty) continue;
    const found = player.effects.some((effect) => effect.type === "drunk" && effect.state === "active" && effect.sourceCharacter === "sailor"
      && effect.sourceParticipant?.kind === "participant" && effect.sourceParticipant.participantId === actor.participantId
      && effect.appliedAt?.phase === "night" && effect.appliedAt.day === game.day);
    if (found) drunk = player;
  }
  if (drunk) {
    const role = drunk.actualRole ? registry.get(drunk.actualRole) : undefined;
    return <div className="gv-choice"><hr className="gv-choice-divider" />
      <div className="gv-choice-slots"><ChoiceSlot filled label={nameOf(drunk)} img={role ? iconUrlFor(role) : undefined} sub="Drunk until dusk" /></div></div>;
  }
  const functions = step.isDeceived ? { known: true as const, value: false } : query?.abilityFunctions({ playerId: actor.id, participantId: actor.participantId });
  if (functions && functions.known && !functions.value)
    return <div className="gv-choice"><hr className="gv-choice-divider" />
      <p className="gv-choice-note">{`${nameOf(actor)} is drunk or poisoned: the choice is made, but nobody becomes drunk.`}</p></div>;
  return null;
}
