// Prepare the Town, first-night clue: a Drunk or Marionette shown the Washerwoman, Librarian or Investigator has no working
// ability, so the Storyteller chooses the token first and any two players; a working owner still gets the true clue, whichever
// order the two players are tapped in.
import { beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import { EXPERIMENTAL_CHARACTERS } from "@/data/scripts/experimental";
import type { PreparedInformationCharacter, RoleId, Script } from "@/stores/types";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useV6Ui } from "../v6Store";
import { buildRegistry } from "@/data/roleRegistry";
import { selectSetupContext } from "@/features/setup/setupContext";
import { redHerringSetup } from "@/features/setup/redHerringSetup";
import { buildPrepTasks, commitPrep, prepTap, startPrep } from "./prepare";

const ui = () => useV6Ui.getState();
const game = () => store.getState().game!;
const tb = BUILTIN_SCRIPTS.tb!;
const SCRIPT: Script = { ...tb, id: "false-clue", name: "False clue", characters: [...tb.characters, ...EXPERIMENTAL_CHARACTERS.filter((r) => r.id === "marionette")] };

const deal = (roles: RoleId[]) => {
  store.setState({ game: null, lobby: null, view: "home", undoStack: [], selectedPlayerId: null, customScripts: { [SCRIPT.id]: SCRIPT } });
  store.getState().newGame(SCRIPT.id, { plannedPlayerCount: roles.length, keepView: true });
  const ids = [...game().seatOrder];
  roles.forEach((_role, i) => store.getState().addPlayerToSeat(`P${i + 1}`, ids[i]!));
  const pins: Record<string, RoleId> = {};
  roles.forEach((role, i) => { pins[ids[i]!] = role; });
  expect(store.getState().dealRolePool(roles, undefined, pins).ok).toBe(true);
  return ids;
};
const TOWN: Record<"marionette" | "drunk" | "real", RoleId[]> = {
  marionette: ["marionette", "imp", "chef", "empath", "monk", "saint", "slayer", "baron"],
  drunk: ["drunk", "imp", "chef", "empath", "monk", "slayer", "baron", "saint"],
  real: ["investigator", "imp", "chef", "empath", "monk", "saint", "slayer", "baron"],
};
const picker = () => ui().picker as Extract<NonNullable<ReturnType<typeof ui>["picker"]>, { mode: "show" }> | null;

beforeEach(() => { ui().set({ picker: null, prepEdit: null, toast: null }); });

describe.each(["marionette", "drunk"] as const)("a %s shown a first-night character prepares a false clue", (kind) => {
  it.each<PreparedInformationCharacter>(["investigator", "librarian", "washerwoman"])("%s: token first, then any two players", (shown) => {
    const ids = deal(TOWN[kind]);
    expect(store.getState().setPerception(ids[0]!, { shownRole: shown, shownAlignment: null }).ok).toBe(true);
    startPrep(`info:${ids[0]}`, shown, ids[0]);
    // The token is chosen first, with the Information panel's character picker limited to the clue's team.
    const types = { investigator: "minion", librarian: "outsider", washerwoman: "townsfolk" } as const;
    expect(picker()).toMatchObject({ mode: "show", types: [types[shown]] });
    const token = { investigator: "poisoner", librarian: "recluse", washerwoman: "soldier" }[shown]!; // a character neither tapped player holds
    expect(picker()!.onPick!(token)).toBeUndefined();
    expect(ui().picker).toBeNull();
    expect(ui().prepEdit?.token).toBe(token);
    prepTap(ids[2]!); prepTap(ids[3]!); // two ordinary good players: neither holds the token
    commitPrep();
    expect(ui().toast).toBeNull();
    expect(ui().prepEdit).toBeNull();
    expect(game().preparedInformation).toHaveLength(1);
    expect(game().preparedInformation[0]).toMatchObject({ character: shown, mode: "storyteller", clue: { kind: "pair", shownCharacter: token } });
  });

  it("a tap before the token is chosen asks for the token first", () => {
    const ids = deal(TOWN[kind]);
    store.getState().setPerception(ids[0]!, { shownRole: "investigator", shownAlignment: null });
    startPrep(`info:${ids[0]}`, "investigator", ids[0]);
    ui().set({ picker: null });
    prepTap(ids[2]!);
    expect(picker()).toMatchObject({ mode: "show" });
    expect(ui().toast).toMatch(/Choose the Minion to show first/);
    expect(ui().prepEdit?.a).toBeNull();
  });
});

