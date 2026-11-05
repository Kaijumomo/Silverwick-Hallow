import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";

const state = () => store.getState();
const game = () => state().game!;

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript } });
  localStorage.clear();
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (const name of ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"]) state().addPlayerToSeat(name);
});

describe("direct token placement before the Deal", () => {
  it("places tokens by hand, then the Deal shuffles only the rest of the bag onto the open seats", () => {
    const [a, b] = game().seatOrder;
    const bag = standardRoles(7);
    state().setRolePool(bag);
    const r = state().placeSetupRole(a!, "imp"); expect(r).toMatchObject({ ok: true });
    expect(state().placeSetupRole(b!, "chef").ok).toBe(true);
    expect(game().players[a!]!.actualRole).toBe("imp");
    expect(state().dealRolePool()).toMatchObject({ ok: true });
    expect(game().players[a!]!.actualRole).toBe("imp");
    expect(game().players[b!]!.actualRole).toBe("chef");
    expect(game().seatOrder.map((id) => game().players[id]!.actualRole).sort()).toEqual([...bag].sort());
  });

  it("Undo takes a placement back; a placement can be cleared; a placed token the bag lacks stops the Deal", () => {
    const [a] = game().seatOrder;
    state().setRolePool(standardRoles(7));
    state().placeSetupRole(a!, "imp");
    state().undo();
    expect(game().players[a!]!.actualRole).toBe("");
    state().placeSetupRole(a!, "imp");
    state().placeSetupRole(a!, null);
    expect(game().players[a!]!.actualRole).toBe("");
    state().setRolePool(standardRoles(7).filter((id) => id !== "imp").concat("chef"));
    state().placeSetupRole(a!, "imp");
    expect(state().dealRolePool()).toMatchObject({ ok: false });
    expect(game().setupRolesDealt).not.toBe(true);
  });

  it("is refused once roles are dealt", () => {
    const [a] = game().seatOrder;
    state().setRolePool(standardRoles(7));
    expect(state().dealRolePool().ok).toBe(true);
    expect(state().placeSetupRole(a!, "imp").ok).toBe(false);
  });
});
