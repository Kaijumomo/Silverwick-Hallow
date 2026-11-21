// SV-3 pair record (docs/ai/SECTS_AND_VIOLETS_SV3_PAIRS.md): the Philosopher against the other 24 characters of Sects & Violets.
// Production semantics, the real coordinator. https://wiki.bloodontheclocktower.com/Philosopher
import { describe, expect, it } from "vitest";
import { PHILOSOPHER_CHARACTER } from "./philosopher";
import { FANG_GU_TARGET } from "./fanggu";
import { runsGainedAbility } from "./passiveRules";
import { bind, patchPlayer, pick, plan, planned, proofGame, proofQuery, proofScript, request } from "@/test/proofFixtures";
import { computeNightOrder } from "@/rules/night/nightOrder";
import { gainedRoleOf, gainedTokenShownOf } from "@/stores/gainedAbility";
import type { AbilityInputValue } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";

const step = { withStep: true, completeStep: true } as const;
const character = (roleId: string): AbilityInputValue => ({ kind: "character", roleIds: [roleId] });
const choose = (g: StorytellerLobbyRecord, roleId: string) => plan(g, request(g, "p0", "philosopher", { [PHILOSOPHER_CHARACTER]: character(roleId) }, step));
const twin = (g: StorytellerLobbyRecord, id: string) => proofQuery(g).gainedAbilityDrunk(bind(g, id));
const functions = (g: StorytellerLobbyRecord, id: string) => proofQuery(g).abilityFunctions(bind(g, id));
const rowsOf = (g: StorytellerLobbyRecord, id: string) => computeNightOrder(g.players, g.seatOrder, proofScript, g.day === 1, g)
  .flatMap((s) => s.kind === "player" && s.playerId === id ? [s.effectiveRoleId] : []);
// The good characters of Sects & Violets other than the Philosopher.
const GOOD = ["clockmaker", "dreamer", "snakecharmer", "mathematician", "flowergirl", "towncrier", "oracle", "savant", "seamstress", "artist",
  "juggler", "sage", "mutant", "sweetheart", "barber", "klutz"];

describe("SV-3 pairs: the reviewed-list gate", () => {
  it("with the Evil Twin in play, the Philosopher's choice is the Storyteller's (Manual); the Cerenovus joined the reviewed list in SV-4a", () => {
    for (const other of ["eviltwin"]) {
      expect(choose(proofGame(["philosopher", "fanggu", "clockmaker", "dreamer", other]), "dreamer"), other).toMatchObject({ ok: false, code: "unsupported" });
    }
  });

  it("with any other character of the script in play, the choice is guided", () => {
    for (const other of [...GOOD, "witch", "pithag", "nodashii", "vigormortis", "vortox", "fanggu", "cerenovus"]) {
      expect(choose(proofGame(["philosopher", "imp", "chef", "monk", other]), "dreamer"), other).toMatchObject({ ok: true, changed: true });
    }
  });
});

describe("SV-3 pairs: every good character of the script, chosen", () => {
  it("in play: its true holder is drunk and the Philosopher keeps their token; not in play: the token swaps and nobody is drunk", () => {
    for (const roleId of GOOD) {
      const held = planned(choose(proofGame(["philosopher", "fanggu", roleId, "witch", "chef"]), roleId));
      expect(twin(held, "p2"), roleId).toEqual({ known: true, value: true });
      expect(functions(held, "p2"), roleId).toEqual({ known: true, value: false });
      expect(gainedTokenShownOf(held.players.p0), roleId).toBeNull();
      const free = planned(choose(proofGame(["philosopher", "fanggu", "chef", "witch", "monk"]), roleId));
      expect(gainedTokenShownOf(free.players.p0), roleId).toBe(roleId);
      for (const id of ["p1", "p2", "p3", "p4"]) expect(twin(free, id), `${roleId} ${id}`).toEqual({ known: true, value: false });
    }
  });

  it("the gained row the next night: at the character's place when it wakes each night, never for a Day, passive or death ability", () => {
    const expected: Record<string, boolean> = {
      clockmaker: false, dreamer: true, snakecharmer: true, mathematician: true, flowergirl: true, towncrier: true, oracle: true, savant: false,
      seamstress: true, artist: false, juggler: true, sage: false, mutant: false, sweetheart: false, barber: false, klutz: false,
    };
    for (const roleId of GOOD) {
      const next = { ...planned(choose(proofGame(["philosopher", "fanggu", "chef", "witch", "monk"]), roleId)), day: 3 };
      expect(rowsOf(next, "p0").includes(roleId), roleId).toBe(expected[roleId]);
    }
  });

  it("which gained rows the app runs (SV-3b): the Snake Charmer, the Town Crier and the Oracle; the rest are the Storyteller's", () => {
    expect(GOOD.filter(runsGainedAbility)).toEqual(["snakecharmer", "towncrier", "oracle"]);
  });
});

describe("SV-3 pairs: the evil characters", () => {
  it("Witch: no interaction (a cursed Philosopher who nominates dies as usual); the choice is guided", () => {
    expect(gainedRoleOf(planned(choose(proofGame(["philosopher", "fanggu", "witch", "chef", "monk"]), "dreamer")).players.p0)).toBe("dreamer");
  });

  it("No Dashii: a poisoned Philosopher neighbour gains nothing; a gain made before keeps the ability but the drunk player is sober", () => {
    const g = proofGame(["philosopher", "nodashii", "dreamer", "chef", "monk"]);
    expect(proofQuery(g).noDashiiPoisoned(bind(g, "p0"))).toEqual({ known: true, value: true });
    const next = planned(choose(g, "dreamer"));
    expect(next.players.p0!.abilityUsed).toBe(true);
    expect(gainedRoleOf(next.players.p0)).toBeNull();
    const before = planned(choose(proofGame(["philosopher", "imp", "dreamer", "chef", "monk"]), "dreamer"));
    const poisoned = patchPlayer(before, "p1", { actualRole: "nodashii", shownRole: "nodashii" });
    expect(gainedRoleOf(poisoned.players.p0)).toBe("dreamer");
    expect(twin(poisoned, "p2")).toEqual({ known: true, value: false });
  });

  it("Fang Gu: a Philosopher with an Outsider's ability is not an Outsider, so the Fang Gu's kill does not jump", () => {
    const g = planned(choose(proofGame(["philosopher", "fanggu", "chef", "witch", "monk"]), "mutant"));
    const killed = planned(plan(g, request(g, "p1", "fanggu", { [FANG_GU_TARGET]: pick(g, "p0") }, step)));
    expect(killed.players.p0).toMatchObject({ alive: false, actualRole: "philosopher" });
    expect(killed.players.p1!.actualRole).toBe("fanggu");
  });

  it("Pit-Hag: making the chosen character later makes that player drunk; changing the Philosopher ends the gain", () => {
    const g = planned(choose(proofGame(["philosopher", "fanggu", "chef", "pithag", "monk"]), "dreamer"));
    const made = planned(plan(g, request(g, "p3", "pithag", { target: pick(g, "p2"), character: character("dreamer") })));
    expect(twin(made, "p2")).toEqual({ known: true, value: true });
    const changed = planned(plan(g, request(g, "p3", "pithag", { target: pick(g, "p0"), character: character("savant") })));
    expect(gainedRoleOf(changed.players.p0)).toBeNull();
  });
});
