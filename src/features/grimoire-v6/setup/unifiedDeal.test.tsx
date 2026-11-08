// The Deal (Role Dealing design): Distribute Roles deals at random, or "Place one by one" hands tokens to seats; Seal deals the draft in one commit.
import { beforeEach, describe, expect, it } from "vitest";
import { buildRegistry } from "@/data/roleRegistry";
import { selectScriptById, useStorytellerStore as store } from "@/stores/storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { useV6Ui } from "../v6Store";
import { buildPicker, openDistributePicker, type PickerEnv } from "../board/picker";
import { dealBack, dealGather, dealGo, dealPick, dealReturn, dealSeal, dealShuffle, dealRing, marionetteApart, shuffleRest, tokensLeft } from "./deal";

const ui = () => useV6Ui.getState();
const game = () => store.getState().game!;
type Tile = { name: string; click: () => void };
type Pk = { open: boolean; rows: Array<{ groups: Array<{ tiles: Tile[] }> }>; go: () => void; place: () => void; clear: () => void; blocked: boolean };
const registry = () => buildRegistry(setupScript);
const env = (): PickerEnv => { const script = selectScriptById(store.getState(), game().scriptId)!; return { game: game(), script, registry: registry(), ui: ui() }; };
const pk = () => buildPicker(env()) as unknown as Pk;
const tile = (name: string) => pk().rows.flatMap((r) => r.groups.flatMap((g) => g.tiles)).find((t) => t.name === name)!;
const roleOf = (i: number) => game().players[game().seatOrder[i]!]!.actualRole;
const seat = (i: number) => game().seatOrder[i]!;

beforeEach(() => {
  ui().reset();
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript } });
  store.getState().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (const name of ["Ana", "Ben", "Cleo", "Dev", "Eli", "Fay", "Gus"]) store.getState().addPlayerToSeat(name);
});

const BAG = () => standardRoles(7);
const selectBag = (bag: string[] = BAG()) => { openDistributePicker(); for (const id of bag) tile(registry().get(id)!.name).click(); };

describe("Distribute Roles: Place one by one", () => {
  it("is refused until the composition is complete, then opens The Deal with the bag and the first seat up", () => {
    openDistributePicker();
    tile("Imp").click();
    pk().place();
    expect(ui().deal).toBeNull();
    pk().clear();
    selectBag();
    pk().place();
    expect(ui().picker).toBeNull();
    expect(ui().deal).toEqual({ cur: 0, assign: {} });
    expect(game().setupRolesDealt).not.toBe(true);
  });

  it("gives each token to the seat that is up, moves on to the next empty seat, and swaps when a seat draws again", () => {
    selectBag(); pk().place();
    dealPick("imp");
    expect(ui().deal).toEqual({ cur: 1, assign: { [seat(0)]: "imp" } });
    dealPick("empath");
    dealGo(0); // back to Ana: she draws again, so the Imp returns to the bag
    dealPick("chef");
    expect(ui().deal!.assign).toEqual({ [seat(0)]: "chef", [seat(1)]: "empath" });
    expect(tokensLeft(ui().pickSel, ui().deal!.assign)).toContain("imp");
    expect(ui().deal!.cur).toBe(2); // clockwise to the next seat with no token
    // A token that is not in the bag, or already given away, does nothing.
    dealPick("chef");
    dealGo(5);
    dealPick("chef");
    expect(Object.values(ui().deal!.assign).filter((r) => r === "chef")).toHaveLength(1);
  });

  it("return, Gather all and Shuffle the rest keep every token once; the draft is never dealt until Seal", () => {
    selectBag(); pk().place();
    dealPick("imp"); dealPick("empath");
    dealGo(1); dealReturn();
    expect(ui().deal!.assign).toEqual({ [seat(0)]: "imp" });
    dealShuffle();
    expect(Object.keys(ui().deal!.assign)).toHaveLength(7);
    expect(Object.values(ui().deal!.assign).sort()).toEqual([...BAG()].sort());
    expect(ui().deal!.assign[seat(0)]).toBe("imp");
    expect(game().setupRolesDealt).not.toBe(true);
    dealGather();
    expect(ui().deal).toEqual({ cur: 0, assign: {} });
  });

  it("Seal is refused until every seat holds a token, then deals exactly the draft in one commit", () => {
    selectBag(); pk().place();
    dealPick("imp");
    expect(dealSeal()).toBe(false);
    expect(game().setupRolesDealt).not.toBe(true);
    const order = [...BAG()].filter((r) => r !== "imp").reverse();
    for (const r of order) dealPick(r);
    expect(dealSeal()).toBe(true);
    expect(game().setupRolesDealt).toBe(true);
    expect(roleOf(0)).toBe("imp");
    expect(game().seatOrder.map((_, i) => roleOf(i))).toEqual(["imp", ...order]);
    expect(ui().deal).toBeNull();
    expect(ui().pickSel).toEqual([]);
  });

  it("‹ Composition returns every token and reopens the picker with the same bag", () => {
    selectBag(); pk().place();
    dealPick("imp");
    dealBack();
    expect(ui().deal).toBeNull();
    expect(ui().picker).toMatchObject({ mode: "distribute" });
    expect(ui().pickSel).toHaveLength(7);
  });

  it("reopening Distribute Roles puts a Deal in progress away, and the random deal still works", () => {
    selectBag(); pk().place();
    dealPick("imp");
    openDistributePicker();
    expect(ui().deal).toBeNull();
    pk().go();
    expect(game().seatOrder.map((_, i) => roleOf(i)).sort()).toEqual([...BAG()].sort());
  });
});

