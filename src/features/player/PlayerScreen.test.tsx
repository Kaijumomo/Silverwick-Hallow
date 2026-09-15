import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { usePlayerStore } from "@/stores/playerStore";
import { __setEnvOverrideForTests, clearFirebaseConfig, saveFirebaseConfig } from "@/firebase/config";

// Phase 9C.3 (OPUS-003): isolate the leave-confirmation GATE this screen
// adds — that only the affirmative modal action ever invokes the existing
// leave-request command, and a cancelled confirmation invokes nothing —
// from the real Firebase handshake, which is already covered end-to-end by
// lifecycle.test.ts/membershipCommands.test.ts. usePlayerSync is mocked to
// a no-op so a real (unrelated) handshake never overwrites the seeded
// "seated" fixture mid-test, and leaveLobby is a spy so we can assert
// exactly how many times, and under which action, it is invoked.
vi.mock("@/firebase/playerSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/playerSync")>();
  return { ...actual, usePlayerSync: () => {}, leaveLobby: vi.fn(async () => {}) };
});
vi.mock("@/firebase/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/session")>();
  return { ...actual, connectFirebase: async () => ({ backend: {} as never, uid: "alice" }) };
});

import { leaveLobby } from "@/firebase/playerSync";
import { PlayerScreen } from "./PlayerScreen";

const validCfg = {
  apiKey: "AIzaSyTEST",
  databaseURL: "https://example-default-rtdb.firebaseio.com",
  projectId: "example-project",
};

function seedSeated() {
  usePlayerStore.setState({
    code: "ABCD2345",
    uid: "alice",
    playerId: "p-alice",
    requestedName: "Alice",
    status: "seated",
    error: null,
    self: { shownRole: "chef", shownAlignment: "good" },
    publicLobby: {
      code: "ABCD2345",
      scriptId: "tb",
      phase: "setup",
      day: 0,
      seatOrder: ["p-alice"],
      players: {
        "p-alice": { id: "p-alice", name: "Alice", seat: 0, alive: true, ghostVote: true, online: true, joinedAt: 0, isTraveler: false },
      },
      fabled: [],
      lorics: [],
    },
    revealed: false,
    remoteData: { public: "ready", self: "ready", membership: "ready", request: "ready" },
  });
}

beforeEach(() => {
  __setEnvOverrideForTests({});
  saveFirebaseConfig(validCfg);
  vi.mocked(leaveLobby).mockClear();
  seedSeated();
});

afterEach(() => {
  cleanup();
  clearFirebaseConfig();
  __setEnvOverrideForTests(null);
});

describe("PlayerScreen leave confirmation (Phase 9C.3, OPUS-003)", () => {
  it("requires explicit confirmation, and a cancelled confirmation invokes no leave command", async () => {
    render(<PlayerScreen />);
    await screen.findByText("Request to leave lobby");

    fireEvent.click(screen.getByText("Request to leave lobby"));
    expect(await screen.findByText("Request to leave?")).toBeInTheDocument();
    expect(screen.getByText(/You will remain seated in the game/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByText("Request to leave?")).toBeNull());

    expect(leaveLobby).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().status).toBe("seated");
  });

  it("only the affirmative action calls the existing leave-request command", async () => {
    render(<PlayerScreen />);
    await screen.findByText("Request to leave lobby");

    fireEvent.click(screen.getByText("Request to leave lobby"));
    fireEvent.click(await screen.findByRole("button", { name: "Request to leave" }));

    await waitFor(() => expect(leaveLobby).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByText("Request to leave?")).toBeNull();
  });
});
