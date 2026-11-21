// SV-4b: the Storyteller's own execution from a seat's menu (the Cerenovus's penalty and the Mutant's "at any time").
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { CERENOVUS_CHARACTER, CERENOVUS_TARGET } from "@/abilities/characters/cerenovus";
import { patchPlayer, impair, openInStore, pick, plan, planned, proofGame, request } from "@/test/proofFixtures";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { executionsAt } from "@/stores/lifeEvents";
import { useV6Ctx } from "../ctx";
import { useV6Ui } from "../v6Store";
import { executeOffered, nightExecutionWarning, runExecute } from "./madnessExecution";
import { dayHasExecution } from "./advance";
import type { StorytellerLobbyRecord } from "@/stores/types";

// p0 cerenovus, p1 imp, p2 chef, p3 saint, p4 fool, p5 monk, p6 empath
const ROLES = ["cerenovus", "imp", "chef", "saint", "fool", "monk", "empath"];
const wrapper = ({ children }: { children: ReactNode }) => <VotingProvider>{children}</VotingProvider>;
const game = () => store.getState().game!;
const mount = () => renderHook(() => { const g = store((s) => s.game)!; return useV6Ctx(g); }, { wrapper });

/** A game where the Cerenovus (p0) made `mad` mad about being `roleId` on Night 2, then at `phase`. */
function madGame(targets: string[], phase: "night" | "day", roles = ROLES) {
  let g = proofGame(roles, "night", 2);
  for (const target of targets) {
    // The step is reset between picks so one Cerenovus can madden several players in one test game.
    g = { ...g, nightProgress: {} };
    g = planned(plan(g, request(g, "p0", "cerenovus", { [CERENOVUS_TARGET]: pick(g, target), [CERENOVUS_CHARACTER]: { kind: "character", roleIds: ["sage"] } }, { withStep: true, completeStep: true })));
  }
  openInStore({ ...g, phase });
}
const run = async (id: string) => { const m = mount(); await act(async () => { await runExecute(m.result.current, game().players[id]!); }); return m; };
const answer = async (which: "run" | "alt" | "cancel") => {
  const ask = useV6Ui.getState().ask!;
  await act(async () => { which === "run" ? ask.run("") : which === "alt" ? ask.alt!.run() : ask.cancel!(); useV6Ui.getState().set({ ask: null }); });
};
const settle = () => act(async () => { await Promise.resolve(); });
const today = () => { const r = executionsAt(game(), { phase: "day", day: game().day }); return r.status === "known" ? r.events : r.recorded; };

beforeEach(() => { useShellStore.getState().resetGameScope(); usePrivacyStore.getState().setEnabled(false); useV6Ui.getState().reset(); });

