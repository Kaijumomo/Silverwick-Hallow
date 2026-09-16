import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { makeSTPlayer } from "@/test/fixtures";
import { buildRegistry } from "@/data/roleRegistry";
import { selectSetupContext } from "./setupContext";
import { analyzeSetup } from "./setupAnalyzer";
import { projectLobbyToSelfMap } from "@/stores/projections";

const state = () => store.getState();
const game = () => state().game!;
const registry = buildRegistry(setupScript);

beforeEach(() => {
  localStorage.clear();
  store.setState({ game: null, lobby: null, undoStack: [], customScripts: { [setupScript.id]: setupScript } });
});

/** A genuine post-deal, pre-Reveal 5-player game with no concealed roles
 * (standardRoles(5) has zero outsiders): washerwoman, librarian,
 * investigator, poisoner, imp, in seat order. Bypasses dealRolePool()'s own
 * RNG so assignments are deterministic without mocking Math.random. */
function dealtRefinable(roles = standardRoles(5)) {
  const g = setupGame(roles, { setupRolesDealt: true, setupRolesRevealed: false });
  store.setState({ game: g });
  return g.seatOrder;
}

const reverseRandom = () => 0; // Fisher-Yates with a constant 0 rotates left by one — proven in fillRolePool.test.ts.

describe("A-E. Shuffle Roles", () => {
  it("A. preserves the bag multiset while changing the assignment, under controlled RNG", () => {
    const seats = dealtRefinable();
    const before = seats.map(id => game().players[id]!.actualRole).sort();
    const random = vi.spyOn(Math, "random").mockImplementation(reverseRandom);
    try {
      expect(state().shuffleSetupRoles().ok).toBe(true);
    } finally { random.mockRestore(); }
    const after = seats.map(id => game().players[id]!.actualRole);
    expect([...after].sort()).toEqual(before);
    expect(after).toEqual([...standardRoles(5).slice(1), standardRoles(5)[0]]); // rotate-left-by-one
    expect(after).not.toEqual(standardRoles(5));
  });

  it("B. does not affect Travelers", () => {
    const seats = dealtRefinable();
    const traveler = makeSTPlayer({ id: "t", seat: 5, isTraveler: true, actualRole: "thief", shownRole: "thief" });
    store.setState({ game: { ...game(), players: { ...game().players, t: traveler }, seatOrder: [...seats, "t"] } });
    const before = structuredClone(game().players.t);
    const random = vi.spyOn(Math, "random").mockImplementation(reverseRandom);
    try { expect(state().shuffleSetupRoles().ok).toBe(true); } finally { random.mockRestore(); }
    expect(game().players.t).toEqual(before);
  });

  it("C. rebuilds deceptive readiness: the concealed role moves, the old holder loses stale fake identity, the new holder needs configuration", () => {
    const seats = dealtRefinable(standardRoles(6)); // washerwoman, librarian, investigator, drunk, poisoner, imp
    const drunkHolder = seats[3]!;
    expect(game().players[drunkHolder]!.actualRole).toBe("drunk");
    expect(game().players[drunkHolder]!.shownRole).toBe("washerwoman"); // pre-configured, per setupGame's ready fixture

    const random = vi.spyOn(Math, "random").mockImplementation(reverseRandom);
    try { expect(state().shuffleSetupRoles().ok).toBe(true); } finally { random.mockRestore(); }

    // Rotate-left-by-one moves "drunk" from seat 3 to seat 2.
    const newDrunkHolder = seats[2]!;
    expect(game().players[newDrunkHolder]!.actualRole).toBe("drunk");
    expect(game().players[newDrunkHolder]!.shownRole).toBeNull(); // needs shown role
    expect(game().players[newDrunkHolder]!.behaviorMode).toBe("drunk_fake_role_behavior");

    // The old holder is now a normal role and carries no stale fake config.
    expect(game().players[drunkHolder]!.actualRole).toBe("poisoner");
    expect(game().players[drunkHolder]!.shownRole).toBe("poisoner");
    expect(game().players[drunkHolder]!.behaviorMode).toBe("normal");
  });

  it("D. blocked after Reveal — no mutation", () => {
    dealtRefinable();
    expect(state().revealRoles().ok).toBe(true);
    const before = state();
    expect(state().shuffleSetupRoles().ok).toBe(false);
    expect(state()).toBe(before);
  });

  it("E. blocked for a composition-invalid manual setup — no mutation, concise reason", () => {
    const seats = dealtRefinable();
    // Poisoner -> Baron invalidates the composition (Baron expects +2 Outsiders).
    const poisonerHolder = seats.find(id => game().players[id]!.actualRole === "poisoner")!;
    expect(state().replaceSetupRole(poisonerHolder, "baron").ok).toBe(true);
    const before = state();
    const result = state().shuffleSetupRoles();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Fix the current setup before shuffling roles.");
    expect(state()).toBe(before);
  });
});

