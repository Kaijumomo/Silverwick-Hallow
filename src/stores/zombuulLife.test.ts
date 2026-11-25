// BM-2a: the Zombuul's hidden life (https://wiki.bloodontheclocktower.com/Zombuul): "The 1st time you die, you live but register as
// dead." Model B1 (planning/ZOMBUUL_STORYTELLER_SCREENS_LIST.md, PO rulings 2026-11-12 and BM-2 decisions 2026-11-25): the stored life is
// what the table sees; the truth is a Storyteller-only `livesOn` Effect on the PLAYER, written and ended only by the Life planner.
import { beforeEach, describe, expect, it } from "vitest";
import { bind, impair, openInStore, patchPlayer, proofEnv, proofGame, proofQuery, proofRegistry, proofScript } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { applyLifePlan, hiddenLifeEffectRefusal, planLifeTransaction, type LifeTransaction } from "./lifeResolution";
import { HIDDEN_LIFE, hasHiddenLife, isTrulyAlive, publicLifeOf } from "./lifeState";
import { planRecordedLifeOutcome } from "./deathResolution";
import { scarletWomanSuccession } from "@/abilities/characters/scarletWoman";
import { barberDemonsOf } from "@/abilities/characters/barber";
import { projectLobbyToPublic, projectLobbyToSelfEnvelopeMap } from "./projections";
import { StorytellerGamePersistedSchema } from "./schemas";
import { KNOWN_EFFECT_TYPES } from "./effectRegistry";
import type { StorytellerLobbyRecord } from "./types";

const env = { registry: proofRegistry, script: proofScript };
// p0 Zombuul, p1 Chef, p2 Empath, p3 Monk, p4 Poisoner, p5 Saint.
const ROLES = ["zombuul", "chef", "empath", "monk", "poisoner", "saint"];
const day = (roles = ROLES) => proofGame(roles, "day", 2);
const night = (roles = ROLES) => proofGame(roles, "night", 2);
const run = (g: StorytellerLobbyRecord, transaction: LifeTransaction, environment: typeof env | undefined = env) => {
  const result = planLifeTransaction(g, transaction, undefined, environment);
  if (!result.ok) throw new Error(result.message);
  return result.changed ? applyLifePlan(g, result.plan) : g;
};
const hidden = (g: StorytellerLobbyRecord, id = "p0") => g.players[id]!.effects.filter((effect) => effect.type === HIDDEN_LIFE);
const executed = (g: StorytellerLobbyRecord, id = "p0", extra: object = {}) => run(g, { intents: [{ kind: "execution", playerId: id, outcome: "died", ...extra }] });

