// A phone in a game on an imported custom script: the Script tab and the Notes
// guess sheet are built from the published name and official character ids.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { usePlayerStore } from "@/stores/playerStore";
import { __setEnvOverrideForTests, clearFirebaseConfig, saveFirebaseConfig } from "@/firebase/config";

vi.mock("@/firebase/playerSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/playerSync")>();
  return { ...actual, usePlayerSync: () => {}, leaveLobby: vi.fn(async () => {}), acknowledgeReveal: vi.fn(async () => {}) };
});
const connection = vi.hoisted(() => ({ backend: null as unknown }));
vi.mock("@/firebase/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/session")>();
  return { ...actual, connectFirebase: async () => ({ backend: connection.backend as never, uid: "alice" }) };
});

import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { PlayerScreen } from "./PlayerScreen";
import { enterTown } from "./phone/ceremonyTestUtils";
import type { PublicLobbyRecord } from "@/stores/types";

const TOKEN = "tok_aaaaaaaaaaaaaaaaaaaaaa";
const lobby = (extra: Partial<PublicLobbyRecord>): PublicLobbyRecord => ({
  code: "ABCD2345", scriptId: "treacherous-30th", phase: "setup", day: 0, seatOrder: ["p-alice", "p-bob"], fabled: [], lorics: [],
  players: {
    "p-alice": { id: "p-alice", name: "Alice", seat: 0, online: true, joinedAt: 0, isTraveler: false, alive: true, ghostVote: true },
    "p-bob": { id: "p-bob", name: "Bob", seat: 1, online: true, joinedAt: 0, isTraveler: false, alive: true, ghostVote: true },
  },
  ...extra,
});
function seat(publicLobby: PublicLobbyRecord) {
  usePlayerStore.setState({
    code: "ABCD2345", uid: "alice", playerId: "p-alice", requestedName: "Alice", status: "seated", error: null,
    self: { shownRole: "empath", shownAlignment: "good", revealToken: TOKEN }, publicLobby,
    revealed: false, ownRevealAck: null, townNotes: {}, seatGuesses: {}, terminalResult: null,
    remoteData: { public: "ready", self: "ready", membership: "ready", request: "ready" },
  });
}
beforeEach(() => {
  localStorage.removeItem("swp-veil:ABCD2345:p-alice");
  connection.backend = new MemoryRoomBackend();
  __setEnvOverrideForTests({});
  saveFirebaseConfig({ apiKey: "AIzaSyTEST", databaseURL: "https://example-default-rtdb.firebaseio.com", projectId: "example-project" });
});
afterEach(() => { cleanup(); clearFirebaseConfig(); __setEnvOverrideForTests(null); });

describe("custom script on the player phone", () => {
  it("the Script tab names the script and lists its published characters", async () => {
    seat(lobby({ scriptName: "Treacherous 30th", scriptCharacters: ["empath", "golem", "marionette", "imp"] }));
    render(<PlayerScreen />);
    await enterTown();
    const nav = await screen.findByRole("navigation", { name: "Player views" });
    fireEvent.click(within(nav).getByRole("button", { name: "Script" }));
    expect(await screen.findByText(/Treacherous 30th · 4 characters/)).toBeInTheDocument();
    expect(screen.getByText("Golem")).toBeInTheDocument();
    expect(screen.getByText("Marionette")).toBeInTheDocument();
  });

  it("an older Storyteller that publishes no script data shows an empty list, not a wrong script", async () => {
    seat(lobby({}));
    render(<PlayerScreen />);
    await enterTown();
    const nav = await screen.findByRole("navigation", { name: "Player views" });
    fireEvent.click(within(nav).getByRole("button", { name: "Script" }));
    expect(await screen.findByText(/Script · 0 characters/)).toBeInTheDocument();
  });
});
