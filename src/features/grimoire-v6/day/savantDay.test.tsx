// SV-5e2: the Savant's private visit on the Day card ("Told today", once per Day; nothing typed).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

// p0 savant, p1 imp (the Vortox where a test needs it), p2 chef, p3 artist, p4 saint
const ROLES = ["savant", "imp", "chef", "artist", "saint"];
const game = () => store.getState().game!;
const badge = () => screen.queryByLabelText("A Day action is waiting");
function open(g: StorytellerLobbyRecord) {
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  render(<VotingProvider><GrimoireV6Screen /></VotingProvider>);
}
const openDay = () => { fireEvent.click(screen.getByRole("button", { name: /^Day$/i })); expect(screen.getByText("No one is on the block")).toBeInTheDocument(); };
const reopen = () => { cleanup(); useV6Ui.getState().reset(); };
const toldPill = () => screen.queryByRole("button", { name: "Told today" });
const toldDone = () => document.querySelector('[data-day-visit="done"]');
const visits = () => game().informationDeliveries.filter((d) => d.kind === "manual" && d.actualRole === "savant");

beforeEach(() => {
  vi.useFakeTimers();
  useSessionRuntime.setState({ backend: null });
  useShellStore.getState().reset();
  useV6Ui.getState().reset();
  usePrivacyStore.setState({ enabled: false });
  useTargetPicker.getState().cancel();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("a living Savant: a row with one 'Told today' pill beside the Artist's row, and no Day '!' (Q12 A)", () => {
  open(proofGame(ROLES, "day", 2));
  expect(badge()).toBeNull();
  openDay();
  expect(screen.getByText(`${game().players.p0!.name} may learn 2 things: 1 true, 1 false`)).toBeInTheDocument();
  expect(toldPill()).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Artist, Player 3: the answer you whispered" })).toBeInTheDocument();
  expect(toldDone()).toBeNull();
});

it("one tap records today's visit (nothing typed, no ability used); the pill becomes done; one Undo restores it", () => {
  open(proofGame(ROLES, "day", 2));
  openDay();
  fireEvent.click(toldPill()!);
  expect(visits()).toEqual([expect.objectContaining({ kind: "manual", moment: { phase: "day", day: 2 }, recipient: expect.objectContaining({ playerId: "p0" }),
    provenance: expect.objectContaining({ sourceCharacter: "savant", reason: "manual" }) })]);
  expect(game().players.p0!.abilityUsed).toBe(false);
  expect(game().players.p0!.reminders).toEqual([]);
  expect(toldPill()).toBeNull();
  expect(toldDone()).toHaveTextContent("Told today");
  expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
  expect(badge()).toBeNull();
  act(() => { store.getState().undo(); });
  expect(visits()).toEqual([]);
  expect(toldPill()).toBeInTheDocument();
});

it("the mark is for the Day it was made: the next Day starts unmarked, and the earlier visit stays recorded", () => {
  open(proofGame(ROLES, "day", 2));
  openDay();
  fireEvent.click(toldPill()!);
  act(() => { store.setState({ game: { ...game(), day: 3 } }); });
  expect(toldPill()).toBeInTheDocument();
  expect(toldDone()).toBeNull();
  fireEvent.click(toldPill()!);
  expect(visits().map((d) => d.moment?.day)).toEqual([2, 3]);
});

it("a drunk or poisoned real Savant keeps the row; no row for a Drunk shown the Savant, a dead Savant, at night or in Privacy Mode", () => {
  open(impair(proofGame(ROLES, "day", 2), "p0", "drunk"));
  openDay();
  expect(toldPill()).toBeInTheDocument();
  reopen();
  for (const g of [patchPlayer(proofGame(ROLES, "day", 2), "p0", { actualRole: "drunk", shownRole: "savant" }), patchPlayer(proofGame(ROLES, "day", 2), "p0", { alive: false })]) {
    open(g);
    openDay();
    expect(toldPill()).toBeNull();
    expect(toldDone()).toBeNull();
    reopen();
  }
  open(proofGame(ROLES, "night", 2));
  expect(toldPill()).toBeNull();
  reopen();
  open(proofGame(ROLES, "day", 2));
  openDay();
  act(() => { usePrivacyStore.setState({ enabled: true }); });
  expect(toldPill()).toBeNull();
});

it("a working Vortox: both private-visit rows carry the 'Vortox · false info' pill", () => {
  open(proofGame(["savant", "vortox", "chef", "artist", "saint"], "day", 2));
  openDay();
  expect(screen.getAllByText("· false info", { exact: false })).toHaveLength(2);
});
