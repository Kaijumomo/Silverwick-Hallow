// SV-6c: five complete Sects & Violets games at store level (docs/ai/SECTS_AND_VIOLETS_PAIRS.md names what each proves). Like
// b9WholeGames.test.ts, every game is created, seated, dealt, revealed and advanced with production commands; no live game snapshot,
// death, role, effect, phase jump or outcome is seeded with setState. Every game checks the persisted schema, the projections, Undo and a reload.
import { beforeEach, describe, expect, it } from "vitest";
import { answerArtist, markSavantTold } from "@/features/grimoire-v6/day/privateVisit";
import { endGameEligibility, klutzAdvisory, twinAdvisory, vortoxAdvisory, VORTOX_NO_EXECUTION_LINE } from "./endGameEligibility";
import { KLUTZ_GOOD_TEAM_LOST } from "./gameRuleFactRegistry";
import { subjectId } from "@/abilities/characters/shared";
import { POISONED_NEIGHBOUR } from "@/abilities/characters/vigormortis";
import { sectsAndViolets } from "@/data/scripts/sectsAndViolets";
import { alive, ctx, effects, jugglerDone, jugglerGuess, lastValues, order, visit, ability, advance, answered, begin, binding, character, choose, dawn, declare, environment, execute, game, id, nominate, number, ok, privateProjection, reload, resetStores, withoutRevealTokens, seat, setup, state, target, vote, work } from "@/test/svWholeGame";
import { captureCharacterActionContext } from "./storytellerStore";
import { endHint } from "@/features/grimoire-v6/vm/chrome";

beforeEach(resetStores);

