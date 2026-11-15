// SV-1d -- the Barber's Night step, the HAIRCUTS TONIGHT disc and Undo. PO review 2026-11-14 (C1, C4): the two players are tapped on the
// grimoire in the Night card (no workspace), the swap waits for "Swap" or "Choose again", "The Demon chooses nobody" is separate from
// "Continue without swap" (a drunk or poisoned Barber, or no living Demon), the Demon is chosen first only when two are alive, and a
// player who might register as a Demon (the Recluse) is the Storyteller's ruling.
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { marksOn } from "@/test/v6Night";
import { deriveNightWork } from "@/features/nightOrder/nightWork";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { bind, impair, openInStore, patchPlayer, proofGame, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
const rows = (g = game()) => deriveNightWork(g, { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS }).steps
  .filter(step => step.kind === "player" && step.playerId === "p0");
function show() {
  const row = rows()[0];
  expect(row).toBeDefined();
  useShellStore.getState().setNightCursor({ day: game().day, stepKey: row!.stepKey });
  return render(<StrictMode><Guide /></StrictMode>);
}
// p0 barber, p1 imp, p2 clockmaker, p3 dreamer, p4 witch
const ROLES = ["barber", "imp", "clockmaker", "dreamer", "witch"];
function demonKill(roles = ROLES) {
  openInStore(proofGame(roles));
  expect(store.getState().resolveAbility(request(game(), "p1", "imp", { target: { kind: "participant", participants: [bind(game(), "p0")] } }))).toMatchObject({ ok: true, changed: true });
  store.setState({ undoStack: [] });
}
const roles = () => game().seatOrder.map(id => game().players[id]!.actualRole);
const haircuts = () => marksOn("p0").filter(m => m.label === "Haircuts Tonight");
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const picker = () => useTargetPicker.getState().active;
const stepDone = () => Object.values(game().nightProgress).some(record => record.status === "done");
beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("killed tonight: the official disc; the two players are tapped on the board, named beside the prompt, and nothing changes until Swap; one commit; Undo", () => {
  demonKill();
  expect(haircuts()).toEqual([expect.objectContaining({ title: "Barber: Haircuts Tonight",
    removal: { type: "derived", reason: "This follows the Barber's death. It ends when the Demon has chosen, or at dawn." } })]);
  expect(haircuts()[0]!.src).not.toBe("");
  show();
  expect(screen.getAllByText("The Demon may choose 2 players to swap characters").length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Continue action" })).toBeNull();
  expect(document.querySelector(".ability-workspace")).toBeNull();
  expect(screen.getByText("Tap two players on the board")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "The Demon chooses nobody" })).toBeInTheDocument();
  expect(picker()?.label).toBe("Choose player 1 of 2");
  tap("p2");
  expect(screen.getByText("Tap one more player on the board")).toBeInTheDocument();
  expect(document.querySelector(".night-pick-chip")).toHaveTextContent("Player 2");
  tap("p3");
  expect(screen.getByText("Swap Player 2 and Player 3?")).toBeInTheDocument();
  expect(screen.getByText("Player 2 becomes the Dreamer; Player 3 becomes the Clockmaker.")).toBeInTheDocument();
  expect(roles()).toEqual(ROLES);
  expect(store.getState().undoStack).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Swap" }));
  expect(roles()).toEqual(["barber", "imp", "dreamer", "clockmaker", "witch"]);
  expect(store.getState().undoStack).toHaveLength(1);
  expect(haircuts()).toHaveLength(0);
  store.getState().undo();
  expect(roles()).toEqual(ROLES);
  expect(haircuts()).toHaveLength(1);
});

it("Choose again clears both picks before anything changes, and the taps start over", () => {
  demonKill(); show();
  tap("p2"); tap("p3");
  fireEvent.click(screen.getByRole("button", { name: "Choose again" }));
  expect(screen.queryByText("Swap Player 2 and Player 3?")).toBeNull();
  expect(screen.getByText("Tap two players on the board")).toBeInTheDocument();
  expect(picker()?.label).toBe("Choose player 1 of 2");
  expect(roles()).toEqual(ROLES);
  expect(store.getState().undoStack).toHaveLength(0);
  tap("p4"); tap("p1");
  fireEvent.click(screen.getByRole("button", { name: "Swap" }));
  expect(roles()).toEqual(["barber", "witch", "clockmaker", "dreamer", "imp"]);
});

