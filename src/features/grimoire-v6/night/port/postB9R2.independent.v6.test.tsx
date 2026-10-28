import { useV6Ui } from "../../v6Store";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ModernNightPanel } from "./testGuide";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { proofGame, proofScript } from "@/test/proofFixtures";
import type { SessionWriter } from "@/firebase/writer";
import { participantStepKey } from "@/stores/nightProgress";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { useInfoShow } from "../../info/showStore";

// Independent boundary checks for the R2 Setup Info replacement.
const game = () => store.getState().game!;
function Guide({ visible = true }: { visible?: boolean }) {
  const g = store(state => state.game)!;
  return <ModernNightPanel game={g} script={proofScript} visible={visible} onClose={() => {}} />;
}
beforeEach(() => {
  localStorage.clear(); usePrivacyStore.getState().reset(); useShellStore.getState().reset();
  useTargetPicker.getState().cancel(); useV6Ui.getState().reset(); useInfoShow.getState().clear();
  useSessionRuntime.setState({ backend: null, status: "failed" });
  const g = proofGame(["imp", "poisoner", "chef", "empath", "soldier", "virgin", "slayer"], "night", 1);
  g.players.p0!.privateInfo = { bluffs: ["monk", "saint", "ravenkeeper"] };
  store.setState({ game: g, lobby: null, terminalClose: null, undoStack: [], localSeq: 0,
    customScripts: { [proofScript.id]: proofScript } });
  useShellStore.getState().setNightCursor({ day: 1, stepKey: "minionInfo" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("independent R2: failed intro completion save preserves game, cursor, and durable state", () => {
  render(<Guide />);
  const g = game(), cursor = useShellStore.getState().nightCursor, saved = localStorage.getItem("new-blood-st");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(game()).toBe(g); expect(useShellStore.getState().nightCursor).toEqual(cursor);
  expect(store.getState().undoStack).toEqual([]); expect(localStorage.getItem("new-blood-st")).toBe(saved);
  expect(screen.getByRole("alert")).toBeInTheDocument();
});

it("independent R2: hidden intro control cannot open player information", () => {
  const view = render(<Guide />), g = game();
  const held = screen.getByRole("button", { name: "Show Minion Information" });
  view.rerender(<Guide visible={false} />);
  fireEvent.click(held);
  expect(screen.queryByRole("dialog")).toBeNull(); expect(game()).toBe(g);
});

it("independent R2: local intro works with failed hosted runtime and Next advances exactly one step", () => {
  render(<Guide />); const g = game();
  fireEvent.click(screen.getByRole("button", { name: "Show Minion Information" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Player 0")).toBeInTheDocument();
  expect(game()).toBe(g); expect(game().informationDeliveries).toEqual([]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Return to Grimoire" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(useShellStore.getState().nightCursor).toEqual({ day: 1, stepKey: "demonInfo" });
  expect(game().nightProgress["1:minionInfo"]).toMatchObject({ status: "done" });
  expect(game().nightProgress["1:demonInfo"]).toBeUndefined();
  expect(store.getState().undoStack).toHaveLength(1); expect(game().informationDeliveries).toEqual([]);
});

it("independent R2: an open intro masks team names when its online writer changes", () => {
  const writer = { leaseMayHaveLapsed: () => false } as unknown as SessionWriter;
  const replacement = { leaseMayHaveLapsed: () => false } as unknown as SessionWriter;
  store.setState({ lobby: { code: "TEST2345", uid: "host", sessionId: "session", status: "live" },
    game: { ...game(), code: "TEST2345", storytellerUid: "host" } });
  useSessionRuntime.setState({ backend: writer, status: "live" });
  render(<Guide />); const g = game();
  fireEvent.click(screen.getByRole("button", { name: "Show Minion Information" }));
  expect(within(screen.getByRole("dialog")).getByText("Player 0")).toBeInTheDocument();
  act(() => useSessionRuntime.setState({ backend: replacement }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).queryByText("Player 0")).toBeNull();
  expect(dialog).toHaveAccessibleName("Information changed");
  expect(game()).toBe(g); expect(store.getState().undoStack).toEqual([]);
});

it.each(["Enter", " "])("independent R2: %s targets on the actual board without a secondary roster", key => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const g = game();
  const stepKey = participantStepKey(g.players.p1!.participantId!, "poisoner");
  useShellStore.getState().setNightCursor({ day: 1, stepKey });
  const view = render(<Guide />);
  expect(screen.queryByText("More options")).toBeNull();
  expect(useTargetPicker.getState().active).not.toBeNull();
  fireEvent.click(screen.getByTitle("Close night order"));
  expect(useTargetPicker.getState().active).toBeNull(); expect(game()).toBe(g);
  act(() => useV6Ui.getState().set({ panel: "night" }));
  const target = view.container.querySelector<HTMLElement>('[role="button"][title="' + game().players.p2!.name + '"]')!;
  expect(target).toHaveAttribute("tabindex", "0");
  target.focus(); fireEvent.keyDown(target, { key });
  expect(game().players.p2!.effects.some(effect => effect.type === "poisoned" && effect.state === "active")).toBe(true);
  expect(store.getState().undoStack).toHaveLength(1);
  expect(useShellStore.getState().nightCursor).toEqual({ day: 1, stepKey });
});