/** The five tables (seat i holds the i-th character). Together they seat all 25 characters and all four Demons. */
const G1 = ["vortox", "witch", "clockmaker", "dreamer", "mathematician", "oracle", "towncrier"];
const G2 = ["fanggu", "cerenovus", "pithag", "mutant", "snakecharmer", "seamstress", "artist", "savant", "flowergirl", "juggler"];
const G3 = ["nodashii", "sage", "sweetheart", "eviltwin", "philosopher", "dreamer", "barber", "towncrier", "oracle"];
const G4 = ["witch", "sage", "clockmaker", "mathematician", "savant", "artist", "cerenovus", "vigormortis", "seamstress", "flowergirl", "juggler"];
const G5 = ["nodashii", "snakecharmer", "dreamer", "klutz", "eviltwin", "oracle", "towncrier", "philosopher"];
/** The endings the games reached, each recorded where the game proves it. */
const reached = new Set<string>();
describe("SV-6c game 1 (7 players): the Vortox, the Witch and five information characters; evil wins by two alive after the no-execution line", () => {
  it("plays the Vortox's false information, the no-execution line, then two alive", async () => {
    setup(G1); begin();
    // Night 1: the Witch curses the Oracle; the Vortox makes the Clockmaker's and the Dreamer's information false and the Mathematician counts it.
    choose("witch", id("oracle"));
    expect(ability("clockmaker", { communicated: number(1) })).toMatchObject({ ok: false, code: "illegal" });   // the true number is refused
    ok(ability("clockmaker", { communicated: number(2) }));
    ok(answered("dreamer", { target: target(id("oracle")) }, { "dreamer:good": character("sage"), "dreamer:evil": character("pithag") }));
    expect(effects("abnormal").sort()).toEqual(["clockmaker", "dreamer"]);
    expect(ability("mathematician")).toMatchObject({ ok: false, code: "needsInput" });                       // even the Mathematician's number is false
    ok(answered("mathematician", {}, { communicated: number(1) }));
    expect(lastValues()).toContainEqual({ requirementId: "abnormal", kind: "number", value: 1 });
    dawn(); privateProjection();

    // Day 1: the cursed Oracle nominates and dies; the Witch's nomination puts the Clockmaker to the block and he is executed.
    expect(effects("witchCurse")).toEqual(["oracle"]);
    nominate("d1-curse", id("oracle"), id("dreamer"), () => "no");
    ok(state().recordDeath(id("oracle"), undefined, captureCharacterActionContext())); expect(game().players[id("oracle")]!.alive).toBe(false);
    const round = nominate("d1-block", id("witch"), id("clockmaker"));
    expect(round.result).toBe("block");
    ok(vote({ kind: "execution", target: binding(id("clockmaker")), outcome: "died" })); expect(game().players[id("clockmaker")]!.alive).toBe(false);
    const day1 = structuredClone(game()); advance();
    state().undo(); expect(withoutRevealTokens(game())).toEqual(withoutRevealTokens(day1)); advance();

    // Night 2: the Witch curses the Mathematician; the Vortox kills the Dreamer; the Town Crier's YES (the Witch nominated) is shown as NO, the
    // Mathematician counts that one abnormal ability and is shown a false number.
    expect(work().steps.map((step) => step.kind === "player" ? step.effectiveRoleId : step.stepKey)).toEqual(["witch", "vortox", "dreamer", "towncrier", "mathematician"]);
    choose("witch", id("mathematician"));
    choose("vortox", id("dreamer")); expect(game().players[id("dreamer")]!.alive).toBe(false);
    expect(work().steps.map((step) => step.kind === "player" ? step.effectiveRoleId : step.stepKey)).not.toContain("dreamer");
    ok(ability("towncrier")); expect(lastValues()).toContainEqual({ requirementId: "minionNominated", kind: "boolean", value: false });
    expect(effects("abnormal")).toContain("towncrier");
    ok(answered("mathematician", {}, { communicated: number(2) }));
    await reload(); dawn();

    // Day 2: nobody is executed. At dusk the Vortox's fact is recorded and the End control carries its advisory line; nothing ends by itself.
    advance(); expect(game()).toMatchObject({ phase: "night", day: 3 });
    expect(vortoxAdvisory(game())).toBe(VORTOX_NO_EXECUTION_LINE); expect(endHint(ctx())).toBe(VORTOX_NO_EXECUTION_LINE); reached.add("vortoxNoExecution");
    expect(game().result).toBeUndefined();
    expect(endGameEligibility(game(), environment)).not.toMatchObject({ kind: "verified" });

    // The Storyteller plays on instead of ending: the Vortox kills the Mathematician, the Town Crier's NO (nobody nominated) is shown as YES, the
    // Town Crier is executed on Day 3 and two players are alive with the Demon among them: evil wins is proposed and the Storyteller confirms.
    choose("witch", id("towncrier")); choose("vortox", id("mathematician"));
    ok(ability("towncrier")); expect(lastValues()).toContainEqual({ requirementId: "minionNominated", kind: "boolean", value: true });
    await reload(); dawn();
    execute(id("towncrier"), "day-3-ballot");
    expect(alive().map((player) => player.actualRole).sort()).toEqual(["vortox", "witch"]);
    expect(endGameEligibility(game(), environment)).toEqual({ kind: "verified", team: "evil", reason: "twoAlive" }); reached.add("twoAlive");
    await declare("evil");
  });
});


