// Phase 10G, Slice 2: the two explicitly deferred 10F consumers (PHASE10G
// Sections 8-11). Traceability: 10G-AC-08..14, 10G-AC-48; proof areas 3-5.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { activeModifiers } from "@/abilities/modifiers";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { PIT_HAG_ARBITRARY_DEATHS, TOYMAKER_DEMON_SKIP_OCCURRED, toymakerSkipStatus } from "@/stores/gameRuleFacts";
import { composeAbilityOutcome, MECHANICAL_DOMAINS } from "@/stores/abilityResolution";
import { changeRoleIntent } from "@/stores/roleResolution";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { stripCommentsForGuard as stripComments } from "@/test/writerGuard";
import { bind, impair, openInStore, patchPlayer, pick, plan, planned, proofEnv, proofGame, proofQuery, proofRegistry, request, requirementIds, yes } from "@/test/proofFixtures";
import { arbitraryDeathJudgmentId, deathAttempt } from "./shared";
import { choiceId } from "./alhadikhia";
import { TOYMAKER_ATTACK_MESSAGE } from "./modifierHooks";
import type { AbilityInputValue } from "@/abilities/semantics";
import type { GameRuleFactRecord, StorytellerLobbyRecord } from "@/stores/types";

const state = () => store.getState();
const game = () => state().game!;
const character = (roleId: string): AbilityInputValue => ({ kind: "character", roleIds: [roleId] });
// p0 pithag, p1 chef, p2 imp, p3 monk, p4 empath, p5 saint, p6 washerwoman
const ROLES = ["pithag", "chef", "imp", "monk", "empath", "saint", "washerwoman"];
const hagRequest = (g: StorytellerLobbyRecord, target: string, roleId: string) =>
  request(g, "p0", "pithag", { target: pick(g, target), character: character(roleId) });
const arbitrary = (g: StorytellerLobbyRecord): StorytellerLobbyRecord => ({ ...g, gameRuleFacts: [
  { type: PIT_HAG_ARBITRARY_DEATHS, recordedAt: { phase: "night", day: g.day }, expiresAt: { phase: "day", day: g.day } } as GameRuleFactRecord] });

beforeEach(() => store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0 }));

