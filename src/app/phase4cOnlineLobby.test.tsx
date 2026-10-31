// Package 4C: the lobby lifecycle inside Prepare the Town, against the in-memory room backend (never Firebase).
// The lobby is created only by "Players join by code" and is closed again by "In person".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RoomBackend } from "@/firebase/backend";

const connect = vi.fn<() => Promise<{ backend: RoomBackend; uid: string }>>();
vi.mock("@/firebase/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/session")>();
  return { ...actual, connectFirebase: () => connect() };
});
vi.mock("@/firebase/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/config")>();
  return { ...actual, isFirebaseConfigured: () => true };
});

import { App } from "./App";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { useV6Ui } from "@/features/grimoire-v6/v6Store";
import { useSetupFlow } from "@/features/grimoire-v6/setup/flow";

const state = () => store.getState();
const UID = "st-uid";
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  connect.mockReset();
  connect.mockResolvedValue({ backend: new MemoryRoomBackend(), uid: UID });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, joined: [], pending: 0, reconnect: { status: "live" }, status: "idle", failure: null, closeFailed: false, leaveOffer: null, unattachedCleanupFailures: [] });
  store.setState({ game: null, lobby: null, view: "home", undoStack: [], localSeq: 0, sync: null, selectedPlayerId: null });
  useV6Ui.getState().set({ wiz: null, picker: null, seatMode: false, prepEdit: null, panel: null });
  useSetupFlow.getState().set({ busy: false, lobby: "idle", notice: null, gathered: false, queueOpen: false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function openTown() {
  render(<App />);
  click(/New game/);
  click(/Trouble Brewing/);
  click(/Fabled & Loric ›/);
  await act(async () => { click(/Skip to the town/); });
}

describe("lobby lifecycle in Prepare the Town", () => {
  it("creates no lobby until Players join by code, then shows the invitation and holds the Begin gate", async () => {
    await openTown();
    expect(state().game!.phase).toBe("setup");
    expect(state().lobby).toBeNull();
    expect(screen.queryByText("Waiting for the town")).toBeNull(); // the invitation needs an attached lobby

    await act(async () => { click("Players join by code"); });
    await waitFor(() => expect(state().lobby).not.toBeNull());
    expect(state().lobby!.code).toHaveLength(8);
    expect(screen.getByText("Waiting for the town")).toBeInTheDocument();

    // Nobody has joined: Begin is held (five distinct joined players and a live writer are required), and nobody is seated.
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Begin with 0/ }).at(-1)!); });
    expect(useSetupFlow.getState().gathered).toBe(false);
    expect(Object.values(state().game!.players).every((p) => p.isEmpty)).toBe(true);
  });

  it("In person closes the lobby authoritatively and returns to an offline setup", async () => {
    await openTown();
    await act(async () => { click("Players join by code"); });
    await waitFor(() => expect(state().lobby).not.toBeNull());
    await act(async () => { click("In person"); });
    await waitFor(() => expect(state().lobby).toBeNull());
    expect(useSessionRuntime.getState().backend).toBeNull();
    expect(screen.getByText("Seat your town")).toBeInTheDocument();
  });

  it("a failed connection leaves the offline setup intact and offers Try again", async () => {
    connect.mockRejectedValue(new Error("network down"));
    await openTown();
    await act(async () => { click("Players join by code"); });
    await waitFor(() => expect(useSetupFlow.getState().lobby).toBe("failed"));
    expect(state().lobby).toBeNull();
    expect(state().game!.phase).toBe("setup");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
