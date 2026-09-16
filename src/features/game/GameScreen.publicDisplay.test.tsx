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
});
