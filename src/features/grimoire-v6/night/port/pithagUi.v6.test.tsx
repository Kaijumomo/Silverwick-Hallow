// PH-a / PH-b -- the Pit-Hag's Night step in the existing Night panel, in the Cerenovus card's language: the Storyteller taps a player on the
// board, then the board's character picker (all four character types, tokens only, no player names) commits at once (one Undo). Afterwards
// the card shows who became what and the "Wake" row (YOU ARE, the new character, then Good or Evil). https://wiki.bloodontheclocktower.com/Pit-Hag
// board, then the board's character picker (Townsfolk and Outsiders, tokens only, no player names) commits at once (one Undo). Afterwards
// the card shows who is mad about which character and the "Wake" row with the two reveal tokens. https://wiki.bloodontheclocktower.com/Cerenovus
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { useV6Ui } from "@/features/grimoire-v6/v6Store";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { useInfoShow } from "@/features/grimoire-v6/info/showStore";
import { impair, openInStore, patchPlayer, proofGame, proofRegistry, proofScript } from "@/test/proofFixtures";
import { deriveNightWork, unfinishedNightWork } from "@/features/nightOrder/nightWork";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
// p0 pithag, p1 imp, p2 chef, p3 empath, p4 monk
const ROLES = ["pithag", "imp", "chef", "empath", "monk"];
const stepKey = (g: StorytellerLobbyRecord) => participantStepKey(g.players.p0!.participantId!, "pithag");
function show(g = proofGame(ROLES)) {
  openInStore(g);
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: stepKey(g) });
  return render(<StrictMode><Guide /></StrictMode>);
}
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const picker = () => useV6Ui.getState().picker;
const onPickOf = () => { const open = picker(); return open?.mode === "show" ? open.onPick : undefined; };
const pickCharacter = (roleId: string) => { let refusal: string | undefined; act(() => { refusal = onPickOf()?.(roleId) ?? undefined; }); return refusal; };
const roleOf = (id: string) => game().players[id]!.actualRole;

beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); useV6Ui.getState().set({ picker: null }); useInfoShow.getState().clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("the card asks for a player on the board first; tapping one opens the character picker with tokens only and no player names", () => {
  show();
  expect(useTargetPicker.getState().active?.label).toBe("Choose a player and a character");
  expect(picker()).toBeNull();
  tap("p2");
  expect(picker()).toMatchObject({ mode: "show", tokensOnly: true, title: "Choose a character", kicker: "The Pit-Hag · what the player becomes", types: ["townsfolk", "outsider", "minion", "demon"] });
  expect(roleOf("p2")).toBe("chef");
  expect(store.getState().undoStack).toHaveLength(0);
});

it("a character not in play changes the player at once, in one Undo: alignment kept, step done, the card shows the slot and the Wake row", () => {
  show();
  tap("p2");
  expect(pickCharacter("savant")).toBeUndefined();
  expect(picker()).toBeNull();
  expect(roleOf("p2")).toBe("savant");
  expect(game().players.p2!.actualAlignment).toBe("good");
  expect(game().nightProgress[`2:${stepKey(game())}`]?.status).toBe("done");
  expect(store.getState().undoStack).toHaveLength(1);
  const slots = document.querySelector(".gv-choice-slots") as HTMLElement;
  expect(within(slots).getByText("Player 2")).toBeInTheDocument();
  expect(within(slots).getByText("Becomes the Savant")).toBeInTheDocument();
  const row = screen.getByRole("group", { name: "Wake Player 2" });
  expect(within(row).getByRole("button", { name: "Wake Player 2: You Are" })).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Wake Player 2: You Are Good" })).toBeInTheDocument();
  act(() => { store.getState().undo(); });
  expect(roleOf("p2")).toBe("chef");
  expect(screen.queryByRole("group", { name: "Wake Player 2" })).toBeNull();
});

it("a good player made a Minion is still told Good; the tokens open the existing player-safe reveals and record nothing", () => {
  show();
  tap("p2");
  pickCharacter("witch");
  expect(game().players.p2!.actualAlignment).toBe("good");
  const row = screen.getByRole("group", { name: "Wake Player 2" });
  fireEvent.click(within(row).getByRole("button", { name: "Wake Player 2: You Are" }));
  expect(useV6Ui.getState().show).toMatchObject({ kind: "char", title: "You Are", roleId: "witch" });
  act(() => { useV6Ui.getState().set({ show: null }); });
  expect(within(row).getByRole("button", { name: "Wake Player 2: You Are Good" })).toBeInTheDocument();
  expect(store.getState().undoStack).toHaveLength(1);
});

