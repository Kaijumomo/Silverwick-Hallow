// Phase 9C.6 (OPUS-002): the Storyteller-side Public Display link controls
// in GameScreen. The security-specific ensure/rotate operations themselves
// are proven in publicDisplayAuth.test.ts (unit) and rules.spec.ts/
// contract.spec.ts (real rules/real writer); this file isolates GameScreen's
// own contract — when it calls them, what it builds from the result, and
// what it never renders or does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useStorytellerStore as storyteller } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";

vi.mock("@/firebase/publicDisplayAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/publicDisplayAuth")>();
  return { ...actual, ensurePublicDisplayAccess: vi.fn(), rotatePublicDisplayAccess: vi.fn() };
});

import { ensurePublicDisplayAccess, rotatePublicDisplayAccess } from "@/firebase/publicDisplayAuth";
import { GameScreen } from "./GameScreen";

const TOKEN_A = "a".repeat(43);
const TOKEN_B = "b".repeat(43);
const lobby = { code: "ABCD2345", uid: "host", sessionId: "test-session", status: "live" as const };

function openDisplayButton() {
  return screen.getByRole("button", { name: "Public display ↗" });
}
function copyDisplayButton() {
  return screen.getByRole("button", { name: "Copy display link" });
}
function resetDisplayButton() {
  return screen.getByRole("button", { name: "Reset display link" });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  usePrivacyStore.setState({ enabled: false });
  storyteller.setState({ game: null, lobby: null, undoStack: [] });
  storyteller.getState().newGame("tb");
  storyteller.getState().addPlayer("Alice");
  useSessionRuntime.setState({ backend: null });
  vi.mocked(ensurePublicDisplayAccess).mockReset();
  vi.mocked(rotatePublicDisplayAccess).mockReset();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  storyteller.setState({ game: null, lobby: null, undoStack: [] });
  useSessionRuntime.setState({ backend: null });
});

