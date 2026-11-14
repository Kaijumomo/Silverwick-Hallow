// SV-1d -- the Barber's Night step in the existing Night panel (the ability workspace), the HAIRCUTS TONIGHT disc, and Undo.
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { marksOn } from "@/test/v6Night";
import { choose } from "@/test/pickers";
import { deriveNightWork } from "@/features/nightOrder/nightWork";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { bind, impair, openInStore, proofGame, proofRegistry, proofScript, request } from "@/test/proofFixtures";
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
function demonKill() {
  openInStore(proofGame(ROLES));
  expect(store.getState().resolveAbility(request(game(), "p1", "imp", { target: { kind: "participant", participants: [bind(game(), "p0")] } }))).toMatchObject({ ok: true, changed: true });
  store.setState({ undoStack: [] });
}
const roles = () => game().seatOrder.map(id => game().players[id]!.actualRole);
const haircuts = () => marksOn("p0").filter(m => m.label === "Haircuts Tonight");
const workspace = () => document.querySelector(".ability-workspace") as HTMLElement;
beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("killed tonight: the official HAIRCUTS TONIGHT disc, a step for the Demon's choice, the swap in one commit, and Undo", () => {
  demonKill();
  expect(haircuts()).toEqual([expect.objectContaining({ title: "Barber: Haircuts Tonight",
    removal: { type: "derived", reason: "This follows the Barber's death. It ends when the Demon has chosen, or at dawn." } })]);
  expect(haircuts()[0]!.src).not.toBe("");
  show();
  expect(screen.getAllByText("The Demon may choose 2 players to swap characters").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Continue action" }));
  const ws = workspace();
  expect(within(ws).getByRole("checkbox", { name: "The Demon chooses nobody" })).toBeInTheDocument();
  choose("The two players whose characters swap 1", "p2", ws);
  choose("The two players whose characters swap 2", "p3", ws);
  expect(roles()).toEqual(["barber", "imp", "dreamer", "clockmaker", "witch"]);
  expect(store.getState().undoStack).toHaveLength(1);
  expect(haircuts()).toHaveLength(0);
  store.getState().undo();
  expect(roles()).toEqual(ROLES);
  expect(haircuts()).toHaveLength(1);
});

it("the Demon chooses nobody: the step closes, nothing changes, and the disc goes", () => {
  demonKill(); show();
  fireEvent.click(screen.getByRole("button", { name: "Continue action" }));
  fireEvent.click(within(workspace()).getByRole("checkbox", { name: "The Demon chooses nobody" }));
  expect(roles()).toEqual(ROLES);
  expect(Object.values(game().nightProgress).some(record => record.status === "done")).toBe(true);
  expect(haircuts()).toHaveLength(0);
});

it("the Night list shows the step only on the night the Barber died (or after a Day death)", () => {
  openInStore(proofGame(ROLES)); expect(rows()).toHaveLength(0);
  demonKill(); expect(rows()).toHaveLength(1);
  openInStore(proofGame(ROLES, "day", 1));
  expect(store.getState().resolveLife({ intents: [{ kind: "execution", playerId: "p0", outcome: "died" }] }).ok).toBe(true);
  expect(haircuts()).toHaveLength(1);
  store.getState().setPhase("night"); expect(rows()).toHaveLength(1);
});

it("the disc is hidden from nobody's phone: it is not part of any player's or the public projection", async () => {
  demonKill();
  const { projectLobbyToPublic, projectLobbyToSelfMap } = await import("@/stores/projections");
  const text = JSON.stringify([projectLobbyToPublic(game(), {}), projectLobbyToSelfMap(game(), proofRegistry)]);
  expect(text).not.toMatch(/Haircuts/i);
});

it("a living player who becomes the Clockmaker: the step is on the Night list right after the Barber's, answered by hand", () => {
  demonKill(); show();
  fireEvent.click(screen.getByRole("button", { name: "Continue action" }));
  choose("The two players whose characters swap 1", "p2", workspace());
  choose("The two players whose characters swap 2", "p3", workspace());
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

it("a refused choice says why in the card (another Demon; a drunk or poisoned Barber), and the Demon's nobody still closes the step", () => {
  openInStore(proofGame([...ROLES, "nodashii"]));
  store.setState({ game: { ...game(), players: { ...game().players, p5: { ...game().players.p5!, alive: false } } } });
  expect(store.getState().resolveAbility(request(game(), "p1", "imp", { target: { kind: "participant", participants: [bind(game(), "p0")] } }))).toMatchObject({ ok: true, changed: true });
  store.setState({ undoStack: [] });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Continue action" }));
  choose("The two players whose characters swap 1", "p5", workspace());
  choose("The two players whose characters swap 2", "p2", workspace());
  expect(within(workspace()).getByRole("alert")).toHaveTextContent("The Demon may not choose another Demon.");
  expect(roles()).toEqual([...ROLES, "nodashii"]);
  fireEvent.click(within(workspace()).getByRole("checkbox", { name: "The Demon chooses nobody" }));
  expect(Object.values(game().nightProgress).some(record => record.status === "done")).toBe(true);
});

it("a poisoned Barber: the card says no swap happens", () => {
  demonKill();
  store.setState({ game: impair(game(), "p0", "poisoned") });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Continue action" }));
  choose("The two players whose characters swap 1", "p2", workspace());
  choose("The two players whose characters swap 2", "p3", workspace());
  expect(within(workspace()).getByRole("alert")).toHaveTextContent("Player 0 is drunk or poisoned: no swap happens. Choose “The Demon chooses nobody”.");
  expect(roles()).toEqual(ROLES);
});

it("two living Demons: the card asks which Demon makes the swap, then swaps", () => {
  openInStore(proofGame([...ROLES, "chef"]));
  expect(store.getState().resolveAbility(request(game(), "p1", "imp", { target: { kind: "participant", participants: [bind(game(), "p0")] } }))).toMatchObject({ ok: true, changed: true });
  store.setState({ undoStack: [], game: { ...game(), players: { ...game().players, p5: { ...game().players.p5!, actualRole: "nodashii", shownRole: "nodashii", actualAlignment: "evil" } } } });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Continue action" }));
  choose("The two players whose characters swap 1", "p5", workspace());
  choose("The two players whose characters swap 2", "p2", workspace());
  expect(within(workspace()).getAllByText("The Demon who makes the swap").length).toBeGreaterThan(0);
  choose("The Demon who makes the swap", "p5", workspace());
  expect(roles()).toEqual(["barber", "imp", "nodashii", "dreamer", "witch", "clockmaker"]);
});
