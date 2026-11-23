// SV-5g3 -- the Mathematician's Night step on the existing Night card (the Chef's card): only the count, Next records it and clears
// every ABNORMAL mark in the same commit, Undo restores both, the Vortox pill and false numbers, the impaired choice, a reload, Privacy
// Mode, and a mark made after he woke expiring at dawn uncounted.
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { impair, patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import { placeReminder } from "@/features/grimoire-v6/board/marks";
import { abnormalCount } from "@/stores/abnormalMarks";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
const mathematician = proofScript.characters.find((role) => role.id === "mathematician")!;
const placeAbnormal = (id: string) => act(() => { placeReminder(id, game().players[id]!.participantId, { role: mathematician, label: "Abnormal" }); });
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
function open(g: StorytellerLobbyRecord) {
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: participantStepKey(g.players.p0!.participantId!, g.players.p0!.shownRole!) });
  return render(<StrictMode><Guide /></StrictMode>);
}
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));
const choices = () => [...screen.getByRole("group", { name: "Information to communicate" }).querySelectorAll("button")].map((button) => button.textContent);
const vortoxPill = () => screen.queryByText(/· false info/);
// p0 mathematician, p1 clockmaker, p2 fanggu, p3 witch, p4 sage, p5 savant
const ROLES = ["mathematician", "clockmaker", "fanggu", "witch", "sage", "savant"];
beforeEach(() => { vi.useFakeTimers(); useSessionRuntime.setState({ backend: null }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("two players marked by hand: the card shows 2; Next records it and clears the marks in one commit; Undo restores both", () => {
  store.setState({ game: proofGame(ROLES, "night", 2), lobby: null, undoStack: [], customScripts: { [proofScript.id]: proofScript } });
  placeAbnormal("p1");
  placeAbnormal("p4");
  open(game());
  expect(screen.getByLabelText("Information to communicate")).toHaveTextContent(/^2$/);
  expect(game().informationDeliveries).toHaveLength(0);
  next();
  expect(game().informationDeliveries.at(-1)).toMatchObject({ informationActionId: "mathematician-other-night", values: [{ requirementId: "abnormal", value: 2 }] });
  expect(abnormalCount(game())).toBe(0);
  expect(store.getState().undoStack).toHaveLength(1);
  act(() => { store.getState().undo(); });
  expect(game().informationDeliveries).toHaveLength(0);
  expect(abnormalCount(game())).toBe(2);
});

it("after a reload the completed step still shows the number given", () => {
  open(proofGame(ROLES, "night", 2));
  next();
  cleanup();
  open(game());
  expect(screen.getByText("Completed")).toBeInTheDocument();
  expect(screen.getByLabelText("Information to communicate")).toHaveTextContent(/^0$/);
});

it("a Vortox: its pill, and every number but the true count", () => {
  const g = proofGame(["mathematician", "oracle", "vortox", "witch", "towncrier", "chef"], "night", 3);
  store.setState({ game: g, lobby: null, undoStack: [], customScripts: { [proofScript.id]: proofScript } });
  placeAbnormal("p4");
  open(game());
  expect(vortoxPill()).toHaveTextContent(/^Vortox ?· false info$/);
  expect(choices()).toEqual(["0", "2", "3", "4", "5"]);
  fireEvent.click(screen.getByRole("button", { name: "3" }));
  expect(game().informationDeliveries.at(-1)).toMatchObject({ values: [{ requirementId: "abnormal", value: 3 }] });
  expect(abnormalCount(game())).toBe(0);
});

it("a poisoned Mathematician: the Poisoned pill and the Storyteller's choice of 0 to 5", () => {
  open(impair(proofGame(ROLES, "night", 2), "p0"));
  expect(screen.getByText(/· any info/)).toHaveTextContent(/^Poisoned ?· any info$/);
  expect(choices()).toEqual(["0", "1", "2", "3", "4", "5"]);
  fireEvent.click(screen.getByRole("button", { name: "4" }));
  expect(game().informationDeliveries.at(-1)).toMatchObject({ values: [{ value: 4 }] });
});

it("Privacy Mode hides the number", () => {
  open(proofGame(ROLES, "night", 2));
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(screen.queryByLabelText("Information to communicate")).toBeNull();
});

it("a mark made after he woke is not his: it is gone at dawn, never counted", () => {
  open(proofGame(ROLES, "night", 2));
  next();
  placeAbnormal("p3");
  expect(abnormalCount(game())).toBe(1);
  act(() => { store.getState().advancePhase(); });
  expect(game().phase).toBe("day");
  expect(abnormalCount(game())).toBe(0);
});

it("a dead Mathematician has no card to give a number on", () => {
  open(patchPlayer(proofGame(ROLES, "night", 2), "p0", { alive: false }));
  expect(screen.queryByLabelText("Information to communicate")).toBeNull();
});
