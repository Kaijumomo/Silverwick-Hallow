// SV-5b -- the Seamstress's step on the existing Night card: Not Tonight, two board taps (not herself), the YES / NO answer, the
// official NO ABILITY token, one Undo, the Spy/Recluse question and the impaired choice.
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { deriveNightWork } from "@/features/nightOrder/nightWork";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { impair, proofGame, proofRegistry, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
function open(g: StorytellerLobbyRecord) {
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: participantStepKey(g.players.p0!.participantId!, g.players.p0!.shownRole!) });
  return render(<StrictMode><Guide /></StrictMode>);
}
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const seamstressRows = (g = game()) => deriveNightWork(g, { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS }).steps
  .filter((step) => step.kind === "player" && step.playerId === "p0");
beforeEach(() => { vi.useFakeTimers(); useSessionRuntime.setState({ backend: null }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

// p0 seamstress, p1 barber, p2 clockmaker, p3 fanggu, p4 sweetheart, p5 witch
const ROLES = ["seamstress", "barber", "clockmaker", "fanggu", "sweetheart", "witch"];

it("Not Tonight closes tonight's step, uses nothing, and she wakes again the next night", () => {
  open(proofGame(ROLES, "night", 2));
  expect(screen.getByText("Choose two players on the board")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Not Tonight" }));
  expect(game().informationDeliveries).toHaveLength(0);
  expect(game().players.p0!.abilityUsed).toBe(false);
  expect(screen.getByText("Completed")).toBeInTheDocument();
  expect(screen.getByText("Not tonight: the ability is kept.")).toBeInTheDocument();
  expect(seamstressRows({ ...game(), day: 3, nightProgress: {} })).toHaveLength(1);
});

it("two taps (never herself) give YES or NO; one commit uses the ability with the official NO ABILITY token; Undo restores it all", () => {
  open(proofGame(ROLES, "night", 2));
  expect(useTargetPicker.getState().active?.eligible?.has(game().players.p0!.participantId!)).toBe(false);
  tap("p1"); expect(game().informationDeliveries).toHaveLength(0);
  tap("p3");
  expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("NO");
  expect(game().informationDeliveries.at(-1)).toMatchObject({ informationActionId: "seamstress-other-night" });
  expect(game().players.p0!.abilityUsed).toBe(true);
  expect(game().players.p0!.reminders).toContainEqual(expect.objectContaining({ label: "No Ability", sourceCharacter: "seamstress" }));
  expect(screen.queryByRole("button", { name: "Not Tonight" })).toBeNull();
  // Only YES or NO: the card never says why.
  expect(document.querySelector(".night-information-why")).toBeNull();
  expect(store.getState().undoStack).toHaveLength(1);
  expect(seamstressRows({ ...game(), day: 3, nightProgress: {} })).toHaveLength(0);
  store.getState().undo();
  expect(game().players.p0!.abilityUsed).toBe(false);
  expect(game().players.p0!.reminders.filter((r) => r.label === "No Ability")).toHaveLength(0);
  expect(game().informationDeliveries).toHaveLength(0);
});

it("a Recluse chosen beside an evil player: one Yes / No ruling, which is the answer", () => {
  open(proofGame([...ROLES, "recluse"], "night", 2));
  tap("p6"); tap("p3");
  expect(screen.getByText("Do they register as the same alignment?")).toBeInTheDocument();
  expect(game().informationDeliveries).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect(game().informationDeliveries.at(-1)!.values).toContainEqual({ requirementId: "sameAlignment", kind: "boolean", value: true });
  expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("YES");
});

it("a poisoned Seamstress: after the taps the Storyteller picks YES or NO, and the ability is used", () => {
  open(impair(proofGame(ROLES, "night", 2), "p0"));
  tap("p1"); tap("p2");
  expect(screen.queryByRole("button", { name: "Not Tonight" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "NO" }));
  expect(game().informationDeliveries.at(-1)!.values).toContainEqual({ requirementId: "sameAlignment", kind: "boolean", value: false });
  expect(game().players.p0!.abilityUsed).toBe(true);
});

it("Privacy Mode hides the card", () => {
  open(proofGame(ROLES, "night", 2));
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(screen.queryByRole("button", { name: "Not Tonight" })).toBeNull();
});
