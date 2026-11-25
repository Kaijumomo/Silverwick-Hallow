// BM-1d: a whole Bad Moon Rising game at store level with the Sailor, the Exorcist and the Pacifist (docs/ai/BAD_MOON_RISING_BM1_PAIRS.md). Like
// sectsAndVioletsWholeGames.test.ts, the game is created, seated, dealt, revealed and advanced with production commands; no role, death, effect, phase
// or outcome is seeded with setState. It checks the persisted schema, the projections, Undo and a reload around what the three characters store.
import { beforeEach, describe, expect, it } from "vitest";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { StorytellerGamePersistedSchema } from "./schemas";
import { executionChoiceFor, executionSurvivalKnown } from "./executionAdvice";
import { ability, advance, answered, begin, binding, dawn, effects, environment, execute, game, id, nominate, ok, order, registry, reload, resetStores, setup, state, target, vote, withoutRevealTokens } from "@/test/bmWholeGame";

beforeEach(resetStores);

const exposed = () => JSON.stringify([projectLobbyToPublic(game(), {}), projectLobbyToSelfMap(game(), registry)]);
/** What the projections must never carry: the Storyteller-only Effects and facts of the three characters, and the store's own record names. */
const STORYTELLER_ONLY = /exorcistChosen|exorcised|"drunk"|"poisoned"|sourceParticipant|gameRuleFacts|informationDeliveries|lifeEventWindow|preparedInformation/i;

/** Seat i holds the i-th character: Shabaloth, Godfather, Sailor, Exorcist, Pacifist, Tea Lady, Fool. */
const TABLE = ["shabaloth", "godfather", "sailor", "exorcist", "pacifist", "tealady", "fool"];
const sailorTells = (chosen: string, drunk: boolean) => answered("sailor", { target: target(chosen) }, { "sailor:chosenDrunk": { kind: "boolean", value: drunk } });

describe("BM-1d whole game: a Sailor, an Exorcist and a Pacifist at a table of seven", () => {
  it("plays two nights and two days with the three of them, and Undo, reload and the projections agree at every step", async () => {
    setup(TABLE); begin();
    expect(order()).toContain("sailor"); expect(order()).not.toContain("exorcist");   // the Exorcist has no first night
    // Night 1: the Sailor chooses the Fool and the Storyteller rules the Fool drunk (one compact card, one Undo).
    const before = structuredClone(game());
    ok(sailorTells(id("fool"), true));
    expect(effects("drunk")).toEqual(["fool"]);
    expect(exposed()).not.toMatch(STORYTELLER_ONLY);
    state().undo(); expect(withoutRevealTokens(game())).toEqual(withoutRevealTokens(before));
    ok(sailorTells(id("fool"), true)); await reload();
    dawn(["godfather"]);

    // Day 1: the Fool (still drunk until dusk) is executed. A sober Pacifist lives, so the Storyteller is asked and says the Fool survives.
    expect(executionChoiceFor(game(), id("fool"), environment)).toEqual(["Pacifist"]);
    const round = nominate("d1", id("godfather"), id("fool"));
    expect(round.result).toBe("block");
    ok(vote({ kind: "execution", target: binding(id("fool")), outcome: "survived" }));
    expect(game().players[id("fool")]!.alive).toBe(true);
    const day1 = structuredClone(game());
    advance();
    expect(effects("drunk")).toEqual([]);                                   // the Sailor's drunkenness ended at dusk
    state().undo(); expect(withoutRevealTokens(game())).toEqual(withoutRevealTokens(day1)); advance();
    await reload();

    // Night 2: the Exorcist is woken now. The Sailor makes themself drunk; the Exorcist chooses the Shabaloth and tells it.
    expect(order()).toContain("exorcist");
    ok(ability("sailor", { target: target(id("sailor")) }));
    expect(effects("drunk")).toEqual(["sailor"]);
    const night2 = structuredClone(game());
    ok(ability("exorcist", { target: target(id("shabaloth")) }));
    expect(effects("exorcistChosen")).toEqual(["shabaloth"]);
    expect(exposed()).not.toMatch(STORYTELLER_ONLY);
    // The Shabaloth's ordinary wake does not happen, with the reason; nothing else about it changed.
    const refused = ability("shabaloth", { targets: target(id("tealady"), id("fool")) });
    expect(refused).toMatchObject({ ok: false, code: "notApplicable", message: "The Exorcist chose the Demon tonight. The Demon does not use their ability tonight." });
    expect(game().players[id("tealady")]!.alive).toBe(true);
    state().undo(); expect(withoutRevealTokens(game())).toEqual(withoutRevealTokens(night2));      // one Undo takes the pick back
    ok(ability("exorcist", { target: target(id("shabaloth")) }));
    await reload(); expect(effects("exorcistChosen")).toEqual(["shabaloth"]);
    dawn(["shabaloth", "godfather"]);

    // Day 2: nobody died in the night. The drunk Sailor has no protection, so executing them asks the Pacifist question like any good player.
    expect(game().players[id("sailor")]!.alive).toBe(true);
    expect(executionChoiceFor(game(), id("sailor"), environment)).toEqual(["Pacifist"]);
    advance();
    // Night 3: last night's pick is refused; a different player is accepted; the old CHOSEN has moved.
    const again = ability("exorcist", { target: target(id("shabaloth")) });
    expect(again).toMatchObject({ ok: false, code: "illegal" });
    ok(ability("exorcist", { target: target(id("fool")) }));
    expect(effects("exorcistChosen")).toEqual(["fool"]);
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
    await reload(); expect(effects("exorcistChosen")).toEqual(["fool"]);
  });

  it("page example: the Sailor the Storyteller made drunk dies when executed", async () => {
    setup(TABLE); begin();
    ok(sailorTells(id("fool"), false));                    // the Sailor is the drunk one
    expect(effects("drunk")).toEqual(["sailor"]);
    dawn(["godfather"]);
    expect(executionSurvivalKnown(game(), id("sailor"), environment)).toBe(false);
    execute(id("sailor"));
    expect(game().players[id("sailor")]!.alive).toBe(false);
    await reload(); expect(game().players[id("sailor")]!.alive).toBe(false);
  });

  it("page example: a sober Sailor survives the Shabaloth, then an execution that still counts, with nothing in the projections", async () => {
    setup(TABLE); begin();
    ok(sailorTells(id("fool"), true));
    dawn(["godfather"]);
    advance();                                              // Day 1: nobody is executed; dusk ends the Fool's drunkenness
    expect(effects("drunk")).toEqual([]);
    // Night 2: the Sailor chooses the Fool again (the Fool drunk); the Shabaloth attacks the Sailor and the Exorcist: only the Exorcist dies (the Pacifist and the Fool are the Tea Lady's neighbours).
    ok(sailorTells(id("fool"), true));
    ok(ability("shabaloth", { targets: target(id("sailor"), id("exorcist")) }));
    expect(game().players[id("sailor")]!.alive).toBe(true);
    expect(game().players[id("exorcist")]!.alive).toBe(false);
    await reload();
    dawn(["godfather"]);
    // Day 2: the sober Sailor is executed: the rules say they survive, the execution counts and nobody dies.
    expect(executionSurvivalKnown(game(), id("sailor"), environment)).toBe(true);
    const round = nominate("d2", id("godfather"), id("sailor"));
    expect(round.result).toBe("block");
    ok(vote({ kind: "execution", target: binding(id("sailor")), outcome: "survived" }));
    expect(game().players[id("sailor")]!.alive).toBe(true);
    expect(exposed()).not.toMatch(STORYTELLER_ONLY);
    await reload();
  });
});
