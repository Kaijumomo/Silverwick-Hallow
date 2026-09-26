import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStorytellerStore as store, migrateStoreState } from "@/stores/storytellerStore";
import { StorytellerGamePersistedSchema, StorytellerStateSchema } from "@/stores/schemas";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { buildRegistry } from "@/data/roleRegistry";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { selectSetupContext } from "./setupContext";
import { analyzeSetup } from "./setupAnalyzer";
import { initialRevealReadiness } from "./revealReadiness";

beforeEach(() => {
  localStorage.clear();
  store.setState({game:null,lobby:null,undoStack:[],customScripts:{[setupScript.id]:setupScript}});
});
// pool=false manually assigns every ordinary role with no deal ever run —
// there is no manual initial-assignment workflow, so this fixture proves the
// begin gate blocks it, never that it succeeds. Use dealt() for a genuinely
// ready-to-begin game.
function prepare(pool = false) {
  store.getState().newGame(setupScript.id,{plannedPlayerCount:5,plannedRoles:pool?standardRoles(5):[]});
  for(let i=0;i<5;i++)store.getState().addPlayerToSeat("Player "+i);
  if(!pool)store.getState().game!.seatOrder.forEach((id,i)=>{
    store.getState().assignRole(id,standardRoles(5)[i]!);
    // Manual assignment leaves perception unconfigured (assignRole never
    // seeds shownRole) — a "ready" manual fixture must explicitly reveal it,
    // just as a Storyteller would before Night 1 (Phase 9C.4).
    store.getState().showAssignedRole(id);
  });
}
// The only supported route to a begin-ready fresh Day-0 game: pool it, run
// the real randomized deal, then explicitly reveal (standardRoles(5) never
// contains a concealed role, so reveal always succeeds immediately here).
function dealt() {
  prepare(true);
  store.getState().dealRolePool();
  store.getState().revealRoles();
}
const state = () => store.getState();
const game = () => state().game!;
const actions = [
  ["begin", ()=>state().beginNightOne()],
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
    dealt();state().assignRole(game().seatOrder[0]!,"");
    const before=state();expect(run().ok).toBe(false);expect(state()).toBe(before);
  });
  it.each(actions)("%s cannot skip an undealt pool", (_name,run) => {
    prepare(true);const before=state();expect(run().ok).toBe(false);expect(state()).toBe(before);
  });
  // Proof A (required behavior): a fresh Day-0 game cannot begin Night 1 from
  // manual assignment alone, however completely it is otherwise configured —
  // and none of these entry points may bypass that.
  it.each(actions)("%s blocks a fully manually-assigned fresh setup with no randomized deal", (_name,run) => {
    prepare();const before=state();expect(run().ok).toBe(false);expect(state()).toBe(before);
    expect(game().phase).toBe("setup");
  });
  // Proof B: the same population, reached via the real deal, succeeds through
  // every one of those entry points and still records the starting population.
  it.each(actions)("%s succeeds once the initial randomized deal has completed", (_name,run) => {
    dealt();expect(run().ok).toBe(true);expect(game().phase).toBe("night");expect(game().day).toBe(1);
    expect(game().startingNonTravelerCount).toBe(5);
  });
  it("deals ordinary roles, then records the starting population only when night begins", () => {
    prepare(true);expect(state().dealRolePool().ok).toBe(true);
    expect(game().rolePool).toEqual([]);expect(game().startingNonTravelerCount).toBeUndefined();
    expect(game().phase).toBe("setup");expect(game().day).toBe(0);expect(game().setupRolesDealt).toBe(true);
    expect(game().setupRolesRevealed).toBe(false);
    expect(Object.values(game().players).map(p=>p.actualRole).sort()).toEqual(standardRoles(5).sort());
    // Deal does not imply Reveal.
    expect(state().beginNightOne().ok).toBe(false);
    expect(state().revealRoles().ok).toBe(true);expect(game().setupRolesRevealed).toBe(true);
    expect(state().beginNightOne().ok).toBe(true);expect(game().startingNonTravelerCount).toBe(5);
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
  // Proof E: clearing the pool must never fabricate a deal that never happened.
  it("clearing the pool does not fabricate a deal for manually assigned roles", () => {
    prepare();state().setRolePool(standardRoles(5));expect(state().beginNightOne().ok).toBe(false);
    state().setRolePool([]);expect(state().beginNightOne().ok).toBe(false);
    expect(game().phase).toBe("setup");
  });
  // Proof C: a post-deal manual correction to one seat still allows Night 1.
  it("warnings and Storyteller checks never act as rule vetoes", () => {
    dealt();state().assignRole(game().seatOrder[0]!,"atheist");state().setLorics(["tor","gardener"]);
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
    dealt();expect(state().beginNightOne().ok).toBe(true);state().undo();
    expect(game().phase).toBe("setup");expect(game().startingNonTravelerCount).toBeUndefined();
  });
});

