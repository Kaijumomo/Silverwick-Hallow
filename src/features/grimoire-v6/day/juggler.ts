import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import {
  JUGGLER_CHARACTER, JUGGLER_CORRECT, JUGGLER_DONE, JUGGLER_GUESS, JUGGLER_GUESSED, JUGGLER_MAX_GUESSES, jugglerGuessVerdict, jugglerTally,
} from "@/abilities/characters/juggler";
import { jugglerFirstDay } from "@/rules/night/nightOrder";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import { createRulesQuery } from "@/stores/rulesQuery";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { seatedParticipants, useTargetPicker } from "@/features/abilities/abilityUi";
import type { RoleId, STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";
import type { V6Ctx } from "../ctx";
import { chooseAsk, flash, useV6Ui } from "../v6Store";

/**
 * SV-5f: the Juggler's guesses on the Day card (PO build approval 2026-11-23; proposal sections 14.1, 36-38; Q6 A, Q16 A).
 * https://wiki.bloodontheclocktower.com/Juggler: "During the first day, if the Juggler declares that they are using their ability ... The
 * Juggler can make up to five guesses, each of any one player and any one character. For each correct guess, mark the Juggler with a
 * CORRECT reminder."
 *
 * An optional row in dayVisitRows (so it never raises the Day button's "!", Q12 A), beside the Artist's and the Savant's, for a living
 * real Juggler on their first Day as the Juggler (the Night order's own rule, `jugglerFirstDay`): "Guesses N of 5", Guess and Done.
 *  - Guess: tap the guessed player on the board (any seated player, the dead and the Juggler included), then pick the character in the
 *    board's character picker (tokens only: no names, so nothing tells the Storyteller's screen who holds what). The guess is recorded at
 *    once (one commit, one Undo): a `jugglerGuess` Effect on the Juggler, its correctness judged now (abilities/characters/juggler.ts). A
 *    Spy or Recluse who might register as that character is one Yes / No question. Repeats are allowed; a sixth guess is refused. The
 *    toast never says whether a guess was right (the table may be listening).
 *  - Done: records that the guesses are finished (zero allowed); the row then shows the Completed pill.
 *  - Mistakes: Undo (Q16 A). Nothing is typed.
 * A drunk or poisoned real Juggler still guesses (the count is judged by their state at night). A Drunk who believes they are the Juggler,
 * a bluffer, a Marionette and a Philosopher who gained the ability get no row (by hand). Never in Privacy Mode or an ended game.
 */

const queryOf = (ctx: V6Ctx, game: StorytellerLobbyRecord = ctx.game) =>
  createRulesQuery(game, { registry: ctx.registry, script: ctx.script ?? null, semantics: CANONICAL_ABILITY_SEMANTICS });

/** A living real Juggler on their first Day as the Juggler, in the Day, outside Privacy Mode. */
export function jugglerMayGuess(ctx: Pick<V6Ctx, "privacy" | "ended">, game: StorytellerLobbyRecord, player: STPlayerRecord | undefined): player is STPlayerRecord {
  return game.phase === "day" && !ctx.privacy && !ctx.ended && !!player && !player.isEmpty && !!player.participantId
    && player.alive && player.actualRole === "juggler" && jugglerFirstDay(player, game) === game.day;
}

/** Today's guesses and whether they are marked done. */
export function jugglerToday(game: StorytellerLobbyRecord, player: STPlayerRecord): { guesses: number; done: boolean } {
  const tally = jugglerTally(player, game.day);
  return { guesses: tally.guesses.length, done: tally.done.length > 0 };
}

const nameOf = (player: STPlayerRecord, fallback: string) => player.name || fallback;

/** The current game and Juggler, if the guess may still be recorded (the game did not change underneath the Storyteller). */
function stillOpen(ctx: V6Ctx, player: STPlayerRecord): { game: StorytellerLobbyRecord; juggler: STPlayerRecord } | null {
  const game = useStorytellerStore.getState().game;
  const juggler = game?.players[player.id];
  if (!game || !juggler || juggler.participantId !== player.participantId || !jugglerMayGuess(ctx, game, juggler)) return null;
  return { game, juggler };
}

/** One guess: one Effect on the Juggler, one commit. */
function recordGuess(ctx: V6Ctx, player: STPlayerRecord, target: ParticipantBinding, roleId: RoleId, correct: boolean): void {
  const open = stillOpen(ctx, player);
  if (!open) { flash("The game changed. Guess again."); return; }
  const { game, juggler } = open;
  const today = jugglerToday(game, juggler);
  if (today.done) { flash(`${nameOf(juggler, "The Juggler")}’s guesses are already done.`); return; }
  if (today.guesses >= JUGGLER_MAX_GUESSES) { flash(`${nameOf(juggler, "The Juggler")} has made 5 guesses: no more.`); return; }
  const guessed = game.players[target.playerId];
  if (!guessed || guessed.isEmpty || guessed.participantId !== target.participantId) { flash("That player changed. Guess again."); return; }
  const me = { playerId: juggler.id, participantId: juggler.participantId! };
  const result = useStorytellerStore.getState().resolveEffects({ intents: [{ kind: "apply", target: me, effect: {
    type: JUGGLER_GUESS, source: me, sourceCharacter: "juggler", lifetime: { kind: "untilDawn" },
    parameters: {
      [JUGGLER_GUESSED]: { kind: "participant", participants: [target] },
      [JUGGLER_CHARACTER]: { kind: "role", roleIds: [roleId] },
      [JUGGLER_CORRECT]: { kind: "boolean", value: correct },
    } } }] });
  if (!result.ok) { flash(result.message); return; }
  flash(`Guess ${today.guesses + 1} of 5 recorded.`);
}

/** Judges the guess (asking the one Yes / No question for a Spy or Recluse), then records it. */
async function judgeAndRecord(ctx: V6Ctx, player: STPlayerRecord, target: ParticipantBinding, roleId: RoleId): Promise<void> {
  const open = stillOpen(ctx, player);
  if (!open) { flash("The game changed. Guess again."); return; }
  const verdict = jugglerGuessVerdict(queryOf(ctx, open.game), target, roleId);
  if (verdict.kind === "known") { recordGuess(ctx, player, target, roleId, verdict.correct); return; }
  const guessed = open.game.players[target.playerId];
  const character = ctx.registry.get(roleId)?.name ?? roleId;
  const who = guessed ? nameOf(guessed, `Seat ${guessed.seat + 1}`) : "That player";
  const answer = await chooseAsk(`Does ${who} register as the ${character}?`, `${verdict.reason} Your ruling decides whether this guess is correct.`, "Yes", "No");
  if (answer === null) { flash("Nothing was recorded."); return; }
  recordGuess(ctx, player, target, roleId, answer === "first");
}

/** Guess: tap the guessed player, then pick the character. A sixth guess is refused. */
export function startJugglerGuess(ctx: V6Ctx, player: STPlayerRecord): void {
  const { game } = ctx;
  if (!jugglerMayGuess(ctx, game, player)) return;
  const today = jugglerToday(game, player);
  if (today.done) return;
  const name = nameOf(player, "The Juggler");
  if (today.guesses >= JUGGLER_MAX_GUESSES) { flash(`${name} has made 5 guesses: no more.`); return; }
  const eligible = new Set(seatedParticipants(game).map((p) => p.participantId!));
  flash(`Tap the player ${name} is guessing.`);
  useTargetPicker.getState().start("the Juggler's guess", (target) => {
    const guessed = useStorytellerStore.getState().game?.players[target.playerId];
    useV6Ui.getState().set({ pickHover: null, picker: { mode: "show", tokensOnly: true, title: "What does the Juggler guess?",
      kicker: `The Juggler · guess ${guessed?.name || "the player"}’s character`,
      hint: "Tap the character the Juggler guesses. The guess is recorded at once; Undo takes it back.",
      onPick: (roleId) => {
        useV6Ui.getState().set({ picker: null });
        void judgeAndRecord(ctx, player, target, roleId);
        return undefined;
      } } });
  }, { owner: "juggler-guess", eligible });
}

/** Done: the guesses are finished (zero allowed). One commit. */
export function markJugglerDone(ctx: V6Ctx, player: STPlayerRecord): void {
  const open = stillOpen(ctx, player);
  if (!open || open.game !== ctx.game) { flash("The game changed. Tap again."); return; }
  const { juggler } = open;
  if (jugglerToday(open.game, juggler).done) return;
  useTargetPicker.getState().cancel();
  const me = { playerId: juggler.id, participantId: juggler.participantId! };
  const result = useStorytellerStore.getState().resolveEffects({ intents: [{ kind: "apply", target: me, effect: {
    type: JUGGLER_DONE, source: me, sourceCharacter: "juggler", lifetime: { kind: "untilDawn" } } }] });
  if (!result.ok) { flash(result.message); return; }
  flash(`${nameOf(juggler, "The Juggler")}’s guesses are done.`);
}
