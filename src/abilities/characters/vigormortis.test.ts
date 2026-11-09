// Treacherous 30th slice 2B -- Vigormortis. Production semantics.
import { describe, expect, it } from "vitest";
import { createRulesQuery } from "@/stores/rulesQuery";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { bind, homebrewEnv, impair, patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, request, requirementIds } from "@/test/proofFixtures";
import { subjectId } from "./shared";
import { POISONED_NEIGHBOUR } from "./vigormortis";
import type { StorytellerLobbyRecord } from "@/stores/types";

// Seats: p0 Vigormortis, p1 chef, p2 empath, p3 baron (minion), p4 monk, p5 saint, p6 poisoner (minion)
const ROLES = ["vigormortis", "chef", "empath", "baron", "monk", "saint", "poisoner"];
const query = (g: StorytellerLobbyRecord) => createRulesQuery(g, { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS, modifiers: [] });
const poisonOn = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.effects.find((e) => e.type === "poisoned" && e.sourceCharacter === "vigormortis");
const choice = (g: StorytellerLobbyRecord, minion: string, who: string) => ({ [subjectId(POISONED_NEIGHBOUR, bind(g, minion))]: pick(g, who) });

describe("Vigormortis -- killing a non-Minion", () => {
  it("kills an unprotected player and poisons no one", () => {
    const g = proofGame(ROLES);
    const next = planned(plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p2") })));
    expect(next.players.p2!.alive).toBe(false);
    for (const id of Object.keys(next.players)) expect(poisonOn(next, id)).toBeUndefined();
  });

  it("a dead target changes nothing; an impaired Vigormortis kills no one", () => {
    const dead = patchPlayer(proofGame(ROLES), "p2", { alive: false });
    expect(plan(dead, request(dead, "p0", "vigormortis", { target: pick(dead, "p2") }))).toEqual({ ok: true, changed: false });
    const g = impair(proofGame(ROLES), "p0");
    expect(plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p2") }))).toEqual({ ok: true, changed: false });
  });
});

describe("Vigormortis -- killing a Minion", () => {
  it("asks which of the Minion's two nearest Townsfolk neighbours is poisoned", () => {
    const g = proofGame(ROLES);
    const result = plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p3") }));
    expect(result).toMatchObject({ ok: false, code: "needsInput" });
    expect(requirementIds(result)).toEqual([subjectId(POISONED_NEIGHBOUR, bind(g, "p3"))]);
  });

  it("kills the Minion and poisons the chosen Townsfolk (dead neighbours included) until the Vigormortis stops functioning", () => {
    const g = patchPlayer(proofGame(ROLES), "p2", { alive: false });
    const next = planned(plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p3"), ...choice(g, "p3", "p2") })));
    expect(next.players.p3!.alive).toBe(false);
    expect(poisonOn(next, "p2")).toMatchObject({ lifetime: { kind: "manual" } });
    expect(poisonOn(next, "p4")).toBeUndefined();
    expect(query(next).impaired(bind(next, "p2"))).toEqual({ known: true, value: true });
    for (const lost of [patchPlayer(next, "p0", { alive: false }), impair(next, "p0"), patchPlayer(next, "p0", { actualRole: "imp" })]) {
      expect(query(lost).impaired(bind(lost, "p2"))).toEqual({ known: true, value: false });
    }
  });

  it("a choice outside the two neighbours is refused", () => {
    const g = proofGame(ROLES);
    expect(plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p3"), ...choice(g, "p3", "p5") }))).toMatchObject({ ok: false, code: "illegal" });
  });

  it("a single nearest Townsfolk on both sides is poisoned without asking", () => {
    const g = proofGame(["vigormortis", "baron", "saint", "chef", "saint", "saint", "poisoner"]);
    const next = planned(plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p1") })));
    expect(next.players.p1!.alive).toBe(false);
    expect(poisonOn(next, "p3")).toBeDefined();
  });

  it("a Spy victim with an ambiguous registration is not decided", () => {
    const g = patchPlayer(proofGame(ROLES), "p3", { actualRole: "spy" });
    expect(plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p3") }))).toMatchObject({ ok: false });
  });

  it("a homebrew copy inherits nothing", () => {
    const g = proofGame(ROLES);
    expect(plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p2") }), homebrewEnv("vigormortis"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("Vigormortis -- the killed Minion keeps its ability (WP-5)", () => {
  // p3 baron, p6 poisoner; Witch needed for the curse: p3 becomes a witch here.
  const ROLES2 = ["vigormortis", "chef", "empath", "witch", "monk", "saint", "poisoner", "godfather"];
  const kill = (g: StorytellerLobbyRecord, minion: string, side: string) =>
    planned(plan(g, request(g, "p0", "vigormortis", { target: pick(g, minion), ...choice(g, minion, side) })));
  const retained = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.effects.find((e) => e.type === "retainsAbility" && e.state === "active");
  const q = (g: StorytellerLobbyRecord) => query(g).retainsAbility(bind(g, "p3"));

  it("the killed Minion gets the HAS ABILITY effect and the poison names that Minion", () => {
    const g = proofGame(ROLES2);
    const next = kill(g, "p3", "p2");
    expect(retained(next, "p3")).toMatchObject({ sourceCharacter: "vigormortis", lifetime: { kind: "manual" } });
    expect(poisonOn(next, "p2")?.parameters?.minion).toBeTruthy();
    expect(q(next)).toEqual({ known: true, value: true });
  });

  it("a dead Witch killed by the Vigormortis acts on the next night: the curse is applied and stays in force", () => {
    const next = kill(proofGame(ROLES2), "p3", "p2");
    const night = { ...next, day: 3 } as StorytellerLobbyRecord;
    const cast = planned(plan(night, request(night, "p3", "witch", { target: pick(night, "p1") })));
    const curse = cast.players.p1!.effects.find((e) => e.type === "witchCurse");
    expect(curse).toBeTruthy();
    expect(query(cast).effectApplies(bind(cast, "p1"), curse!)).toEqual({ known: true, value: true });
  });

  it("a dead Poisoner and a dead Godfather retain their wake too; a Minion that never had the effect does not", () => {
    for (const [minion, role] of [["p6", "poisoner"], ["p7", "godfather"]] as const) {
      const next = kill(proofGame(ROLES2), minion, "p4");
      expect(retained(next, minion)).toBeTruthy();
      const night = { ...next, day: 3 } as StorytellerLobbyRecord;
      const result = plan(night, request(night, minion, role, { target: pick(night, "p1") }));
      expect(result).not.toMatchObject({ code: "notApplicable", message: expect.stringContaining("Dead players") });
    }
    const executed = patchPlayer(proofGame(ROLES2), "p3", { alive: false });
    expect(plan(executed, request(executed, "p3", "witch", { target: pick(executed, "p1") }))).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("what the Minion sourced before dying is kept when the Vigormortis kills it (the poison already placed stays)", () => {
    const g = proofGame(ROLES2);
    const night = { ...g, day: 3 } as StorytellerLobbyRecord;
    const poisoned = planned(plan(night, request(night, "p6", "poisoner", { target: pick(night, "p1") })));
    const next = planned(plan(poisoned, request(poisoned, "p0", "vigormortis", { target: pick(poisoned, "p6"), ...choice(poisoned, "p6", "p4") })));
    const placed = next.players.p1!.effects.find((e) => e.type === "poisoned" && e.sourceCharacter === "poisoner");
    expect(placed).toBeTruthy();
    expect(query(next).effectApplies(bind(next, "p1"), placed!)).toEqual({ known: true, value: true });
  });

  it("ends with the Vigormortis: its death takes the HAS ABILITY and the neighbour's poison with it, and the Witch is inert again", () => {
    const next = kill(proofGame(ROLES2), "p3", "p2");
    const curse = planned(plan({ ...next, day: 3 } as StorytellerLobbyRecord, request({ ...next, day: 3 } as StorytellerLobbyRecord, "p3", "witch", { target: pick(next, "p1") })));
    const cursed = curse.players.p1!.effects.find((e) => e.type === "witchCurse")!;
    const gone = patchPlayer(curse, "p0", { alive: false });
    expect(query(gone).retainsAbility(bind(gone, "p3"))).toEqual({ known: true, value: false });
    expect(query(gone).effectApplies(bind(gone, "p1"), cursed)).toEqual({ known: true, value: false });
    const poison = poisonOn(gone, "p2")!;
    expect(query(gone).effectApplies(bind(gone, "p2"), poison)).toEqual({ known: true, value: false });
  });

  it("stops when the Minion becomes something else, an impaired Vigormortis pauses it, and poison follows", () => {
    const next = kill(proofGame(ROLES2), "p3", "p2");
    const poison = poisonOn(next, "p2")!;
    const changed = patchPlayer(next, "p3", { actualRole: "chef" });
    expect(query(changed).retainsAbility(bind(changed, "p3"))).toEqual({ known: true, value: false });
    expect(query(changed).effectApplies(bind(changed, "p2"), poison)).toEqual({ known: true, value: false });
    const paused = impair(next, "p0");
    expect(query(paused).retainsAbility(bind(paused, "p3"))).toEqual({ known: true, value: false });
    expect(query(next).effectApplies(bind(next, "p2"), poison)).toEqual({ known: true, value: true });
  });

  it("a non-Minion victim or a protected Minion gets no effect", () => {
    const g = proofGame(ROLES2);
    const non = planned(plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p2") })));
    expect(retained(non, "p2")).toBeUndefined();
  });

  it("persists (valid stored game, survives a JSON reload); the plan is pure, so the pre-kill game (the Undo snapshot) has none of it", async () => {
    const { StorytellerGamePersistedSchema } = await import("@/stores/schemas");
    const g = proofGame(ROLES2);
    const next = kill(g, "p3", "p2");
    const reloaded = JSON.parse(JSON.stringify(next)) as StorytellerLobbyRecord;
    expect(StorytellerGamePersistedSchema.safeParse(reloaded).success).toBe(true);
    expect(query(reloaded).retainsAbility(bind(reloaded, "p3"))).toEqual({ known: true, value: true });
    expect(retained(g, "p3")).toBeUndefined();
    expect(poisonOn(g, "p2")).toBeUndefined();
  });
});
