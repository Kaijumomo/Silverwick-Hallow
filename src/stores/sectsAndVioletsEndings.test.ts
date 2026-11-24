// SV-5 part 5: the endings of a Sects & Violets game. The app proposes, the Storyteller confirms: no winner is recorded or preselected
// and the game never ends by itself. SV-5o puts all 25 Sects & Violets characters on the reviewed game-ending list
// (docs/ai/SECTS_AND_VIOLETS_SV5H_PAIRS.md).
import { beforeEach, describe, expect, it } from "vitest";
import { impair, openInStore, patchPlayer, proofEnv, proofGame } from "@/test/proofFixtures";
import { participantRefOf } from "./participants";
import { captureResolvedDemonDeath, validVictoryEvidence, type ResolvedDemonDeathMode } from "./victoryEvidence";
import { StorytellerGamePersistedSchema } from "./schemas";
import { endHint } from "@/features/grimoire-v6/vm/chrome";
import type { V6Ctx } from "@/features/grimoire-v6/ctx";
import { useStorytellerStore as store } from "./storytellerStore";
import { endGameEligibility } from "./endGameEligibility";
import { victoryCoverageEligibility } from "./victoryEvidence";
import { RESOLVED_DEMON_DEATH_NO_SUCCESSOR, FANG_GU_ONCE, KLUTZ_CHOICE_RULING, KLUTZ_EVIL_TEAM_LOST, KLUTZ_GOOD_TEAM_LOST, MASTERMIND_FINAL_DAY, PIT_HAG_ARBITRARY_DEATHS, VORTOX_WORKING_AT_DUSK } from "./gameRuleFactRegistry";
import { ENDING_EVIDENCE_ROLES } from "@/abilities/coverageEvidence";
import type { CurrentParticipantRef, GameRuleFactRecord, StorytellerLobbyRecord } from "./types";

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
    it("the Pit-Hag's arbitrary deaths and the Mastermind's final day keep it manual; the Klutz's ruling withholds it on its Day", () => {
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

describe("SV-5p: the Demon-death proof for the four Sects & Violets Demons (Day executions and the Slayer's shot only, Q20 A)", () => {
  const state = () => store.getState();
  const game = () => state().game!;
  const ctx = (g: StorytellerLobbyRecord) => ({ game: g, script: env.script, registry: env.registry, privacy: false }) as unknown as V6Ctx;
  /** A death of p0 recorded by hand (the same shape the commands record), for the capture's mode-by-mode reading. */
  const died = (g: StorytellerLobbyRecord, execution: boolean): StorytellerLobbyRecord => ({ ...patchPlayer(g, "p0", { alive: false }), lifeEventWindow: { ...g.lifeEventWindow, events: [...g.lifeEventWindow.events,
    { id: "death-p0", subject: participantRefOf(g, "p0") as CurrentParticipantRef, actualRoleAtEvent: g.players.p0!.actualRole,
      ...(execution ? { kind: "execution" as const, outcome: "died" as const, moment: { phase: "day" as const, day: g.day } } : { kind: "death" as const, moment: { phase: g.phase as "day" | "night", day: g.day } }) }] } });
  const capture = (g: StorytellerLobbyRecord, mode: ResolvedDemonDeathMode, execution = true) => {
    const result = captureResolvedDemonDeath(g, died(g, execution), "death-p0", env, mode);
    if (!result.ok) throw new Error(result.message);
    return result.game;
  };

  it.each(DEMONS)("the %s executed on the Day: proved, \"The Demon is dead. Good wins\" (the Storyteller still ends the game)", (demon) => {
    openInStore(proofGame([demon, "sage", "oracle", "witch", "dreamer"], "day", 2));
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    expect(game().gameRuleFacts).toEqual([expect.objectContaining({ type: RESOLVED_DEMON_DEATH_NO_SUCCESSOR, provenance: expect.objectContaining({ sourceCharacter: demon }) })]);
    expect(endGameEligibility(game(), env)).toEqual({ kind: "verified", team: "good", reason: "demonDeath" });
    expect(endHint(ctx(game()))).toBe("The Demon is dead. Good wins");
    expect(game().phase).toBe("day");
    expect(game().result).toBeUndefined();
    expect(StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(game()))).success).toBe(true);
    // Kept through the following Night (the Life Event's own window), then gone with it.
    expect(state().advancePhase()).toMatchObject({ ok: true });
    expect(endGameEligibility(game(), env)).toMatchObject({ kind: "verified", team: "good" });
    // Undo restores the living Demon: nothing proved.
    state().undo(); state().undo();
    expect(game().players.p0!.alive).toBe(true);
    expect(game().gameRuleFacts).toEqual([]);
  });

  it.each(DEMONS)("the %s killed by the Slayer's shot on the Day: proved", (demon) => {
    expect(capture(proofGame([demon, "slayer", "oracle", "witch"], "day", 2), "automaticSlayer", false).gameRuleFacts).toHaveLength(1);
  });

  it.each(DEMONS)("the %s dying at night is not proved: \"Check whether the game has ended\"", (demon) => {
    const night = proofGame([demon, "sage", "oracle", "witch"], "night", 3);
    for (const mode of ["recordedNight", "automaticImp"] as const) expect(capture(night, mode, false).gameRuleFacts, mode).toEqual([]);
    openInStore(night);
    expect(state().recordDeath("p0")).toMatchObject({ ok: true });
    expect(game().gameRuleFacts).toEqual([]);
    expect(endGameEligibility(game(), env)).toMatchObject({ kind: "unknown" });
    expect(endHint(ctx(game()))).toBe("The Demon is dead. Check whether the game has ended");
  });

  it.each(DEMONS)("the %s dying on the Day by anything but an execution or the Slayer's shot (a Witch's curse) is not proved", (demon) => {
    const g = proofGame([demon, "witch", "oracle", "sage", "dreamer"], "day", 2);
    expect(capture(g, "recordedDay", false).gameRuleFacts).toEqual([]);
    openInStore(g);
    expect(state().recordDeath("p0")).toMatchObject({ ok: true });
    expect(game().gameRuleFacts).toEqual([]);
    expect(endHint(ctx(game()))).toBe("The Demon is dead. Check whether the game has ended");
  });

  it("a forged night proof for a Sects & Violets Demon is refused on load", () => {
    const day = capture(proofGame(["fanggu", "sage", "oracle", "witch"], "day", 2), "recordedDay");
    const fact = day.gameRuleFacts[0]!;
    const forged = { ...day, phase: "night" as const, day: 3, gameRuleFacts: [{ ...fact, recordedAt: { phase: "night" as const, day: 3 }, expiresAt: { phase: "night" as const, day: 4 } }],
      lifeEventWindow: { ...day.lifeEventWindow, events: day.lifeEventWindow.events.map((event) => ({ ...event, kind: "death" as const, moment: { phase: "night" as const, day: 3 } })) } } as unknown as StorytellerLobbyRecord;
    expect(validVictoryEvidence(forged)).toEqual([]);
  });

  it("not proved: a working Scarlet Woman with five or more alive, a second Demon, the Evil Twin's block, a Mastermind", () => {
    expect(capture(proofGame(["vortox", "scarletwoman", "oracle", "sage", "dreamer"], "day", 2), "recordedDay").gameRuleFacts).toEqual([]);
    expect(capture(proofGame(["vortox", "nodashii", "oracle", "sage", "dreamer"], "day", 2), "recordedDay").gameRuleFacts).toEqual([]);
    expect(capture(proofGame(["vortox", "mastermind", "oracle", "sage", "dreamer"], "day", 2), "recordedDay").gameRuleFacts).toEqual([]);
    // A poisoned Scarlet Woman does not take over (four alive: she never could).
    expect(capture(impair(proofGame(["nodashii", "scarletwoman", "oracle", "sage"], "day", 2), "p1"), "recordedDay").gameRuleFacts).toHaveLength(1);
  });

  it("the Imp keeps its Day and Night proof unchanged", () => {
    expect(capture(proofGame(["imp", "chef", "oracle"], "night", 2), "recordedNight", false).gameRuleFacts).toHaveLength(1);
    expect(capture(proofGame(["imp", "chef", "oracle"], "day", 2), "recordedDay").gameRuleFacts).toHaveLength(1);
  });
});

