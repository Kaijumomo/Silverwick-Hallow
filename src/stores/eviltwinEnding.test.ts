// SV-4d -- the Evil Twin and the End control (https://wiki.bloodontheclocktower.com/Evil_Twin): "If the good player is executed, evil wins.
// Good can't win if both live." Every route that proposes "good wins" is withheld while both Twins live and the Evil Twin functions; the
// Good Twin's execution is an advisory line. Nothing records a winner: the Storyteller always declares it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { impair, openInStore, patchPlayer, proofEnv, proofGame } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { demonGoneAdvisory, endGameEligibility, klutzAdvisory, twinAdvisory, twinGoodWinBlock, withheldGoodWinLine, TWINS_BLOCK_GOOD_WIN } from "./endGameEligibility";
import { captureMayorQualification } from "./victoryEvidence";
import { goodTwinIntents } from "./twinPair";
import { applyEffectPlan, planEffectTransaction } from "./effectResolution";
import { KLUTZ_EVIL_TEAM_LOST } from "./gameRuleFactRegistry";
import { endHint } from "@/features/grimoire-v6/vm/chrome";
import type { V6Ctx } from "@/features/grimoire-v6/ctx";
import type { StorytellerLobbyRecord } from "./types";

const env = proofEnv();
const state = () => store.getState();
const game = () => state().game!;

/** Marks `good` as the Good Twin for the Evil Twin at `evil` (the real choosing transaction). */
function twinned(g: StorytellerLobbyRecord, evil: string, good: string): StorytellerLobbyRecord {
  const built = goodTwinIntents(g, { playerId: evil, participantId: g.players[evil]!.participantId! }, { playerId: good, participantId: g.players[good]!.participantId! });
  if (!built.ok) throw new Error(built.message);
  const result = planEffectTransaction(g, { intents: built.intents }, { historyId: () => `h-${good}`, effectId: () => `fx-${good}` });
  if (!result.ok || !result.changed) throw new Error("not a changing plan");
  return applyEffectPlan(g, result.plan);
}
const retains = (g: StorytellerLobbyRecord, id: string): StorytellerLobbyRecord => patchPlayer(g, id, { effects: [...g.players[id]!.effects, { id: "fx-keeps", type: "retainsAbility", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "day", day: 2 } } as never] });

beforeEach(() => { store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null }); usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" }); });
afterEach(() => vi.restoreAllMocks());

// Each variant is a change to the table before the route plays out: [name, change, does "both Twins live and the Evil Twin functions" hold?].
type Setup = { evil: string; good: string };
type Variant = { name: string; change: (g: StorytellerLobbyRecord, s: Setup) => StorytellerLobbyRecord; blocked: boolean; manual?: boolean };
const VARIANTS: Variant[] = [
  { name: "the pair stands", change: (g) => g, blocked: true },
  { name: "the pair is broken (both the same alignment)", change: (g, s) => patchPlayer(g, s.good, { actualAlignment: "evil" }), blocked: false, manual: true },
  { name: "the Evil Twin is drunk", change: (g, s) => impair(g, s.evil, "drunk"), blocked: false },
  { name: "the Evil Twin is poisoned", change: (g, s) => impair(g, s.evil), blocked: false },
  { name: "the Evil Twin is dead", change: (g, s) => patchPlayer(g, s.evil, { alive: false }), blocked: false },
  { name: "the Evil Twin is dead and a Vigormortis lets it keep its ability", change: (g, s) => retains(patchPlayer(g, s.evil, { alive: false }), s.evil), blocked: false },
  { name: "the Good Twin is dead", change: (g, s) => patchPlayer(g, s.good, { alive: false }), blocked: false },
];

