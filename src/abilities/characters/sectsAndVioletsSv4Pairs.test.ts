// SV-4 pair record (docs/ai/SECTS_AND_VIOLETS_SV4_PAIRS.md): the Cerenovus and the Evil Twin against the rest of Sects & Violets.
// Production semantics, the real coordinator. https://wiki.bloodontheclocktower.com/Cerenovus, https://wiki.bloodontheclocktower.com/Evil_Twin
import { describe, expect, it } from "vitest";
import { CERENOVUS_CHARACTER, CERENOVUS_TARGET } from "./cerenovus";
import { patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, proofEnv, request } from "@/test/proofFixtures";
import { computeNightOrder } from "@/rules/night/nightOrder";
import { goodTwinIntents, twinPairOf } from "@/stores/twinPair";
import { applyEffectPlan, planEffectTransaction } from "@/stores/effectResolution";
import { endGameEligibility, twinGoodWinBlock } from "@/stores/endGameEligibility";
import { REVIEWED_INTERACTION_ROLES } from "./passiveRules";
import type { StorytellerLobbyRecord } from "@/stores/types";

const step = { withStep: true, completeStep: true } as const;
// The good characters of Sects & Violets (the Cerenovus names a Townsfolk or an Outsider; the Evil Twin's Good Twin is any good player).
const TOWNSFOLK = ["clockmaker", "dreamer", "snakecharmer", "mathematician", "flowergirl", "towncrier", "oracle", "savant", "seamstress", "philosopher", "artist", "juggler", "sage"];
const OUTSIDERS = ["mutant", "sweetheart", "barber", "klutz"];
const EVIL_OTHERS = ["witch", "pithag", "fanggu", "nodashii", "vigormortis", "vortox"];
const bindOf = (g: StorytellerLobbyRecord, id: string) => ({ playerId: id, participantId: g.players[id]!.participantId! });
const choose = (g: StorytellerLobbyRecord, roleId: string) => plan(g, request(g, "p0", "cerenovus", { [CERENOVUS_TARGET]: pick(g, "p2"), [CERENOVUS_CHARACTER]: { kind: "character", roleIds: [roleId] } }, step));
function twinned(g: StorytellerLobbyRecord, evil: string, good: string): StorytellerLobbyRecord {
  const built = goodTwinIntents(g, bindOf(g, evil), bindOf(g, good));
  if (!built.ok) throw new Error(built.message);
  const result = planEffectTransaction(g, { intents: built.intents }, { historyId: () => "h", effectId: () => "fx" });
  if (!result.ok || !result.changed) throw new Error("not a changing plan");
  return applyEffectPlan(g, result.plan);
}

describe("SV-4 pairs: the Cerenovus against every character of the script", () => {
  it("the reviewed list holds every character of Sects & Violets, so nothing gates the choice", () => {
    for (const role of proofScript.characters.filter((r) => ["townsfolk", "outsider", "minion", "demon"].includes(r.type))) {
      if (!["clockmaker", ...TOWNSFOLK, ...OUTSIDERS, "cerenovus", "eviltwin", ...EVIL_OTHERS].includes(role.id)) continue;
      expect(REVIEWED_INTERACTION_ROLES.has(role.id), role.id).toBe(true);
    }
  });
  it("with any other character of the script in play, the choice is guided", () => {
    for (const other of [...TOWNSFOLK, ...OUTSIDERS, ...EVIL_OTHERS, "eviltwin"]) {
      expect(choose(proofGame(["cerenovus", "imp", "chef", "monk", other]), "sage"), other).toMatchObject({ ok: true, changed: true });
    }
  });
  it("every good character of the script may be the character the player is mad about", () => {
    for (const roleId of [...TOWNSFOLK, ...OUTSIDERS]) {
      const next = planned(choose(proofGame(["cerenovus", "imp", "chef", "empath", "monk"]), roleId));
      expect(next.players.p2!.effects.filter((e) => e.type === "mad"), roleId).toHaveLength(1);
    }
  });
});

describe("SV-4 pairs: the Evil Twin against every character of the script", () => {
  it("every good character of the script can be the Good Twin: the pair stands and good cannot win while both live", () => {
    for (const roleId of [...TOWNSFOLK, ...OUTSIDERS]) {
      const g = twinned(proofGame(["eviltwin", "imp", roleId, "empath", "monk"], "day", 2), "p0", "p2");
      expect(twinPairOf(g.players), roleId).toMatchObject({ kind: "single", valid: true });
      expect(twinGoodWinBlock(g, proofEnv())?.kind, roleId).toBe("blocked");
    }
  });
  it("no other evil character can be chosen as the Good Twin (the same alignment)", () => {
    for (const roleId of [...EVIL_OTHERS, "cerenovus"]) {
      const g = proofGame(["eviltwin", "imp", "chef", "empath", roleId], "night", 1);
      expect(goodTwinIntents(g, bindOf(g, "p0"), bindOf(g, "p4")), roleId).toMatchObject({ ok: false });
    }
  });
  it("the Evil Twin keeps its Night row beside every other character of the script", () => {
    for (const other of [...TOWNSFOLK, ...OUTSIDERS, ...EVIL_OTHERS, "cerenovus"]) {
      const g = twinned(proofGame(["eviltwin", "imp", "chef", "monk", other], "night", 1), "p0", "p2");
      const rows = computeNightOrder(g.players, g.seatOrder, proofScript, true, g).flatMap((s) => s.kind === "player" ? [s.effectiveRoleId] : []);
      expect(rows, other).toContain("eviltwin");
    }
  });
  it("a game with any other character of the script in play: no ending proposed while the game goes on (SV-5o: every S&V character is now on the game-ending list)", () => {
    for (const other of [...TOWNSFOLK, ...OUTSIDERS, ...EVIL_OTHERS]) {
      const g = twinned(proofGame(["eviltwin", "imp", "chef", "monk", other], "day", 2), "p0", "p2");
      // A second Demon beside the Imp: "Multiple Demons need manual adjudication".
      const demon = ["fanggu", "nodashii", "vigormortis", "vortox"].includes(other);
      expect(endGameEligibility(g, proofEnv()).kind, other).toBe(demon ? "unknown" : "none");
    }
  });
  it("beside the Cerenovus both run: the Cerenovus's choice and the Evil Twin's introduction, in the night order", () => {
    const g = twinned(proofGame(["eviltwin", "cerenovus", "chef", "empath", "monk"], "night", 1), "p0", "p2");
    const rows = computeNightOrder(g.players, g.seatOrder, proofScript, true, g).flatMap((s) => s.kind === "player" ? [s.effectiveRoleId] : []);
    expect(rows).toEqual(expect.arrayContaining(["eviltwin", "cerenovus"]));
    // A good Twin made mad is still the Good Twin: the pair is read from alignments, not from what they believe.
    const mad = planned(plan(g, request(g, "p1", "cerenovus", { [CERENOVUS_TARGET]: pick(g, "p2"), [CERENOVUS_CHARACTER]: { kind: "character", roleIds: ["sage"] } }, step)));
    expect(twinPairOf(mad.players)).toMatchObject({ valid: true });
    expect(twinPairOf(patchPlayer(mad, "p2", { alive: false }).players)).toMatchObject({ valid: true });
    expect(proofRegistry.get("eviltwin")).toBeTruthy();
  });
});
