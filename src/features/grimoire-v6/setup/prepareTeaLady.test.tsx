// LS-2b: the Tea Lady's setup step (PO design 2026-11-12 23:56Z) and her derived CANNOT DIE tokens.
// "Does <player name> register as good or evil?" with Good / Evil, one row per Spy or Recluse, built from the existing Prepare row.
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { buildRegistry } from "@/data/roleRegistry";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import type { RoleId, Script, StorytellerLobbyRecord } from "@/stores/types";
import { selectScriptById, useStorytellerStore as store } from "@/stores/storytellerStore";
import { selectSetupContext } from "@/rules/setup/setupContext";
import { createRulesQuery } from "@/stores/rulesQuery";
import { usePrivacyStore } from "@/stores/privacyStore";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { useV6Ui } from "../v6Store";
import { useV6Ctx } from "../ctx";
import { useBoardVm } from "../vm/board";
import { playerMarks } from "../board/marks";
import { buildPrepTasks } from "./prepare";

const tb = BUILTIN_SCRIPTS.tb!, bmr = BUILTIN_SCRIPTS.bmr!;
const SCRIPT: Script = { ...bmr, id: "ls2-tealady", name: "LS-2 Tea Lady", characters: [...bmr.characters, ...tb.characters.filter((r) => ["spy", "recluse", "empath", "chef", "imp"].includes(r.id))] };
const game = () => store.getState().game!;
const script = () => selectScriptById(store.getState(), game().scriptId)!;
const tasks = () => buildPrepTasks(game(), script(), buildRegistry(script()), selectSetupContext(game(), script()));
const teaTasks = () => tasks().filter((t) => t.key.startsWith("tealady:"));

/** A dealt, not yet revealed town, in seat order. */
function dealt(roles: RoleId[]) {
  store.setState({ game: null, lobby: null, view: "home", undoStack: [], selectedPlayerId: null, customScripts: { [SCRIPT.id]: SCRIPT } });
  store.getState().newGame(SCRIPT.id, { plannedPlayerCount: roles.length, keepView: true });
  const ids = [...game().seatOrder];
  roles.forEach((_role, i) => store.getState().addPlayerToSeat(`P${i + 1}`, ids[i]!));
  const registry = buildRegistry(SCRIPT);
  const players = { ...game().players };
  roles.forEach((role, i) => {
    const type = registry.get(role)!.type;
    players[ids[i]!] = { ...players[ids[i]!]!, actualRole: role, shownRole: role, actualAlignment: type === "minion" || type === "demon" ? "evil" : "good", behaviorMode: "normal" };
  });
  store.setState({ game: { ...game(), players, setupRolesDealt: true, setupRolesRevealed: false } as StorytellerLobbyRecord });
  return ids;
}

const wrapper = ({ children }: { children: ReactNode }) => <VotingProvider>{children}</VotingProvider>;
const labels = (id: string) => {
  const g = game();
  return playerMarks({ game: g, script: script(), registry: buildRegistry(script()), query: createRulesQuery(g, { script: script(), registry: buildRegistry(script()) }) }, g.players[id]!).map((m) => m.label);
};

beforeEach(() => { useV6Ui.getState().reset(); usePrivacyStore.setState({ enabled: false }); });