describe("F-J. Setup Swap", () => {
  it("F/G. swaps exactly two players' roles and preserves the composition multiset", () => {
    const seats = dealtRefinable();
    const [a, b, ...rest] = seats;
    const restBefore = rest.map(id => structuredClone(game().players[id]!));
    const roleABefore = game().players[a!]!.actualRole;
    const roleBBefore = game().players[b!]!.actualRole;
    const multisetBefore = seats.map(id => game().players[id]!.actualRole).sort();

    expect(state().swapSetupRoles(a!, b!).ok).toBe(true);

    expect(game().players[a!]!.actualRole).toBe(roleBBefore);
    expect(game().players[b!]!.actualRole).toBe(roleABefore);
    rest.forEach((id, i) => expect(game().players[id]!).toEqual(restBefore[i]));
    expect(seats.map(id => game().players[id]!.actualRole).sort()).toEqual(multisetBefore);
  });

  it("H. deceptive configuration does not travel to the wrong player on Swap", () => {
    const g = setupGame(["drunk", "chef"], { setupRolesDealt: true, setupRolesRevealed: false });
    store.setState({ game: g });
    const [amy, ben] = g.seatOrder as [string, string];
    expect(game().players[amy]!.shownRole).toBe("washerwoman"); // Amy's Drunk fake config

    expect(state().swapSetupRoles(amy, ben).ok).toBe(true);

    expect(game().players[amy]!.actualRole).toBe("chef");
    expect(game().players[amy]!.shownRole).toBe("chef"); // fresh, reveal-ready
    expect(game().players[ben]!.actualRole).toBe("drunk");
    expect(game().players[ben]!.shownRole).toBeNull(); // never inherits Amy's old "washerwoman"
  });

  it("I. Ordinary <-> Traveler swap is refused", () => {
    const seats = dealtRefinable();
    const traveler = makeSTPlayer({ id: "t", seat: 5, isTraveler: true, actualRole: "thief", shownRole: "thief" });
    store.setState({ game: { ...game(), players: { ...game().players, t: traveler }, seatOrder: [...seats, "t"] } });
    const before = state();
    const result = state().swapSetupRoles(seats[0]!, "t");
    expect(result.ok).toBe(false);
    expect(state()).toBe(before);
  });

  it("same-player swap is refused as a no-op", () => {
    const seats = dealtRefinable();
    expect(state().swapSetupRoles(seats[0]!, seats[0]!).ok).toBe(false);
  });

  it("J. blocked after Reveal — no mutation", () => {
    const seats = dealtRefinable();
    expect(state().revealRoles().ok).toBe(true);
    const before = state();
    expect(state().swapSetupRoles(seats[0]!, seats[1]!).ok).toBe(false);
    expect(state()).toBe(before);
  });
});

