// SV-5 part 5: the endings of a Sects & Violets game. The app proposes, the Storyteller confirms: no winner is recorded or preselected
// and the game never ends by itself. SV-5o puts all 25 Sects & Violets characters on the reviewed game-ending list
// (docs/ai/SECTS_AND_VIOLETS_SV5H_PAIRS.md).
import { beforeEach, describe, expect, it } from "vitest";
import { patchPlayer, proofEnv, proofGame } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "./storytellerStore";
import { endGameEligibility } from "./endGameEligibility";
import { victoryCoverageEligibility } from "./victoryEvidence";
import { FANG_GU_ONCE, KLUTZ_CHOICE_RULING, MASTERMIND_FINAL_DAY, PIT_HAG_ARBITRARY_DEATHS, VORTOX_WORKING_AT_DUSK } from "./gameRuleFactRegistry";
import { ENDING_EVIDENCE_ROLES } from "@/abilities/coverageEvidence";
import type { GameRuleFactRecord, StorytellerLobbyRecord } from "./types";

const env = proofEnv();
export const SECTS_AND_VIOLETS = ["clockmaker", "dreamer", "snakecharmer", "mathematician", "flowergirl", "towncrier", "oracle", "savant", "seamstress", "philosopher", "artist", "juggler", "sage",
  "mutant", "sweetheart", "barber", "klutz", "eviltwin", "witch", "cerenovus", "pithag", "fanggu", "vigormortis", "nodashii", "vortox"];
const DEMONS = ["fanggu", "vigormortis", "nodashii", "vortox"];
const withFact = (g: StorytellerLobbyRecord, type: string, recordedAt: GameRuleFactRecord["recordedAt"] = { phase: g.phase as "day" | "night", day: g.day }): StorytellerLobbyRecord =>
  ({ ...g, gameRuleFacts: [...g.gameRuleFacts, { type, recordedAt }] });
const gained = (g: StorytellerLobbyRecord, id: string, character: string): StorytellerLobbyRecord => patchPlayer(g, id, { effects: [...g.players[id]!.effects, {
  id: `fx-gained-${id}`, type: "gainedAbility", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: g.phase, day: g.day },
  sourceParticipant: { kind: "participant", playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: g.players[id]!.name }, sourceCharacter: g.players[id]!.actualRole,
  parameters: { character: { kind: "role", roleIds: [character] } } } as never] });

beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));

describe("SV-5o: all 25 Sects & Violets characters on the game-ending list", () => {
  it("the list holds every one of them, and the coverage mirror says the same", () => {
    expect(SECTS_AND_VIOLETS).toHaveLength(25);
    for (const role of SECTS_AND_VIOLETS) expect(ENDING_EVIDENCE_ROLES, role).toContain(role);
  });

  it.each(SECTS_AND_VIOLETS.filter((role) => !DEMONS.includes(role)))("%s seated: the ending is read by the rules (two alive: evil wins)", (role) => {
    const g = patchPlayer(patchPlayer(proofGame(["vortox", role, "oracle", "dreamer"], "day", 3), "p2", { alive: false }), "p3", { alive: false });
    expect(victoryCoverageEligibility(g, env)).toEqual({ kind: "automated" });
    expect(endGameEligibility(g, env)).toEqual({ kind: "verified", team: "evil", reason: "twoAlive" });
  });

  it.each(DEMONS)("the %s as the Demon: two alive, evil wins", (demon) => {
    const g = patchPlayer(proofGame([demon, "sage", "oracle", "witch"], "night", 3), "p2", { alive: false });
    expect(endGameEligibility(patchPlayer(g, "p3", { alive: false }), env)).toEqual({ kind: "verified", team: "evil", reason: "twoAlive" });
    // Three alive, the Demon among them: nothing to propose.
    expect(endGameEligibility(g, env)).toEqual({ kind: "none" });
  });

  it("a whole Sects & Violets table (one Demon) is covered: nothing proposed while the game goes on", () => {
    const g = proofGame(SECTS_AND_VIOLETS.filter((role) => !DEMONS.includes(role) || role === "vortox"), "day", 2);
    expect(victoryCoverageEligibility(g, env)).toEqual({ kind: "automated" });
    expect(endGameEligibility(g, env)).toEqual({ kind: "none" });
  });

  it("a character from outside Trouble Brewing and Sects & Violets still makes the ending manual (the Zombuul, the Mastermind)", () => {
    for (const role of ["zombuul", "mastermind", "lunatic"]) expect(victoryCoverageEligibility(proofGame(["vortox", role, "oracle"], "day", 2), env).kind, role).toBe("manual");
  });

  describe("game-rule facts", () => {
    const two = () => patchPlayer(patchPlayer(proofGame(["fanggu", "sage", "oracle", "witch"], "day", 3), "p2", { alive: false }), "p1", { alive: false });
    it("the Fang Gu's ONCE (a jump happened) and the Vortox's dusk fact are reviewed: they do not make the ending manual", () => {
      expect(endGameEligibility(withFact(two(), FANG_GU_ONCE), env)).toMatchObject({ kind: "verified", team: "evil" });
      const night = patchPlayer(patchPlayer(proofGame(["vortox", "sage", "oracle", "witch"], "night", 3), "p2", { alive: false }), "p1", { alive: false });
      expect(endGameEligibility(withFact(night, VORTOX_WORKING_AT_DUSK, { phase: "day", day: 2 }), env)).toMatchObject({ kind: "verified", team: "evil" });
    });
    it("the Pit-Hag's arbitrary deaths, the Klutz's choice and the Mastermind's final day keep it manual", () => {
      expect(endGameEligibility(withFact({ ...two(), phase: "night" }, PIT_HAG_ARBITRARY_DEATHS), env)).toMatchObject({ kind: "unknown" });
      expect(endGameEligibility(withFact(two(), KLUTZ_CHOICE_RULING), env)).toMatchObject({ kind: "unknown" });
      expect(endGameEligibility(withFact(two(), MASTERMIND_FINAL_DAY), env)).toMatchObject({ kind: "unknown" });
    });
  });

  describe("the Philosopher's gained ability", () => {
    const base = () => patchPlayer(patchPlayer(proofGame(["nodashii", "philosopher", "oracle", "witch"], "day", 3), "p2", { alive: false }), "p3", { alive: false });
    it("a Sects & Violets ability gained: still read by the rules", () => {
      expect(endGameEligibility(gained(base(), "p1", "oracle"), env)).toMatchObject({ kind: "verified", team: "evil" });
    });
    it.each(["saint", "mayor", "fisherman"])("the %s's ability gained: manual (its ending rule is read from the seat's own character, or it is not reviewed)", (role) => {
      expect(endGameEligibility(gained(base(), "p1", role), env)).toMatchObject({ kind: "unknown" });
    });
  });
});