describe("BM-2a: the first death registers; the player lives on", () => {
  it("an executed sober Zombuul: the table sees a death (stored life, ghost vote, Life Event); the truth is a hidden life", () => {
    const g = executed(day());
    const p0 = g.players.p0!;
    expect(p0).toMatchObject({ alive: false, ghostVote: true });
    expect(publicLifeOf(p0)).toMatchObject({ alive: false, ghostVote: true });
    expect(hidden(g)).toEqual([expect.objectContaining({ type: HIDDEN_LIFE, state: "active", lifetime: { kind: "manual" } })]);
    expect(hasHiddenLife(p0)).toBe(true);
    expect(isTrulyAlive(p0)).toBe(true);
    expect(g.lifeEventWindow.events.filter((event) => event.kind === "execution")).toHaveLength(1);
    expect(proofQuery(g).trulyAlive(bind(g, "p0"))).toEqual({ known: true, value: true });
    expect(StorytellerGamePersistedSchema.safeParse(g).success).toBe(true);
  });

  it("a night death (a Godfather or any other killer's death intent) is the same first death", () => {
    const g = run(night(), { intents: [{ kind: "death", playerId: "p0" }] });
    expect(g.players.p0!.alive).toBe(false);
    expect(hidden(g)).toHaveLength(1);
  });

  it("the death gate says so: a Demon or execution death of a sober Zombuul is a death that lives on; the Assassin's is real", () => {
    const g = day();
    const q = proofQuery(g);
    for (const cause of ["demon", "execution", "any"] as const) expect(q.deathOutcome(bind(g, "p0"), cause), cause).toEqual({ known: true, value: { kind: "dies", livesOn: true } });
    expect(q.deathOutcome(bind(g, "p0"), "assassin")).toEqual({ known: true, value: { kind: "dies" } });
  });

  it("a drunk or poisoned Zombuul dies for real (no hidden life); an unknown sobriety keeps it (recoverable with the Died switch)", () => {
    const poisoned = executed(impair(day(), "p0"));
    expect(poisoned.players.p0!.alive).toBe(false);
    expect(hidden(poisoned)).toEqual([]);
    expect(isTrulyAlive(poisoned.players.p0!)).toBe(false);
    const unknown = impair(day(), "p0", "soberHealthy");
    expect(proofQuery(unknown).deathOutcome(bind(unknown, "p0"), "execution")).toMatchObject({ known: false });
    expect(hidden(executed(unknown))).toHaveLength(1);
  });

  it("an explicit ruling wins: livesOn false is a real death; livesOn true is refused for a player who cannot live on", () => {
    expect(hidden(executed(day(), "p0", { livesOn: false }))).toEqual([]);
    const chef = planLifeTransaction(day(), { intents: [{ kind: "execution", playerId: "p1", outcome: "died", livesOn: true }] }, undefined, env);
    expect(chef).toMatchObject({ ok: false });
    const poisoned = planLifeTransaction(impair(day(), "p0"), { intents: [{ kind: "execution", playerId: "p0", outcome: "died", livesOn: true }] }, undefined, env);
    expect(poisoned).toMatchObject({ ok: false });
    expect(planLifeTransaction(day(), { intents: [{ kind: "execution", playerId: "p0", outcome: "survived", livesOn: true } as never] }, undefined, env)).toMatchObject({ ok: false });
  });

  it("any other character's death is unchanged (no hidden life)", () => {
    const g = executed(day(), "p1");
    expect(g.players.p1!.alive).toBe(false);
    expect(g.players.p1!.effects).toEqual([]);
  });
});

describe("BM-2a: the second death is real", () => {
  it("executed again: the stored life stays dead, the hidden life ends, the execution is recorded", () => {
    const first = executed(day());
    // Executing again on the same Day would ask about an additional execution; the planner's rule is the same on any Day.
    const result = planLifeTransaction(first, { intents: [{ kind: "execution", playerId: "p0", outcome: "died", confirmations: [{ kind: "additionalExecution", participantId: first.players.p0!.participantId!, moment: { phase: "day", day: 2 } }] }] }, undefined, env);
    expect(result.ok).toBe(true);
    const second = applyLifePlan(first, (result as Extract<typeof result, { ok: true; changed: true }>).plan);
    expect(second.players.p0).toMatchObject({ alive: false, ghostVote: true });
    expect(hidden(second).filter((effect) => effect.state === "active")).toEqual([]);
    expect(isTrulyAlive(second.players.p0!)).toBe(false);
    expect(second.lifeEventWindow.events.filter((event) => event.kind === "execution")).toHaveLength(2);
  });

  it("a night death of a hidden player is his real death; 'already dead' is refused while he lives on", () => {
    const first = executed(day());
    const atNight = { ...first, phase: "night" as const, day: 3 };
    const killed = run(atNight, { intents: [{ kind: "death", playerId: "p0" }] });
    expect(isTrulyAlive(killed.players.p0!)).toBe(false);
    expect(planLifeTransaction(first, { intents: [{ kind: "execution", playerId: "p0", outcome: "alreadyDead" }] }, undefined, env))
      .toMatchObject({ ok: false, message: expect.stringContaining("still lives") });
    expect(planLifeTransaction(first, { intents: [{ kind: "death", playerId: "p0", livesOn: true }] }, undefined, env)).toMatchObject({ ok: false });
  });

  it("a hidden player who survives a second execution keeps the hidden life", () => {
    const first = executed(day());
    const result = planLifeTransaction(first, { intents: [{ kind: "execution", playerId: "p0", outcome: "survived", confirmations: [{ kind: "additionalExecution", participantId: first.players.p0!.participantId!, moment: { phase: "day", day: 2 } }] }] }, undefined, env);
    expect(result.ok).toBe(true);
    const after = applyLifePlan(first, (result as Extract<typeof result, { ok: true; changed: true }>).plan);
    expect(hidden(after)).toHaveLength(1);
  });

  it("a later death when the hidden life already ended (Pit-Hag changed him): a player who registers dead with no hidden life is refused as before", () => {
    const real = executed(impair(day(), "p0"));
    expect(planLifeTransaction(real, { intents: [{ kind: "death", playerId: "p0" }] }, undefined, env)).toMatchObject({ ok: false });
  });
});

