// Concealed identities and Traveller arrivals in "Prepare the town" (PR #12 review findings P1 and P2): the V2
// picker follows the one central shown-role policy, and a starting Traveller's arrival is resolved by the
// Storyteller's explicit confirmation on the preparation task, through the existing store commands.
import { beforeEach, describe, expect, it } from "vitest";
import { buildRegistry } from "@/data/roleRegistry";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import { EXPERIMENTAL_CHARACTERS } from "@/data/scripts/experimental";
import type { BehaviorMode, RoleId, Script, StorytellerLobbyRecord } from "@/stores/types";
import { selectScriptById, useStorytellerStore as store } from "@/stores/storytellerStore";
import { travelerHasUnresolvedArrival } from "@/stores/travelers";
import { selectSetupContext } from "@/features/setup/setupContext";
import { initialRevealReadiness } from "@/features/setup/revealReadiness";
import { useV6Ui } from "../v6Store";
import { buildPicker, shownChoicesFor, type PickerEnv } from "../board/picker";
import { buildPrepTasks, openShown } from "./prepare";

const ui = () => useV6Ui.getState();
const game = () => store.getState().game!;

const tb = BUILTIN_SCRIPTS.tb!;
const pick = (source: Script, ids: string[]) => ids.map((id) => source.characters.find((r) => r.id === id) ?? EXPERIMENTAL_CHARACTERS.find((r) => r.id === id)!);
// Trouble Brewing plus the two concealed characters it lacks (Lunatic from Bad Moon Rising, Marionette from the experimental set).
const SCRIPT: Script = { ...tb, id: "p4-concealed", name: "P4 concealed", characters: [...tb.characters, ...pick(BUILTIN_SCRIPTS.bmr!, ["lunatic"]), ...pick(tb, ["marionette"])] };

const MODE: Record<string, BehaviorMode> = { drunk: "drunk_fake_role_behavior", lunatic: "fake_demon_behavior", marionette: "marionette_fake_good_behavior" };

/** A dealt, not yet revealed town: ordinary roles in seat order, concealed ones without a shown identity. */
function dealt(roles: RoleId[], scriptId = SCRIPT.id) {
  store.setState({ game: null, lobby: null, view: "home", undoStack: [], selectedPlayerId: null, customScripts: { [SCRIPT.id]: SCRIPT } });
  store.getState().newGame(scriptId, { plannedPlayerCount: roles.length, keepView: true });
  const ids = [...game().seatOrder];
  roles.forEach((role, i) => store.getState().addPlayerToSeat(`P${i + 1}`, ids[i]!));
  const players = { ...game().players };
  roles.forEach((role, i) => {
    const concealed = MODE[role];
    players[ids[i]!] = { ...players[ids[i]!]!, actualRole: role, shownRole: concealed ? null : role, shownAlignment: null, behaviorMode: concealed ?? "normal" };
  });
  store.setState({ game: { ...game(), players, setupRolesDealt: true, setupRolesRevealed: false } as StorytellerLobbyRecord });
  return ids;
}

const env = (): PickerEnv => ({ game: game(), script: selectScriptById(store.getState(), game().scriptId)!, registry: buildRegistry(selectScriptById(store.getState(), game().scriptId)!), ui: ui() });
type Tile = { name: string; opacity: number; click: () => void };
const picker = () => buildPicker(env()) as { rows: Array<{ groups: Array<{ label: string; tiles: Tile[] }> }>; title: string; kicker: string };
const tiles = () => picker().rows.flatMap((r) => r.groups.flatMap((g) => g.tiles));
const open = (id: string) => { openShown(id); };
const choosable = () => tiles().filter((t) => t.opacity === 1).map((t) => t.name).sort();
const tile = (name: string) => tiles().find((t) => t.name === name)!;
const readiness = () => initialRevealReadiness(selectSetupContext(game(), selectScriptById(store.getState(), game().scriptId)!));
const tasks = () => {
  const script = selectScriptById(store.getState(), game().scriptId)!;
  return buildPrepTasks(game(), script, buildRegistry(script), selectSetupContext(game(), script));
};

beforeEach(() => { ui().set({ picker: null, toast: null }); });

