// Phase 10G Astra remediation, ASTRA-10G-002: the waiting queue can never
// mutate an ended game -- not through its controls, an open popup, a stale
// action, or a membership seating begun before Finish game and completed
// after it (PHASE10G Sections 17.4, 18; AC-34, AC-37). Every case attempts a
// real mutation and checks players, participant identity, the queue and
// localSeq.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Json } from "@/firebase/backend";

const close = vi.fn<() => Promise<void>>();
vi.mock("@/firebase/storytellerSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/storytellerSync")>();
  return { ...actual, closeMultiplayerSession: () => close() };
});

import { GameScreen } from "./GameScreen";
import { SeatAssignPopup } from "@/features/grimoire/SeatAssignPopup";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { buildRegistry } from "@/data/roleRegistry";
import { setupGame, setupScript } from "@/test/setupFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const state = () => store.getState();
const game = () => state().game!;
const registry = buildRegistry(setupScript);
const ROLES = ["monk", "imp", "empath", "chef", "poisoner", "saint", "washerwoman"];
const NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Finn", "Gail"];
const UID = "waiting-uid";
const SEAT = "p6";

function liveGame(over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase: "day", day: 2, setupRolesDealt: true, setupRolesRevealed: true, ...over });
  for (const [index, p] of Object.values(g.players).entries()) { p.actualAlignment = registry.alignmentOf(p.actualRole); p.name = NAMES[index]!; }
  return g;
}
/** A Day game with one empty seat (p6, unseated through the real command)
 * and one waiting player. */
function withQueue() {
  store.setState({ game: liveGame(), undoStack: [], localSeq: 0, lobby: null, sync: null });
  expect(state().unseatPlayer(SEAT)).toBe(true);
  state().addToPendingQueue(UID, "Zed");
  expect(game().players[SEAT]!.isEmpty).toBe(true);
  expect(game().pendingPlayers).toEqual({ [UID]: "Zed" });
}
const snapshot = () => ({ game: state().game, players: game().players, pending: game().pendingPlayers, seq: state().localSeq });
function expectUntouched(before: ReturnType<typeof snapshot>) {
  expect(state().game).toBe(before.game);
  expect(game().players).toBe(before.players);
  expect(game().players[SEAT]!.isEmpty).toBe(true);
  expect(game().players[SEAT]!.participantId).toBeUndefined();
  expect(game().pendingPlayers).toBe(before.pending);
  expect(state().localSeq).toBe(before.seq);
}

/** Memory backend that can hold the seating's roster update open. */
class GatedBackend extends MemoryRoomBackend {
  private gate: Promise<void> | null = null;
  holdNextUpdate(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => { release = resolve; });
    return release;
  }
  override async update(values: Record<string, Json>): Promise<void> {
    const gate = this.gate;
    this.gate = null;
    if (gate) await gate;
    return super.update(values);
  }
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  close.mockReset();
  close.mockResolvedValue(undefined);
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
  store.setState({ customScripts: { [setupScript.id]: setupScript }, selectedPlayerId: null, view: "game" });
  withQueue();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const queueButton = () => screen.queryByRole("button", { name: "1 in queue" });

describe("ASTRA-10G-002: ordinary live queue assignment is unchanged", () => {
  it("Day: the queue opens and Assign seats the waiting player through the store command", async () => {
    render(<GameScreen />);
    fireEvent.click(queueButton()!);
    const dialog = screen.getByRole("dialog", { name: "Waiting queue" });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Assign" })); });
    expect(game().players[SEAT]).toMatchObject({ isEmpty: false, name: "Zed" });
    expect(game().players[SEAT]!.participantId).toBeTruthy();
    expect(game().pendingPlayers).toEqual({});
  });
});

describe("ASTRA-10G-002: the ended review mounts no queue mutation", () => {
  it("the queue control is absent once ended (present in Day as a control)", () => {
    const view = render(<GameScreen />);
    expect(queueButton()).not.toBeNull();
    view.unmount();
    expect(state().finishGame()).toEqual({ ok: true });
    render(<GameScreen />);
    expect(queueButton()).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Waiting queue" })).toBeNull();
  });

  it("an open queue unmounts when Finish game lands, and the snapshot keeps its empty seat and queue", async () => {
    render(<GameScreen />);
    fireEvent.click(queueButton()!);
    expect(screen.getByRole("dialog", { name: "Waiting queue" })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Finish game" })); });
    expect(game().phase).toBe("ended");
    expect(screen.queryByRole("dialog", { name: "Waiting queue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Assign" })).toBeNull();
    expect(game().players[SEAT]!.isEmpty).toBe(true);
    expect(game().pendingPlayers).toEqual({ [UID]: "Zed" });
  });
});

describe("ASTRA-10G-002: the assignment boundary refuses an ended game", () => {
  it("a direct / stale local assignment after Finish is refused with nothing changed; reject and intake are frozen too", () => {
    const { assignPendingToSeat, removePendingPlayer, addToPendingQueue } = state(); // captured while live
    state().finishGame();
    const before = snapshot();
    expect(assignPendingToSeat(UID, SEAT)).toBe(false);
    expect(assignPendingToSeat(UID, SEAT, "fresh-participant")).toBe(false);
    removePendingPlayer(UID);
    addToPendingQueue("late-uid", "Late");
    expectUntouched(before);
  });

  it("a popup still mounted when the game ends cannot assign (stale UI action)", async () => {
    render(<SeatAssignPopup backend={null} code="" onClose={() => {}} />);
    act(() => { state().finishGame(); });
    const before = snapshot();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Assign" })); });
    expectUntouched(before);
  });

  it("an in-flight multiplayer seating begun before Finish game cannot complete into the ended snapshot", async () => {
    const b = new GatedBackend();
    const release = b.holdNextUpdate();
    render(<SeatAssignPopup backend={b} code="ROOM1234" onClose={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Assign" })); });
    // The roster write is in flight; the session then closes authoritatively
    // and the game is finished.
    act(() => { expect(state().finishGame()).toEqual({ ok: true }); });
    const before = snapshot();
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expectUntouched(before);
    // The binding was written, the local commit was refused, so the seating
    // rolled the binding back.
    expect(b.writeLog.some((entry) => entry.path === `lobbies/ROOM1234/roster/${UID}` && entry.value === SEAT)).toBe(true);
    expect(await b.get(`lobbies/ROOM1234/roster/${UID}`)).toBeUndefined();
  });

  it("after a successful live multiplayer Finish, no queued player can be seated", async () => {
    store.setState({ lobby: { code: "ROOM1234", uid: "st", sessionId: "s1", status: "live" } });
    close.mockImplementation(async () => { state().setLobby(null); });
    render(<GameScreen />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Finish game" })); });
    expect(close).toHaveBeenCalledTimes(1);
    expect(game().phase).toBe("ended");
    expect(state().lobby).toBeNull();
    expect(queueButton()).toBeNull();
    const before = snapshot();
    expect(state().assignPendingToSeat(UID, SEAT)).toBe(false);
    expectUntouched(before);
  });
});
