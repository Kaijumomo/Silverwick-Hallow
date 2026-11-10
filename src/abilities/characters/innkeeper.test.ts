// @vitest-environment node
// Treacherous 30th slice 2B -- Innkeeper. Production semantics.
import { describe, expect, it } from "vitest";
import { createRulesQuery } from "@/stores/rulesQuery";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { subjectId } from "./shared";
import { DRUNK_ONE } from "./innkeeper";
import { bind, homebrewEnv, impair, patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, request, reseat, requirementIds } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const ROLES = ["innkeeper", "empath", "chef", "poisoner", "imp", "monk", "saint"];
const query = (g: StorytellerLobbyRecord) => createRulesQuery(g, { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS, modifiers: [] });
const effectOf = (g: StorytellerLobbyRecord, id: string, type: string) => g.players[id]!.effects.find((e) => e.type === type);
const drunkId = (g: StorytellerLobbyRecord, ...ids: string[]) => subjectId(DRUNK_ONE, ...ids.map((id) => bind(g, id)));
const run = (g: StorytellerLobbyRecord, targets: string[], drunk?: string) =>
  plan(g, request(g, "p0", "innkeeper", { targets: pick(g, ...targets), ...(drunk ? { [drunkId(g, ...targets)]: pick(g, drunk) } : {}) }));

