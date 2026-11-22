// SV-5l: the Vortox's "Each day, if no-one is executed, evil wins" (https://wiki.bloodontheclocktower.com/Vortox), captured at the
// Day-to-Night boundary and shown as one advisory line on the End control. It records no winner and ends nothing: the Storyteller
// confirms and declares. Every execution counts, whatever its outcome; an exile does not.
import { beforeEach, describe, expect, it } from "vitest";
import { homebrewEnv, impair, openInStore, patchPlayer, proofEnv, proofGame } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { captureVortoxNoExecution } from "./victoryEvidence";
import { endGameEligibility, vortoxAdvisory, VORTOX_NO_EXECUTION_LINE, VORTOX_NO_EXECUTION_RULING_LINE } from "./endGameEligibility";
import { VORTOX_DUSK_RULING, VORTOX_WORKING_AT_DUSK } from "./gameRuleFactRegistry";
import { planGameRuleFactTransaction } from "./gameRuleFacts";
import { StorytellerGamePersistedSchema } from "./schemas";
import { participantRefOf } from "./participants";
import { endHint } from "@/features/grimoire-v6/vm/chrome";
import type { V6Ctx } from "@/features/grimoire-v6/ctx";
import type { CurrentParticipantRef, ExecutionOutcome, StorytellerLobbyRecord } from "./types";

const env = proofEnv();
const state = () => store.getState();
const game = () => state().game!;
// p0 Vortox, p1 Chef, p2 Empath, p3 Oracle, p4 Saint, p5 Mutant.
const ROLES = ["vortox", "chef", "empath", "oracle", "saint", "mutant"];
const day = (roles = ROLES) => proofGame(roles, "day", 2);
const advance = () => { const result = state().advancePhase(); expect(result).toMatchObject({ ok: true }); return game(); };
const facts = () => game().gameRuleFacts.map((fact) => fact.type);
const executed = (g: StorytellerLobbyRecord, id: string, outcome: ExecutionOutcome, extra: object = {}): StorytellerLobbyRecord => ({
  ...g, lifeEventWindow: { ...g.lifeEventWindow, events: [...g.lifeEventWindow.events, {
    id: `x-${id}`, kind: "execution", subject: participantRefOf(g, id) as CurrentParticipantRef, actualRoleAtEvent: g.players[id]!.actualRole,
    moment: { phase: "day", day: g.day }, outcome, ...extra }] } });
const ctx = (g: StorytellerLobbyRecord, privacy = false) => ({ game: g, script: env.script, registry: env.registry, privacy }) as unknown as V6Ctx;

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
  usePrivacyStore.getState().reset();
  useSessionRuntime.setState({ backend: null, status: "idle" });
});

