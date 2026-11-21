import { iconUrlFor } from "@/data/iconUrl";
import type { RoleRegistry } from "@/data/roleRegistry";
import { MAD_CHARACTER_PARAMETER, MAD_EFFECT } from "@/abilities/characters/cerenovus";
import type { NightStep } from "@/rules/night/nightOrder";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { StorytellerLobbyRecord, STPlayerRecord } from "@/stores/types";
import { ChoiceSlot } from "../choice/ChoiceParts";
import { presentCharacter, report } from "../info/actions";
import type { CerenovusChoice } from "./useNightEngine";
import { WakeTokensRow } from "./WakeTokensRow";

/**
 * SV-4a (PO 2026-11-21): what the Cerenovus's Night card shows around the choice, in the Philosopher card's language. The choice itself
 * is made on the board (the engine's tap-then-picker route). Before it, a drunk or poisoned Cerenovus says nobody will go mad; after
 * it, one filled slot "[Name] -- mad about being the [Character]" and the "Wake" row with the two reveal tokens: Selected You and
 * the Cerenovus, then This Character and the character they are mad about being. The row is derived from tonight's MAD Effect (so a
 * reload keeps it) and falls back to the pick the engine holds when no MAD was recorded (an impaired Cerenovus). Presentation only.
 */
export function CerenovusResult({ game, registry, query, step, done, choice }: {
  game: StorytellerLobbyRecord; registry: RoleRegistry; query: RulesQuery | undefined; step: Extract<NightStep, { kind: "player" }>; done: boolean; choice: CerenovusChoice | null;
}) {
  const actor = game.players[step.playerId];
  if (!actor?.participantId) return null;
  const nameOf = (p: STPlayerRecord) => p.name || `Seat ${p.seat + 1}`;
  const functions = step.isDeceived ? { known: true as const, value: false } : query?.abilityFunctions({ playerId: actor.id, participantId: actor.participantId });
  const impaired = !!functions && functions.known && !functions.value;
  if (!done) {
    return impaired ? <div className="gv-choice"><hr className="gv-choice-divider" />
      <p className="gv-choice-note">{`${nameOf(actor)} is drunk or poisoned: the choice is made, but nobody goes mad.`}</p></div> : null;
  }
  // Tonight's MAD from this Cerenovus, or the pick the engine holds (an impaired Cerenovus records none).
  let who: STPlayerRecord | undefined;
  let roleId: string | undefined;
  for (const player of Object.values(game.players)) {
    if (player.isEmpty) continue;
    const effect = player.effects.find((candidate) => candidate.type === MAD_EFFECT && candidate.state === "active" && candidate.sourceCharacter === "cerenovus"
      && candidate.sourceParticipant?.kind === "participant" && candidate.sourceParticipant.participantId === step.participantId
      && candidate.appliedAt?.phase === "night" && candidate.appliedAt.day === game.day);
    const character = effect?.parameters?.[MAD_CHARACTER_PARAMETER];
    if (character?.kind === "role" && character.roleIds[0]) { who = player; roleId = character.roleIds[0]; }
  }
  if (!who && choice && choice.stepKey === step.stepKey) {
    const held = game.players[choice.target.playerId];
    if (held && !held.isEmpty && held.participantId === choice.target.participantId) { who = held; roleId = choice.roleId; }
  }
  const mad = roleId ? registry.get(roleId) : undefined;
  const cerenovus = registry.get("cerenovus");
  if (!who || !mad || !cerenovus) return null;
  return <div className="gv-choice">
    <hr className="gv-choice-divider" />
    <div className="gv-choice-slots"><ChoiceSlot filled label={nameOf(who)} img={iconUrlFor(mad)} sub={impaired ? `Mad about being the ${mad.name}: nobody goes mad` : `Mad about being the ${mad.name}`} /></div>
    <WakeTokensRow name={nameOf(who)}
      first={{ heading: "Selected You", role: cerenovus, onOpen: () => report(presentCharacter("Selected You", cerenovus.id)) }}
      second={{ heading: "This Character", role: mad, onOpen: () => report(presentCharacter("This Character", mad.id)) }} />
  </div>;
}