describe("10G-AC-08: GameRuleFact composes inside the one coordinator", () => {
  it("is a mechanical domain: multi-domain outcomes must declare order", () => {
    expect(MECHANICAL_DOMAINS).toContain("gameRuleFact");
    const g = proofGame(ROLES);
    const result = composeAbilityOutcome(g, { operations: [
      { domain: "role", intents: [changeRoleIntent(g.players.p1!, "vigormortis")] },
      { domain: "gameRuleFact", intents: [{ kind: "apply", type: PIT_HAG_ARBITRARY_DEATHS }] },
    ] }, proofEnv(), { resolutionId: "r-1" });
    expect(result).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("the fact is planned against the evolving working snapshot and correlated with the resolution", () => {
    const g = proofGame(ROLES);
    const result = composeAbilityOutcome(g, { mechanicalOrder: "declared", operations: [
      { domain: "role", intents: [changeRoleIntent(g.players.p1!, "vigormortis")] },
      { domain: "gameRuleFact", intents: [{ kind: "apply", type: PIT_HAG_ARBITRARY_DEATHS }] },
    ] }, proofEnv(), { resolutionId: "r-1" });
    const next = planned(result);
    expect(next.gameRuleFacts[0]).toMatchObject({ type: PIT_HAG_ARBITRARY_DEATHS, resolutionId: "r-1" });
    expect(next.history.map((h) => [h.category, h.resolutionId])).toEqual([["role", "r-1"], ["gameRuleFact", "r-1"]]);
    expect(result.ok && result.changed && result.plan.needsConfirmation).toBe(true);
  });

  it("a simulated wake or a non-functioning ability can never create a fact", () => {
    const g = proofGame(ROLES);
    expect(composeAbilityOutcome(g, { operations: [{ domain: "gameRuleFact", intents: [{ kind: "apply", type: PIT_HAG_ARBITRARY_DEATHS }] }] },
      proofEnv(), { resolutionId: "r", simulated: { performedRole: "pithag" } })).toMatchObject({ ok: false, code: "illegal" });
    const impaired = impair(g, "p0");
    expect(plan(impaired, hagRequest(impaired, "p1", "vigormortis"))).toEqual({ ok: true, changed: false });
  });
});

describe("10G-AC-09: Pit-Hag Demon creation is atomic (proof area 3)", () => {
  it("a functioning Pit-Hag making a Demon: Role change (Alignment preserved, player told) + arbitrary-deaths fact, one commit", () => {
    const g = proofGame(ROLES);
    openInStore(g);
    const result = state().resolveAbility(hagRequest(g, "p1", "vigormortis"));
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(state().undoStack).toHaveLength(1);
    expect(state().localSeq).toBe(6);
    expect(game().players.p1).toMatchObject({ actualRole: "vigormortis", shownRole: "vigormortis", actualAlignment: "good" });
    expect(game().gameRuleFacts).toEqual([expect.objectContaining({ type: PIT_HAG_ARBITRARY_DEATHS, recordedAt: { phase: "night", day: 2 }, expiresAt: { phase: "day", day: 2 } })]);
    const resolutionId = (result as { resolutionId: string }).resolutionId;
    expect(game().history.map((h) => [h.category, h.resolutionId])).toEqual([["role", resolutionId], ["gameRuleFact", resolutionId]]);
    expect(game().history[1]).not.toHaveProperty("participant");
    state().undo();
    expect(game()).toEqual(g);
  });

  it("if the Rule-Fact operation refuses, the Role change is not committed either", () => {
    // The same ordered Role + Rule Fact shape, where the fact cannot be applied
    // (an unregistered type / Day for a Night-only fact): neither commits.
    for (const [phase, type] of [["night", "homebrewCurse"], ["day", PIT_HAG_ARBITRARY_DEATHS]] as const) {
      const g = proofGame(ROLES, phase, 2);
      openInStore(g);
      const before = { game: game(), undo: state().undoStack, seq: state().localSeq };
      const result = state().resolveAbility({ mode: "manual", reason: "test", outcome: { mechanicalOrder: "declared", operations: [
        { domain: "role", intents: [changeRoleIntent(g.players.p1!, "vigormortis")] },
        { domain: "gameRuleFact", intents: [{ kind: "apply", type }] },
      ] } });
      expect(result).toMatchObject({ ok: false, code: "domain", domain: "gameRuleFact" });
      expect(game()).toBe(before.game);
      expect(game().players.p1!.actualRole).toBe("chef");
      expect(state().undoStack).toBe(before.undo);
      expect(state().localSeq).toBe(before.seq);
    }
  });

  it("a second Demon creation the same Night keeps one singleton fact", () => {
    const first = planned(plan(proofGame(ROLES), hagRequest(proofGame(ROLES), "p1", "vigormortis")));
    const second = planned(plan(first, hagRequest(first, "p6", "nodashii")));
    expect(second.players.p6!.actualRole).toBe("nodashii");
    expect(second.gameRuleFacts).toHaveLength(1);
    expect(second.history.filter((h) => h.category === "gameRuleFact")).toHaveLength(1);
  });

  it("branches that were Manual stay Manual (Traveller, concealed identity)", () => {
    const traveller = patchPlayer(proofGame([...ROLES, "gunslinger"]), "p7", { isTraveler: true, actualAlignment: "good" });
    expect(plan(traveller, hagRequest(traveller, "p7", "vigormortis"))).toMatchObject({ ok: false, code: "unsupported" });
    const drunk = patchPlayer(proofGame([...ROLES.slice(0, 6), "drunk"]), "p6", { shownRole: "chef", behaviorMode: "drunk_fake_role_behavior" });
    expect(plan(drunk, hagRequest(drunk, "p6", "vigormortis"))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("a Demon already in play: nothing happens, no fact", () => {
    expect(plan(proofGame(ROLES), hagRequest(proofGame(ROLES), "p1", "imp"))).toEqual({ ok: true, changed: false });
  });
});

describe("10G-AC-10: the fact expires on entry to the following Day", () => {
  it("Night -> Day removes it (with expiry History) and keeps the new Demon", () => {
    const g = proofGame(ROLES);
    openInStore(g);
    state().resolveAbility(hagRequest(g, "p1", "vigormortis"));
    state().advancePhase();
    expect(game()).toMatchObject({ phase: "day", day: 2, gameRuleFacts: [] });
    expect(game().players.p1!.actualRole).toBe("vigormortis");
    expect(game().history.at(-1)).toMatchObject({ category: "gameRuleFact", ruleFactOperation: "expire", moment: { phase: "day", day: 2 } });
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
  });
});

describe("10G-AC-11: one shared arbitrary-death gate (proof area 4)", () => {
  // p0 imp, p1 chef, p2 monk, p3 poisoner, p4 empath, p5 saint, p6 washerwoman
  const IMP_ROLES = ["imp", "chef", "monk", "poisoner", "empath", "saint", "washerwoman"];

  it("deathAttempt itself never forces a result while the fact applies -- even a known unprotected / protected one", () => {
    const g = arbitrary(proofGame(IMP_ROLES));
    const context = { judgments: {}, query: proofQuery(g) } as unknown as Parameters<typeof deathAttempt>[0];
    const unprotected = deathAttempt(context, bind(g, "p1"), "demon");
    expect(unprotected).toMatchObject({ kind: "ask", requirement: { source: "judgment" } });
    const id = (unprotected as { requirement: { id: string } }).requirement.id;
    expect(id).toBe(arbitraryDeathJudgmentId("demon", bind(g, "p1"), proofQuery(g).protectionDependencyStamp(bind(g, "p1"), "demon")));
    // Without the fact the same attempt is deterministic.
    expect(deathAttempt({ ...context, query: proofQuery(proofGame(IMP_ROLES)) } as never, bind(g, "p1"), "demon")).toEqual({ kind: "dies" });
  });

  it("the Imp's attack asks the Storyteller, and the answer decides (Yes: spared; No: dies)", () => {
    const g = arbitrary(proofGame(IMP_ROLES));
    const asked = plan(g, request(g, "p0", "imp", { target: pick(g, "p1") }));
    expect(asked).toMatchObject({ ok: false, code: "needsInput", message: expect.stringMatching(/arbitrary/) });
    const [id] = requirementIds(asked);
    expect(id).toMatch(/^arbitraryDeath:demon:/);
    expect(plan(g, request(g, "p0", "imp", { target: pick(g, "p1") }, { judgments: { [id!]: yes(true) } }))).toEqual({ ok: true, changed: false });
    expect(planned(plan(g, request(g, "p0", "imp", { target: pick(g, "p1") }, { judgments: { [id!]: yes(false) } }))).players.p1!.alive).toBe(false);
  });

  it("a known protection is not treated as forced either (Monk-protected target still asked)", () => {
    const protectedGame = arbitrary(planned(plan(proofGame(IMP_ROLES), request(proofGame(IMP_ROLES), "p2", "monk", { target: pick(proofGame(IMP_ROLES), "p1") }))));
    expect(proofQuery(protectedGame).protectedFrom(bind(protectedGame, "p1"), "demon")).toEqual({ known: true, value: true });
    const asked = plan(protectedGame, request(protectedGame, "p0", "imp", { target: pick(protectedGame, "p1") }));
    expect(requirementIds(asked)[0]).toMatch(/^arbitraryDeath:/);
  });

  it("other death-touching evaluators reach the same gate (Al-Hadikhia's all-live deaths)", () => {
    const al = arbitrary(proofGame(["alhadikhia", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"]));
    const req = request(al, "p0", "alhadikhia", { chosen: pick(al, "p1", "p2", "p3"),
      ...Object.fromEntries(["p1", "p2", "p3"].map((id, index) => [choiceId(index, bind(al, id)), yes(true)])) });
    expect(requirementIds(plan(al, req)).every((id) => id.startsWith("arbitraryDeath:"))).toBe(true);
  });

  it("architecture: no character module consults the Pit-Hag fact except its creator and the shared gate", () => {
    const dir = resolve(__dirname);
    const readers = readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .filter((name) => /PIT_HAG_ARBITRARY_DEATHS|pitHagArbitraryDeaths/.test(stripComments(readFileSync(join(dir, name), "utf8"))));
    expect(readers.sort()).toEqual(["pithag.ts", "shared.ts"]);
  });
});

describe("10G-AC-12 / AC-13 / AC-14: Toymaker skip bookkeeping (proof area 5)", () => {
  const toy = (g: StorytellerLobbyRecord) => ({ ...g, fabled: ["toymaker"] });
  const IMP_ROLES = ["imp", "poisoner", "monk", "chef", "empath", "fortuneteller", "saint"];

  it("the Storyteller records the skip through the Rule Fact seam: game-scoped, never on the Demon", () => {
    const g = toy(proofGame(IMP_ROLES));
    openInStore(g);
    expect(toymakerSkipStatus(game())).toBe("required");
    expect(state().resolveGameRuleFacts({ intents: [{ kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED }] })).toEqual({ ok: true, changed: true });
    expect(toymakerSkipStatus(game())).toBe("satisfied");
    expect(game().players.p0!.effects).toEqual([]);
    expect(game().players.p0!.reminders).toEqual([]);
    expect(game().gameRuleFacts[0]).not.toHaveProperty("participant");
  });

  it("skip recorded -> the Demon's attack is no longer gated; not recorded -> explicit judgment", () => {
    const g = toy(proofGame(IMP_ROLES));
    const env = () => proofEnv({ modifiers: activeModifiers(g, proofRegistry) });
    expect(plan(g, request(g, "p0", "imp", { target: pick(g, "p3") }), env())).toMatchObject({ ok: false, code: "needsInput", message: TOYMAKER_ATTACK_MESSAGE });
    const satisfied = { ...g, gameRuleFacts: [{ type: TOYMAKER_DEMON_SKIP_OCCURRED, recordedAt: { phase: "night", day: 2 } } as GameRuleFactRecord] };
    const result = plan(satisfied, request(satisfied, "p0", "imp", { target: pick(satisfied, "p3") }), proofEnv({ modifiers: activeModifiers(satisfied, proofRegistry) }));
    expect(planned(result).players.p3!.alive).toBe(false);
  });

  it("the record survives Demon replacement (a new Demon is still satisfied)", () => {
    const g = toy(proofGame(IMP_ROLES));
    openInStore(g);
    state().resolveGameRuleFacts({ intents: [{ kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED }] });
    expect(state().assignRole("p0", "chef").ok).toBe(true);
    expect(state().assignRole("p1", "imp").ok).toBe(true);
    expect(state().setShownRole("p1", "imp").ok).toBe(true); // the new Demon is told
    expect(game().gameRuleFacts.map((f) => f.type)).toEqual([TOYMAKER_DEMON_SKIP_OCCURRED]);
    expect(toymakerSkipStatus(game())).toBe("satisfied");
    const next = game();
    const attack = plan(next, request(next, "p1", "imp", { target: pick(next, "p3") }), proofEnv({ modifiers: activeModifiers(next, proofRegistry) }));
    expect(planned(attack).players.p3!.alive).toBe(false);
  });

  it("a skipped Demon row or Night progress never records the skip", () => {
    const g = toy(proofGame(IMP_ROLES));
    openInStore(g);
    state().setNightStepStatus(2, "p:" + g.players.p0!.participantId + ":imp", "skipped");
    expect(game().gameRuleFacts).toEqual([]);
    expect(toymakerSkipStatus(game())).toBe("required");
  });
});
