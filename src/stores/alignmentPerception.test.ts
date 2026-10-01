// Phase 10E: player-facing alignment perception (v23 `shownAlignment`
// Normal / good / evil / undisclosed) -- the self/public projection contract,
// the self-wire decoder, and the extended Phase 10D perception seam.
// Traceability: 10E-AC-11..16 and 10E-AC-36.
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { makeSTPlayer } from "@/test/fixtures";
import { identityNeedsCheck, projectIdentity, projectLobbyToPublic, projectLobbyToSelfMap, projectToPublic, projectToSelf } from "./projections";
import { setPerceptionIntent, shownAlignmentIntent } from "./roleResolution";
import { decodeSelfSnapshot } from "@/firebase/snapshots";
import { PlayerSelfRecordSchema, STPlayerRecordSchema } from "./schemas";
import { buildRegistry } from "@/data/roleRegistry";
import type { PlayerId, STPlayerRecord } from "./types";

const registry = buildRegistry(setupScript);
const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;
const holder = (role: string) => game().seatOrder.find((id) => player(id).actualRole === role)!;
const idOf = (name: string) => game().seatOrder.find((id) => player(id).name === name)!;

const ordinary = (over: Partial<STPlayerRecord> = {}) =>
  makeSTPlayer({ id: "o1", actualRole: "chef", shownRole: "chef", shownAlignment: null, actualAlignment: "good", ...over });
const traveler = (over: Partial<STPlayerRecord> = {}) =>
  makeSTPlayer({ id: "t1", actualRole: "thief", shownRole: "thief", publicDisplayRole: "thief", isTraveler: true, shownAlignment: null, ...over });

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null,
    customScripts: { [setupScript.id]: setupScript } });
});

