// SV-5f: the Juggler's first-Day guesses on the Day card (Guess and Done; each guess recorded at once; Undo only; nothing typed).
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { GrimoireV6Screen } from "../GrimoireV6Screen";
import { useV6Ui } from "../v6Store";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { impair, patchPlayer, proofGame, proofRegistry, proofScript } from "@/test/proofFixtures";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { JUGGLER_DONE, JUGGLER_GUESS } from "@/abilities/characters/juggler";
import { createRulesQuery } from "@/stores/rulesQuery";
import { useV6Ctx } from "../ctx";
import { playerMarks } from "../board/marks";
import type { StorytellerLobbyRecord } from "@/stores/types";

// p0 juggler, p1 fanggu, p2 clockmaker, p3 spy, p4 savant, p5 artist
const ROLES = ["juggler", "fanggu", "clockmaker", "spy", "savant", "artist"];
const game = () => store.getState().game!;
const badge = () => screen.queryByLabelText("A Day action is waiting");
function open(g: StorytellerLobbyRecord) {
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  render(<VotingProvider><GrimoireV6Screen /></VotingProvider>);
}
const openDay = () => { fireEvent.click(screen.getByRole("button", { name: /^Day$/i })); expect(screen.getByText("No one is on the block")).toBeInTheDocument(); };
const reopen = () => { cleanup(); useV6Ui.getState().reset(); };
const row = () => screen.queryByRole("group", { name: "Juggler, Player 0: the guesses" });
const guessPill = () => screen.queryByRole("button", { name: "Guess" });
const donePill = () => screen.queryByRole("button", { name: "Done" });
const doneMark = () => document.querySelector('[data-day-visit="done"]');
const records = (type = JUGGLER_GUESS) => game().players.p0!.effects.filter((e) => e.type === type);
const toast = () => useV6Ui.getState().toast;
/** The discs drawn around a seat (board/marks.ts), as the board draws them. */
const marks = (id: string) => renderHook(() => {
  const g = store((st) => st.game)!;
  const ctx = useV6Ctx(g);
  return playerMarks({ game: g, script: ctx.script, registry: ctx.registry, query: createRulesQuery(g, { script: ctx.script!, registry: ctx.registry }) }, g.players[id]!).map((m) => m.title);
}, { wrapper: ({ children }: { children: ReactNode }) => <VotingProvider>{children}</VotingProvider> }).result.current;
/** Guess: tap the player on the board, then pick the character. */
function guess(who: string, roleId: string) {
  fireEvent.click(guessPill()!);
  expect(useTargetPicker.getState().active?.label).toBe("the Juggler's guess");
  act(() => { pickSeatIfPicking(game(), who); });
  const picker = useV6Ui.getState().picker;
  expect(picker).toMatchObject({ mode: "show", tokensOnly: true, title: "What does the Juggler guess?", hint: expect.stringMatching(/recorded at once/) });
  act(() => { if (picker?.mode === "show") picker.onPick?.(roleId); });
}

