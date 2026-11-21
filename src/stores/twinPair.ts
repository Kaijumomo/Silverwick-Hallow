import type { EffectIntent } from "./effectResolution";
import { participantStepKey } from "./nightProgress";
import type { EffectRecord, GameMoment, STPlayerRecord } from "./types";

/**
 * SV-4c: the Evil Twin's pair, DERIVED from the stored `twin` Effects and the players' current characters and alignments; nothing here
 * is stored or rewritten (https://wiki.bloodontheclocktower.com/Evil_Twin).
 *
 * "While setting up the game, choose a Good Twin by marking any good character with the TWIN reminder." The marker is a source-free
 * Storyteller fact (the Red Herring's pattern) on the player the Storyteller chose, naming the Evil Twin it was chosen for. It is never
 * removed by itself ("the Effect stays", PO 2026-11-12): what the Twins ARE is read each time from the characters and alignments.
 *
 * "It doesn't matter which twin is which character, what matters is their alignment": the pair is valid while the two players hold
 * OPPOSING alignments; the good-aligned one is the Good Twin. "If both Twins are the same alignment, the Storyteller chooses a new Twin."
 */
export const TWIN_EFFECT = "twin";
/** The Effect parameter naming the Evil Twin the marker was chosen for. */
export const TWIN_EVIL_PARAMETER = "eviltwin";

export type TwinPair =
  /** No Evil Twin character is in play. */
  | { kind: "none" }
  /** More than one Evil Twin: by hand. */
  | { kind: "many" }
  | {
    kind: "single";
    /** The player holding the Evil Twin character (alive or dead). */
    evil: STPlayerRecord;
    /** The player marked as the other Twin for this Evil Twin, or null (never chosen, or the marker's player left or became the Evil Twin). */
    other: STPlayerRecord | null;
    /** The marker Effect behind `other`. */
    marker: EffectRecord | null;
    /** The two hold opposing alignments, so the pair stands. */
    valid: boolean;
    /** The good-aligned Twin of a valid pair (the Evil Twin character holder may be the good one), else null. */
    good: STPlayerRecord | null;
    /** Why there is no valid pair (for the Night card), or "". */
    reason: string;
    /** How many players carry a TWIN reminder naming this Evil Twin. */
    markers: number;
  };

type Seated = STPlayerRecord & { participantId: string };
const seated = (player: STPlayerRecord | undefined): player is Seated => !!player && !player.isEmpty && !!player.participantId;

/** Every active `twin` Effect on a seated player, whoever it names. */
export function twinMarkers(players: Readonly<Record<string, STPlayerRecord>>): { holder: Seated; effect: EffectRecord }[] {
  return Object.values(players).flatMap((holder) => seated(holder)
    ? holder.effects.filter((effect) => effect.type === TWIN_EFFECT && effect.state === "active").map((effect) => ({ holder, effect })) : []);
}

/** The Evil Twin a marker names, or null (a marker with no readable name stays inert). */
const namedEvilTwin = (effect: EffectRecord): string | null => {
  const named = effect.parameters?.[TWIN_EVIL_PARAMETER];
  return named?.kind === "participant" && named.participants.length === 1 ? named.participants[0]!.participantId : null;
};

export function twinPairOf(players: Readonly<Record<string, STPlayerRecord>>): TwinPair {
  const evils = Object.values(players).filter((player): player is Seated => seated(player) && player.actualRole === "eviltwin");
  if (!evils.length) return { kind: "none" };
  if (evils.length > 1) return { kind: "many" };
  const evil = evils[0]!;
  const marked = twinMarkers(players).filter(({ holder, effect }) => holder.participantId !== evil.participantId && namedEvilTwin(effect) === evil.participantId);
  const found = marked.length === 1 ? marked[0]! : null;
  const none = (reason: string): TwinPair => ({ kind: "single", evil, other: found?.holder ?? null, marker: found?.effect ?? null, valid: false, good: null, reason, markers: marked.length });
  if (marked.length > 1) return none("More than one player carries the TWIN reminder for this Evil Twin.");
  if (!found) return none("No player is marked as the Good Twin.");
  if (!evil.actualAlignment || !found.holder.actualAlignment) return none("A Twin's alignment is not recorded.");
  if (evil.actualAlignment === found.holder.actualAlignment) return none("Both Twins are now the same alignment.");
  const good = evil.actualAlignment === "good" ? evil : found.holder;
  return { kind: "single", evil, other: found.holder, marker: found.effect, valid: true, good, reason: "", markers: 1 };
}

