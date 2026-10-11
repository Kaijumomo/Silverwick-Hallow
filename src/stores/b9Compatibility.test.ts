import { describe, expect, it } from "vitest";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { canonicalRoles } from "@/data/canonical";
import { buildRegistry } from "@/data/roleRegistry";
import { bind, impair, patchPlayer, pick, proofEnv, proofGame, request } from "@/test/proofFixtures";
import { planAbilityResolution } from "./abilityResolution";
import { createRulesQuery } from "./rulesQuery";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { computeNightOrder } from "@/features/nightOrder/nightOrder";
import { scarletWomanSuccession } from "@/abilities/characters/scarletWoman";
import type { Script } from "./types";
import type { EffectRecord, StorytellerLobbyRecord } from "./types";

// Selectable roles are a script inventory, never a player count. Inactive
// other-script characters must not change a canonical in-play interaction.
describe("B9 independent custom-script and Spy boundaries", () => {
  it("a dying Recluse at the Scarlet Woman threshold keeps exceptional Demon registration manual", () => {
    const game = proofGame(["recluse", "scarletwoman", "imp", "chef", "monk"]);
    expect(scarletWomanSuccession(createRulesQuery(game, proofEnv()), bind(game, "p0"))).toMatchObject({ kind: "manual" });
    const poisoned = impair(game, "p0");
    expect(scarletWomanSuccession(createRulesQuery(poisoned, proofEnv()), bind(poisoned, "p0"))).toEqual({ kind: "none" });
    const belowThreshold = patchPlayer(game, "p4", { alive: false });
    expect(scarletWomanSuccession(createRulesQuery(belowThreshold, proofEnv()), bind(belowThreshold, "p0"))).toEqual({ kind: "none" });
    expect(game.players.p1!.actualRole).toBe("scarletwoman");
  });
  it.each([22, 25])("%i selectable roles preserve canonical Monk/Imp mechanics in a five-player game", size => {
    const script: Script = { id: `custom-${size}`, name: "Mixed catalog", characters: [...troubleBrewing.characters, ...canonicalRoles(["cultleader", "pithag", "alhadikhia"])].slice(0, size) };
    const env = proofEnv({ script, registry: buildRegistry(script) });
    const before = { ...proofGame(["monk", "imp", "chef", "soldier", "poisoner"]), scriptId: script.id };
    expect(script.characters).toHaveLength(size); expect(Object.keys(before.players)).toHaveLength(5);
    const protection = planAbilityResolution(before, request(before, "p0", "monk", { target: pick(before, "p2") }), env);
    expect(protection).toMatchObject({ ok: true, changed: true });
    if (!protection.ok || !protection.changed) throw new Error("Expected protection");
    const protectedGame = protection.plan.game;
    const attack = planAbilityResolution(protectedGame, request(protectedGame, "p1", "imp", { target: pick(protectedGame, "p2") }), env);
    expect(attack).toMatchObject({ ok: true });
    if (!attack.ok) throw new Error("Expected supported attack");
    const after = attack.changed ? attack.plan.game : protectedGame;
    expect(after.players.p2!.alive).toBe(true); expect(after.lifeEventWindow.events).toEqual([]);
    expect(before.players.p2!.effects).toEqual([]);
  });
  it("a custom definition borrowing Poisoner's ID cannot inherit official mechanics", () => {
    const script: Script = { ...troubleBrewing, id: "changed-owner", characters: troubleBrewing.characters.map(role => role.id === "poisoner" ? { ...role, ability: "A different custom ability." } : role) };
    const env = proofEnv({ script, registry: buildRegistry(script) });
    const game = { ...proofGame(["poisoner", "chef", "imp", "soldier", "monk"]), scriptId: script.id };
    expect(planAbilityResolution(game, request(game, "p0", "poisoner", { target: pick(game, "p1") }), env)).toMatchObject({ ok: false });
    expect(game.players.p1!.effects).toEqual([]);
  });
  it.each([1, 2])("Spy Night %i remains an ordinary official-instruction step without remote Grimoire data", day => {
    const game = proofGame(["spy", "drunk", "poisoner", "imp", "chef"], "night", day);
    const env = proofEnv(); const before = JSON.stringify(game);
    const steps = computeNightOrder(game.players, game.seatOrder, env.script!, day === 1, game);
    expect(steps.find(step => step.kind === "player" && step.effectiveRoleId === "spy")).toMatchObject({ effectiveRoleId: "spy" });
    expect(planAbilityResolution(game, request(game, "p0", "spy"), env)).toMatchObject({ ok: false });
    expect(JSON.stringify(game)).toBe(before);
    const secret = patchPlayer(impair(game, "p4"), "p1", { shownRole: "washerwoman", stNotes: "PRIVATE-SPY-AUDIT" });
    const publicRecord = projectLobbyToPublic(secret, {});
    const self = projectLobbyToSelfMap(secret, env.registry).p0;
    expect(self).toMatchObject({ shownRole: "spy" });
    for (const serialized of [JSON.stringify(publicRecord), JSON.stringify(self)]) {
      expect(serialized).not.toContain("PRIVATE-SPY-AUDIT");
      expect(serialized).not.toContain("actualRole");
      expect(serialized).not.toContain("effects");
      expect(serialized).not.toContain("reminders");
    }
  });
  it.each([true, false])("Spy registration remains discretionary alive=%s, and poisoning disables it", alive => {
    const game = patchPlayer(proofGame(["spy", "chef", "imp"]), "p0", { alive });
    const env = proofEnv();
    expect(createRulesQuery(game, env).registration(bind(game, "p0"), "washerwoman").character.known).toBe(false);
    const poisoned = impair(game, "p0");
    expect(createRulesQuery(poisoned, env).registration(bind(poisoned, "p0"), "washerwoman").character).toEqual({ known: true, value: "spy" });
    expect(game.players.p0!.actualRole).toBe("spy");
  });
});

