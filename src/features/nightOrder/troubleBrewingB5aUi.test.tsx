import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "./ModernNightPanel";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { impair, proofGame, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { withRedHerring } from "@/test/redHerringFixture";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
function open(g: StorytellerLobbyRecord) {
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: participantStepKey(g.players.p0!.participantId!, g.players.p0!.shownRole!) });
  return render(<Guide />);
}
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
beforeEach(() => { vi.useFakeTimers(); useSessionRuntime.setState({ backend: null }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each(["chef", "empath"])("%s previews truth without recording until deliberate Next", role => {
  open(proofGame([role, "imp", "poisoner", "soldier", "saint"], "night", 1));
  const before = game();
  expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("1");
  expect(before.informationDeliveries).toHaveLength(0);
  expect(screen.queryByRole("button", { name: "Continue action" })).toBeNull();
  next();
  expect(game().informationDeliveries).toHaveLength(1);
  expect(store.getState().undoStack).toHaveLength(1);
  expect(game().players).toEqual(before.players);
});
it.each(["chef", "empath"])("impaired %s chooses a number and retains it until Next", role => {
  open(impair(proofGame([role, "imp", "poisoner", "soldier", "saint"], "night", 1), "p0"));
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "0" }));
  expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("0");
  const accepted = game(); const cursor = useShellStore.getState().nightCursor;
  act(() => vi.advanceTimersByTime(5000));
  expect(useShellStore.getState().nightCursor).toEqual(cursor);
  next(); expect(game()).toBe(accepted);
  expect(accepted.informationDeliveries).toHaveLength(1);
});
it.each(["chef", "empath", "fortuneteller"])("Drunk shown %s gets deliberate information choices, with no genuine ability", role => {
  const g = proofGame(["drunk", "imp", "poisoner", "soldier", "saint"], "night", 1);
  g.players.p0 = { ...g.players.p0!, shownRole: role, behaviorMode: "drunk_fake_role_behavior" };
  open(g);
  if (role === "fortuneteller") { tap("p1"); expect(game()).toBe(g); tap("p2"); }
  fireEvent.click(screen.getByRole("button", { name: role === "fortuneteller" ? "YES" : "2" }));
  expect(game().informationDeliveries[0]).toMatchObject({ actualRole: "drunk", performedRole: role });
  expect(game().players).toEqual(g.players);
});
it("unanswered information followed by Next records completion only", () => {
  open(impair(proofGame(["empath", "imp", "chef", "soldier", "saint"]), "p0"));
  next(); expect(game().informationDeliveries).toHaveLength(0);
  expect(Object.values(game().nightProgress).some(step => step.status === "done")).toBe(true);
});
it("Fortune Teller selects two distinct board targets, commits once and displays the verified answer", () => {
  const g = withRedHerring(proofGame(["fortuneteller", "imp", "poisoner", "soldier", "saint"]), "p3");
  open(g); tap("p2"); expect(game()).toBe(g); tap("p3");
  expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("YES");
  expect(game().informationDeliveries).toHaveLength(1);
  const accepted = game(); next(); expect(game()).toBe(accepted);
});
it("poisoned Fortune Teller can deliberately communicate the truthful NO", () => {
  const g = impair(withRedHerring(proofGame(["fortuneteller", "imp", "poisoner", "soldier", "saint"]), "p3"), "p0");
  open(g); tap("p0"); tap("p4"); expect(game()).toBe(g);
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "NO" }));
  expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("NO");
  expect(game().players).toEqual(g.players);
});
it("a cancelled target callback and changed game cannot reuse a pending Fortune Teller pair", () => {
  const g = withRedHerring(proofGame(["fortuneteller", "imp", "poisoner", "soldier", "saint"]), "p3");
  open(g); const held = useTargetPicker.getState().active!;
  fireEvent.click(screen.getByRole("button", { name: "Cancel selection" }));
  act(() => held.onPick({ playerId: "p1", participantId: g.players.p1!.participantId! }));
  expect(screen.queryByText(/Selected:/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Choose on board" }));
  tap("p1"); act(() => store.setState({ game: { ...game(), notes: "Changed" } }));
  expect(screen.queryByText(/Selected:/)).toBeNull();
  expect(game().informationDeliveries).toHaveLength(0);
});
it("consequential registration stays manual with no misleading number or picker", () => {
  open(proofGame(["empath", "spy", "chef", "soldier", "saint"]));
  expect(screen.queryByLabelText("Information to communicate")).toBeNull();
  next(); expect(game().informationDeliveries).toHaveLength(0);
});
it("privacy unmounts all information and invalidates a captured target callback", () => {
  const g = proofGame(["drunk", "imp", "poisoner", "soldier", "saint"]);
  g.players.p0 = { ...g.players.p0!, shownRole: "fortuneteller", behaviorMode: "drunk_fake_role_behavior" };
  open(g); const held = useTargetPicker.getState().active!;
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(screen.queryByLabelText("Night 2 guide")).toBeNull();
  act(() => held.onPick({ playerId: "p1", participantId: g.players.p1!.participantId! }));
  expect(game()).toBe(g); expect(useTargetPicker.getState().active).toBeNull();
});
it("Undo clears the selected result and reopens the picker without replaying information", () => {
  open(impair(proofGame(["empath", "imp", "chef", "soldier", "saint"]), "p0"));
  fireEvent.click(screen.getByRole("button", { name: "2" }));
  act(() => store.getState().undo());
  expect(game().informationDeliveries).toHaveLength(0);
  expect(screen.getByRole("button", { name: "2" })).toBeInTheDocument();
});
it("reloaded completion shows only the recorded number and Next never redelivers", () => {
  const mounted = open(impair(proofGame(["empath", "imp", "chef", "soldier", "saint"]), "p0"));
  fireEvent.click(screen.getByRole("button", { name: "2" }));
  const accepted = JSON.parse(JSON.stringify(game())) as StorytellerLobbyRecord;
  mounted.unmount(); open(accepted);
  expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("2");
  next(); expect(game()).toBe(accepted);
});