describe("The Deal: the Marionette sits beside the Demon", () => {
  const bag = ["washerwoman", "librarian", "chef", "empath", "marionette", "poisoner", "imp"];
  const start = () => { selectBag(bag); pk().place(); };
  const seatAll = (roles: string[]) => { for (let i = 0; i < roles.length; i++) { dealGo(i); dealPick(roles[i]!); } };

  it("Seal stays blocked while the Marionette is away from the Demon, and works once they are neighbours (either side, round the ring)", () => {
    start();
    seatAll(["imp", "washerwoman", "librarian", "marionette", "chef", "empath", "poisoner"]); // Imp seat 1, Marionette seat 4
    expect(marionetteApart(ui().deal!.assign, dealRing(game()), registry())).toBe(true);
    expect(dealSeal()).toBe(false);
    expect(game().setupRolesDealt).not.toBe(true);
    dealGo(3); dealReturn(); dealGo(1); dealReturn(); // Marionette and Washerwoman return
    dealGo(6); dealReturn();
    dealGo(1); dealPick("marionette"); // beside the Imp
    dealGo(3); dealPick("washerwoman");
    dealGo(6); dealPick("poisoner");
    expect(marionetteApart(ui().deal!.assign, dealRing(game()), registry())).toBe(false);
    expect(dealSeal()).toBe(true);
    expect(game().setupRolesDealt).toBe(true);
  });

  it("the ring wraps: the last seat is beside the first", () => {
    const ring = ["a", "b", "c", "d", "e"];
    const r = registry();
    expect(marionetteApart({ a: "imp", e: "marionette", b: "chef", c: "empath", d: "empath" }, ring, r)).toBe(false);
    expect(marionetteApart({ a: "imp", c: "marionette", b: "chef", e: "empath", d: "empath" }, ring, r)).toBe(true);
    expect(marionetteApart({ a: "marionette", b: "chef" }, ring, r)).toBe(false); // no Demon seated yet
  });

  it("Shuffle the rest seats the Marionette beside the Demon whenever the open seats allow it", () => {
    const ring = ["s0", "s1", "s2", "s3", "s4", "s5", "s6"];
    for (let i = 0; i < 40; i++) {
      const out = shuffleRest(bag, {}, ring, registry());
      expect(Object.values(out).sort()).toEqual([...bag].sort());
      expect(marionetteApart(out, ring, registry())).toBe(false);
    }
  });

  it("Shuffle the rest never moves a token already placed", () => {
    const ring = ["s0", "s1", "s2", "s3", "s4", "s5", "s6"];
    const out = shuffleRest(bag, { s0: "imp", s3: "chef" }, ring, registry());
    expect(out.s0).toBe("imp");
    expect(out.s3).toBe("chef");
    expect(Object.values(out).sort()).toEqual([...bag].sort());
  });
});