describe("Phase 9C.4 (OPUS-004) — concealed-perception readiness gate", () => {
  // standardRoles(6) includes exactly one concealed role (the outsider slot
  // is "drunk"), giving a real dealt pool that reproduces the negative-space
  // scenario: everyone else gets a role card, the Drunk gets none.
  function prepareConcealed() {
    store.getState().newGame(setupScript.id, { plannedPlayerCount: 6, plannedRoles: standardRoles(6) });
    for (let i = 0; i < 6; i++) store.getState().addPlayerToSeat("Player " + i);
  }
  const drunkId = () => Object.values(game().players).find(p => p.actualRole === "drunk")!.id;

  it("1: dealRolePool() remains allowed when the pool contains a concealed role", () => {
    prepareConcealed();
    expect(state().dealRolePool().ok).toBe(true);
    expect(game().setupRolesDealt).toBe(true);
    // P: any legitimate fresh initial deal resets Reveal to false.
    expect(game().setupRolesRevealed).toBe(false);
    expect(game().players[drunkId()]!.actualRole).toBe("drunk");
  });

  it("2: immediately after dealing, the concealed player's perception is unset and beginNightOne/revealRoles are blocked", () => {
    prepareConcealed();
    state().dealRolePool();
    expect(game().players[drunkId()]!.shownRole).toBeNull();
    const ready = analyzeSetup(selectSetupContext(game(), setupScript)).readiness.begin;
    expect(ready.ok).toBe(false);
    expect(initialRevealReadiness(selectSetupContext(game(), setupScript)).ready).toBe(false);
    expect(state().revealRoles().ok).toBe(false);
    expect(state().beginNightOne().ok).toBe(false);
    expect(game().phase).toBe("setup");
  });

  it("3-4: configuring the concealed shown identity makes it reveal-ready, but only explicit Reveal completes the ordinary self map and allows Night 1", () => {
    prepareConcealed();
    state().dealRolePool();
    state().setShownRole(drunkId(), "chef");
    // Configured but not yet revealed: still private (Deal does not imply Reveal).
    expect(projectLobbyToSelfMap(game(), buildRegistry(setupScript))).toEqual({});
    expect(initialRevealReadiness(selectSetupContext(game(), setupScript)).ready).toBe(true);
    expect(state().beginNightOne().ok).toBe(false);
    expect(state().revealRoles().ok).toBe(true);
    expect(Object.keys(projectLobbyToSelfMap(game(), buildRegistry(setupScript))).sort())
      .toEqual([...game().seatOrder].sort());
    expect(state().beginNightOne().ok).toBe(true);
    expect(game().phase).toBe("night");
  });

  it("5: an unconfigured Traveler stays a nonblocking Storyteller check, never the ordinary Reveal/publication blocker", () => {
    prepareConcealed();
    state().dealRolePool();
    state().setShownRole(drunkId(), "chef"); // ordinary set fully configured
    state().addPlayer("Traveler");
    const travelerId = game().seatOrder.at(-1)!;
    state().setIsTraveler(travelerId, true);
    state().assignRole(travelerId, "thief");
    state().setShownRole(travelerId, null); // simulate unconfigured Traveler perception
    state().setTravelerAlignment(travelerId, "good"); // isolates this test to perception, not B4's alignment gate
    const findings = analyzeSetup(selectSetupContext(game(), setupScript)).findings;
    expect(findings.find(f => f.code === "missing-perception:traveler")).toMatchObject({ severity: "check" });
    expect(findings.some(f => f.code === "missing-perception:ordinary")).toBe(false);
    expect(state().revealRoles().ok).toBe(true);
    expect(state().beginNightOne().ok).toBe(true);
  });

  it.each(actions)("6-7: %s cannot bypass the concealed-perception blocker", (_name, run) => {
    prepareConcealed();
    state().dealRolePool();
    const before = state();
    expect(run().ok).toBe(false);
    expect(state()).toBe(before);
    expect(game().phase).toBe("setup");
  });

  it("8: a blocked start attempt leaves nothing for undo to bypass into Night 1", () => {
    prepareConcealed();
    state().dealRolePool();
    const beforeAttempt = state();
    expect(state().beginNightOne().ok).toBe(false);
    expect(state()).toBe(beforeAttempt); // the failed attempt itself never mutated state, so nothing was pushed for it
    state().undo();
    // undo() unwinds the last successful command (the deal) — never anything
    // resembling a bypassed Night 1, since the blocked attempt never ran.
    expect(game().phase).toBe("setup");
    expect(game().setupRolesDealt).toBeUndefined();
  });
});