describe("Tea Lady setup step", () => {
  it("one row per Spy and Recluse while a Tea Lady is in play; required only for a living neighbour", () => {
    // Seats: Spy, Tea Lady, Chef, Recluse, Imp, Empath
    const ids = dealt(["spy", "tealady", "chef", "recluse", "imp", "empath"]);
    const rows = teaTasks();
    expect(rows.map((t) => t.key)).toEqual([`tealady:${ids[0]}`, `tealady:${ids[3]}`]);
    expect(rows.map((t) => t.req)).toEqual([true, false]);
    expect(rows[0]).toMatchObject({ roleId: "tealady", roleName: "Tea Lady", done: false, sub: "Does P1 register as good or evil?", actLabel: "Good", altLabel: "Evil", type: "townsfolk" });
    expect(rows[1]!.sub).toBe("Does P4 register as good or evil?");
  });

  it("no row without a Tea Lady", () => {
    dealt(["spy", "chef", "recluse", "imp", "empath"]);
    expect(teaTasks()).toEqual([]);
  });

  it("Good stores one fact, Evil replaces it, undo clears it; the store's Undo restores; nothing is projected", () => {
    const ids = dealt(["spy", "tealady", "chef", "recluse", "imp", "empath"]);
    const facts = () => game().players[ids[0]!]!.effects.map((e) => e.type);
    const before = game();
    teaTasks()[0]!.act();
    expect(facts()).toEqual(["registersGoodToTeaLady"]);
    expect(teaTasks()[0]).toMatchObject({ done: true, sub: "Does P1 register as good or evil? · Good" });
    teaTasks()[0]!.alt!();
    expect(facts()).toEqual(["registersEvilToTeaLady"]);
    expect(teaTasks()[0]!.sub).toBe("Does P1 register as good or evil? · Evil");
    const text = JSON.stringify([projectLobbyToPublic(game(), {}), projectLobbyToSelfMap(game(), buildRegistry(script()))]);
    expect(text).not.toMatch(/registersGoodToTeaLady|registersEvilToTeaLady/);
    teaTasks()[0]!.undo();
    expect(facts()).toEqual([]);
    expect(teaTasks()[0]!.done).toBe(false);
    store.getState().undo();
    expect(facts()).toEqual(["registersEvilToTeaLady"]);
    store.getState().undo();
    store.getState().undo();
    expect(game().players).toEqual(before.players);
  });

  it("the decision feeds the CANNOT DIE tokens: none while unknown, both neighbours once the Spy is decided good", () => {
    const ids = dealt(["spy", "tealady", "chef", "recluse", "imp", "empath"]);
    expect(labels(ids[0]!)).not.toContain("Cannot Die");
    expect(labels(ids[2]!)).not.toContain("Cannot Die");
    teaTasks()[0]!.act();
    expect(labels(ids[0]!)).toContain("Cannot Die");
    expect(labels(ids[2]!)).toContain("Cannot Die");
    expect(labels(ids[1]!)).not.toContain("Cannot Die"); // never the Tea Lady herself
    teaTasks()[0]!.alt!();
    expect(labels(ids[0]!)).not.toContain("Cannot Die");
  });
});

describe("Tea Lady CANNOT DIE tokens", () => {
  it("follow life and alignment at once; stay while she is poisoned; go when she dies", () => {
    // Seats: Chef, Tea Lady, Empath, Imp, Recluse
    const ids = dealt(["chef", "tealady", "empath", "imp", "recluse"]);
    expect(labels(ids[0]!)).toEqual(["Cannot Die"]);
    expect(labels(ids[2]!)).toEqual(["Cannot Die"]);
    const patch = (id: string, patchIn: object) => store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...game().players[id]!, ...patchIn } } } });
    patch(ids[2]!, { actualAlignment: "evil" });
    expect(labels(ids[0]!)).toEqual([]);
    patch(ids[2]!, { actualAlignment: "good", alive: false });
    // The Empath is dead: the next alive neighbour is the evil Imp.
    expect(labels(ids[0]!)).toEqual([]);
    patch(ids[2]!, { alive: true });
    patch(ids[1]!, { effects: [{ id: "p", type: "poisoned", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "setup", day: 0 } }] });
    expect(labels(ids[0]!)).toEqual(["Cannot Die"]);
    patch(ids[1]!, { alive: false });
    expect(labels(ids[0]!)).toEqual([]);
  });

  it("is drawn with the Tea Lady's official art like the other derived tokens, and Privacy Mode draws none", () => {
    const ids = dealt(["chef", "tealady", "empath", "imp", "recluse"]);
    const g = game();
    const mark = playerMarks({ game: g, script: script(), registry: buildRegistry(script()), query: createRulesQuery(g, { script: script(), registry: buildRegistry(script()) }) }, g.players[ids[0]!]!)[0]!;
    expect(mark).toMatchObject({ kind: "effect", label: "Cannot Die", title: "Tea Lady: Cannot Die", size: 100, removal: { type: "derived" } });
    expect(mark.src).toMatch(/tealady/);
    const board = () => renderHook(() => useBoardVm(useV6Ctx(game())).vm as Record<string, any>, { wrapper }).result.current;
    const token = (vm: Record<string, any>) => vm.tokens.find((t: any) => t.id === ids[0]);
    expect(token(board()).rems.map((r: any) => r.label)).toContain("Cannot Die");
    usePrivacyStore.setState({ enabled: true });
    expect(token(board()).rems).toEqual([]);
  });
});