describe("Innkeeper -- functioning", () => {
  it("asks which of the two chosen players is drunk", () => {
    const g = proofGame(ROLES);
    const result = run(g, ["p1", "p2"]);
    expect(result).toMatchObject({ ok: false, code: "needsInput" });
    expect(requirementIds(result)).toEqual([drunkId(g, "p1", "p2")]);
  });

  it("protects both from death tonight and makes only the chosen one drunk until dusk", () => {
    const g = proofGame(ROLES);
    const next = planned(run(g, ["p1", "p2"], "p2"));
    for (const id of ["p1", "p2"]) {
      expect(effectOf(next, id, "cannotDie")).toMatchObject({
        sourceCharacter: "innkeeper", lifetime: { kind: "untilDawn" }, expiry: { kind: "at", moment: { phase: "day", day: 2 } },
        sourceParticipant: { kind: "participant", participantId: g.players.p0!.participantId },
      });
      expect(query(next).protectedFrom(bind(next, id), "demon")).toEqual({ known: true, value: true });
      expect(query(next).protectedFrom(bind(next, id), "any")).toEqual({ known: true, value: true });
    }
    expect(effectOf(next, "p1", "drunk")).toBeUndefined();
    expect(effectOf(next, "p2", "drunk")).toMatchObject({ sourceCharacter: "innkeeper", lifetime: { kind: "throughFollowingDay" } });
    expect(query(next).impaired(bind(next, "p2"))).toEqual({ known: true, value: true });
    expect(query(next).impaired(bind(next, "p1"))).toEqual({ known: true, value: false });
  });

  it("does not act on Night 1 (Each night*)", () => {
    const g = proofGame(ROLES, "night", 1);
    expect(run(g, ["p1", "p2"], "p1")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("refuses the same player twice, and a drunk player who was not chosen", () => {
    const g = proofGame(ROLES);
    expect(run(g, ["p1", "p1"], "p1")).toMatchObject({ ok: false, code: "illegal" });
    expect(run(g, ["p1", "p2"], "p3")).toMatchObject({ ok: false, code: "illegal" });
  });

  it("may protect themself and the dead", () => {
    const g = patchPlayer(proofGame(ROLES), "p3", { alive: false });
    const next = planned(run(g, ["p0", "p3"], "p3"));
    expect(effectOf(next, "p0", "cannotDie")).toBeDefined();
    expect(effectOf(next, "p3", "cannotDie")).toBeDefined();
  });
});

describe("Innkeeper -- impairment and source applicability", () => {
  it("an impaired Innkeeper chooses but protects and impairs no one", () => {
    const g = impair(proofGame(ROLES), "p0");
    expect(plan(g, request(g, "p0", "innkeeper", { targets: pick(g, "p1", "p2") }))).toEqual({ ok: true, changed: false });
  });

  it("protection and drunkenness stop applying when the Innkeeper loses the ability", () => {
    const g = proofGame(ROLES);
    const next = planned(run(g, ["p1", "p2"], "p2"));
    for (const lost of [patchPlayer(next, "p0", { alive: false }), impair(next, "p0"), patchPlayer(next, "p0", { actualRole: "chef" })]) {
      expect(query(lost).protectedFrom(bind(lost, "p1"), "any")).toEqual({ known: true, value: false });
      expect(query(lost).impaired(bind(lost, "p2"))).toEqual({ known: true, value: false });
    }
  });
});

describe("Innkeeper -- identity and ownership", () => {
  it("stale target after seat reuse is refused", () => {
    const g = proofGame(ROLES);
    expect(plan(reseat(g, "p1"), request(g, "p0", "innkeeper", { targets: pick(g, "p1", "p2") }))).toMatchObject({ ok: false, code: "stale" });
  });

  it("a homebrew Innkeeper reusing the official id inherits no semantics", () => {
    const g = proofGame(ROLES);
    expect(plan(g, request(g, "p0", "innkeeper", { targets: pick(g, "p1", "p2") }), homebrewEnv("innkeeper"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("Innkeeper -- end to end with a Demon attack", () => {
  const ROLES2 = ["imp", "innkeeper", "chef", "empath", "monk", "saint", "poisoner"];
  it("an Innkeeper-protected target does not die to the Imp, and an unprotected one does", () => {
    const g0 = proofGame(ROLES2);
    const protectedGame = planned(plan(g0, request(g0, "p1", "innkeeper", { targets: pick(g0, "p2", "p3"), [subjectId(DRUNK_ONE, bind(g0, "p2"), bind(g0, "p3"))]: pick(g0, "p3") })));
    expect(plan(protectedGame, request(protectedGame, "p0", "imp", { target: pick(protectedGame, "p2") }))).toEqual({ ok: true, changed: false });
    const dies = plan(protectedGame, request(protectedGame, "p0", "imp", { target: pick(protectedGame, "p4") }));
    expect(dies).toMatchObject({ ok: true, changed: true });
  });

  it("the drunk protected Empath is impaired, so its own ability no longer functions", () => {
    const g0 = proofGame(ROLES2);
    const next = planned(plan(g0, request(g0, "p1", "innkeeper", { targets: pick(g0, "p2", "p3"), [subjectId(DRUNK_ONE, bind(g0, "p2"), bind(g0, "p3"))]: pick(g0, "p3") })));
    expect(query(next).abilityFunctions(bind(next, "p3"))).toEqual({ known: true, value: false });
    expect(query(next).abilityFunctions(bind(next, "p2"))).toEqual({ known: true, value: true });
  });
});

describe("Innkeeper -- chooses themself (official example)", () => {
  it("a self-drunk Innkeeper has no ability and neither protection holds", () => {
    const g = proofGame(ROLES);
    const next = planned(run(g, ["p0", "p1"], "p0"));
    expect(query(next).impaired(bind(next, "p0"))).toEqual({ known: true, value: true });
    expect(query(next).abilityFunctions(bind(next, "p0"))).toEqual({ known: true, value: false });
    expect(query(next).protectedFrom(bind(next, "p1"), "demon")).toEqual({ known: true, value: false });
    expect(query(next).protectedFrom(bind(next, "p0"), "demon")).toEqual({ known: true, value: false });
  });

  it("choosing themself but making the other player drunk keeps the Innkeeper protected", () => {
    const g = proofGame(ROLES);
    const next = planned(run(g, ["p0", "p1"], "p1"));
    expect(query(next).protectedFrom(bind(next, "p0"), "demon")).toEqual({ known: true, value: true });
    expect(query(next).protectedFrom(bind(next, "p1"), "demon")).toEqual({ known: true, value: true });
  });
});
