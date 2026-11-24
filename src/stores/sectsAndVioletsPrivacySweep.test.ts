// SV-6e: the privacy, Undo and save/load sweep over everything Sects & Violets stores or shows to the Storyteller only. Each case is built with
// production commands in a real game (src/test/svWholeGame.ts) and then checked four ways:
//   1. leaves no trace in the public and the self projections (what phones and the display receive);
//   2. is hidden in Privacy Mode where the design says so (the Day rows, the End control's lines);
//   3. is undone exactly by one Undo (reveal tokens aside: by design Undo never restores an older one), and redone;
//   4. survives a save and a reload (and a refresh: the same rehydrate path) with the persisted schema still valid.
import { beforeEach, describe, expect, it } from "vitest";
import { artistMayAsk, answerArtist, markSavantTold, savantMayVisit, savantToldToday } from "@/features/grimoire-v6/day/privateVisit";
import { jugglerMayGuess } from "@/features/grimoire-v6/day/juggler";
import { klutzAwaitingChoice } from "@/features/grimoire-v6/day/klutz";
import { endHint } from "@/features/grimoire-v6/vm/chrome";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { StorytellerGamePersistedSchema } from "./schemas";
import { currentVoter } from "./voting";
import { KLUTZ_GOOD_TEAM_LOST, VORTOX_WORKING_AT_DUSK } from "./gameRuleFactRegistry";
import { vortoxAdvisory, VORTOX_NO_EXECUTION_LINE } from "./endGameEligibility";
import { ability, advance, answered, begin, binding, character, choose, ctx, dawn, effects, environment, execute, game, id, jugglerDone, jugglerGuess, number, ok, order, registry,
  reload, resetStores, seat, setup, state, target, visit, vote, withoutRevealTokens } from "@/test/svWholeGame";

beforeEach(resetStores);

const exposed = () => JSON.stringify([projectLobbyToPublic(game(), {}), projectLobbyToSelfMap(game(), registry)]);
/** What the projections must never carry (type names of Storyteller-only Effects and facts, and the store's own record names). */
const STORYTELLER_ONLY = /"abnormal"|"mad"|"twin"|jugglerGuess|jugglerCorrect|jugglerDone|witchCurse|retainsAbility|gameRuleFacts|informationDeliveries|lifeEventWindow|preparedInformation|sourceParticipant/i;

/** What a game shows without its generated ids: each seat's character, life, ability use and Effect types, and the rule facts' types. */
const summary = (g: ReturnType<typeof game>) => JSON.stringify([Object.values(g.players).map((p) => [p.seat, p.actualRole, p.alive, p.abilityUsed, p.effects.map((e) => e.type)]),
  g.gameRuleFacts.map((f) => f.type), g.informationDeliveries.length, g.phase, g.day]);

/** Runs `last` (the last command that stores the fact), then checks the four lines above around it. */
async function sweep(last: () => void, hidden: RegExp[] = []) {
  const before = structuredClone(game());
  last();
  const after = structuredClone(game());
  expect(exposed()).not.toMatch(STORYTELLER_ONLY);
  for (const pattern of hidden) expect(exposed()).not.toMatch(pattern);
  state().undo(); expect(withoutRevealTokens(game())).toEqual(withoutRevealTokens(before));
  last(); expect(summary(game())).toEqual(summary(after));      // redone: the same facts (ids and times are new)
  await reload(); expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
  expect(exposed()).not.toMatch(STORYTELLER_ONLY);
}

const G1 = ["vortox", "witch", "clockmaker", "dreamer", "mathematician", "oracle", "towncrier"];
const G2 = ["fanggu", "cerenovus", "pithag", "mutant", "snakecharmer", "seamstress", "artist", "savant", "flowergirl", "juggler"];
const G5 = ["nodashii", "snakecharmer", "dreamer", "klutz", "eviltwin", "oracle", "towncrier", "philosopher"];

