// SV-1 pair record (docs/ai/SECTS_AND_VIOLETS_SV1_PAIRS.md): the Sage, Sweetheart, Klutz and Barber against the other characters of
// Sects & Violets, where a pair changes what the app does. Production semantics, the real coordinator, the proof script.
import { describe, expect, it } from "vitest";
import { BARBER_PLAYERS } from "./barber";
import { SWEETHEART_PLAYER } from "./sweetheart";
import { KLUTZ_TARGET } from "./klutz";
import { SAGE_PLAYERS } from "./sage";
import { nightTriggerStatus } from "@/abilities/invocation";
import { REVIEWED_INTERACTION_ROLES } from "./passiveRules";
import { sectsAndViolets } from "@/data/scripts/sectsAndViolets";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { bind, patchPlayer, pick, plan, planned, proofGame, proofQuery, request } from "@/test/proofFixtures";
import { KLUTZ_EVIL_TEAM_LOST, KLUTZ_GOOD_TEAM_LOST } from "@/stores/gameRuleFactRegistry";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";

/** p0 died as `role` during `phase` of Day/Night 2 (an entered death, no recorded cause). */
const died = (g: StorytellerLobbyRecord, role: string, phase: "day" | "night"): StorytellerLobbyRecord => ({
  ...patchPlayer(g, "p0", { alive: false }),
  lifeEventWindow: { coverageFrom: { phase: "night", day: 1 }, events: [{ id: "d1", kind: "death", moment: { phase, day: 2 }, actualRoleAtEvent: role,
    subject: { kind: "participant", playerId: "p0", participantId: g.players.p0!.participantId!, nameAtTime: "Player 0" } } as LifeEvent] },
});
const at = (roles: string[], phase: "day" | "night") => died(proofGame(roles, phase, 2), roles[0]!, phase);
const night = { invocationPath: "nightTrigger", withStep: true, completeStep: true } as const;
const klutzDay = { invocationPath: "dayEntry", context: { provenance: { sourcePlayer: "p0", sourceCharacter: "klutz" } } } as never;
/** Each SV-1 action with p1..p3 as its picks (the Sage's cause already answered Yes). */
const actions = (other: string) => {
  const sage = at(["sage", "imp", "clockmaker", "dreamer", other], "night");
  const sweetheart = at(["sweetheart", "imp", "clockmaker", "dreamer", other], "night");
  const sweetheartDay = at(["sweetheart", "imp", "clockmaker", "dreamer", other], "day");
  const klutz = at(["klutz", "imp", "clockmaker", "dreamer", other], "day");
  const barber = at(["barber", "imp", "clockmaker", "dreamer", other], "night");
  return {
    sage: plan(sage, request(sage, "p0", "sage", { [SAGE_PLAYERS]: pick(sage, "p1", "p2"), [`sage:demonKilled:"d1"`]: { kind: "boolean", value: true } }, night)),
    sweetheart: plan(sweetheart, request(sweetheart, "p0", "sweetheart", { [SWEETHEART_PLAYER]: pick(sweetheart, "p2") }, night)),
    sweetheartDay: plan(sweetheartDay, request(sweetheartDay, "p0", "sweetheart", { [SWEETHEART_PLAYER]: pick(sweetheartDay, "p2") }, { invocationPath: "dayEntry" })),
    klutz: plan(klutz, request(klutz, "p0", "klutz", { [KLUTZ_TARGET]: pick(klutz, "p1") }, klutzDay)),
    barber: plan(barber, request(barber, "p0", "barber", { [BARBER_PLAYERS]: pick(barber, "p2", "p3") }, night)),
  };
};

