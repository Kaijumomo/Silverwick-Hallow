// @vitest-environment node
// LS-2b: the Tea Lady. https://wiki.bloodontheclocktower.com/Tea_Lady
// "If both your alive neighbors are good, they can't die." "The Demon cannot kill them, nor the Godfather, nor the Gossip. If they are
// executed, they do not die. The only exception is the Assassin." "Skip past any dead neighbours." Spy / Recluse neighbours use the
// Storyteller's setup decision (PO design 2026-11-12 23:56Z), for the Tea Lady ONLY.
import { describe, expect, it } from "vitest";
import { bind, impair, patchPlayer, pick, plan, planned, proofGame, proofQuery, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityEvaluationContext } from "@/abilities/semantics";
import { executionAdvice } from "@/stores/executionAdvice";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import type { Alignment, EffectRecord, RoleType, StorytellerLobbyRecord } from "@/stores/types";
import { TEA_LADY_REGISTRATION_FACTS, teaLadyCovers } from "./passiveRules";
import { deathAttempt } from "./shared";

const environment = { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS };
// p0 imp, p1 chef, p2 TEA LADY, p3 empath, p4 monk, p5 baron, p6 saint
const ROLES = ["imp", "chef", "tealady", "empath", "monk", "baron", "saint"];
const game = (roles = ROLES, phase: "night" | "day" = "night") => proofGame(roles, phase, 2);
const attack = (g: StorytellerLobbyRecord, id: string) => plan(g, request(g, "p0", "imp", { target: pick(g, id) }));
const guarded = (g: StorytellerLobbyRecord, id: string) => proofQuery(g).protectedFrom(bind(g, id), "demon");
const covers = (g: StorytellerLobbyRecord, id: string) => teaLadyCovers(proofQuery(g), bind(g, "p2"), bind(g, id));
const decide = (g: StorytellerLobbyRecord, id: string, alignment: Alignment): StorytellerLobbyRecord => patchPlayer(g, id, { effects: [...g.players[id]!.effects,
  { id: `tl-${id}`, type: TEA_LADY_REGISTRATION_FACTS[alignment], lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "setup", day: 0 } } as EffectRecord] });
const PROTECTED = { known: true, value: true };
const OPEN = { known: true, value: false };

describe("Tea Lady: both alive neighbours good", () => {
  it("protects both neighbours from the Demon, any death and execution, and nobody else (not herself)", () => {
    const g = game();
    for (const id of ["p1", "p3"]) {
      for (const cause of ["demon", "any", "execution"] as const) expect(proofQuery(g).protectedFrom(bind(g, id), cause), `${id} ${cause}`).toEqual(PROTECTED);
    }
    for (const id of ["p2", "p4", "p6"]) expect(guarded(g, id), id).toEqual(OPEN);
  });

  it("the Imp's attack on a neighbour changes nothing; on anyone else it kills (automated)", () => {
    const g = game();
    expect(attack(g, "p1")).toEqual({ ok: true, changed: false });
    expect(planned(attack(g, "p4")).players.p4!.alive).toBe(false);
  });

  it("a neighbour who is evil, or turns evil, ends the protection for both at once", () => {
    const g = patchPlayer(game(), "p3", { actualAlignment: "evil" });
    expect(guarded(g, "p1")).toEqual(OPEN);
    expect(guarded(g, "p3")).toEqual(OPEN);
    expect(planned(attack(g, "p1")).players.p1!.alive).toBe(false);
  });

  it("dead neighbours are skipped: the next alive player becomes the neighbour", () => {
    const g = patchPlayer(game(), "p3", { alive: false });
    expect(guarded(g, "p4")).toEqual(PROTECTED);
    expect(guarded(g, "p1")).toEqual(PROTECTED);
    // The next alive player clockwise is now the evil Baron.
    const h = patchPlayer(g, "p4", { alive: false });
    expect(guarded(h, "p1")).toEqual(OPEN);
    expect(guarded(h, "p5")).toEqual(OPEN);
  });

  it("a dead Tea Lady protects nobody; a drunk or poisoned one protects nobody", () => {
    expect(guarded(patchPlayer(game(), "p2", { alive: false }), "p1")).toEqual(OPEN);
    for (const type of ["poisoned", "drunk"]) {
      const g = impair(game(), "p2", type);
      expect(guarded(g, "p1"), type).toEqual(OPEN);
      expect(covers(g, "p1"), type).toEqual(PROTECTED); // still covered: the discs keep being drawn (PO ruling Q2)
    }
  });

  it("an unknown sobriety asks the Storyteller about her neighbours only", () => {
    const g = impair(game(), "p2", "soberHealthy");
    expect(guarded(g, "p1")).toMatchObject({ known: false });
    expect(guarded(g, "p4")).toEqual(OPEN);
  });

  it("the Assassin goes around it (test-only caller)", () => {
    const g = game();
    const context = { query: proofQuery(g), judgments: {} } as unknown as AbilityEvaluationContext;
    expect(deathAttempt(context, bind(g, "p1"), "assassin")).toEqual({ kind: "dies" });
    expect(deathAttempt(context, bind(g, "p1"), "demon")).toEqual({ kind: "survives" });
  });

  it("a Fool neighbour is protected by the Tea Lady first and spends nothing", () => {
    const g = game(["imp", "fool", "tealady", "empath", "monk", "baron", "saint"]);
    expect(proofQuery(g).deathOutcome(bind(g, "p1"), "demon")).toEqual({ known: true, value: { kind: "survives", spends: false } });
    expect(attack(g, "p1")).toEqual({ ok: true, changed: false });
  });

  it("the execution prompt advises survival with its existing words", () => {
    const g = game(ROLES, "day");
    expect(executionAdvice(g, "p1", environment)).toEqual({ kind: "survives", spends: false, note: "Player 1 is protected from this death: they survive the execution." });
    expect(executionAdvice(g, "p4", environment)).toBeNull();
  });

  it("the protection-dependency stamp follows the seating and the alignments while a Tea Lady is seated", () => {
    const g = game();
    const stamp = (x: StorytellerLobbyRecord) => proofQuery(x).protectionDependencyStamp(bind(x, "p1"), "demon");
    expect(stamp(patchPlayer(g, "p3", { actualAlignment: "evil" }))).not.toBe(stamp(g));
    expect(stamp({ ...g, seatOrder: [...g.seatOrder].reverse() })).not.toBe(stamp(g));
  });
});

