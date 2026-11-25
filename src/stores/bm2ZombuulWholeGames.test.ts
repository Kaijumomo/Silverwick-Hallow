// BM-2e: whole Bad Moon Rising games at store level with the Zombuul (planning/BM2_BUILD_PROPOSAL.md). Like bm1WholeGames.test.ts, the game
// is created, seated, dealt, revealed and advanced with production commands; no role, death, phase or outcome is seeded with setState. It
// checks Undo, reload, the persisted schema and the projections around the Zombuul's hidden life.
import { beforeEach, describe, expect, it } from "vitest";
import { StorytellerGamePersistedSchema } from "./schemas";
import { executionAdvice } from "./executionAdvice";
import { demonGoneAdvisory, endGameEligibility } from "./endGameEligibility";
import { HIDDEN_LIFE, isTrulyAlive } from "./lifeState";
import { projectLobbyToPublic, projectLobbyToSelfEnvelopeMap } from "./projections";
import { ability, advance, begin, binding, dawn, environment, execute, game, id, nominate, ok, privateProjection, registry, reload, resetStores, setup, state, target, vote, withoutRevealTokens } from "@/test/bmWholeGame";

beforeEach(resetStores);

/** Seat i holds the i-th character: Zombuul, Godfather, Tea Lady, Fool, Pacifist, Moonchild, Chambermaid. */
const TABLE = ["zombuul", "godfather", "tealady", "fool", "pacifist", "moonchild", "chambermaid"];
const zombuul = () => game().players[id("zombuul")]!;
const hidden = () => zombuul().effects.some((effect) => effect.type === HIDDEN_LIFE && effect.state === "active");
const NO_HIDDEN_LIFE = /livesOn/;

describe("BM-2e whole game: the Zombuul registers dead, lives on, attacks, and dies for real", () => {
  it("first execution, a Not Waking night, a quiet Day, an attack while he registers dead, then his real death", async () => {
    setup(TABLE); begin();
    expect(ability("zombuul", { target: target(id("fool")) })).toMatchObject({ ok: false });       // no first-night wake
    dawn(["godfather", "chambermaid"]);

    // Day 1: the sober Zombuul is executed. The table sees a death; he secretly lives on. The game goes on (a living Demon).
    const z = id("zombuul");
    expect(nominate("d1", id("godfather"), z).result).toBe("block");
    const day1 = structuredClone(game());
    const died = () => ok(vote({ kind: "execution", target: binding(z), outcome: "died" }));
    died();
    expect(zombuul()).toMatchObject({ alive: false, ghostVote: true });
    expect(hidden()).toBe(true);
    expect(isTrulyAlive(zombuul())).toBe(true);
    expect(endGameEligibility(game(), environment)).not.toMatchObject({ kind: "verified" });
    expect(demonGoneAdvisory(game(), environment)).toBeNull();
    privateProjection([NO_HIDDEN_LIFE]);
    expect(projectLobbyToPublic(game(), {}).players[z]).toMatchObject({ alive: false });
    expect(projectLobbyToSelfEnvelopeMap(game(), registry)[z]?.life).toMatchObject({ alive: false });
    state().undo(); expect(withoutRevealTokens(game())).toEqual(withoutRevealTokens(day1));    // one Undo takes back the death and the hidden life
    died();
    await reload(); expect(hidden()).toBe(true);

    // Night 2: someone (he) died during the Day, so he does not wake. The night list still holds his step (he is truly alive).
    advance();
    expect(ability("zombuul", { target: target(id("chambermaid")) })).toMatchObject({ ok: false, code: "notApplicable", message: "Someone died during the Day: the Zombuul does not wake tonight." });
    dawn(["godfather", "chambermaid", "zombuul", "moonchild"]);

    // Day 2: nobody dies. Night 3: he wakes although he registers as dead, and kills the Chambermaid (with his DEAD token).
    advance();
    ok(ability("zombuul", { target: target(id("chambermaid")) }));
    const maid = Object.values(game().players).find((player) => player.actualRole === "chambermaid")!;
    expect(maid.alive).toBe(false);
    expect(maid.reminders).toEqual([expect.objectContaining({ label: "Dead", sourceCharacter: "zombuul" })]);
    await reload();
    dawn(["godfather", "chambermaid", "moonchild"]);

    // Day 3: executed again: "Did X die?" is asked as for any living player, and Died is his real death. Nothing the table sees changes.
    expect(game().phase).toBe("day");
    expect(nominate("d3", id("godfather"), z).result).toBe("block");   // he voted with his ghost vote, as any dead player may
    const before = structuredClone(zombuul());
    died();
    expect(zombuul()).toMatchObject({ alive: false, ghostVote: before.ghostVote });
    expect(hidden()).toBe(false);
    expect(isTrulyAlive(zombuul())).toBe(false);
    expect(demonGoneAdvisory(game(), environment)).not.toBeNull();
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
    await reload(); expect(isTrulyAlive(zombuul())).toBe(false);
  });

  it("a drunk or poisoned Zombuul executed really dies (no hidden life): the Demon is dead", () => {
    setup(TABLE); begin(); dawn(["godfather", "chambermaid"]);
    ok(state().setManualEffect(binding(id("zombuul")), "poisoned", true));
    execute(id("zombuul"));
    expect(hidden()).toBe(false);
    expect(demonGoneAdvisory(game(), environment)).not.toBeNull();
  });

  it("a survived execution is not a death: the Fool survives his first execution and the Zombuul wakes that night", () => {
    setup(TABLE); begin(); dawn(["godfather", "chambermaid"]);
    const fool = id("fool");
    expect(executionAdvice(game(), fool, environment)).not.toBeNull();
    expect(nominate("d1", id("godfather"), fool).result).toBe("block");
    ok(vote({ kind: "execution", target: binding(fool), outcome: "survived" }));
    advance();
    ok(ability("zombuul", { target: target(id("chambermaid")) }));
    expect(game().players[id("chambermaid")]?.alive ?? false).toBe(false);
  });

  it("the Died switch on a seat that lives on is his real death; Undo restores the hidden life", () => {
    setup(TABLE); begin(); dawn(["godfather", "chambermaid"]);
    execute(id("zombuul"));
    const lives = structuredClone(game());
    ok(state().recordDeath(id("zombuul")));
    expect(isTrulyAlive(zombuul())).toBe(false);
    state().undo(); expect(withoutRevealTokens(game())).toEqual(withoutRevealTokens(lives));
  });
});
