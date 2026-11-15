// SV-1b: the Sweetheart's Day action (PO answer to Q1): a Day actions row in the Moonchild row's markup, with the "!" on the Day button.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { GrimoireV6Screen } from "../GrimoireV6Screen";
import { useV6Ui } from "../v6Store";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { impair, patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";

// p0 sweetheart, p1 imp, p2 chef, p3 moonchild, p4 empath
const ROLES = ["sweetheart", "imp", "chef", "moonchild", "empath"];
const badge = () => screen.queryByLabelText("A Day action is waiting");
const game = () => store.getState().game!;
const drunk = () => game().players.p2!.effects.filter((e) => e.type === "drunk" && e.sourceCharacter === "sweetheart");
const died = (g: StorytellerLobbyRecord, id: string, roleId: string): LifeEvent => ({ id: `d-${id}`, kind: "death", moment: { phase: "day", day: 3 }, actualRoleAtEvent: roleId,
  subject: { kind: "participant", playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: g.players[id]!.name } }) as LifeEvent;
function open(g: StorytellerLobbyRecord) {
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  render(<VotingProvider><GrimoireV6Screen /></VotingProvider>);
}
function sweetheartDied(over: (g: StorytellerLobbyRecord) => StorytellerLobbyRecord = (g) => g, moonchild = false) {
  const base = over(proofGame(ROLES, "day", 3));
  let g = patchPlayer(base, "p0", { alive: false });
  if (moonchild) g = patchPlayer(g, "p3", { alive: false });
  return { ...g, lifeEventWindow: { ...base.lifeEventWindow, events: [died(base, "p0", "sweetheart"), ...(moonchild ? [died(base, "p3", "moonchild")] : [])] } };
}
const openDayCard = () => fireEvent.click(badge()!.closest("button")!);

beforeEach(() => {
  vi.useFakeTimers();
  useSessionRuntime.setState({ backend: null });
  useShellStore.getState().reset();
  useV6Ui.getState().reset();
  usePrivacyStore.setState({ enabled: false });
  useTargetPicker.getState().cancel();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("a Sweetheart who died today: the '!' and a Day actions row; the tapped player is drunk from now on; Undo brings the row back", () => {
  open(sweetheartDied());
  expect(badge()).toBeInTheDocument();
  openDayCard();
  expect(screen.getByText("Sweetheart")).toBeInTheDocument();
  expect(screen.getByText(`${game().players.p0!.name} died`)).toBeInTheDocument();
  expect(screen.getByText("Awaiting choice")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Choose a player" }));
  expect(useTargetPicker.getState().active?.label).toBe("the Sweetheart's choice");
  act(() => { pickSeatIfPicking(game(), "p2"); });
  expect(drunk()).toHaveLength(1);
  expect(store.getState().undoStack).toHaveLength(1);
  expect(badge()).toBeNull();
  expect(screen.queryByText("Awaiting choice")).toBeNull();
  act(() => { store.getState().undo(); });
  expect(drunk()).toHaveLength(0);
  expect(badge()).toBeInTheDocument();
});

it("the Moonchild and the Sweetheart waiting together: two rows in the same markup, seat order", () => {
  open(sweetheartDied((g) => g, true));
  openDayCard();
  expect(screen.getAllByRole("button", { name: "Choose a player" })).toHaveLength(2);
  expect(screen.getByText(`${game().players.p3!.name} learned they died`)).toBeInTheDocument();
  expect(screen.getByText(`${game().players.p0!.name} died`)).toBeInTheDocument();
});

it("a poisoned Sweetheart: the row records that nobody becomes drunk, with no pick", () => {
  open(sweetheartDied((g) => impair(g, "p0")));
  openDayCard();
  fireEvent.click(screen.getByRole("button", { name: "Choose a player" }));
  expect(useTargetPicker.getState().active).toBeNull();
  expect(Object.values(game().players).some((p) => p.effects.some((e) => e.sourceCharacter === "sweetheart"))).toBe(false);
  expect(store.getState().undoStack).toHaveLength(1);
  expect(badge()).toBeNull();
});

it("Privacy Mode hides the row and the '!'", () => {
  usePrivacyStore.setState({ enabled: true });
  open(sweetheartDied());
  expect(badge()).toBeNull();
});

it("E6 (PO review 2026-11-14): the board tap changes exactly the tapped player's state: a lasting DRUNK sourced from the Sweetheart; nobody else changes", () => {
  open(sweetheartDied());
  const before = structuredClone(game().players);
  openDayCard();
  fireEvent.click(screen.getByRole("button", { name: "Choose a player" }));
  act(() => { pickSeatIfPicking(game(), "p2"); });
  expect(drunk()).toEqual([expect.objectContaining({ type: "drunk", sourceCharacter: "sweetheart", state: "active",
    sourceParticipant: expect.objectContaining({ playerId: "p0", participantId: before.p0!.participantId }) })]);
  for (const id of ["p0", "p1", "p3", "p4"]) expect(game().players[id]!.effects, id).toEqual(before[id]!.effects);
  expect(game().players.p2!.actualRole).toBe("chef");
});