describe("the Evil Twin's block, as a rule", () => {
  const base = () => twinned(proofGame(["imp", "eviltwin", "chef", "empath", "saint"], "day", 2), "p1", "p2");
  it("holds only while a valid pair both live and the Evil Twin functions", () => {
    for (const variant of VARIANTS) {
      const block = twinGoodWinBlock(variant.change(base(), { evil: "p1", good: "p2" }), env);
      expect(block?.kind === "blocked", variant.name).toBe(variant.blocked);
      expect(block?.kind === "unknown", variant.name).toBe(!!variant.manual);
    }
  });
  it("is nothing without an Evil Twin, and the Storyteller's call with two Evil Twins or no chosen Good Twin", () => {
    expect(twinGoodWinBlock(proofGame(["imp", "chef", "empath", "saint", "monk"], "day", 2), env)).toBeNull();
    expect(twinGoodWinBlock(proofGame(["imp", "eviltwin", "eviltwin", "empath", "saint"], "day", 2), env)?.kind).toBe("unknown");
    expect(twinGoodWinBlock(proofGame(["imp", "eviltwin", "chef", "empath", "saint"], "day", 2), env)?.kind).toBe("unknown");
  });
  it("is unknown when the Evil Twin's impairment is the Storyteller's judgment", () => {
    expect(twinGoodWinBlock(impair(base(), "p1", "soberHealthy"), env)?.kind).toBe("unknown");
  });
});

