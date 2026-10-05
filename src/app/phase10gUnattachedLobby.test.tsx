// Phase 10G Astra closure remediation, ASTRA-10G-R1-001: when the
// authoritative cleanup of a superseded Go Live lobby FAILS, the Storyteller
// keeps a visible warning naming that lobby across ordinary navigation
// (Finish game -> Home, Home -> New Game -> Create setup, back to the game)
// until it is explicitly dismissed. Rendered through the real App shell, so
// each regression proves the warning is visible after GameScreen is gone.
// The ASTRA-10G-001 authority invariant is unchanged: the superseded lobby is
// never attached and no writer starts for it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Json, RoomBackend } from "@/firebase/backend";

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
import { formatCode } from "@/firebase/lobby";
import { buildRegistry } from "@/data/roleRegistry";
import { setupGame, setupScript } from "@/test/setupFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { finishGame } from "@/test/finishGame";

const state = () => store.getState();
const registry = buildRegistry(setupScript);
const ROLES = ["monk", "imp", "empath", "chef", "poisoner", "saint", "washerwoman"];
const UID = "st-uid";

/** Memory backend that can hold the Go Live session read open, and can make
 * the fenced closer's lease acquisition fail (the authoritative cleanup). */
class CleanupBackend extends MemoryRoomBackend {
  private sessionGate: Promise<void> | null = null;
  failLease = false;
  holdSessionRead(): () => void {
    let release!: () => void;
    this.sessionGate = new Promise<void>((resolve) => { release = resolve; });
    return release;
  }
  override async get(path: string): Promise<unknown> {
    if (path.endsWith("/session") && this.sessionGate) {
      const gate = this.sessionGate;
      this.sessionGate = null;
      await gate;
    }
    return super.get(path);
  }
  override async transaction(path: string, change: (current: unknown) => Json | undefined): Promise<boolean> {
    if (this.failLease && path.endsWith("/writer")) throw new Error("PERMISSION_DENIED: simulated cleanup failure");
    return super.transaction(path, change);
  }
  /** Whether any writer ever HELD a lease on, or projected into, `code`
   * (a release record, expiresAt 0, is not a held lease). */
  writerEverActive(code: string): boolean {
    return this.writeLog.some((entry) =>
      (entry.path === `lobbies/${code}/writer` && ((entry.value as { expiresAt?: number } | null)?.expiresAt ?? 0) > 0)
      || [`lobbies/${code}/checkpoint`, `lobbies/${code}/storyteller`, `lobbies/${code}/writeGuard`].includes(entry.path));
  }
  lobbyCodes(): string[] {
    return Object.keys((this as unknown as { root: { lobbies?: Record<string, unknown> } }).root.lobbies ?? {});
  }
}

