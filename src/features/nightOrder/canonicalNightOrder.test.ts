import { describe, expect, it } from "vitest";
import { computeNightOrder, type NightStep } from "./nightOrder";
import { canonicalRoles, NIGHT_SHEET, roleAuthority } from "@/data/canonical";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { sectsAndViolets } from "@/data/scripts/sectsAndViolets";
import { badMoonRising } from "@/data/scripts/badMoonRising";
import { makeSTPlayer } from "@/test/fixtures";
import type { Script, STPlayerRecord } from "@/stores/types";
import { evilInformationPolicy, type NightContext } from "./nightRules";
import { buildRegistry } from "@/data/roleRegistry";
import { projectToSelf } from "@/stores/projections";

const all = { id: "test", name: "Test", characters: [
  ...troubleBrewing.characters, ...sectsAndViolets.characters, ...badMoonRising.characters,
  ...canonicalRoles(["poppygrower", "marionette", "magician", "legion", "king", "snitch", "atheist", "lilmonsta"]),
] };
function game(roles: string[], changes: Record<string, Partial<STPlayerRecord>> = {}) {
  const players = Object.fromEntries(roles.map((id, seat) => [id, makeSTPlayer({
    id, name: id, seat, actualRole: id, shownRole: id, ...changes[id],
  })]));
  return { players, seatOrder: Object.keys(players) };
}
function procedure(script: Script, first: boolean) {
  // Complete-script inventory, not a legal bag. Lunatic explicitly believes Po.
  const g = game(script.characters.map(r => r.id), { lunatic: { shownRole: "po", behaviorMode: "fake_demon_behavior" } });
  return computeNightOrder(g.players, g.seatOrder, script, first).map(step =>
    step.kind === "player" ? (step.isDeceived ? "simulated:" : "") + step.effectiveRoleId : step.stepKey);
}
const seven = ["imp", "poisoner", "chef", "empath", "soldier", "saint", "butler"];
const generate = (roles = seven, first = true, changes: Record<string, Partial<STPlayerRecord>> = {}, context: NightContext = {}) => {
  const g = game(roles, changes);
  return computeNightOrder(g.players, g.seatOrder, all, first, context);
};
const globals = (steps: NightStep[]) => steps.filter(s => s.kind === "global");
const wakes = (steps: NightStep[]) => steps.filter(s => s.kind === "player");

describe("publisher night-sheet golden procedures (pinned September 2026)", () => {
  it("TB first night", () => expect(procedure(troubleBrewing, true)).toEqual([
    "minionInfo", "demonInfo", "poisoner", "washerwoman", "librarian", "investigator", "chef", "empath", "fortuneteller", "butler", "spy",
  ]));
  it("TB other night", () => expect(procedure(troubleBrewing, false)).toEqual([
    "poisoner", "monk", "scarletwoman", "imp", "ravenkeeper", "empath", "fortuneteller", "undertaker", "butler", "spy",
  ]));
  it("S&V first night", () => expect(procedure(sectsAndViolets, true)).toEqual([
    "philosopher", "minionInfo", "demonInfo", "snakecharmer", "eviltwin", "witch", "cerenovus", "clockmaker", "dreamer", "seamstress", "mathematician",
  ]));
  it("S&V other night", () => expect(procedure(sectsAndViolets, false)).toEqual([
    "philosopher", "snakecharmer", "witch", "cerenovus", "pithag", "fanggu", "nodashii", "vortox", "vigormortis", "barber", "sweetheart", "sage", "dreamer", "flowergirl", "towncrier", "oracle", "seamstress", "juggler", "mathematician",
  ]));
  it("BMR first night", () => expect(procedure(badMoonRising, true)).toEqual([
    "minionInfo", "lunaticInfo:lunatic", "demonInfo", "sailor", "courtier", "godfather", "devilsadvocate", "pukka", "grandmother", "chambermaid",
  ]));
  it("BMR other night: protection, choices, simulated Demon, real deaths, resurrection, information", () => expect(procedure(badMoonRising, false)).toEqual([
    "sailor", "courtier", "innkeeper", "gambler", "devilsadvocate", "simulated:po", "lunaticTargets:lunatic", "exorcist", "zombuul", "pukka", "shabaloth", "po", "assassin", "godfather", "gossip", "professor", "tinker", "moonchild", "grandmother", "chambermaid",
  ]));
});