describe("shown-identity policy (P1)", () => {
  it("offers each concealed character only what its rule allows, and a normal role nothing", () => {
    const ids = dealt(["drunk", "lunatic", "marionette", "imp", "chef", "empath", "monk", "baron"]);
    const g = game();
    const context = selectSetupContext(g, SCRIPT);
    const ordinary = SCRIPT.characters;
    const names = (id: string) => shownChoicesFor(g.players[id], ordinary, context).map((r) => r.id);
    // Drunk: a Townsfolk that is not in play (Chef, Empath and Monk are in play).
    expect(names(ids[0]!).every((r) => ordinary.find((c) => c.id === r)!.type === "townsfolk")).toBe(true);
    expect(names(ids[0]!)).not.toContain("chef");
    expect(names(ids[0]!)).toContain("washerwoman");
    // Lunatic: a Demon, even though the real Demon is in play.
    expect(names(ids[1]!)).toEqual(["imp"]);
    // Marionette: a good character, never a Minion or Demon.
    const marionette = names(ids[2]!);
    expect(marionette).toContain("chef");
    expect(marionette).toContain("saint");
    expect(marionette.some((r) => ["baron", "imp", "poisoner"].includes(r))).toBe(false);
    // A normal role has no shown-identity choice.
    expect(names(ids[4]!)).toEqual([]);
  });

  it("lets the Lunatic be shown a Demon, and the reveal becomes ready for them", () => {
    const ids = dealt(["lunatic", "imp", "chef", "empath", "monk", "saint", "slayer", "baron"]);
    expect(readiness().pendingIds).toContain(ids[0]);
    open(ids[0]!);
    expect(picker().kicker).toBe("The Lunatic · choose a Demon");
    expect(picker().title).toBe("Who does P1 think they are?");
    expect(picker().rows.flatMap((r) => r.groups.map((g) => g.label))).toEqual(["Demon"]);
    expect(choosable()).toEqual(["Imp"]);
    tile("Imp").click();
    expect(game().players[ids[0]!]!.shownRole).toBe("imp");
    expect(ui().picker).toBeNull();
    expect(readiness().pendingIds).not.toContain(ids[0]);
  });

  it("lets the Marionette be shown a good character, from Townsfolk and Outsiders only", () => {
    const ids = dealt(["marionette", "imp", "chef", "empath", "monk", "saint", "slayer", "baron"]);
    open(ids[0]!);
    expect(picker().kicker).toBe("The Marionette · choose a good character");
    expect(picker().rows.flatMap((r) => r.groups.map((g) => g.label))).toEqual(["Townsfolk", "Outsiders"]);
    expect(tiles().some((t) => ["Imp", "Baron", "Poisoner"].includes(t.name))).toBe(false);
    tile("Saint").click();
    expect(game().players[ids[0]!]!.shownRole).toBe("saint");
    expect(readiness().pendingIds).not.toContain(ids[0]);
  });

  it("keeps the Trouble Brewing Drunk exactly as before: Townsfolk not in play only", () => {
    const ids = dealt(["drunk", "imp", "chef", "empath", "monk", "slayer", "baron", "saint"], "tb");
    open(ids[0]!);
    expect(picker().kicker).toBe("The Drunk · choose a Townsfolk that is not in play");
    expect(picker().rows.flatMap((r) => r.groups.map((g) => g.label))).toEqual(["Townsfolk"]);
    const free = choosable();
    expect(free).toContain("Washerwoman");
    for (const inPlay of ["Chef", "Empath", "Monk", "Slayer"]) expect(free).not.toContain(inPlay);
    tile("Washerwoman").click();
    expect(game().players[ids[0]!]!.shownRole).toBe("washerwoman");
    expect(readiness().pendingIds).not.toContain(ids[0]);
  });

  it("refuses a wrong choice and changes nothing: an in-play Townsfolk for the Drunk", () => {
    const ids = dealt(["drunk", "imp", "chef", "empath", "monk", "slayer", "baron", "saint"], "tb");
    open(ids[0]!);
    expect(tile("Chef").opacity).toBe(0.4);
    tile("Chef").click();
    expect(game().players[ids[0]!]!.shownRole).toBeNull();
    expect(ui().toast).toMatch(/Chef is in play/);
    expect(ui().picker).not.toBeNull();
  });

  it("never counts a character outside the rule as ready, and a normal role gets no picker choices", () => {
    const ids = dealt(["marionette", "imp", "chef", "empath", "monk", "saint", "slayer", "baron"]);
    // Whatever wrote it, a Demon shown to a Marionette leaves the reveal blocked: the central policy is the backstop.
    store.getState().setShownRole(ids[0]!, "imp");
    expect(readiness().pendingIds).toContain(ids[0]);
    expect(tasks().find((t) => t.key === `shown:${ids[0]}`)!.done).toBe(false);
    store.getState().setShownRole(ids[0]!, "saint");
    expect(readiness().pendingIds).not.toContain(ids[0]);
    open(ids[2]!);
    expect(tiles()).toEqual([]);
    expect(game().players[ids[2]!]!.shownRole).toBe("chef");
  });

  it("does not change a concealed identity once setup has been revealed", () => {
    const ids = dealt(["lunatic", "imp", "chef", "empath", "monk", "saint", "slayer", "baron"]);
    open(ids[0]!);
    store.setState({ game: { ...game(), setupRolesRevealed: true } });
    tile("Imp").click();
    expect(game().players[ids[0]!]!.shownRole).toBeNull();
    expect(ui().toast).toMatch(/Setup changed/);
  });

  it("lists a preparation task for Drunk, Lunatic and Marionette, done once each has a shown identity", () => {
    const ids = dealt(["drunk", "lunatic", "marionette", "imp", "chef", "empath", "monk", "baron"]);
    const shown = () => tasks().filter((t) => t.key.startsWith("shown:"));
    expect(shown().map((t) => t.roleId).sort()).toEqual(["drunk", "lunatic", "marionette"]);
    expect(shown().every((t) => !t.done && t.req)).toBe(true);
    store.getState().setShownRole(ids[1]!, "imp");
    expect(shown().find((t) => t.roleId === "lunatic")!.done).toBe(true);
    expect(shown().filter((t) => !t.done)).toHaveLength(2);
  });
});