describe("SV-6c game 2 (10 players): Fang Gu, Cerenovus, Pit-Hag, Mutant and six Townsfolk; good wins by executing the Demon", () => {
  it("plays the Snake Charmer's swap, madness, the Seamstress, the Juggler's guesses, a Fang Gu jump into the Mutant and the Demon's execution", async () => {
    setup(G2); begin();
    const oldDemon = seat(0), charmer = seat(4);
    expect(Object.values(game().players).filter((player) => environment.registry.get(player.actualRole)?.type === "outsider")).toHaveLength(1);   // the Fang Gu's +1 Outsider
    expect(order()).toEqual(["minionInfo", "demonInfo", "snakecharmer", "cerenovus", "seamstress"]);
    // Night 1: the Snake Charmer chooses the Demon: they swap characters and alignments, the old Demon is a poisoned, good Snake Charmer.
    choose("snakecharmer", oldDemon);
    expect(game().players[oldDemon]).toMatchObject({ actualRole: "snakecharmer", actualAlignment: "good" });
    expect(game().players[charmer]).toMatchObject({ actualRole: "fanggu", actualAlignment: "evil" });
    expect(game().players[oldDemon]!.effects.some((effect) => effect.type === "poisoned")).toBe(true);
    // The Cerenovus makes the Juggler mad about being the Klutz; the Seamstress learns that a good and an evil player differ.
    ok(ability("cerenovus", { target: target(seat(9)), character: character("klutz") }));
    expect(effects("mad")).toEqual(["juggler"]);
    ok(ability("seamstress", { targets: target(oldDemon, charmer) }, id("seamstress")));
    expect(lastValues()).toContainEqual(expect.objectContaining({ kind: "boolean", value: false }));
    dawn(); privateProjection();

    // Day 1: the Juggler's guesses (two right, one wrong), the Artist's question and the Savant's visit; the Seamstress is executed.
    expect(jugglerGuess(seat(3), "mutant")).toBe(true); expect(jugglerGuess(seat(8), "flowergirl")).toBe(true); expect(jugglerGuess(oldDemon, "fanggu")).toBe(false);
    jugglerDone();
    answerArtist(ctx(), visit(id("artist")), "Yes"); expect(visit(id("artist")).abilityUsed).toBe(true);
    markSavantTold(ctx(), visit(id("savant")));
    privateProjection(); await reload();
    execute(id("seamstress"));
    advance();
    expect(order()).toEqual(["snakecharmer", "cerenovus", "pithag", "fanggu", "flowergirl", "juggler"]);

    // Night 2: the poisoned Snake Charmer chooses the Demon and nothing happens; madness; the Pit-Hag changes the Artist; the Fang Gu kills the
    // Mutant, the first Outsider it kills: the Mutant becomes the evil Fang Gu and the old Fang Gu dies instead (the jump, once per game).
    choose("snakecharmer", charmer, oldDemon);
    expect(game().players[charmer]).toMatchObject({ actualRole: "fanggu", actualAlignment: "evil" });
    expect(game().players[oldDemon]).toMatchObject({ actualRole: "snakecharmer", actualAlignment: "good" });
    ok(ability("cerenovus", { target: target(seat(8)), character: character("sage") })); expect(effects("mad").sort()).toEqual(["flowergirl", "juggler"]);
    ok(ability("pithag", { target: target(id("artist")), character: character("sage") }));
    expect(game().players[seat(6)]).toMatchObject({ actualRole: "sage", actualAlignment: "good" });
    const beforeJump = structuredClone(game()); choose("fanggu", seat(3)); state().undo(); expect(withoutRevealTokens(game())).toEqual(withoutRevealTokens(beforeJump)); choose("fanggu", seat(3));
    expect(game().players[seat(3)]).toMatchObject({ actualRole: "fanggu", actualAlignment: "evil", alive: true });
    expect(game().players[charmer]).toMatchObject({ alive: false });
    expect(game().gameRuleFacts.some((fact) => fact.type === "fangGuOnce")).toBe(true);
    ok(ability("flowergirl")); expect(lastValues()).toContainEqual(expect.objectContaining({ kind: "boolean", value: true }));
    ok(ability("juggler")); expect(lastValues()).toContainEqual(expect.objectContaining({ kind: "number", value: 2 }));
    await reload(); dawn();

    // Day 2: the Storyteller executes the new Fang Gu. The Demon's death by a Day execution is proved, so good wins is proposed (the Storyteller confirms).
    execute(seat(3), "day-2-ballot");
    expect(endGameEligibility(game(), environment)).toMatchObject({ kind: "verified", team: "good" }); reached.add("demonExecuted");
    await declare("good");
  });
});

