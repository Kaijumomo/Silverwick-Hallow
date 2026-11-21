// SV-2b/SV-2c -- the Fang Gu's Night step in the existing Night panel: tapped on the board like the Imp's; the jump is one commit and
// places the official ONCE beside the new Fang Gu; the card offers YOU ARE for the new Fang Gu; a Recluse or Spy is asked on the
// card in the Barber style (PO review 2026-11-21); once ONCE is recorded the Fang Gu's row says so in the card's existing note line.
// PO decision 2026-11-21: the Fang Gu's ONCE placed by hand from the token list records the ONCE rule in the same commit (one
// Undo); removing it by hand clears the rule unless another Fang Gu ONCE is still on the board.
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { openInStore, patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import { placeReminder, removeMark } from "@/features/grimoire-v6/board/marks";
import { marksOn } from "@/test/v6Night";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
// p0 fanggu, p1 sweetheart, p2 chef, p3 monk, p4 mutant
const ROLES = ["fanggu", "sweetheart", "chef", "monk", "mutant"];
function show(g: StorytellerLobbyRecord, actor = "p0") {
  openInStore(g);
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: participantStepKey(g.players[actor]!.participantId!, "fanggu") });
  return render(<StrictMode><Guide /></StrictMode>);
}
beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("tapping the first Outsider: the Fang Gu dies, the Outsider becomes the evil Fang Gu, ONCE is recorded, in one commit", () => {
  show(proofGame(ROLES));
  expect(useTargetPicker.getState().active?.label).toBe("Choose a player to kill");
  tap("p4");
  expect(game().players.p0!.alive).toBe(false);
  expect(game().players.p4).toMatchObject({ alive: true, actualRole: "fanggu", actualAlignment: "evil" });
  expect(game().gameRuleFacts.map((f) => f.type)).toEqual(["fangGuOnce"]);
  expect(game().players.p4!.reminders.map((r) => [r.label, r.sourceCharacter])).toEqual([["Once", "fanggu"]]);
  expect(screen.getByRole("button", { name: "Wake Player 4: You Are" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "You Are Evil" })).toBeInTheDocument();
  expect(store.getState().undoStack).toHaveLength(1);
  act(() => { store.getState().undo(); });
  expect(game().players.p4!.actualRole).toBe("mutant");
  expect(game().gameRuleFacts).toEqual([]);
  expect(game().players.p4!.reminders).toEqual([]);
  expect(screen.queryByRole("button", { name: "Wake Player 4: You Are" })).toBeNull();
});

it("a Recluse: a compact Yes or No on the Night card (no workspace); Yes jumps, No kills the Recluse as normal", () => {
  const g = patchPlayer(proofGame(ROLES), "p2", { actualRole: "recluse", shownRole: "recluse", actualAlignment: "good" });
  show(g);
  tap("p2");
  expect(game().players.p2!.alive).toBe(true);
  expect(screen.getByText("Does Player 2 register as an Outsider?")).toBeInTheDocument();
  expect(screen.queryByText("On Table")).toBeNull();
  expect(screen.queryByRole("button", { name: "Continue action" })).toBeNull();
  fireEvent.click(within(screen.getByRole("group", { name: "Your ruling" })).getByRole("button", { name: "No" }));
  expect(game().players.p2).toMatchObject({ alive: false, actualRole: "recluse" });
  act(() => { store.getState().undo(); });
  tap("p2");
  fireEvent.click(within(screen.getByRole("group", { name: "Your ruling" })).getByRole("button", { name: "Yes" }));
  expect(game().players.p2).toMatchObject({ alive: true, actualRole: "fanggu", actualAlignment: "evil" });
  expect(game().players.p0!.alive).toBe(false);
  expect(store.getState().undoStack).toHaveLength(1);
});