describe("K-O. Manual actual-role override", () => {
  it("K. changes exactly one player's actual role", () => {
    const seats = dealtRefinable();
    const [target, ...rest] = seats;
    const restBefore = rest.map(id => structuredClone(game().players[id]!));
    expect(state().replaceSetupRole(target!, "baron").ok).toBe(true);
    expect(game().players[target!]!.actualRole).toBe("baron");
    rest.forEach((id, i) => expect(game().players[id]!).toEqual(restBefore[i]));
  });

  it("L. a normal replacement role gets a fresh deterministic shown identity", () => {
    const seats = dealtRefinable();
    expect(state().replaceSetupRole(seats[0]!, "empath").ok).toBe(true);
    expect(game().players[seats[0]!]).toMatchObject({
      actualRole: "empath", shownRole: "empath", shownAlignment: "good", behaviorMode: "normal",
    });
  });

  it("M. a concealed replacement role becomes unresolved and reveal readiness reflects it", () => {
    const seats = dealtRefinable();
    expect(state().replaceSetupRole(seats[0]!, "drunk").ok).toBe(true);
    expect(game().players[seats[0]!]).toMatchObject({
      actualRole: "drunk", shownRole: null, behaviorMode: "drunk_fake_role_behavior",
    });
    expect(state().revealRoles().ok).toBe(false);
  });

  it("N. clears stale role-specific private information and publication state from the old assignment", () => {
    const seats = dealtRefinable();
    const impHolder = seats.find(id => game().players[id]!.actualRole === "imp")!;
    store.getState().setBluffs(impHolder, ["chef", "saint", "washerwoman"]);
    store.setState({ game: { ...game(), players: { ...game().players,
      [impHolder]: { ...game().players[impHolder]!, publishedPacket: { id: "old", payload: { shownRole: "imp", shownAlignment: "evil" } } } } } });
    expect(game().players[impHolder]!.privateInfo?.bluffs).toEqual(["chef", "saint", "washerwoman"]);

    expect(state().replaceSetupRole(impHolder, "empath").ok).toBe(true);

    expect(game().players[impHolder]!.privateInfo).toBeUndefined();
    expect(game().players[impHolder]!.publishedPacket).toBeUndefined();
  });

  it("O. an invalid manual override is preserved, not auto-corrected -- the analyzer reports it and Reveal blocks", () => {
    const seats = dealtRefinable();
    const before = analyzeSetup(selectSetupContext(game(), setupScript));
    expect(before.findings.some(f => f.code === "composition:assigned")).toBe(false);

    const poisonerHolder = seats.find(id => game().players[id]!.actualRole === "poisoner")!;
    const othersBefore = seats.filter(id => id !== poisonerHolder).map(id => structuredClone(game().players[id]!));
    expect(state().replaceSetupRole(poisonerHolder, "baron").ok).toBe(true);

    // The override survives untouched -- no automatic correction of any kind.
    expect(game().players[poisonerHolder]!.actualRole).toBe("baron");
    seats.filter(id => id !== poisonerHolder).forEach((id, i) => expect(game().players[id]!).toEqual(othersBefore[i]));

    const after = analyzeSetup(selectSetupContext(game(), setupScript));
    expect(after.findings.find(f => f.code === "composition:assigned")).toMatchObject({ severity: "warning" });
    const revealResult = state().revealRoles();
    expect(revealResult.ok).toBe(false);
    if (!revealResult.ok) expect(revealResult.message).toBe("Setup needs correction before revealing roles.");
  });
});

describe("P-T. Edit Bag", () => {
  it("P. a one-for-one replacement changes only the holder of the removed role", () => {
    const seats = dealtRefinable(); // washerwoman, librarian, investigator, poisoner, imp
    const bag = seats.map(id => game().players[id]!.actualRole);
    const staged = bag.map(r => r === "poisoner" ? "baron" : r);
    const othersBefore = seats.filter((_, i) => bag[i] !== "poisoner").map(id => structuredClone(game().players[id]!));

    expect(state().applyEditedBag(staged).ok).toBe(true);

    const poisonerHolder = seats[bag.indexOf("poisoner")]!;
    expect(game().players[poisonerHolder]!.actualRole).toBe("baron");
    seats.filter((_, i) => bag[i] !== "poisoner").forEach((id, i) => expect(game().players[id]!).toEqual(othersBefore[i]));
  });

  it("Q. multiple replacements change only the affected seats", () => {
    const seats = dealtRefinable();
    const bag = seats.map(id => game().players[id]!.actualRole); // [washerwoman, librarian, investigator, poisoner, imp]
    const staged = ["washerwoman", "fortuneteller", "investigator", "baron", "imp"];
    expect(state().applyEditedBag(staged).ok).toBe(true);
    const actual = seats.map(id => game().players[id]!.actualRole);
    expect(actual).toEqual(staged);
    // Unaffected seats (0, 2, 4) kept their exact prior player record apart
    // from role-independent fields; only seats 1 and 3 changed role.
    expect(game().players[seats[0]!]!.actualRole).toBe(bag[0]);
    expect(game().players[seats[2]!]!.actualRole).toBe(bag[2]);
    expect(game().players[seats[4]!]!.actualRole).toBe(bag[4]);
  });

  it("R. duplicate role occurrences are handled by count, not merely by id", () => {
    const g = setupGame(["villageidiot", "villageidiot", "villageidiot", "poisoner", "imp"],
      { setupRolesDealt: true, setupRolesRevealed: false });
    store.setState({ game: g });
    const seats = g.seatOrder;
    const staged = ["villageidiot", "villageidiot", "chef", "poisoner", "imp"];
    expect(state().applyEditedBag(staged).ok).toBe(true);
    const villageIdiotCount = seats.filter(id => game().players[id]!.actualRole === "villageidiot").length;
    expect(villageIdiotCount).toBe(2);
    expect(seats.filter(id => game().players[id]!.actualRole === "chef")).toHaveLength(1);
  });

  it("S. a wrong total count cannot be applied; existing assignments remain untouched", () => {
    const seats = dealtRefinable();
    const before = seats.map(id => structuredClone(game().players[id]!));
    const result = state().applyEditedBag(["chef", "empath"]); // too few
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("2/5");
    seats.forEach((id, i) => expect(game().players[id]!).toEqual(before[i]));
  });

  it("T. a composition-invalid staged bag may still be applied as explicit Storyteller intent; Reveal stays blocked", () => {
    const seats = dealtRefinable();
    const bag = seats.map(id => game().players[id]!.actualRole);
    const staged = bag.map(r => r === "poisoner" ? "baron" : r); // total count matches; composition doesn't
    expect(state().applyEditedBag(staged).ok).toBe(true);
    const analysis = analyzeSetup(selectSetupContext(game(), setupScript));
    expect(analysis.findings.find(f => f.code === "composition:assigned")).toMatchObject({ severity: "warning" });
    expect(state().revealRoles().ok).toBe(false);
  });
});

