import { firebaseStringLength } from "@/firebase/firebaseWriteCompatibility";
import { participantRefOf } from "./participants";
import {
  MAX_PLAYER_INFO_ENTRIES_PER_PARTICIPANT,
  MAX_PLAYER_INFO_LOG_BYTES,
  MAX_PLAYER_INFO_VERSIONS,
  PlayerInfoContentSchema,
} from "./schemas";
import type {
  PlayerInfoContent,
  PlayerInfoEntry,
  PlayerInfoView,
  PlayerSelfRecord,
  STPlayerRecord,
  StorytellerLobbyRecord,
} from "./types";

/**
 * Package 3 (C1-C5): the per-participation player information log.
 *
 * The log is Storyteller-authoritative, lives on the game (never in an Undo
 * snapshot) and records what each participant was SHOWN. Only the `shown`
 * content ever leaves the Storyteller (see infoHistoryFor); superseded
 * versions of a corrected entry stay private.
 */

/** The player-visible content of a packet payload (never identity fields). */
export function contentOfPayload(payload: PlayerSelfRecord): PlayerInfoContent {
  const content: PlayerInfoContent = {};
  const text = payload.extraText?.trim();
  if (text) content.text = text;
  if (payload.demon) content.demon = { id: payload.demon.id, name: payload.demon.name, seat: payload.demon.seat };
  if (payload.minions?.length) content.minions = payload.minions.map((m) => ({ id: m.id, name: m.name, seat: m.seat }));
  if (payload.bluffs?.length) content.bluffs = [...payload.bluffs];
  return content;
}

export const contentEqual = (a: PlayerInfoContent, b: PlayerInfoContent): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const canonical = (c: PlayerInfoContent) => [c.text ?? null, c.demon ?? null, c.minions ?? null, c.bluffs ?? null];

/** The live Game Moment a delivery belongs to; absent in Setup or Ended. */
export function infoMomentOf(game: Pick<StorytellerLobbyRecord, "phase" | "day">): PlayerInfoEntry["moment"] {
  return (game.phase === "night" || game.phase === "day") && game.day > 0 ? { phase: game.phase, day: game.day } : undefined;
}

/** True when the entry belongs to exactly this seat's CURRENT participation. */
export function entryBelongsTo(entry: PlayerInfoEntry, player: Pick<STPlayerRecord, "id" | "participantId" | "isEmpty">): boolean {
  return !player.isEmpty && !!player.participantId
    && entry.recipient.participantId === player.participantId && entry.recipient.playerId === player.id;
}

/** This occupant's entries, oldest first. A different occupant of the same
 * seat (takeover, rejoin, new uid) sees none of them. */
export function entriesFor(game: Pick<StorytellerLobbyRecord, "playerInfoLog">, player: Pick<STPlayerRecord, "id" | "participantId" | "isEmpty">): PlayerInfoEntry[] {
  return game.playerInfoLog.filter((entry) => entryBelongsTo(entry, player));
}

/** The projection of this occupant's history: shown content only. */
export function infoHistoryFor(game: Pick<StorytellerLobbyRecord, "playerInfoLog">, player: Pick<STPlayerRecord, "id" | "participantId" | "isEmpty">): PlayerInfoView[] {
  return entriesFor(game, player).map((entry) => ({
    id: entry.id,
    ...(entry.moment ? { moment: { ...entry.moment } } : {}),
    ...structuredClone(entry.shown),
  }));
}

/** Whole-log budget: a bounded, Firebase-safe size for the private path and the checkpoint. */
export function playerInfoLogBytes(log: readonly PlayerInfoEntry[]): number {
  return firebaseStringLength(JSON.stringify(log));
}

export type LogResult = { ok: true; game: StorytellerLobbyRecord } | { ok: false; message: string };

const OVER_BUDGET = "This game holds as much player information as it can store. Nothing was sent.";

function withinBudget(game: StorytellerLobbyRecord, recipientId: string): string | null {
  if (game.playerInfoLog.filter((e) => e.recipient.participantId === recipientId).length > MAX_PLAYER_INFO_ENTRIES_PER_PARTICIPANT) return OVER_BUDGET;
  if (playerInfoLogBytes(game.playerInfoLog) > MAX_PLAYER_INFO_LOG_BYTES) return OVER_BUDGET;
  return null;
}