describe("SV-6e privacy, Undo and save/load of what Sects & Violets keeps for the Storyteller", () => {
  it("the Mathematician's ABNORMAL marks (false information under a Vortox)", async () => {
    setup(G1); begin();
    choose("witch", id("oracle"));
    await sweep(() => { ok(ability("clockmaker", { communicated: number(2) })); });
    expect(effects("abnormal")).toEqual(["clockmaker"]);
    await sweep(() => { ok(answered("dreamer", { target: target(id("oracle")) }, { "dreamer:good": character("sage"), "dreamer:evil": character("pithag") })); }, [/abnormal/i]);
    expect(effects("abnormal").sort()).toEqual(["clockmaker", "dreamer"]);
  });

  it("the Juggler's guesses and CORRECT marks, and the Artist's and Savant's Day rows (Privacy Mode hides the rows)", async () => {
    setup(G2); begin();
    choose("snakecharmer", seat(0)); ok(ability("cerenovus", { target: target(seat(9)), character: character("klutz") })); ok(ability("seamstress", { targets: target(seat(0), seat(4)) }));
    dawn();
    // The Day rows are offered, then hidden in Privacy Mode (read live, as the board reads them).
    expect(jugglerMayGuess({ privacy: false, ended: false }, game(), visit(id("juggler")))).toBe(true);
    expect(jugglerMayGuess({ privacy: true, ended: false }, game(), visit(id("juggler")))).toBe(false);
    expect(artistMayAsk(ctx(false), visit(id("artist")))).toBe(true); expect(artistMayAsk(ctx(true), visit(id("artist")))).toBe(false);
    expect(savantMayVisit(ctx(false), visit(id("savant")))).toBe(true); expect(savantMayVisit(ctx(true), visit(id("savant")))).toBe(false);
    await sweep(() => { jugglerGuess(seat(3), "mutant"); });
    await sweep(() => { jugglerDone(); });
    await sweep(() => { answerArtist(ctx(), visit(id("artist")), "Yes"); expect(visit(id("artist")).abilityUsed).toBe(true); });
    expect(artistMayAsk(ctx(false), visit(id("artist")))).toBe(false);
    await sweep(() => { markSavantTold(ctx(), visit(id("savant"))); expect(savantToldToday(game(), visit(id("savant")))).toBe(true); });
    // Night: the guesses are counted; the Juggler's CORRECT mark names no player to the projections.
    execute(seat(5)); advance();
    await sweep(() => { ok(ability("juggler")); });
    expect(game().informationDeliveries.at(-1)!.values).toContainEqual({ requirementId: "correct", kind: "number", value: 1 });
  });

  it("the Cerenovus's MAD", async () => {
    setup(G2); begin();
    choose("snakecharmer", seat(0));
    await sweep(() => { ok(ability("cerenovus", { target: target(seat(9)), character: character("klutz") })); }, [/klutz/i]);
    expect(effects("mad")).toEqual(["juggler"]);
  });

  it("the Evil Twin's TWIN reminder (chosen while setting up) and the Good Twin's execution line", async () => {
    setup(G5, undefined, () => ok(state().setSetupGoodTwin(binding(seat(2)))));
    expect(effects("twin")).toEqual(["dreamer"]);
    expect(exposed()).not.toMatch(STORYTELLER_ONLY);
    await reload(); expect(effects("twin")).toEqual(["dreamer"]);
    begin(); ok(ability("philosopher", { character: character("oracle") })); choose("snakecharmer", seat(0)); ok(answered("dreamer", { target: target(seat(0)) }, { "dreamer:falseGood": character("sage") }));
    dawn(["eviltwin"]);
    ok(vote({ kind: "begin", roundId: "twin", mode: "nomination", nominator: binding(seat(0)), nominee: binding(seat(2)) }));
    for (let attempts = 0; currentVoter(game()) && attempts < 40; attempts++) ok(vote({ kind: "respond", roundId: "twin", voter: currentVoter(game())!, choice: "yes" }));
    ok(vote({ kind: "acknowledge", roundId: "twin" }));
    await sweep(() => ok(vote({ kind: "execution", target: binding(seat(2)), outcome: "died" })));
    expect(endHint(ctx(false))).toMatch(/^The Good Twin was executed\. Evil wins/);
    expect(endHint(ctx(true))).toBe("");      // Privacy Mode hides every line that names a character and who wins
  });

  it("the Klutz's choice and its ending line", async () => {
    setup(G5, undefined, () => ok(state().setSetupGoodTwin(binding(seat(2)))));
    begin(); ok(ability("philosopher", { character: character("oracle") })); choose("snakecharmer", seat(0)); ok(answered("dreamer", { target: target(seat(0)) }, { "dreamer:falseGood": character("sage") }));
    dawn(["eviltwin"]); advance();
    choose("snakecharmer", seat(0)); choose("nodashii", seat(3)); ok(answered("dreamer", { target: target(seat(6)) }, { "dreamer:falseEvil": character("pithag") }));
    ok(ability("towncrier")); ok(ability("oracle"));
    dawn();
    expect(klutzAwaitingChoice(ctx(false), visit(seat(3)))).toBe(true); expect(klutzAwaitingChoice(ctx(true), visit(seat(3)))).toBe(false);
    await sweep(() => { ok(ability("klutz", { target: target(seat(0)) }, seat(3), { context: { provenance: { sourcePlayer: seat(3), sourceCharacter: "klutz" } } })); });
    expect(game().gameRuleFacts.map((fact) => fact.type)).toContain(KLUTZ_GOOD_TEAM_LOST);
    expect(endHint(ctx(false))).toBe("The Klutz chose an evil player. Evil wins. Check before ending the game");
    expect(endHint(ctx(true))).toBe("");
  });

  it("the Vortox's dusk fact and its no-execution line (and the false-information rule, which is derived and stores nothing)", async () => {
    setup(G1); begin();
    choose("witch", id("oracle")); ok(ability("clockmaker", { communicated: number(2) }));
    ok(answered("dreamer", { target: target(id("oracle")) }, { "dreamer:good": character("sage"), "dreamer:evil": character("pithag") })); ok(answered("mathematician", {}, { communicated: number(1) }));
    dawn(); advance();
    // Night 2 passes with the Vortox working; Day 2 passes with no execution: the capture happens at the Day-to-Night boundary.
    choose("witch", id("mathematician")); choose("vortox", id("dreamer")); ok(ability("towncrier")); ok(answered("oracle", {}, { communicated: number(1) })); ok(answered("mathematician", {}, { communicated: number(3) }));
    dawn();
    await sweep(() => { advance(); });
    expect(game().gameRuleFacts.map((fact) => fact.type)).toContain(VORTOX_WORKING_AT_DUSK);
    expect(vortoxAdvisory(game())).toBe(VORTOX_NO_EXECUTION_LINE);
    expect(endHint(ctx(false))).toBe(VORTOX_NO_EXECUTION_LINE);
    expect(endHint(ctx(true))).toBe("");
    expect(order()).toContain("witch");       // the rule itself is read live: the Night order is unchanged by it
    expect(JSON.stringify(game().players)).not.toMatch(/falseInformation|vortoxRule/i);
  });

  it("everything above keeps the persisted schema valid and no Storyteller-only record in the projections at the end of a game", async () => {
    setup(G5, undefined, () => ok(state().setSetupGoodTwin(binding(seat(2)))));
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
    expect(exposed()).not.toMatch(STORYTELLER_ONLY);
    expect(environment.registry.get("klutz")?.name).toBe("Klutz");
  });
});
