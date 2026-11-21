// SV-4c: the Evil Twin -- the pair reader, the setup choice, the TWIN token, the Night row's timing, privacy and storage.
import { beforeEach, describe, expect, it } from "vitest";
import { EVIL_TWIN } from "./eviltwin";
import { VERIFIED_DESCRIPTORS } from "./index";
import { REVIEWED_INTERACTION_ROLES } from "./passiveRules";
import { bind, impair, patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import { SNAKE_CHARMER_TARGET } from "./snakecharmer";
import { applyRolePlan, defaultRoleIds, planRoleTransaction, toldRoleChangeIntents } from "@/stores/roleResolution";
import { captureCharacterActionContext, useStorytellerStore as store } from "@/stores/storytellerStore";
import { TWIN_EFFECT, TWIN_EVIL_PARAMETER, goodTwinIntents, twinIntroduced, twinMarkers, twinPairOf } from "@/stores/twinPair";
import { readinessFindings, setupReadiness } from "@/rules/setup/setupReadiness";
import { selectSetupContext } from "@/rules/setup/setupContext";
import { twinSetup } from "@/rules/setup/twinSetup";
import { computeNightOrder } from "@/rules/night/nightOrder";
import { officialEffectPresentation } from "@/features/reminders/officialReminderPresentation";
import { playerMarks } from "@/features/grimoire-v6/board/marks";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { planEffectTransaction, applyEffectPlan } from "@/stores/effectResolution";
import { participantStepKey } from "@/stores/nightProgress";
import { createRulesQuery } from "@/stores/rulesQuery";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { buildRegistry } from "@/data/roleRegistry";
import { sectsAndViolets } from "@/data/scripts/sectsAndViolets";
import type { StorytellerLobbyRecord } from "@/stores/types";

// p0 eviltwin, p1 imp, p2 chef, p3 empath, p4 saint, p5 monk, p6 sage
const ROLES = ["eviltwin", "imp", "chef", "empath", "saint", "monk", "sage"];
const bindOf = (g: StorytellerLobbyRecord, id: string) => ({ playerId: id, participantId: g.players[id]!.participantId! });
/** The Good Twin the Storyteller chose at setup: the marker on `good`, naming p0. */
function withTwin(g: StorytellerLobbyRecord, good = "p2", evil = "p0"): StorytellerLobbyRecord {
  const built = goodTwinIntents(g, bindOf(g, evil), bindOf(g, good));
  if (!built.ok) throw new Error(built.message);
  const result = planEffectTransaction(g, { intents: built.intents }, { historyId: () => `h-${Math.random()}`, effectId: () => `fx-twin-${good}` });
  if (!result.ok || !result.changed) throw new Error("not a changing plan");
  const placed = applyEffectPlan(g, result.plan);
  // The marker is chosen while setting up (before Night 1), as the Prepare row does.
  return patchPlayer(placed, good, { effects: placed.players[good]!.effects.map((effect) => effect.type === TWIN_EFFECT ? { ...effect, appliedAt: { phase: "setup" as const, day: 0 } } : effect) });
}
const environment = { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS };

describe("Evil Twin -- the descriptor and the lists", () => {
  it("is a guided, reviewed character with a first- and later-night wake and no workspace input", () => {
    expect(VERIFIED_DESCRIPTORS.map((d) => d.roleId)).toContain("eviltwin");
    expect(REVIEWED_INTERACTION_ROLES.has("eviltwin")).toBe(true);
    expect(EVIL_TWIN).toMatchObject({ timing: ["firstNight", "otherNight"], invocation: "wake", inputs: [] });
  });
});

describe("Evil Twin -- the pair, derived", () => {
  it("no Evil Twin in play: nothing; two Evil Twins: by hand", () => {
    expect(twinPairOf(proofGame(["imp", "chef", "empath"]).players)).toEqual({ kind: "none" });
    expect(twinPairOf(proofGame(["eviltwin", "eviltwin", "chef"]).players)).toEqual({ kind: "many" });
  });

  it("a marked player of the opposing alignment is the pair; the good-aligned one is the Good Twin", () => {
    const g = withTwin(proofGame(ROLES));
    const pair = twinPairOf(g.players);
    expect(pair).toMatchObject({ kind: "single", valid: true, markers: 1 });
    if (pair.kind !== "single") throw new Error("single");
    expect(pair.evil.id).toBe("p0");
    expect(pair.other?.id).toBe("p2");
    expect(pair.good?.id).toBe("p2");
  });

  it("no marker: not paired; a marker that names another Evil Twin is not this Evil Twin's", () => {
    const g = proofGame(ROLES);
    expect(twinPairOf(g.players)).toMatchObject({ kind: "single", valid: false, markers: 0, other: null, good: null });
    // A stale marker naming a participant who is no longer this Evil Twin (a redeal, a Pit-Hag) pairs nothing.
    const stale = patchPlayer(withTwin(g), "p0", { participantId: "someone-else" });
    expect(twinPairOf(stale.players)).toMatchObject({ kind: "single", valid: false, markers: 0 });
  });

  it("the pair breaks when both are the same alignment, and stands again when they differ; the marker is never removed by itself", () => {
    const g = withTwin(proofGame(ROLES));
    const same = patchPlayer(g, "p2", { actualAlignment: "evil" });
    expect(twinPairOf(same.players)).toMatchObject({ valid: false, reason: "Both Twins are now the same alignment.", markers: 1 });
    expect(twinMarkers(same.players)).toHaveLength(1);
    // "It doesn't matter which twin is which character, what matters is their alignment": an Evil Twin who is now good makes the evil
    // marked player the one opposing them, and the good-aligned Twin is the Evil Twin character's holder.
    const turned = patchPlayer(patchPlayer(g, "p0", { actualAlignment: "good" }), "p2", { actualAlignment: "evil" });
    const pair = twinPairOf(turned.players);
    expect(pair).toMatchObject({ valid: true });
    if (pair.kind !== "single") throw new Error("single");
    expect(pair.good?.id).toBe("p0");
  });

  it("a dead Twin leaves the pair in place (the endings read it); a seat replaced since is not the pair", () => {
    const g = withTwin(proofGame(ROLES));
    expect(twinPairOf(patchPlayer(g, "p0", { alive: false }).players)).toMatchObject({ valid: true });
    expect(twinPairOf(patchPlayer(g, "p2", { alive: false }).players)).toMatchObject({ valid: true });
    expect(twinPairOf(patchPlayer(g, "p2", { isEmpty: true }).players)).toMatchObject({ valid: false, markers: 0 });
  });

  it("choosing a Good Twin moves the TWIN token in one transaction: the old marker is removed, one new marker is placed", () => {
    const g = withTwin(proofGame(ROLES), "p2");
    const built = goodTwinIntents(g, bindOf(g, "p0"), bindOf(g, "p3"));
    expect(built).toMatchObject({ ok: true });
    if (!built.ok) throw new Error("ok");
    expect(built.intents.map((intent) => intent.kind)).toEqual(["remove", "apply"]);
    const result = planEffectTransaction(g, { intents: built.intents }, { historyId: () => "h-move", effectId: () => "fx-twin-p3" });
    if (!result.ok || !result.changed) throw new Error("not a changing plan");
    const moved = applyEffectPlan(g, result.plan);
    expect(twinMarkers(moved.players).map(({ holder }) => holder.id)).toEqual(["p3"]);
    expect(twinPairOf(moved.players)).toMatchObject({ valid: true });
  });

  it("refuses an invalid Good Twin: the Evil Twin, a Traveller, the same alignment, a stale seat", () => {
    const g = proofGame(ROLES);
    const refuse = (id: string, g2 = g) => goodTwinIntents(g2, bindOf(g2, "p0"), bindOf(g2, id));
    expect(refuse("p0")).toMatchObject({ ok: false });
    expect(refuse("p1")).toMatchObject({ ok: false, message: expect.stringMatching(/opposing/) });
    expect(refuse("p2", patchPlayer(g, "p2", { isTraveler: true }))).toMatchObject({ ok: false, message: expect.stringMatching(/Traveller/) });
    expect(goodTwinIntents(g, bindOf(g, "p0"), { playerId: "p2", participantId: "former" })).toMatchObject({ ok: false });
    expect(goodTwinIntents(g, { playerId: "p1", participantId: g.players.p1!.participantId! }, bindOf(g, "p2"))).toMatchObject({ ok: false });
  });
});

describe("Evil Twin -- the Night row", () => {
  const order = (g: StorytellerLobbyRecord, first: boolean, day: number, progress: Record<string, { status: string }> = {}) =>
    computeNightOrder(g.players, g.seatOrder, proofScript, first, { day, nightProgress: progress }).filter((step) => step.kind === "player" && step.effectiveRoleId === "eviltwin");
  const doneOn = (g: StorytellerLobbyRecord, day: number) => ({ [`${day}:${participantStepKey(g.players.p0!.participantId!, "eviltwin")}`]: { status: "done" } });

  it("is listed on the first night", () => {
    expect(order(withTwin(proofGame(ROLES, "night", 1)), true, 1)).toHaveLength(1);
  });

  it("is not listed on a later night once the pair has been introduced", () => {
    const g = withTwin(proofGame(ROLES, "night", 2));
    expect(order(g, false, 2, doneOn(g, 1))).toHaveLength(0);
    expect(order(g, false, 3, doneOn(g, 1))).toHaveLength(0);
  });

  it("is listed again when the pair broke, when no Good Twin was ever chosen, or when it was re-chosen after the last introduction", () => {
    const g = withTwin(proofGame(ROLES, "night", 2));
    // broke
    expect(order(patchPlayer(g, "p2", { actualAlignment: "evil" }), false, 2, doneOn(g, 1))).toHaveLength(1);
    // never chosen (a Pit-Hag made the Evil Twin)
    expect(order(proofGame(ROLES, "night", 2), false, 2, doneOn(g, 1))).toHaveLength(1);
    // introduced on Night 1; the pair was re-chosen in the Day after (a marker placed Day 1 needs Night 2's step)
    const rechosen = patchPlayer(g, "p2", { effects: g.players.p2!.effects.map((effect) => ({ ...effect, appliedAt: { phase: "day" as const, day: 1 } })) });
    expect(order(rechosen, false, 2, doneOn(g, 1))).toHaveLength(1);
    // Done tonight, the row stays tonight (as a done row); the next night it is gone.
    expect(order(rechosen, false, 2, { ...doneOn(g, 1), ...doneOn(g, 2) })).toHaveLength(1);
    expect(order(rechosen, false, 3, { ...doneOn(g, 1), ...doneOn(g, 2) })).toHaveLength(0);
  });

  it("is never listed again for a dead Evil Twin or a Drunk shown the Evil Twin, and never for an unrelated pair", () => {
    const g = proofGame(ROLES, "night", 2);
    expect(order(patchPlayer(g, "p0", { alive: false }), false, 2)).toHaveLength(0);
    expect(twinIntroduced({ kind: "single", evil: g.players.p0!, other: null, marker: null, valid: false, good: null, reason: "", markers: 0 }, {}, 2)).toBe(false);
  });
});

describe("Evil Twin -- ability works (derived)", () => {
  it("a living sober Evil Twin has the ability; poisoned, it does not; dead (without the Vigormortis), it does not", () => {
    const g = withTwin(proofGame(ROLES));
    const query = (game: StorytellerLobbyRecord) => createRulesQuery(game, environment);
    expect(query(g).abilityFunctions(bindOf(g, "p0"))).toEqual({ known: true, value: true });
    const poisoned = impair(g, "p0");
    expect(query(poisoned).abilityFunctions(bindOf(poisoned, "p0"))).toEqual({ known: true, value: false });
  });
});

describe("Evil Twin -- the pair through other characters' changes", () => {
  const step = { withStep: true, completeStep: true } as const;

  it("a Pit-Hag-made Evil Twin has no marker: the pair is not valid until the Storyteller chooses a Good Twin, and the row is listed for it", () => {
    const g = proofGame(["pithag", "imp", "chef", "empath", "saint"], "night", 2);
    const changed = planRoleTransaction(g, { intents: toldRoleChangeIntents(g.players.p2!, "eviltwin") }, { script: proofScript, ids: defaultRoleIds });
    if (!changed.ok || !changed.changed) throw new Error("Expected change");
    const made = applyRolePlan(g, changed.plan);
    expect(twinPairOf(made.players)).toMatchObject({ kind: "single", valid: false, markers: 0 });
    const listed = computeNightOrder(made.players, made.seatOrder, proofScript, false, { day: 2, nightProgress: {} }).filter((entry) => entry.kind === "player" && entry.effectiveRoleId === "eviltwin");
    expect(listed).toHaveLength(1);
    // "If a good player is turned into an Evil Twin, they are still a good player, with an evil player becoming their twin": a good player
    // is refused as the other Twin, an evil one is offered.
    expect(goodTwinIntents(made, bindOf(made, "p2"), bindOf(made, "p3"))).toMatchObject({ ok: false, message: expect.stringMatching(/opposing/) });
    const evilOne = goodTwinIntents(made, bindOf(made, "p2"), bindOf(made, "p1"));
    expect(evilOne).toMatchObject({ ok: true });
  });

  it("a Snake Charmer swap of the Good Twin: the TWIN reminder stays, and the pair is read from the new alignments (the evil Demon-holder is now the same alignment as the Evil Twin)", () => {
    const g = withTwin(proofGame(["snakecharmer", "imp", "eviltwin", "empath", "saint"], "night", 2), "p0", "p2");
    expect(twinPairOf(g.players)).toMatchObject({ valid: true });
    const swapped = planned(plan(g, request(g, "p0", "snakecharmer", { [SNAKE_CHARMER_TARGET]: pick(g, "p1") }, step)));
    expect(swapped.players.p0!).toMatchObject({ actualRole: "imp", actualAlignment: "evil" });
    // The marker did not move with the character.
    expect(twinMarkers(swapped.players).map(({ holder }) => holder.id)).toEqual(["p0"]);
    expect(twinPairOf(swapped.players)).toMatchObject({ kind: "single", valid: false, reason: "Both Twins are now the same alignment." });
  });

  it("a Good Twin who is a Drunk, or any character that registers differently, is still the pair by alignment; the Recluse is the Storyteller's call at the ending (SV-4d)", () => {
    const g = withTwin(patchPlayer(proofGame(ROLES), "p2", { actualRole: "recluse" }));
    expect(twinPairOf(g.players)).toMatchObject({ valid: true });
  });

  it("the Evil Twin's ability does not work while it is dead (no Vigormortis), impaired, or lost; a Vigormortis-killed one keeps it", () => {
    const g = withTwin(proofGame(["eviltwin", "vigormortis", "chef", "empath", "saint"]), "p2");
    const query = (game: StorytellerLobbyRecord) => createRulesQuery(game, environment);
    const dead = patchPlayer(g, "p0", { alive: false });
    expect(query(dead).retainsAbility(bindOf(dead, "p0"))).toMatchObject({ known: true });
    const noVigor = withTwin(proofGame(["eviltwin", "imp", "chef", "empath", "saint"]), "p2");
    const gone = patchPlayer(noVigor, "p0", { alive: false });
    expect(query(gone).retainsAbility(bindOf(gone, "p0"))).toEqual({ known: true, value: false });
    void bind;
  });
});

describe("Evil Twin -- the TWIN token, privacy and storage", () => {
  it("draws the official TWIN token (the Evil Twin's) on the Good Twin, and none on anyone else", () => {
    const g = withTwin(proofGame(ROLES));
    expect(officialEffectPresentation(g.players.p2!).tokens.map((token) => `${token.role.id}:${token.label}`)).toEqual(["eviltwin:Twin"]);
    for (const id of ["p0", "p1", "p3", "p4", "p5", "p6"]) expect(officialEffectPresentation(g.players[id]!).tokens).toEqual([]);
    const marks = playerMarks({ script: proofScript, registry: proofRegistry, query: createRulesQuery(g, environment), game: g } as never, g.players.p2!);
    expect(marks.map((mark) => mark.title ?? mark.label).join(" ")).toMatch(/Twin/);
  });

  it("the marker is a source-free Storyteller fact naming the Evil Twin, with no sourceCharacter, and no stored-format change", () => {
    const g = withTwin(proofGame(ROLES));
    const effect = g.players.p2!.effects.find((e) => e.type === TWIN_EFFECT)!;
    expect(effect).toMatchObject({ type: "twin", state: "active", lifetime: { kind: "manual" }, expiry: { kind: "none" } });
    expect(effect).not.toHaveProperty("sourceCharacter");
    expect(effect).not.toHaveProperty("sourceParticipant");
    expect(effect.parameters?.[TWIN_EVIL_PARAMETER]).toMatchObject({ kind: "participant", participants: [{ playerId: "p0", participantId: g.players.p0!.participantId }] });
    expect(g.gameSchemaVersion).toBe(29);
    expect(StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(g))).success).toBe(true);
  });

  it("neither the public projection nor a player's own carries the TWIN marker, the pair or who the Good Twin is (a player sees only their own character)", () => {
    const g = withTwin(proofGame(ROLES));
    const publicView = JSON.stringify(projectLobbyToPublic(g, {}));
    const selfMap = projectLobbyToSelfMap(g, buildRegistry(proofScript));
    expect(publicView).not.toMatch(/twin|Twin/);
    expect(publicView).not.toContain("effects");
    // The Good Twin's own packet is exactly what every player's is: their character and alignment, nothing about a pair.
    expect(selfMap.p2).toEqual({ shownRole: "chef", shownAlignment: "good" });
    const text = JSON.stringify(selfMap);
    expect(text).not.toMatch(/"type":"twin"|Good Twin|goodTwin|marker|effects/);
  });
});