it("the Demon chooses nobody: the step closes, nothing changes, and the disc goes; Undo reopens it", () => {
  demonKill(); show();
  fireEvent.click(screen.getByRole("button", { name: "The Demon chooses nobody" }));
  expect(roles()).toEqual(ROLES);
  expect(stepDone()).toBe(true);
  expect(haircuts()).toHaveLength(0);
  expect(picker()).toBeNull();
  store.getState().undo();
  expect(haircuts()).toHaveLength(1);
});

it("the Night list shows the step only on the night the Barber died (or after a Day death)", () => {
  openInStore(proofGame(ROLES)); expect(rows()).toHaveLength(0);
  demonKill(); expect(rows()).toHaveLength(1);
  openInStore(proofGame(ROLES, "day", 1));
  expect(store.getState().resolveLife({ intents: [{ kind: "execution", playerId: "p0", outcome: "died" }] }).ok).toBe(true);
  expect(haircuts()).toHaveLength(1);
  store.getState().setPhase("night"); expect(rows()).toHaveLength(1);
});

it("privacy: the disc and the confirmation are in no player's view or the public view, and Privacy Mode hides the card and stops the taps", async () => {
  demonKill();
  const { projectLobbyToPublic, projectLobbyToSelfMap } = await import("@/stores/projections");
  const text = JSON.stringify([projectLobbyToPublic(game(), {}), projectLobbyToSelfMap(game(), proofRegistry)]);
  expect(text).not.toMatch(/Haircuts/i);
  show();
  tap("p2"); tap("p3");
  expect(screen.getByText("Player 2 becomes the Dreamer; Player 3 becomes the Clockmaker.")).toBeInTheDocument();
  act(() => { usePrivacyStore.setState({ enabled: true }); });
  expect(screen.queryByText(/becomes the/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Swap" })).toBeNull();
  expect(picker()).toBeNull();
  expect(roles()).toEqual(ROLES);
});

it("a living player who becomes the Clockmaker: the step is on the Night list right after the Barber's, answered by hand", () => {
  demonKill(); show();
  tap("p2"); tap("p3");
  fireEvent.click(screen.getByRole("button", { name: "Swap" }));
  cleanup();
  const steps = deriveNightWork(game(), { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS }).steps;
  const names = steps.flatMap(s => s.kind === "player" ? [s.effectiveRoleName] : []);
  expect(names.indexOf("Clockmaker")).toBe(names.indexOf("Barber") + 1);
  const row = steps.find(s => s.kind === "player" && s.playerId === "p3")!;
  useShellStore.getState().setNightCursor({ day: game().day, stepKey: row.stepKey });
  render(<StrictMode><Guide /></StrictMode>);
  expect(screen.getByText("Player 3 · Seat 4")).toBeInTheDocument();
  expect(screen.getByText("You start knowing how many steps from the Demon to its nearest Minion.")).toBeInTheDocument();
});

it("another Demon cannot be tapped (a dead No Dashii here): the board refuses it and nothing is picked", () => {
  openInStore(proofGame([...ROLES, "nodashii"]));
  store.setState({ game: patchPlayer(game(), "p5", { alive: false }) });
  expect(store.getState().resolveAbility(request(game(), "p1", "imp", { target: { kind: "participant", participants: [bind(game(), "p0")] } }))).toMatchObject({ ok: true, changed: true });
  show();
  expect(picker()?.eligible?.has(game().players.p5!.participantId!)).toBe(false);
  expect(picker()?.eligible?.has(game().players.p1!.participantId!)).toBe(true);
  tap("p5");
  expect(useTargetPicker.getState().refused).toMatch(/can't be chosen/);
  expect(document.querySelector(".night-pick-chip")).toBeNull();
});

it("a poisoned Barber: no taps; the card says no swap happens and offers only Continue without swap, which closes the step", () => {
  demonKill();
  store.setState({ game: impair(game(), "p0", "poisoned") });
  show();
  expect(screen.getByText("No swap happens")).toBeInTheDocument();
  expect(screen.getByText("Player 0 is drunk or poisoned.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "The Demon chooses nobody" })).toBeNull();
  expect(picker()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Continue without swap" }));
  expect(stepDone()).toBe(true);
  expect(roles()).toEqual(ROLES);
});

it("no living Demon: the card says so and offers only Continue without swap", () => {
  demonKill();
  store.setState({ game: patchPlayer(game(), "p1", { alive: false }) });
  show();
  expect(screen.getByText("There is no living Demon.")).toBeInTheDocument();
  expect(picker()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Continue without swap" }));
  expect(stepDone()).toBe(true);
});

it("two living Demons: the Demon who swaps is tapped first, then the two players; with one Demon there is no such step", () => {
  openInStore(proofGame([...ROLES, "chef"]));
  expect(store.getState().resolveAbility(request(game(), "p1", "imp", { target: { kind: "participant", participants: [bind(game(), "p0")] } }))).toMatchObject({ ok: true, changed: true });
  store.setState({ undoStack: [], game: patchPlayer(game(), "p5", { actualRole: "nodashii", shownRole: "nodashii", actualAlignment: "evil" }) });
  show();
  expect(screen.getByText("Tap the Demon who makes the swap")).toBeInTheDocument();
  expect([...picker()!.eligible!].sort()).toEqual([game().players.p1!.participantId!, game().players.p5!.participantId!].sort());
  tap("p5");
  expect(screen.getByText("Player 5 swaps")).toBeInTheDocument();
  // The swapping Demon may choose itself; the other Demon (the Imp) is not offered.
  expect(picker()?.eligible?.has(game().players.p1!.participantId!)).toBe(false);
  tap("p5"); tap("p2");
  fireEvent.click(screen.getByRole("button", { name: "Swap" }));
  expect(roles()).toEqual(["barber", "imp", "nodashii", "dreamer", "witch", "clockmaker"]);
});

it("a Recluse chosen: the Storyteller rules whether they register as a Demon; Yes refuses the pair, No goes on to the swap", () => {
  demonKill(["barber", "imp", "clockmaker", "dreamer", "recluse"]);
  show();
  tap("p4"); tap("p2");
  expect(screen.getByText("Does Player 4 register as a Demon?")).toBeInTheDocument();
  expect(screen.getByText("The Demon may not choose another Demon.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect(screen.getByRole("alert")).toHaveTextContent("The Demon may not choose another Demon.");
  expect(screen.getByText("Tap two players on the board")).toBeInTheDocument();
  tap("p4"); tap("p2");
  fireEvent.click(screen.getByRole("button", { name: "No" }));
  expect(screen.getByText("Swap Player 4 and Player 2?")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Swap" }));
  expect(roles()).toEqual(["barber", "imp", "recluse", "dreamer", "clockmaker"]);
});

it("two living Demons: Choose again starts over from the Demon, so a mis-tapped Demon can be changed", () => {
  openInStore(proofGame([...ROLES, "chef"]));
  expect(store.getState().resolveAbility(request(game(), "p1", "imp", { target: { kind: "participant", participants: [bind(game(), "p0")] } }))).toMatchObject({ ok: true, changed: true });
  store.setState({ undoStack: [], game: patchPlayer(game(), "p5", { actualRole: "nodashii", shownRole: "nodashii", actualAlignment: "evil" }) });
  show();
  tap("p5"); tap("p2"); tap("p3");
  expect(screen.getByText("Swap Player 2 and Player 3?")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Choose again" }));
  expect(screen.getByText("Tap the Demon who makes the swap")).toBeInTheDocument();
  expect([...picker()!.eligible!].sort()).toEqual([game().players.p1!.participantId!, game().players.p5!.participantId!].sort());
  tap("p1");
  expect(screen.getByText("Player 1 swaps")).toBeInTheDocument();
  expect(roles()).toEqual(["barber", "imp", "clockmaker", "dreamer", "witch", "nodashii"]);
});

it("a pair the app cannot swap (a Drunk who thinks they are the Chef): the step goes by hand and the card says why", () => {
  demonKill();
  store.setState({ game: patchPlayer(game(), "p4", { actualRole: "drunk", shownRole: "chef", actualAlignment: "good" }) });
  show();
  tap("p4"); tap("p2");
  expect(screen.getByRole("alert")).toHaveTextContent("A concealed identity is involved: what these players are shown is not modeled. Swap their characters by hand.");
  expect(screen.queryByText("Tap two players on the board")).toBeNull();
  expect(roles()).toEqual(["barber", "imp", "clockmaker", "dreamer", "drunk"]);
});
