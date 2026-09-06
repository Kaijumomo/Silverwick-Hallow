// Player-side state. Independent from storytellerStore — different role,
// different localStorage key. The player does not maintain canonical state;
// they read projections written by the ST.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { PlayerSelfRecord, PublicLobbyRecord, RoleId } from "./types";

export type PlayerStatus =
  | "idle"
  | "configuring"
  | "connecting"
  | "knocking"
  | "waiting"
  | "seated"
  | "ended"
  | "error";

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
  self: PlayerSelfRecord | null;
  publicLobby: PublicLobbyRecord | null;
  // UX flag — has the player tapped to reveal their sealed-card role yet?
  revealed: boolean;
  townNotes: TownNoteMap;

  setStatus: (status: PlayerStatus, error?: string | null) => void;
  setSession: (s: { code: string; uid: string; requestedName: string }) => void;
  setPlayerId: (id: string | null) => void;
  setSelf: (self: PlayerSelfRecord | null) => void;
  setPublic: (p: PublicLobbyRecord | null) => void;
  setRevealed: (revealed: boolean) => void;
  setTownNote: (code: string, seatId: string, note: TownNote | null) => void;
  /** Called when the live lobby ends. Clears session so localStorage is clean; sets status="ended". */
  setEnded: () => void;
  reset: () => void;
};

const noteKey = (code: string, seatId: string): string => `${code}:${seatId}`;

const isEmpty = (note: TownNote): boolean =>
  note.confidence === null && note.roles.length === 0 && note.text.trim().length === 0;

export function migratePlayerState(state: unknown, fromVersion: number): unknown {
  const s = state as { townNotes?: Record<string, unknown> };
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

      setStatus: (status, error = null) => set({ status, error }),
      setSession: ({ code, uid, requestedName }) =>
        set({ code, uid, requestedName, playerId: null, error: null, self: null, publicLobby: null,
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
      setEnded: () =>
        set({
          remoteData: { public: "waiting", self: "waiting", membership: "ready", request: "ready" },
          code: null,
          uid: null,
          playerId: null,
          requestedName: null,
          status: "ended",
          error: null,
          self: null,
          publicLobby: null,
          revealed: false,
        }),
      reset: () =>
        set({
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
        }),
    }),
    {
      name: "new-blood-player",
      version: 3,
      storage: createJSONStorage(() => localStorage),
      migrate: migratePlayerState,
      partialize: (s) => ({
        code: s.code,
        uid: s.uid,
        playerId: s.playerId,
        requestedName: s.requestedName,
        revealed: s.revealed,
        townNotes: s.townNotes,
      }),
    }
  )
);