describe("every 'good wins' route is withheld while the block holds", () => {
  // Route 1: the Demon is dead (the Imp executed with four players alive, so no Scarlet Woman and no successor).
  describe("the Demon's death", () => {
    const table = (variant: Variant) => {
      let g = twinned(proofGame(["imp", "eviltwin", "chef", "empath", "saint", "washerwoman"], "day", 2), "p1", "p2");
      g = patchPlayer(patchPlayer(g, "p4", { alive: false }), "p5", { alive: false });
      return variant.change(g, { evil: "p1", good: "p2" });
    };
    it.each(VARIANTS)("$name", (variant) => {
      // An already-dead Evil Twin or Good Twin leaves fewer than four alive: the Imp's death still ends the Demon line the same way.
      openInStore(table(variant));
      expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
      const result = endGameEligibility(game(), env);
      if (variant.blocked || variant.manual) {
        expect(result.kind).toBe("unknown");
        expect(result).not.toMatchObject({ kind: "verified" });
        if (variant.blocked) expect(demonGoneAdvisory(game(), env)).toBe(`The Demon is dead. ${TWINS_BLOCK_GOOD_WIN}`);
      } else expect(result).toEqual({ kind: "verified", team: "good", reason: "demonDeath" });
    });
    it("a Scarlet Woman or a Mastermind still keeps its own line first", () => {
      let g = twinned(proofGame(["imp", "eviltwin", "chef", "scarletwoman", "saint"], "day", 2), "p1", "p2");
      g = patchPlayer(g, "p0", { alive: false });
      expect(demonGoneAdvisory(g, env)).toMatch(/Scarlet Woman is alive/);
    });
    it("the Privacy Mode line never names the Twins", () => {
      openInStore(table(VARIANTS[0]!));
      state().recordExecution("p0", "died");
      expect(demonGoneAdvisory(game(), env, false)).toBe("The Demon is dead. Check whether the game has ended");
    });
  });

  // Route 2: the Mayor's three-player condition (no execution on a Day with three alive).
  describe("the Mayor's condition", () => {
    const table = (variant: Variant) => {
      const g = twinned(proofGame(["eviltwin", "mayor", "imp"], "day", 2), "p0", "p1");
      return variant.change(g, { evil: "p0", good: "p1" });
    };
    it.each(VARIANTS)("$name", (variant) => {
      const before = table(variant);
      const captured = captureMayorQualification(before, { ...before, phase: "night", day: 3 }, env);
      expect(captured.ok).toBe(true);
      const after = captured.ok ? captured.game : before;
      const result = endGameEligibility(after, env);
      // The broken variant turns the Mayor evil: an evil Mayor's condition is an evil win, which the Twins never withhold.
      if (variant.manual) expect(result).toEqual({ kind: "verified", team: "evil", reason: "mayor" });
      else if (variant.blocked) expect(result.kind).toBe("unknown");
      // An impaired Evil Twin leaves the Mayor's three-alive condition standing; a dead Twin leaves two alive, so the Mayor's condition never forms.
      else expect(result.kind === "verified" && result.team === "good" && result.reason === "mayor").toBe(/drunk|poisoned/.test(variant.name));
      if (variant.blocked) {
        expect(withheldGoodWinLine(after, env)).toBe(`The Mayor’s condition is met. ${TWINS_BLOCK_GOOD_WIN}`);
        expect(endHint({ game: after, script: env.script, registry: env.registry, privacy: false } as unknown as V6Ctx)).toBe(`The Mayor’s condition is met. ${TWINS_BLOCK_GOOD_WIN}`);
      }
    });
    it("a good Mayor beside an Evil Twin that is itself good (the pair is broken) is the Storyteller's call", () => {
      const before = patchPlayer(table(VARIANTS[0]!), "p0", { actualAlignment: "good" });
      const captured = captureMayorQualification(before, { ...before, phase: "night", day: 3 }, env);
      expect(captured.ok && endGameEligibility(captured.game, env).kind).toBe("unknown");
    });
    it("holds with the Mayor as the Evil Twin's good Twin only when the Mayor is the good one", () => {
      const before = table(VARIANTS[0]!);
      const captured = captureMayorQualification(before, { ...before, phase: "night", day: 3 }, env);
      expect(captured.ok && captured.game.gameRuleFacts.map((fact) => fact.type)).toEqual(["mayorDayEndGoodTeamWon"]);
    });
  });

  // Route 3: an evil Saint's execution (the evil team lost).
  describe("an evil Saint's execution", () => {
    const table = (variant: Variant) => {
      const g = twinned(proofGame(["saint", "eviltwin", "chef", "imp", "empath"], "day", 2), "p1", "p2");
      return variant.change(patchPlayer(g, "p0", { actualAlignment: "evil" }), { evil: "p1", good: "p2" });
    };
    it.each(VARIANTS)("$name", (variant) => {
      openInStore(table(variant));
      expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
      const result = endGameEligibility(game(), env);
      if (variant.blocked || variant.manual) {
        expect(result.kind).toBe("unknown");
        if (variant.blocked) expect(withheldGoodWinLine(game(), env)).toBe(`The Saint was executed. ${TWINS_BLOCK_GOOD_WIN}`);
      } else expect(result).toEqual({ kind: "verified", team: "good", reason: "saint" });
    });
    it("a good Saint's execution (evil wins) is not withheld", () => {
      openInStore(twinned(proofGame(["saint", "eviltwin", "chef", "imp", "empath"], "day", 2), "p1", "p2"));
      state().recordExecution("p0", "died");
      expect(endGameEligibility(game(), env)).toEqual({ kind: "verified", team: "evil", reason: "saint" });
      expect(withheldGoodWinLine(game(), env)).toBeNull();
    });
  });

  // Route 4: the Klutz advisory for an evil Klutz ("Good wins").
  describe("an evil Klutz's choice", () => {
    const klutzGame = (g: StorytellerLobbyRecord) => ({ ...g, gameRuleFacts: [{ id: "f", type: KLUTZ_EVIL_TEAM_LOST, recordedAt: { phase: "day" as const, day: 2 }, expiresAt: { phase: "day" as const, day: 3 } }] as never });
    it.each(VARIANTS)("$name", (variant) => {
      const g = variant.change(twinned(proofGame(["klutz", "eviltwin", "chef", "imp", "empath"], "day", 2), "p1", "p2"), { evil: "p1", good: "p2" });
      const block = twinGoodWinBlock(g, env)?.kind ?? null;
      expect(block === "blocked").toBe(variant.blocked);
      const expected = block === "blocked" ? `The Klutz chose an evil player. ${TWINS_BLOCK_GOOD_WIN}. Check before ending the game`
        : block === "unknown" ? "The Klutz chose an evil player. Good may win, but the Twins need your ruling. Check before ending the game" : "The Klutz chose an evil player. Good wins. Check before ending the game";
      expect(klutzAdvisory(klutzGame(g), block)).toBe(expected);
    });
    it("the End control carries the block, not 'Good wins', and the Privacy Mode line carries neither", () => {
      const g = klutzGame(twinned(proofGame(["klutz", "eviltwin", "chef", "imp", "empath"], "day", 2), "p1", "p2"));
      const ctx = (privacy: boolean) => ({ game: g, script: env.script, registry: env.registry, privacy }) as unknown as V6Ctx;
      expect(endHint(ctx(false))).toBe(`The Klutz chose an evil player. ${TWINS_BLOCK_GOOD_WIN}. Check before ending the game`);
      expect(endHint(ctx(true))).not.toMatch(/Twin|Good wins/);
    });
  });
});

