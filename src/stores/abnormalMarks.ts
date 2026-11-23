import type { EffectIntent } from "./effectResolution";
import { gainedRoleOf } from "./gainedAbility";
import { MAX_EFFECT_TEXT } from "./schemas";
import type { EffectRecord, STPlayerRecord, StorytellerLobbyRecord } from "./types";

/**
 * SV-5g (Sects & Violets part 2c, the Mathematician; PO build approval 2026-11-23; proposal sections 39-42).
 * https://wiki.bloodontheclocktower.com/Mathematician: "Each night, you learn how many players' abilities worked abnormally (since
 * dawn) due to another character's ability." How to run: "mark them with an ABNORMAL reminder ... show fingers equaling the number of
 * characters with ABNORMAL reminders ... Remove all ABNORMAL reminders."
 *
 * The ABNORMAL mark is an Effect on the affected participant (mechanics never read Reminders), one per player: a second occurrence in
 * the same window adds its reason to the one mark. It is a recorded Storyteller fact (rulesQuery `storytellerFact`): no source, no
 * dependence on anyone functioning, so no game-ending proposal turns manual because of it. Its lifetime is `untilDawn`, the page's
 * "since dawn" window (PO Q18 A): a mark made in Day N or in Night N+1 lives until Day N+1 begins, so a mark made after the
 * Mathematician woke expires at that dawn without being counted. The Mathematician's Night commit removes every mark it counted.
 * Storyteller-only: drawn on the Storyteller's board with the official ABNORMAL token, never projected to a phone or the Public Display.
 */
export const ABNORMAL_EFFECT = "abnormal";
export const ABNORMAL_REASON = "reason";
export const ABNORMAL_BY_HAND = "Placed by hand";
export const ABNORMAL_VORTOX = "Vortox: false information";
export const ABNORMAL_IMPAIRED = "False information while drunk or poisoned";

type Binding = { playerId: string; participantId: string };
type Players = Readonly<Record<string, STPlayerRecord>>;

const seated = (player: STPlayerRecord | undefined): player is STPlayerRecord & { participantId: string } =>
  !!player && !player.isEmpty && !!player.participantId;

/** The participant's active ABNORMAL marks (normally at most one). */
export const abnormalMarksOf = (player: Pick<STPlayerRecord, "effects">): EffectRecord[] =>
  player.effects.filter((effect) => effect.type === ABNORMAL_EFFECT && effect.state === "active");

/** The reasons recorded on these marks, in order, without repeats. */
export function abnormalReasons(effects: readonly EffectRecord[]): string[] {
  const reasons: string[] = [];
  for (const effect of effects) {
    const value = effect.parameters?.[ABNORMAL_REASON];
    for (const reason of value?.kind === "text" ? value.value.split("; ") : []) if (reason && !reasons.includes(reason)) reasons.push(reason);
  }
  return reasons;
}

/**
 * The intents that mark `target` ABNORMAL for `reason`: a new mark, or the reason added to the mark it already holds. Empty when the
 * mark already records that reason (nothing to change).
 */
export function abnormalMarkIntents(players: Players, target: Binding, reason: string): EffectIntent[] {
  const player = players[target.playerId];
  if (!seated(player) || player.participantId !== target.participantId) return [];
  const existing = abnormalMarksOf(player)[0];
  if (!existing) {
    return [{ kind: "apply", target, effect: { type: ABNORMAL_EFFECT, lifetime: { kind: "untilDawn" }, parameters: { [ABNORMAL_REASON]: { kind: "text", value: reason } } } }];
  }
  const reasons = abnormalReasons([existing]);
  if (reasons.includes(reason)) return [];
  const joined = [...reasons, reason].join("; ");
  // The stored text is bounded; the mark itself is what is counted, so a reason that no longer fits is simply not added.
  if (joined.length > MAX_EFFECT_TEXT) return [];
  return [{ kind: "update", target, effectId: existing.id, changes: { parameters: { [ABNORMAL_REASON]: { kind: "text", value: joined } } } }];
}

/** How many players hold an ABNORMAL mark, not counting `except` (the Mathematician: "does not detect their own ability failing"). */
export function abnormalCount(game: Pick<StorytellerLobbyRecord, "players">, except?: string): number {
  return Object.values(game.players).filter((player) => seated(player) && player.participantId !== except && abnormalMarksOf(player).length > 0).length;
}

/** The intents that take every ABNORMAL mark away (the Mathematician's Night commit: "Remove all ABNORMAL reminders"). */
export function clearAbnormalIntents(game: Pick<StorytellerLobbyRecord, "players">): EffectIntent[] {
  return Object.values(game.players).flatMap((player) => seated(player)
    ? abnormalMarksOf(player).map((effect) => ({ kind: "remove" as const, target: { playerId: player.id, participantId: player.participantId }, effectId: effect.id }))
    : []);
}

/** Whether a living player holds the Mathematician's ability (the character, or a Philosopher who gained it): only then does the app
 * place ABNORMAL marks by itself. Without one they would count for nobody. */
export function mathematicianListening(game: Pick<StorytellerLobbyRecord, "players">): boolean {
  return Object.values(game.players).some((player) => seated(player) && player.alive
    && (player.actualRole === "mathematician" || gainedRoleOf(player) === "mathematician"));
}