/** Appends one delivered entry to the log; refuses over budget. */
export function appendPlayerInfoEntry(game: StorytellerLobbyRecord, entry: PlayerInfoEntry): LogResult {
  if (!PlayerInfoContentSchema.safeParse(entry.shown).success) return { ok: false, message: "That information could not be recorded. Nothing was sent." };
  const next = { ...game, playerInfoLog: [...game.playerInfoLog, entry] };
  const refusal = withinBudget(next, entry.recipient.participantId);
  return refusal ? { ok: false, message: refusal } : { ok: true, game: next };
}

/** Builds the entry for a packet being published to `playerId`. */
export function newPlayerInfoEntry(
  game: StorytellerLobbyRecord,
  playerId: string,
  packetId: string,
  payload: PlayerSelfRecord,
  entryId: string,
): PlayerInfoEntry | null {
  const recipient = participantRefOf(game, playerId);
  if (!recipient || recipient.kind !== "participant") return null;
  const moment = infoMomentOf(game);
  return { id: entryId, packetId, recipient, ...(moment ? { moment } : {}), shown: contentOfPayload(payload), versions: [] };
}

/** True when sending `content` now would repeat the latest delivery verbatim. */
export function isDuplicateDelivery(
  game: StorytellerLobbyRecord,
  player: STPlayerRecord,
  content: PlayerInfoContent,
): boolean {
  const packetId = player.publishedPacket?.id;
  if (!packetId) return false;
  const latest = [...entriesFor(game, player)].reverse().find((e) => e.packetId === packetId);
  if (!latest) return false;
  const moment = infoMomentOf(game);
  return JSON.stringify(latest.moment ?? null) === JSON.stringify(moment ?? null) && contentEqual(latest.shown, content);
}

/** Keeps the original (oldest) version and the most recent ones. */
const capVersions = (versions: PlayerInfoContent[]): PlayerInfoContent[] =>
  versions.length <= MAX_PLAYER_INFO_VERSIONS ? versions : [versions[0]!, ...versions.slice(versions.length - (MAX_PLAYER_INFO_VERSIONS - 1))];

/**
 * C3: replaces what an entry shows (the player's view is silently replaced)
 * and keeps the superseded content privately. When the entry is still the
 * player's current published packet, that packet's payload is replaced too, so
 * the root fallback and the history never disagree.
 */
export function planCorrectPlayerInfo(game: StorytellerLobbyRecord, entryId: string, content: PlayerInfoContent): LogResult {
  if (game.phase === "ended") return { ok: false, message: "This game has ended." };
  const parsed = PlayerInfoContentSchema.safeParse(content);
  if (!parsed.success) return { ok: false, message: "Enter the corrected information. It cannot be empty." };
  const index = game.playerInfoLog.findIndex((entry) => entry.id === entryId);
  const entry = game.playerInfoLog[index];
  if (!entry) return { ok: false, message: "That information is no longer in the log." };
  const holder = game.players[entry.recipient.playerId];
  if (!holder || !entryBelongsTo(entry, holder)) return { ok: false, message: "That player is no longer the person who received this. It cannot be corrected." };
  if (contentEqual(entry.shown, parsed.data)) return { ok: false, message: "That is already what the player sees." };
  const nextEntry: PlayerInfoEntry = {
    ...entry,
    shown: structuredClone(parsed.data),
    versions: capVersions([...entry.versions, entry.shown]),
  };
  const log = game.playerInfoLog.map((e, i) => (i === index ? nextEntry : e));
  let players = game.players;
  if (holder.publishedPacket && holder.publishedPacket.id === entry.packetId) {
    const { extraText: _drop, demon: _d, minions: _m, bluffs: _b, ...identity } = holder.publishedPacket.payload;
    const payload: PlayerSelfRecord = {
      ...identity,
      ...(parsed.data.text ? { extraText: parsed.data.text } : {}),
      ...(parsed.data.demon ? { demon: parsed.data.demon } : {}),
      ...(parsed.data.minions ? { minions: parsed.data.minions } : {}),
      ...(parsed.data.bluffs ? { bluffs: parsed.data.bluffs } : {}),
    };
    players = { ...game.players, [holder.id]: { ...holder, publishedPacket: { ...holder.publishedPacket, payload } } };
  }
  const next = { ...game, players, playerInfoLog: log };
  const refusal = withinBudget(next, entry.recipient.participantId);
  return refusal ? { ok: false, message: refusal } : { ok: true, game: next };
}
