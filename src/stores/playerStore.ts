// Player-side state. Independent from storytellerStore — different role,
// different localStorage key. The player does not maintain canonical state;
// they read projections written by the ST.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { GameResult, PlayerSelfEnvelope, PublicLobbyRecord, RoleId } from "./types";

export type PlayerStatus =
  | "idle"
  | "configuring"
  | "connecting"
  | "knocking"
  | "waiting"
  | "seated"
  | "ended"
  | "error"
  | "reconnecting"
  | "rejected"
  | "revoked"
  | "notFound"
  | "leaving"
  /** Phase 10H (contract §16): the Storyteller has begun the terminal close
   * (public/status = ended) but the session has not ended yet. Context is
   * preserved; the session's end resolves it. */
  | "ending";

/**
 * Phase 10H (contract §16): the player-safe terminal result of the finished
 * session, read from this player's own results/{uid} after the session ended.
 * Runtime only (re-read after a reload). "none": no recorded result (End
 * Without Result, or not a participant) -- the generic Game Ended screen;
 * "error": the read failed -- retryable, never shown as "none".
 */
export type PlayerTerminalResult =
  | { status: "pending" }
  | { status: "ready"; result: GameResult }
  | { status: "none" }
  | { status: "error"; message: string };

export type TownNoteConfidence = "suspect" | "likely" | "confirm";

export type TownNote = {
  confidence: TownNoteConfidence | null;
  roles: RoleId[];  // up to 3, from the active script
  text: string;     // optional short note
};

/**
 * Town notes are private to the player's device. Keyed by `${code}:${seatId}`
 * so notes don't leak across lobbies. Stored in localStorage; never written
 * to Firebase.
 */
export type TownNoteMap = Record<string, TownNote>;

export type PlayerStore = {
  /** Ephemeral remote validation status; never persisted. */
  remoteData: { public: "waiting" | "ready" | "invalid" | "error"; self: "waiting" | "ready" | "invalid" | "error"; membership: "ready" | "invalid" | "error"; request: "ready" | "invalid" | "error" };
  setRemoteData: (patch: Partial<PlayerStore["remoteData"]>) => void;
  code: string | null;
  uid: string | null;
  playerId: string | null;
  requestedName: string | null;
  status: PlayerStatus;
  error: string | null;
  self: PlayerSelfEnvelope | null;
  publicLobby: PublicLobbyRecord | null;
  // UX flag — has the player tapped to reveal their sealed-card role yet?
  // Phase 10H (F2, 10H-AC-030): runtime only -- never persisted, reset by
  // every handshake (reload, reconnect, re-attach) and by a reveal-token
  // change, so the card always re-seals.
  revealed: boolean;
  townNotes: TownNoteMap;
  /** Phase 10H: the id of the session this player joined, captured from the
   * active session record; the terminal result must name it (10H-AC-056).
   * Persisted with the rest of the terminal context until Back to Start. */
  sessionId: string | null;
  /** Phase 10H: this player's own advisory acknowledgement (the reveal token
   * stored at revealAcks/{uid}); null when none or unreadable. Runtime only. */
  ownRevealAck: string | null;
  /** Phase 10H: runtime terminal result state (see PlayerTerminalResult).
   * ASTRA-10H-007: `null` means only "not in a terminal state" -- never
   * "reading". Entering the ended state always names its result state
   * explicitly (setEnded), so a pending read is `{ status: "pending" }`. */
  terminalResult: PlayerTerminalResult | null;

  setStatus: (status: PlayerStatus, error?: string | null) => void;
  setSession: (s: { code: string; uid: string; requestedName: string }) => void;
  setPlayerId: (id: string | null) => void;
  setSelf: (self: PlayerSelfEnvelope | null) => void;
  setPublic: (p: PublicLobbyRecord | null) => void;
  setRevealed: (revealed: boolean) => void;
  setTownNote: (code: string, seatId: string, note: TownNote | null) => void;
  setSessionId: (sessionId: string | null) => void;
  setOwnRevealAck: (token: string | null) => void;
  setTerminalResult: (result: PlayerTerminalResult | null) => void;
  /** Called when the live session ends. Phase 10H (contract §16; amends the
   * 10G "clear the session" behavior): the terminal context -- lobby code,
   * uid, seat, session id and Town notes -- is RETAINED so the player can read
   * their result and review their notes after teardown, and so a reload
   * recovers the result. Private identity is cleared. Only Back to Start
   * (reset) clears the context. */
  /** Enter the ended state with an EXPLICIT terminal result state (ASTRA-10H-007):
   * `pending` while this player's own result is being read, `none` when there
   * is no result to read (or no context to read it with). */
  setEnded: (terminalResult: PlayerTerminalResult) => void;
  /** Back to Start: clears the session/terminal context and the finished
   * game's local Town notes (10H-AC-058). */
  reset: () => void;
};