describe("SV-1 pairs: the reviewed-list gate", () => {
  it("every Sects & Violets character is on the reviewed list since SV-4c (the Cerenovus joined in SV-4a, the Evil Twin in SV-4c): nothing gates an SV-1 action", () => {
    for (const id of sectsAndViolets.characters.map((role) => role.id)) expect(REVIEWED_INTERACTION_ROLES.has(id), id).toBe(true);
  });

  it("with any other character of the script in play, every SV-1 action is guided (the Philosopher since SV-3a, the Cerenovus since SV-4a, the Evil Twin since SV-4c)", () => {
    for (const other of ["philosopher", "clockmaker", "dreamer", "mathematician", "flowergirl", "towncrier", "oracle", "savant", "seamstress", "artist", "juggler", "mutant", "witch", "pithag", "nodashii", "vigormortis", "snakecharmer", "fanggu", "cerenovus", "eviltwin"]) {
      for (const [name, result] of Object.entries(actions(other))) {
        // Two Demons (Imp and No Dashii, Vigormortis or Fang Gu) make the Barber's step ask which Demon swaps; everything else commits.
        if (name === "barber" && ["nodashii", "vigormortis", "fanggu"].includes(other)) expect(result, `${name} + ${other}`).toMatchObject({ ok: false, code: "needsInput" });
        else expect(result, `${name} + ${other}`).toMatchObject({ ok: true });
      }
    }
  });
});

describe("SV-1 pairs: the Demons", () => {
  it("Vortox: the Sage's pair must be false (SV-5j: the Imp is refused); the Sweetheart, Klutz and Barber (Outsiders) are unaffected", () => {
    const result = actions("vortox");
    expect(result.sage).toMatchObject({ ok: false, code: "illegal" });
    for (const name of ["sweetheart", "sweetheartDay", "klutz", "barber"] as const) {
      expect(result[name], name).toMatchObject(name === "barber" ? { ok: false, code: "needsInput" } : { ok: true });
    }
  });

  it("Vigormortis: its guided kill opens the Sage's step", () => {
    const g = proofGame(["sage", "vigormortis", "clockmaker", "dreamer"], "night", 2);
    const next = planned(plan(g, request(g, "p1", "vigormortis", { target: pick(g, "p0") })));
    expect(nightTriggerStatus(CANONICAL_ABILITY_SEMANTICS.get("sage")!, bind(next, "p0"), proofQuery(next))).toMatchObject({ kind: "triggered" });
  });

  it("No Dashii: a Townsfolk neighbour (the Sage) is poisoned and is shown any two players; an Outsider neighbour (the Sweetheart) is not poisoned", () => {
    // Seats: p0 sage, p1 nodashii, p2 sweetheart.
    const g = proofGame(["sage", "nodashii", "sweetheart", "clockmaker", "dreamer"], "night", 2);
    expect(proofQuery(g).noDashiiPoisoned(bind(g, "p0"))).toEqual({ known: true, value: true });
    expect(proofQuery(g).noDashiiPoisoned(bind(g, "p2"))).toEqual({ known: true, value: false });
    const sage = died(g, "sage", "night");
    // Poisoned: a pair without the Demon is accepted.
    expect(plan(sage, request(sage, "p0", "sage", { [SAGE_PLAYERS]: pick(sage, "p3", "p4"), [`sage:demonKilled:"d1"`]: { kind: "boolean", value: true } }, night)))
      .toMatchObject({ ok: true });
  });

  it("No Dashii: the Barber's swap moves its poison with the characters (a Townsfolk swapped next to it becomes poisoned)", () => {
    // Seats: p0 barber, p1 nodashii, p2 mutant (Outsider neighbour), p3 clockmaker.
    const g = died(proofGame(["barber", "nodashii", "mutant", "clockmaker", "dreamer"], "night", 2), "barber", "night");
    expect(proofQuery(g).noDashiiPoisoned(bind(g, "p2"))).toEqual({ known: true, value: false });
    const next = planned(plan(g, request(g, "p0", "barber", { [BARBER_PLAYERS]: pick(g, "p2", "p3") }, night)));
    expect(next.players.p2!.actualRole).toBe("clockmaker");
    expect(proofQuery(next).noDashiiPoisoned(bind(next, "p2"))).toEqual({ known: true, value: true });
  });
});

