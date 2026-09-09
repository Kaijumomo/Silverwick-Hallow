import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store, migrateStoreState } from "@/stores/storytellerStore";
import { StorytellerGamePersistedSchema, StorytellerStateSchema } from "@/stores/schemas";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { buildRegistry } from "@/data/roleRegistry";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { selectSetupContext } from "./setupContext";
import { analyzeSetup } from "./setupAnalyzer";

beforeEach(() => {
  localStorage.clear();
  store.setState({game:null,lobby:null,undoStack:[],customScripts:{[setupScript.id]:setupScript}});
});
function prepare(pool = false) {
  store.getState().newGame(setupScript.id,{plannedPlayerCount:5,plannedRoles:pool?standardRoles(5):[]});
  for(let i=0;i<5;i++)store.getState().addPlayerToSeat("Player "+i);
  if(!pool)store.getState().game!.seatOrder.forEach((id,i)=>store.getState().assignRole(id,standardRoles(5)[i]!));
}
const state = () => store.getState();
const game = () => state().game!;
const actions = [
  ["manual", ()=>state().beginNightOne()],
  ["advance", ()=>state().advancePhase()],
  ["phase-night", ()=>state().setPhase("night")],
  ["phase-day", ()=>state().setPhase("day")],
] as const;

describe("one setup command gate", () => {
  it("seven planned empty seats cannot deal or start", () => {
    state().newGame(setupScript.id,{plannedPlayerCount:7,plannedRoles:standardRoles(7)});
    const before=state();
    expect(analyzeSetup(selectSetupContext(game(),setupScript)).readiness.deal.ok).toBe(false);
    expect(state().dealRolePool().ok).toBe(false);
    expect(state().advancePhase().ok).toBe(false);
    expect(state()).toBe(before);
  });
  it.each(actions)("%s blocks missing identities with no partial mutation", (_name,run) => {
    prepare();state().assignRole(game().seatOrder[0]!,"");
    const before=state();expect(run().ok).toBe(false);expect(state()).toBe(before);
  });
  it.each(actions)("%s cannot skip an undealt pool", (_name,run) => {
    prepare(true);const before=state();expect(run().ok).toBe(false);expect(state()).toBe(before);
  });
  it.each(actions)("%s uses manual assignments and records starting population", (_name,run) => {
    prepare();expect(run().ok).toBe(true);expect(game().phase).toBe("night");expect(game().day).toBe(1);
    expect(game().startingNonTravelerCount).toBe(5);
  });
  it("deals ordinary actual roles and records the reconciled population", () => {
    prepare(true);expect(state().dealRolePool().ok).toBe(true);
    expect(game().rolePool).toEqual([]);expect(game().startingNonTravelerCount).toBe(5);
    expect(Object.values(game().players).map(p=>p.actualRole).sort()).toEqual(standardRoles(5).sort());
  });
  it("execution rejects stale UI readiness", () => {
    prepare(true);
    const command=state().dealRolePool;
    expect(analyzeSetup(selectSetupContext(game(),setupScript)).readiness.deal.ok).toBe(true);
    state().unseatPlayer(game().seatOrder[0]!);
    const before=state();expect(command().ok).toBe(false);expect(state()).toBe(before);
  });
  it("unknown pooled roles fail before shuffling or replacing identities", () => {
    prepare();state().setRolePool(["unknown",...standardRoles(5).slice(1)]);
    const before=state();expect(state().dealRolePool().ok).toBe(false);expect(state()).toBe(before);
  });
  it("clearing the pool enables a completed manual workflow", () => {
    prepare();state().setRolePool(standardRoles(5));expect(state().beginNightOne().ok).toBe(false);
    state().setRolePool([]);expect(state().beginNightOne().ok).toBe(true);
  });
  it("warnings and Storyteller checks never act as rule vetoes", () => {
    prepare();state().assignRole(game().seatOrder[0]!,"atheist");state().setLorics(["tor","gardener"]);
    expect(state().beginNightOne().ok).toBe(true);
  });
  it("Undo does not bypass readiness for an invalid live snapshot", () => {
    prepare();const invalid={...game(),phase:"night" as const,rolePool:standardRoles(5)};
    store.setState({undoStack:[invalid]});const before=state();state().undo();expect(state()).toBe(before);
  });
  it("an ended intermediate phase cannot bypass setup readiness", () => {
    state().newGame(setupScript.id, { plannedPlayerCount: 5 });
    state().setPhase("ended");
    const before = state();
    expect(state().setPhase("night").ok).toBe(false);
    expect(state().setPhase("day").ok).toBe(false);
    expect(state().setPhase("setup").ok).toBe(false);
    expect(state()).toBe(before);
  });
  it("dealing can safely replace stale ordinary actual and shown definitions", () => {
    prepare(true);
    const id = game().seatOrder[0]!;
    store.setState({ game: { ...game(), players: { ...game().players,
      [id]: { ...game().players[id]!, actualRole: "old-role", shownRole: "old-perception" } } } });
    expect(state().dealRolePool().ok).toBe(true);
    expect(game().players[id]!.shownRole).not.toBe("old-perception");
    expect(Object.values(game().players).every(p => !!buildRegistry(setupScript).get(p.shownRole!))).toBe(true);
  });
  it("Undo of a successful start restores planning without a made-up baseline", () => {
    prepare();state().beginNightOne();state().undo();
    expect(game().phase).toBe("setup");expect(game().startingNonTravelerCount).toBeUndefined();
  });
});