describe("a working Investigator still tells the truth", () => {
  it("takes the Minion from either tap order, and says what is wrong when neither is a Minion", () => {
    const ids = deal(TOWN.real);
    const baron = ids[7]!;
    startPrep(`info:${ids[0]}`, "investigator", ids[0]);
    expect(ui().picker).toBeNull(); // no token picker: the clue comes from the players
    prepTap(ids[2]!); prepTap(baron); // the Minion is tapped second
    expect(ui().prepEdit).toMatchObject({ token: "baron", a: baron, b: ids[2] });
    commitPrep();
    expect(game().preparedInformation[0]).toMatchObject({ mode: "verified", clue: { kind: "pair", shownCharacter: "baron", qualifyingParticipantId: game().players[baron]!.participantId } });
  });

  it("refuses two players who are not a Minion, with a plain reason", () => {
    const ids = deal(TOWN.real);
    startPrep(`info:${ids[0]}`, "investigator", ids[0]);
    prepTap(ids[2]!); prepTap(ids[3]!);
    commitPrep();
    expect(ui().toast).toMatch(/One of the two must be a Minion/);
    expect(game().preparedInformation).toHaveLength(0);
  });
});

describe("a Drunk or Marionette shown the Fortune Teller may keep a Red Herring as a reminder", () => {
  it("places one inert reminder token, replaces it on Change, and never disturbs a real Fortune Teller's Red Herring", () => {
    const ids = deal(["marionette", "imp", "fortuneteller", "empath", "monk", "saint", "slayer", "baron"]);
    store.getState().setPerception(ids[0]!, { shownRole: "fortuneteller", shownAlignment: null });
    const tasks = () => buildPrepTasks(game(), SCRIPT, buildRegistry(SCRIPT), selectSetupContext(game(), SCRIPT));
    const task = () => tasks().find((t) => t.key === `fakeherring:${ids[0]}`);
    expect(task()).toMatchObject({ req: false, done: false });
    // The real Fortune Teller's own Red Herring is prepared first.
    startPrep("redherring", "fortuneteller"); prepTap(ids[3]!); commitPrep();
    expect(redHerringSetup(selectSetupContext(game(), SCRIPT)).status).toBe("ready");
    const effectsBefore = Object.values(game().players).map((p) => p.effects.length);
    task()!.act();
    prepTap(ids[0]!); // the owner cannot carry it
    expect(ui().toast).toMatch(/another player/);
    prepTap(ids[4]!); commitPrep();
    const carrying = (id: string) => game().players[id]!.reminders.filter((r) => r.label === "Red Herring" && r.sourceCharacter === "fortuneteller");
    expect(carrying(ids[4]!)).toHaveLength(1);
    expect(task()).toMatchObject({ done: true });
    // Change moves it; nothing else is added.
    task()!.act(); prepTap(ids[5]!); commitPrep();
    expect(carrying(ids[4]!)).toHaveLength(0);
    expect(carrying(ids[5]!)).toHaveLength(1);
    // The real Fortune Teller's fact is untouched: still exactly one, still ready; no Effect was written.
    expect(Object.values(game().players).map((p) => p.effects.length)).toEqual(effectsBefore);
    expect(redHerringSetup(selectSetupContext(game(), SCRIPT)).status).toBe("ready");
  });
});
