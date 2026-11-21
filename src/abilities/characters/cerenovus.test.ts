// SV-4a -- Cerenovus: "Each night, choose a player & a good character: they are 'mad' that they are this character tomorrow, or might be
// executed." https://wiki.bloodontheclocktower.com/Cerenovus -- production semantics, the real coordinator and the real store.
import { beforeEach, describe, expect, it } from "vitest";
import { CERENOVUS, CERENOVUS_CHARACTER, CERENOVUS_TARGET, MAD_CHARACTER_PARAMETER } from "./cerenovus";
import { bind, homebrewEnv, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, proofQuery, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { participantStepKey } from "@/stores/nightProgress";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { resolveEffectExpiry } from "@/stores/effectResolution";
import { officialEffectPresentation } from "@/features/reminders/officialReminderPresentation";
import { playerMarks } from "@/features/grimoire-v6/board/marks";
import { applyLifePlan, planLifeTransaction } from "@/stores/lifeResolution";
import { applyRolePlan, changeRoleIntent, defaultRoleIds, planRoleTransaction } from "@/stores/roleResolution";
import type { AbilityInputValue } from "@/abilities/semantics";
import type { EffectRecord, StorytellerLobbyRecord } from "@/stores/types";

// p0 cerenovus, p1 imp, p2 chef, p3 empath, p4 witch, p5 saint, p6 monk
const ROLES = ["cerenovus", "imp", "chef", "empath", "witch", "saint", "monk"];
const game = () => store.getState().game!;
const character = (roleId: string): AbilityInputValue => ({ kind: "character", roleIds: [roleId] });
const choose = (g: StorytellerLobbyRecord, target: string, roleId: string, actor = "p0") =>
  plan(g, request(g, actor, "cerenovus", { [CERENOVUS_TARGET]: pick(g, target), [CERENOVUS_CHARACTER]: character(roleId) }, { withStep: true, completeStep: true }));
const madOn = (g: StorytellerLobbyRecord, id: string): EffectRecord[] => g.players[id]!.effects.filter((e) => e.type === "mad");
const applies = (g: StorytellerLobbyRecord, id: string, effect: EffectRecord) => proofQuery(g).effectApplies(bind(g, id), effect);
const step = (g: StorytellerLobbyRecord, id: string) => g.nightProgress[`${g.day}:${participantStepKey(g.players[id]!.participantId!, "cerenovus")}`]?.status;
const env = (g: StorytellerLobbyRecord) => ({ game: g, script: proofScript, registry: proofRegistry, query: proofQuery(g) });

beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));

