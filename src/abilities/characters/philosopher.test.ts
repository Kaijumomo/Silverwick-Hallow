// SV-3a -- Philosopher: "Once per game, at night, choose a good character: gain that ability. If this character is in play, they are
// drunk." https://wiki.bloodontheclocktower.com/Philosopher -- production semantics, the real coordinator and the real store.
import { beforeEach, describe, expect, it } from "vitest";
import { PHILOSOPHER, PHILOSOPHER_CHARACTER } from "./philosopher";
import { bind, homebrewEnv, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, proofQuery, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { participantStepKey } from "@/stores/nightProgress";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { computeNightOrder } from "@/rules/night/nightOrder";
import { gainedRecordOf, gainedRoleOf, gainedTokenShownOf } from "@/stores/gainedAbility";
import { playerMarks, reminderPalette } from "@/features/grimoire-v6/board/marks";
import type { AbilityInputValue } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";

// p0 philosopher, p1 fanggu, p2 dreamer, p3 clockmaker, p4 witch, p5 sage, p6 pithag. Not in play: mathematician, artist, juggler.
const ROLES = ["philosopher", "fanggu", "dreamer", "clockmaker", "witch", "sage", "pithag"];
const game = () => store.getState().game!;
const pid = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.participantId!;
const character = (roleId: string): AbilityInputValue => ({ kind: "character", roleIds: [roleId] });
const choose = (g: StorytellerLobbyRecord, roleId: string, env = undefined as ReturnType<typeof homebrewEnv> | undefined, actor = "p0") =>
  plan(g, request(g, actor, "philosopher", { [PHILOSOPHER_CHARACTER]: character(roleId) }, { withStep: true, completeStep: true }), env);
const drunkTwin = (g: StorytellerLobbyRecord, id: string) => proofQuery(g).gainedAbilityDrunk(bind(g, id));
/** The derived drunkenness, which is always known here. */
const twin = (g: StorytellerLobbyRecord, id: string) => { const answer = drunkTwin(g, id); expect(answer.known).toBe(true); return answer.known && answer.value; };
const functions = (g: StorytellerLobbyRecord, id: string) => proofQuery(g).abilityFunctions(bind(g, id));
const step = (g: StorytellerLobbyRecord, id: string, roleId: string) => g.nightProgress[`${g.day}:${participantStepKey(pid(g, id), roleId)}`]?.status;
const rows = (g: StorytellerLobbyRecord) => computeNightOrder(g.players, g.seatOrder, proofScript, g.day === 1 && g.phase === "night", g)
  .flatMap((s) => s.kind === "player" ? [`${s.playerId}:${s.effectiveRoleId}`] : []);
const env = (g: StorytellerLobbyRecord) => ({ game: g, script: proofScript, registry: proofRegistry, query: proofQuery(g) });
const markKeys = (g: StorytellerLobbyRecord, id: string) => playerMarks(env(g), g.players[id]!).map((m) => m.key);
/** The next night, as the Day and the Night advance (only the clock changes). */
const nextNight = (g: StorytellerLobbyRecord): StorytellerLobbyRecord => ({ ...g, day: g.day + 1, phase: "night" });

beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));