describe("setup-aware information, never an automatic publication", () => {
  it.each([5, 6])("%i players do not get normal team introductions or bluffs", count => {
    const steps = generate(seven.slice(0, count));
    expect(steps.some(s => ["minionInfo", "demonInfo"].includes(s.stepKey))).toBe(false);
    expect(globals(steps)).toContainEqual(expect.objectContaining({ stepKey: "smallGameInfo" }));
  });
  it("7 players get Minion then Demon info with distinct real recipients", () => {
    expect(globals(generate())).toEqual([
      expect.objectContaining({ stepKey: "minionInfo", recipientIds: ["poisoner"] }),
      expect.objectContaining({ stepKey: "demonInfo", recipientIds: ["imp"], setupRecipientIds: ["imp"] }),
    ]);
  });
  it("empty seats and Travelers do not turn a small game into 7 players", () => {
    expect(generate(seven, true, { saint: { isEmpty: true }, butler: { isTraveler: true } })
      .some(s => s.stepKey === "demonInfo")).toBe(false);
  });
  it("Toymaker restores both introductions for five players", () => {
    expect(generate(seven.slice(0, 5), true, {}, { fabled: ["toymaker"] }).map(s => s.stepKey))
      .toEqual(expect.arrayContaining(["modifier:toymaker", "minionInfo", "demonInfo"]));
  });
  it("Toymaker does not invent attack-skip history or authorize a final attack", () => {
    const demon = wakes(generate(seven.slice(0, 5), false, {}, { fabled: ["toymaker"] })).find(s => s.playerId === "imp")!;
    expect(demon.advisory).toContain("Do not wake/allow a game-ending attack");
  });
  it.each([{}, { statuses: { poisoned: true } }, { alive: false }])("Poppy Grower suppresses team disclosure, preserves bluffs, and handles missing history conservatively (%j)", over => {
    const steps = generate([...seven, "poppygrower"], true, { poppygrower: over });
    expect(steps.some(s => s.stepKey === "minionInfo")).toBe(false);
    expect(steps.find(s => s.stepKey === "demonInfo")).toMatchObject({ label: "Demon — bluffs only", setupRecipientIds: ["imp"] });
    expect(steps.find(s => s.stepKey === "poppyInfo")?.prompt).toContain("Suppress normal team");
    expect(wakes(steps).some(s => s.playerId === "poppygrower")).toBe(false);
  });
  it("Poppy Grower death yields a conditional manual check, not recurring actual introductions", () => {
    const steps = generate([...seven, "poppygrower"], false, { poppygrower: { alive: false } });
    expect(steps.some(s => ["demonInfo", "minionInfo"].includes(s.stepKey))).toBe(false);
    expect(steps.find(s => s.stepKey === "poppyInfo")?.prompt).toContain("died today or tonight");
  });
  it("Magician modifies both introductions without waking the Magician", () => {
    const steps = generate([...seven, "magician"]);
    expect(steps.find(s => s.stepKey === "demonInfo")?.prompt).toContain("Include the Magician");
    expect(steps.find(s => s.stepKey === "minionInfo")?.prompt).toContain("Include the Magician");
    expect(wakes(steps).some(s => s.playerId === "magician")).toBe(false);
  });
  it.each(["legion", "lilmonsta", "atheist"])("%s uses an explicit manual information check", role => {
    const steps = generate([...seven, role]);
    expect(steps.some(s => ["demonInfo", "minionInfo"].includes(s.stepKey))).toBe(false);
    expect(steps.find(s => s.stepKey === "specialEvilInfo")?.prompt).toContain("Verify");
  });
  it("Tor overrides Toymaker introductions and warns that identity concealment is manual", () => {
    const steps = generate(seven, true, {}, { fabled: ["toymaker"], lorics: ["tor"] });
    expect(steps.some(s => ["minionInfo", "demonInfo"].includes(s.stepKey))).toBe(false);
    expect(steps.find(s => s.stepKey === "modifier:tor")?.prompt).toContain("NOT automated");
  });
  it("Storm Catcher uses its verified procedure with a manual condition warning", () => {
    expect(generate(seven, true, {}, { lorics: ["stormcatcher"] }).find(s => s.stepKey === "modifier:stormcatcher"))
      .toMatchObject({ prompt: expect.stringContaining("Announce which character is stormcaught") });
  });
  it("Pope permits in-play good bluffs without changing packet publication", () => {
    const g = game(seven);
    expect(evilInformationPolicy(Object.values(g.players), buildRegistry(all), { lorics: ["pope"] }).allowInPlayBluffs).toBe(true);
  });
});