describe("SV-5l: the Day-to-Night capture", () => {
  it("no execution and a living, sober and healthy Vortox: the fact names the Vortox and the Day, and the line shows that Night", () => {
    openInStore(day());
    const night = advance();
    expect(night).toMatchObject({ phase: "night", day: 3 });
    expect(night.gameRuleFacts).toEqual([expect.objectContaining({ type: VORTOX_WORKING_AT_DUSK, recordedAt: { phase: "day", day: 2 }, expiresAt: { phase: "day", day: 3 },
      provenance: expect.objectContaining({ sourceCharacter: "vortox", sourceParticipant: expect.objectContaining({ playerId: "p0" }) }) })]);
    expect(vortoxAdvisory(night)).toBe(VORTOX_NO_EXECUTION_LINE);
    expect(endHint(ctx(night))).toBe(VORTOX_NO_EXECUTION_LINE);
  });

  it("nothing ends: no winner is recorded and the game stays live until the Storyteller ends it", () => {
    openInStore(day());
    const night = advance();
    expect(night.phase).toBe("night");
    expect(night.result).toBeUndefined();
    expect(endGameEligibility(night, env)).not.toMatchObject({ kind: "verified" });
  });

  it.each(["died", "survived", "alreadyDead"] as const)("an execution that %s counts: no line (the Vortox's state at dusk is still recorded)", (outcome) => {
    openInStore(executed(day(), "p1", outcome));
    advance();
    expect(facts()).toEqual([VORTOX_WORKING_AT_DUSK]);
    expect(vortoxAdvisory(game())).toBeNull();
  });

  it("the Mutant's execution counts, and so does an execution by an ability (the same execution record, with its resolution)", () => {
    openInStore(executed(day(), "p5", "died"));
    advance();
    expect(vortoxAdvisory(game())).toBeNull();
    openInStore(executed(day(), "p4", "survived", { resolutionId: "ability-resolution" }));
    advance();
    expect(vortoxAdvisory(game())).toBeNull();
  });

  it("an execution recorded through the Execute command counts", () => {
    openInStore(day());
    expect(state().recordExecution("p1", "died")).toMatchObject({ ok: true });
    advance();
    expect(vortoxAdvisory(game())).toBeNull();
  });

  it("an exile is not an execution", () => {
    openInStore(patchPlayer(day([...ROLES, "scapegoat"]), "p6", { isTraveler: true }));
    state().exileTraveler("p6");
    expect(game().lifeEventWindow.events.at(-1)).toMatchObject({ kind: "exile" });
    advance();
    expect(facts()).toEqual([VORTOX_WORKING_AT_DUSK]);
    expect(vortoxAdvisory(game())).toBe(VORTOX_NO_EXECUTION_LINE);
  });

  it("two Vortoxes: any one alive, sober and healthy at dusk is enough", () => {
    openInStore(impair(day(["vortox", "chef", "empath", "vortox", "saint", "mutant"]), "p0"));
    advance();
    expect(game().gameRuleFacts).toEqual([expect.objectContaining({ type: VORTOX_WORKING_AT_DUSK, provenance: expect.objectContaining({ sourceParticipant: expect.objectContaining({ playerId: "p3" }) }) })]);
    expect(vortoxAdvisory(game())).toBe(VORTOX_NO_EXECUTION_LINE);
  });

  it.each([
    ["dead", (g: StorytellerLobbyRecord) => patchPlayer(g, "p0", { alive: false })],
    ["drunk", (g: StorytellerLobbyRecord) => impair(g, "p0", "drunk")],
    ["poisoned", (g: StorytellerLobbyRecord) => impair(g, "p0")],
    ["not in play (another Demon)", () => proofGame(["imp", "chef", "empath", "oracle", "saint"], "day", 2)],
  ])("a %s Vortox: no fact, no line", (_name, change) => {
    openInStore(change(day()));
    advance();
    expect(facts()).toEqual([]);
    expect(vortoxAdvisory(game())).toBeNull();
  });

  it("poison that ends at dusk is read at the end of the Day, before it expires", () => {
    // The effect expires on entering the Night: the Vortox was still poisoned when the Day ended.
    const poisoned = impair(day(), "p0");
    const effect = poisoned.players.p0!.effects[0]!;
    openInStore(patchPlayer(poisoned, "p0", { effects: [{ ...effect, expiry: { kind: "at", moment: { phase: "night", day: 3 } } } as never] }));
    const night = advance();
    expect(night.players.p0!.effects).toEqual([]);
    expect(facts()).toEqual([]);
  });

  it("a Vortox whose ability is in doubt, or a Day without a complete execution record, is the Storyteller's ruling", () => {
    openInStore(impair(day(), "p0", "soberHealthy"));
    advance();
    expect(facts()).toEqual([VORTOX_DUSK_RULING]);
    expect(vortoxAdvisory(game())).toBe(VORTOX_NO_EXECUTION_RULING_LINE);
    // The Day's execution record does not cover Day 2 (an older save): the working Vortox is recorded, the line is a ruling.
    const g: StorytellerLobbyRecord = { ...day(), lifeEventWindow: { coverageFrom: { phase: "night", day: 3 }, events: [] } };
    const result = captureVortoxNoExecution(g, { ...g, phase: "night", day: 3 }, env);
    expect(result.ok && result.game.gameRuleFacts.map((fact) => fact.type)).toEqual([VORTOX_WORKING_AT_DUSK]);
    expect(result.ok && vortoxAdvisory(result.game)).toBe(VORTOX_NO_EXECUTION_RULING_LINE);
  });

  it("a homebrew character reusing the Vortox id brings no rule", () => {
    const g = day();
    const result = captureVortoxNoExecution(g, { ...g, phase: "night", day: 3 }, homebrewEnv("vortox"));
    expect(result.ok && result.game.gameRuleFacts).toEqual([]);
  });

  it("only the exact Day-to-Night boundary captures (never Night-to-Day, never mid-Day)", () => {
    const g = day();
    for (const after of [g, { ...g, phase: "night" as const, day: 4 }]) {
      const result = captureVortoxNoExecution(g, after, env);
      expect(result.ok && result.game.gameRuleFacts).toEqual([]);
    }
    openInStore(proofGame(ROLES, "night", 2));
    advance();
    expect(facts()).toEqual([]);
  });

  it("the fact cannot be applied by hand: only the boundary captures it", () => {
    const result = planGameRuleFactTransaction(day(), { intents: [{ kind: "apply", type: VORTOX_WORKING_AT_DUSK }] });
    expect(result).toMatchObject({ ok: false });
  });
});