describe("Philosopher -- the choice", () => {
  it("a character not in play: the ability is used and gained, the board shows the chosen token with IS THE PHILOSOPHER, nobody is drunk", () => {
    const g = proofGame(ROLES);
    const next = planned(choose(g, "mathematician"));
    const me = next.players.p0!;
    expect(me).toMatchObject({ abilityUsed: true, actualRole: "philosopher", shownRole: "philosopher", actualAlignment: "good", shownAlignment: "good" });
    expect(gainedRoleOf(me)).toBe("mathematician");
    expect(gainedTokenShownOf(me)).toBe("mathematician");
    expect(gainedRecordOf(me)).toMatchObject({ type: "gainedAbility", sourceCharacter: "philosopher", appliedAt: { phase: "night", day: 2 } });
    for (const id of g.seatOrder) expect(drunkTwin(next, id)).toEqual({ known: true, value: false });
    expect(step(next, "p0", "philosopher")).toBe("done");
    expect(markKeys(next, "p0")).toContain("derived:philosopher-is");
    for (const id of g.seatOrder) expect(markKeys(next, id)).not.toContain("derived:philosopher-drunk");
  });

  it("a character in play: its player is drunk with the Philosopher's DRUNK token, the Philosopher keeps their token", () => {
    const g = proofGame(ROLES);
    const next = planned(choose(g, "dreamer"));
    expect(gainedRoleOf(next.players.p0)).toBe("dreamer");
    expect(gainedTokenShownOf(next.players.p0)).toBeNull();
    expect(drunkTwin(next, "p2")).toEqual({ known: true, value: true });
    expect(functions(next, "p2")).toEqual({ known: true, value: false });
    // Only the holder: nobody else, and the Philosopher's own ability still works.
    for (const id of ["p0", "p1", "p3", "p4", "p5", "p6"]) expect(drunkTwin(next, id)).toEqual({ known: true, value: false });
    expect(functions(next, "p0")).toEqual({ known: true, value: true });
    // Nothing is stored on the drunk player: the drunkenness is derived.
    expect(next.players.p2).toEqual(g.players.p2);
    expect(markKeys(next, "p2")).toContain("derived:philosopher-drunk");
    expect(markKeys(next, "p0")).not.toContain("derived:philosopher-is");
  });

  it("two players truly hold the chosen character: both are drunk", () => {
    const g = patchPlayer(proofGame(ROLES), "p3", { actualRole: "dreamer", shownRole: "dreamer" });
    const next = planned(choose(g, "dreamer"));
    expect(twin(next, "p2")).toBe(true);
    expect(twin(next, "p3")).toBe(true);
  });

  it("the true character decides (PO Q5): a Drunk or a Marionette who only believes they are it is not its holder", () => {
    for (const [actualRole, behaviorMode, actualAlignment] of [["drunk", "drunk_fake_role_behavior", "good"], ["marionette", "marionette_fake_good_behavior", "evil"]] as const) {
      // Nobody truly holds the Dreamer: not in play. The token swaps and nobody is drunk.
      const g = patchPlayer(proofGame(ROLES), "p2", { actualRole, shownRole: "dreamer", behaviorMode, actualAlignment });
      const next = planned(choose(g, "dreamer"));
      expect(gainedTokenShownOf(next.players.p0)).toBe("dreamer");
      expect(twin(next, "p2")).toBe(false);
      // A real Dreamer beside them: only the real one is drunk, and the Philosopher keeps their token.
      const real = patchPlayer(g, "p3", { actualRole: "dreamer", shownRole: "dreamer" });
      const after = planned(choose(real, "dreamer"));
      expect(gainedTokenShownOf(after.players.p0)).toBeNull();
      expect(twin(after, "p3")).toBe(true);
      expect(twin(after, "p2")).toBe(false);
    }
  });

  it("the drunk player is sober while the Philosopher is dead, drunk or poisoned, and drunk again when they are not", () => {
    const next = planned(choose(proofGame(ROLES), "dreamer"));
    const dead = patchPlayer(next, "p0", { alive: false });
    expect(twin(dead, "p2")).toBe(false);
    expect(functions(dead, "p2")).toEqual({ known: true, value: true });
    expect(markKeys(dead, "p2")).not.toContain("derived:philosopher-drunk");
    // The gained ability itself is kept through death ("If the Philosopher's ability works while dead ... it works if the Philosopher is dead").
    expect(gainedRoleOf(dead.players.p0)).toBe("dreamer");
    const alive = patchPlayer(dead, "p0", { alive: true });
    expect(twin(alive, "p2")).toBe(true);
    for (const type of ["drunk", "poisoned"]) {
      const impaired = impair(next, "p0", type);
      expect(twin(impaired, "p2")).toBe(false);
      expect(gainedRoleOf(impaired.players.p0)).toBe("dreamer");
    }
  });

  it("only the drunkenness the Philosopher caused ends: a Poisoner-style Effect on the same player is untouched", () => {
    const next = impair(planned(choose(proofGame(ROLES), "dreamer")), "p2", "poisoned");
    const dead = patchPlayer(next, "p0", { alive: false });
    expect(twin(dead, "p2")).toBe(false);
    expect(functions(dead, "p2")).toEqual({ known: true, value: false });
  });

  it("a character change ends the gain: the Pit-Hag turns the Philosopher into a Sage, the record goes and the drunk player is sober", () => {
    const next = planned(choose(proofGame(ROLES), "dreamer"));
    const hagged = planned(plan(next, request(next, "p6", "pithag", { target: pick(next, "p0"), character: character("savant") })));
    expect(hagged.players.p0!.actualRole).toBe("savant");
    expect(gainedRoleOf(hagged.players.p0)).toBeNull();
    expect(hagged.players.p0!.effects.some((e) => e.type === "gainedAbility" && e.state === "active")).toBe(false);
    expect(twin(hagged, "p2")).toBe(false);
    // A read-time guard too: a record left behind by a hand-made change of character is never read.
    const byHand = patchPlayer(next, "p0", { actualRole: "savant", shownRole: "savant" });
    expect(gainedRoleOf(byHand.players.p0)).toBeNull();
    expect(twin(byHand, "p2")).toBe(false);
  });

  it("a character not in play when chosen and in play later (the Pit-Hag makes one): its player is drunk from then", () => {
    const next = planned(choose(proofGame(ROLES), "mathematician"));
    const later = patchPlayer(next, "p5", { actualRole: "mathematician", shownRole: "mathematician" });
    expect(twin(later, "p5")).toBe(true);
  });

  it("drunk or poisoned, or a Drunk shown the Philosopher: the choice uses the ability and gains nothing", () => {
    for (const type of ["drunk", "poisoned"]) {
      const g = impair(proofGame(ROLES), "p0", type);
      const next = planned(choose(g, "dreamer"));
      expect(next.players.p0!.abilityUsed).toBe(true);
      expect(gainedRoleOf(next.players.p0)).toBeNull();
      expect(twin(next, "p2")).toBe(false);
    }
    const drunk = patchPlayer(proofGame(ROLES), "p0", { actualRole: "drunk", shownRole: "philosopher", behaviorMode: "drunk_fake_role_behavior" });
    const result = choose(drunk, "dreamer");
    expect(result).toMatchObject({ ok: true });
    if (result.ok && result.changed) {
      expect(gainedRoleOf(result.plan.game.players.p0)).toBeNull();
      expect(twin(result.plan.game, "p2")).toBe(false);
    }
  });

  it("only one Townsfolk or Outsider of the script may be chosen; a Minion or Demon is refused", () => {
    const g = proofGame(ROLES);
    expect(choose(g, "fanggu")).toMatchObject({ ok: false, code: "illegal" });
    expect(choose(g, "witch")).toMatchObject({ ok: false, code: "illegal" });
    expect(plan(g, request(g, "p0", "philosopher", { [PHILOSOPHER_CHARACTER]: { kind: "character", roleIds: ["dreamer", "sage"] } }, { withStep: true, completeStep: true })))
      .toMatchObject({ ok: false, code: "illegal" });
    // An Outsider is fine.
    expect(gainedRoleOf(planned(choose(g, "sweetheart")).players.p0)).toBe("sweetheart");
  });

  it("by hand: choosing the Philosopher (the pages are silent) or an unofficial character", () => {
    const g = proofGame(ROLES);
    expect(choose(g, "philosopher")).toMatchObject({ ok: false, code: "unsupported" });
    expect(choose(g, "dreamer", homebrewEnv("dreamer"))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("a dead Philosopher has no choice to make", () => {
    expect(choose(patchPlayer(proofGame(ROLES), "p0", { alive: false }), "dreamer")).toMatchObject({ ok: false });
  });

  it("the descriptor: once per game, each night, one character input", () => {
    expect(PHILOSOPHER).toMatchObject({ roleId: "philosopher", timing: ["firstNight", "otherNight"], invocation: "wake", usage: { kind: "oncePerGame" } });
    expect(PHILOSOPHER.inputs).toEqual([expect.objectContaining({ id: PHILOSOPHER_CHARACTER, kind: "character" })]);
    expect(PHILOSOPHER.presentation?.action).toBe("Choose a good character");
  });
});

describe("Philosopher -- Not Tonight, and which nights they wake", () => {
  it("Not Tonight closes tonight's step and uses nothing; they wake again next night", () => {
    const g = proofGame(ROLES);
    openInStore(g);
    expect(store.getState().setNightStepStatus(g.day, participantStepKey(pid(g, "p0"), "philosopher"), "done")).toMatchObject({ ok: true });
    expect(step(game(), "p0", "philosopher")).toBe("done");
    expect(game().players.p0!.abilityUsed).toBe(false);
    expect(gainedRoleOf(game().players.p0)).toBeNull();
    expect(rows(nextNight(game()))).toContain("p0:philosopher");
  });

  it("once used, the Philosopher's own row stays (done) that night and is gone from the next", () => {
    const next = planned(choose(proofGame(ROLES), "mathematician"));
    expect(rows(next)).toContain("p0:philosopher");
    expect(rows(nextNight(next))).not.toContain("p0:philosopher");
  });

  it("the page's first example: the Dreamer on the first night, the Philosopher wakes again at the Dreamer's place", () => {
    const g = patchPlayer(proofGame(ROLES, "night", 1), "p2", { actualRole: "mathematician", shownRole: "mathematician" });
    const next = planned(choose(g, "dreamer"));
    const order = rows(next);
    expect(order).toContain("p0:dreamer");
    expect(order.indexOf("p0:dreamer")).toBeGreaterThan(order.indexOf("p0:philosopher"));
    const gained = computeNightOrder(next.players, next.seatOrder, proofScript, true, next).find((s) => s.kind === "player" && s.effectiveRoleId === "dreamer" && s.playerId === "p0");
    expect(gained).toMatchObject({ kind: "player", gainedFrom: "philosopher", actualRoleId: "philosopher", stepKey: participantStepKey(pid(g, "p0"), "dreamer") });
    // ... and every night after.
    expect(rows(nextNight(next))).toContain("p0:dreamer");
  });

  it("the page's second example: the Clockmaker on the third night, they wake again tonight only (a first-night ability)", () => {
    const g = proofGame(["philosopher", "fanggu", "dreamer", "mathematician", "witch", "sage", "pithag"], "night", 3);
    const next = planned(choose(g, "clockmaker"));
    const order = rows(next);
    expect(order).toContain("p0:clockmaker");
    expect(order.indexOf("p0:clockmaker")).toBe(order.indexOf("p0:philosopher") + 1);
    expect(rows(nextNight(next))).not.toContain("p0:clockmaker");
  });

  it("no Townsfolk or Outsider wakes before the Philosopher, so a gained night ability can always be used the night it is gained", () => {
    const own = proofRegistry.get("philosopher")!;
    for (const role of proofScript.characters.filter((r) => (r.type === "townsfolk" || r.type === "outsider") && r.id !== own.id)) {
      if (role.firstNight) expect(role.firstNight).toBeGreaterThan(own.firstNight!);
      if (role.otherNight) expect(role.otherNight).toBeGreaterThan(own.otherNight!);
    }
    const next = planned(choose(proofGame(ROLES), "mathematician"));
    const order = rows(next);
    expect(order.indexOf("p0:mathematician")).toBeGreaterThan(order.indexOf("p0:philosopher"));
  });

  it("a gained Juggler wakes only the night after the first day it was gained for", () => {
    const next = planned(choose(proofGame(ROLES, "night", 2), "juggler"));
    expect(rows(next)).not.toContain("p0:juggler");
    expect(rows(nextNight(next))).toContain("p0:juggler");
    expect(rows(nextNight(nextNight(next)))).not.toContain("p0:juggler");
  });

  it("a gained character that never wakes (Sweetheart, Mutant) adds no row; a gained Sage is listed only after the Philosopher's death", () => {
    for (const roleId of ["sweetheart", "mutant"]) {
      const next = planned(choose(proofGame(ROLES), roleId));
      expect(rows(nextNight(next)).filter((r) => r.startsWith("p0:"))).toEqual([]);
    }
    const sage = planned(choose(patchPlayer(proofGame(ROLES), "p5", { actualRole: "savant", shownRole: "savant" }), "sage"));
    expect(rows(nextNight(sage))).not.toContain("p0:sage");
    // The Fang Gu kills the Philosopher the next night: the gained Sage is listed (by hand) that night.
    const night3 = nextNight(sage);
    const killed = planned(plan(night3, request(night3, "p1", "fanggu", { target: pick(night3, "p0") }, { withStep: true, completeStep: true })));
    expect(killed.players.p0!.alive).toBe(false);
    expect(rows(killed)).toContain("p0:sage");
  });

  it("a gained row is the Storyteller's by hand in SV-3a: no information is prepared for it, and the gained row is the gained character's", () => {
    const next = planned(choose(proofGame(ROLES), "mathematician"));
    const steps = computeNightOrder(next.players, next.seatOrder, proofScript, false, nextNight(next)).filter((s) => s.kind === "player" && s.playerId === "p0");
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ effectiveRoleId: "mathematician", shownRoleId: "mathematician", isDeceived: false, gainedFrom: "philosopher" });
    expect((steps[0] as { advisory?: string }).advisory).toMatch(/Gained from the Philosopher/);
  });
});

describe("Philosopher -- a gained ability outside the reviewed list (custom scripts)", () => {
  it("a gained Soldier: the engine reads protection from a player's own character, so actions go to the Storyteller while it is held", () => {
    const g = nextNight(planned(choose(proofGame(["philosopher", "imp", "chef", "monk", "poisoner"]), "soldier")));
    expect(plan(g, request(g, "p1", "imp", { target: pick(g, "p0") }, { withStep: true, completeStep: true })))
      .toMatchObject({ ok: false, code: "unsupported", message: "A gained ability in play has interactions outside verified coverage." });
    // The Sects & Violets characters were reviewed: a gained Dreamer leaves the Imp's kill guided.
    const dreamer = nextNight(planned(choose(proofGame(["philosopher", "imp", "chef", "monk", "poisoner"]), "dreamer")));
    expect(plan(dreamer, request(dreamer, "p1", "imp", { target: pick(dreamer, "p0") }, { withStep: true, completeStep: true }))).toMatchObject({ ok: true });
  });
});

describe("Philosopher -- one commit, Undo, reload, and what the phones see", () => {
  it("one commit; Undo restores the use, the gain and the step together", () => {
    const g = proofGame(ROLES);
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "philosopher", { [PHILOSOPHER_CHARACTER]: character("dreamer") }, { withStep: true, completeStep: true })))
      .toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(1);
    expect(twin(game(), "p2")).toBe(true);
    store.getState().undo();
    expect(game().players).toEqual(g.players);
    expect(game().nightProgress).toEqual(g.nightProgress);
    expect(twin(game(), "p2")).toBe(false);
  });

  it("a saved and reloaded game keeps the gain, the token swap and the derived drunkenness (same stored format)", () => {
    for (const [roleId, check] of [["dreamer", (r: StorytellerLobbyRecord) => expect(twin(r, "p2")).toBe(true)],
      ["mathematician", (r: StorytellerLobbyRecord) => expect(gainedTokenShownOf(r.players.p0)).toBe("mathematician")]] as const) {
      const next = planned(choose(proofGame(ROLES), roleId));
      const parsed = StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(next)));
      expect(parsed.success).toBe(true);
      const reloaded = parsed.data as unknown as StorytellerLobbyRecord;
      expect(reloaded.gameSchemaVersion).toBe(next.gameSchemaVersion);
      expect(gainedRoleOf(reloaded.players.p0)).toBe(roleId);
      check(reloaded);
    }
  });

  it("no phone changes, not the Philosopher's, not the drunk player's; the public view does not change", () => {
    for (const roleId of ["dreamer", "mathematician"]) {
      const g = proofGame(ROLES);
      const next = planned(choose(g, roleId));
      expect(projectLobbyToSelfMap(next, proofRegistry)).toEqual(projectLobbyToSelfMap(g, proofRegistry));
      expect(projectLobbyToPublic(next, {})).toEqual(projectLobbyToPublic(g, {}));
    }
  });

  it("the reminder palette offers the gained character's tokens", () => {
    const next = planned(choose(proofGame(ROLES), "mathematician"));
    const inPlay = reminderPalette(env(next)).inPlay.map((entry) => entry.role.id);
    expect(inPlay).toContain("mathematician");
    expect(reminderPalette(env(proofGame(ROLES))).inPlay.map((entry) => entry.role.id)).not.toContain("mathematician");
  });
});
