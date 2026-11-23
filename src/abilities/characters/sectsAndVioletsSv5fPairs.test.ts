// SV-5 part 2b (the Juggler): the pairs of docs/ai/SECTS_AND_VIOLETS_SV5F_PAIRS.md that the focused files (juggler.test.ts,
// jugglerDay.test.tsx, jugglerUi.v6.test.tsx) do not name.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PHILOSOPHER_CHARACTER } from "./philosopher";
import { JUGGLER_COMMUNICATED, JUGGLER_DONE, JUGGLER_GUESS, jugglerGuessVerdict, jugglerTally } from "./juggler";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { useV6Ctx } from "@/features/grimoire-v6/ctx";
import { useV6Ui } from "@/features/grimoire-v6/v6Store";
import { dayActionRows, dayVisitRows } from "@/features/grimoire-v6/day/dayCard";
import { jugglerMayGuess } from "@/features/grimoire-v6/day/juggler";
import { changeRoleIntent } from "@/stores/roleResolution";
import { bind, num, openInStore, patchPlayer, plan, planned, proofGame, proofQuery, request } from "@/test/proofFixtures";
import { withGuesses } from "@/test/jugglerFixtures";
import type { AbilityInputValue } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";

const ctxOf = (g: StorytellerLobbyRecord) => { openInStore(g); return renderHook(() => useV6Ctx(store.getState().game!)).result.current; };
const character = (roleId: string): AbilityInputValue => ({ kind: "character", roleIds: [roleId] });
const rowKeys = (g: StorytellerLobbyRecord) => dayVisitRows(ctxOf(g)).map((row) => row.key);
/** Character changes through the store's own Role command (as a Pit-Hag, a Barber or a Fang Gu jump records them). */
function changeRoles(g: StorytellerLobbyRecord, changes: [string, string][]): StorytellerLobbyRecord {
  openInStore(g);
  const result = store.getState().resolveRoles({ intents: changes.map(([id, role]) => changeRoleIntent(store.getState().game!.players[id]!, role)) });
  if (!result.ok) throw new Error(result.message);
  return store.getState().game!;
}
const records = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.effects.filter((effect) => effect.type === JUGGLER_GUESS || effect.type === JUGGLER_DONE);
const night = (g: StorytellerLobbyRecord, inputs = {}) => plan(g, request(g, "p0", "juggler", inputs));

beforeEach(() => { useShellStore.getState().resetGameScope(); usePrivacyStore.getState().setEnabled(false); useV6Ui.getState().reset(); });

describe("SV-5f pairs: the Juggler's Day row beside the other private visits", () => {
  it("Juggler / Savant / Artist: three optional rows in seat order, none a Day action that raises the '!'", () => {
    const g = proofGame(["savant", "imp", "juggler", "artist", "chef"], "day", 1);
    expect(rowKeys(g)).toEqual(["savant:p0", "juggler:p2", "artist:p3"]);
    expect(dayActionRows(ctxOf(g))).toEqual([]);
  });
});