describe("Cerenovus -- the choice", () => {
  it("records one sourced MAD on the chosen player, with the character, on every night including the first", () => {
    for (const day of [1, 2, 5]) {
      const g = proofGame(ROLES, "night", day);
      const next = planned(choose(g, "p2", "sage"));
      expect(madOn(next, "p2")).toEqual([expect.objectContaining({
        type: "mad", state: "active", sourceCharacter: "cerenovus", lifetime: { kind: "nights", count: 2 },
        sourceParticipant: { kind: "participant", playerId: "p0", participantId: g.players.p0!.participantId, nameAtTime: expect.anything() },
        parameters: { [MAD_CHARACTER_PARAMETER]: { kind: "role", roleIds: ["sage"] } },
        appliedAt: { phase: "night", day },
      })]);
      expect(step(next, "p0")).toBe("done");
      // Nobody else is touched, and the Cerenovus keeps their own character and alignment.
      for (const id of ["p0", "p1", "p3", "p4", "p5", "p6"]) expect(madOn(next, id)).toEqual([]);
      expect(next.players.p0).toMatchObject({ actualRole: "cerenovus", actualAlignment: "evil" });
    }
  });

  it("MAD ends on entry to the Day after the following night (PO 2026-11-12), and applies while the Cerenovus functions", () => {
    for (const day of [1, 3]) {
      const next = planned(choose(proofGame(ROLES, "night", day), "p2", "sage"));
      const effect = madOn(next, "p2")[0]!;
      expect(effect.expiry).toEqual({ kind: "at", moment: { phase: "day", day: day + 1 } });
      expect(resolveEffectExpiry(effect.lifetime, { phase: "night", day })).toEqual(effect.expiry);
      expect(applies(next, "p2", effect)).toEqual({ known: true, value: true });
    }
  });

  it("any player may be chosen: a dead one, an evil one, a Demon, the Cerenovus themself (the page: the ability can affect dead players)", () => {
    for (const [id, patch] of [["p2", { alive: false }], ["p1", {}], ["p0", {}]] as const) {
      const g = patchPlayer(proofGame(ROLES), id, patch);
      const next = planned(choose(g, id, "chef"));
      expect(madOn(next, id)).toHaveLength(1);
    }
  });

  it("a Townsfolk or an Outsider of the script may be chosen, in play or not; a Minion, a Demon, a Traveller or two characters are refused", () => {
    const g = proofGame(ROLES);
    for (const roleId of ["sage", "chef", "saint", "klutz", "artist", "sweetheart"]) expect(madOn(planned(choose(g, "p2", roleId)), "p2")[0]!.parameters![MAD_CHARACTER_PARAMETER]).toEqual({ kind: "role", roleIds: [roleId] });
    for (const roleId of ["imp", "witch", "cerenovus"]) expect(choose(g, "p2", roleId), roleId).toMatchObject({ ok: false, code: "illegal" });
    // A character the script does not have is refused too.
    expect(choose(g, "p2", "nobody-here")).toMatchObject({ ok: false });
    // A Traveller is not a Townsfolk or an Outsider either (it is refused before anything changes).
    expect(choose(g, "p2", "scapegoat")).toMatchObject({ ok: false });
    expect(plan(g, request(g, "p0", "cerenovus", { [CERENOVUS_TARGET]: pick(g, "p2"), [CERENOVUS_CHARACTER]: { kind: "character", roleIds: ["sage", "chef"] } }, { withStep: true, completeStep: true })))
      .toMatchObject({ ok: false, code: "illegal" });
  });

  it("a new pick on the same player replaces the earlier MAD; MAD on other players stays (two mad on the second night)", () => {
    const first = planned(choose(proofGame(ROLES, "night", 1), "p2", "sage"));
    const second = planned(choose({ ...first, day: 2 }, "p3", "chef"));
    expect(madOn(second, "p2")).toHaveLength(1);
    expect(madOn(second, "p3")).toHaveLength(1);
    const again = planned(choose({ ...second, day: 3 }, "p2", "saint"));
    expect(madOn(again, "p2")).toHaveLength(1);
    expect(madOn(again, "p2")[0]!.parameters![MAD_CHARACTER_PARAMETER]).toEqual({ kind: "role", roleIds: ["saint"] });
    expect(madOn(again, "p3")).toHaveLength(1);
  });

  it("drunk or poisoned, or a Drunk shown the Cerenovus: the choice is made, the step completes, nobody goes mad", () => {
    for (const type of ["drunk", "poisoned"]) {
      const next = planned(choose(impair(proofGame(ROLES), "p0", type), "p2", "sage"));
      expect(madOn(next, "p2")).toEqual([]);
      expect(step(next, "p0")).toBe("done");
    }
    const drunk = patchPlayer(proofGame(ROLES), "p0", { actualRole: "drunk", shownRole: "cerenovus", behaviorMode: "drunk_fake_role_behavior", actualAlignment: "good" });
    const result = choose(drunk, "p2", "sage");
    expect(result).toMatchObject({ ok: true });
    if (result.ok && result.changed) expect(madOn(result.plan.game, "p2")).toEqual([]);
  });

  it("a dead Cerenovus has no choice to make; a homebrew Cerenovus inherits nothing", () => {
    expect(choose(patchPlayer(proofGame(ROLES), "p0", { alive: false }), "p2", "sage")).toMatchObject({ ok: false, code: "notApplicable" });
    const g = proofGame(ROLES);
    expect(plan(g, { ...request(g, "p0", "cerenovus", { [CERENOVUS_TARGET]: pick(g, "p2"), [CERENOVUS_CHARACTER]: character("sage") }, { withStep: true, completeStep: true }) }, homebrewEnv("cerenovus")))
      .toMatchObject({ ok: false, code: "unsupported" });
  });

  it("the descriptor: every night, a player and a character", () => {
    expect(CERENOVUS).toMatchObject({ roleId: "cerenovus", timing: ["firstNight", "otherNight"], invocation: "wake", usage: { kind: "unlimited" },
      sourcedEffects: [{ type: "mad", persistence: "whileSourceFunctions" }] });
    expect(CERENOVUS.inputs.map((input) => [input.id, input.kind])).toEqual([[CERENOVUS_TARGET, "participant"], [CERENOVUS_CHARACTER, "character"]]);
  });
});

