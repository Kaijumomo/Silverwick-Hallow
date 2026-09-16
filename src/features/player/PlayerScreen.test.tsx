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
  return { ...actual, usePlayerSync: () => {}, leaveLobby: vi.fn(async () => {}), chooseTraveler: vi.fn(async () => {}) };
});
vi.mock("@/firebase/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/session")>();
  return { ...actual, connectFirebase: async () => ({ backend: {} as never, uid: "alice" }) };
});

import { chooseTraveler, leaveLobby } from "@/firebase/playerSync";
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

function seedSeatedTraveler(publicDisplayRole?: string) {
  seedSeated();
  usePlayerStore.setState((s) => ({
    self: null,
    publicLobby: {
      ...s.publicLobby!,
      players: {
        "p-alice": { ...s.publicLobby!.players["p-alice"]!, isTraveler: true, publicDisplayRole },
      },
    },
  }));
}

beforeEach(() => {
  __setEnvOverrideForTests({});
  saveFirebaseConfig(validCfg);
  vi.mocked(leaveLobby).mockClear();
  vi.mocked(chooseTraveler).mockClear();
  vi.mocked(chooseTraveler).mockResolvedValue(undefined);
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

describe("PlayerScreen Traveler choice (Phase 9 Setup finalization B4)", () => {
  it("an ordinary player never sees the Traveler picker", async () => {
    render(<PlayerScreen />);
    await screen.findByText("Request to leave lobby");
    expect(screen.queryByText("Choose your Traveler")).toBeNull();
  });

  it("a designated Traveler with no chosen character sees the picker, restricted to the Traveler catalogue", async () => {
    seedSeatedTraveler(undefined);
    render(<PlayerScreen />);
    await screen.findByText("Choose your Traveler");
    // Restricted to the supported Traveler catalogue -- never an ordinary role.
    expect(screen.getByRole("button", { name: /Scapegoat/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Chef$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Imp$/ })).toBeNull();
  });

  it("choosing a character calls the self-scoped chooseTraveler command, never a Storyteller-only path", async () => {
    seedSeatedTraveler(undefined);
    render(<PlayerScreen />);
    await screen.findByText("Choose your Traveler");
    fireEvent.click(screen.getByRole("button", { name: /Scapegoat/ }));
    await waitFor(() => expect(chooseTraveler).toHaveBeenCalledWith(expect.anything(), "scapegoat"));
  });

  it("surfaces a submission failure without silently succeeding", async () => {
    vi.mocked(chooseTraveler).mockRejectedValueOnce(new Error("offline"));
    seedSeatedTraveler(undefined);
    render(<PlayerScreen />);
    await screen.findByText("Choose your Traveler");
    fireEvent.click(screen.getByRole("button", { name: /Scapegoat/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // Still showing the picker -- nothing was silently applied.
    expect(screen.getByText("Choose your Traveler")).toBeInTheDocument();
  });

  it("once a character is publicly assigned, the picker no longer shows (Storyteller override or applied choice alike)", async () => {
    seedSeatedTraveler("thief");
    render(<PlayerScreen />);
    await screen.findByText("Request to leave lobby");
    expect(screen.queryByText("Choose your Traveler")).toBeNull();
  });
});