describe("BM-2a: the Alive / Died switch and corrections (PO Q2: Died is a real death)", () => {
  it("switching a hidden-life seat to Died is a real death: the hidden life ends; the stored life is unchanged", () => {
    const first = executed(day());
    const died = run(first, { intents: [{ kind: "correctStatus", playerId: "p0", target: { alive: false, ghostVote: true } }] });
    expect(isTrulyAlive(died.players.p0!)).toBe(false);
    expect(died.players.p0!.effects.filter((effect) => effect.state === "active")).toEqual([]);
  });
  it("switching to Alive clears the hidden life (an ordinary living player again)", () => {
    const first = executed(day());
    const alive = run(first, { intents: [{ kind: "correctStatus", playerId: "p0", target: { alive: true } }] });
    expect(alive.players.p0!.alive).toBe(true);
    expect(alive.players.p0!.effects.filter((effect) => effect.state === "active")).toEqual([]);
  });
  it("a resurrection clears the hidden life", () => {
    const first = executed(day());
    const back = run({ ...first, phase: "night", day: 3 }, { intents: [{ kind: "resurrection", playerId: "p0" }] });
    expect(back.players.p0!.alive).toBe(true);
    expect(back.players.p0!.effects.filter((effect) => effect.state === "active")).toEqual([]);
  });
});

describe("BM-2a: the hidden life belongs to the player (PO 2026-11-12 17:51Z)", () => {
  it("a character change (Pit-Hag) keeps it; his next death is then real whatever his character", () => {
    const changed = patchPlayer(executed(day()), "p0", { actualRole: "chef" });
    expect(isTrulyAlive(changed.players.p0!)).toBe(true);
    const killed = run({ ...changed, phase: "night", day: 3 }, { intents: [{ kind: "death", playerId: "p0" }] });
    expect(isTrulyAlive(killed.players.p0!)).toBe(false);
  });
  it("a Pit-Hag-made Zombuul who registers alive gets its own first death", () => {
    const made = patchPlayer(day(), "p1", { actualRole: "zombuul" });
    expect(hidden(executed(made, "p1"), "p1")).toHaveLength(1);
  });
});

describe("BM-2a: only the life controls change the hidden life", () => {
  it("a generic Effect change that adds, removes, suspends or amends it is refused", () => {
    const g = executed(day());
    const target = bind(g, "p0");
    const effectId = hidden(g)[0]!.id;
    expect(hiddenLifeEffectRefusal(g, [{ kind: "apply", target, effect: { type: HIDDEN_LIFE, lifetime: { kind: "manual" } } }])).toMatch(/life controls/);
    expect(hiddenLifeEffectRefusal(g, [{ kind: "remove", target, effectId }])).toMatch(/life controls/);
    expect(hiddenLifeEffectRefusal(g, [{ kind: "suppress", target, effectId }])).toMatch(/life controls/);
    expect(hiddenLifeEffectRefusal(g, [{ kind: "correctRemove", target, effectId }])).toMatch(/life controls/);
    expect(hiddenLifeEffectRefusal(g, [{ kind: "apply", target, effect: { type: "drunk", lifetime: { kind: "manual" } } }])).toBeNull();
    expect(KNOWN_EFFECT_TYPES.map((definition) => definition.type)).not.toContain(HIDDEN_LIFE);
  });
  it("the store's Effect command refuses it", () => {
    openInStore(executed(day()));
    const g = store.getState().game!;
    const result = store.getState().resolveEffects({ intents: [{ kind: "remove", target: bind(g, "p0"), effectId: hidden(g)[0]!.id }] });
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(hidden(store.getState().game!)).toHaveLength(1);
  });
});