function liveGame(over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase: "night", day: 2, setupRolesDealt: true, setupRolesRevealed: true, ...over });
  for (const p of Object.values(g.players)) p.actualAlignment = registry.alignmentOf(p.actualRole);
  return g;
}
const warnings = () => document.querySelectorAll("[data-unattached-lobby]");
const warningFor = (code: string) => document.querySelector(`[data-unattached-lobby="${code}"]`) as HTMLElement | null;
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  connect.mockReset();
  // The App shell auto-connects on mount; each test sets its own Go Live backend.
  connect.mockResolvedValue({ backend: new MemoryRoomBackend(), uid: UID });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" }, status: "idle", failure: null, closeFailed: false, leaveOffer: null, unattachedCleanupFailures: [] });
  store.setState({ game: liveGame(), lobby: null, undoStack: [], localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript }, selectedPlayerId: null, view: "game" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Starts Go Live in the rendered App and stops it after the remote lobby
 * exists, before the session acquisition that precedes adoption. */
async function goLiveHeldBeforeAdoption(b: CleanupBackend): Promise<{ release: () => void; code: () => string }> {
  const release = b.holdSessionRead();
  connect.mockResolvedValue({ backend: b, uid: UID });
  fireEvent.click(screen.getByRole("button", { name: "Go live" }));
  await waitFor(() => expect(b.lobbyCodes()).toHaveLength(1));
  return { release, code: () => b.lobbyCodes()[0]! };
}

describe("ASTRA-10G-R1-001-A: Finish game -> Home, then the superseded cleanup fails", () => {
  it("the ended game stays detached, no writer starts, and Home shows the warning with the room code", async () => {
    const b = new CleanupBackend();
    render(<App />);
    const held = await goLiveHeldBeforeAdoption(b);
    const code = held.code();
    await finishGame();
    expect(state().game!.phase).toBe("ended");
    fireEvent.click(screen.getByRole("button", { name: "← Home" }));
    expect(screen.getByRole("button", { name: "Review finished game" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish game" })).toBeNull(); // GameScreen is gone
    b.failLease = true;
    await act(async () => { held.release(); });
    await waitFor(() => expect(warningFor(code)).not.toBeNull());

    // Authority (ASTRA-10G-001) unchanged: detached, no writer.
    expect(state().lobby).toBeNull();
    expect(state().game!.phase).toBe("ended");
    expect(state().game!.code).toBe("");
    expect(useSessionRuntime.getState().backend).toBeNull();
    expect(b.writerEverActive(code)).toBe(false);
    expect(await b.get(`lobbies/${code}/session`)).toMatchObject({ state: "active" }); // cleanup really failed
    // The visible warning names the affected lobby and says the game is not connected.
    const warning = warningFor(code)!;
    expect(warning).toHaveAttribute("role", "alert");
    expect(warning).toHaveTextContent("A multiplayer lobby may still be open");
    expect(warning).toHaveTextContent(formatCode(code));
    expect(warning).toHaveTextContent("Your current game is not connected to it.");
    expect(useSessionRuntime.getState().unattachedCleanupFailures).toEqual([{ code, message: expect.stringContaining(formatCode(code)) }]);

    // It survives further navigation (back to the review, Home again).
    fireEvent.click(screen.getByRole("button", { name: "Review finished game" }));
    expect(screen.getByRole("status")).toHaveTextContent("Finished game");
    expect(warningFor(code)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "← Home" }));
    expect(warningFor(code)).not.toBeNull();
  });
});

describe("ASTRA-10G-R1-001-B: Home -> New Game -> Create setup, then the old cleanup fails", () => {
  it("the old lobby never attaches to Game B, no old writer starts, and the new flow shows the old room code", async () => {
    const b = new CleanupBackend();
    render(<App />);
    const held = await goLiveHeldBeforeAdoption(b);
    const oldCode = held.code();
    fireEvent.click(screen.getByRole("button", { name: "← Home" }));
    fireEvent.click(screen.getByRole("button", { name: "New Game" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Create setup/ })); });
    const gameB = state().game!;
    expect(gameB.phase).toBe("setup");
    b.failLease = true;
    await act(async () => { held.release(); });
    await waitFor(() => expect(warningFor(oldCode)).not.toBeNull());

    expect(state().game).toBe(gameB);
    expect(state().game!.code).toBe("");
    expect(state().lobby).toBeNull();
    expect(useSessionRuntime.getState().backend).toBeNull();
    expect(b.writerEverActive(oldCode)).toBe(false);
    expect(warningFor(oldCode)).toHaveTextContent(formatCode(oldCode));

    // Still visible across the new flow: Home, then back to Game B's setup.
    fireEvent.click(screen.getByRole("button", { name: "← Home" }));
    expect(warningFor(oldCode)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Continue current game/ }));
    expect(warningFor(oldCode)).not.toBeNull();

    // A later valid Go Live for Game B starts a real session; the unresolved
    // warning for the OLD lobby is not erased by it.
    b.failLease = false;
    connect.mockResolvedValue({ backend: b, uid: UID });
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
    expect(state().lobby!.code).not.toBe(oldCode);
    expect(b.writerEverActive(state().lobby!.code)).toBe(true); // the helper detects a real writer
    expect(warningFor(oldCode)).not.toBeNull();
    expect(warnings()).toHaveLength(1);
  });
});

describe("ASTRA-10G-R1-001: controls", () => {
  it("a successful superseded cleanup creates no warning", async () => {
    const b = new CleanupBackend();
    render(<App />);
    const held = await goLiveHeldBeforeAdoption(b);
    const code = held.code();
    await finishGame();
    fireEvent.click(screen.getByRole("button", { name: "← Home" }));
    await act(async () => { held.release(); });
    await waitFor(async () => expect(await b.get(`lobbies/${code}/session`)).toMatchObject({ state: "ended" }));
    await settle();
    expect(warnings()).toHaveLength(0);
    expect(useSessionRuntime.getState().unattachedCleanupFailures).toEqual([]);
  });

  it("Dismiss removes only that warning and changes no game, lobby or session state", async () => {
    useSessionRuntime.setState({ unattachedCleanupFailures: [
      { code: "AAAA1111", message: "Multiplayer lobby AAAA-1111 may still be open." },
      { code: "BBBB2222", message: "Multiplayer lobby BBBB-2222 may still be open." },
    ] });
    render(<App />);
    expect(warnings()).toHaveLength(2);
    const before = { game: state().game, lobby: state().lobby, seq: state().localSeq, status: useSessionRuntime.getState().status };
    fireEvent.click(within(warningFor("AAAA1111")!).getByRole("button", { name: "Dismiss" }));
    expect(warningFor("AAAA1111")).toBeNull();
    expect(warningFor("BBBB2222")).not.toBeNull();
    expect(state().game).toBe(before.game);
    expect(state().lobby).toBe(before.lobby);
    expect(state().localSeq).toBe(before.seq);
    expect(useSessionRuntime.getState().status).toBe(before.status);
  });

  it("an ordinary current-game Go Live error stays on the game screen and creates no unattached-lobby warning", async () => {
    connect.mockRejectedValue(new Error("network down"));
    render(<App />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Go live" })); });
    await settle();
    expect(warnings()).toHaveLength(0);
    expect(useSessionRuntime.getState().unattachedCleanupFailures).toEqual([]);
    expect(state().lobby).toBeNull();
  });

  it("the warning is runtime-only: never persisted with the Storyteller state", async () => {
    useSessionRuntime.setState({ unattachedCleanupFailures: [{ code: "CCCC3333", message: "x" }] });
    act(() => { state().setView("home"); });
    expect(localStorage.getItem("new-blood-st")).not.toContain("CCCC3333");
    expect(localStorage.getItem("new-blood-st")).not.toContain("unattachedCleanupFailures");
  });
});