describe("SV-6c game 3 (9 players): No Dashii, Evil Twin, Sweetheart, Barber, Sage, Philosopher, Dreamer, Town Crier, Oracle; evil wins when the Good Twin is executed", () => {
  it("plays the Philosopher's gain, the Barber's swap beside the No Dashii, the Sweetheart's drunk, impaired information answers and the Good Twin's execution", async () => {
    setup(G3, undefined, () => ok(state().setSetupGoodTwin(binding(seat(5)))));
    begin();
    expect(order()).toEqual(["philosopher", "minionInfo", "demonInfo", "eviltwin", "dreamer"]);
    // The No Dashii poisons its two nearest Townsfolk (the Sage and the Oracle): derived, nothing is stored.
    expect(effects("poisoned")).toEqual([]);
    // Night 1: the Philosopher chooses the Oracle (the real Oracle becomes drunk); the Dreamer, the Good Twin, checks the Town Crier.
    ok(ability("philosopher", { character: character("oracle") }));
    ok(answered("dreamer", { target: target(seat(7)) }, { "dreamer:falseEvil": character("pithag") }));
    expect(lastValues()).toContainEqual({ requirementId: "goodCharacter", kind: "role", roleId: "towncrier" });
    dawn(["eviltwin"]); privateProjection();

    // Day 1: the Barber (an Outsider) is executed; the Town Crier is told nothing yet.
    execute(seat(6));
    advance();
    expect(order()).toEqual(["nodashii", "barber", "dreamer", "towncrier", "oracle", "oracle"]);

    // Night 2: the No Dashii kills the Sweetheart; the dead Barber's swap puts the Town Crier beside the No Dashii and the Sage away from it
    // (the poison follows the seat); the Sweetheart's death makes the Good Twin drunk.
    const beforeKill = structuredClone(game()); choose("nodashii", seat(2)); state().undo(); expect(withoutRevealTokens(game())).toEqual(withoutRevealTokens(beforeKill)); choose("nodashii", seat(2));
    expect(game().players[seat(2)]!.alive).toBe(false);
    ok(ability("barber", { players: target(seat(1), seat(7)) }, seat(6)));
    expect(game().players[seat(1)]).toMatchObject({ actualRole: "towncrier" }); expect(game().players[seat(7)]).toMatchObject({ actualRole: "sage" });
    ok(ability("sweetheart", { player: target(seat(5)) }, seat(2)));
    expect(effects("drunk")).toEqual(["dreamer"]);
    // The drunk Dreamer and the poisoned Town Crier and Oracle are answered by the Storyteller; the Philosopher's gained Oracle runs the real step.
    ok(answered("dreamer", { target: target(seat(0)) }, { "dreamer:good": character("sage"), "dreamer:evil": character("eviltwin") }));
    ok(answered("towncrier", {}, { communicated: { kind: "boolean", value: false } }));
    ok(ability("oracle", {}, seat(4))); expect(lastValues()).toContainEqual({ requirementId: "deadEvil", kind: "number", value: 0 });
    ok(answered("oracle", {}, { communicated: number(1) }, seat(8)));
    await reload(); dawn(["eviltwin"]);

    // Day 2: the Good Twin is executed. "If the good player is executed, evil wins" is the Evil Twin's advisory line; the Storyteller confirms.
    execute(seat(5), "day-2-ballot");
    expect(twinAdvisory(game(), environment)).toMatch(/^The Good Twin was executed\. Evil wins/); reached.add("goodTwinExecuted");
    expect(game().result).toBeUndefined();
    await declare("evil");
  });
});