describe("state-sensitive and deceptive procedures", () => {
  it.each(["butler", "seamstress"])("%s has an actionable first-night procedure", role =>
    expect(wakes(generate([role]))).toContainEqual(expect.objectContaining({ effectiveRoleId: role, prompt: expect.stringMatching(/choose/i) })));
  it("used once-per-game abilities do not automatically recur", () =>
    expect(wakes(generate(["seamstress"], false, { seamstress: { abilityUsed: true } }))).toHaveLength(0));
  it("dead ordinary characters are omitted, death-triggered Ravenkeeper is a conditional check", () => {
    const steps = wakes(generate(["empath", "ravenkeeper"], false, { empath: { alive: false }, ravenkeeper: { alive: false } }));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ effectiveRoleId: "ravenkeeper", advisory: expect.stringContaining("death/event condition") });
  });
  it("King waits for dead to equal living, but informs Demon on the first night", () => {
    expect(wakes(generate(["king", "imp"], false))).toHaveLength(1);
    expect(wakes(generate(["king", "imp"], false, { imp: { alive: false } })).map(s => s.effectiveRoleId)).toEqual(["king"]);
    expect(generate(["king", "imp"]).some(s => s.stepKey === "admin:king:king")).toBe(true);
  });
  it.each([["drunk", "empath"], ["marionette", "fortuneteller"], ["lunatic", "imp"]])("%s keeps perception separate from ability and player projection", (actual, shown) => {
    const g = game([actual, "imp"], { [actual]: { shownRole: shown } });
    const before = structuredClone(g);
    const steps = computeNightOrder(g.players, g.seatOrder, all, false);
    expect(wakes(steps)).toContainEqual(expect.objectContaining({ playerId: actual, effectiveRoleId: shown, isDeceived: true }));
    expect(g).toEqual(before);
    const payload = projectToSelf(g.players[actual]!, buildRegistry(all));
    expect(payload).not.toHaveProperty("actualRole");
    expect(payload?.shownRole).toBe(shown);
    if (actual === "lunatic") expect(steps.findIndex(s => s.stepKey === "lunaticTargets:lunatic")).toBeLessThan(steps.findIndex(s => s.stepKey === "p:imp:imp"));
  });
  it("unconfigured deception never creates an actual-role wake or private identity", () => {
    const g = game(["drunk", "marionette", "lunatic"], Object.fromEntries(["drunk", "marionette", "lunatic"].map(r => [r, { shownRole: null }])));
    expect(wakes(computeNightOrder(g.players, g.seatOrder, all, false))).toHaveLength(0);
    expect(projectToSelf(g.players.drunk!, buildRegistry(all))).toBeNull();
  });
});

describe("night reference validation", () => {
  it("the canonical lists have no duplicate role slots", () => {
    for (const list of [NIGHT_SHEET.firstNight, NIGHT_SHEET.otherNight]) expect(new Set(list).size).toBe(list.length);
  });
  it.each([0, -1, Infinity])("custom order %s cannot generate a confident wake", order => {
    const script: Script = { id: "home", name: "Home", characters: [{ id: "custom", name: "Custom", type: "townsfolk", firstNight: order, ability: "Choose a player." }] };
    const g = game(["custom"]);
    expect(wakes(computeNightOrder(g.players, g.seatOrder, script, true))).toHaveLength(0);
  });
  it("missing custom instruction produces a manual check", () => {
    const script: Script = { id: "home", name: "Home", characters: [{ id: "custom", name: "Custom", type: "townsfolk", firstNight: 5 }] };
    const g = game(["custom"]);
    expect(computeNightOrder(g.players, g.seatOrder, script, true)).toContainEqual(expect.objectContaining({ stepKey: "invalid:custom" }));
  });
  it("different custom characters with shared timing require manual ordering", () => {
    const script: Script = { id: "home", name: "Home", characters: ["a", "b"].map(id => ({ id, name: id, type: "townsfolk", firstNight: 5, ability: "Choose a player." })) };
    const g = game(["a", "b"]);
    const steps = computeNightOrder(g.players, g.seatOrder, script, true);
    expect(wakes(steps)).toHaveLength(2);
    expect(steps.some(s => s.stepKey.startsWith("orderConflict:"))).toBe(true);
    expect(wakes(steps)[0]?.advisory).toContain("Unverified");
    expect(roleAuthority(script.characters[0]!)).toBe("Unverified reference");
  });
});