describe("Cerenovus -- MAD applies only while the Cerenovus functions (PO Q3), derived live", () => {
  const madeMad = () => planned(choose(proofGame(ROLES), "p2", "sage"));

  it("a dead, drunk, poisoned or changed Cerenovus stops it; a sober living one starts it again; nothing is rewritten", () => {
    const next = madeMad();
    const effect = madOn(next, "p2")[0]!;
    for (const lost of [patchPlayer(next, "p0", { alive: false }), impair(next, "p0"), impair(next, "p0", "drunk"), patchPlayer(next, "p0", { actualRole: "chef" })]) {
      expect(applies(lost, "p2", effect)).toEqual({ known: true, value: false });
      expect(madOn(lost, "p2")).toEqual([effect]);
    }
    expect(applies(next, "p2", effect)).toEqual({ known: true, value: true });
  });

  it("a Cerenovus the Vigormortis killed still functions, so its MAD keeps applying", () => {
    const next = planned(choose(proofGame(["cerenovus", "imp", "chef", "empath", "vigormortis", "saint", "monk"]), "p2", "sage"));
    const effect = madOn(next, "p2")[0]!;
    const vigormortis = next.players.p4!;
    const killed = patchPlayer(next, "p0", { alive: false, effects: [{ id: "fx-keep", type: "retainsAbility", state: "active", lifetime: { kind: "manual" }, expiry: { kind: "none" },
      sourceCharacter: "vigormortis", sourceParticipant: { kind: "participant", playerId: "p4", participantId: vigormortis.participantId!, nameAtTime: "x" } } as unknown as EffectRecord] });
    expect(applies(killed, "p2", effect)).toEqual({ known: true, value: true });
    expect(proofQuery(killed).abilityFunctions(bind(killed, "p0"))).toEqual({ known: true, value: true });
  });

  it("a Cerenovus's death or change of character takes its MAD away through the shared source-ability loss; the madness of another Cerenovus stays", () => {
    const g = planned(choose(proofGame(["cerenovus", "imp", "chef", "empath", "cerenovus", "saint", "monk"]), "p2", "sage"));
    const other = planned(choose({ ...g, day: 2 }, "p3", "chef", "p4"));
    const environment = { script: proofScript, registry: proofRegistry };
    const died = planLifeTransaction(other, { intents: [{ kind: "death", playerId: "p0" }] }, undefined, environment);
    if (!died.ok || !died.changed) throw new Error("Expected death");
    const afterDeath = applyLifePlan(other, died.plan);
    expect(madOn(afterDeath, "p2")).toEqual([]);
    expect(madOn(afterDeath, "p3")).toHaveLength(1);
    const changed = planRoleTransaction(other, { intents: [changeRoleIntent(other.players.p0!, "empath")] }, { script: proofScript, ids: defaultRoleIds });
    if (!changed.ok || !changed.changed) throw new Error("Expected change");
    expect(madOn(applyRolePlan(other, changed.plan), "p2")).toEqual([]);
  });
});

describe("Cerenovus -- the official MAD token, privacy and storage", () => {
  it("the board draws the official MAD token with the character on its detail line", () => {
    const next = planned(choose(proofGame(ROLES), "p2", "sage"));
    const presentation = officialEffectPresentation(next.players.p2!, { query: proofQuery(next), target: bind(next, "p2") });
    expect(presentation.fallback).toEqual([]);
    expect(presentation.tokens).toHaveLength(1);
    expect(presentation.tokens[0]).toMatchObject({ key: "cerenovus:mad", label: "Mad", about: "Sage", detail: "Mad about being the Sage" });
    const marks = playerMarks(env(next), next.players.p2!);
    expect(marks.map((m) => [m.key, m.label, m.title])).toEqual([["effect:cerenovus:mad", "Mad", "Cerenovus: Mad about being the Sage"]]);
    // Not applying (the Cerenovus is drunk): the token stays, and the line says so.
    const impaired = impair(next, "p0", "drunk");
    expect(officialEffectPresentation(impaired.players.p2!, { query: proofQuery(impaired), target: bind(impaired, "p2") }).tokens[0]!.detail)
      .toBe("Mad about being the Sage: Not currently affecting this player");
    // A hand-placed MAD reminder (notation) is unchanged: no tracked character.
    expect(next.players.p3!.reminders).toEqual([]);
  });

  it("neither MAD nor the madness character reaches the player projections or the Public Display", () => {
    const g = proofGame(ROLES);
    const next = planned(choose(g, "p2", "sage"));
    // Exactly what it was before the choice: the projections carry no Effects, reminders or tokens of this kind.
    expect(projectLobbyToSelfMap(next, proofRegistry)).toEqual(projectLobbyToSelfMap(g, proofRegistry));
    expect(projectLobbyToPublic(next, {})).toEqual(projectLobbyToPublic(g, {}));
    for (const projected of [JSON.stringify(projectLobbyToPublic(next, {})), JSON.stringify(projectLobbyToSelfMap(next, proofRegistry))]) {
      expect(projected).not.toMatch(/"mad"|madness|nights/);
    }
  });

  it("the stored game stays in the existing format (no version change); a reload keeps the MAD", () => {
    const next = planned(choose(proofGame(ROLES), "p2", "sage"));
    const parsed = StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(next)));
    expect(parsed.success).toBe(true);
    expect(next.gameSchemaVersion).toBe(29);
  });

  it("one commit, one Undo: the store's resolution restores the game exactly", () => {
    const g = proofGame(ROLES);
    openInStore(g);
    const result = store.getState().resolveAbility(request(g, "p0", "cerenovus", { [CERENOVUS_TARGET]: pick(g, "p2"), [CERENOVUS_CHARACTER]: character("sage") }, { withStep: true, completeStep: true }));
    expect(result).toMatchObject({ ok: true });
    expect(madOn(game(), "p2")).toHaveLength(1);
    expect(store.getState().undoStack).toHaveLength(1);
    store.getState().undo();
    expect(madOn(game(), "p2")).toEqual([]);
    expect(step(game(), "p0")).toBeUndefined();
  });
});