describe("SV-4b: when Execute is offered", () => {
  it("only on the mad player, in the Day and at night, and never on anybody else", () => {
    for (const phase of ["day", "night"] as const) {
      madGame(["p2"], phase);
      const ctx = mount().result.current;
      expect(executeOffered(ctx, game().players.p2)).toBe(true);
      for (const id of ["p0", "p1", "p3", "p4", "p5", "p6"]) expect(executeOffered(ctx, game().players[id]), `${phase} ${id}`).toBe(false);
    }
  });

  it("not once the MAD has ended, and not when it is known not to apply (its Cerenovus is impaired); a Vigormortis-style hand-placed MAD stays a notation", () => {
    madGame(["p2"], "day");
    const mad = game().players.p2!.effects.find((e) => e.type === "mad")!;
    // Ended MAD leaves the seat (expiry removes it); a suppressed one is not live either.
    store.setState({ game: patchPlayer(game(), "p2", { effects: [{ ...mad, state: "suppressed" }] }) });
    expect(executeOffered(mount().result.current, game().players.p2)).toBe(false);
    store.setState({ game: patchPlayer(game(), "p2", { effects: [] }) });
    expect(executeOffered(mount().result.current, game().players.p2)).toBe(false);
    madGame(["p2"], "day");
    store.setState({ game: impair(game(), "p0", "drunk") });
    expect(executeOffered(mount().result.current, game().players.p2)).toBe(false);
    // A MAD reminder placed by hand carries no Effect: nothing is offered.
    store.setState({ game: proofGame(ROLES, "day", 2) });
    expect(executeOffered(mount().result.current, game().players.p2)).toBe(false);
  });

  it("a dead mad player can be executed in the Day (already dead) but not at night; Privacy Mode and an ended game offer nothing", () => {
    madGame(["p2"], "day");
    store.setState({ game: patchPlayer(game(), "p2", { alive: false }) });
    expect(executeOffered(mount().result.current, game().players.p2)).toBe(true);
    store.setState({ game: { ...game(), phase: "night" } });
    expect(executeOffered(mount().result.current, game().players.p2)).toBe(false);
    store.setState({ game: { ...game(), phase: "day" } });
    usePrivacyStore.getState().setEnabled(true);
    expect(executeOffered(mount().result.current, game().players.p2)).toBe(false);
    usePrivacyStore.getState().setEnabled(false);
    store.setState({ game: { ...game(), phase: "ended" } });
    expect(executeOffered(mount().result.current, game().players.p2)).toBe(false);
  });

  it("the Mutant: offered on a living Mutant in the Day and at night, not on a dead one", () => {
    const roles = ["mutant", "imp", "chef", "empath"];
    for (const phase of ["day", "night"] as const) {
      openInStore(proofGame(roles, phase, 2));
      expect(executeOffered(mount().result.current, game().players.p0)).toBe(true);
      expect(executeOffered(mount().result.current, game().players.p2)).toBe(false);
    }
    store.setState({ game: patchPlayer(game(), "p0", { alive: false }) });
    expect(executeOffered(mount().result.current, game().players.p0)).toBe(false);
  });
});

describe("SV-4b: Execute in the Day", () => {
  it("records one execution (died) through the ordinary command, with no question when nothing prevents it; the day then has its execution; Undo reverses it in one step", async () => {
    madGame(["p2"], "day");
    const undoBefore = store.getState().undoStack.length;
    await run("p2");
    expect(useV6Ui.getState().ask).toBeNull();
    expect(game().players.p2).toMatchObject({ alive: false });
    expect(today()).toEqual([expect.objectContaining({ kind: "execution", outcome: "died", actualRoleAtEvent: "chef" })]);
    expect(dayHasExecution(game())).toBe(true);
    expect(useV6Ui.getState().toast).toMatch(/is executed\. Begin the night when ready/);
    expect(store.getState().undoStack.length).toBe(undoBefore + 1);
    act(() => { store.getState().undo(); });
    expect(game().players.p2!.alive).toBe(true);
    expect(today()).toEqual([]);
  });

  it("a mad Saint is executed like any execution (the same event as the Day's Execute)", async () => {
    madGame(["p3"], "day");
    await run("p3");
    expect(game().players.p3!.alive).toBe(false);
    expect(today()).toEqual([expect.objectContaining({ kind: "execution", outcome: "died", actualRoleAtEvent: "saint" })]);
  });

  it("a Fool with the ability unused is asked the existing question; surviving uses the ability up in the same step", async () => {
    madGame(["p4"], "day");
    const pending = run("p4");
    await settle();
    expect(useV6Ui.getState().ask).toMatchObject({ title: "Did Player 4 die?", okText: "Yes · died", alt: { text: "No · survived" } });
    expect(useV6Ui.getState().ask!.body).toMatch(/Fool/);
    await answer("alt");
    await pending;
    expect(game().players.p4).toMatchObject({ alive: true, abilityUsed: true });
    expect(today()).toEqual([expect.objectContaining({ kind: "execution", outcome: "survived" })]);
    expect(useV6Ui.getState().toast).toMatch(/survives the execution/);
    act(() => { store.getState().undo(); });
    expect(game().players.p4).toMatchObject({ alive: true, abilityUsed: false });
    expect(today()).toEqual([]);
  });

  it("answering the Fool's question 'died' records the death; dismissing it records nothing", async () => {
    madGame(["p4"], "day");
    let pending = run("p4");
    await settle();
    await answer("cancel");
    await pending;
    expect(today()).toEqual([]);
    expect(game().players.p4!.alive).toBe(true);
    pending = run("p4");
    await settle();
    await answer("run");
    await pending;
    expect(game().players.p4!.alive).toBe(false);
    expect(today()).toEqual([expect.objectContaining({ outcome: "died" })]);
  });

  it("a dead mad player is recorded as already dead", async () => {
    madGame(["p2"], "day");
    store.setState({ game: patchPlayer(game(), "p2", { alive: false }) });
    await run("p2");
    expect(today()).toEqual([expect.objectContaining({ kind: "execution", outcome: "alreadyDead" })]);
    expect(useV6Ui.getState().toast).toMatch(/already dead/);
  });

  it("a second execution that Day asks the existing 'additional execution' confirmation, and is recorded only when he agrees", async () => {
    madGame(["p2", "p3"], "day");
    await run("p2");
    expect(today()).toHaveLength(1);
    let pending = run("p3");
    await settle();
    expect(useV6Ui.getState().ask).toMatchObject({ title: "Confirm", body: expect.stringContaining("An execution is already recorded for Day 2") });
    await answer("cancel");
    await pending;
    expect(today()).toHaveLength(1);
    expect(game().players.p3!.alive).toBe(true);
    pending = run("p3");
    await settle();
    await answer("run");
    await pending;
    expect(today()).toHaveLength(2);
    expect(game().players.p3!.alive).toBe(false);
  });

  it("a second execution of a Fool that survives still uses the ability up, in the same step", async () => {
    madGame(["p2", "p4"], "day");
    await run("p2");
    const pending = run("p4");
    await settle();
    await answer("alt"); // Did Player 4 die? No
    await settle();
    await answer("run"); // Record an additional execution? Yes
    await pending;
    expect(game().players.p4).toMatchObject({ alive: true, abilityUsed: true });
    expect(today()).toHaveLength(2);
    act(() => { store.getState().undo(); });
    expect(game().players.p4).toMatchObject({ alive: true, abilityUsed: false });
    expect(today()).toHaveLength(1);
  });

  it("refuses a stale seat: the occupant changed before the command ran", async () => {
    madGame(["p2"], "day");
    const m = mount();
    const stale = { ...game().players.p2!, participantId: "someone-else" };
    await act(async () => { await runExecute(m.result.current, stale); });
    expect(today()).toEqual([]);
    expect(useV6Ui.getState().toast).toMatch(/player changed/);
  });

  it("the Mutant is executed the same way", async () => {
    openInStore(proofGame(["mutant", "imp", "chef", "empath"], "day", 2));
    await run("p0");
    expect(today()).toEqual([expect.objectContaining({ kind: "execution", outcome: "died", actualRoleAtEvent: "mutant" })]);
  });
});

