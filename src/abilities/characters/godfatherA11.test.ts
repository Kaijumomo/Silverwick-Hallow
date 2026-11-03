// F-24 / T30-A11: executing an Outsider by the app's own command lets the Godfather kill that night, with no hand-placed "Died Today" reminder.
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { patchPlayer, pick, plan, planned, proofGame, proofScript, request } from "@/test/proofFixtures";

// p0 godfather, p1 drunk (an Outsider), p2 chef, p3 monk, p4 imp, p5 saint, p6 poisoner
const ROLES = ["godfather", "drunk", "chef", "monk", "imp", "saint", "poisoner"];
const game = () => store.getState().game!;
beforeEach(() => {
  store.setState({ game: proofGame(ROLES, "day", 2), lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
});
const toNight = () => { const r = store.getState().advancePhase(); expect(r.ok).toBe(true); };
const godfatherPlan = (target: string) => plan(game(), request(game(), "p0", "godfather", { target: pick(game(), target) }));

describe("Godfather after an execution (A11)", () => {
  it("an executed Outsider (recorded as an execution, not as a reminder) lets the Godfather kill that night", () => {
    expect(store.getState().recordExecution("p1", "died").ok).toBe(true);
    toNight();
    expect(game().players.p0!.reminders).toEqual([]);
    expect(game().players.p1!.reminders).toEqual([]);
    const next = planned(godfatherPlan("p2"));
    expect(next.players.p2!.alive).toBe(false);
  });

  it("a Townsfolk execution, or an Outsider who survived it, gives the Godfather nothing to do", () => {
    store.getState().recordExecution("p2", "died"); toNight();
    expect(godfatherPlan("p3")).toMatchObject({ ok: false, code: "notApplicable" });
    store.setState({ game: proofGame(ROLES, "day", 2), undoStack: [] });
    store.getState().recordExecution("p1", "survived"); toNight();
    expect(godfatherPlan("p3")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("Undo of the execution takes the kill away again", () => {
    store.getState().recordExecution("p1", "died");
    store.getState().undo();
    expect(game().players.p1!.alive).toBe(true);
    toNight();
    expect(godfatherPlan("p2")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("a Recluse dying in the Day is the Storyteller's call, never guessed", () => {
    store.setState({ game: patchPlayer(proofGame(["godfather", "recluse", "chef", "monk", "imp", "saint", "poisoner"], "day", 2), "p1", {}), undoStack: [] });
    store.getState().recordExecution("p1", "died"); toNight();
    expect(godfatherPlan("p2")).toMatchObject({ ok: false, code: "unsupported" });
  });
});
