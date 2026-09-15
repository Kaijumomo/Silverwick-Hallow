import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useStorytellerStore as storyteller } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";

// Phase 9C.3 (OPUS-003): the Storyteller-only pending-departure surface in
// GameScreen. Accept/reject are mocked here — their real Firebase behavior
// is already proven in membershipCommands.test.ts and lifecycle.test.ts —
// so this isolates the UI's own contract: name mapping, per-row in-flight
// disabling, duplicate-click prevention, and surfacing failure without
// pretending the request resolved.
vi.mock("@/firebase/membershipCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/membershipCommands")>();
  return { ...actual, acceptLeaveRequest: vi.fn(), rejectLeaveRequest: vi.fn() };
});

import { acceptLeaveRequest, rejectLeaveRequest } from "@/firebase/membershipCommands";
import { GameScreen } from "./GameScreen";

let seatId = "";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  usePrivacyStore.setState({ enabled: false });
  storyteller.setState({ game: null, lobby: null, undoStack: [] });
  storyteller.getState().newGame("tb");
  storyteller.getState().addPlayer("Alice");
  seatId = storyteller.getState().game!.seatOrder[0]!;
  storyteller.setState({ lobby: { code: "ABCD2345", uid: "host", sessionId: "test-session", status: "live" } });
  useSessionRuntime.setState({ backend: {} as never, leaveRequests: { "uid-alice": seatId } });
  vi.mocked(acceptLeaveRequest).mockReset();
  vi.mocked(rejectLeaveRequest).mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useSessionRuntime.setState({ backend: null, leaveRequests: {} });
});

describe("GameScreen pending leave requests (Phase 9C.3, OPUS-003)", () => {
  it("shows the roster-mapped name and disables both row actions while accepting is in flight, preventing duplicate clicks", async () => {
    let resolveAccept!: () => void;
    vi.mocked(acceptLeaveRequest).mockImplementation(() => new Promise<void>(resolve => { resolveAccept = resolve; }));

    render(<GameScreen />);
    expect(screen.getByText("Leave requests")).toBeInTheDocument();
    expect(screen.getByText("Alice requested to leave")).toBeInTheDocument();

    const acceptButton = screen.getByRole("button", { name: "Accept leave" });
    const keepButton = screen.getByRole("button", { name: "Keep seated" });
    fireEvent.click(acceptButton);
    fireEvent.click(acceptButton); // duplicate click while the first is still in flight

    expect(acceptLeaveRequest).toHaveBeenCalledTimes(1);
    expect(acceptButton).toBeDisabled();
    expect(keepButton).toBeDisabled();

    resolveAccept();
    await waitFor(() => expect(acceptButton).not.toBeDisabled());
  });

  it("falls back to a generic label when the uid does not currently map to a known local seat", () => {
    useSessionRuntime.setState({ leaveRequests: { "uid-ghost": null } });
    render(<GameScreen />);
    expect(screen.getByText("A player requested to leave")).toBeInTheDocument();
  });

  it("surfaces a rejection failure without pretending the request resolved", async () => {
    vi.mocked(rejectLeaveRequest).mockRejectedValue(new Error("offline"));

    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Keep seated" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // The row (and the still-pending request it represents) stays visible —
    // failure is surfaced, not silently treated as resolved.
    expect(screen.getByText("Alice requested to leave")).toBeInTheDocument();
  });
});
