// SV-3a -- the Philosopher's Night step in the existing Night panel, in the Barber card's language: "Not Tonight" closes tonight's step
// and uses nothing; "Choose Character" opens the board's character picker on the script's Townsfolk and Outsiders, and the pick commits
// at once (PO decision Q3: no confirm tap; one Undo). https://wiki.bloodontheclocktower.com/Philosopher
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
import { captureFingerprint } from "@/stores/abilityResolution";
import { AbilityWorkspace } from "@/features/abilities/AbilityWorkspace";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { GAINED_BY_HAND } from "@/features/grimoire-v6/night/useNightEngine";
import { gainedRoleOf, gainedTokenShownOf } from "@/stores/gainedAbility";
import { impair, openInStore, proofGame, proofRegistry, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
// p0 philosopher, p1 fanggu, p2 dreamer, p3 clockmaker, p4 witch
const ROLES = ["philosopher", "fanggu", "dreamer", "clockmaker", "witch"];
const stepKey = (g: StorytellerLobbyRecord) => participantStepKey(g.players.p0!.participantId!, "philosopher");
function show(g = proofGame(ROLES)) {
  openInStore(g);
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: stepKey(g) });
  return render(<StrictMode><Guide /></StrictMode>);
}
const choice = () => screen.getByRole("group", { name: "The Philosopher's choice" });
const picker = () => useV6Ui.getState().picker;
/** The open character picker's pick callback (the "show" picker the card opens). */
const onPickOf = () => { const open = picker(); return open?.mode === "show" ? open.onPick : undefined; };
/** The board's character picker reports a pick (the picker itself is the board's, tested with the board). */
const pickCharacter = (roleId: string) => { let refusal: string | undefined; act(() => { refusal = onPickOf()?.(roleId) ?? undefined; }); return refusal; };

beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); useV6Ui.getState().set({ picker: null }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("the card offers Not Tonight and Choose Character, and asks nothing on the board", () => {
  show();
  expect(within(choice()).getByRole("button", { name: "Not Tonight" })).toHaveClass("gv-choice-pill");
  expect(within(choice()).getByRole("button", { name: "Choose Character" })).toHaveClass("gv-choice-confirm");
  expect(useTargetPicker.getState().active).toBeNull();
  expect(screen.getByText("Choose a good character")).toBeInTheDocument();
});

it("Not Tonight closes tonight's step and uses nothing (one Undo)", () => {
  show();
  fireEvent.click(within(choice()).getByRole("button", { name: "Not Tonight" }));
  expect(game().nightProgress[`2:${stepKey(game())}`]?.status).toBe("done");
  expect(game().players.p0!.abilityUsed).toBe(false);
  expect(gainedRoleOf(game().players.p0)).toBeNull();
  expect(store.getState().undoStack).toHaveLength(1);
});

it("Choose Character opens the board's character picker on Townsfolk and Outsiders; the pick commits at once, in one Undo", () => {
  show();
  fireEvent.click(within(choice()).getByRole("button", { name: "Choose Character" }));
  // Character tokens and names only: no "who holds it" names (the app still tracks the holders for the in-play and DRUNK rules).
  expect(picker()).toMatchObject({ mode: "show", tokensOnly: true, title: "Choose a good character", kicker: "The Philosopher · a Townsfolk or an Outsider", types: ["townsfolk", "outsider"] });
  expect(game().players.p0!.abilityUsed).toBe(false);
  expect(pickCharacter("dreamer")).toBeUndefined();
  expect(picker()).toBeNull();
  expect(game().players.p0!.abilityUsed).toBe(true);
  expect(gainedRoleOf(game().players.p0)).toBe("dreamer");
  expect(game().nightProgress[`2:${stepKey(game())}`]?.status).toBe("done");
  expect(store.getState().undoStack).toHaveLength(1);
  // The card shows what was gained and who is drunk.
  const slots = document.querySelector(".gv-choice-slots") as HTMLElement;
  expect(within(slots).getByText("Dreamer")).toBeInTheDocument();
  expect(within(slots).getByText("Player 2 is drunk")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "The Philosopher's choice" })).toBeNull();
  act(() => { store.getState().undo(); });
  expect(game().players.p0!.abilityUsed).toBe(false);
  expect(gainedRoleOf(game().players.p0)).toBeNull();
  expect(within(choice()).getByRole("button", { name: "Choose Character" })).toBeInTheDocument();
});