function liveGame() {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (const name of ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"]) state().addPlayerToSeat(name);
  state().setRolePool(standardRoles(7));
  state().dealRolePool();
  for (const id of game().seatOrder) state().showAssignedRole(id);
  state().revealRoles();
  state().beginNightOne();
}

describe("10E-AC-11: ordinary Normal derives from the Shown Role exactly as before", () => {
  it("shownAlignment null derives from the valid Shown Role", () => {
    expect(projectIdentity(ordinary(), registry)).toEqual({ shownRole: "chef", shownAlignment: "good" });
    expect(projectIdentity(ordinary({ actualRole: "imp", shownRole: "imp", actualAlignment: "evil" }), registry)).toEqual({ shownRole: "imp", shownAlignment: "evil" });
    // A Drunk shown as Washerwoman is told Good -- from the SHOWN Role.
    expect(projectIdentity(ordinary({ actualRole: "drunk", shownRole: "washerwoman", behaviorMode: "drunk_fake_role_behavior" }), registry))
      .toEqual({ shownRole: "washerwoman", shownAlignment: "good" });
  });
});

describe("10E-AC-12: Traveler Normal follows the current Actual Alignment", () => {
  it("null follows Actual Alignment and omits it while unresolved", () => {
    expect(projectIdentity(traveler(), registry)).toEqual({ shownRole: "thief" });
    expect(projectIdentity(traveler({ actualAlignment: "evil" }), registry)).toEqual({ shownRole: "thief", shownAlignment: "evil" });
    expect(projectIdentity(traveler({ actualAlignment: "good" }), registry)).toEqual({ shownRole: "thief", shownAlignment: "good" });
  });

  it("through the store: a later Actual change is followed automatically, with no copy action", () => {
    liveGame();
    state().addPlayer("Zed");
    const zed = idOf("Zed");
    state().assignRole(zed, "thief");
    expect(projectToSelf(player(zed), registry)).toEqual({ shownRole: "thief" });
    state().setTravelerAlignment(zed, "evil");
    expect(projectToSelf(player(zed), registry)).toEqual({ shownRole: "thief", shownAlignment: "evil" });
    state().setTravelerAlignment(zed, "good");
    expect(projectToSelf(player(zed), registry)).toEqual({ shownRole: "thief", shownAlignment: "good" });
    expect(player(zed).shownAlignment).toBeNull(); // nothing was ever copied into perception
  });
});

describe("10E-AC-13: explicit overrides are honored regardless of Actual Alignment", () => {
  it.each(["good", "evil"] as const)("explicit %s for ordinary and Traveler alike", (shown) => {
    for (const actualAlignment of ["good", "evil", undefined] as const) {
      expect(projectIdentity(ordinary({ shownAlignment: shown, actualAlignment }), registry)).toEqual({ shownRole: "chef", shownAlignment: shown });
      expect(projectIdentity(traveler({ shownAlignment: shown, actualAlignment }), registry)).toEqual({ shownRole: "thief", shownAlignment: shown });
    }
  });
});

describe("10E-AC-14: undisclosed shows the character and omits the alignment", () => {
  it("ordinary and Traveler: identity without an alignment key; the sentinel never reaches the player", () => {
    for (const p of [ordinary({ shownAlignment: "undisclosed" }), traveler({ shownAlignment: "undisclosed", actualAlignment: "evil" })]) {
      const self = projectToSelf(p, registry)!;
      expect(self).toEqual({ shownRole: p.shownRole });
      expect(Object.prototype.hasOwnProperty.call(self, "shownAlignment")).toBe(false);
      expect(JSON.stringify(self)).not.toContain("undisclosed");
      expect(PlayerSelfRecordSchema.safeParse(self).success).toBe(true);
    }
  });

  it("the setup all-or-none barrier counts an undisclosed identity as a valid identity", () => {
    liveGame();
    const lobby = { ...game(), phase: "setup" as const, day: 0, setupRolesRevealed: true };
    const chef = holder("chef");
    lobby.players = { ...lobby.players, [chef]: { ...lobby.players[chef]!, shownAlignment: "undisclosed" } };
    const selves = projectLobbyToSelfMap(lobby, registry);
    expect(selves[chef]).toEqual({ shownRole: "chef" });
    expect(Object.keys(selves)).toHaveLength(7);
    expect(JSON.stringify(selves)).not.toContain("undisclosed");
  });

  it("undisclosed never makes an unsafe Shown Role projectable (fail-closed preserved)", () => {
    for (const p of [
      ordinary({ shownRole: "thief", shownAlignment: "undisclosed" }), // Traveler character on an ordinary participant
      ordinary({ shownRole: "doesnotexist", shownAlignment: "undisclosed" }),
      ordinary({ shownRole: "angel", shownAlignment: "undisclosed" }), // Fabled
      ordinary({ shownRole: null, shownAlignment: "undisclosed" }),
    ]) {
      expect(projectToSelf(p, registry)).toBeNull();
    }
    expect(identityNeedsCheck(ordinary({ shownRole: "thief", shownAlignment: "undisclosed" }), registry)).toBe(true);
  });

  it("a published packet whose identity matches the undisclosed view is delivered; a stale labelled one falls back to the plain identity", () => {
    const p = ordinary({ shownAlignment: "undisclosed", publishedPacket: { id: "k", payload: { shownRole: "chef", extraText: "hi" } } });
    expect(projectToSelf(p, registry)).toEqual({ shownRole: "chef", extraText: "hi" });
    const stale = ordinary({ shownAlignment: "undisclosed", publishedPacket: { id: "k", payload: { shownRole: "chef", shownAlignment: "good", extraText: "hi" } } });
    expect(projectToSelf(stale, registry)).toEqual({ shownRole: "chef" });
  });
});

describe("10E-AC-15: the self wire renders an alignment-less identity, never WAITING", () => {
  it("decodes an ordinary record with a valid Shown Role and no alignment as ready", () => {
    expect(decodeSelfSnapshot({ shownRole: "chef" })).toEqual({ status: "ready", data: { shownRole: "chef" } });
    expect(decodeSelfSnapshot({ shownRole: "thief" })).toEqual({ status: "ready", data: { shownRole: "thief" } });
    expect(decodeSelfSnapshot({ shownRole: "chef", shownAlignment: "evil" })).toEqual({ status: "ready", data: { shownRole: "chef", shownAlignment: "evil" } });
  });

  it("no identity is still WAITING, and a smuggled sentinel or malformed alignment is invalid -- never rendered", () => {
    expect(decodeSelfSnapshot(null)).toEqual({ status: "waiting" });
    expect(decodeSelfSnapshot({ bluffs: ["chef"] })).toEqual({ status: "waiting" });
    expect(decodeSelfSnapshot({ shownRole: "chef", shownAlignment: "undisclosed" })).toMatchObject({ status: "invalid" });
    expect(decodeSelfSnapshot({ shownRole: "chef", shownAlignment: 5 })).toMatchObject({ status: "invalid" });
  });
});

describe("10E-AC-16: an ordinary participant's Actual Alignment never fills perception", () => {
  it("omitted, derived or unsafe ordinary alignment never falls back to the Actual Alignment", () => {
    // An Evil Chef (Actual) shown as Chef is told the derived Good.
    expect(projectIdentity(ordinary({ actualAlignment: "evil" }), registry)).toEqual({ shownRole: "chef", shownAlignment: "good" });
    // Not told: omitted, even though the Actual Alignment exists.
    expect(projectIdentity(ordinary({ actualAlignment: "evil", shownAlignment: "undisclosed" }), registry)).toEqual({ shownRole: "chef" });
    // Unsafe Shown Role: no identity at all -- never the Actual Role / Alignment.
    expect(projectIdentity(ordinary({ actualAlignment: "evil", shownRole: "doesnotexist" }), registry)).toBeNull();
    expect(projectIdentity(ordinary({ actualAlignment: "evil", shownRole: null }), registry)).toBeNull();
  });
});

describe("Perception seam (Phase 10D setPerception) admits the v23 domain", () => {
  it("accepts Normal / good / evil / undisclosed for ordinary and Traveler; identical bundles are true no-ops; no Alignment History", () => {
    liveGame();
    state().addPlayer("Zed");
    const zed = idOf("Zed");
    state().assignRole(zed, "thief");
    const chef = holder("chef");
    for (const id of [chef, zed]) {
      for (const value of ["undisclosed", "good", "evil", null] as const) {
        const result = state().resolveRoles({ intents: [shownAlignmentIntent(player(id), value)] });
        expect(result).toMatchObject({ ok: true });
        expect(player(id).shownAlignment).toBe(value);
        const seq = state().localSeq;
        expect(state().resolveRoles({ intents: [shownAlignmentIntent(player(id), value)] })).toEqual({ ok: true, changed: false });
        expect(state().localSeq).toBe(seq);
      }
    }
    expect(state().setShownAlignment(chef, "undisclosed")).toMatchObject({ ok: true, changed: true });
    expect(game().history.filter((h) => h.category === "alignment")).toEqual([]);
    expect(player(chef).actualAlignment).toBe("good");
  });

  it("stale-binds the observed undisclosed value, refuses unknown values, and still needs a character for an ordinary alignment", () => {
    liveGame();
    const chef = holder("chef");
    state().setShownAlignment(chef, "undisclosed");
    const rendered = player(chef);
    expect(state().resolveRoles({ intents: [{ ...shownAlignmentIntent(rendered, "good"), expectedShownAlignment: null }] })).toMatchObject({ ok: false, code: "stale" });
    expect(state().resolveRoles({ intents: [{ ...shownAlignmentIntent(rendered, "good"), shownAlignment: "neutral" as never }] })).toMatchObject({ ok: false, code: "invalid" });
    expect(state().resolveRoles({ intents: [{ ...shownAlignmentIntent(rendered, "good"), expectedShownAlignment: "hidden" as never }] })).toMatchObject({ ok: false, code: "invalid" });
    expect(state().resolveRoles({ intents: [setPerceptionIntent(rendered, { shownRole: null, shownAlignment: "undisclosed" })] })).toMatchObject({ ok: false, code: "perception" });
    expect(player(chef)).toBe(rendered);
  });

  it("a perception change that alters the player's view withdraws the published packet (10D rule), and a Traveler character change resets to Normal", () => {
    liveGame();
    const chef = holder("chef");
    store.setState({ game: { ...game(), players: { ...game().players, [chef]: { ...player(chef), publishedPacket: { id: "k", payload: { shownRole: "chef", shownAlignment: "good" } } } } } });
    state().setShownAlignment(chef, "undisclosed");
    expect(player(chef).publishedPacket).toBeUndefined();
    state().addPlayer("Zed");
    const zed = idOf("Zed");
    state().assignRole(zed, "thief");
    state().setShownAlignment(zed, "evil");
    state().assignRole(zed, "scapegoat");
    expect(player(zed).shownAlignment).toBeNull();
  });

  it("the persisted player schema admits undisclosed as perception only (never as Actual Alignment)", () => {
    expect(STPlayerRecordSchema.shape.shownAlignment.safeParse("undisclosed").success).toBe(true);
    expect(STPlayerRecordSchema.shape.actualAlignment.safeParse("undisclosed").success).toBe(false);
    expect(STPlayerRecordSchema.shape.shownAlignment.safeParse("unresolved").success).toBe(false);
  });
});

describe("10E-AC-36: privacy and public leakage", () => {
  it("public projection never carries alignment in any perception state; self carries only the allowed identity fields", () => {
    liveGame();
    state().addPlayer("Zed");
    const zed = idOf("Zed");
    state().assignRole(zed, "thief");
    state().setTravelerAlignment(zed, "evil");
    const chef = holder("chef");
    state().setActualAlignment(chef, "evil");
    store.setState({ game: { ...game(), players: { ...game().players,
      [chef]: { ...player(chef), privateInfo: { extraText: "secret draft" } },
      [zed]: { ...player(zed), privateInfo: { travelerDemon: holder("imp") } } } } });
    for (const value of [null, "good", "evil", "undisclosed"] as const) {
      for (const id of [chef, zed]) state().setShownAlignment(id, value);
      const publicJson = JSON.stringify(projectLobbyToPublic(game(), {}));
      for (const forbidden of ["actualAlignment", "shownAlignment", "\"good\"", "\"evil\"", "undisclosed", "participantId"]) {
        expect(publicJson).not.toContain(forbidden);
      }
      for (const id of [chef, zed]) {
        expect(JSON.stringify(projectToPublic(player(id), true))).not.toMatch(/alignment/i);
        const self = projectToSelf(player(id), registry)!;
        expect(Object.keys(self).every((key) => ["shownRole", "shownAlignment", "demon", "bluffs", "minions", "extraText"].includes(key))).toBe(true);
        const selfJson = JSON.stringify(self);
        for (const forbidden of ["actualAlignment", "participantId", "history", "secret draft", "travelerDemon", "undisclosed", "correction"]) {
          expect(selfJson).not.toContain(forbidden);
        }
      }
    }
    // An Evil Chef shown Normal is told the derived Good, never their Actual Evil.
    state().setShownAlignment(chef, null);
    expect(projectToSelf(player(chef), registry)).toEqual({ shownRole: "chef", shownAlignment: "good" });
  });
});