describe("BM-2a: Undo and reload", () => {
  beforeEach(() => {
    store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
    usePrivacyStore.getState().reset();
    useSessionRuntime.setState({ backend: null, status: "idle" });
  });
  it("one Undo reverses the first death and the hidden life together", () => {
    openInStore(day());
    expect(store.getState().recordExecution("p0", "died")).toMatchObject({ ok: true });
    expect(hidden(store.getState().game!)).toHaveLength(1);
    store.getState().undo();
    const g = store.getState().game!;
    expect(g.players.p0!.alive).toBe(true);
    expect(g.players.p0!.effects).toEqual([]);
    expect(g.lifeEventWindow.events.filter((event) => event.kind === "execution")).toEqual([]);
  });
  it("the store's Died switch (a recorded death) and a status correction are each a real death; Undo restores the hidden life", () => {
    openInStore(executed(day()));
    store.getState().setAlive("p0", false);
    expect(isTrulyAlive(store.getState().game!.players.p0!)).toBe(false);
    store.getState().undo();
    expect(isTrulyAlive(store.getState().game!.players.p0!)).toBe(true);
    store.getState().correctLifeStatus("p0", { alive: false, ghostVote: true });
    expect(isTrulyAlive(store.getState().game!.players.p0!)).toBe(false);
    store.getState().undo();
    expect(isTrulyAlive(store.getState().game!.players.p0!)).toBe(true);
  });
  it("a recorded outcome (the Day's execution control) gives no Scarlet Woman succession on the first death", () => {
    const g = day(["zombuul", "scarletwoman", "chef", "empath", "monk", "saint"]);
    const result = planRecordedLifeOutcome(g, { intents: [{ kind: "execution", playerId: "p0", outcome: "died" }] }, proofEnv());
    expect(result).toMatchObject({ ok: true, changed: true });
    const after = (result as Extract<typeof result, { ok: true }>).game;
    expect(after.players.p1!.actualRole).toBe("scarletwoman");
    expect(hidden(after)).toHaveLength(1);
    expect((result as { manualReason?: string }).manualReason).toBeUndefined();
  });
  it("independent check C2: a Zombuul who already registers as dead is not in the Scarlet Woman's count; a real death the ruling carries is ruled as one", () => {
    // Five players register alive with him (Zombuul, Scarlet Woman, Chef, Empath, Monk; the Saint dead): the count is five.
    const five = patchPlayer(day(["zombuul", "scarletwoman", "chef", "empath", "monk", "saint"]), "p5", { alive: false });
    const lives = executed(five);
    // After his first death only four register alive: his real death is a Demon death with fewer than five alive, no succession.
    expect(scarletWomanSuccession(proofQuery(lives), bind(lives, "p0"))).toEqual({ kind: "none" });
    // An explicit real death of a Zombuul who still registers alive (the Assassin's) is not mistaken for a first death.
    expect(scarletWomanSuccession(proofQuery(five), bind(five, "p0"))).toEqual({ kind: "none" });
    expect(scarletWomanSuccession(proofQuery(five), bind(five, "p0"), undefined, false)).toMatchObject({ kind: "manual" });
  });
  it("Codex review: a Zombuul who registers as dead but lives on is still a living Demon for the Barber's swap", () => {
    const g = executed(day(["zombuul", "barber", "chef", "empath", "monk", "saint"]));
    expect(barberDemonsOf(proofQuery(g))).toEqual([bind(g, "p0")]);
    const real = run(g, { intents: [{ kind: "death", playerId: "p0" }] });
    expect(barberDemonsOf(proofQuery(real))).toEqual([]);
  });
  it("a reloaded game keeps the hidden life (it is ordinary persisted Effect state)", () => {
    const g = executed(day());
    const parsed = StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(g)));
    expect(isTrulyAlive(parsed.players.p0 as never)).toBe(true);
  });
});