/** A dealt town plus Travellers (public characters with their alignment chosen or not). */
function withTravellers(travellers: Array<[RoleId, "good" | "evil" | null]>) {
  dealt(["imp", "chef", "empath", "monk", "saint", "slayer", "baron", "washerwoman"], "tb");
  const players = { ...game().players };
  const order = [...game().seatOrder];
  const ids = travellers.map(([role, alignment], i) => {
    const id = `traveller-${i}`;
    players[id] = { ...players[game().seatOrder[0]!]!, id, name: `T${i + 1}`, seat: order.length + i, isTraveler: true, isEmpty: false, actualRole: role, shownRole: role,
      actualAlignment: alignment, alive: true, exiled: false, travelerArrival: { demonInfoComplete: false, firstNightComplete: false }, participantId: `participant-${id}` } as never;
    return id;
  });
  store.setState({ game: { ...game(), players, seatOrder: [...order, ...ids] } as StorytellerLobbyRecord });
  return ids;
}
const travellerTasks = () => tasks().filter((t) => t.key.startsWith("traveller:"));

describe("starting Traveller arrival (P2)", () => {
  it("asks for the alignment first, and offers no completion until it is chosen", () => {
    withTravellers([["gnome", null]]);
    expect(travellerTasks().map((t) => t.key)).toEqual(["traveller:traveller-0"]);
    expect(travellerTasks()[0]!.actLabel).toBe("Good");
  });

  it("resolves a Gnome's public starting check only when the Storyteller confirms it", () => {
    const [id] = withTravellers([["gnome", "good"]]);
    const before = travellerTasks();
    expect(before.map((t) => t.key)).toEqual([`traveller:${id}:check`]);
    expect(travelerHasUnresolvedArrival(game().players[id!]!)).toBe(true);
    // Building the list resolves nothing by itself.
    tasks();
    expect(game().players[id!]!.travelerArrival?.arrivalCheckComplete).toBeUndefined();
    before[0]!.act();
    expect(game().players[id!]!.travelerArrival?.arrivalCheckComplete).toBe(true);
    expect(travelerHasUnresolvedArrival(game().players[id!]!)).toBe(false);
    expect(travellerTasks()).toEqual([]);
  });

  it("resolves an evil Traveller's Demon information by confirmation, leaving a Gnome's check open", () => {
    const [id] = withTravellers([["gnome", "evil"]]);
    expect(travellerTasks().map((t) => t.key).sort()).toEqual([`traveller:${id}:check`, `traveller:${id}:demon`]);
    travellerTasks().find((t) => t.key.endsWith(":demon"))!.act();
    expect(game().players[id!]!.travelerArrival?.demonInfoComplete).toBe(true);
    expect(travellerTasks().map((t) => t.key)).toEqual([`traveller:${id}:check`]);
    expect(travelerHasUnresolvedArrival(game().players[id!]!)).toBe(true);
    travellerTasks()[0]!.act();
    expect(travelerHasUnresolvedArrival(game().players[id!]!)).toBe(false);
  });

  it("offers nothing for a good Traveller with no starting check, or for one who is dead or exiled", () => {
    const [good, dead, exiled] = withTravellers([["bureaucrat", "good"], ["bureaucrat", "evil"], ["gnome", "evil"]]);
    store.setState({ game: { ...game(), players: { ...game().players,
      [dead!]: { ...game().players[dead!]!, alive: false }, [exiled!]: { ...game().players[exiled!]!, exiled: true } } } as StorytellerLobbyRecord });
    expect(travellerTasks()).toEqual([]);
    expect(travelerHasUnresolvedArrival(game().players[good!]!)).toBe(false);
  });

  it("keeps the alignment choice working, then moves on to the arrival confirmation", () => {
    const [id] = withTravellers([["bureaucrat", null]]);
    travellerTasks()[0]!.alt!();
    expect(game().players[id!]!.actualAlignment).toBe("evil");
    expect(travellerTasks().map((t) => t.key)).toEqual([`traveller:${id}:demon`]);
  });
});
