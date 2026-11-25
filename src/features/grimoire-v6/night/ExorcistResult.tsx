import { iconUrlFor } from "@/data/iconUrl";
import type { RoleRegistry } from "@/data/roleRegistry";
import { EXORCISED_PARAMETER, EXORCIST_CHOSEN, EXORCIST_PARAMETER } from "@/abilities/characters/exorcist";
import type { NightStep } from "@/rules/night/nightOrder";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { StorytellerLobbyRecord, STPlayerRecord } from "@/stores/types";
import { ChoiceSlot } from "../choice/ChoiceParts";
import { presentCharacter, report } from "../info/actions";
import { WakeTokensRow } from "./WakeTokensRow";

/**
 * BM-1c: what the Exorcist's Night card shows around the choice (https://wiki.bloodontheclocktower.com/Exorcist). The choice is tapped on
 * the board (and "does this Recluse register as the Demon?" is the engine's tap-ruling card). Afterwards one filled slot names the chosen
 * player; when the Demon was told, the Cerenovus's "Wake" row follows with ONE reveal token (Selected You, Exorcist, through the existing
 * player-safe reveal, which never shows the Exorcist's name) and one line for the Storyteller only: point to the Exorcist. Everything is
 * read from tonight's CHOSEN Effect, so a reload keeps it and Undo removes it. A drunk or poisoned Exorcist chooses, but nobody is told.
 * Presentation only: nothing here records anything.
 */
export function ExorcistResult({ game, registry, query, step, done }: {
  game: StorytellerLobbyRecord; registry: RoleRegistry; query: RulesQuery | undefined; step: Extract<NightStep, { kind: "player" }>; done: boolean;
}) {
  const actor = game.players[step.playerId];
  if (!actor?.participantId) return null;
  const nameOf = (p: STPlayerRecord) => p.name || `Seat ${p.seat + 1}`;
  const functions = step.isDeceived ? { known: true as const, value: false } : query?.abilityFunctions({ playerId: actor.id, participantId: actor.participantId });
  const impaired = !!functions && functions.known && !functions.value;
  if (!done) {
    return impaired ? <div className="gv-choice"><hr className="gv-choice-divider" />
      <p className="gv-choice-note">{`${nameOf(actor)} is drunk or poisoned: the choice is made, but the Demon is not affected.`}</p></div> : null;
  }
  let who: STPlayerRecord | undefined;
  let told = false;
  for (const player of Object.values(game.players)) {
    if (player.isEmpty) continue;
    const effect = player.effects.find((candidate) => candidate.type === EXORCIST_CHOSEN && candidate.state === "active"
      && candidate.parameters?.[EXORCIST_PARAMETER]?.kind === "participant"
      && (candidate.parameters[EXORCIST_PARAMETER] as { participants: { participantId: string }[] }).participants[0]?.participantId === actor.participantId
      && candidate.appliedAt?.phase === "night" && candidate.appliedAt.day === game.day);
    if (!effect) continue;
    who = player;
    const flag = effect.parameters?.[EXORCISED_PARAMETER];
    told = flag?.kind === "boolean" && flag.value;
  }
  const exorcist = registry.get("exorcist");
  if (!who || !exorcist) return null;
  const role = who.actualRole ? registry.get(who.actualRole) : undefined;
  return <div className="gv-choice">
    <hr className="gv-choice-divider" />
    <div className="gv-choice-slots"><ChoiceSlot filled label={nameOf(who)} img={role ? iconUrlFor(role) : undefined} sub="" /></div>
    {told && <>
      <WakeTokensRow name={nameOf(who)} first={{ heading: "Selected You", role: exorcist, onOpen: () => report(presentCharacter("Selected You", exorcist.id)) }} />
      <p className="gv-choice-note">{`Then point to the Exorcist: ${nameOf(actor)}.`}</p>
    </>}
    {impaired && <p className="gv-choice-note">{`${nameOf(actor)} is drunk or poisoned: the choice is made, but the Demon is not affected.`}</p>}
  </div>;
}