describe("U. Storyteller can correct an invalid state manually", () => {
  it("fixing the composition makes the setup valid and Reveal available once identity is also ready", () => {
    const seats = dealtRefinable();
    const poisonerHolder = seats.find(id => game().players[id]!.actualRole === "poisoner")!;
    expect(state().replaceSetupRole(poisonerHolder, "baron").ok).toBe(true);
    expect(state().revealRoles().ok).toBe(false);

    // Correct it: Baron requires 2 Outsiders -- also override two Townsfolk
    // into Outsiders to match its adjusted composition.
    const townsfolkHolders = seats.filter(id => ["washerwoman", "librarian", "investigator"].includes(game().players[id]!.actualRole));
    expect(state().replaceSetupRole(townsfolkHolders[0]!, "drunk").ok).toBe(true);
    expect(state().replaceSetupRole(townsfolkHolders[1]!, "saint").ok).toBe(true);

    const analysis = analyzeSetup(selectSetupContext(game(), setupScript));
    expect(analysis.findings.find(f => f.code === "composition:assigned")).toBeUndefined();

    // The Drunk override needs a shown role before Reveal. "chef" is not
    // otherwise in play in this scenario, so it's an unambiguous choice.
    const drunkHolder = townsfolkHolders[0]!;
    const stillBlocked = state().revealRoles();
    expect(stillBlocked.ok).toBe(false);
    state().setShownRole(drunkHolder, "chef");
    expect(state().revealRoles().ok).toBe(true);
  });
});

describe("V. Modifier changes never auto-shuffle assignments", () => {
  it("toggling Fabled/Lorics leaves every actual role assignment untouched", () => {
    const seats = dealtRefinable();
    const before = seats.map(id => structuredClone(game().players[id]!));
    store.getState().setFabled(["toymaker"]);
    store.getState().setLorics(["stormcatcher"]);
    seats.forEach((id, i) => expect(game().players[id]!).toEqual(before[i]));
  });

  it("an already-invalid composition remains blocked after a modifier change -- never fixed or worsened by it", () => {
    const seats = dealtRefinable();
    const poisonerHolder = seats.find(id => game().players[id]!.actualRole === "poisoner")!;
    expect(state().replaceSetupRole(poisonerHolder, "baron").ok).toBe(true);
    const before = seats.map(id => structuredClone(game().players[id]!));

    store.getState().setFabled(["toymaker"]);

    seats.forEach((id, i) => expect(game().players[id]!).toEqual(before[i]));
    expect(state().revealRoles().ok).toBe(false);
  });
});

