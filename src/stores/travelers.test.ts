import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store, migrateStoreState } from "./storytellerStore";
import { buildRegistry } from "@/data/roleRegistry";
import { TRAVELERS } from "@/data/travelers";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { projectLobbyToPublic, projectToPublic, projectToSelf } from "./projections";
import { travelerDemonInformation, travelerGuidance } from "./travelers";
import { previewPrivatePacket } from "./privatePackets";
import { StorytellerGamePersistedSchema } from "./schemas";
import { decodeSelfSnapshot } from "@/firebase/snapshots";
import { computeNightOrder } from "@/features/nightOrder/nightOrder";
import { selectSetupContext } from "@/features/setup/setupContext";
import { analyzeSetup } from "@/features/setup/setupAnalyzer";

const registry = buildRegistry(setupScript);
const game = () => store.getState().game!;
const p = () => game().players.t!;
const night = () => computeNightOrder(game().players, game().seatOrder, setupScript, game().day === 1, game());
function traveler(role = "thief") {
  store.getState().addPlayer("Traveler");
  const id = game().seatOrder.at(-1)!;
  const added = game().players[id]!;
  const players: ReturnType<typeof game>["players"] = { ...game().players, t: { ...added, id: "t" } }; delete players[id];
  store.setState({ game: { ...game(), players, seatOrder: game().seatOrder.map(x => x === id ? "t" : x) } });
  store.getState().setIsTraveler("t", true);
  if (role) store.getState().assignRole("t", role);
}
beforeEach(() => store.setState({ game: setupGame(standardRoles(5)), lobby: null, undoStack: [], customScripts: { [setupScript.id]: setupScript } }));

describe("Phase 9B Traveler identity and population", () => {
  it.each(TRAVELERS.map(r => r.id))("publishes canonical %s without any actual alignment", role => {
    traveler(role); store.getState().setTravelerAlignment("t", "evil");
    expect(p()).toMatchObject({ actualRole: role, publicDisplayRole: role, actualAlignment: "evil" });
    expect(projectToSelf(p(), registry)).toEqual({ shownRole: role });
    const pub = projectToPublic(p(), false);
    expect(pub.publicDisplayRole).toBe(role);
    for (const key of ["actualRole", "actualAlignment", "shownAlignment", "travelerArrival", "exiled", "privateInfo"])
      expect(pub).not.toHaveProperty(key);
    expect(decodeSelfSnapshot(projectToSelf(p(), registry)).status).toBe("ready");
  });
  it.each(["good", "evil"] as const)("keeps actual %s distinct from shown alignment and survives undo", alignment => {
    traveler(); store.getState().setShownAlignment("t", "evil");
    expect(p().actualAlignment).toBeUndefined();
    store.getState().setTravelerAlignment("t", alignment);
    expect(p().actualAlignment).toBe(alignment); expect(p().shownAlignment).toBe("evil");
    store.getState().undo(); expect(p().actualAlignment).toBeUndefined();
  });
  it("keeps ordinary roles secret and refuses crossed assignment types", () => {
    expect(projectToPublic(game().players.p0!, true)).not.toHaveProperty("publicDisplayRole");
    store.getState().assignRole("p0", "thief"); expect(game().players.p0!.actualRole).not.toBe("thief");
    traveler(); store.getState().assignRole("t", "imp"); expect(p().actualRole).toBe("thief");
  });
  it("changes and clears public Traveler identity coherently", () => {
    traveler(); store.getState().assignRole("t", "bureaucrat");
    expect(projectToPublic(p(), true).publicDisplayRole).toBe("bureaucrat");
    store.getState().assignRole("t", ""); expect(projectToPublic(p(), true)).not.toHaveProperty("publicDisplayRole");
    store.getState().setIsTraveler("t", false); expect(p()).not.toHaveProperty("actualAlignment");
  });
  it.each(["setup", "day", "night"] as const)("arrival during %s preserves target, physical seating and phase", phase => {
    store.setState({ game: { ...game(), phase, day: phase === "setup" ? 0 : 4 } }); traveler("");
    const context = selectSetupContext(game(), setupScript);
    expect(context.population).toMatchObject({ targetNonTravelerCount: 5, occupiedNonTravelerCount: 5, occupiedTravelerCount: 1, totalPhysicalSeatCount: 6 });
    expect(game().phase).toBe(phase); expect(game().plannedPlayerCount).toBe(5);
    expect(travelerGuidance(p())).toEqual(["Choose a Traveler character.", "Choose actual alignment privately."]);
    expect(analyzeSetup(context).findings.some(f => f.code === "traveler-alignment:t" && f.severity === "check")).toBe(true);
    expect(projectLobbyToPublic(game(), { t: false }).players.t!.publicDisplayRole).toBeUndefined();
    store.getState().removePlayer("t"); expect(game().plannedPlayerCount).toBe(5);
  });
  it("does not create tasks for a good Traveler with no arrival procedure", () => {
    traveler("scapegoat"); store.getState().setTravelerAlignment("t", "good");
    expect(travelerGuidance(p())).toEqual([]);
  });
  it("Gnome requires a bounded public starting-information check, not an inferred player", () => {
    traveler("gnome"); store.getState().setTravelerAlignment("t", "good");
    expect(travelerGuidance(p()).join(" ")).toMatch(/public starting information/);
    store.getState().completeTravelerArrivalCheck("t");
    expect(travelerGuidance(p())).toEqual([]);
    expect(projectToPublic(p(), true)).not.toHaveProperty("travelerArrival");
    expect(projectToSelf(p(), registry)).toEqual({ shownRole: "gnome" });
  });
});

