// SV-5e: the Artist's private question on the Day card (Yes / No / I don't know; one tap records it, spends the ability, NO ABILITY).
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { GrimoireV6Screen } from "../GrimoireV6Screen";
import { useV6Ui } from "../v6Store";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { impair, patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import type { StorytellerLobbyRecord } from "@/stores/types";

// p0 artist, p1 imp (the Vortox where a test needs it), p2 chef, p3 empath, p4 saint
const ROLES = ["artist", "imp", "chef", "empath", "saint"];
const game = () => store.getState().game!;
const badge = () => screen.queryByLabelText("A Day action is waiting");
function open(g: StorytellerLobbyRecord) {
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  render(<VotingProvider><GrimoireV6Screen /></VotingProvider>);
}
const openDay = () => { fireEvent.click(screen.getByRole("button", { name: /^Day$/i })); expect(screen.getByText("No one is on the block")).toBeInTheDocument(); };
const reopen = () => { cleanup(); useV6Ui.getState().reset(); };
const answers = () => screen.queryByRole("group", { name: "Artist, Player 0: the answer you whispered" });
const tapAnswer = (label: string) => fireEvent.click(within(answers()!).getByRole("button", { name: label }));
const noAbility = (id = "p0") => game().players[id]!.reminders.filter((r) => r.label === "No Ability" && r.sourceCharacter === "artist");

beforeEach(() => {
  vi.useFakeTimers();
  useSessionRuntime.setState({ backend: null });
  useShellStore.getState().reset();
  useV6Ui.getState().reset();
  usePrivacyStore.setState({ enabled: false });
  useTargetPicker.getState().cancel();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("a living Artist in the Day: a row with Yes, No and I don't know, and no Day '!' (Q12 A) and no 'Ask again' pill", () => {
  open(proofGame(ROLES, "day", 2));
  expect(badge()).toBeNull();
  openDay();
  expect(screen.getByText("Day actions")).toBeInTheDocument();
  expect(screen.getByText(`${game().players.p0!.name} may ask 1 yes/no question`)).toBeInTheDocument();
  expect(within(answers()!).getAllByRole("button").map((b) => b.textContent)).toEqual(["Yes", "No", "I don't know"]);
  expect(screen.queryByRole("button", { name: /ask again/i })).toBeNull();
  expect(screen.queryByText("false info", { exact: false })).toBeNull();
});

it.each(["Yes", "No", "I don't know"])("one tap on '%s' records the answer, uses the ability and places NO ABILITY; the row goes; one Undo restores it all", (label) => {
  open(proofGame(ROLES, "day", 2));
  openDay();
  const before = game();
  tapAnswer(label);
  expect(game().players.p0!.abilityUsed).toBe(true);
  expect(noAbility()).toHaveLength(1);
  const delivered = game().informationDeliveries;
  expect(delivered).toEqual([expect.objectContaining({ kind: "manual", text: label, actualRole: "artist", moment: { phase: "day", day: 2 },
    recipient: expect.objectContaining({ playerId: "p0" }), provenance: expect.objectContaining({ sourceCharacter: "artist", reason: "manual" }) })]);
  expect(answers()).toBeNull();
  expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
  expect(store.getState().undoStack).toHaveLength(1);
  act(() => { store.getState().undo(); });
  expect(game().players.p0!.abilityUsed).toBe(false);
  expect(noAbility()).toHaveLength(0);
  expect(game().informationDeliveries).toEqual(before.informationDeliveries);
  expect(answers()).not.toBeNull();
});

it("a drunk or poisoned real Artist still has the row; the tap uses the ability and places NO ABILITY (the Storyteller answers freely)", () => {
  open(impair(proofGame(ROLES, "day", 2), "p0", "poisoned"));
  openDay();
  tapAnswer("No");
  expect(game().players.p0!.abilityUsed).toBe(true);
  expect(noAbility()).toHaveLength(1);
});

it("no row for a Drunk who believes they are the Artist, a Marionette, a dead Artist, a spent Artist, at night or in Privacy Mode", () => {
  const drunk = patchPlayer(proofGame(ROLES, "day", 2), "p0", { actualRole: "drunk", shownRole: "artist" });
  const marionette = patchPlayer(proofGame(ROLES, "day", 2), "p0", { actualRole: "marionette", shownRole: "artist", actualAlignment: "evil" });
  const dead = patchPlayer(proofGame(ROLES, "day", 2), "p0", { alive: false });
  const spent = patchPlayer(proofGame(ROLES, "day", 2), "p0", { abilityUsed: true });
  for (const g of [drunk, marionette, dead, spent]) {
    open(g);
    openDay();
    expect(answers()).toBeNull();
    reopen();
  }
  open(proofGame(ROLES, "night", 2));
  expect(answers()).toBeNull();
  reopen();
  open(proofGame(ROLES, "day", 2));
  openDay();
  expect(answers()).not.toBeNull();
  act(() => { usePrivacyStore.setState({ enabled: true }); });
  expect(answers()).toBeNull();
});

it("a working Vortox: the row carries the existing 'Vortox · false info' pill; a poisoned Vortox: no pill", () => {
  const roles = ["artist", "vortox", "chef", "empath", "saint"];
  open(proofGame(roles, "day", 2));
  openDay();
  expect(screen.getByText("Vortox")).toBeInTheDocument();
  expect(screen.getByText("· false info", { exact: false })).toBeInTheDocument();
  reopen();
  open(impair(proofGame(roles, "day", 2), "p1", "poisoned"));
  openDay();
  expect(answers()).not.toBeNull();
  expect(screen.queryByText("· false info", { exact: false })).toBeNull();
});