describe("population and persisted history", () => {
  it("random dealing still shuffles the selected pool", () => {
    prepare(true);
    const random=vi.spyOn(Math,"random").mockReturnValue(0);
    try {
      expect(state().dealRolePool().ok).toBe(true);
      const roles=standardRoles(5);
      expect(game().seatOrder.map(id=>game().players[id]!.actualRole)).toEqual([...roles.slice(1),roles[0]]);
      expect(random).toHaveBeenCalledTimes(4);
    } finally {random.mockRestore();}
  });
  it("the dealt-but-not-revealed preparation step survives local reload and private checkpoint decoding", async () => {
    prepare(true);state().dealRolePool();
    expect(game().setupRolesRevealed).toBe(false);
    const saved=localStorage.getItem("new-blood-st")!;
    expect(JSON.parse(saved).version).toBe(20);
    store.setState({game:null});localStorage.setItem("new-blood-st",saved);await store.persist.rehydrate();
    expect(game()).toMatchObject({phase:"setup",day:0,setupRolesDealt:true,setupRolesRevealed:false});
    expect(StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(game()))).setupRolesDealt).toBe(true);
    for(const data of [projectLobbyToPublic(game(),{}),projectLobbyToSelfMap(game(),buildRegistry(setupScript))])
      expect(JSON.stringify(data)).not.toContain("setupRolesDealt");
  });
  it("the revealed preparation step survives local reload and private checkpoint decoding", async () => {
    dealt();
    expect(game().setupRolesRevealed).toBe(true);
    const saved=localStorage.getItem("new-blood-st")!;
    store.setState({game:null});localStorage.setItem("new-blood-st",saved);await store.persist.rehydrate();
    expect(game()).toMatchObject({phase:"setup",setupRolesDealt:true,setupRolesRevealed:true});
    expect(StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(game()))).setupRolesRevealed).toBe(true);
  });
  it("undo restores each preparation step without inventing deal history", () => {
    prepare(true);state().dealRolePool();state().revealRoles();state().beginNightOne();state().undo();
    expect(game()).toMatchObject({phase:"setup",setupRolesDealt:true,setupRolesRevealed:true});
    state().undo();
    expect(game()).toMatchObject({phase:"setup",setupRolesDealt:true,setupRolesRevealed:false});
    state().undo();expect(game().setupRolesDealt).toBeUndefined();expect(game().rolePool).toEqual(standardRoles(5));
  });
  it("a replacement pool reopens preparation while clearing a pool never fabricates a deal", () => {
    prepare(true);state().setRolePool([]);expect(game().setupRolesDealt).not.toBe(true);
    state().setRolePool(standardRoles(5));state().dealRolePool();state().setRolePool(standardRoles(5));
    expect(game().setupRolesDealt).toBe(false);expect(state().beginNightOne().ok).toBe(false);
  });
  it("legacy setup does not gain a made-up deal or reveal marker", () => {
    const legacy=StorytellerGamePersistedSchema.parse(setupGame());
    expect(Object.hasOwn(legacy,"setupRolesDealt")).toBe(false);
    expect(Object.hasOwn(legacy,"setupRolesRevealed")).toBe(false);
  });
  // FINAL SETUP INTEGRATION REVISION, Section 3 / FINAL POPULATION CLOSURE,
  // Section 1: filling an already-planned seat, or a reservation that stays
  // behind (unseat), never rewrites the plan -- but a deliberate new
  // participant or an added/removed seat (empty or occupied) genuinely
  // does, precisely because the physical population and the starting plan
  // must never be allowed to silently diverge (superseding this test's own
  // former "never rewrites" name for those cases). "remove-empty" adds then
  // removes the exact same seat, netting to zero change.
  it.each([
    ["add", 6], ["fill", 5], ["empty", 6], ["remove-empty", 5], ["remove-player", 4],
    ["unseat", 5], ["traveler", 6], ["queue", 5], ["membership", 5],
  ] as const)("%s ends at the correct planned total", (kind, expected) => {
      prepare();
      if(kind==="add")state().addPlayer("Extra");
      if(kind==="empty"||kind==="remove-empty") {state().addEmptySeat();if(kind==="remove-empty")state().removePlayer(game().seatOrder.at(-1)!);}
      if(kind==="fill"){state().unseatPlayer(game().seatOrder[0]!);state().addPlayerToSeat("Replacement");}
      if(kind==="remove-player")state().removePlayer(game().seatOrder[0]!);
      if(kind==="unseat")state().unseatPlayer(game().seatOrder[0]!);
      if(kind==="traveler") {state().addPlayer("Traveler");state().setIsTraveler(game().seatOrder.at(-1)!,true);}
      if(kind==="queue")state().addToPendingQueue("uid","Waiting");
      if(kind==="membership"){state().unseatPlayer(game().seatOrder[0]!);state().addToPendingQueue("uid","Joined");state().assignPendingToSeat("uid",game().seatOrder[0]!);}
      expect(game().plannedPlayerCount).toBe(expected);
    });
  // FINAL SEAT & TRAVELLER RESERVATION CLOSURE, Section 1: once starting
  // seat structure exists, setPlannedPlayerCount is refused entirely --
  // superseding this test's own former "explicit target action" premise,
  // which is exactly the standalone-numeric-edit bypass now closed. New
  // Game is the sole initial planner; afterward only Add Seat/Remove
  // Seat/Add Traveller (always in lockstep with physical seats) may change
  // the plan.
  it("setPlannedPlayerCount is refused once starting seat structure exists, and never has seat side effects either way", () => {
    prepare();const seats=[...game().seatOrder];const before=state();
    state().setPlannedPlayerCount(6);
    expect(state()).toBe(before); // no mutation at all
    expect(game().plannedPlayerCount).toBe(5);expect(game().seatOrder).toEqual(seats);
  });
  it("presence/reconnect does not alter setup population", () => {
    prepare();const before=selectSetupContext(game(),setupScript).population;
    state().setLobby({code:"ABCD2345",uid:"st",status:"live"});state().setLobbyStatus("reconnecting");
    expect(selectSetupContext(game(),setupScript).population).toEqual(before);
  });
  it("starting count survives attendance changes and phase advancement", () => {
    dealt();state().beginNightOne();state().removePlayer(game().seatOrder[0]!);state().advancePhase();
    expect(game().startingNonTravelerCount).toBe(5);expect(game().plannedPlayerCount).toBe(5);
  });
  it("starting count survives an attempted return to setup", () => {
    // Phase 10A (10A-LUNA-RV-001): a live game can no longer be moved back
    // to Setup, so it cannot be "restarted" either; the count stays frozen.
    dealt();state().beginNightOne();
    expect(state().setPhase("setup")).toEqual({ ok: false, message: "Setup is only available before live play begins." });
    state().removePlayer(game().seatOrder[0]!);state().setPlannedPlayerCount(4);state().advancePhase();
    expect(game().phase).toBe("day");
    expect(game().startingNonTravelerCount).toBe(5);
  });
  // Proof F: a genuinely running/legacy game (day > 0, no setupRolesDealt
  // marker at all) returning to Setup must remain usable — day > 0 is trusted
  // evidence an initial deal already happened, without inventing one.
  it("legacy running history stays unknown even after returning to setup", () => {
    // Phase 10A (10A-LUNA-RV-001): the phase API no longer moves a live game
    // back to Setup, so the legacy "returned to Setup" state (Setup, day > 0,
    // no deal marker) is seeded directly -- as a legacy save/checkpoint may
    // still carry it -- and must remain usable.
    const running = setupGame(standardRoles(5),{phase:"day",day:3});
    store.setState({game:running});
    expect(state().setPhase("setup").ok).toBe(false);
    expect(game().phase).toBe("day");
    const legacy = setupGame(standardRoles(5),{phase:"setup",day:3});
    expect(Object.hasOwn(legacy, "setupRolesDealt")).toBe(false);
    store.setState({game:legacy});
    expect(analyzeSetup(selectSetupContext(game(), setupScript)).readiness.begin.ok).toBe(true);
    expect(state().beginNightOne().ok).toBe(true);
    expect(game().phase).toBe("night");
    expect(game().startingNonTravelerCount).toBeUndefined();
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
    dealt();state().beginNightOne();
    const saved=localStorage.getItem("new-blood-st")!;
    expect(JSON.parse(saved).version).toBe(20);
    store.setState({game:null});localStorage.setItem("new-blood-st",saved);
    await store.persist.rehydrate();expect(game().startingNonTravelerCount).toBe(5);
    const checkpoint=JSON.parse(JSON.stringify({game:game(),roster:{}}));
    expect(StorytellerGamePersistedSchema.parse(checkpoint.game).startingNonTravelerCount).toBe(5);
  });
  it("starting setup fact never enters public/self projections", () => {
    dealt();state().beginNightOne();
    const publicData=projectLobbyToPublic(game(),{});
    const self=projectLobbyToSelfMap(game(),buildRegistry(setupScript));
    for(const data of [publicData,self])expect(JSON.stringify(data)).not.toContain("startingNonTravelerCount");
  });
});