it("the next night, the new Fang Gu's card says ONCE is recorded; its Outsider kill is an ordinary death", () => {
  show(proofGame(ROLES)); tap("p4"); cleanup();
  const next = { ...game(), day: 3 };
  show(next, "p4");
  expect(screen.getByText(/ONCE: a Fang Gu has already taken an Outsider's place\. An Outsider it kills now dies\./)).toBeInTheDocument();
  tap("p1");
  expect(game().players.p1).toMatchObject({ alive: false, actualRole: "sweetheart" });
});

const fangGu = proofScript.characters.find((role) => role.id === "fanggu")!;
const placeOnce = (id: string) => { let result; act(() => { result = placeReminder(id, game().players[id]!.participantId, { role: fangGu, label: "Once" }); }); return result; };
const removeOnce = (id: string) => {
  const mark = marksOn(id).find((m) => m.label === "Once")!;
  let result; act(() => { result = removeMark(id, game().players[id]!.participantId, mark); }); return result;
};
const onceNote = /ONCE: a Fang Gu has already taken an Outsider's place\. An Outsider it kills now dies\./;

it("a ONCE placed by hand records the rule in one commit; the Fang Gu's Outsider kill is then an ordinary death", () => {
  show(proofGame(ROLES));
  expect(screen.queryByText(onceNote)).toBeNull();
  expect(placeOnce("p1")).toEqual({ ok: true });
  expect(game().gameRuleFacts.map((f) => f.type)).toEqual(["fangGuOnce"]);
  expect(game().players.p1!.reminders.map((r) => [r.label, r.sourceCharacter])).toEqual([["Once", "fanggu"]]);
  expect(store.getState().undoStack).toHaveLength(1);
  expect(screen.getByText(onceNote)).toBeInTheDocument();
  act(() => { store.getState().undo(); });
  expect(game().gameRuleFacts).toEqual([]);
  expect(game().players.p1!.reminders).toEqual([]);
  placeOnce("p1");
  tap("p4");
  expect(game().players.p4).toMatchObject({ alive: false, actualRole: "mutant" });
  expect(game().players.p0).toMatchObject({ alive: true, actualRole: "fanggu" });
});

it("removing the last Fang Gu ONCE by hand clears the rule in one commit; Undo restores both", () => {
  show(proofGame(ROLES));
  placeOnce("p1");
  expect(removeOnce("p1")).toEqual({ ok: true });
  expect(game().gameRuleFacts).toEqual([]);
  expect(game().players.p1!.reminders).toEqual([]);
  expect(store.getState().undoStack).toHaveLength(2);
  act(() => { store.getState().undo(); });
  expect(game().gameRuleFacts.map((f) => f.type)).toEqual(["fangGuOnce"]);
  expect(game().players.p1!.reminders.map((r) => r.label)).toEqual(["Once"]);
});

it("two ONCE tokens on the board: removing one keeps the rule, removing the last clears it", () => {
  show(proofGame(ROLES)); tap("p4");
  expect(placeOnce("p1")).toEqual({ ok: true });
  expect(game().gameRuleFacts).toHaveLength(1);
  removeOnce("p1");
  expect(game().gameRuleFacts.map((f) => f.type)).toEqual(["fangGuOnce"]);
  removeOnce("p4");
  expect(game().gameRuleFacts).toEqual([]);
});

it("a ONCE placed by hand during the Day records the rule too; another character's token stays notation", () => {
  openInStore(proofGame(ROLES, "day", 2));
  expect(placeOnce("p1")).toEqual({ ok: true });
  expect(game().gameRuleFacts.map((f) => f.type)).toEqual(["fangGuOnce"]);
  const monk = proofScript.characters.find((role) => role.id === "monk")!;
  const before = game().gameRuleFacts;
  expect(placeReminder("p2", game().players.p2!.participantId, { role: monk, label: monk.reminders![0]! })).toEqual({ ok: true });
  expect(game().gameRuleFacts).toEqual(before);
});

it("a Spy: the same compact card; Choose again re-arms the board; Yes jumps and the counter stays on the Fang Gu's row", () => {
  const g = patchPlayer(proofGame(ROLES), "p3", { actualRole: "spy", shownRole: "spy", actualAlignment: "evil" });
  show(g);
  // The position on the strip; the total can shrink, since the Spy no longer has a Spy step.
  const counter = () => screen.getByText(/^\d+ \/ \d+$/).textContent!.split(" / ")[0];
  const before = counter();
  tap("p3");
  expect(screen.getByText("Does Player 3 register as an Outsider?")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Continue action" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Choose again" }));
  expect(screen.queryByText("Does Player 3 register as an Outsider?")).toBeNull();
  expect(useTargetPicker.getState().active?.label).toBe("Choose a player to kill");
  expect(store.getState().undoStack).toHaveLength(0);
  tap("p3");
  fireEvent.click(within(screen.getByRole("group", { name: "Your ruling" })).getByRole("button", { name: "Yes" }));
  expect(game().players.p3).toMatchObject({ alive: true, actualRole: "fanggu", actualAlignment: "evil" });
  expect(game().players.p0!.alive).toBe(false);
  expect(counter()).toBe(before);
  expect(screen.getByRole("button", { name: "Wake Player 3: You Are" })).toBeInTheDocument();
});

it("a refused rule-token command changes nothing: neither the token nor the rule", () => {
  openInStore(proofGame(ROLES));
  const stale = { playerId: "p1", participantId: "not-this-player" };
  const result = store.getState().resolveRuleReminder({ notation: { intents: [{ kind: "place", target: stale, reminder: { label: "Once", sourceCharacter: "fanggu" } }] },
    facts: { intents: [{ kind: "apply", type: "fangGuOnce" }] } });
  expect(result.ok).toBe(false);
  expect(game().gameRuleFacts).toEqual([]);
  expect(game().players.p1!.reminders).toEqual([]);
  expect(store.getState().undoStack).toHaveLength(0);
});
