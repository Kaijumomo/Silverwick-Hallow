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
const pick = (id: string) => {
  fireEvent.click(badge()!.closest("button")!);
  fireEvent.click(screen.getByRole("button", { name: "Choose a player" }));
  act(() => { pickSeatIfPicking(game(), id); });
};

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
  pick("p0");
  expect(game().players.p0!.abilityUsed).toBe(false);
  act(() => { pickSeatIfPicking(game(), "p2"); });
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
  expect(game().phase).toBe("day");
});

it("the End dialog carries no Klutz line when there is none", () => {
  open(klutzDied("day"));
  fireEvent.click(screen.getByTitle("End game"));
  expect(screen.getByRole("dialog", { name: "End game" })).not.toHaveTextContent(/Klutz/);
});
