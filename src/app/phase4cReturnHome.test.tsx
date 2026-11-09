// Package 4 Gate 2: Return Home from a finished game keeps the game stored and reviewable, offline, through the real App shell.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "./App";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useV6Ui } from "@/features/grimoire-v6/v6Store";

vi.mock("@/firebase/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/config")>();
  return { ...actual, isFirebaseConfigured: () => false };
});

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} })));
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: null, lobby: null, view: "home", undoStack: [], localSeq: 0, sync: null, selectedPlayerId: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Return Home after a finished game", () => {
  it("keeps the game stored with its result, survives a reload, and Review still opens it read-only", async () => {
    store.getState().newGame("tb", { plannedPlayerCount: 5, keepView: true });
    const g = store.getState().game!;
    store.setState({ view: "game", game: { ...g, phase: "ended", day: 2, result: { winner: "good", declaredAt: { phase: "day", day: 2 } } } });
    useV6Ui.getState().set({ winScene: true });
    render(<App />);

    const scene = screen.getByRole("dialog", { name: "Good Wins" });
    expect(within(scene).getByRole("button", { name: "Review the Grimoire" })).toBeTruthy();
    fireEvent.click(within(scene).getByRole("button", { name: "Return Home" }));
    expect(store.getState().view).toBe("home");
    expect(screen.getByText(/A Blood on the Clocktower companion/)).toBeInTheDocument();

    // Stored: the persisted save holds the ended game and its result.
    const saved = Object.values(localStorage).join("");
    expect(saved).toContain('"phase":"ended"');
    expect(saved).toContain('"winner":"good"');

    // A reload: drop the in-memory game, rehydrate from storage.
    const snapshot = Object.entries(localStorage);
    store.setState({ game: null }); // persisting the null overwrites storage, so restore the saved bytes
    for (const [k, v] of snapshot) localStorage.setItem(k, v as string);
    await act(async () => { await store.persist.rehydrate(); });
    expect(store.getState().game?.phase).toBe("ended");
    expect(store.getState().game?.result?.winner).toBe("good");

    act(() => { store.setState({ view: "home" }); });

    // Home offers Review for the finished game, and it opens read-only.
    fireEvent.click(screen.getByText("Review finished game"));
    expect(store.getState().view).toBe("game");
    expect(store.getState().game?.phase).toBe("ended");
    expect(screen.getByRole("status")).toHaveTextContent(/Finished game, read-only review/);
  });
});
