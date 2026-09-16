import { beforeEach, describe, expect, it } from "vitest";
import { buildRegistry } from "@/data/roleRegistry";
import { makeSTPlayer, tbScript } from "@/test/fixtures";
import { dealtIdentity } from "./identity";
import { projectToSelf } from "./projections";
import { useStorytellerStore as store } from "./storytellerStore";
import { StorytellerGamePersistedSchema } from "./schemas";

const registry = buildRegistry(tbScript);
const cases = [
  ["drunk", "chef", "good"],
  ["marionette", "washerwoman", "good"],
  ["lunatic", "imp", "evil"],
] as const;
beforeEach(() => store.setState({ game: null, lobby: null, undoStack: [] }));
function seated() {
  store.getState().newGame("tb");
  store.getState().addPlayer("Alice");
  const id = store.getState().game!.seatOrder[0]!;
  return { id, current: () => store.getState().game!.players[id]! };
}

describe("AUD-004 identity boundary", () => {
  it.each(["chef", "imp", "drunk", "marionette", "lunatic"])(
    "%s without shownRole publishes neither identity, alignment nor private packets", actualRole => {
      const p = makeSTPlayer({ actualRole, shownRole: null, shownAlignment: "evil",
        privateInfo: { bluffs: ["saint"], extraText: "private packet" } });
      expect(projectToSelf(p, registry)).toBeNull();
    },
  );

  it.each(cases)("%s publishes only explicit %s perception", (actualRole, shownRole, shownAlignment) => {
    const p = makeSTPlayer({ actualRole, shownRole, stNotes: "secret",
      behaviorMode: dealtIdentity(actualRole, registry).behaviorMode });
    expect(projectToSelf(p, registry)).toEqual({ shownRole, shownAlignment });
    expect(JSON.stringify(projectToSelf(p, registry))).not.toContain(actualRole);
    expect(p.actualRole).toBe(actualRole);
  });

  it("actualRole is not consulted at the self boundary", () => {
    const p = makeSTPlayer({ shownRole: "chef" });
    Object.defineProperty(p, "actualRole", { get: () => { throw new Error("actual identity read"); } });
    expect(projectToSelf(p, registry)).toEqual({ shownRole: "chef", shownAlignment: "good" });
    p.shownRole = null;
    expect(projectToSelf(p, registry)).toBeNull();
  });

  it("bulk dealing initializes ordinary roles but blocks Night 1 until deceptive identities are configured (Phase 9C.4)", () => {
    // The fixture contains all three deceptive roles in one script.
    store.setState({ customScripts: { audit: { ...tbScript, id: "audit" } } });
    store.getState().newGame("audit", { plannedRoles: ["chef", "imp", "drunk", "marionette", "lunatic"] });
    for (const name of ["A", "B", "C", "D", "E"]) store.getState().addPlayer(name);
    store.getState().setPlannedPlayerCount(5);
    // Dealing is what creates the temporary concealed-perception state, so it
    // must remain allowed even though the deceptive roles stay unrevealed.
    expect(store.getState().dealRolePool().ok).toBe(true);
    const dealt = store.getState().game!;
    for (const p of Object.values(dealt.players)) {
      const concealed = cases.some(([role]) => role === p.actualRole);
      expect(projectToSelf(p, registry)).toEqual(concealed ? null : {
        shownRole: p.actualRole, shownAlignment: registry.alignmentOf(p.actualRole),
      });
      expect(p.shownRole).toBe(concealed ? null : p.actualRole);
    }
    // Publishing an ordinary player's identity while a concealed player has
    // none would leak "everyone else got a role card but I didn't" — so
    // beginning the game is blocked while any concealed player is unset.
    expect(store.getState().beginNightOne().ok).toBe(false);
    expect(store.getState().game!.phase).toBe("setup");

    // Each concealed identity needs a shown role that satisfies its own
    // policy (see shownRoleFilter): Drunk -> Townsfolk, Marionette -> a good
    // character, Lunatic -> the Demon.
    const validShown: Record<string, string> = { drunk: "chef", marionette: "washerwoman", lunatic: "imp" };
    for (const p of Object.values(dealt.players)) {
      const shown = validShown[p.actualRole];
      if (shown) store.getState().setShownRole(p.id, shown);
    }
    // Deal does not imply Reveal: identities are complete but still private
    // until the Storyteller explicitly reveals them.
    expect(store.getState().beginNightOne().ok).toBe(false);
    expect(store.getState().revealRoles().ok).toBe(true);
    expect(store.getState().beginNightOne().ok).toBe(true);
    expect(store.getState().game!.phase).toBe("night");
  });

  it("manual assignment is private until the explicit ordinary publication action", () => {
    const { id, current } = seated();
    store.getState().assignRole(id, "imp");
    expect(projectToSelf(current(), registry)).toBeNull();
    store.getState().showAssignedRole(id);
    expect(projectToSelf(current(), registry)).toEqual({ shownRole: "imp", shownAlignment: "evil" });
  });

  it.each(cases)("%s cannot be revealed by the ordinary publication shortcut", actual => {
    const { id, current } = seated();
    store.getState().assignRole(id, actual);
    store.getState().showAssignedRole(id);
    expect(projectToSelf(current(), registry)).toBeNull();
  });

  it("actual changes preserve perception and behavior but remove previous private packets", () => {
    const { id, current } = seated();
    store.getState().assignRole(id, "drunk");
    store.getState().setShownRole(id, "chef");
    store.getState().setBehaviorMode(id, "drunk_fake_role_behavior");
    store.getState().setBluffs(id, ["saint"]);
    store.getState().assignRole(id, "imp");
    expect(current().actualRole).toBe("imp");
    expect(current().behaviorMode).toBe("drunk_fake_role_behavior");
    expect(current().privateInfo).toBeUndefined();
    expect(projectToSelf(current(), registry)).toEqual({ shownRole: "chef", shownAlignment: "good" });
  });

  it("shown changes intentionally replace perception and clear old alignment and packets", () => {
    const { id, current } = seated();
    store.getState().assignRole(id, "lunatic");
    store.getState().setShownRole(id, "imp");
    store.getState().setShownAlignment(id, "evil");
    store.getState().setBluffs(id, ["saint"]);
    store.getState().setShownRole(id, "chef");
    expect(projectToSelf(current(), registry)).toEqual({ shownRole: "chef", shownAlignment: "good" });
    expect(current().actualRole).toBe("lunatic");
    store.getState().setShownRole(id, null);
    expect(projectToSelf(current(), registry)).toBeNull();
  });

  it.each(["clear", "traveler"] as const)("%s resets identity and private packets", action => {
    const { id, current } = seated();
    store.getState().assignRole(id, "imp");
    store.getState().showAssignedRole(id);
    store.getState().setBluffs(id, ["saint"]);
    // Phase 9 Setup finalization B4 revision: setIsTraveler refuses ordinary
    // -> Traveler once occupied ordinary would drop below 5 -- seed enough
    // extra ordinary players first (unrelated to this test's actual focus).
    if (action === "traveler") for (let i = 0; i < 5; i++) store.getState().addPlayer("Extra " + i);
    if (action === "clear") store.getState().assignRole(id, "");
    else expect(store.getState().setIsTraveler(id, true).ok).toBe(true);
    expect(current().shownRole).toBeNull();
    expect(current().shownAlignment).toBeNull();
    expect(current().privateInfo).toBeUndefined();
    expect(projectToSelf(current(), registry)).toBeNull();
  });

  it("serialized checkpoints preserve shown identity without initializing missing perception", () => {
    const { id } = seated();
    store.getState().assignRole(id, "drunk");
    store.getState().setShownRole(id, "chef");
    const restore = () => StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(store.getState().game)));
    expect(projectToSelf(restore().players[id]!, registry)).toEqual({ shownRole: "chef", shownAlignment: "good" });
    store.getState().setShownRole(id, null);
    expect(projectToSelf(restore().players[id]!, registry)).toBeNull();
  });

  it("seat reuse and a new game cannot inherit previous identities", () => {
    const { id, current } = seated();
    store.getState().assignRole(id, "drunk");
    store.getState().setShownRole(id, "chef");
    store.getState().unseatPlayer(id);
    store.getState().addToPendingQueue("bob", "Bob");
    expect(store.getState().assignPendingToSeat("bob", id)).toBe(true);
    expect(projectToSelf(current(), registry)).toBeNull();
    expect(current().actualRole).toBe("");
    store.getState().newGame("tb", { plannedPlayerCount: 1 });
    const next = Object.values(store.getState().game!.players)[0]!;
    expect(next.id).not.toBe(id);
    expect(next.actualRole).toBe("");
    expect(next.shownRole).toBeNull();
    expect(store.getState().undoStack).toEqual([]);
  });
});