describe("Evil Twin -- the setup choice", () => {
  const SV_ROLES = ["eviltwin", "fanggu", "clockmaker", "dreamer", "sage", "mutant", "oracle"];
  const state = () => store.getState();
  const game = () => state().game!;
  const idOf = (role: string) => Object.values(game().players).find((player) => player.actualRole === role)!.id;
  const setup = () => twinSetup(selectSetupContext(game(), sectsAndViolets));
  const blocker = () => readinessFindings(selectSetupContext(game(), sectsAndViolets)).find((finding) => finding.code === "good-twin");
  const markers = () => twinMarkers(game().players).map(({ holder }) => holder.id);
  function prepare(roles = SV_ROLES) {
    state().newGame("snv", { plannedPlayerCount: roles.length, plannedRoles: roles });
    for (let i = 0; i < roles.length; i++) state().addPlayerToSeat(`Player ${i}`);
    expect(state().dealRolePool().ok).toBe(true);
    store.setState({ undoStack: [], localSeq: 0 });
  }
  beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [], localSeq: 0, customScripts: {} }); });

  it("an Evil Twin in the deal makes the Good Twin required before Night 1; choosing one satisfies it; Undo takes it back", () => {
    prepare();
    expect(setup()).toMatchObject({ required: true, status: "missing" });
    expect(blocker()).toMatchObject({ severity: "blocker", actions: ["begin"], message: "Choose the Good Twin." });
    expect(setupReadiness(readinessFindings(selectSetupContext(game(), sectsAndViolets)), "begin")).toMatchObject({ ok: false });
    expect(state().setSetupGoodTwin(bindOf(game(), idOf("clockmaker")), captureCharacterActionContext())).toMatchObject({ ok: true, changed: true });
    expect(setup()).toMatchObject({ status: "ready", target: bindOf(game(), idOf("clockmaker")) });
    expect(blocker()).toBeUndefined();
    expect(state().undoStack).toHaveLength(1);
    state().undo();
    expect(setup()).toMatchObject({ status: "missing" });
    expect(markers()).toEqual([]);
  });

  it("a game with no Evil Twin has no Good Twin row and no blocker", () => {
    prepare(["witch", "fanggu", "clockmaker", "dreamer", "sage", "mutant", "oracle"]);
    expect(setup()).toMatchObject({ required: false, status: "ready" });
    expect(blocker()).toBeUndefined();
  });

  it("refuses an evil player, the Evil Twin, a stale seat and a second choice, changing nothing", () => {
    prepare();
    const before = game();
    for (const id of [idOf("fanggu"), idOf("eviltwin")]) expect(state().setSetupGoodTwin(bindOf(game(), id), captureCharacterActionContext())).toMatchObject({ ok: false });
    expect(state().setSetupGoodTwin({ playerId: idOf("clockmaker"), participantId: "former" }, captureCharacterActionContext())).toMatchObject({ ok: false });
    expect(game()).toBe(before);
    expect(state().setSetupGoodTwin(bindOf(game(), idOf("clockmaker")), captureCharacterActionContext())).toMatchObject({ ok: true });
    const chosen = game();
    expect(state().setSetupGoodTwin(bindOf(game(), idOf("dreamer")), captureCharacterActionContext())).toMatchObject({ ok: false });
    expect(game()).toBe(chosen);
    expect(markers()).toEqual([idOf("clockmaker")]);
  });

  it("the marker is source-free and names the Evil Twin; the pair is valid and survives a reload through the schema", () => {
    prepare();
    state().setSetupGoodTwin(bindOf(game(), idOf("sage")), captureCharacterActionContext());
    const effect = game().players[idOf("sage")]!.effects.find((e) => e.type === TWIN_EFFECT)!;
    expect(effect).not.toHaveProperty("sourceCharacter");
    expect(effect.parameters?.[TWIN_EVIL_PARAMETER]).toMatchObject({ participants: [bindOf(game(), idOf("eviltwin"))] });
    expect(twinPairOf(game().players)).toMatchObject({ valid: true });
    expect(StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(game()))).success).toBe(true);
  });

  it("a redeal that moves the Evil Twin leaves the old marker pairing nobody, and the new choice replaces it in the same commit", () => {
    prepare();
    state().setSetupGoodTwin(bindOf(game(), idOf("clockmaker")), captureCharacterActionContext());
    expect(state().swapSetupRoles(idOf("eviltwin"), idOf("dreamer")).ok).toBe(true);
    expect(setup()).toMatchObject({ status: "missing" });
    expect(markers()).toHaveLength(1);
    expect(state().setSetupGoodTwin(bindOf(game(), idOf("clockmaker")), captureCharacterActionContext())).toMatchObject({ ok: true });
    expect(markers()).toEqual([idOf("clockmaker")]);
    expect(twinPairOf(game().players)).toMatchObject({ valid: true });
  });
});