describe("SV-4b: Execute at night", () => {
  it("is an ordinary death: no execution is recorded and the Day's execution stays free", async () => {
    madGame(["p2"], "night");
    await run("p2");
    const g: StorytellerLobbyRecord = game();
    expect(g.players.p2!.alive).toBe(false);
    expect(g.lifeEventWindow.events.filter((e) => e.kind === "execution")).toEqual([]);
    expect(g.lifeEventWindow.events.filter((e) => e.kind === "death" && e.subject.playerId === "p2")).toHaveLength(1);
    expect(useV6Ui.getState().toast).toMatch(/executed at night: recorded as a death\. Today's execution is still free\./);
    expect(useV6Ui.getState().toast).not.toMatch(/Saint/);
    act(() => { store.getState().undo(); });
    expect(game().players.p2!.alive).toBe(true);
  });

  it("a Saint gets one reminder line, because an ordinary death carries no execution evidence", async () => {
    madGame(["p3"], "night");
    await run("p3");
    expect(game().players.p3!.alive).toBe(false);
    expect(useV6Ui.getState().toast).toContain("Player 3 is the Saint: an execution may end the game. Check before ending.");
    expect(nightExecutionWarning(game().players.p3!)).toMatch(/Saint/);
    expect(nightExecutionWarning(game().players.p2!)).toBeNull();
  });

  it("the Mutant at night: a death, with today's execution untouched", async () => {
    openInStore(proofGame(["mutant", "imp", "chef", "empath"], "night", 3));
    await run("p0");
    expect(game().players.p0!.alive).toBe(false);
    expect(game().lifeEventWindow.events.filter((e) => e.kind === "execution")).toEqual([]);
  });
});
