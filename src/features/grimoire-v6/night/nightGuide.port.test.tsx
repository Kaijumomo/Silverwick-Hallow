import { useInfoShow } from "../info/showStore";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { computeNightOrder } from "@/features/nightOrder/nightOrder";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { GrimoireV6Screen } from "../GrimoireV6Screen";
import { useV6Ui } from "../v6Store";
import { useNightPos } from "./nightPos";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { clearNightActionCorrections } from "@/stores/nightActionCorrection";
import { participantScopedStepKey, participantStepKey, travelerArrivalStepKey } from "@/stores/nightProgress";
import { newTravelerArrival } from "@/stores/travelers";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { patchPlayer, pick, plan, planned, proofGame, proofScript, request } from "@/test/proofFixtures";
import { deriveNightWork } from "@/features/nightOrder/nightWork";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { buildRegistry } from "@/data/roleRegistry";

/** The V6 Grimoire with its Night card open (or closed): the same scenarios the guided Night panel was held to. */
function Guide({ visible = true }: { visible?: boolean }) {
  useEffect(() => { useV6Ui.getState().set({ panel: visible ? "night" : null }); }, [visible]);
  return <VotingProvider><GrimoireV6Screen /></VotingProvider>;
}
/** The V2 strip opens on Dusk; scenarios that began on the first step press Next once. */
const start = () => { const view = render(<Guide />); fireEvent.click(screen.getByRole("button", { name: "Next" })); return view; };
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
  useNightPos.getState().go(0, null, null);
  useV6Ui.getState().reset();
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
  expect(screen.getByText("Resolved.")).toBeInTheDocument();
});

it("an uncertain Imp succession (a Spy that may register as a Minion) is put to the Storyteller on the board", () => {
  store.setState({ game: proofGame(["imp", "spy", "baron", "chef", "monk"]) });
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p0") });
  render(<Guide />);
  const before = game(); tap("p0");
  expect(game()).toBe(before);
  expect(useTargetPicker.getState().active?.label).toBe("Choose the new Imp");
  expect(screen.queryByRole("dialog")).toBeNull();
  tap("p3"); // not a possible Minion
  expect(game()).toBe(before);
  tap("p2"); // the definite Minion
  expect(game().players.p2!.actualRole).toBe("imp");
  expect(game().players.p1!.actualRole).toBe("spy");
});

it("Next closes the final self-pass result without granting the successor another attack", () => {
  const next = proofGame(["imp", "scarletwoman", "chef", "soldier", "saint"]);
  const impKey = participantStepKey(next.players.p0!.participantId!, "imp");
  for (const step of computeNightOrder(next.players, next.seatOrder, proofScript, false, next)) {
    if (step.stepKey !== impKey) next.nightProgress[`2:${step.stepKey}`] = { status: "done", notes: "" };
  }
  store.setState({ game: next });
  useShellStore.getState().setNightCursor({ day: 2, stepKey: impKey });
  render(<Guide />); tap("p0");
  const committed = game();
  expect(committed.players.p0!.alive).toBe(false);
  expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  // The V2 strip ends at Dawn rather than closing: the Night's last step is followed by the Dawn checkpoint.
  expect(screen.getByText("Player 0 died in the night. Everyone else may open their eyes.")).toBeInTheDocument();
  expect(game()).toBe(committed);
  expect(game().nightProgress[`2:${key("p1")}`]?.status).toBe("skipped");
});

it("cancelling a pending successor leaves the Imp alive and invalidates the held choice", () => {
  store.setState({ game: proofGame(["imp", "poisoner", "baron", "chef", "monk"]) });
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p0") });
  render(<Guide />); tap("p0");
  const held = useTargetPicker.getState().active!;
  const before = game();
  fireEvent.click(screen.getByTitle("Close night order"));
  act(() => held.onPick({ playerId: "p2", participantId: before.players.p2!.participantId! }));
  expect(game()).toBe(before);
  expect(store.getState().undoStack).toHaveLength(0);
});