describe("SV-5q: the advisory lines beside a verified ending, and the Mastermind's withhold", () => {
  const two = () => patchPlayer(patchPlayer(proofGame(["nodashii", "klutz", "oracle", "witch"], "day", 3), "p2", { alive: false }), "p1", { alive: false });
  it("the Klutz's choice on its Day: a proposal it agrees with stays, one it contradicts (or a ruling) is withheld", () => {
    expect(endGameEligibility(withFact(two(), KLUTZ_GOOD_TEAM_LOST), env)).toEqual({ kind: "verified", team: "evil", reason: "twoAlive" });
    expect(endGameEligibility(withFact(two(), KLUTZ_EVIL_TEAM_LOST), env)).toMatchObject({ kind: "unknown" });
    expect(endGameEligibility(withFact(two(), KLUTZ_CHOICE_RULING), env)).toMatchObject({ kind: "unknown" });
  });
  it("the Klutz's choice from an earlier Day (play went on) no longer holds anything back", () => {
    for (const type of [KLUTZ_GOOD_TEAM_LOST, KLUTZ_EVIL_TEAM_LOST, KLUTZ_CHOICE_RULING])
      expect(endGameEligibility(withFact(two(), type, { phase: "day", day: 2 }), env), type).toEqual({ kind: "verified", team: "evil", reason: "twoAlive" });
  });
  it("the Vortox's no-execution line withholds a good-win proposal it contradicts", () => {
    const g = proofGame(["vortox", "slayer", "oracle", "witch", "sage"], "day", 2);
    const shot = { ...patchPlayer(g, "p0", { alive: false }), lifeEventWindow: { ...g.lifeEventWindow, events: [{ id: "shot", kind: "death" as const, moment: { phase: "day" as const, day: 2 }, subject: participantRefOf(g, "p0") as CurrentParticipantRef, actualRoleAtEvent: "vortox" }] } };
    const result = captureResolvedDemonDeath(g, shot, "shot", env, "automaticSlayer");
    if (!result.ok) throw new Error(result.message);
    const night = { ...result.game, phase: "night" as const, day: 3 };
    expect(endGameEligibility(night, env)).toMatchObject({ kind: "verified", team: "good" });
    const source = participantRefOf(g, "p0") as CurrentParticipantRef;
    const withLine = { ...night, gameRuleFacts: [...night.gameRuleFacts, { type: VORTOX_WORKING_AT_DUSK, recordedAt: { phase: "day" as const, day: 2 }, expiresAt: { phase: "day" as const, day: 3 }, provenance: { sourceParticipant: source, sourceCharacter: "vortox" } }] };
    expect(endGameEligibility(withLine, env)).toMatchObject({ kind: "unknown" });
  });
  it("the Mastermind's final day withholds every ordinary proposal, whatever the list says", () => {
    expect(endGameEligibility(withFact(two(), MASTERMIND_FINAL_DAY, { phase: "day", day: 2 }), env)).toMatchObject({ kind: "unknown" });
  });
  it("the Evil Twin, Klutz and Vortox lines keep \"Check before ending the game\" (Q19 A); nothing is ended or preselected", () => {
    const g = withFact(proofGame(["nodashii", "klutz", "oracle", "witch", "sage"], "day", 3), KLUTZ_GOOD_TEAM_LOST);
    const ctx = { game: g, script: env.script, registry: env.registry, privacy: false } as unknown as V6Ctx;
    expect(endHint(ctx)).toBe("The Klutz chose an evil player. Evil wins. Check before ending the game");
    expect(g.result).toBeUndefined();
  });
});