describe("Tea Lady: Spy and Recluse neighbours (setup decision)", () => {
  // p1 is the Spy or Recluse under test, p3 a good Empath.
  const withNeighbour = (role: "spy" | "recluse") => game(["imp", role, "tealady", "empath", "monk", "baron", "saint"]);

  it("no stored decision: the question goes to the Storyteller with a reason that names the decision", () => {
    for (const [role, name] of [["spy", "Spy"], ["recluse", "Recluse"]] as const) {
      const g = withNeighbour(role);
      expect(guarded(g, "p3"), role).toEqual({ known: false, reason: `Choose how the ${name} registers for the Tea Lady.` });
      expect(attack(g, "p3"), role).toMatchObject({ ok: false });
    }
  });

  it("a stored decision is that alignment for the Tea Lady", () => {
    expect(guarded(decide(withNeighbour("spy"), "p1", "good"), "p3")).toEqual(PROTECTED);
    expect(guarded(decide(withNeighbour("spy"), "p1", "good"), "p1")).toEqual(PROTECTED);
    expect(guarded(decide(withNeighbour("spy"), "p1", "evil"), "p3")).toEqual(OPEN);
    expect(guarded(decide(withNeighbour("recluse"), "p1", "good"), "p3")).toEqual(PROTECTED);
    expect(guarded(decide(withNeighbour("recluse"), "p1", "evil"), "p3")).toEqual(OPEN);
    expect(attack(decide(withNeighbour("recluse"), "p1", "good"), "p3")).toEqual({ ok: true, changed: false });
  });

  it("an impaired Spy or Recluse counts as exactly what they are: the decision is ignored, not erased", () => {
    const spy = impair(decide(withNeighbour("spy"), "p1", "good"), "p1");
    expect(guarded(spy, "p3")).toEqual(OPEN); // the Spy is evil
    const recluse = impair(decide(withNeighbour("recluse"), "p1", "evil"), "p1");
    expect(guarded(recluse, "p3")).toEqual(PROTECTED); // the Recluse is good
    expect(recluse.players.p1!.effects.some(e => e.type === TEA_LADY_REGISTRATION_FACTS.evil)).toBe(true);
  });

  it("every other observer's registration answers are byte-identical with or without the decision", () => {
    const observers = [undefined, "empath", "chef", "fortuneteller", "investigator", "washerwoman", "librarian", "undertaker", "ravenkeeper", "towncrier", "imp", "slayer"];
    const types: RoleType[] = ["townsfolk", "outsider", "minion", "demon", "traveler"];
    for (const role of ["spy", "recluse"] as const) for (const alignment of ["good", "evil"] as const) for (const impaired of [false, true]) {
      const plain = impaired ? impair(withNeighbour(role), "p1") : withNeighbour(role);
      const stored = impaired ? impair(decide(withNeighbour(role), "p1", alignment), "p1") : decide(withNeighbour(role), "p1", alignment);
      for (const observer of observers) {
        const read = (g: StorytellerLobbyRecord) => JSON.stringify([proofQuery(g).registration(bind(g, "p1"), observer),
          ...types.map(type => proofQuery(g).registersAsType(bind(g, "p1"), type, observer))]);
        expect(read(stored), `${role} ${alignment} ${impaired} ${observer}`).toBe(read(plain));
      }
    }
    // ...and for the Tea Lady it is the decision.
    expect(proofQuery(decide(withNeighbour("spy"), "p1", "good")).registration(bind(withNeighbour("spy"), "p1"), "tealady").alignment).toEqual({ known: true, value: "good" });
  });

  it("a decision on a player who is no longer a Spy or Recluse is simply not read", () => {
    const g = patchPlayer(decide(withNeighbour("spy"), "p1", "good"), "p1", { actualRole: "baron" });
    expect(guarded(g, "p3")).toEqual(OPEN);
  });

  it("nothing about the decision or the protection reaches the public or player projections", () => {
    const g = decide(withNeighbour("spy"), "p1", "good");
    const text = JSON.stringify([projectLobbyToPublic(g, {}), projectLobbyToSelfMap(g, proofRegistry)]);
    expect(text).not.toMatch(/registersGoodToTeaLady|registersEvilToTeaLady|Cannot Die/i);
  });
});