describe("SV-6c game 4 (11 players): Vigormortis, Witch, Cerenovus and eight Townsfolk (no Outsider: the Vigormortis's -1)", () => {
  it("plays a killed Minion that keeps its ability, poisoned and wrong answers counted by the Mathematician, madness and the Demon's execution", async () => {
    setup(G4); begin();
    expect(Object.values(game().players).filter((player) => environment.registry.get(player.actualRole)?.type === "outsider")).toHaveLength(0);   // the Vigormortis's -1 Outsider
    expect(order()).toEqual(["minionInfo", "demonInfo", "witch", "cerenovus", "clockmaker", "seamstress", "mathematician"]);
    // Night 1: the Witch curses the Flowergirl, the Cerenovus makes the Mathematician mad about being the Artist; the true answers are given.
    choose("witch", seat(9));
    ok(ability("cerenovus", { target: target(seat(3)), character: character("artist") })); expect(effects("mad")).toEqual(["mathematician"]);
    ok(ability("clockmaker")); expect(lastValues()).toContainEqual({ requirementId: "steps", kind: "number", value: 1 });
    ok(ability("seamstress", { targets: target(seat(3), seat(4)) })); expect(lastValues()).toContainEqual(expect.objectContaining({ kind: "boolean", value: true }));
    ok(ability("mathematician")); expect(lastValues()).toContainEqual({ requirementId: "abnormal", kind: "number", value: 0 });
    dawn(); privateProjection();

    // Day 1: the Juggler's guesses, the Artist's question and the Savant's visit; the cursed Flowergirl nominates and dies; the Seamstress is executed.
    expect(jugglerGuess(seat(2), "clockmaker")).toBe(true); expect(jugglerGuess(seat(4), "savant")).toBe(true); expect(jugglerGuess(seat(5), "sage")).toBe(false);
    jugglerDone();
    answerArtist(ctx(), visit(seat(5)), "No"); markSavantTold(ctx(), visit(seat(4)));
    nominate("d1-curse", seat(9), seat(1), () => "no");
    ok(state().recordDeath(seat(9), undefined, captureCharacterActionContext())); expect(game().players[seat(9)]!.alive).toBe(false);
    execute(seat(8)); advance();
    expect(order()).toEqual(["witch", "cerenovus", "vigormortis", "juggler", "mathematician"]);

    // Night 2: the Witch curses the Artist, the Cerenovus the Juggler; the Vigormortis kills the Witch: she keeps her ability and the Juggler,
    // her Townsfolk neighbour, is poisoned and is told a wrong number by the Storyteller, which the Mathematician then counts.
    choose("witch", seat(5));
    ok(ability("cerenovus", { target: target(seat(10)), character: character("clockmaker") }));
    const kill = () => ability("vigormortis", { target: target(seat(0)), [subjectId(POISONED_NEIGHBOUR, binding(seat(0)))]: target(seat(10)) });
    const beforeKill = structuredClone(game()); ok(kill()); state().undo(); expect(withoutRevealTokens(game())).toEqual(withoutRevealTokens(beforeKill)); ok(kill());
    expect(game().players[seat(0)]!.alive).toBe(false); expect(effects("retainsAbility")).toEqual(["witch"]); expect(effects("poisoned")).toEqual(["juggler"]);
    ok(answered("juggler", {}, { communicated: number(0) }));
    ok(ability("mathematician")); expect(lastValues()).toContainEqual({ requirementId: "abnormal", kind: "number", value: 1 });
    await reload(); dawn();

    // Day 2: the Cerenovus is executed. Night 3: the dead Witch still wakes (she keeps her ability) and the Vigormortis kills again.
    execute(seat(6)); advance();
    expect(order()).toEqual(["witch", "cerenovus", "vigormortis", "mathematician"]);
    choose("witch", seat(1), seat(0)); expect(effects("witchCurse")).toEqual(["sage"]);
    choose("vigormortis", seat(1)); expect(game().players[seat(1)]!.alive).toBe(false);
    ok(ability("sage", { players: target(seat(7), seat(2)) }, seat(1)));
    ok(ability("mathematician")); expect(lastValues()).toContainEqual({ requirementId: "abnormal", kind: "number", value: 0 });
    await reload(); dawn(["cerenovus"]);

    // Day 3: the Demon is executed: the Day death of the Vigormortis is proved, so good wins is proposed and the Storyteller confirms.
    execute(seat(7), "day-3-ballot");
    expect(endGameEligibility(game(), environment)).toMatchObject({ kind: "verified", team: "good" }); reached.add("demonExecuted");
    await declare("good");
  });
});