describe("SV-5f pairs: characters that change who is the Juggler", () => {
  it("Philosopher / Juggler: a Philosopher who gained it gets no row and its Night step stays by hand; the real Juggler, now drunk, is the Storyteller's number", () => {
    const g0 = proofGame(["philosopher", "imp", "juggler", "chef", "witch"], "night", 1);
    const chose = planned(plan(g0, request(g0, "p0", "philosopher", { [PHILOSOPHER_CHARACTER]: character("juggler") }, { withStep: true, completeStep: true })));
    const day = { ...chose, phase: "day" as const };
    const ctx = ctxOf(day);
    expect(jugglerMayGuess(ctx, day, day.players.p0)).toBe(false);
    expect(rowKeys(day)).toEqual(["juggler:p2"]);
    // Night 2: the gained Juggler's step is refused as the Philosopher's (by hand, SV-3b).
    const n2 = withGuesses({ ...chose, phase: "night", day: 2 }, "p2", [{ who: "p3", role: "chef", correct: true }]);
    expect(plan(n2, request(n2, "p0", "juggler", {}, { withStep: true }))).toMatchObject({ ok: false, code: "invalid" });
    // The real Juggler is drunk while the Philosopher has its ability: the Storyteller chooses.
    expect(proofQuery(n2).abilityFunctions(bind(n2, "p2"))).toEqual({ known: true, value: false });
    const real = plan(n2, request(n2, "p2", "juggler"));
    expect(real).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: JUGGLER_COMMUNICATED }] });
    // Guessed: a Philosopher is the Philosopher, whatever it gained.
    expect(jugglerGuessVerdict(proofQuery(day), bind(day, "p0"), "juggler")).toEqual({ kind: "known", correct: false });
    expect(jugglerGuessVerdict(proofQuery(day), bind(day, "p0"), "philosopher")).toEqual({ kind: "known", correct: true });
  });

  it.each([["Barber"], ["Pit-Hag"]])("%s / Juggler: a Juggler changed before their Night loses the guesses; whoever becomes the Juggler has a fresh first Day", () => {
    const g = withGuesses(proofGame(["juggler", "pithag", "chef", "imp", "barber"], "night", 2), "p0", [{ who: "p2", role: "chef", correct: true }]);
    const next = changeRoles(g, [["p0", "chef"], ["p2", "juggler"]]);
    expect(records(next, "p0")).toEqual([]);
    expect(next.players.p2!.characterSince).toEqual({ phase: "night", day: 2 });
    // Day 2 is the new Juggler's first Day.
    const day2 = { ...next, phase: "day" as const };
    expect(rowKeys(day2)).toEqual(["juggler:p2"]);
  });

  it("Fang Gu / Juggler: a guess is frozen when made; the guessed Outsider becoming the Fang Gu tonight does not change the count", () => {
    const g = withGuesses(proofGame(["juggler", "fanggu", "mutant", "chef", "witch"], "night", 2), "p0", [{ who: "p2", role: "mutant", correct: true }]);
    const jumped = changeRoles(g, [["p2", "fanggu"]]);
    expect(jugglerTally(jumped.players.p0!, 1).correct).toBe(1);
    const told = planned(night(jumped));
    expect(told.informationDeliveries.at(-1)!.values).toEqual([{ requirementId: "correct", kind: "number", value: 1 }]);
  });

  it("Snake Charmer / Juggler: guessing a Snake Charmer who became the Demon on Night 1 is judged by their character now", () => {
    const g = patchPlayer(proofGame(["juggler", "snakecharmer", "chef", "witch"], "day", 1), "p1", { actualRole: "fanggu", actualAlignment: "evil" });
    expect(jugglerGuessVerdict(proofQuery(g), bind(g, "p1"), "snakecharmer")).toEqual({ kind: "known", correct: false });
    expect(jugglerGuessVerdict(proofQuery(g), bind(g, "p1"), "fanggu")).toEqual({ kind: "known", correct: true });
  });
});

describe("SV-5f pairs: impairment tonight", () => {
  it("No Dashii / Juggler: a Juggler beside the No Dashii is poisoned tonight, so the Storyteller chooses; the records stay until dawn", () => {
    const g = withGuesses(proofGame(["juggler", "nodashii", "chef", "witch", "monk"], "night", 2), "p0", [{ who: "p2", role: "chef", correct: true }]);
    expect(proofQuery(g).abilityFunctions(bind(g, "p0"))).toEqual({ known: true, value: false });
    expect(night(g)).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: JUGGLER_COMMUNICATED }] });
    expect(records(planned(night(g, { [JUGGLER_COMMUNICATED]: num(0) })), "p0")).toHaveLength(2);
  });

  it("Sweetheart / Juggler: a Juggler the dead Sweetheart made drunk is the Storyteller's number", () => {
    let g = withGuesses(proofGame(["juggler", "sweetheart", "chef", "fanggu", "witch"], "night", 2), "p0", []);
    g = patchPlayer(g, "p0", { effects: [...g.players.p0!.effects, { id: "fx-sw", type: "drunk", sourceCharacter: "sweetheart",
      sourceParticipant: { kind: "participant", participantId: g.players.p1!.participantId!, playerId: "p1", nameAtTime: "Player 1" },
      lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } }] });
    g = patchPlayer(g, "p1", { alive: false });
    expect(night(g)).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: JUGGLER_COMMUNICATED }] });
  });

  it("Mathematician / Juggler: the Mathematician is not built yet; a Juggler who gets the Storyteller's number reads nothing of it", () => {
    const g = withGuesses(proofGame(["juggler", "mathematician", "chef", "fanggu", "witch"], "night", 2), "p0", [{ who: "p1", role: "mathematician", correct: true }]);
    expect(planned(night(g)).informationDeliveries.at(-1)!.values).toEqual([{ requirementId: "correct", kind: "number", value: 1 }]);
  });
});