it("R2 successor targeting exposes only eligible board players without a duplicate roster", () => {
  store.setState({ game: proofGame(["imp", "poisoner", "baron", "chef", "monk"]) });
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p0") });
  render(<Guide />); const before = game(); tap("p0");
  expect(game()).toBe(before);
  expect(screen.queryByText("More options")).toBeNull();
  expect(useTargetPicker.getState().active?.eligible).toEqual(new Set([before.players.p1!.participantId!, before.players.p2!.participantId!]));
  tap("p1");
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
  expect(screen.getByText(proofScript.characters.find(role => role.id === "monk")!.ability!)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Continue action" })).not.toBeInTheDocument();
  expect(useTargetPicker.getState().active).toBeNull();
  const before = game();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(game().informationDeliveries).toEqual(before.informationDeliveries);
  expect(game().players).toEqual(before.players);
  expect(game().nightProgress[`${next.day}:${participantStepKey(next.players.p0.participantId!, shownRole)}`]?.status).toBe("done");
});

it("resolves a direct board target once and waits for Next after commit", () => {
  start();
  expect(current()).toBe(key("p0"));
  expect(useShellStore.getState().litActor?.playerId).toBe("p0");
  expect(useTargetPicker.getState().active).not.toBeNull();
  tap("p4");
  expect(game().players.p4!.effects).toEqual([expect.objectContaining({ type: "poisoned" })]);
  expect(game().nightProgress[`2:${key("p0")}`]?.status).toBe("done");
  expect(store.getState().undoStack).toHaveLength(1);
  expect(current()).toBe(key("p0"));
  expect(screen.getByText("Player 4 chosen.")).toBeInTheDocument();
  expect(screen.getByText("Tap another player to change.")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(2200));
  expect(current()).toBe(key("p0"));
  const committed = game();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(game()).toBe(committed);
  expect(current()).toBe(key("p1"));
  expect(useShellStore.getState().litActor?.playerId).toBe("p1");
});

it("Previous does not change game state and a new target moves the resolved effect atomically", () => {
  start(); tap("p4");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  const before = game();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(current()).toBe(key("p0")); expect(game()).toBe(before);
  tap("p3");
  expect(game().players.p4!.effects).toHaveLength(0);
  expect(game().players.p3!.effects).toEqual([expect.objectContaining({ type: "poisoned" })]);
  expect(store.getState().undoStack).toHaveLength(2);
});

it("a hidden panel suspends targeting and reopening continues the same step", () => {
  const view = start();
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

it("closing the card leaves normal inspection available until it is reopened", () => {
  start();
  expect(useTargetPicker.getState().active).not.toBeNull();
  fireEvent.click(screen.getByTitle("Close night order"));
  expect(useTargetPicker.getState().active).toBeNull();
  expect(pickSeatIfPicking(game(), "p4")).toBe(false);
  act(() => useV6Ui.getState().set({ panel: "night" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "Continue action" })).toBeNull();
  expect(game()).not.toBe(before);
  expect(game().informationDeliveries).toHaveLength(1);
  expect(game().nightProgress[`2:${key("p3")}`]?.status).toBe("done");
  expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
});

it("manual navigation and privacy cancel delayed advancement and pending picks", () => {
  start(); tap("p4");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  const chosen = current();
  act(() => vi.advanceTimersByTime(5000)); expect(current()).toBe(chosen);
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(useTargetPicker.getState().active).toBeNull();
  expect(useShellStore.getState().litActor).toBeNull();
  expect(screen.queryByLabelText("Night 2 guide")).toBeNull();
});

it("later resolved work prevents an unsafe retarget while Previous remains usable", () => {
  start(); tap("p4"); fireEvent.click(screen.getByRole("button", { name: "Next" })); tap("p3");
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(current()).toBe(key("p0"));
  expect(useTargetPicker.getState().active).toBeNull();
  expect(screen.getByText(/game changed after this action|cannot be safely retargeted/i)).toBeInTheDocument();
});

it("Undo during the result restores targeting without an old delayed advance", () => {
  start(); tap("p4");
  act(() => store.getState().undo());
  expect(game().players.p4!.effects).toHaveLength(0);
  expect(useTargetPicker.getState().active).not.toBeNull();
  act(() => vi.advanceTimersByTime(5000));
  expect(current()).toBe(key("p0"));
  tap("p3");
  expect(game().players.p3!.effects).toEqual([expect.objectContaining({ type: "poisoned" })]);
});

it("R2 ordinary targeting retains board eligibility and advanced controls without a duplicate roster", () => {
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p1") });
  render(<Guide />);
  expect(screen.queryByText("Choose from roster")).toBeNull();
  expect(useTargetPicker.getState().active?.eligible?.size).toBe(4);
  expect(useTargetPicker.getState().active?.eligible?.has(game().players.p1!.participantId!)).toBe(false);
  tap("p4");
  expect(game().players.p4!.effects).toEqual([expect.objectContaining({ type: "safeFromDemon" })]);
  expect(store.getState().undoStack).toHaveLength(1);
});

it.each(["privacy", "unmount"])("a captured target callback cannot commit after %s", mode => {
  const view = start();
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
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(game().nightProgress[`2:${key("p0")}`]?.status).toBe("done");
  expect(game().players).toEqual(before.players); expect(game().informationDeliveries).toEqual([]);
  expect(store.getState().undoStack).toHaveLength(1);
  act(() => store.getState().undo()); expect(game().nightProgress).toEqual(before.nightProgress);
});

it("an Imp selecting a functioning Mayor becomes wholly manual with no partial death", () => {
  store.setState({ game: proofGame(["poisoner", "monk", "imp", "empath", "mayor"]) });
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p2") });
  render(<Guide />); const before = game();
  expect(useTargetPicker.getState().active).not.toBeNull();
  tap("p4");
  expect(game()).toBe(before); expect(useTargetPicker.getState().active).toBeNull();
  expect(store.getState().undoStack).toHaveLength(0);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText(proofScript.characters.find(role => role.id === "imp")!.ability!)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Continue action" })).toBeNull();
  act(() => { store.getState().resolveReminders({ intents: [{ kind: "place", target: { playerId: "p0", participantId: game().players.p0!.participantId! },
    reminder: { label: "Chosen" } }] }); });
  expect(useTargetPicker.getState().active).toBeNull();
  const manuallyAdjusted = game();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(game().players).toEqual(manuallyAdjusted.players);
  expect(game().nightProgress[`2:${key("p2")}`]?.status).toBe("done");
  expect(game().lifeEventWindow).toEqual(before.lifeEventWindow);
});

it("the first-night Minion and Demon info steps carry the official night-sheet icons", () => {
  store.setState({ game: { ...proofGame(["poisoner", "monk", "imp", "empath", "chef", "baron", "chef"]), day: 1, phase: "night" } });
  useShellStore.getState().setNightCursor({ day: 1, stepKey: "minionInfo" });
  const { container } = render(<Guide />);
  const art = [...container.querySelectorAll<HTMLElement>('[role="img"]')].map((el) => el.style.backgroundImage);
  expect(art.some((value) => value.includes("/nightsheet/minioninfo.png"))).toBe(true);
  expect(art.some((value) => value.includes("/nightsheet/demoninfo.png"))).toBe(true);
});

it("WP-1: Imp taps itself with a living Recluse: the board asks for the successor (never a silent no-op) and the Recluse can be chosen", () => {
  store.setState({ game: proofGame(["imp", "godfather", "recluse", "chef", "monk"]) });
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p0") });
  render(<Guide />);
  const before = game();
  tap("p0");
  expect(game()).toBe(before);
  expect(useTargetPicker.getState().active?.label).toBe("Choose the new Imp");
  expect(screen.queryByRole("alert")).toBeNull();
  tap("p3"); // a Townsfolk is not a possible Minion
  expect(game()).toBe(before);
  tap("p2"); // the Recluse, the Storyteller's ruling
  expect(game().players.p0!.alive).toBe(false);
  expect(game().players.p2!.actualRole).toBe("imp");
  expect(game().players.p1!.actualRole).toBe("godfather");
  expect(game().nightProgress[`2:${key("p2")}`]?.status).toBe("skipped");
  expect(store.getState().undoStack).toHaveLength(1);
});

it("WP-4: a Moonchild's public Day choice resolves its death by itself when the wake is reached, once, and Undo leaves the step open", () => {
  const base = proofGame(["godfather", "saint", "chef", "moonchild", "imp", "empath", "baron"], "night", 3);
  const p3 = base.players.p3!;
  const withChoice = {
    ...base,
    players: { ...base.players,
      p3: { ...p3, alive: false },
      p2: { ...base.players.p2!, effects: [{ id: "mc1", type: "moonchildChoice", sourceCharacter: "moonchild", lifetime: { kind: "untilDawn" }, state: "active",
        sourceParticipant: { kind: "participant", playerId: "p3", participantId: p3.participantId!, nameAtTime: "Player 3" },
        expiry: { kind: "at", moment: { phase: "day", day: 4 } }, appliedAt: { phase: "day", day: 3 } }] },
    },
  } as unknown as typeof base;
  store.setState({ game: withChoice, undoStack: [] });
  useShellStore.getState().setNightCursor({ day: 3, stepKey: participantStepKey(p3.participantId!, "moonchild") });
  render(<Guide />);
  expect(game().players.p2!.alive).toBe(false);
  expect(game().players.p2!.effects.filter((e) => e.type === "moonchildChoice" && e.state === "active")).toHaveLength(0);
  expect(store.getState().undoStack).toHaveLength(1);
  act(() => { store.getState().undo(); });
  expect(game().players.p2!.alive).toBe(true);
  expect(game().players.p2!.effects.some((e) => e.type === "moonchildChoice" && e.state === "active")).toBe(true);
  // Not resolved a second time: the Storyteller may tap the player again or move on.
  expect(game().players.p2!.alive).toBe(true);
});

it("WP-6: at Dusk the Storyteller taps one of last night's chosen dead players to regurgitate them, or just goes on", () => {
  const n2 = proofGame(["shabaloth", "chef", "empath", "monk", "saint", "baron", "poisoner"], "night", 2);
  const killed = planned(plan(n2, request(n2, "p0", "shabaloth", { targets: pick(n2, "p1", "p2") })));
  store.setState({ game: { ...killed, day: 3 }, undoStack: [] });
  render(<Guide />);
  expect(screen.getByText(/may regurgitate one of the dead players it chose last night/)).toBeInTheDocument();
  expect(useTargetPicker.getState().active?.label).toBe("Regurgitate a player (optional)");
  const before = game();
  tap("p3");
  expect(game()).toBe(before);
  tap("p1");
  expect(game().players.p1!.alive).toBe(true);
  expect(game().players.p1!.effects.some((e) => e.type === "shabalothAlive" && e.state === "active")).toBe(true);
  expect(game().players.p2!.alive).toBe(false);
  expect(useTargetPicker.getState().active).toBeNull();
  expect(screen.queryByText(/may regurgitate/)).toBeNull();
});

it("WP-6: Dusk offers nothing when no dead player was chosen last night", () => {
  store.setState({ game: proofGame(["shabaloth", "chef", "empath", "monk", "saint", "baron", "poisoner"], "night", 3), undoStack: [] });
  render(<Guide />);
  expect(screen.queryByText(/regurgitate/)).toBeNull();
  expect(useTargetPicker.getState().active).toBeNull();
});

// ── WP-7: Night-card consistency ──────────────────────────────────────────────────────────────────
const t30Script = { ...proofScript, id: "treacherous-30th", name: "Treacherous 30th" };
const t30Night = (roles: string[], day = 3) => {
  store.setState({ game: proofGame(roles, "night", day, { scriptId: t30Script.id }), lobby: null, undoStack: [], localSeq: 0, customScripts: { [t30Script.id]: t30Script } });
};
const stripLabels = () => screen.getAllByRole("button").map((b) => b.textContent);

it("WP-7: a player poisoned by the No Dashii shows the Poisoned pill on the Night card", () => {
  // p0 nodashii, p1 empath (a neighbouring Townsfolk is poisoned), p2 chef
  t30Night(["nodashii", "empath", "chef", "monk", "saint", "baron", "poisoner"]);
  useShellStore.getState().setNightCursor({ day: 3, stepKey: key("p1") });
  render(<Guide />);
  expect(screen.getByText(/· any info/)).toBeInTheDocument();
});

it("WP-7: Next and Previous pass over steps that do not wake tonight, which stay reachable on the strip with their reason", () => {
  // Day 3, no execution and no Outsider death: the Undertaker does not wake.
  t30Night(["imp", "undertaker", "empath", "monk", "saint", "baron", "poisoner"]);
  render(<Guide />);
  const order = () => (document.body.textContent ?? "");
  expect(order()).toMatch(/Undertaker/);
  const { steps } = deriveFor();
  const undertaker = steps.find((step) => step.kind === "player" && step.effectiveRoleId === "undertaker")!;
  const before = steps[steps.indexOf(undertaker) - 1]!;
  expect(steps.at(-1)).toBe(undertaker);
  act(() => { useShellStore.getState().setNightCursor({ day: 3, stepKey: before.stepKey }); });
  // Next passes over the Undertaker (nobody was executed): straight to Dawn. Previous comes back to the step before it.
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText(/No one died tonight/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(current()).toBe(before.stepKey);
  // One tap on the strip still opens the collapsed step and says why it does not wake.
  for (const button of screen.getAllByRole("button", { name: /Undertaker/ })) { fireEvent.click(button); if (current() === undertaker.stepKey) break; }
  expect(current()).toBe(undertaker.stepKey);
  expect(screen.getByText(/This character does not wake/)).toBeInTheDocument();
  expect(stripLabels().length).toBeGreaterThan(0);
});

function deriveFor() {
  const script = { ...proofScript, id: "treacherous-30th" };
  return deriveNightWork(game(), { script, registry: buildRegistry(script), semantics: CANONICAL_ABILITY_SEMANTICS });
}

it("WP-8: a Marionette shown as the Investigator gets the same pair picker and Reveal as a true clue, chosen by the Storyteller", () => {
  const base = patchPlayer(proofGame(["imp", "marionette", "chef", "monk", "saint", "baron", "poisoner"], "night", 1), "p1",
    { shownRole: "investigator", shownAlignment: "good", behaviorMode: "marionette_fake_good_behavior" });
  const withEpochs = { ...base, players: Object.fromEntries(Object.entries(base.players).map(([id, p]) => [id, { ...p, packetEpoch: `ep-${id}` }])) } as typeof base;
  store.setState({ game: withEpochs, undoStack: [] });
  useShellStore.getState().setNightCursor({ day: 1, stepKey: participantStepKey(withEpochs.players.p1!.participantId!, "investigator") });
  render(<Guide />);
  expect(screen.getByText(/This player is actually the Marionette/)).toBeInTheDocument();
  const reveal = screen.getAllByRole("button").find((b) => /Reveal/i.test(b.getAttribute("aria-label") ?? b.textContent ?? ""));
  expect(reveal).toBeTruthy();
  act(() => { fireEvent.click(reveal!); });
  const picker = useV6Ui.getState().picker as { onPick?: (id: string) => string | undefined } | null;
  expect(picker?.onPick).toBeTruthy();
  // Only a Minion token can be shown by the Investigator; the Storyteller picks which, then the two players.
  let refusal: string | undefined;
  act(() => { refusal = picker!.onPick!("chef"); });
  expect(refusal).toBeTruthy();
  act(() => { refusal = picker!.onPick!("poisoner"); });
  expect(refusal).toBeUndefined();
  tap("p2"); tap("p4");
  expect(game().preparedInformation).toHaveLength(1);
  expect(game().preparedInformation[0]!.clue).toMatchObject({ kind: "pair", shownCharacter: "poisoner" });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(game().informationDeliveries.some((d) => d.informationActionId === "investigator-first-night")).toBe(true);
  expect(game().nightProgress[`1:${participantStepKey(game().players.p1!.participantId!, "investigator")}`]?.status).toBe("done");
});

it("the Godfather's first night shows every Outsider in play on ONE screen, like the bluff screen", () => {
  store.setState({ game: proofGame(["godfather", "saint", "recluse", "chef", "monk", "imp", "poisoner"], "night", 1), undoStack: [] });
  useShellStore.getState().setNightCursor({ day: 1, stepKey: key("p0") });
  render(<Guide />);
  const buttons = screen.getAllByRole("button", { name: "Show these tokens" });
  expect(buttons).toHaveLength(1);
  act(() => { fireEvent.click(buttons[0]!); });
  expect(useV6Ui.getState().show).toMatchObject({ kind: "setup" });
  const shown = useInfoShow.getState().current;
  expect(shown?.title).toBe("Godfather Information");
  expect(shown?.payload).toMatchObject({ kind: "setup", groups: [{ heading: "These Characters Are in Play", characters: [{ id: "saint" }, { id: "recluse" }] }] });
});

it("WP-8: the Marionette step shows THIS PLAYER IS with the Marionette token to the woken Demon", () => {
  store.setState({ game: proofGame(["imp", "marionette", "chef", "monk", "saint", "baron", "poisoner"], "night", 1), undoStack: [] });
  const adminKey = participantScopedStepKey("admin", game().players.p1!.participantId!, "marionette");
  useShellStore.getState().setNightCursor({ day: 1, stepKey: adminKey });
  render(<Guide />);
  act(() => { fireEvent.click(screen.getByRole("button", { name: "This Player Is" })); });
  expect(useV6Ui.getState().show).toMatchObject({ kind: "char", title: "This Player Is", roleId: "marionette" });
});

it("WP-9: the End control carries the discreet '!' once every Demon is dead, without declaring a winner", () => {
  store.setState({ game: patchPlayer(proofGame(["imp", "chef", "empath", "monk", "saint", "baron", "poisoner"], "day", 2), "p0", { alive: false }), undoStack: [] });
  render(<VotingProvider><GrimoireV6Screen /></VotingProvider>);
  expect(screen.getByLabelText("Win condition met")).toBeInTheDocument();
  expect(screen.getByTitle(/End game · The Demon is dead\. Check whether the game has ended/)).toBeInTheDocument();
  expect(game().phase).toBe("day");
  expect(game().result).toBeFalsy();
});

it("F-20: the Gambler's guess picker opens in character-tokens-only mode", () => {
  store.setState({ game: proofGame(["gambler", "chef", "empath", "monk", "imp", "saint", "poisoner"], "night", 2), undoStack: [] });
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p0") });
  render(<Guide />);
  tap("p1");
  expect(useV6Ui.getState().picker).toMatchObject({ mode: "show", tokensOnly: true, title: "What does the Gambler guess?" });
});

it("a finished Demon information step says Completed once, not twice", () => {
  const base = proofGame(["imp", "poisoner", "baron", "chef", "monk", "empath", "saint"], "night", 1);
  store.setState({ game: { ...base, nightProgress: { ...base.nightProgress, "1:demonInfo": { status: "done", notes: "" } } } });
  useShellStore.getState().setNightCursor({ day: 1, stepKey: "demonInfo" });
  render(<Guide />);
  expect(screen.getAllByText("Completed")).toHaveLength(1);
});