it("a character not in play: the card says the token is swapped", () => {
  show();
  fireEvent.click(within(choice()).getByRole("button", { name: "Choose Character" }));
  expect(pickCharacter("mathematician")).toBeUndefined();
  expect(gainedTokenShownOf(game().players.p0)).toBe("mathematician");
  expect(screen.getByText("Not in play: the token is swapped")).toBeInTheDocument();
});

it("a Minion or Demon is refused inside the picker and nothing changes; choosing the Philosopher goes to the Storyteller", () => {
  show();
  fireEvent.click(within(choice()).getByRole("button", { name: "Choose Character" }));
  const before = game();
  expect(pickCharacter("witch")).toBe("Choose a Townsfolk or an Outsider of this script.");
  expect(game()).toBe(before);
  expect(picker()).not.toBeNull();
  expect(pickCharacter("philosopher")).toBeUndefined();
  expect(game()).toBe(before);
  expect(picker()).toBeNull();
  expect(store.getState().undoStack).toHaveLength(0);
});

it("a drunk or poisoned Philosopher: the card says the choice gains nothing, and the pick only uses the ability", () => {
  show(impair(proofGame(ROLES), "p0", "poisoned"));
  expect(screen.getByText("Player 0 is drunk or poisoned: a choice uses the ability and gains nothing.")).toBeInTheDocument();
  fireEvent.click(within(choice()).getByRole("button", { name: "Choose Character" }));
  expect(pickCharacter("dreamer")).toBeUndefined();
  expect(game().players.p0!.abilityUsed).toBe(true);
  expect(gainedRoleOf(game().players.p0)).toBeNull();
  expect(screen.getByText("The ability is used. Nothing is gained.")).toBeInTheDocument();
});

it("Privacy Mode hides the card, and a pick made while it is on is refused", () => {
  show();
  fireEvent.click(within(choice()).getByRole("button", { name: "Choose Character" }));
  // The board closes its picker when Privacy Mode goes on; a pick that still arrives from it is refused.
  const onPick = onPickOf()!;
  act(() => { usePrivacyStore.setState({ enabled: true }); });
  expect(screen.queryByRole("group", { name: "The Philosopher's choice" })).toBeNull();
  let refusal: string | undefined | void;
  act(() => { refusal = onPick("dreamer"); });
  expect(refusal).toBe("The game changed. Close this and choose again.");
  expect(game().players.p0!.abilityUsed).toBe(false);
});

it("the next night: no Philosopher card, and the gained Mathematician row is the Storyteller's by hand at the Mathematician's place", () => {
  show();
  fireEvent.click(within(choice()).getByRole("button", { name: "Choose Character" }));
  pickCharacter("mathematician");
  cleanup();
  const next = { ...game(), day: 3 };
  openInStore(next);
  useShellStore.getState().setNightCursor({ day: 3, stepKey: participantStepKey(next.players.p0!.participantId!, "mathematician") });
  render(<StrictMode><Guide /></StrictMode>);
  expect(screen.queryByRole("group", { name: "The Philosopher's choice" })).toBeNull();
  expect(screen.getByText(/Gained from the Philosopher/)).toBeInTheDocument();
  // A by-hand row, like the real Mathematician's: the ability's text and the one-line note, no choice.
  expect(screen.getByText(/you learn how many players’ abilities worked abnormally/)).toBeInTheDocument();
  // The board: the Philosopher's seat shows the Mathematician token with IS THE PHILOSOPHER (nobody truly held it).
  expect(screen.getByText("Is The Philosopher")).toBeInTheDocument();
  expect(screen.getByText("MATHEMATICIAN")).toBeInTheDocument();
});

/** SV-3b: the next night, on the gained `roleId` row of a Philosopher who chose it tonight. */
function showGained(roleId: string, roles = ROLES) {
  const g = proofGame(roles, "night", 2);
  openInStore(g);
  const chosen = store.getState().resolveAbility({ mode: "guided", invocationPath: "nightOrder", roleId: "philosopher", completeStep: true,
    fingerprint: captureFingerprint(g, "p0", { day: 2, stepKey: stepKey(g) })!, inputs: { character: { kind: "character", roleIds: [roleId] } } });
  expect(chosen).toMatchObject({ ok: true, changed: true });
  const next = { ...game(), day: 3 };
  openInStore(next);
  useShellStore.getState().setNightCursor({ day: 3, stepKey: participantStepKey(next.players.p0!.participantId!, roleId) });
  return render(<StrictMode><Guide /></StrictMode>);
}