/** The first Night on which a marker placed at `moment` can have been introduced: a setup or Night N marker, by the Evil Twin's step that
 * Night; a Day N marker, by the next Night's. */
const introducedFrom = (moment: GameMoment | undefined): number =>
  !moment || moment.phase === "setup" ? 1 : moment.phase === "night" ? moment.day : moment.day + 1;

/**
 * Whether the Evil Twin's introduction has been done for the pair as it stands: the Evil Twin's own step is recorded done on a Night
 * at or after the Night the marker could first be introduced. A re-chosen Good Twin (a new marker) or a new Evil Twin (a new step key)
 * is introduced afresh; nothing is stored beyond the step the Night card already records.
 */
export function twinIntroduced(pair: Extract<TwinPair, { kind: "single" }>, progress: Readonly<Record<string, { status: string }>> | undefined, day: number): boolean {
  if (!pair.valid || !pair.marker || !pair.evil.participantId) return false;
  const key = participantStepKey(pair.evil.participantId, "eviltwin");
  const from = introducedFrom(pair.marker.appliedAt);
  for (let night = from; night <= day; night++) if (progress?.[`${night}:${key}`]?.status === "done") return true;
  return false;
}

/**
 * Choosing the Good Twin (at setup, or again on a later Night when the pair broke or an Evil Twin was made): ONE transaction that takes
 * every earlier TWIN marker away and puts the new one on the chosen player ("choosing moves the TWIN token and no longer leaves it on
 * the old Twin"). The chosen player must be seated, not a Traveller ("rarely a good idea"), not the Evil Twin, and of the OPPOSING alignment.
 */
export function goodTwinIntents(game: { players: Readonly<Record<string, STPlayerRecord>> }, evil: { playerId: string; participantId: string }, target: { playerId: string; participantId: string }):
  { ok: true; intents: EffectIntent[] } | { ok: false; message: string } {
  const evilPlayer = game.players[evil.playerId];
  const chosen = game.players[target.playerId];
  if (!seated(evilPlayer) || evilPlayer.participantId !== evil.participantId || evilPlayer.actualRole !== "eviltwin") return { ok: false, message: "The Evil Twin changed. Review the Twins." };
  if (!seated(chosen) || chosen.participantId !== target.participantId) return { ok: false, message: "The chosen player changed. Choose again." };
  if (chosen.id === evilPlayer.id) return { ok: false, message: "The Good Twin is the other player." };
  if (chosen.isTraveler) return { ok: false, message: "A Traveller is not offered as a Twin. Use the existing effect controls to do it by hand." };
  if (!chosen.actualAlignment || !evilPlayer.actualAlignment || chosen.actualAlignment === evilPlayer.actualAlignment)
    return { ok: false, message: "The two Twins must be of opposing alignments." };
  const remove = twinMarkers(game.players).map(({ holder, effect }) => ({ kind: "remove" as const, target: { playerId: holder.id, participantId: holder.participantId }, effectId: effect.id }));
  return { ok: true, intents: [...remove, { kind: "apply", target: { playerId: chosen.id, participantId: chosen.participantId },
    effect: { type: TWIN_EFFECT, lifetime: { kind: "manual" }, parameters: { [TWIN_EVIL_PARAMETER]: { kind: "participant", participants: [{ playerId: evilPlayer.id, participantId: evilPlayer.participantId }] } } } }] };
}
