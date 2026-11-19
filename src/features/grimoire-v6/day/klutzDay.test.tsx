// SV-1c: the Klutz's public Day choice on the Moonchild's Day row and "!", and the End control's "!" line.
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
import { patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";

// p0 klutz, p1 imp, p2 chef, p3 recluse, p4 empath
const ROLES = ["klutz", "imp", "chef", "recluse", "empath"];
const badge = () => screen.queryByLabelText("A Day action is waiting");
const game = () => store.getState().game!;
function klutzDied(phase: "night" | "day" = "night"): StorytellerLobbyRecord {
  const base = proofGame(ROLES, "day", 3);
  const died = { id: "d-klutz", kind: "death", moment: { phase, day: 3 }, actualRoleAtEvent: "klutz",
    subject: { kind: "participant", playerId: "p0", participantId: base.players.p0!.participantId!, nameAtTime: base.players.p0!.name } } as LifeEvent;
  return { ...patchPlayer(base, "p0", { alive: false }), lifeEventWindow: { ...base.lifeEventWindow, events: [died] } };
}
function open(g: StorytellerLobbyRecord) {
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  render(<VotingProvider><GrimoireV6Screen /></VotingProvider>);
}
const card = () => screen.queryByRole("dialog", { name: "Klutz's choice" });
const openCard = () => {
  fireEvent.click(badge()!.closest("button")!);
  fireEvent.click(screen.getByRole("button", { name: "Choose a player" }));
};
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const confirm = () => fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
/** The row, the card, a tap on the board, then Confirm (PO design direction 2026-11-19). */
const pick = (id: string) => { openCard(); tap(id); confirm(); };

beforeEach(() => {
  vi.useFakeTimers();
  useSessionRuntime.setState({ backend: null });
  useShellStore.getState().reset();
  useV6Ui.getState().reset();
  usePrivacyStore.setState({ enabled: false });
  useTargetPicker.getState().cancel();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("from dawn after a night death: the Moonchild's three strings on a Klutz row and the '!'", () => {
  open(klutzDied("night"));
  expect(badge()).toBeInTheDocument();
  fireEvent.click(badge()!.closest("button")!);
  expect(screen.getByText("Klutz")).toBeInTheDocument();
  expect(screen.getByText(`${game().players.p0!.name} learned they died`)).toBeInTheDocument();
  expect(screen.getByText("Awaiting choice")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Choose a player" })).toBeInTheDocument();
});

it("an evil choice: the row closes and End carries the line naming who wins; Undo brings the row back and clears the line", () => {
  open(klutzDied("day"));
  expect(screen.queryByTitle(/The Klutz chose/)).toBeNull();
  pick("p1");
  expect(useTargetPicker.getState().active).toBeNull();
  expect(game().players.p0!.abilityUsed).toBe(true);
  expect(badge()).toBeNull();
  expect(screen.getByTitle("End game · The Klutz chose an evil player. Evil wins. Check before ending the game")).toBeInTheDocument();
  expect(game().phase).toBe("day");
  act(() => { store.getState().undo(); });
  expect(badge()).toBeInTheDocument();
  expect(screen.queryByTitle(/The Klutz chose/)).toBeNull();
});

it("a Recluse chosen: the line says it is the Storyteller's ruling", () => {
  open(klutzDied("day"));
  pick("p3");
  expect(screen.getByTitle("End game · The Klutz chose a player who may register as evil. Your ruling")).toBeInTheDocument();
});

it("only living players are offered; a good choice flags nothing", () => {
  open(klutzDied("day"));
  openCard(); tap("p0");
  expect(useTargetPicker.getState().refused).toMatch(/can't be chosen/);
  expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  expect(game().players.p0!.abilityUsed).toBe(false);
  tap("p2"); confirm();
  expect(game().players.p0!.abilityUsed).toBe(true);
  expect(screen.queryByTitle(/The Klutz chose/)).toBeNull();
});

it("Privacy Mode hides the row, the '!' and the End line", () => {
  open(klutzDied("day"));
  pick("p1");
  act(() => { usePrivacyStore.setState({ enabled: true }); });
  expect(screen.queryByTitle(/The Klutz chose/)).toBeNull();
});

it("touch: tapping End shows the Klutz line in the End dialog (no hover needed); only the Storyteller's choice there ends the game", () => {
  open(klutzDied("day"));
  pick("p1");
  // The Klutz's choice alone ends nothing: the game runs on until the Storyteller ends it.
  expect(game().phase).toBe("day");
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(game().phase).toBe("day");
  fireEvent.click(screen.getByTitle(/^End game · The Klutz chose/));
  const dialog = screen.getByRole("dialog", { name: "End game" });
  expect(dialog).toHaveTextContent("The Klutz chose an evil player. Evil wins. Check before ending the game.");
  // PO design direction 2026-11-19: the line sits in its own "Possible game end" box; the grey line is gone.
  expect(screen.getByRole("note", { name: "Possible game end" })).toHaveTextContent("Possible game endThe Klutz chose an evil player. Evil wins. Check before ending the game.");
  expect(dialog).not.toHaveTextContent("Choose the winning team");
  expect(game().phase).toBe("day");
});

it("the Klutz's card (PO design direction 2026-11-19): a tap fills the slot and can be changed; nothing is recorded until Confirm", () => {
  open(klutzDied("day"));
  openCard();
  expect(card()).toBeInTheDocument();
  expect(card()).toHaveTextContent(`${game().players.p0!.name} learns they died. They publicly choose 1 alive player.`);
  expect(card()).toHaveTextContent("PlayerTap on the board");
  expect(screen.queryByText("No one is on the block")).toBeNull();
  expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  tap("p2");
  expect(card()).toHaveTextContent(`${game().players.p2!.name}Chef`);
  expect(game().players.p0!.abilityUsed).toBe(false);
  tap("p1");
  expect(card()).toHaveTextContent(`${game().players.p1!.name}Imp`);
  expect(game().players.p0!.abilityUsed).toBe(false);
  confirm();
  expect(card()).toBeNull();
  expect(useTargetPicker.getState().active).toBeNull();
  expect(game().gameRuleFacts).toEqual([expect.objectContaining({ type: "klutzGoodTeamLost" })]);
});

it("Dismiss closes the card, records nothing and stops the taps; the row is still waiting", () => {
  open(klutzDied("day"));
  const before = structuredClone(game());
  openCard(); tap("p1");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(card()).toBeNull();
  expect(useTargetPicker.getState().active).toBeNull();
  expect(game()).toEqual(before);
  expect(badge()).toBeInTheDocument();
});

it("Privacy Mode closes the Klutz's card and stops the taps", () => {
  open(klutzDied("day"));
  openCard(); tap("p1");
  act(() => { usePrivacyStore.setState({ enabled: true }); });
  expect(card()).toBeNull();
  expect(useTargetPicker.getState().active).toBeNull();
  expect(game().players.p0!.abilityUsed).toBe(false);
});

it("the End dialog carries no Klutz line when there is none", () => {
  open(klutzDied("day"));
  fireEvent.click(screen.getByTitle("End game"));
  expect(screen.getByRole("dialog", { name: "End game" })).not.toHaveTextContent(/Klutz/);
});

it("E6 (PO review 2026-11-14): the board tap records exactly the Klutz's use and the fact naming the Klutz; nothing else changes", () => {
  open(klutzDied("day"));
  const before = structuredClone(game());
  pick("p1");
  expect(game().players.p0!.abilityUsed).toBe(true);
  expect(game().gameRuleFacts).toEqual([expect.objectContaining({ type: "klutzGoodTeamLost",
    provenance: expect.objectContaining({ sourceCharacter: "klutz", sourceParticipant: expect.objectContaining({ playerId: "p0" }) }) })]);
  for (const id of ["p1", "p2", "p3", "p4"]) expect(game().players[id], id).toEqual(before.players[id]);
});

it("End dialog (PO design direction 2026-11-19): any line the End '!' carries sits in the box, e.g. a dead Demon; none in Privacy Mode", () => {
  open(patchPlayer(proofGame(ROLES, "day", 3), "p1", { alive: false }));
  fireEvent.click(screen.getByTitle(/^End game · The Demon is dead/));
  const note = screen.getByRole("note", { name: "Possible game end" });
  expect(note.textContent).toMatch(/^Possible game endThe Demon is dead\./);
  fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
  act(() => { usePrivacyStore.setState({ enabled: true }); });
  expect(screen.queryByRole("note", { name: "Possible game end" })).toBeNull();
});
