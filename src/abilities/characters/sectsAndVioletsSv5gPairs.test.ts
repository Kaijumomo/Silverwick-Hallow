// @vitest-environment node
// SV-5 part 2c (the Mathematician): the pairs of docs/ai/SECTS_AND_VIOLETS_SV5G_PAIRS.md that the focused files (abnormalMarks.test.ts,
// abnormalInformation.test.ts, mathematician.test.ts, mathematicianUi.v6.test.tsx) do not name.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { sectsAndViolets } from "@/data/scripts/sectsAndViolets";
import { bind, impair, num, patchPlayer, pick, plan, planned, proofGame, proofQuery, request, yes } from "@/test/proofFixtures";
import { PHILOSOPHER_CHARACTER } from "./philosopher";
import { gainedRoleOf } from "@/stores/gainedAbility";
import { CLOCKMAKER_COMMUNICATED } from "./clockmaker";
import { MATHEMATICIAN_COMMUNICATED } from "./mathematician";
import { ABNORMAL_IMPAIRED, ABNORMAL_VORTOX, abnormalCount, abnormalMarksOf, abnormalReasons } from "@/stores/abnormalMarks";
import type { AbilityInputs } from "../semantics";
import type { EffectRecord, StorytellerLobbyRecord } from "@/stores/types";

const step = { withStep: true, completeStep: true } as const;
const resolve = (g: StorytellerLobbyRecord, actor: string, roleId: string, inputs: AbilityInputs = {}) => plan(g, request(g, actor, roleId, inputs, step));
const after = (g: StorytellerLobbyRecord, actor: string, roleId: string, inputs: AbilityInputs = {}) => planned(resolve(g, actor, roleId, inputs));
const reasonsOn = (g: StorytellerLobbyRecord, id: string) => abnormalReasons(abnormalMarksOf(g.players[id]!));
const sourced = (g: StorytellerLobbyRecord, id: string, type: string, source: string, sourceId: string): StorytellerLobbyRecord =>
  patchPlayer(g, id, { effects: [...g.players[id]!.effects, { id: `fx-${source}-${id}`, type, sourceCharacter: source,
    sourceParticipant: { kind: "participant", playerId: sourceId, participantId: g.players[sourceId]!.participantId!, nameAtTime: g.players[sourceId]!.name },
    lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: g.phase, day: g.day } } as EffectRecord] });
const noVotes = (g: StorytellerLobbyRecord): StorytellerLobbyRecord => ({ ...g, voting: { day: g.day - 1, revision: 1, coverage: "known", rounds: [], activeRoundId: null, block: null, modifiers: [] } });

describe("SV-5g pairs: information characters", () => {
  it("Town Crier / Mathematician: nobody nominated (true: NO); a Vortox makes it YES and marks the Town Crier", () => {
    const g = after(noVotes(proofGame(["towncrier", "mathematician", "vortox", "witch", "chef"], "night", 2)), "p0", "towncrier");
    expect(g.informationDeliveries.at(-1)).toMatchObject({ values: [{ value: true }] });
    expect(reasonsOn(g, "p0")).toEqual([ABNORMAL_VORTOX]);
  });

  it("Town Crier / Mathematician: a poisoned Town Crier told YES (true: NO) is marked; told NO is not", () => {
    const g = impair(noVotes(proofGame(["towncrier", "mathematician", "fanggu", "witch", "chef"], "night", 2)), "p0");
    expect(reasonsOn(after(g, "p0", "towncrier", { communicated: yes(true) }), "p0")).toEqual([ABNORMAL_IMPAIRED]);
    expect(reasonsOn(after(g, "p0", "towncrier", { communicated: yes(false) }), "p0")).toEqual([]);
  });

  it("Flowergirl / Mathematician: nobody voted (true: NO); a poisoned Flowergirl told YES is marked", () => {
    const g = impair(noVotes(proofGame(["flowergirl", "mathematician", "fanggu", "witch", "chef"], "night", 2)), "p0");
    expect(reasonsOn(after(g, "p0", "flowergirl", { communicated: yes(true) }), "p0")).toEqual([ABNORMAL_IMPAIRED]);
  });

  it("Savant and Artist / Mathematician: whispered answers have no truth, so nothing is marked by the app (by hand)", () => {
    const q = proofQuery(proofGame(["savant", "artist", "mathematician", "vortox", "witch"], "day", 2));
    for (const role of ["savant", "artist"]) expect(q.modifierGate(role, ["information"]).kind, role).toBe("gated");
  });
});