describe("GameScreen Public Display link controls (Phase 9C.6, OPUS-002)", () => {
  it("does not attempt to ensure a capability while there is no lobby", () => {
    render(<GameScreen />);
    expect(ensurePublicDisplayAccess).not.toHaveBeenCalled();
  });

  it("does not attempt to ensure a capability while the runtime backend is missing", () => {
    storyteller.setState({ lobby });
    render(<GameScreen />);
    expect(ensurePublicDisplayAccess).not.toHaveBeenCalled();
  });

  it("ensures the capability once lobby, sessionId, and the live runtime backend are all present, then opens/copies a link with the token ONLY in the fragment", async () => {
    vi.mocked(ensurePublicDisplayAccess).mockResolvedValue(TOKEN_A);
    storyteller.setState({ lobby });
    const fakeBackend = {} as never;
    useSessionRuntime.setState({ backend: fakeBackend });

    render(<GameScreen />);
    await act(async () => {});

    expect(ensurePublicDisplayAccess).toHaveBeenCalledWith(fakeBackend, lobby.code, lobby.sessionId);
    await waitFor(() => expect(openDisplayButton()).not.toBeDisabled());

    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    fireEvent.click(openDisplayButton());
    expect(openSpy).toHaveBeenCalledTimes(1);
    const [openedUrl, target, features] = openSpy.mock.calls[0]!;
    const url = new URL(String(openedUrl));
    expect(url.search).toBe(`?display=public&code=${lobby.code}`);
    expect(url.search).not.toContain(TOKEN_A);
    expect(url.hash).toBe(`#displayToken=${TOKEN_A}`);
    expect(target).toBe("_blank");
    expect(features).toBe("noopener");

    fireEvent.click(copyDisplayButton());
    await act(async () => {});
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0];
    expect(copied).toContain(`#displayToken=${TOKEN_A}`);
    expect(copied).toContain(`code=${lobby.code}`);
  });

  it("never renders the capability token anywhere in the document", async () => {
    vi.mocked(ensurePublicDisplayAccess).mockResolvedValue(TOKEN_A);
    storyteller.setState({ lobby });
    useSessionRuntime.setState({ backend: {} as never });

    render(<GameScreen />);
    await act(async () => {});
    await waitFor(() => expect(openDisplayButton()).not.toBeDisabled());

    expect(document.body.textContent).not.toContain(TOKEN_A);
    expect(document.body.innerHTML).not.toContain(TOKEN_A);
  });

  it("reset rotates the capability: subsequent open/copy use the NEW token, not the old one", async () => {
    vi.mocked(ensurePublicDisplayAccess).mockResolvedValue(TOKEN_A);
    vi.mocked(rotatePublicDisplayAccess).mockResolvedValue(TOKEN_B);
    storyteller.setState({ lobby });
    const fakeBackend = {} as never;
    useSessionRuntime.setState({ backend: fakeBackend });

    render(<GameScreen />);
    await act(async () => {});
    await waitFor(() => expect(openDisplayButton()).not.toBeDisabled());

    fireEvent.click(resetDisplayButton());
    await waitFor(() => expect(rotatePublicDisplayAccess).toHaveBeenCalledWith(fakeBackend, lobby.code, lobby.sessionId));

    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await waitFor(() => {
      fireEvent.click(openDisplayButton());
      const [openedUrl] = openSpy.mock.calls.at(-1)!;
      expect(String(openedUrl)).toContain(`#displayToken=${TOKEN_B}`);
    });
    expect(openSpy.mock.calls.every(([u]) => !String(u).includes(TOKEN_A))).toBe(true);
  });

  it("disables Public display / Copy display link / Reset display link while the runtime writer is unavailable, and performs no operation", async () => {
    storyteller.setState({ lobby });
    useSessionRuntime.setState({ backend: null });

    render(<GameScreen />);

    expect(openDisplayButton()).toBeDisabled();
    expect(copyDisplayButton()).toBeDisabled();
    expect(resetDisplayButton()).toBeDisabled();
    expect(ensurePublicDisplayAccess).not.toHaveBeenCalled();

    fireEvent.click(resetDisplayButton());
    expect(rotatePublicDisplayAccess).not.toHaveBeenCalled();
  });

  it("clears the token and re-disables controls when the runtime backend becomes unavailable again (e.g. mid-reconnect)", async () => {
    vi.mocked(ensurePublicDisplayAccess).mockResolvedValue(TOKEN_A);
    storyteller.setState({ lobby });
    useSessionRuntime.setState({ backend: {} as never });

    render(<GameScreen />);
    await act(async () => {});
    await waitFor(() => expect(openDisplayButton()).not.toBeDisabled());

    act(() => { useSessionRuntime.setState({ backend: null }); });

    await waitFor(() => expect(openDisplayButton()).toBeDisabled());
    expect(copyDisplayButton()).toBeDisabled();
  });

  // Luna revision (Defect 2): the OLD implementation derived `displayLink`
  // from `lobby && displayToken` alone — `displayToken` was only cleared by
  // a PASSIVE effect keyed on `backend`, so the render that first reflects
  // `backend === null` still computed a usable link, and controls stayed
  // enabled until that effect later ran. Empirically (verified against both
  // this fix and the prior implementation), the render reacting to the
  // external store update resolves within microtask timing, while the
  // passive effect that used to be the ONLY thing clearing the token does
  // not resolve until a macrotask boundary — so checking after a couple of
  // microtask ticks (deliberately BEFORE any `act()`/macrotask flush) is
  // exactly the window that distinguishes "derived from the live backend at
  // render time" from "eventually cleared by a passive effect": the prior
  // implementation was still enabled here, the fixed one is not.
  it("disables Open/Copy/Reset at the very next render when the runtime backend is lost — not only once a later passive effect clears the token", async () => {
    vi.mocked(ensurePublicDisplayAccess).mockResolvedValue(TOKEN_A);
    storyteller.setState({ lobby });
    useSessionRuntime.setState({ backend: {} as never });

    render(<GameScreen />);
    await act(async () => {});
    await waitFor(() => expect(openDisplayButton()).not.toBeDisabled());
    expect(copyDisplayButton()).not.toBeDisabled();

    // Deliberately NOT wrapped in act(): this lets the render that reacts to
    // the store update commit on its own natural schedule, rather than
    // forcing every consequence (including the later passive effect) to
    // flush together before this line returns control to the test.
    useSessionRuntime.setState({ backend: null });
    // Yield a couple of microtask turns only — short of the macrotask
    // boundary the old passive-effect-only cleanup needed.
    await Promise.resolve();
    await Promise.resolve();

    expect(openDisplayButton()).toBeDisabled();
    expect(copyDisplayButton()).toBeDisabled();
    expect(resetDisplayButton()).toBeDisabled();

    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    fireEvent.click(openDisplayButton());
    fireEvent.click(copyDisplayButton());
    fireEvent.click(resetDisplayButton());
    expect(openSpy).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(rotatePublicDisplayAccess).not.toHaveBeenCalled();

    // Let the (still-pending) passive effect settle before the test ends, so
    // no state update leaks into a later test as an act() warning.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  });

  it("surfaces an ensure failure without crashing, and lets the Storyteller dismiss it", async () => {
    vi.mocked(ensurePublicDisplayAccess).mockRejectedValue(new Error("permission_denied"));
    storyteller.setState({ lobby });
    useSessionRuntime.setState({ backend: {} as never });

    render(<GameScreen />);
    await act(async () => {});

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(openDisplayButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Luna revision (Defect 1): the OLD implementation's successful branch only
  // called `setDisplayToken(token)`, never clearing a `displayLinkError` left
  // over from an earlier failed attempt — so a genuinely recovered capability
  // still showed an obsolete/false error. This proves actual recovery (a
  // second, real ensure attempt succeeding after reconnect), not merely
  // dismissal via the manual "dismiss" button proven above.
  it("a successful ensure after an earlier failure clears the stale error and makes controls usable with the recovered token", async () => {
    vi.mocked(ensurePublicDisplayAccess).mockRejectedValueOnce(new Error("permission_denied"));
    storyteller.setState({ lobby });
    const backendA = { id: "A" } as never;
    useSessionRuntime.setState({ backend: backendA });

    render(<GameScreen />);
    await act(async () => {});

    // 1-4: the first ensure attempt failed — a stale error is visible and
    // the controls are disabled.
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(openDisplayButton()).toBeDisabled();
    expect(copyDisplayButton()).toBeDisabled();

    // 5: the runtime enters an unavailable/reconnect state.
    act(() => { useSessionRuntime.setState({ backend: null }); });
    await act(async () => {});
    expect(openDisplayButton()).toBeDisabled();

    // 6-7: a genuinely new live backend becomes available, and this second,
    // real ensure attempt succeeds with a valid token.
    vi.mocked(ensurePublicDisplayAccess).mockResolvedValueOnce(TOKEN_A);
    const backendB = { id: "B" } as never;
    act(() => { useSessionRuntime.setState({ backend: backendB }); });
    await act(async () => {});

    await waitFor(() => expect(openDisplayButton()).not.toBeDisabled());
    // The stale alert must be gone because recovery genuinely cleared it —
    // not because it was manually dismissed (no dismiss click happened here).
    expect(screen.queryByRole("alert")).toBeNull();
    expect(copyDisplayButton()).not.toBeDisabled();

    // Open/Copy use the recovered token, not stale state from the failure.
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    fireEvent.click(openDisplayButton());
    expect(String(openSpy.mock.calls.at(-1)![0])).toContain(`#displayToken=${TOKEN_A}`);

    fireEvent.click(copyDisplayButton());
    await act(async () => {});
    expect(String(vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)![0])).toContain(`#displayToken=${TOKEN_A}`);
  });
});