beforeEach(() => {
  vi.useFakeTimers();
  useSessionRuntime.setState({ backend: null });
  useShellStore.getState().reset();
  useV6Ui.getState().reset();
  usePrivacyStore.setState({ enabled: false });
  useTargetPicker.getState().cancel();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("on the Juggler's first Day: a row 'Guesses 0 of 5' with Guess and Done, beside the Artist and Savant, and no Day '!'", () => {
  open(proofGame(ROLES, "day", 1));
  expect(badge()).toBeNull();
  openDay();
  expect(screen.getByText("Player 0 · Guesses 0 of 5")).toBeInTheDocument();
  expect(row()).toBeInTheDocument();
  expect(guessPill()).toBeInTheDocument();
  expect(donePill()).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Artist, Player 5: the answer you whispered" })).toBeInTheDocument();
});

it("a guess is recorded at once, judged now, with the CORRECT token only for a correct one; the toast never says which; one Undo each", () => {
  open(proofGame(ROLES, "day", 1));
  openDay();
  guess("p2", "clockmaker");
  expect(records()).toEqual([expect.objectContaining({ sourceCharacter: "juggler", lifetime: { kind: "untilDawn" }, appliedAt: { phase: "day", day: 1 },
    parameters: expect.objectContaining({ character: { kind: "role", roleIds: ["clockmaker"] }, correct: { kind: "boolean", value: true } }) })]);
  expect(toast()).toBe("Guess 1 of 5 recorded.");
  expect(store.getState().undoStack).toHaveLength(1);
  expect(screen.getByText("Player 0 · Guesses 1 of 5")).toBeInTheDocument();
  guess("p1", "nodashii");
  expect(records().map((e) => e.parameters?.correct)).toEqual([{ kind: "boolean", value: true }, { kind: "boolean", value: false }]);
  expect(toast()).toBe("Guess 2 of 5 recorded.");
  // One CORRECT disc on the Juggler's seat (the incorrect guess draws nothing).
  expect(marks("p0")).toEqual(["Juggler: Correct"]);
  expect(marks("p2")).toEqual([]);
  expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
  expect(badge()).toBeNull();
  act(() => { store.getState().undo(); });
  expect(records()).toHaveLength(1);
  expect(screen.getByText("Player 0 · Guesses 1 of 5")).toBeInTheDocument();
});

it("repeats are allowed (same player, same character); a sixth guess is refused", () => {
  open(proofGame(ROLES, "day", 1));
  openDay();
  guess("p2", "clockmaker");
  guess("p2", "dreamer");
  guess("p4", "clockmaker");
  guess("p4", "savant");
  guess("p0", "juggler");
  expect(records()).toHaveLength(5);
  expect(marks("p0")).toEqual(["Juggler: Correct ×3"]);
  fireEvent.click(guessPill()!);
  expect(useTargetPicker.getState().active).toBeNull();
  expect(toast()).toBe("Player 0 has made 5 guesses: no more.");
  expect(records()).toHaveLength(5);
});

it("Done closes the guesses (zero allowed): the Completed pill, no Guess; Undo reopens", () => {
  open(proofGame(ROLES, "day", 1));
  openDay();
  fireEvent.click(donePill()!);
  expect(records(JUGGLER_DONE)).toHaveLength(1);
  expect(doneMark()).toHaveTextContent("Done");
  expect(guessPill()).toBeNull();
  expect(screen.getByText("Player 0 · Guesses 0 of 5")).toBeInTheDocument();
  act(() => { store.getState().undo(); });
  expect(records(JUGGLER_DONE)).toHaveLength(0);
  expect(guessPill()).toBeInTheDocument();
});

it("a healthy Spy guessed as a Townsfolk: one Yes / No ruling decides; dismissing records nothing", async () => {
  open(proofGame(ROLES, "day", 1));
  openDay();
  guess("p3", "chef");
  expect(useV6Ui.getState().ask).toMatchObject({ title: "Does Player 3 register as the Chef?", okText: "Yes", alt: { text: "No" } });
  expect(records()).toHaveLength(0);
  await act(async () => { useV6Ui.getState().ask!.run(""); useV6Ui.getState().set({ ask: null }); await Promise.resolve(); });
  expect(records().map((e) => e.parameters?.correct)).toEqual([{ kind: "boolean", value: true }]);
  guess("p3", "spy");
  await act(async () => { useV6Ui.getState().ask!.alt!.run(); useV6Ui.getState().set({ ask: null }); await Promise.resolve(); });
  expect(records().map((e) => e.parameters?.correct)).toEqual([{ kind: "boolean", value: true }, { kind: "boolean", value: false }]);
  guess("p3", "chef");
  await act(async () => { useV6Ui.getState().ask!.cancel!(); useV6Ui.getState().set({ ask: null }); await Promise.resolve(); });
  expect(records()).toHaveLength(2);
  expect(toast()).toBe("Nothing was recorded.");
  // A Spy guessed as a Demon cannot register so: no question, incorrect.
  guess("p3", "imp");
  expect(useV6Ui.getState().ask).toBeNull();
  expect(records().at(-1)!.parameters?.correct).toEqual({ kind: "boolean", value: false });
});

it("a drunk real Juggler still guesses; no row for a Drunk shown the Juggler, a dead Juggler, a later Day, the Night, or Privacy Mode", () => {
  open(impair(proofGame(ROLES, "day", 1), "p0", "drunk"));
  openDay();
  expect(row()).toBeInTheDocument();
  reopen();
  for (const g of [patchPlayer(proofGame(ROLES, "day", 1), "p0", { actualRole: "drunk", shownRole: "juggler" }), patchPlayer(proofGame(ROLES, "day", 1), "p0", { alive: false }),
    proofGame(ROLES, "day", 2)]) {
    open(g);
    openDay();
    expect(row()).toBeNull();
    reopen();
  }
  // A Juggler made on Night 3 (a Pit-Hag, a Barber swap): Day 3 is their first Day.
  open(patchPlayer(proofGame(ROLES, "day", 3), "p0", { characterSince: { phase: "night", day: 3 } }));
  openDay();
  expect(row()).toBeInTheDocument();
  reopen();
  open(proofGame(ROLES, "night", 2));
  expect(guessPill()).toBeNull();
  reopen();
  open(proofGame(ROLES, "day", 1));
  openDay();
  guess("p2", "clockmaker");
  // The board draws the CORRECT disc on the Juggler's seat (its label counts it), and Privacy Mode hides it with the row.
  expect(screen.getByLabelText(/^Seat 1, Player 0, Juggler, 1 reminder$/)).toBeInTheDocument();
  act(() => { usePrivacyStore.setState({ enabled: true }); });
  expect(row()).toBeNull();
  expect(screen.queryByLabelText(/^Seat 1, Player 0.*reminder/)).toBeNull();
});

it("never reaches a player's or the public projection", () => {
  open(proofGame(ROLES, "day", 1));
  openDay();
  guess("p2", "clockmaker");
  fireEvent.click(donePill()!);
  const g = { ...game(), code: "ABCD" };
  const out = JSON.stringify([projectLobbyToPublic(g, {}, undefined, proofScript), projectLobbyToSelfMap(g, proofRegistry)]);
  expect(out).not.toMatch(/jugglerGuess|jugglerGuessesDone|Correct/);
});

it("a working Vortox: the row carries the 'Vortox · false info' pill", () => {
  open(proofGame(["juggler", "vortox", "clockmaker", "chef", "savant", "artist"], "day", 1));
  openDay();
  expect(screen.getAllByText("· false info", { exact: false })).toHaveLength(3);
});

it("end to end: guesses made on Day 1 survive a reload, Night 2 counts them, and the records are gone by Day 2's dawn", async () => {
  open(proofGame(ROLES, "day", 1));
  openDay();
  guess("p2", "clockmaker");
  guess("p4", "clockmaker");
  // Reload mid-guesses: the saved game round-trips through the persisted schema with the records intact.
  const saved = StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(game())));
  reopen();
  open(saved as StorytellerLobbyRecord);
  openDay();
  expect(screen.getByText("Player 0 · Guesses 2 of 5")).toBeInTheDocument();
  guess("p5", "artist");
  fireEvent.click(donePill()!);
  reopen();
  expect(store.getState().advancePhase()).toMatchObject({ ok: true });
  expect(game()).toMatchObject({ phase: "night", day: 2 });
  const { CANONICAL_ABILITY_SEMANTICS } = await import("@/abilities/semantics");
  const { planAbilityResolution, captureFingerprint } = await import("@/stores/abilityResolution");
  const { buildRegistry } = await import("@/data/roleRegistry");
  const plan = planAbilityResolution(game(), { mode: "guided", invocationPath: "nightOrder", fingerprint: captureFingerprint(game(), "p0")!, roleId: "juggler", inputs: {} },
    { script: proofScript, registry: buildRegistry(proofScript), semantics: CANONICAL_ABILITY_SEMANTICS });
  expect(plan.ok && plan.changed ? plan.plan.game.informationDeliveries.at(-1)?.values : plan).toEqual([{ requirementId: "correct", kind: "number", value: 2 }]);
  // Nobody acted on them tonight: they expire as the Night ends.
  expect(store.getState().advancePhase()).toMatchObject({ ok: true });
  expect(game()).toMatchObject({ phase: "day", day: 2 });
  expect(records()).toEqual([]);
  expect(records(JUGGLER_DONE)).toEqual([]);
});