describe("SV-6c game 5 (8 players): No Dashii, Evil Twin, Klutz and five Townsfolk; the Klutz's choice, then a replay where the Klutz chooses well", () => {
  it("plays the poisoned Snake Charmer and Philosopher, a Klutz who chooses the Demon, and the replay in which the Klutz chooses well", async () => {
    setup(G5, undefined, () => ok(state().setSetupGoodTwin(binding(seat(2)))));
    begin();
    expect(order()).toEqual(["philosopher", "minionInfo", "demonInfo", "snakecharmer", "eviltwin", "dreamer"]);
    // The No Dashii poisons the Snake Charmer and the Philosopher (its two nearest Townsfolk): their choices do nothing.
    ok(ability("philosopher", { character: character("oracle") }));
    expect(effects("gainedAbility")).toEqual([]);
    choose("snakecharmer", seat(0));
    expect(game().players[seat(0)]).toMatchObject({ actualRole: "nodashii", actualAlignment: "evil" });
    ok(answered("dreamer", { target: target(seat(0)) }, { "dreamer:falseGood": character("sage") }));
    expect(lastValues()).toContainEqual({ requirementId: "evilCharacter", kind: "role", roleId: "nodashii" });
    dawn(["eviltwin"]); privateProjection();

    // Day 1: nobody is executed. Night 2: the No Dashii kills the Klutz, who learns that they died.
    advance();
    expect(order()).toEqual(["snakecharmer", "nodashii", "dreamer", "towncrier", "oracle"]);
    choose("snakecharmer", seat(0));
    choose("nodashii", seat(3)); expect(game().players[seat(3)]!.alive).toBe(false);
    ok(answered("dreamer", { target: target(seat(6)) }, { "dreamer:falseEvil": character("pithag") }));
    ok(ability("towncrier")); expect(lastValues()).toContainEqual({ requirementId: "minionNominated", kind: "boolean", value: false });
    ok(ability("oracle")); expect(lastValues()).toContainEqual({ requirementId: "deadEvil", kind: "number", value: 0 });
    await reload(); dawn(); expect(game().phase).toBe("day");

    // Day 2, the first replay branch: the Klutz chooses the No Dashii, an evil player: the Klutz's team (good) loses. The line says so and the
    // Storyteller confirms; nothing ends by itself.
    const day2 = structuredClone(game());
    const klutz = (chosen: string) => ability("klutz", { target: target(chosen) }, seat(3), { context: { provenance: { sourcePlayer: seat(3), sourceCharacter: "klutz" } } });
    ok(klutz(seat(0)));
    expect(game().gameRuleFacts.map((fact) => fact.type)).toContain(KLUTZ_GOOD_TEAM_LOST);
    reached.add("klutzChoseEvil");
    expect(klutzAdvisory(game())).toBe("The Klutz chose an evil player. Evil wins. Check before ending the game"); expect(endHint(ctx())).toContain("The Klutz chose an evil player. Evil wins");
    expect(game().result).toBeUndefined();
    await declare("evil");

    // The second branch: the ending is undone, then the Klutz's choice is undone, and the Klutz chooses the Oracle, a good player: nothing happens.
    ok(state().undoFinishedGame()); state().undo(); expect(withoutRevealTokens(game())).toEqual(withoutRevealTokens(day2));
    ok(klutz(seat(5)));
    expect(klutzAdvisory(game())).toBeNull(); expect(game().gameRuleFacts.map((fact) => fact.type)).not.toContain(KLUTZ_GOOD_TEAM_LOST);
    expect(game().players[seat(3)]!.abilityUsed).toBe(true);

    // The game goes on: the Evil Twin is executed (the pair ends), the No Dashii kills the Town Crier, the Oracle counts the dead Evil Twin, and the
    // No Dashii's execution is proved: good wins is proposed with both Twins no longer blocking it.
    execute(seat(4)); advance();
    choose("snakecharmer", seat(0));
    choose("nodashii", seat(6)); expect(game().players[seat(6)]!.alive).toBe(false);
    ok(answered("dreamer", { target: target(seat(1)) }, { "dreamer:falseEvil": character("pithag") }));
    ok(ability("oracle")); expect(lastValues()).toContainEqual({ requirementId: "deadEvil", kind: "number", value: 1 });
    await reload(); dawn();
    execute(seat(0), "day-3-ballot");
    expect(endGameEligibility(game(), environment)).toMatchObject({ kind: "verified", team: "good" }); reached.add("demonExecuted");
    await declare("good");
  });
});

describe("SV-6c coverage of the five games", () => {
  it("seats all 25 characters and all four Demons, and reaches every ending the script has", () => {
    const seated = new Set([...G1, ...G2, ...G3, ...G4, ...G5]);
    expect([...seated].sort()).toEqual([...sectsAndViolets.characters.map((role) => role.id)].sort());
    for (const demon of ["vortox", "fanggu", "vigormortis", "nodashii"]) expect(seated.has(demon), demon).toBe(true);
    expect([...reached].sort()).toEqual(["demonExecuted", "goodTwinExecuted", "klutzChoseEvil", "twoAlive", "vortoxNoExecution"]);
  });
});