it("SV-3b: a gained Snake Charmer is tapped on the board like the real one; choosing the Demon swaps, and YOU ARE is offered to both", () => {
  showGained("snakecharmer");
  expect(useTargetPicker.getState().active?.label).toBe("Choose an alive player");
  const counter = () => screen.getByText(/^\d+ \/ \d+$/).textContent;
  const before = counter();
  act(() => { pickSeatIfPicking(game(), "p1"); });
  expect(game().players.p0).toMatchObject({ actualRole: "fanggu", actualAlignment: "evil" });
  expect(game().players.p1).toMatchObject({ actualRole: "philosopher", actualAlignment: "good" });
  expect(store.getState().undoStack).toHaveLength(1);
  const newDemon = screen.getByRole("group", { name: "Wake Player 0" });
  const newPhilosopher = screen.getByRole("group", { name: "Wake Player 1" });
  expect(within(newDemon).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Wake Player 0: You Are", "Wake Player 0: You Are Evil"]);
  expect(within(newPhilosopher).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Wake Player 1: You Are", "Wake Player 1: You Are Good"]);
  fireEvent.click(within(newPhilosopher).getByRole("button", { name: "Wake Player 1: You Are" }));
  expect(useV6Ui.getState().show).toMatchObject({ kind: "char", title: "You Are", roleId: "philosopher" });
  // The step left the list (Player 0 is the Fang Gu now): the counter keeps its place in the order.
  expect(counter()).toBe(before);
  act(() => { store.getState().undo(); });
  expect(game().players.p0!.actualRole).toBe("philosopher");
  expect(screen.queryByRole("button", { name: /^Wake Player 0: You Are/ })).toBeNull();
});

it("SV-3b: a gained Oracle is answered on the Night card like the real one, and the delivery records the Oracle performed", () => {
  showGained("oracle", ["philosopher", "fanggu", "dreamer", "clockmaker", "witch"]);
  // The Oracle's own Night card: the ability's text and the number shown, not the by-hand row.
  expect(screen.getByText("Each night*, you learn how many dead players are evil.")).toBeInTheDocument();
  expect(screen.getByText("Gained from the Philosopher.")).toBeInTheDocument();
  // Nobody dead: the Oracle learns 0; Next records it, with the Oracle performed by the Philosopher.
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  const delivery = game().informationDeliveries.at(-1);
  expect(delivery).toMatchObject({ actualRole: "philosopher", performedRole: "oracle", informationActionId: "oracle-other-night" });
});

it("SV-3 (independent check): on a by-hand gained row, what the Storyteller records as told keeps the gained character performed", () => {
  const g = proofGame(ROLES, "night", 2);
  openInStore(g);
  expect(store.getState().resolveAbility({ mode: "guided", invocationPath: "nightOrder", roleId: "philosopher", completeStep: true,
    fingerprint: captureFingerprint(g, "p0", { day: 2, stepKey: stepKey(g) })!, inputs: { character: { kind: "character", roleIds: ["mathematician"] } } })).toMatchObject({ ok: true });
  openInStore({ ...game(), day: 3 });
  function Workspace() {
    const current = store((s) => s.game)!;
    return <AbilityWorkspace game={current} script={proofScript} registry={proofRegistry} semantics={CANONICAL_ABILITY_SEMANTICS} descriptor={null} manualReason={GAINED_BY_HAND}
      target={{ actorId: "p0", roleId: "mathematician", roleName: "Mathematician", invocationPath: "nightOrder", step: { day: 3, stepKey: participantStepKey(current.players.p0!.participantId!, "mathematician") } }}
      onClose={() => {}} onResolved={() => {}} />;
  }
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  render(<Workspace />);
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Reason for manual resolution" }), { target: { value: "Gained Mathematician" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "+ Information told" }));
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Step 1 information told" }), { target: { value: "1" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm and record" }));
  expect(game().informationDeliveries.at(-1)).toMatchObject({ kind: "manual", actualRole: "philosopher", performedRole: "mathematician", text: "1" });
  vi.unstubAllGlobals();
});
