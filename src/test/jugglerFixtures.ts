// SV-5f test support: the Day-1 records the Juggler's Day row makes (src/features/grimoire-v6/day/juggler.ts), built directly.
import { JUGGLER_DONE, JUGGLER_GUESS } from "@/abilities/characters/juggler";
import { patchPlayer } from "./proofFixtures";
import type { EffectRecord, StorytellerLobbyRecord } from "@/stores/types";

export type Guess = { who: string; role: string; correct: boolean };
let fx = 0;
/** One Effect per guess and, optionally, Done, on the Juggler, made on the Day before this Night (or this Day). */
export function withGuesses(g: StorytellerLobbyRecord, juggler: string, guesses: Guess[], done = true, day = g.phase === "night" ? g.day - 1 : g.day): StorytellerLobbyRecord {
  const me = g.players[juggler]!;
  const source = { kind: "participant" as const, participantId: me.participantId!, playerId: juggler, nameAtTime: me.name };
  const common = { sourceCharacter: "juggler", sourceParticipant: source, appliedAt: { phase: "day" as const, day }, lifetime: { kind: "untilDawn" as const },
    state: "active" as const, expiry: { kind: "at" as const, moment: { phase: "day" as const, day: day + 1 } } };
  const effects: EffectRecord[] = guesses.map((guess) => ({ ...common, id: `jg-${++fx}`, type: JUGGLER_GUESS, parameters: {
    guessed: { kind: "participant", participants: [{ kind: "participant", participantId: g.players[guess.who]!.participantId!, playerId: guess.who, nameAtTime: g.players[guess.who]!.name }] },
    character: { kind: "role", roleIds: [guess.role] }, correct: { kind: "boolean", value: guess.correct } } }));
  if (done) effects.push({ ...common, id: `jd-${++fx}`, type: JUGGLER_DONE });
  return patchPlayer(g, juggler, { effects: [...me.effects, ...effects] });
}