describe("Phase 9B personal first night", () => {
  it.each([1, 4])("completes the personal procedure on Night %s without duplicate wakes", day => {
    traveler("apprentice"); store.getState().setTravelerAlignment("t", "good");
    store.setState({ game: { ...game(), phase: "night", day } });
    const beforeOrdinary = night().filter(s => !s.stepKey.includes("t:apprentice"));
    const step = night().find(s => s.stepKey.endsWith("t:apprentice"))!;
    expect(step).toBeDefined();
    if (day > 1) expect(step.advisory).toMatch(/timing check/);
    store.getState().setNightStepStatus(day, step.stepKey, "done");
    expect(p().travelerArrival).toMatchObject({ firstNightComplete: true, completedAtNight: day });
    expect(game().day).toBe(day);
    expect(night().filter(s => s.stepKey.endsWith("t:apprentice"))).toHaveLength(1);
    expect(night().filter(s => !s.stepKey.includes("t:apprentice"))).toEqual(beforeOrdinary);
    store.setState({ game: { ...game(), day: day + 1 } });
    expect(night().some(s => s.stepKey.startsWith("travelerArrival:t"))).toBe(false);
    expect(travelerGuidance(p())).toEqual([]);
  });
  it("skipping does not claim personal completion", () => {
    traveler("apprentice"); store.setState({ game: { ...game(), phase: "night", day: 4 } });
    store.getState().setNightStepStatus(4, "travelerArrival:t:apprentice", "skipped");
    expect(p().travelerArrival!.firstNightComplete).toBe(false);
  });
  it("changing away and back cannot inherit a completed arrival step", () => {
    traveler("apprentice"); store.setState({ game: { ...game(), phase: "night", day: 4 } });
    const key = "travelerArrival:t:apprentice";
    store.getState().setNightStepStatus(4, key, "done");
    store.getState().assignRole("t", "thief"); store.getState().assignRole("t", "apprentice");
    expect(game().nightProgress[`4:${key}`]).toBeUndefined();
    expect(p().travelerArrival!.firstNightComplete).toBe(false);
  });
  it("explicit reset of tonight's progress also resets personal completion", () => {
    traveler("apprentice"); store.setState({ game: { ...game(), phase: "night", day: 4 } });
    store.getState().setNightStepStatus(4, "travelerArrival:t:apprentice", "done");
    store.getState().clearNightProgress(4);
    expect(p().travelerArrival!.firstNightComplete).toBe(false);
    expect(p().travelerArrival).not.toHaveProperty("completedAtNight");
  });
  it("unknown legacy arrival remains a targeted check", () => {
    traveler("apprentice"); delete p().travelerArrival;
    store.setState({ game: { ...game(), phase: "night", day: 4 } });
    expect(travelerGuidance(p()).join(" ")).toMatch(/unknown/);
    expect(night().find(s => s.stepKey.startsWith("travelerArrival:t"))?.advisory).toMatch(/timing check/);
  });
  it.each(["death", "exile"])("%s suppresses arrival but preserves the player", action => {
    traveler("apprentice"); store.setState({ game: { ...game(), phase: "night", day: 4 } });
    if (action === "death") store.getState().setAlive("t", false); else store.getState().exileTraveler("t");
    expect(p()).toBeDefined(); expect(p().alive).toBe(false);
    expect(!!p().exiled).toBe(action === "exile");
    expect(night().some(s => s.stepKey.includes("t:apprentice"))).toBe(false);
    store.getState().undo(); expect(p().alive).toBe(true);
  });
});