describe("population and persisted history", () => {
  it.each(["add","fill","empty","remove-empty","remove-player","unseat","traveler","queue","membership"] as const)(
    "%s never silently rewrites the target", kind => {
      prepare();
      if(kind==="add")state().addPlayer("Extra");
      if(kind==="empty"||kind==="remove-empty") {state().addEmptySeat();if(kind==="remove-empty")state().removePlayer(game().seatOrder.at(-1)!);}
      if(kind==="fill"){state().unseatPlayer(game().seatOrder[0]!);state().addPlayerToSeat("Replacement");}
      if(kind==="remove-player")state().removePlayer(game().seatOrder[0]!);
      if(kind==="unseat")state().unseatPlayer(game().seatOrder[0]!);
      if(kind==="traveler") {state().addPlayer("Traveler");state().setIsTraveler(game().seatOrder.at(-1)!,true);}
      if(kind==="queue")state().addToPendingQueue("uid","Waiting");
      if(kind==="membership"){state().unseatPlayer(game().seatOrder[0]!);state().addToPendingQueue("uid","Joined");state().assignPendingToSeat("uid",game().seatOrder[0]!);}
      expect(game().plannedPlayerCount).toBe(5);
    });
  it("explicit target action is required and has no seat side effects", () => {
    prepare();const seats=[...game().seatOrder];state().setPlannedPlayerCount(6);
    expect(game().plannedPlayerCount).toBe(6);expect(game().seatOrder).toEqual(seats);
  });
  it("presence/reconnect does not alter setup population", () => {
    prepare();const before=selectSetupContext(game(),setupScript).population;
    state().setLobby({code:"ABCD2345",uid:"st",status:"live"});state().setLobbyStatus("reconnecting");
    expect(selectSetupContext(game(),setupScript).population).toEqual(before);
  });
  it("starting count survives attendance changes and phase advancement", () => {
    prepare();state().beginNightOne();state().removePlayer(game().seatOrder[0]!);state().advancePhase();
    expect(game().startingNonTravelerCount).toBe(5);expect(game().plannedPlayerCount).toBe(5);
  });
  it("starting count survives revisiting setup", () => {
    prepare();state().beginNightOne();state().setPhase("setup");
    state().removePlayer(game().seatOrder[0]!);state().setPlannedPlayerCount(4);state().beginNightOne();
    expect(game().startingNonTravelerCount).toBe(5);
  });
  it("legacy running history stays unknown even after returning to setup", () => {
    store.setState({game:setupGame(standardRoles(5),{phase:"day",day:3})});
    state().setPhase("setup");state().beginNightOne();expect(game().startingNonTravelerCount).toBeUndefined();
    expect(Object.hasOwn(game(), "startingNonTravelerCount")).toBe(false);
  });
  it("legacy re-deal omits unknown history rather than writing undefined to Firebase", () => {
    store.setState({ game: setupGame(standardRoles(5), { phase: "setup", day: 3, rolePool: standardRoles(5) }) });
    expect(state().dealRolePool().ok).toBe(true);
    expect(Object.hasOwn(game(), "startingNonTravelerCount")).toBe(false);
  });
  it("corrupt v9 undo entries are rejected by schema without throwing in migration", () => {
    expect(() => migrateStoreState({ game: setupGame(), undoStack: [null] }, 9)).not.toThrow();
    expect(migrateStoreState({ game: setupGame(), undoStack: [null] }, 9)).toMatchObject({ game: null });
  });
  it("legacy migration leaves target zero and running baseline unknown, including undo", () => {
    const legacy=setupGame(standardRoles(5),{plannedPlayerCount:0,phase:"night",day:2});
    const migrated=StorytellerStateSchema.parse(migrateStoreState({game:legacy,undoStack:[legacy]},9));
    expect(migrated.game!.plannedPlayerCount).toBe(0);
    expect(migrated.game!.startingNonTravelerCount).toBeUndefined();
    expect(migrated.undoStack![0]!.startingNonTravelerCount).toBeUndefined();
  });
  it("current local persistence and checkpoint schema preserve starting count", async () => {
    prepare();state().beginNightOne();
    const saved=localStorage.getItem("new-blood-st")!;
    expect(JSON.parse(saved).version).toBe(11);
    store.setState({game:null});localStorage.setItem("new-blood-st",saved);
    await store.persist.rehydrate();expect(game().startingNonTravelerCount).toBe(5);
    const checkpoint=JSON.parse(JSON.stringify({game:game(),roster:{}}));
    expect(StorytellerGamePersistedSchema.parse(checkpoint.game).startingNonTravelerCount).toBe(5);
  });
  it("starting setup fact never enters public/self projections", () => {
    prepare();state().beginNightOne();
    const publicData=projectLobbyToPublic(game(),{});
    const self=projectLobbyToSelfMap(game(),buildRegistry(setupScript));
    for(const data of [publicData,self])expect(JSON.stringify(data)).not.toContain("startingNonTravelerCount");
  });
});