describe("SV-5l: the line's lifetime", () => {
  it("Undo of the advance removes the fact and the line with everything else", () => {
    openInStore(day());
    advance();
    expect(facts()).toEqual([VORTOX_WORKING_AT_DUSK]);
    state().undo();
    expect(game()).toMatchObject({ phase: "day", day: 2, gameRuleFacts: [] });
    expect(vortoxAdvisory(game())).toBeNull();
  });

  it("a reload keeps it: the saved game passes the persisted schema and the line still shows", () => {
    openInStore(day());
    const night = advance();
    const reloaded = JSON.parse(JSON.stringify(night));
    expect(StorytellerGamePersistedSchema.safeParse(reloaded).success).toBe(true);
    expect(vortoxAdvisory(reloaded)).toBe(VORTOX_NO_EXECUTION_LINE);
  });

  it("an execution recorded late for that Day takes the line away", () => {
    openInStore(day());
    advance();
    expect(state().lateRecordLifeEvent({ kind: "execution", outcome: "survived", playerId: "p1" }).ok).toBe(true);
    expect(vortoxAdvisory(game())).toBeNull();
  });

  it("independent check: a retracted execution brings the line back (executions are read live from the record)", () => {
    openInStore(day());
    expect(state().recordExecution("p1", "survived")).toMatchObject({ ok: true });
    const eventId = game().lifeEventWindow.events.at(-1)!.id;
    advance();
    expect(vortoxAdvisory(game())).toBeNull();
    expect(state().retractLifeEvent(eventId).ok).toBe(true);
    expect(vortoxAdvisory(game())).toBe(VORTOX_NO_EXECUTION_LINE);
  });

  it("what happens to the Vortox after dusk does not matter (the ending was at dusk): killed, poisoned or changed that Night, the line stays", () => {
    openInStore(day());
    const night = advance();
    for (const later of [patchPlayer(night, "p0", { alive: false }), impair(night, "p0"), patchPlayer(night, "p0", { actualRole: "imp" })])
      expect(vortoxAdvisory(later)).toBe(VORTOX_NO_EXECUTION_LINE);
  });

  it("the line shows only through that Night; the fact expires on entering the next Day", () => {
    openInStore(day());
    advance();
    advance();
    expect(game()).toMatchObject({ phase: "day", day: 3 });
    expect(facts()).toEqual([]);
    expect(vortoxAdvisory(game())).toBeNull();
  });

  it("Privacy Mode hides it from the End control", () => {
    openInStore(day());
    const night = advance();
    expect(endHint(ctx(night, true))).toBe("");
  });

  it("shows on a script with characters not on the game-ending list (the line does not wait for it)", () => {
    // The Vortox, the Oracle and the Mutant are not on the reviewed game-ending list: no verified ending is proposed, yet the line shows.
    openInStore(day());
    const night = advance();
    expect(endGameEligibility(night, env)).toMatchObject({ kind: "unknown" });
    expect(endHint(ctx(night))).toBe(VORTOX_NO_EXECUTION_LINE);
  });
});