describe("Traveler designation before/after Deal (Phase 9 Setup finalization B4, revised)", () => {
  // 6 ordinary seeded so a single ordinary->Traveler conversion (6->5) never
  // trips the 5-player floor by itself -- the floor itself is covered by
  // its own dedicated tests below.
  function prepareSix(pool = true) {
    store.getState().newGame(setupScript.id, { plannedPlayerCount: 6, plannedRoles: pool ? standardRoles(6) : [] });
    for (let i = 0; i < 6; i++) store.getState().addPlayerToSeat("Player " + i);
  }

  it("converting a seated ordinary player before Deal immediately syncs plannedTravelerCount and the ordinary target, without a restart", () => {
    prepareSix();
    const id = game().seatOrder[0]!;
    const result = state().setIsTraveler(id, true);
    expect(result.ok).toBe(true);
    expect(game().phase).toBe("setup"); // no lobby/game restart
    expect(game().plannedPlayerCount).toBe(6); // total participant count is unchanged
    expect(game().plannedTravelerCount).toBe(1);
    const context = selectSetupContext(game(), setupScript);
    expect(context.population).toMatchObject({
      occupiedNonTravelerCount: 5, occupiedTravelerCount: 1, targetNonTravelerCount: 5,
    });
  });

  it("reverse conversion (Traveler -> ordinary) immediately restores plannedTravelerCount and the ordinary target when legal", () => {
    prepareSix();
    const id = game().seatOrder[0]!;
    expect(state().setIsTraveler(id, true).ok).toBe(true);
    const result = state().setIsTraveler(id, false);
    expect(result.ok).toBe(true);
    expect(game().plannedTravelerCount).toBe(0);
    const context = selectSetupContext(game(), setupScript);
    expect(context.population).toMatchObject({
      occupiedNonTravelerCount: 6, occupiedTravelerCount: 0, targetNonTravelerCount: 6,
    });
  });

  it("10 total / 0 Travellers: marking one player Traveller immediately makes 9-player composition authoritative", () => {
    store.getState().newGame(setupScript.id, { plannedPlayerCount: 10, plannedRoles: standardRoles(10) });
    for (let i = 0; i < 10; i++) store.getState().addPlayerToSeat("Player " + i);
    const id = game().seatOrder[0]!;
    expect(state().setIsTraveler(id, true).ok).toBe(true);
    expect(game().plannedPlayerCount).toBe(10);
    expect(game().plannedTravelerCount).toBe(1);
    expect(selectSetupContext(game(), setupScript).population.targetNonTravelerCount).toBe(9);

    // Reverse conversion restores 10 ordinary when legal.
    expect(state().setIsTraveler(id, false).ok).toBe(true);
    expect(game().plannedTravelerCount).toBe(0);
    expect(selectSetupContext(game(), setupScript).population.targetNonTravelerCount).toBe(10);
  });

  it("converting a player to Traveler after private Deal preserves unaffected assignments, never auto-reshuffles, and the synced composition needs no separate reconciliation action", () => {
    prepareSix();
    state().dealRolePool();

    // standardRoles(6) is exactly standardRoles(5) plus one Outsider (drunk):
    // converting whoever holds it leaves precisely a valid 5-composition.
    const drunkId = game().seatOrder.find((id) => game().players[id]!.actualRole === "drunk")!;
    const untouchedIds = game().seatOrder.filter((id) => id !== drunkId);
    const before = new Map(untouchedIds.map((id) => [id, structuredClone(game().players[id])]));

    const result = state().setIsTraveler(drunkId, true);
    expect(result.ok).toBe(true);

    // Every unaffected ordinary assignment survives exactly -- no auto-reshuffle.
    for (const id of untouchedIds) expect(game().players[id]).toEqual(before.get(id));

    // Composition is immediately authoritative and consistent: no separate
    // planned-vs-seated reconciliation action is required.
    const context = selectSetupContext(game(), setupScript);
    expect(context.population).toMatchObject({ targetNonTravelerCount: 5, occupiedNonTravelerCount: 5 });
    expect(state().revealRoles().ok).toBe(true);
  });

  it("5 ordinary players: converting one to Traveler is refused and leaves state unchanged", () => {
    store.getState().newGame(setupScript.id, { plannedPlayerCount: 5, plannedRoles: standardRoles(5) });
    for (let i = 0; i < 5; i++) store.getState().addPlayerToSeat("Player " + i);
    const id = game().seatOrder[0]!;
    const before = state();
    const result = state().setIsTraveler(id, true);
    expect(result.ok).toBe(false);
    expect(state()).toBe(before); // no mutation at all
    expect(game().players[id]!.isTraveler).toBe(false);
    expect(game().plannedTravelerCount).toBe(0);
  });

  it("6 ordinary players: converting one to Traveler succeeds, landing exactly at the 5-player floor", () => {
    prepareSix(false);
    const id = game().seatOrder[0]!;
    const result = state().setIsTraveler(id, true);
    expect(result.ok).toBe(true);
    expect(selectSetupContext(game(), setupScript).population.occupiedNonTravelerCount).toBe(5);
  });

  it("beginNightOne() itself is blocked while a starting Traveler lacks a character or alignment, matching analyzer readiness", () => {
    dealt();
    state().addPlayer("Traveler");
    const travelerId = game().seatOrder.at(-1)!;
    state().setIsTraveler(travelerId, true);
    expect(state().beginNightOne().ok).toBe(false); // no character yet

    state().assignRole(travelerId, "thief");
    expect(state().beginNightOne().ok).toBe(false); // character set, alignment still missing

    state().setTravelerAlignment(travelerId, "good");
    expect(state().beginNightOne().ok).toBe(true);
  });

  it("a mid-Deal Traveler conversion never mutates any other seat's identity", () => {
    prepare(true);
    state().dealRolePool();
    const before = structuredClone(game().players);
    const id = game().seatOrder[0]!;
    state().setIsTraveler(id, true);
    for (const otherId of game().seatOrder.slice(1)) {
      expect(game().players[otherId]).toEqual(before[otherId]);
    }
  });
});