it("a reload keeps the slot and the Wake row (read from History)", () => {
  show();
  tap("p2");
  pickCharacter("savant");
  cleanup();
  useShellStore.getState().setNightCursor({ day: 2, stepKey: stepKey(game()) });
  render(<StrictMode><Guide /></StrictMode>);
  expect(screen.getByText("Becomes the Savant")).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Wake Player 2" })).toBeInTheDocument();
});

it("a character already in play: nothing changes, the step is completed, and the card says so", () => {
  show();
  tap("p2");
  expect(pickCharacter("empath")).toBeUndefined();
  expect(roleOf("p2")).toBe("chef");
  expect(game().nightProgress[`2:${stepKey(game())}`]?.status).toBe("done");
  expect(screen.getByText("The Empath is already in play: nothing happens.")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Wake Player 2" })).toBeNull();
});

it("a Demon not in play changes the player and the Wake row names it; a dead player may be chosen", () => {
  show(patchPlayer(proofGame(ROLES), "p3", { alive: false }));
  tap("p3");
  expect(pickCharacter("vortox")).toBeUndefined();
  expect(roleOf("p3")).toBe("vortox");
  expect(game().players.p3!.actualAlignment).toBe("good");
  expect(screen.getByRole("group", { name: "Wake Player 3" })).toBeInTheDocument();
});

it("a Traveller player is the Storyteller's: the by-hand notice shows, nothing changes, the workspace never opens", () => {
  show(patchPlayer(proofGame(ROLES), "p2", { isTraveler: true }));
  tap("p2");
  const before = game();
  act(() => { onPickOf()?.("savant"); });
  expect(game()).toBe(before);
  expect(picker()).toBeNull();
  expect(screen.queryByText("Resolve")).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent(/Traveller/);
});

it("a drunk or poisoned Pit-Hag: the pick is made and nothing changes", () => {
  show(impair(proofGame(ROLES), "p0", "poisoned"));
  tap("p2");
  expect(pickCharacter("savant")).toBeUndefined();
  expect(roleOf("p2")).toBe("chef");
  expect(screen.getByText("Player 0 is drunk or poisoned: nothing changes.")).toBeInTheDocument();
});

it("Privacy Mode hides the card and refuses a pick that still arrives", () => {
  show();
  tap("p2");
  const onPick = onPickOf()!;
  act(() => { usePrivacyStore.setState({ enabled: true }); });
  act(() => { onPick("savant"); });
  expect(roleOf("p2")).toBe("chef");
});

it("the Pit-Hag does not wake on the first night", () => {
  cleanup();
  const g = proofGame(ROLES, "night", 1);
  openInStore(g);
  const steps = document.body;
  expect(steps).toBeTruthy();
  expect(CANONICAL_ABILITY_SEMANTICS.get("pithag")!.timing).toEqual(["otherNight"]);
});

it("a character made after its place has passed tonight is not owed a wake (acts from tomorrow); one still ahead keeps its row", () => {
  // p0 pithag, p1 imp, p2 chef, p3 empath, p4 monk. The Poisoner's place is before the Pit-Hag's; the Empath's is after.
  const g = proofGame(["pithag", "imp", "chef", "monk", "washerwoman"]);
  openInStore(g);
  useShellStore.getState().setNightCursor({ day: 2, stepKey: stepKey(g) });
  render(<StrictMode><Guide /></StrictMode>);
  tap("p2");
  pickCharacter("poisoner");
  const work = deriveNightWork(game(), { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS });
  const poisoner = work.steps.find((step) => step.kind === "player" && step.effectiveRoleId === "poisoner");
  expect(poisoner).toBeTruthy();
  expect(work.late.has(poisoner!.stepKey)).toBe(true);
  expect(unfinishedNightWork(game(), work).rows.some((step) => step.stepKey === poisoner!.stepKey)).toBe(false);
  act(() => { store.getState().undo(); });
  const before = deriveNightWork(game(), { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS });
  expect(before.late.size).toBe(0);
});

it("a hand correction back to the old character ends the exemption: only the character they now hold is judged", () => {
  const g = proofGame(["pithag", "imp", "chef", "monk", "washerwoman"]);
  openInStore(g);
  useShellStore.getState().setNightCursor({ day: 2, stepKey: stepKey(g) });
  render(<StrictMode><Guide /></StrictMode>);
  tap("p2");
  pickCharacter("poisoner");
  store.setState({ game: patchPlayer(game(), "p2", { actualRole: "chef", shownRole: "chef" }) });
  const work = deriveNightWork(game(), { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS });
  expect(work.late.size).toBe(0);
});