describe("B9 independent self-poison rule boundary", () => {
  function selfPoison() {
    const game = proofGame(["poisoner", "chef", "imp", "soldier", "monk"]);
    const result = planAbilityResolution(game, request(game, "p0", "poisoner", { target: pick(game, "p0") }, { withStep: true, completeStep: true }), proofEnv());
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok || !result.changed) throw new Error("Expected self-poison");
    return result.plan.game;
  }
  const sourcePoison = (game: StorytellerLobbyRecord, sourceId: string, id: string): EffectRecord => ({
    id, type: "poisoned", state: "active", appliedAt: { phase: "night", day: 2 }, lifetime: { kind: "throughFollowingDay" }, expiry: { kind: "at", moment: { phase: "night", day: 3 } },
    sourceCharacter: "poisoner", sourceParticipant: { kind: "participant", ...bind(game, sourceId), nameAtTime: sourceId },
  });
  it("self-poison is applicable while its source ability is disabled, without recursion or stored exceptions", () => {
    const game = selfPoison(); const snapshot = JSON.stringify(game); const query = createRulesQuery(game, proofEnv());
    for (let i = 0; i < 20; i++) {
      expect(query.effectApplies(bind(game, "p0"), game.players.p0!.effects[0]!)).toEqual({ known: true, value: true });
      expect(query.abilityFunctions(bind(game, "p0"))).toEqual({ known: true, value: false });
    }
    expect(JSON.stringify(game)).toBe(snapshot); expect(game.players.p0!.effects).toHaveLength(1);
    expect(game.players.p0!.effects[0]).not.toHaveProperty("selfPoison");
  });
  it("a second living Poisoner suppresses the self-effect; source death restores the same retained self-effect", () => {
    const self = selfPoison(); const own = self.players.p0!.effects[0]!;
    let game = patchPlayer(self, "p1", { actualRole: "poisoner", shownRole: "poisoner" });
    game = patchPlayer(game, "p0", { effects: [own, sourcePoison(game, "p1", "outside-poison")] });
    expect(createRulesQuery(game, proofEnv()).effectApplies(bind(game, "p0"), own)).toEqual({ known: true, value: false });
    const sourceDead = patchPlayer(game, "p1", { alive: false });
    expect(createRulesQuery(sourceDead, proofEnv()).effectApplies(bind(sourceDead, "p0"), own)).toEqual({ known: true, value: true });
    expect(sourceDead.players.p0!.effects[0]).toBe(own);
  });
  it("mutual poisoning is still unknown; the self-effect rule is not a general cycle solver", () => {
    let game = proofGame(["poisoner", "poisoner", "imp", "chef", "monk"]);
    game = patchPlayer(game, "p0", { effects: [sourcePoison(game, "p1", "one")] });
    game = patchPlayer(game, "p1", { effects: [sourcePoison(game, "p0", "two")] });
    const query = createRulesQuery(game, proofEnv());
    expect(query.abilityFunctions(bind(game, "p0")).known).toBe(false);
    expect(query.abilityFunctions(bind(game, "p1")).known).toBe(false);
  });
  it("a same-seat foreign participant cannot use the self-effect exception", () => {
    const game = selfPoison(); const own = game.players.p0!.effects[0]!;
    const changed = patchPlayer(game, "p0", { participantId: "new-participation" });
    expect(createRulesQuery(changed, proofEnv()).effectApplies(bind(changed, "p0"), own).known).toBe(false);
  });
});