const noteKey = (code: string, seatId: string): string => `${code}:${seatId}`;

const isEmpty = (note: TownNote): boolean =>
  note.confidence === null && note.roles.length === 0 && note.text.trim().length === 0;

export function migratePlayerState(state: unknown, fromVersion: number): unknown {
  const s = state as { townNotes?: Record<string, unknown>; revealed?: unknown };
  if (fromVersion < 3) {
    // Convert old { text, tag } notes to new { confidence, roles, text } shape.
    // Old "good"/"evil"/"unsure" tags have no direct mapping; drop them.
    if (s.townNotes) {
      const converted: Record<string, TownNote> = {};
      for (const [k, v] of Object.entries(s.townNotes)) {
        const old = v as { text?: string; tag?: unknown };
        converted[k] = {
          confidence: null,
          roles: [],
          text: old.text ?? "",
        };
      }
      s.townNotes = converted;
    }
  }
  // Phase 10H (F2, 10H-AC-030): the reveal UX flag is no longer persisted --
  // a stored "revealed" from v3 must never re-open the card after a reload.
  if (fromVersion < 4) delete s.revealed;
  return state;
}

export const usePlayerStore = create<PlayerStore>()(
  persist(
    (set) => ({
      remoteData: { public: "waiting", self: "waiting", membership: "ready", request: "ready" },
      setRemoteData: (patch) => set((state) => ({ remoteData: { ...state.remoteData, ...patch } })),
      code: null,
      uid: null,
      playerId: null,
      requestedName: null,
      status: "idle",
      error: null,
      self: null,
      publicLobby: null,
      revealed: false,
      townNotes: {},
      sessionId: null,
      ownRevealAck: null,
      terminalResult: null,

      setStatus: (status, error = null) => set({ status, error }),
      setSession: ({ code, uid, requestedName }) =>
        set({ code, uid, requestedName, playerId: null, error: null, self: null, publicLobby: null,
          sessionId: null, ownRevealAck: null, terminalResult: null, revealed: false,
          remoteData: { public: "waiting", self: "waiting", membership: "ready", request: "ready" } }),
      setPlayerId: (id) => set({ playerId: id }),
      setSelf: (self) => set({ self }),
      setPublic: (publicLobby) => set({ publicLobby }),
      setRevealed: (revealed) => set({ revealed }),
      setTownNote: (code, seatId, note) =>
        set((s) => {
          const k = noteKey(code, seatId);
          const next = { ...s.townNotes };
          if (note === null || isEmpty(note)) {
            delete next[k];
          } else {
            next[k] = {
              confidence: note.confidence,
              roles: note.roles.slice(0, 3),
              text: note.text,
            };
          }
          return { townNotes: next };
        }),
      setSessionId: (sessionId) => set({ sessionId }),
      setOwnRevealAck: (ownRevealAck) => set({ ownRevealAck }),
      setTerminalResult: (terminalResult) => set({ terminalResult }),
      setEnded: (terminalResult) =>
        set({
          terminalResult,
          remoteData: { public: "waiting", self: "waiting", membership: "ready", request: "ready" },
          status: "ended",
          error: null,
          self: null,
          revealed: false,
          ownRevealAck: null,
        }),
      reset: () =>
        set((s) => {
          const prefix = s.code ? `${s.code}:` : null;
          const townNotes = prefix
            ? Object.fromEntries(Object.entries(s.townNotes).filter(([key]) => !key.startsWith(prefix)))
            : s.townNotes;
          return {
            remoteData: { public: "waiting", self: "waiting", membership: "ready", request: "ready" },
            code: null,
            uid: null,
            playerId: null,
            requestedName: null,
            status: "idle",
            error: null,
            self: null,
            publicLobby: null,
            revealed: false,
            sessionId: null,
            ownRevealAck: null,
            terminalResult: null,
            townNotes,
          };
        }),
    }),
    {
      name: "new-blood-player",
      version: 4,
      storage: createJSONStorage(() => localStorage),
      migrate: migratePlayerState,
      // Phase 10H: `revealed` is deliberately absent (always re-seal), and the
      // terminal context (code, uid, seat, session id, Town notes) persists
      // until Back to Start.
      partialize: (s) => ({
        code: s.code,
        uid: s.uid,
        playerId: s.playerId,
        requestedName: s.requestedName,
        sessionId: s.sessionId,
        townNotes: s.townNotes,
      }),
    }
  )
);