describe("the evil-win routes are unchanged", () => {
  it("two players alive still proposes evil, with the pair valid or broken", () => {
    const g = twinned(proofGame(["imp", "eviltwin", "chef", "empath"], "day", 2), "p1", "p2");
    const two = patchPlayer(patchPlayer(g, "p2", { alive: false }), "p3", { alive: false });
    expect(endGameEligibility(two, env)).toEqual({ kind: "verified", team: "evil", reason: "twoAlive" });
    expect(endGameEligibility(patchPlayer(two, "p2", { actualAlignment: "evil" }), env)).toEqual({ kind: "verified", team: "evil", reason: "twoAlive" });
  });
  it("a game with an Evil Twin is no longer manual: with four alive and no ending it proposes nothing", () => {
    const g = twinned(proofGame(["imp", "eviltwin", "chef", "empath", "saint"], "day", 2), "p1", "p2");
    expect(endGameEligibility(g, env)).toEqual({ kind: "none" });
  });
});

describe("the Good Twin's execution", () => {
  const table = (outcome: "died" | "survived") => {
    openInStore(twinned(proofGame(["imp", "eviltwin", "chef", "empath", "saint"], "day", 2), "p1", "p2"));
    expect(state().recordExecution("p2", outcome)).toMatchObject({ ok: true });
    return game();
  };
  it("says evil wins when the Good Twin died, and asks the Storyteller when it did not die", () => {
    expect(twinAdvisory(table("died"), env)).toBe("The Good Twin was executed. Evil wins. Check before ending the game");
    expect(twinAdvisory(table("survived"), env)).toMatch(/executed but may not have died.*Your ruling/);
  });
  it("shows on the End control in place of 'Good wins'/block lines, and never in Privacy Mode", () => {
    const g = table("died");
    const ctx = (privacy: boolean) => ({ game: g, script: env.script, registry: env.registry, privacy }) as unknown as V6Ctx;
    expect(endHint(ctx(false))).toBe("The Good Twin was executed. Evil wins. Check before ending the game");
    expect(endHint(ctx(true))).not.toMatch(/Twin/);
  });
  it("is silent for the Evil Twin's execution, an impaired, dead or absent Evil Twin, a broken pair, and the next Night", () => {
    openInStore(twinned(proofGame(["imp", "eviltwin", "chef", "empath", "saint"], "day", 2), "p1", "p2"));
    state().recordExecution("p1", "died");
    expect(twinAdvisory(game(), env)).toBeNull();
    for (const make of [(g: StorytellerLobbyRecord) => impair(g, "p1", "drunk"), (g: StorytellerLobbyRecord) => patchPlayer(g, "p2", { actualAlignment: "evil" })]) {
      openInStore(make(twinned(proofGame(["imp", "eviltwin", "chef", "empath", "saint"], "day", 2), "p1", "p2")));
      state().recordExecution("p2", "died");
      expect(twinAdvisory(game(), env)).toBeNull();
    }
    openInStore(patchPlayer(twinned(proofGame(["imp", "eviltwin", "chef", "empath", "saint"], "day", 2), "p1", "p2"), "p1", { alive: false }));
    state().recordExecution("p2", "died");
    expect(twinAdvisory(game(), env)).toBeNull();
    expect(twinAdvisory({ ...table("died"), phase: "night" }, env)).toBeNull();
  });
  it("a dead Evil Twin that a Vigormortis lets keep its ability still counts", () => {
    openInStore(retains(patchPlayer(twinned(proofGame(["imp", "eviltwin", "chef", "empath", "saint"], "day", 2), "p1", "p2"), "p1", { alive: false }), "p1"));
    state().recordExecution("p2", "died");
    expect(twinAdvisory(game(), env)).toBe("The Good Twin was executed. Evil wins. Check before ending the game");
  });
});