describe("W. Reveal commits the setup: every refinement command becomes unavailable", () => {
  it("rejects direct invocation of Shuffle/Swap/Override/Edit Bag with no mutation, even called directly", () => {
    const seats = dealtRefinable();
    expect(state().revealRoles().ok).toBe(true);
    const before = state();

    expect(state().shuffleSetupRoles().ok).toBe(false);
    expect(state()).toBe(before);
    expect(state().swapSetupRoles(seats[0]!, seats[1]!).ok).toBe(false);
    expect(state()).toBe(before);
    expect(state().replaceSetupRole(seats[0]!, "baron").ok).toBe(false);
    expect(state()).toBe(before);
    expect(state().applyEditedBag(seats.map(id => game().players[id]!.actualRole)).ok).toBe(false);
    expect(state()).toBe(before);
  });
});

describe("X. Generic assignRole() keeps its existing in-game semantics", () => {
  it("preserves the player's shown identity, unlike the Setup-specific override", () => {
    const seats = dealtRefinable();
    const target = seats[0]!;
    const shownBefore = game().players[target]!.shownRole;
    store.getState().assignRole(target, "baron");
    // The generic action never resets shown identity for a new actual role.
    expect(game().players[target]!.actualRole).toBe("baron");
    expect(game().players[target]!.shownRole).toBe(shownBefore);
  });
});

describe("Y. Live lobby survives every refinement action", () => {
  it("Shuffle/Swap/Override/Edit Bag never touch lobby state", () => {
    const seats = dealtRefinable();
    store.getState().setLobby({ code: "ABCD1234", uid: "st", status: "live" });
    const lobbyBefore = state().lobby;

    const random = vi.spyOn(Math, "random").mockImplementation(reverseRandom);
    try { state().shuffleSetupRoles(); } finally { random.mockRestore(); }
    expect(state().lobby).toBe(lobbyBefore);

    state().swapSetupRoles(seats[0]!, seats[1]!);
    expect(state().lobby).toBe(lobbyBefore);

    state().replaceSetupRole(seats[0]!, "baron");
    expect(state().lobby).toBe(lobbyBefore);

    state().applyEditedBag(seats.map(id => game().players[id]!.actualRole));
    expect(state().lobby).toBe(lobbyBefore);
  });
});

describe("Z. Persistence / reconnect", () => {
  it("a refined, unrevealed setup persists through local reload without becoming revealed", async () => {
    const seats = dealtRefinable();
    expect(state().replaceSetupRole(seats[0]!, "baron").ok).toBe(true);
    const refinedRole = game().players[seats[0]!]!.actualRole;

    const saved = localStorage.getItem("new-blood-st")!;
    store.setState({ game: null });
    localStorage.setItem("new-blood-st", saved);
    await store.persist.rehydrate();

    expect(game().players[seats[0]!]!.actualRole).toBe(refinedRole);
    expect(game().setupRolesRevealed).toBe(false);
  });
});

describe("Projection / privacy regression: refinement never bypasses the Reveal barrier", () => {
  it("a refined, complete-but-unrevealed setup withholds every ordinary self projection", () => {
    const seats = dealtRefinable(); // no concealed roles, so every shown identity is already complete
    const random = vi.spyOn(Math, "random").mockImplementation(reverseRandom);
    try { expect(state().shuffleSetupRoles().ok).toBe(true); } finally { random.mockRestore(); }
    expect(seats.every(id => !!game().players[id]!.shownRole)).toBe(true); // identity-ready
    expect(projectLobbyToSelfMap(game(), registry)).toEqual({}); // still withheld
  });

  it("Reveal publishes every ready ordinary identity atomically once the setup is valid", () => {
    const seats = dealtRefinable();
    const random = vi.spyOn(Math, "random").mockImplementation(reverseRandom);
    try { expect(state().shuffleSetupRoles().ok).toBe(true); } finally { random.mockRestore(); }
    expect(state().revealRoles().ok).toBe(true);
    const selves = projectLobbyToSelfMap(game(), registry);
    expect(Object.keys(selves).sort()).toEqual([...seats].sort());
  });

  it("an invalid manual setup can never become a way around the Reveal/privacy barrier", () => {
    const seats = dealtRefinable();
    const poisonerHolder = seats.find(id => game().players[id]!.actualRole === "poisoner")!;
    expect(state().replaceSetupRole(poisonerHolder, "baron").ok).toBe(true);
    // Every remaining identity is otherwise complete/ready, but the setup is
    // composition-invalid -- Reveal must still refuse, and projection stays
    // withheld regardless of what any direct write might attempt.
    expect(state().revealRoles().ok).toBe(false);
    expect(game().setupRolesRevealed).toBeFalsy();
    expect(projectLobbyToSelfMap(game(), registry)).toEqual({});
  });
});
