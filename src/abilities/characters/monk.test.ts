// Phase 10F Slice 7 -- Monk (matrix Section 5). Production semantics.
// The Imp / Al-Hadikhia suites additionally prove Monk protection blocking
// real Demon deaths end-to-end.
import { describe, expect, it } from "vitest";
import { createRulesQuery } from "@/stores/rulesQuery";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { bind, homebrewEnv, impair, patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, request, reseat } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const ROLES = ["monk", "empath", "chef", "poisoner", "imp", "fortuneteller", "saint"];
const query = (g: StorytellerLobbyRecord) => createRulesQuery(g, { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS, modifiers: [] });
const safeOf = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.effects.find((e) => e.type === "safeFromDemon")!;

describe("Monk -- functioning", () => {
  it("other Nights: one sourced safeFromDemon Effect until dawn", () => {
    const g = proofGame(ROLES, "night", 2);
    const next = planned(plan(g, request(g, "p0", "monk", { target: pick(g, "p1") })));
    expect(safeOf(next, "p1")).toMatchObject({
      type: "safeFromDemon", sourceCharacter: "monk", lifetime: { kind: "untilDawn" },
      sourceParticipant: { kind: "participant", participantId: g.players.p0!.participantId },
      expiry: { kind: "at", moment: { phase: "day", day: 2 } },
    });
  });

  it("does not act on Night 1 (Each night*)", () => {
    const g = proofGame(ROLES, "night", 1);
    expect(plan(g, request(g, "p0", "monk", { target: pick(g, "p1") }))).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("self is refused; a dead target is structurally legal", () => {
    const g = patchPlayer(proofGame(ROLES), "p2", { alive: false });
    expect(plan(g, request(g, "p0", "monk", { target: pick(g, "p0") }))).toMatchObject({ ok: false, code: "illegal" });
    expect(safeOf(planned(plan(g, request(g, "p0", "monk", { target: pick(g, "p2") }))), "p2")).toBeDefined();
  });

  it("Safe from the Demon is Demon-specific -- never universal death immunity", () => {
    const g = proofGame(ROLES);
    const next = planned(plan(g, request(g, "p0", "monk", { target: pick(g, "p1") })));
    expect(query(next).protectedFrom(bind(next, "p1"), "demon")).toEqual({ known: true, value: true });
    expect(query(next).protectedFrom(bind(next, "p1"), "any")).toEqual({ known: true, value: false });
  });
});

describe("Monk -- impairment and source applicability", () => {
  it("an impaired Monk chooses but produces no protection", () => {
    const g = impair(proofGame(ROLES), "p0");
    expect(plan(g, request(g, "p0", "monk", { target: pick(g, "p1") }))).toEqual({ ok: true, changed: false });
  });

  it("the protection stops applying when the Monk loses the ability before the Demon resolves", () => {
    const g = proofGame(ROLES);
    const next = planned(plan(g, request(g, "p0", "monk", { target: pick(g, "p1") })));
    for (const lost of [patchPlayer(next, "p0", { alive: false }), impair(next, "p0"), patchPlayer(next, "p0", { actualRole: "chef" })]) {
      expect(query(lost).protectedFrom(bind(lost, "p1"), "demon")).toEqual({ known: true, value: false });
      expect(safeOf(lost, "p1")).toBe(safeOf(next, "p1"));
    }
  });
});

describe("Monk -- identity and ownership", () => {
  it("stale target after seat reuse is refused", () => {
    const g = proofGame(ROLES);
    expect(plan(reseat(g, "p1"), request(g, "p0", "monk", { target: pick(g, "p1") }))).toMatchObject({ ok: false, code: "stale" });
  });

  it("a homebrew Monk reusing the official id inherits no semantics", () => {
    const g = proofGame(ROLES);
    expect(plan(g, request(g, "p0", "monk", { target: pick(g, "p1") }), homebrewEnv("monk"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});
