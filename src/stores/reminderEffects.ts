import { ABNORMAL_BY_HAND, ABNORMAL_EFFECT, abnormalMarkIntents, abnormalMarksOf } from "./abnormalMarks";
import type { EffectIntent } from "./effectResolution";
import type { StorytellerLobbyRecord } from "./types";

/**
 * SV-5g (PO Q7 A, 2026-11-21: a hand-placed official ABNORMAL token counts as a real mark): the official reminder tokens whose hand
 * placement RECORDS an Effect on the player it is placed on. The twin of reminderRuleFacts.ts, which records a game-wide Rule Fact; the
 * Mathematician counts one mark per affected PLAYER, so his token becomes a per-player Effect instead.
 *
 * A command-layer mapping only, keyed by the palette entry (source character + label) the Storyteller picked. No Reminder is stored:
 * the official token is drawn from the Effect (officialReminderPresentation.ts) and removed with it, through the ordinary Effect
 * removal, in one commit and one Undo. Mechanics read the Effect, never a Reminder.
 */
const REMINDER_EFFECTS: readonly { sourceCharacter: string; label: string; type: string }[] = [
  { sourceCharacter: "mathematician", label: "Abnormal", type: ABNORMAL_EFFECT },
];

/** The Effect type a hand-placed official token records, if any. */
export function effectForReminder(sourceCharacter: string | undefined, label: string): string | undefined {
  if (!sourceCharacter) return undefined;
  return REMINDER_EFFECTS.find((entry) => entry.sourceCharacter === sourceCharacter && entry.label === label)?.type;
}

/** The Effect intents of placing that token on `target` by hand, or the reason it cannot be placed. */
export function reminderEffectIntents(game: StorytellerLobbyRecord, type: string, target: { playerId: string; participantId: string }):
  { ok: true; intents: EffectIntent[] } | { ok: false; message: string } {
  if (type !== ABNORMAL_EFFECT) return { ok: false, message: "This token cannot be placed here." };
  // "Since dawn": the mark belongs to a Night or a Day, never to Setup or an ended game.
  if (game.phase !== "night" && game.phase !== "day") return { ok: false, message: "An ABNORMAL mark is placed during the Night or the Day." };
  const player = game.players[target.playerId];
  if (player && abnormalMarksOf(player).length) return { ok: false, message: "This player already has an ABNORMAL mark: it counts once." };
  const intents = abnormalMarkIntents(game.players, target, ABNORMAL_BY_HAND);
  return intents.length ? { ok: true, intents } : { ok: false, message: "The player changed. Reopen their details before continuing." };
}