describe("Phase 9B permitted Demon information", () => {
  it("previews only the Demon name/seat after explicit preparation", () => {
    traveler(); store.getState().setTravelerAlignment("t", "evil");
    expect(projectToSelf(p(), registry)).toEqual({ shownRole: "thief" });
    store.getState().prepareTravelerDemon("t");
    const preview = previewPrivatePacket(p(), game(), registry);
    expect(preview.payload).toEqual({ shownRole: "thief", demon: { id: "p4", name: "Player 4", seat: 4 } });
    expect(projectToSelf(p(), registry)).not.toHaveProperty("demon");
  });
  it.each([undefined, "good"] as const)("shown evil never substitutes for actual %s", alignment => {
    traveler(); store.getState().setShownAlignment("t", "evil");
    if (alignment) store.getState().setTravelerAlignment("t", alignment);
    expect(travelerDemonInformation(p(), game(), registry).demon).toBeUndefined();
    store.getState().prepareTravelerDemon("t"); expect(p().privateInfo).toBeUndefined();
    p().privateInfo = { travelerDemon: "p4" };
    expect(() => previewPrivatePacket(p(), game(), registry)).toThrow(/evil Traveler/);
  });
  it.each(["legion", "lilmonsta", "poppygrower", "magician", "atheist", "zombuul"])("%s produces a manual check", role => {
    traveler(); store.getState().setTravelerAlignment("t", "evil"); game().players.p0!.actualRole = role;
    expect(travelerDemonInformation(p(), game(), registry)).toMatchObject({ check: expect.stringContaining("Storyteller check") });
  });
  it.each(["absent", "multiple", "modifier", "unknown"])("%s Demon context cannot guess", context => {
    traveler(); store.getState().setTravelerAlignment("t", "evil");
    if (context === "absent") game().players.p4!.alive = false;
    if (context === "multiple") game().players.p0!.actualRole = "imp";
    if (context === "modifier") game().fabled = ["toymaker"];
    if (context === "unknown") game().players.p0!.actualRole = "unknown";
    expect(travelerDemonInformation(p(), game(), registry).demon).toBeUndefined();
  });
  it("alignment changes invalidate a prepared and delivered Demon snapshot", () => {
    traveler(); store.getState().setTravelerAlignment("t", "evil"); store.getState().prepareTravelerDemon("t");
    const payload = previewPrivatePacket(p(), game(), registry).payload;
    p().publishedPacket = { id: "sent", payload };
    store.getState().completeTravelerInformation("t");
    store.getState().setTravelerAlignment("t", "good");
    expect(p().privateInfo).toBeUndefined(); expect(p().publishedPacket).toBeUndefined();
    expect(projectToSelf(p(), registry)).not.toHaveProperty("demon");
  });
  it("showing alignment after Demon delivery reopens targeted delivery when the packet is withdrawn", () => {
    traveler(); store.getState().setTravelerAlignment("t", "evil"); store.getState().prepareTravelerDemon("t");
    p().publishedPacket = { id: "sent", payload: previewPrivatePacket(p(), game(), registry).payload };
    store.getState().completeTravelerInformation("t"); store.getState().setShownAlignment("t", "evil");
    expect(p().travelerArrival!.demonInfoComplete).toBe(false);
    expect(previewPrivatePacket(p(), game(), registry).payload.demon).toBeDefined();
    expect(travelerGuidance(p()).join(" ")).toMatch(/Demon information/);
  });
});

describe("Phase 9B persistence", () => {
  it("rehydrates current Traveler truth, completion and exile from local persistence", async () => {
    traveler(); store.getState().setTravelerAlignment("t", "evil");
    store.getState().completeTravelerInformation("t"); store.getState().exileTraveler("t");
    const expected = JSON.parse(JSON.stringify(p()));
    const saved = localStorage.getItem("new-blood-st")!;
    expect(JSON.parse(saved).version).toBe(11);
    store.setState({ game: null }); localStorage.setItem("new-blood-st", saved);
    await store.persist.rehydrate(); expect(p()).toEqual(expected);
  });
  it("round trips current fields and owner checkpoint without undefined values", () => {
    traveler(); store.getState().setTravelerAlignment("t", "evil"); store.getState().exileTraveler("t");
    const decoded = StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(game())));
    expect(decoded.players.t).toEqual(p());
    const verify = (value: unknown): void => { expect(value).not.toBeUndefined(); if (value && typeof value === "object") Object.values(value).forEach(verify); };
    verify(game()); verify(projectLobbyToPublic(game(), {})); verify(projectToSelf(p(), registry));
  });
  it("v10 migration repairs public character only; unknown historical facts remain absent in undo too", () => {
    traveler("apprentice"); delete p().travelerArrival; p().publicDisplayRole = null;
    const raw = JSON.parse(JSON.stringify({ game: game(), undoStack: [game()] }));
    const migrated = migrateStoreState(raw, 10) as typeof raw;
    for (const g of [migrated.game, migrated.undoStack[0]]) {
      expect(g.players.t.publicDisplayRole).toBe("apprentice");
      for (const key of ["actualAlignment", "travelerArrival", "exiled"]) expect(g.players.t).not.toHaveProperty(key);
    }
  });
  it("decodes a running legacy checkpoint safely without rewriting truth", () => {
    traveler("apprentice"); delete p().travelerArrival; game().day = 4; game().phase = "night";
    const decoded = StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(game())));
    expect(decoded.players.t!.actualAlignment).toBeUndefined();
    expect(travelerGuidance(decoded.players.t!).join(" ")).toMatch(/unknown/);
  });
});