describe("independent check follow-ups (2e82ad9)", () => {
  it("a good-aligned Evil Twin character executed is the Storyteller's ruling, not silence", () => {
    // The alignments swapped: the Evil Twin character holder (p1) is now the Good Twin.
    let g = twinned(proofGame(["imp", "eviltwin", "chef", "empath", "saint"], "day", 2), "p1", "p2");
    g = patchPlayer(patchPlayer(g, "p1", { actualAlignment: "good" }), "p2", { actualAlignment: "evil" });
    openInStore(g);
    expect(twinAdvisory(game(), env)).toBeNull();
    expect(state().recordExecution("p1", "died")).toMatchObject({ ok: true });
    expect(twinAdvisory(game(), env)).toBe("The Good Twin was executed, and holds the Evil Twin character. Your ruling");
  });
  it("a Mayor route the Twins leave to the Storyteller says so instead of going quiet", () => {
    const before = patchPlayer(twinned(proofGame(["eviltwin", "mayor", "imp"], "day", 2), "p0", "p1"), "p0", { actualAlignment: "good" });
    const captured = captureMayorQualification(before, { ...before, phase: "night", day: 3 }, env);
    const after = captured.ok ? captured.game : before;
    expect(withheldGoodWinLine(after, env)).toMatch(/^The Mayor’s condition is met\. The Twins need your ruling/);
  });
});

describe("review finding: the Demon died, then the Good Twin was executed the same Day", () => {
  it("no route proposes good: the End control carries the Good Twin line, not 'Good wins'", () => {
    let g = twinned(proofGame(["imp", "eviltwin", "chef", "empath", "saint", "washerwoman"], "day", 2), "p1", "p2");
    g = patchPlayer(patchPlayer(g, "p4", { alive: false }), "p5", { alive: false });
    openInStore(g);
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    // The Imp's death alone, both Twins alive: withheld by the block.
    expect(endGameEligibility(game(), env).kind).toBe("unknown");
    // Then the Good Twin is executed too (the second execution, recorded as the Storyteller's choice).
    const now = game();
    const ref = { kind: "participant" as const, playerId: "p2", participantId: now.players.p2!.participantId!, nameAtTime: "Player 2" };
    store.setState({ game: { ...patchPlayer(now, "p2", { alive: false }), lifeEventWindow: { ...now.lifeEventWindow, events: [...now.lifeEventWindow.events, { id: "ev-good-twin", kind: "execution", subject: ref, actualRoleAtEvent: "chef", moment: { phase: "day", day: 2 }, outcome: "died" } as never] } } });
    expect(endGameEligibility(game(), env).kind).toBe("unknown");
    expect(twinAdvisory(game(), env)).toBe("The Good Twin was executed. Evil wins. Check before ending the game");
    const ctx = { game: game(), script: env.script, registry: env.registry, privacy: false } as unknown as V6Ctx;
    expect(endHint(ctx)).toBe("The Good Twin was executed. Evil wins. Check before ending the game");
  });
});

describe("review finding: the Demon died, both Twins live, then a Saint was executed the same Day", () => {
  it("the End control says to check the Saint instead of 'the Demon is dead, good cannot win'", () => {
    let g = twinned(proofGame(["imp", "eviltwin", "chef", "saint", "empath", "washerwoman"], "day", 2), "p1", "p2");
    g = patchPlayer(patchPlayer(g, "p5", { alive: false }), "p4", { alive: false });
    openInStore(g);
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    const ctx = () => ({ game: game(), script: env.script, registry: env.registry, privacy: false }) as unknown as V6Ctx;
    expect(endHint(ctx())).toBe(`The Demon is dead. ${TWINS_BLOCK_GOOD_WIN}`);
    // The Saint is executed too (the Storyteller's second execution that Day).
    const now = game();
    const ref = { kind: "participant" as const, playerId: "p3", participantId: now.players.p3!.participantId!, nameAtTime: "Player 3" };
    store.setState({ game: { ...patchPlayer(now, "p3", { alive: false }), lifeEventWindow: { ...now.lifeEventWindow, events: [...now.lifeEventWindow.events, { id: "ev-saint", kind: "execution", subject: ref, actualRoleAtEvent: "saint", moment: { phase: "day", day: 2 }, outcome: "died" } as never] } } });
    expect(endGameEligibility(game(), env).kind).toBe("unknown");
    expect(endHint(ctx())).toBe("The Saint was executed after the Demon died, and both Twins live. Check before ending the game");
    expect(endHint({ ...ctx(), privacy: true } as unknown as V6Ctx)).not.toMatch(/Twin|Saint/);
  });
});
