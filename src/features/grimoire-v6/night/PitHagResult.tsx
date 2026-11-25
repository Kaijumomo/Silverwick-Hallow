import { iconUrlFor } from "@/data/iconUrl";
import type { RoleRegistry } from "@/data/roleRegistry";
import type { NightStep } from "@/rules/night/nightOrder";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { StorytellerLobbyRecord, STPlayerRecord } from "@/stores/types";
import { ChoiceSlot } from "../choice/ChoiceParts";
import { presentCharacter, presentMessage, report } from "../info/actions";
import type { PitHagChoice } from "./useNightEngine";
import { pitHagChangeTonight } from "./newCharacters";
import { YouAreRow } from "./YouAreRow";

/**
 * PH-a / PH-b (https://wiki.bloodontheclocktower.com/Pit-Hag): what the Pit-Hag's Night card shows around the choice, in the Philosopher
 * and Cerenovus cards' language. The choice itself is made on the board (the engine's tap-then-picker route). Afterwards: one filled
 * slot "[Name] becomes the [Character]" and the "Wake" row with YOU ARE and the new character, then the Good or Evil token (the page:
 * remind the player their alignment is unchanged), the same player-safe reveals as the Snake Charmer's. The change is read from tonight's
 * History, so a reload keeps it and Undo removes it. When nothing changed (the character was already in play, or the Pit-Hag is drunk
 * or poisoned) one plain line says so. Presentation only: nothing here records anything.
 */
export function PitHagResult({ game, registry, query, step, done, choice }: {
  game: StorytellerLobbyRecord; registry: RoleRegistry; query: RulesQuery | undefined; step: Extract<NightStep, { kind: "player" }>; done: boolean; choice: PitHagChoice | null;
}) {
  const actor = game.players[step.playerId];
  if (!actor?.participantId || !done) return null;
  const nameOf = (p: STPlayerRecord) => p.name || `Seat ${p.seat + 1}`;
  const changed = pitHagChangeTonight(game, actor.participantId);
  if (changed) {
    const role = registry.get(changed.roleId);
    if (!role) return null;
    const alignment = changed.player.actualAlignment === "evil" ? "evil" : "good";
    return <div className="gv-choice">
      <hr className="gv-choice-divider" />
      <div className="gv-choice-slots"><ChoiceSlot filled label={nameOf(changed.player)} img={iconUrlFor(role)} sub={`Becomes the ${role.name}`} /></div>
      <YouAreRow name={nameOf(changed.player)} role={role} alignment={alignment}
        onCharacter={() => report(presentCharacter("You Are", role.id))}
        onAlignment={() => report(presentMessage(alignment, alignment === "evil" ? "You Are Evil" : "You Are Good"))} />
    </div>;
  }
  if (!choice || choice.stepKey !== step.stepKey) return null;
  const chosen = registry.get(choice.roleId);
  if (!chosen) return null;
  const functions = step.isDeceived ? { known: true as const, value: false } : query?.abilityFunctions({ playerId: actor.id, participantId: actor.participantId });
  const impaired = !!functions && functions.known && !functions.value;
  const inPlay = Object.values(game.players).some((p) => !p.isEmpty && p.actualRole === choice.roleId);
  return <div className="gv-choice"><hr className="gv-choice-divider" />
    <p className="gv-choice-note">{impaired ? `${nameOf(actor)} is drunk or poisoned: nothing changes.`
      : inPlay ? `The ${chosen.name} is already in play: nothing happens.` : "Nothing changed."}</p></div>;
}
