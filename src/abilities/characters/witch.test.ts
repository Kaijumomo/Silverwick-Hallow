// @vitest-environment node
// Treacherous 30th slice 2C -- Witch (night half). Production semantics.
import { describe, expect, it } from "vitest";
import { createRulesQuery } from "@/stores/rulesQuery";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { bind, homebrewEnv, impair, patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

// Seats: p0 witch, p1 chef, p2 empath, p3 monk, p4 imp, p5 saint, p6 poisoner
const ROLES = ["witch", "chef", "empath", "monk", "imp", "saint", "poisoner"];
const query = (g: StorytellerLobbyRecord) => createRulesQuery(g, { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS, modifiers: [] });
const curse = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.effects.find((e) => e.type === "witchCurse");

describe("Witch", () => {
  it("curses the chosen player for one Day, on every night including the first", () => {
    for (const day of [1, 2]) {
      const g = proofGame(ROLES, "night", day);
      const next = planned(plan(g, request(g, "p0", "witch", { target: pick(g, "p1") })));
      expect(curse(next, "p1")).toMatchObject({ sourceCharacter: "witch", lifetime: { kind: "throughFollowingDay" },
        sourceParticipant: { kind: "participant", participantId: g.players.p0!.participantId } });
    }
  });

  it("the curse is derived: it applies while the Witch functions and stops when she cannot", () => {
    const g = proofGame(ROLES);
    const next = planned(plan(g, request(g, "p0", "witch", { target: pick(g, "p1") })));
    expect(query(next).effectApplies(bind(next, "p1"), curse(next, "p1")!)).toEqual({ known: true, value: true });
    for (const lost of [patchPlayer(next, "p0", { alive: false }), impair(next, "p0"), patchPlayer(next, "p0", { actualRole: "chef" })]) {
      expect(query(lost).effectApplies(bind(lost, "p1"), curse(lost, "p1")!)).toEqual({ known: true, value: false });
    }
  });

  it("with just three living players the Witch has lost the ability", () => {
    const g = ROLES.slice(3).reduce((acc, _, i) => patchPlayer(acc, `p${i + 3}`, { alive: false }), proofGame(ROLES));
    expect(plan(g, request(g, "p0", "witch", { target: pick(g, "p1") }))).toEqual({ ok: true, changed: false });
  });

  it("an impaired Witch curses no one; a homebrew Witch inherits nothing", () => {
    const g = impair(proofGame(ROLES), "p0");
    expect(plan(g, request(g, "p0", "witch", { target: pick(g, "p1") }))).toEqual({ ok: true, changed: false });
    const h = proofGame(ROLES);
    expect(plan(h, request(h, "p0", "witch", { target: pick(h, "p1") }), homebrewEnv("witch"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});
