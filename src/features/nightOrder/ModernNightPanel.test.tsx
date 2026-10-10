import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "./ModernNightPanel";
import { computeNightOrder } from "./nightOrder";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { clearNightActionCorrections } from "@/stores/nightActionCorrection";
import { participantStepKey, travelerArrivalStepKey } from "@/stores/nightProgress";
import { newTravelerArrival } from "@/stores/travelers";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { proofGame, proofScript } from "@/test/proofFixtures";

function Guide({ visible = true }: { visible?: boolean }) {
  const game = store(s => s.game)!;
  return <ModernNightPanel game={game} script={proofScript} visible={visible} onClose={() => {}} />;
}
const game = () => store.getState().game!;
const current = () => useShellStore.getState().nightCursor?.stepKey;
const key = (id: string) => participantStepKey(game().players[id]!.participantId!, game().players[id]!.shownRole!);
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
beforeEach(() => {
  vi.useFakeTimers();
  store.setState({ game: proofGame(["poisoner", "monk", "imp", "empath", "chef"]), lobby: null, undoStack: [], localSeq: 0,
    customScripts: { [proofScript.id]: proofScript } });
  useSessionRuntime.setState({ backend: null });
  useShellStore.getState().reset();
  usePrivacyStore.setState({ enabled: false });
  useTargetPicker.getState().cancel(); clearNightActionCorrections();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("Imp chooses a successor on the board before one atomic self-pass and retains Next", () => {
  store.setState({ game: proofGame(["imp", "poisoner", "baron", "chef", "monk"]) });
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p0") });
  render(<Guide />);
  const before = game();
  tap("p0");
  expect(game()).toBe(before);
  expect(store.getState().undoStack).toHaveLength(0);
  expect(useTargetPicker.getState().active?.label).toBe("Choose the new Imp");
  expect(screen.queryByRole("dialog")).toBeNull();
  tap("p3");
  expect(game()).toBe(before);
  tap("p2");
  expect(game().players.p0!.alive).toBe(false);
  expect(game().players.p2!.actualRole).toBe("imp");
  expect(store.getState().undoStack).toHaveLength(1);
  expect(game().nightProgress[`2:${key("p2")}`]?.status).toBe("skipped");
  expect(current()).toBe(key("p0"));
  expect(screen.getByRole("status")).toHaveTextContent("Resolved");
});

it("an uncertain Imp succession stays wholly manual without a workspace", () => {
  store.setState({ game: proofGame(["imp", "spy", "baron", "chef", "monk"]) });
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p0") });
  render(<Guide />);
  const before = game(); tap("p0");
  expect(game()).toBe(before);
  expect(useTargetPicker.getState().active).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "Continue action" })).toBeNull();
  expect(screen.getByText(/Each night\*, choose a player: they die/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
  expect(game().players).toEqual(before.players);
});

it("Next closes the final self-pass result without granting the successor another attack", () => {
  const next = proofGame(["imp", "scarletwoman", "chef", "soldier", "saint"]);
  const impKey = participantStepKey(next.players.p0!.participantId!, "imp");
  for (const step of computeNightOrder(next.players, next.seatOrder, proofScript, false, next)) {
    if (step.stepKey !== impKey) next.nightProgress[`2:${step.stepKey}`] = { status: "done", notes: "" };
  }
  store.setState({ game: next });
  useShellStore.getState().setNightCursor({ day: 2, stepKey: impKey });
  const close = vi.fn();
  function FinalGuide() {
    const live = store(state => state.game)!;
    return <ModernNightPanel game={live} script={proofScript} visible onClose={close} />;
  }
  render(<FinalGuide />); tap("p0");
  const committed = game();
  expect(committed.players.p0!.alive).toBe(false);
  expect(screen.getByRole("button", { name: "Next ›" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
  expect(close).toHaveBeenCalledOnce();
  expect(game()).toBe(committed);
  expect(game().nightProgress[`2:${key("p1")}`]?.status).toBe("skipped");
});

it("cancelling a pending successor leaves the Imp alive and invalidates the held choice", () => {
  store.setState({ game: proofGame(["imp", "poisoner", "baron", "chef", "monk"]) });
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p0") });
  render(<Guide />); tap("p0");
  const held = useTargetPicker.getState().active!;
  const before = game();
  fireEvent.click(screen.getByRole("button", { name: "Cancel selection" }));
  act(() => held.onPick({ playerId: "p2", participantId: before.players.p2!.participantId! }));
  expect(game()).toBe(before);
  expect(store.getState().undoStack).toHaveLength(0);
});

it("the existing roster fallback chooses only eligible successors in the same atomic self-pass", () => {
  store.setState({ game: proofGame(["imp", "poisoner", "baron", "chef", "monk"]) });
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p0") });
  render(<Guide />); const before = game(); tap("p0");
  expect(game()).toBe(before);
  fireEvent.click(screen.getByText("More options"));
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(".modern-night-roster button")];
  expect(buttons.map(button => button.textContent)).toEqual(["Player 1", "Player 2"]);
  fireEvent.click(screen.getByRole("button", { name: "Player 1" }));
  expect(game().players.p0!.alive).toBe(false);
  expect(game().players.p1!.actualRole).toBe("imp");
  expect(store.getState().undoStack).toHaveLength(1);
});

it.each(["monk"])("Drunk shown as %s uses official instructions and Next without a simulated action workspace", shownRole => {
  const next = proofGame(["drunk", "chef", "imp", "soldier", "poisoner"]);
  next.players.p0 = { ...next.players.p0!, shownRole, shownAlignment: "good", behaviorMode: "drunk_fake_role_behavior" };
  store.setState({ game: next });
  useShellStore.getState().setNightCursor({ day: next.day, stepKey: participantStepKey(next.players.p0.participantId!, shownRole) });
  render(<Guide />);
  expect(screen.getByRole("article", { name: new RegExp("Current action:") })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Continue action" })).not.toBeInTheDocument();
  expect(useTargetPicker.getState().active).toBeNull();
  const before = game();
  fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
  expect(game().informationDeliveries).toEqual(before.informationDeliveries);
  expect(game().players).toEqual(before.players);
  expect(game().nightProgress[`${next.day}:${participantStepKey(next.players.p0.participantId!, shownRole)}`]?.status).toBe("done");
});

it("resolves a direct board target once and waits for Next after commit", () => {
  render(<Guide />);
  expect(current()).toBe(key("p0"));
  expect(useShellStore.getState().litActor?.playerId).toBe("p0");
  expect(useTargetPicker.getState().active).not.toBeNull();
  tap("p4");
  expect(game().players.p4!.effects).toEqual([expect.objectContaining({ type: "poisoned" })]);
  expect(game().nightProgress[`2:${key("p0")}`]?.status).toBe("done");
  expect(store.getState().undoStack).toHaveLength(1);
  expect(current()).toBe(key("p0"));
  expect(screen.getByRole("status")).toHaveTextContent("Resolved");
  act(() => vi.advanceTimersByTime(2200));
  expect(current()).toBe(key("p0"));
  const committed = game();
  fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
  expect(game()).toBe(committed);
  expect(current()).toBe(key("p1"));
  expect(useShellStore.getState().litActor?.playerId).toBe("p1");
});

it("Previous does not change game state and a new target moves the resolved effect atomically", () => {
  render(<Guide />); tap("p4");
  fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
  const before = game();
  fireEvent.click(screen.getByRole("button", { name: "‹ Previous" }));
  expect(current()).toBe(key("p0")); expect(game()).toBe(before);
  tap("p3");
  expect(game().players.p4!.effects).toHaveLength(0);
  expect(game().players.p3!.effects).toEqual([expect.objectContaining({ type: "poisoned" })]);
  expect(store.getState().undoStack).toHaveLength(2);
});

it("a hidden panel suspends targeting and reopening continues the same step", () => {
  const view = render(<Guide />);
  const stalePick = useTargetPicker.getState().active!;
  const before = game();
  view.rerender(<Guide visible={false} />);
  expect(useTargetPicker.getState().active).toBeNull();
  act(() => stalePick.onPick({ playerId: "p4", participantId: game().players.p4!.participantId! }));
  expect(game()).toBe(before);
  view.rerender(<Guide />);
  expect(current()).toBe(key("p0"));
  expect(useTargetPicker.getState().active).not.toBeNull();
});

it("cancel leaves normal inspection available until targeting is resumed", () => {
  render(<Guide />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel selection" }));
  expect(useTargetPicker.getState().active).toBeNull();
  expect(pickSeatIfPicking(game(), "p4")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Choose on board" }));
  expect(useTargetPicker.getState().active).not.toBeNull();
});

it("invalid Monk self-target neither resolves nor advances", () => {
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p1") });
  render(<Guide />);
  const before = game(); tap("p1");
  expect(game()).toBe(before); expect(current()).toBe(key("p1"));
  expect(screen.getByRole("alert")).toHaveTextContent("can't be chosen");
  act(() => vi.advanceTimersByTime(5000));
  expect(current()).toBe(key("p1"));
});

it("a verified information action resolves through its action interaction without another confirmation", () => {
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p3") });
  render(<Guide />);
  expect(useTargetPicker.getState().active).toBeNull();
  const before = game();
  expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("1");
  fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "Continue action" })).toBeNull();
  expect(game()).not.toBe(before);
  expect(game().informationDeliveries).toHaveLength(1);
  expect(game().nightProgress[`2:${key("p3")}`]?.status).toBe("done");
  expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
});

it("manual navigation and privacy cancel delayed advancement and pending picks", () => {
  render(<Guide />); tap("p4");
  fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
  fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
  const chosen = current();
  act(() => vi.advanceTimersByTime(5000)); expect(current()).toBe(chosen);
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(useTargetPicker.getState().active).toBeNull();
  expect(useShellStore.getState().litActor).toBeNull();
  expect(screen.queryByLabelText("Night 2 guide")).toBeNull();
});

it("later resolved work prevents an unsafe retarget while Previous remains usable", () => {
  render(<Guide />); tap("p4"); fireEvent.click(screen.getByRole("button", { name: "Next ›" })); tap("p3");
  fireEvent.click(screen.getByRole("button", { name: "‹ Previous" }));
  expect(current()).toBe(key("p0"));
  expect(useTargetPicker.getState().active).toBeNull();
  expect(screen.getByText(/game changed after this action|cannot be safely retargeted/i)).toBeInTheDocument();
});

it("Undo during the result restores targeting without an old delayed advance", () => {
  render(<Guide />); tap("p4");
  act(() => store.getState().undo());
  expect(game().players.p4!.effects).toHaveLength(0);
  expect(useTargetPicker.getState().active).not.toBeNull();
  act(() => vi.advanceTimersByTime(5000));
  expect(current()).toBe(key("p0"));
  tap("p3");
  expect(game().players.p3!.effects).toEqual([expect.objectContaining({ type: "poisoned" })]);
});

it("the roster fallback resolves through the same command and eligibility as board targeting", () => {
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p1") });
  render(<Guide />);
  const details = screen.getByText("Choose from roster").closest("details")!;
  fireEvent.click(screen.getByText("More options"));
  expect(details.querySelectorAll(".modern-night-roster button")).toHaveLength(4);
  expect([...details.querySelectorAll(".modern-night-roster button")].some(button => button.textContent === "Player 1")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Player 4" }));
  expect(game().players.p4!.effects).toEqual([expect.objectContaining({ type: "safeFromDemon" })]);
  expect(store.getState().undoStack).toHaveLength(1);
});

it.each(["privacy", "unmount"])("a captured target callback cannot commit after %s", mode => {
  const view = render(<Guide />);
  const stalePick = useTargetPicker.getState().active!;
  const before = game();
  const undo = store.getState().undoStack;
  if (mode === "privacy") act(() => usePrivacyStore.getState().setEnabled(true));
  else view.unmount();
  act(() => stalePick.onPick({ playerId: "p4", participantId: before.players.p4!.participantId! }));
  expect(game()).toBe(before);
  expect(store.getState().undoStack).toBe(undo);
  expect(useTargetPicker.getState().active).toBeNull();
});

it("Bureaucrat board selection records its official token and completes the Night step in one action", () => {
  store.setState({ game: proofGame(["bureaucrat", "monk", "imp", "empath", "chef"]) });
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p0") });
  render(<Guide />);
  expect(screen.getByLabelText("Bureaucrat voting ability")).toBeVisible();
  expect(useTargetPicker.getState().active?.eligible?.has(game().players.p0!.participantId!)).toBe(false);
  tap("p4");
  expect(game().voting?.modifiers[0]).toMatchObject({ source: { playerId: "p0" }, target: { playerId: "p4" }, appliesDay: 2 });
  expect(game().players.p4!.reminders).toEqual([expect.objectContaining({ label: "3 Votes", sourceCharacter: "bureaucrat" })]);
  expect(game().nightProgress?.[`2:${key("p0")}`]?.status).toBe("done");
  expect(store.getState().undoStack).toHaveLength(1);
  act(() => store.getState().undo());
  expect(game().voting).toBeUndefined(); expect(game().nightProgress?.[`2:${key("p0")}`]).toBeUndefined();
  expect(useTargetPicker.getState().active).not.toBeNull();
});

it("a later Bureaucrat arrival uses its participant-bound action and leaves other arrivals pending", () => {
  const arrived = proofGame(["bureaucrat", "monk", "imp", "empath", "bureaucrat"]);
  arrived.day = 3;
  for (const id of ["p0", "p4"]) Object.assign(arrived.players[id]!, { isTraveler: true, travelerArrival: newTravelerArrival() });
  store.setState({ game: arrived });
  const arrivalKey = travelerArrivalStepKey(arrived.players.p0!.participantId!, "bureaucrat");
  const otherKey = travelerArrivalStepKey(arrived.players.p4!.participantId!, "bureaucrat");
  useShellStore.getState().setNightCursor({ day: 3, stepKey: arrivalKey });
  render(<Guide />);
  expect(screen.getByLabelText("Bureaucrat voting ability")).toBeVisible();
  expect(useShellStore.getState().litActor?.participantId).toBe(arrived.players.p0!.participantId);
  expect(useTargetPicker.getState().active?.eligible?.has(arrived.players.p0!.participantId!)).toBe(false);
  tap("p3");
  expect(game().voting?.modifiers[0]).toMatchObject({ source: { playerId: "p0" }, target: { playerId: "p3" }, appliesDay: 3 });
  expect(game().players.p3!.reminders).toEqual([expect.objectContaining({ label: "3 Votes", sourceCharacter: "bureaucrat" })]);
  expect(game().nightProgress?.[`3:${arrivalKey}`]?.status).toBe("done");
  expect(game().players.p0!.travelerArrival).toMatchObject({ firstNightComplete: true, completedAtNight: 3 });
  expect(game().players.p4!.travelerArrival?.firstNightComplete).toBe(false);
  expect(game().nightProgress?.[`3:${otherKey}`]).toBeUndefined();
  expect(store.getState().undoStack).toHaveLength(1);
  act(() => store.getState().undo());
  expect(game().voting).toBeUndefined();
  expect(game().players.p0!.travelerArrival?.firstNightComplete).toBe(false);
  expect(game().players.p3!.reminders).toEqual([]);
  expect(useTargetPicker.getState().active).not.toBeNull();
});

it("Vortox and Empath remain wholly manual: official text and Next complete only the step with Undo", () => {
  store.setState({ game: proofGame(["empath", "vortox", "chef"]) });
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p0") });
  render(<Guide />); const before = game();
  expect(useTargetPicker.getState().active).toBeNull();
  expect(screen.queryByRole("button", { name: "Continue action" })).toBeNull();
  expect(screen.getByText(proofScript.characters.find(role => role.id === "empath")!.ability!)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
  expect(game().nightProgress[`2:${key("p0")}`]?.status).toBe("done");
  expect(game().players).toEqual(before.players); expect(game().informationDeliveries).toEqual([]);
  expect(store.getState().undoStack).toHaveLength(1);
  act(() => store.getState().undo()); expect(game().nightProgress).toEqual(before.nightProgress);
});

it("an unsupported selected interaction becomes manual with no partial effects", () => {
  render(<Guide />); const before = game(); tap("p0");
  expect(game()).toBe(before); expect(useTargetPicker.getState().active).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => { store.getState().resolveReminders({ intents: [{ kind: "place", target: { playerId: "p0", participantId: game().players.p0!.participantId! },
    reminder: { label: "Chosen" } }] }); });
  expect(useTargetPicker.getState().active).toBeNull();
  const manuallyAdjusted = game();
  fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
  expect(game().players).toEqual(manuallyAdjusted.players);
  expect(game().nightProgress[`2:${key("p0")}`]?.status).toBe("done");
});