describe("SV-5g pairs: who makes an ability abnormal", () => {
  it("Sweetheart / Mathematician: a Clockmaker the dead Sweetheart made drunk, told a wrong number, is marked", () => {
    // p0 clockmaker, p1 mathematician, p2 fanggu, p3 witch, p4 sweetheart (dead): true 1 step.
    const g = sourced(patchPlayer(proofGame(["clockmaker", "mathematician", "fanggu", "witch", "sweetheart"], "night", 1), "p4", { alive: false }), "p0", "drunk", "sweetheart", "p4");
    expect(proofQuery(g).abilityFunctions(bind(g, "p0"))).toEqual({ known: true, value: false });
    expect(reasonsOn(after(g, "p0", "clockmaker", { [CLOCKMAKER_COMMUNICATED]: num(2) }), "p0")).toEqual([ABNORMAL_IMPAIRED]);
  });

  it("Sweetheart / Mathematician: a drunk Mathematician is the Storyteller's number (and still clears the marks)", () => {
    const g = sourced(patchPlayer(proofGame(["mathematician", "clockmaker", "fanggu", "witch", "sweetheart"], "night", 2), "p4", { alive: false }), "p0", "drunk", "sweetheart", "p4");
    expect(resolve(g, "p0", "mathematician")).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: MATHEMATICIAN_COMMUNICATED }] });
  });

  it("No Dashii / Mathematician: a Clockmaker poisoned as the No Dashii's neighbour, told a wrong number, is marked", () => {
    // p0 clockmaker beside p1 nodashii; p2 witch: 1 step. p3 mathematician, p4 chef.
    const g = proofGame(["clockmaker", "nodashii", "witch", "mathematician", "chef"], "night", 1);
    expect(proofQuery(g).abilityFunctions(bind(g, "p0"))).toEqual({ known: true, value: false });
    expect(reasonsOn(after(g, "p0", "clockmaker", { [CLOCKMAKER_COMMUNICATED]: num(2) }), "p0")).toEqual([ABNORMAL_IMPAIRED]);
    expect(reasonsOn(after(g, "p0", "clockmaker", { [CLOCKMAKER_COMMUNICATED]: num(1) }), "p0")).toEqual([]);
  });

  it("Vigormortis / Mathematician: a Townsfolk the Vigormortis's Minion death poisoned, told a wrong number, is marked", () => {
    const g = sourced(proofGame(["oracle", "mathematician", "vigormortis", "witch", "chef"], "night", 3), "p0", "poisoned", "vigormortis", "p2");
    expect(reasonsOn(after(g, "p0", "oracle", { communicated: num(2) }), "p0")).toEqual([ABNORMAL_IMPAIRED]);
  });

  it("Witch, Cerenovus, Fang Gu, Snake Charmer / Mathematician: abilities that are not information are never marked by the app, poisoned or not", () => {
    // p0 witch, p1 cerenovus, p2 fanggu, p3 snakecharmer, p4 mathematician, p5 chef
    const g = proofGame(["witch", "cerenovus", "fanggu", "snakecharmer", "mathematician", "chef"], "night", 2);
    for (const base of [g, impair(g, "p0")]) {
      const cursed = after(base, "p0", "witch", { target: pick(base, "p5") });
      expect(abnormalCount(cursed)).toBe(0);
    }
    expect(after(g, "p4", "mathematician").informationDeliveries.at(-1)).toMatchObject({ values: [{ value: 0 }] });
  });
});

describe("SV-5g pairs: becoming or gaining the Mathematician", () => {
  it("Pit-Hag or Barber / Mathematician: a player who is now the Mathematician wakes and counts (here under a Vortox: a false 1 for a true 0)", () => {
    const g = patchPlayer(proofGame(["chef", "clockmaker", "vortox", "witch", "pithag"], "night", 2), "p0", { actualRole: "mathematician", shownRole: "mathematician" });
    expect(after(g, "p0", "mathematician", { [MATHEMATICIAN_COMMUNICATED]: num(1) }).informationDeliveries.at(-1)).toMatchObject({ values: [{ value: 1 }] });
  });

  it("Philosopher / Mathematician: a gained Mathematician is not run by the app (by hand); while it listens the app still marks a Vortox's false information", () => {
    // p0 philosopher, p1 oracle, p2 vortox, p3 witch, p4 chef (dead, so the Oracle has 0 dead evil players to count truly).
    const before = patchPlayer(proofGame(["philosopher", "oracle", "vortox", "witch", "chef"], "night", 3), "p4", { alive: false });
    const g = after(before, "p0", "philosopher", { [PHILOSOPHER_CHARACTER]: { kind: "character", roleIds: ["mathematician"] } });
    expect(gainedRoleOf(g.players.p0)).toBe("mathematician");
    expect(resolve(g, "p0", "mathematician")).toMatchObject({ ok: false });
    expect(reasonsOn(after(g, "p1", "oracle", { communicated: num(1) }), "p1")).toEqual([ABNORMAL_VORTOX]);
  });
});

describe("the pair record itself", () => {
  const DOC = join(__dirname, "../../../docs/ai/SECTS_AND_VIOLETS_SV5G_PAIRS.md");
  const rows = readFileSync(DOC, "utf8").split("\n").filter((line) => /^\| \d{3} \|/.test(line));
  it("has one row for the Mathematician with each of the other 24 Sects & Violets characters, numbered in order", () => {
    const others = sectsAndViolets.characters.filter((role) => role.id !== "mathematician").map((role) => role.name);
    expect(rows).toHaveLength(24);
    expect(rows.map((row) => row.split("|")[2]!.trim())).toEqual(others.map((name) => `Mathematician / ${name}`));
    rows.forEach((row, index) => expect(row.startsWith(`| ${String(index + 1).padStart(3, "0")} |`)).toBe(true));
  });
  it("every evidence link points to a file that exists", () => {
    for (const row of rows) for (const [, link] of row.matchAll(/\]\(([^)]+)\)/g)) expect(existsSync(join(dirname(DOC), link!)), link).toBe(true);
  });
});
