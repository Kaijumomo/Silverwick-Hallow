import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import {
  JUGGLER_CHARACTER, JUGGLER_CORRECT, JUGGLER_DONE, JUGGLER_GUESS, JUGGLER_GUESSED, JUGGLER_MAX_GUESSES, jugglerGuessVerdict, jugglerTally,
} from "@/abilities/characters/juggler";
import { jugglerFirstDay } from "@/rules/night/nightOrder";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import { createRulesQuery } from "@/stores/rulesQuery";
import { usePrivacyStore } from "@/stores/privacyStore";
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

const OWNER = "juggler-guess";

/** The current game and Juggler, if the guess may still be recorded: the game did not change underneath the Storyteller, and Privacy Mode
 * and the game's end are read live (not from the render that offered the row). */
function stillOpen(player: STPlayerRecord): { game: StorytellerLobbyRecord; juggler: STPlayerRecord } | null {
  const game = useStorytellerStore.getState().game;
  const juggler = game?.players[player.id];
  const live = { privacy: usePrivacyStore.getState().enabled, ended: game?.phase === "ended" };
  if (!game || !juggler || juggler.participantId !== player.participantId || !jugglerMayGuess(live, game, juggler)) return null;
  return { game, juggler };
}

/** While the board waits for the guessed player's seat: cancel the wait as soon as the row is no longer offered (Privacy Mode turned on,
 * the Night begun, the Juggler changed), so nothing about the guess is asked or shown. */
function cancelWhenClosed(player: STPlayerRecord): void {
  const unsubscribe: (() => void)[] = [];
  const stop = () => { for (const off of unsubscribe.splice(0)) off(); };
  const check = () => {
    if (useTargetPicker.getState().active?.owner !== OWNER) { stop(); return; }
    if (!stillOpen(player)) { useTargetPicker.getState().cancel(); stop(); }
  };
  unsubscribe.push(usePrivacyStore.subscribe(check), useStorytellerStore.subscribe(check), useTargetPicker.subscribe(check));
}

/** One guess: one Effect on the Juggler, one commit. */
function recordGuess(player: STPlayerRecord, target: ParticipantBinding, roleId: RoleId, correct: boolean): void {
  const open = stillOpen(player);
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
  const open = stillOpen(player);
  if (!open) { flash("The game changed. Guess again."); return; }
  const verdict = jugglerGuessVerdict(queryOf(ctx, open.game), target, roleId);
  if (verdict.kind === "known") { recordGuess(player, target, roleId, verdict.correct); return; }
  const guessed = open.game.players[target.playerId];
  const character = ctx.registry.get(roleId)?.name ?? roleId;
  const who = guessed ? nameOf(guessed, `Seat ${guessed.seat + 1}`) : "That player";
  const asking = chooseAsk(`Does ${who} register as the ${character}?`, `${verdict.reason} Your ruling decides whether this guess is correct.`, "Yes", "No");
  // The question names who might register as what: Privacy Mode turned on while it is open dismisses it, and nothing is recorded.
  const ours = useV6Ui.getState().ask;
  const off = usePrivacyStore.subscribe((privacy) => {
    if (!privacy.enabled || useV6Ui.getState().ask !== ours) return;
    ours?.cancel?.();
    useV6Ui.getState().set({ ask: null });
  });
  const answer = await asking.finally(off);
  if (answer === null) { flash("Nothing was recorded."); return; }
  recordGuess(player, target, roleId, answer === "first");
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
    if (!stillOpen(player)) { flash("The game changed. Guess again."); return; }
    const guessed = useStorytellerStore.getState().game?.players[target.playerId];
    useV6Ui.getState().set({ pickHover: null, picker: { mode: "show", tokensOnly: true, title: "What does the Juggler guess?",
      kicker: `The Juggler · guess ${guessed?.name || "the player"}’s character`,
      hint: "Tap the character the Juggler guesses. The guess is recorded at once; Undo takes it back.",
      onPick: (roleId) => {
        useV6Ui.getState().set({ picker: null });
        void judgeAndRecord(ctx, player, target, roleId);
        return undefined;
      } } });
  }, { owner: OWNER, eligible });
  cancelWhenClosed(player);
}

/** Done: the guesses are finished (zero allowed). One commit. */
export function markJugglerDone(ctx: V6Ctx, player: STPlayerRecord): void {
  const open = stillOpen(player);
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
