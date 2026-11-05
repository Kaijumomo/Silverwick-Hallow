// One flow for the Deal: pin characters to seats by hand and/or deal the rest at random, all inside Distribute Roles.
import { beforeEach, describe, expect, it } from "vitest";
import { buildRegistry } from "@/data/roleRegistry";
import { selectScriptById, useStorytellerStore as store } from "@/stores/storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { useV6Ui } from "../v6Store";
import { buildPicker, openChoosePicker, openDistributePicker, type PickerEnv } from "../board/picker";

const ui = () => useV6Ui.getState();
const game = () => store.getState().game!;
type Tile = { name: string; tag?: string; hasTag: boolean; click: () => void };
type Pk = { open: boolean; kicker: string; rows: Array<{ groups: Array<{ tiles: Tile[] }> }>; go: () => void; clear: () => void };
const env = (): PickerEnv => { const script = selectScriptById(store.getState(), game().scriptId)!; return { game: game(), script, registry: buildRegistry(script), ui: ui() }; };
const pk = () => buildPicker(env()) as unknown as Pk;
const tile = (name: string) => pk().rows.flatMap((r) => r.groups.flatMap((g) => g.tiles)).find((t) => t.name === name)!;
const roleOf = (i: number) => game().players[game().seatOrder[i]!]!.actualRole;

beforeEach(() => {
  ui().reset();
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript } });
  store.getState().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (const name of ["Ana", "Ben", "Cleo", "Dev", "Eli", "Fay", "Gus"]) store.getState().addPlayerToSeat(name);
});

const BAG = () => standardRoles(7);
const selectBag = () => { openDistributePicker(); for (const id of BAG()) { const name = buildRegistry(setupScript).get(id)!.name; tile(name).click(); } };

describe("Distribute Roles: pin by hand and/or deal at random", () => {
  it("a seat's Character opens the same modal; the token tapped is pinned to that seat and the Deal keeps it", () => {
    openChoosePicker(game().seatOrder[0]!);
    expect(ui().picker).toMatchObject({ mode: "distribute", seat: game().seatOrder[0] });
    expect(pk().kicker).toContain("Ana");
    tile("Imp").click();
    expect(ui().pins).toEqual({ [game().seatOrder[0]!]: "imp" });
    expect(tile("Imp").hasTag).toBe(true);
    expect(tile("Imp").tag).toBe("Ana");
    for (const id of BAG().filter((x) => x !== "imp")) tile(buildRegistry(setupScript).get(id)!.name).click();
    pk().go();
    expect(game().setupRolesDealt).toBe(true);
    expect(roleOf(0)).toBe("imp");
    expect(game().seatOrder.map((_, i) => roleOf(i)).sort()).toEqual([...BAG()].sort());
    expect(ui().pins).toEqual({});
  });

  it("with no pins it is the ordinary random deal; closing the modal keeps the draft; Clear drops bag and pins", () => {
    selectBag();
    ui().set({ picker: null });
    openChoosePicker(game().seatOrder[1]!);
    expect(ui().pickSel).toHaveLength(7);
    tile("Monk").click();
    expect(Object.values(ui().pins)).toEqual(["monk"]);
    pk().clear();
    expect(ui().pickSel).toEqual([]);
    expect(ui().pins).toEqual({});
    selectBag();
    pk().go();
    expect(game().seatOrder.map((_, i) => roleOf(i)).sort()).toEqual([...BAG()].sort());
  });

  it("pinning a token again moves the pin; removing a pinned token from the bag removes its pin; a pin outside the bag stops the Deal", () => {
    const [a, b] = game().seatOrder;
    openChoosePicker(a!); tile("Imp").click();
    openChoosePicker(b!); tile("Imp").click();
    expect(ui().pins).toEqual({ [b!]: "imp" });
    openDistributePicker(); tile("Imp").click(); // off the bag
    expect(ui().pins).toEqual({});
    expect(store.getState().dealRolePool(standardRoles(7), undefined, { [a!]: "monk", [b!]: "monk" })).toMatchObject({ ok: false });
    expect(game().setupRolesDealt).not.toBe(true);
  });
});