describe("BM-2a privacy: nothing a player or the public sees reveals the hidden life", () => {
  // The same game with the Zombuul really dead (a poisoned execution) and secretly alive must project identically.
  const strip = (g: StorytellerLobbyRecord) => ({ ...g, players: Object.fromEntries(Object.entries(g.players).map(([id, p]) => [id, { ...p, effects: p.effects.filter((effect) => effect.type !== HIDDEN_LIFE) }])) });
  for (const phase of ["day", "night"] as const) {
    it(`the public record and every self envelope are identical with and without the hidden life (${phase})`, () => {
      const g = executed(day());
      const withLife = phase === "day" ? g : { ...g, phase: "night" as const, day: 3 };
      expect(hidden(withLife)).toHaveLength(1);
      const without = strip(withLife);
      expect(projectLobbyToPublic(withLife, {})).toEqual(projectLobbyToPublic(without, {}));
      expect(projectLobbyToSelfEnvelopeMap(withLife, proofRegistry)).toEqual(projectLobbyToSelfEnvelopeMap(without, proofRegistry));
      expect(JSON.stringify(projectLobbyToPublic(withLife, {}))).not.toContain(HIDDEN_LIFE);
      expect(JSON.stringify(projectLobbyToSelfEnvelopeMap(withLife, proofRegistry))).not.toContain(HIDDEN_LIFE);
    });
  }
  it("his own phone shows him dead (PO 2026-11-12 13:57Z)", () => {
    const g = executed(day());
    const envelope = projectLobbyToSelfEnvelopeMap(g, proofRegistry).p0;
    if (envelope) expect(envelope.life).toMatchObject({ alive: false, ghostVote: true });
  });
});

describe("BM-2a architecture: the truth readers are a pinned list", () => {
  // A new reader of the hidden life must be added here on purpose: about 130 places read the table's life and must keep doing so
  // (counts, votes, nominations, the seat, every player and public surface). Player and public projections may never read it.
  const TRUTH_READERS = [
    "abilities/automationEligibility.ts", "abilities/completeActionSafety.ts", "abilities/characters/barber.ts",
    "abilities/characters/exorcist.ts", "abilities/characters/fanggu.ts", "abilities/characters/godfather.ts", "abilities/characters/imp.ts",
    "abilities/characters/nodashii.ts", "abilities/characters/passiveRules.ts", "abilities/characters/scarletWoman.ts",
    "abilities/characters/shabaloth.ts", "abilities/characters/shared.ts", "abilities/characters/slayer.ts",
    "abilities/characters/vigormortis.ts", "abilities/characters/vortox.ts", "abilities/characters/zombuul.ts",
    "features/grimoire-v6/board/life.ts" /* the Kill / Died result line (refused in Privacy Mode) */,
    "features/grimoire-v6/board/marks.ts" /* Storyteller board: the Zombuul in play for its DIED TODAY */,
    "features/grimoire-v6/night/useNightEngine.tsx" /* the Pit-Hag's arbitrary Kill on a seat that lives on (refused in Privacy Mode) */,
    // BM-2d: Storyteller-only screens, each also hidden or neutral in Privacy Mode: the seat looks alive, Did X die?, the result line.
    "features/grimoire-v6/day/advance.ts", "features/grimoire-v6/day/madnessExecution.ts", "features/grimoire-v6/day/nomination.tsx",
    "features/grimoire-v6/vm/board.tsx", "features/voting/VotingWorkspace.tsx",
    "rules/night/nightOrder.ts",
    "stores/deathResolution.ts", "stores/effectRegistry.ts" /* its name and OWN_PATH_ONLY only */, "stores/endGameEligibility.ts", "stores/gameRuleFactRegistry.ts", "stores/lifeResolution.ts",
    "stores/lifeState.ts", "stores/mastermindFinalDay.ts", "stores/rulesQuery.ts", "stores/victoryEvidence.ts",
  ].sort();
  it("only the listed files read the hidden life", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, relative } = await import("node:path");
    const SRC = join(process.cwd(), "src");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
    const readers = walk(SRC)
      .filter((file) => /\.tsx?$/.test(file) && !/\.(test|spec)\./.test(file) && !file.includes(`${join(SRC, "test")}/`))
      .filter((file) => /isTrulyAlive|trulyAlive\(|hasHiddenLife|HIDDEN_LIFE|"livesOn"/.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file)).sort();
    expect(readers).toEqual(TRUTH_READERS);
    for (const file of readers) expect(file, file).not.toMatch(/projections|firebase\/|features\/player|features\/public/);
  });
});