describe("SV-1 pairs: the Klutz's choice against the script's evil and good characters", () => {
  it("a Minion of the script (Witch, Pit-Hag) or a Demon is evil: the good Klutz's team loses; a good Outsider (Mutant) is nothing", () => {
    for (const evil of ["witch", "pithag", "vigormortis", "nodashii", "vortox"]) {
      const g = at(["klutz", evil, "clockmaker", "mutant"], "day");
      const next = planned(plan(g, request(g, "p0", "klutz", { [KLUTZ_TARGET]: pick(g, "p1") }, klutzDay)));
      expect((next.gameRuleFacts ?? []).map((f) => f.type), evil).toEqual([KLUTZ_GOOD_TEAM_LOST]);
    }
    const g = at(["klutz", "witch", "clockmaker", "mutant"], "day");
    expect(planned(plan(g, request(g, "p0", "klutz", { [KLUTZ_TARGET]: pick(g, "p3") }, klutzDay))).gameRuleFacts ?? []).toEqual([]);
    const evilKlutz = patchPlayer(g, "p0", { actualAlignment: "evil" });
    expect((planned(plan(evilKlutz, request(evilKlutz, "p0", "klutz", { [KLUTZ_TARGET]: pick(evilKlutz, "p1") }, klutzDay))).gameRuleFacts ?? []).map((f) => f.type))
      .toEqual([KLUTZ_EVIL_TEAM_LOST]);
  });
});

describe("SV-1 pairs: among the four", () => {
  it("the Sweetheart's DRUNK on the Sage, the Klutz or the Barber makes their step act as drunk", () => {
    // p0 sweetheart died last night and made p1 drunk; then p1 dies as each character.
    const drunkFrom = (g: StorytellerLobbyRecord) => {
      const effect = { id: "sw", type: "drunk", sourceCharacter: "sweetheart", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" },
        appliedAt: { phase: "night", day: 1 }, sourceParticipant: { kind: "participant", playerId: "p4", participantId: g.players.p4!.participantId!, nameAtTime: "Player 4" } };
      return patchPlayer(patchPlayer(g, "p4", { alive: false }), "p0", { effects: [effect as never] });
    };
    const sage = drunkFrom(at(["sage", "imp", "clockmaker", "dreamer", "sweetheart"], "night"));
    expect(proofQuery(sage).abilityFunctions(bind(sage, "p0"))).toEqual({ known: true, value: false });
    expect(plan(sage, request(sage, "p0", "sage", { [SAGE_PLAYERS]: pick(sage, "p2", "p3"), [`sage:demonKilled:"d1"`]: { kind: "boolean", value: true } }, night)))
      .toMatchObject({ ok: true });
    const klutz = drunkFrom(at(["klutz", "imp", "clockmaker", "dreamer", "sweetheart"], "day"));
    expect(planned(plan(klutz, request(klutz, "p0", "klutz", { [KLUTZ_TARGET]: pick(klutz, "p1") }, klutzDay))).gameRuleFacts ?? []).toEqual([]);
    const barber = drunkFrom(at(["barber", "imp", "clockmaker", "dreamer", "sweetheart"], "night"));
    expect(plan(barber, request(barber, "p0", "barber", { [BARBER_PLAYERS]: pick(barber, "p2", "p3") }, night)))
      .toMatchObject({ ok: false, code: "illegal", message: expect.stringContaining("no swap happens") });
  });

  it("the Klutz chooses the Sage or the Sweetheart (good): nothing happens", () => {
    for (const good of ["sage", "sweetheart"]) {
      const g = at(["klutz", "imp", good, "dreamer"], "day");
      expect(planned(plan(g, request(g, "p0", "klutz", { [KLUTZ_TARGET]: pick(g, "p2") }, klutzDay))).gameRuleFacts ?? [], good).toEqual([]);
    }
  });

  it("the Barber's swap gives a used Klutz ability back fresh; a living Klutz still acts only after learning they died", () => {
    const g = patchPlayer(at(["barber", "imp", "klutz", "dreamer"], "night"), "p2", { alive: false, abilityUsed: true });
    const next = planned(plan(g, request(g, "p0", "barber", { [BARBER_PLAYERS]: pick(g, "p2", "p3") }, night)));
    expect(next.players.p3).toMatchObject({ actualRole: "klutz", abilityUsed: false, alive: true });
  });
});
