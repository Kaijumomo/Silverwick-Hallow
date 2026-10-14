import { beforeEach, describe, expect, it, vi } from "vitest";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { buildRegistry } from "@/data/roleRegistry";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { computeNightOrder } from "@/features/nightOrder/nightOrder";
import { evilInformationPolicy } from "@/features/nightOrder/nightRules";
import { bind, patchPlayer, pick, plan, proofGame, proofQuery, request } from "@/test/proofFixtures";
import { fillRolePool } from "./fillRolePool";
import { randomSetup } from "./randomSetup";
import { selectSetupContext } from "./setupContext";
import { analyzeSetup } from "./setupAnalyzer";
import { conflictingDrunkDisguise } from "./revealReadiness";
import { DRUNK_REMINDER_LABEL, ownsDrunkReminder } from "@/stores/drunkReminders";

const registry = buildRegistry(troubleBrewing);
const townsfolk = ["washerwoman", "librarian", "investigator", "chef", "empath", "fortuneteller", "undertaker", "monk", "ravenkeeper", "virgin", "slayer", "soldier", "mayor"];
const state = () => store.getState();
const game = () => state().game!;
beforeEach(() => {
  localStorage.clear();
  store.setState({ game: null, lobby: null, undoStack: [], customScripts: {} });
});

function deal(pool: string[]) {
  state().newGame("tb", { plannedPlayerCount: pool.length, plannedRoles: pool });
  for (let i = 0; i < pool.length; i++) state().addPlayerToSeat(`Player ${i}`);
  expect(state().dealRolePool().ok).toBe(true);
}

describe("B3 Baron setup acceptance", () => {
  // Independent expected table: the official count chart with two Townsfolk
  // replaced by two Outsiders, including five/six-player games.
  it.each([
    [5, 1, 2, 1], [6, 1, 3, 1], [7, 3, 2, 1], [8, 3, 3, 1], [9, 3, 4, 1],
    [10, 5, 2, 2], [11, 5, 3, 2], [12, 5, 4, 2], [13, 7, 2, 3], [14, 7, 3, 3], [15, 7, 4, 3],
  ])("%i residents: composition, Drunk classification, real deal and initial information", (count, tf, outsider, minion) => {
    const expected = { townsfolk: tf, outsider, minion, demon: 1 };
    const filled = fillRolePool({ pinnedIds: ["baron", "drunk"], targetPlayerCount: count,
      scriptCharacters: troubleBrewing.characters, random: () => 0.999999 });
    expect(filled).toMatchObject({ ok: true, composition: expected });
    if (!filled.ok) throw new Error("missing bag");
    const prioritized = [...troubleBrewing.characters.filter(r => r.id === "baron"), ...troubleBrewing.characters.filter(r => r.id !== "baron")];
    const randomized = randomSetup({ targetPlayerCount: count, scriptCharacters: prioritized, random: () => 0.999999 });
    expect(randomized).toMatchObject({ ok: true, composition: expected });
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try { deal(filled.pool); } finally { random.mockRestore(); }
    expect(game().seatOrder.map(id => game().players[id]!.actualRole)).toEqual([...filled.pool.slice(1), filled.pool[0]]);
    const counts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
    for (const player of Object.values(game().players)) counts[registry.get(player.actualRole)!.type as keyof typeof counts]++;
    expect(counts).toEqual(expected);
    const drunk = Object.values(game().players).find(p => p.actualRole === "drunk")!;
    expect(drunk).toMatchObject({ actualAlignment: "good", shownRole: null, behaviorMode: "drunk_fake_role_behavior" });
    expect(analyzeSetup(selectSetupContext(game(), troubleBrewing)).assigned.actual).toEqual(expected);
    const info = evilInformationPolicy(Object.values(game().players), registry);
    expect(info.automaticTeamInfo).toBe(count >= 7);
    expect(info.automaticBluffs).toBe(count >= 7);
    expect(info.minions).toHaveLength(minion);
    expect(info.demons).toHaveLength(1);
  });

  it.each(["death", "poisoning", "character change"])("Baron %s does not change the prepared roster or apply new composition", change => {
    deal(["baron", "drunk", "saint", "chef", "empath", "monk", "imp"]);
    const baron = Object.values(game().players).find(p => p.actualRole === "baron")!;
    const drunk = Object.values(game().players).find(p => p.actualRole === "drunk")!;
    expect(state().setShownRole(drunk.id, "washerwoman").ok).toBe(true);
    expect(state().revealRoles().ok).toBe(true);
    expect(state().beginNightOne().ok).toBe(true);
    const otherRoles = Object.fromEntries(Object.values(game().players).filter(p => p.id !== baron.id).map(p => [p.id, p.actualRole]));
    if (change === "death") state().setAlive(baron.id, false);
    if (change === "poisoning") expect(state().resolveEffects({ intents: [{ kind: "apply", target: bind(game(), baron.id),
      effect: { type: "poisoned", lifetime: { kind: "manual" } } }] }).ok).toBe(true);
    if (change === "character change") expect(state().assignRole(baron.id, "poisoner").ok).toBe(true);
    expect(Object.fromEntries(Object.values(game().players).filter(p => p.id !== baron.id).map(p => [p.id, p.actualRole]))).toEqual(otherRoles);
    expect(game().rolePool).toEqual([]);
    expect(game().startingNonTravelerCount).toBe(7);
    expect(game().players[drunk.id]!.actualRole).toBe("drunk");
  });
});

describe("B3 all thirteen Drunk disguises", () => {
  const eightPlayerPool = ["washerwoman", "librarian", "investigator", "chef", "empath", "drunk", "poisoner", "imp"];
  const drunkId = () => Object.values(game().players).find(player => player.actualRole === "drunk")!.id;

  it("ordinary Trouble Brewing refuses a duplicate Townsfolk disguise before reveal; correcting to an unused token is sufficient", () => {
    deal(eightPlayerPool);
    const id = drunkId();
    expect(state().setShownRole(id, "chef").ok).toBe(true);
    const before = state(); const saved = localStorage.getItem("new-blood-st");
    expect(state().revealRoles().ok).toBe(false);
    expect(state()).toBe(before);
    expect(localStorage.getItem("new-blood-st")).toBe(saved);
    expect(projectLobbyToSelfMap(game(), registry)).toEqual({});
    expect(state().setShownRole(id, "monk").ok).toBe(true);
    expect(state().revealRoles().ok).toBe(true);
    expect(projectLobbyToSelfMap(game(), registry)[id]).toEqual({ shownRole: "monk", shownAlignment: "good" });
    expect(state().beginNightOne().ok).toBe(true);
  });

  it("a duplicate correction after reveal still cannot bypass initial Begin readiness", () => {
    deal(eightPlayerPool);
    const id = drunkId();
    expect(state().setShownRole(id, "monk").ok).toBe(true);
    expect(state().revealRoles().ok).toBe(true);
    expect(state().setShownRole(id, "chef").ok).toBe(true);
    const before = state();
    expect(state().beginNightOne().ok).toBe(false);
    expect(state()).toBe(before);
    expect(state().setShownRole(id, "monk").ok).toBe(true);
    expect(state().beginNightOne().ok).toBe(true);
  });

  it("does not reapply the initial bag restriction to later Storyteller perception corrections", () => {
    deal(eightPlayerPool);
    const id = drunkId();
    expect(state().setShownRole(id, "monk").ok).toBe(true);
    expect(state().revealRoles().ok).toBe(true);
    expect(state().beginNightOne().ok).toBe(true);
    expect(state().setShownRole(id, "chef").ok).toBe(true);
    expect(conflictingDrunkDisguise(selectSetupContext(game(), troubleBrewing))).toBeUndefined();
    expect(state().setPhase("day").ok).toBe(true);
    expect(state().setPhase("night").ok).toBe(true);
    expect(game().players[id]).toMatchObject({ actualRole: "drunk", shownRole: "chef" });
    expect(game().day).toBe(2);
  });

  it.each(["custom script", "Fabled", "Loric"])("preserves Storyteller handling of %s setup exceptions", exception => {
    deal(eightPlayerPool);
    const id = drunkId();
    expect(state().setShownRole(id, "chef").ok).toBe(true);
    if (exception === "custom script") {
      const script = { id: "custom-tb-selection", name: "Selected custom characters", characters: troubleBrewing.characters.filter(role => role.id !== "fortuneteller") };
      store.setState({ game: { ...game(), scriptId: script.id }, customScripts: { [script.id]: script } });
    } else if (exception === "Fabled") state().setFabled(["doomsayer"]);
    else state().setLorics(["pope"]);
    expect(state().revealRoles().ok).toBe(true);
    expect(state().beginNightOne().ok).toBe(true);
    expect(game().players[id]).toMatchObject({ actualRole: "drunk", shownRole: "chef" });
  });

  it.each(townsfolk)("%s: actual Outsider, private configuration, concealed reveal, reload, correction and Undo", async shown => {
    const otherTown = townsfolk.filter(id => id !== shown && id !== "fortuneteller").slice(0, 3);
    deal([...otherTown, "drunk", "poisoner", "imp"]);
    const id = game().seatOrder.find(id => game().players[id]!.actualRole === "drunk")!;
    expect(state().revealRoles().ok).toBe(false);
    expect(state().setShownRole(id, shown).ok).toBe(true);
    const drunkReminder = game().players[id]!.reminders[0]!;
    expect(game().players[id]!.reminders).toHaveLength(1);
    expect(drunkReminder.label).toBe(DRUNK_REMINDER_LABEL);
    expect(ownsDrunkReminder(game().players[id]!, drunkReminder)).toBe(true);
    expect(projectLobbyToSelfMap(game(), registry)).toEqual({});
    expect(state().revealRoles().ok).toBe(true);
    expect(projectLobbyToSelfMap(game(), registry)[id]).toEqual({ shownRole: shown, shownAlignment: "good" });
    expect(JSON.stringify(projectLobbyToPublic(game(), {}))).not.toContain("drunk");
    const saved = localStorage.getItem("new-blood-st")!;
    store.setState({ game: null });
    localStorage.setItem("new-blood-st", saved);
    await store.persist.rehydrate();
    expect(StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(game()))).players[id])
      .toMatchObject({ actualRole: "drunk", shownRole: shown, actualAlignment: "good" });
    expect(state().beginNightOne().ok).toBe(true);
    expect(game().players[id]).toMatchObject({ actualRole: "drunk", shownRole: shown });
    const different = shown === "chef" ? "empath" : "chef";
    expect(state().setShownRole(id, different).ok).toBe(true);
    expect(game().players[id]!.reminders).toEqual([drunkReminder]);
    expect(game().players[id]!.actualRole).toBe("drunk");
    state().undo();
    expect(game().players[id]).toMatchObject({ actualRole: "drunk", shownRole: shown });
    expect(projectLobbyToSelfMap(game(), registry)[id]).toEqual({ shownRole: shown, shownAlignment: "good" });
    expect(game().players[id]!.reminders).toEqual([drunkReminder]);
  });

  it.each(townsfolk)("%s: Night wake follows shown character while rules use actual Outsider", shown => {
    const g = patchPlayer(proofGame(["drunk", "imp", "chef", "baron", "saint"]), "p0",
      { shownRole: shown, behaviorMode: "drunk_fake_role_behavior" });
    const firstWakes = ["washerwoman", "librarian", "investigator", "chef", "empath", "fortuneteller"];
    const laterWakes = ["empath", "fortuneteller", "undertaker", "monk", "ravenkeeper"];
    for (const first of [true, false]) {
      const rows = computeNightOrder(g.players, g.seatOrder, troubleBrewing, first).filter(s => s.kind === "player" && s.playerId === "p0");
      expect(rows).toHaveLength((first ? firstWakes : laterWakes).includes(shown) ? 1 : 0);
      if (rows.length) expect(rows[0]).toMatchObject({ actualRoleId: "drunk", shownRoleId: shown, isDeceived: true });
    }
    expect(proofQuery(g).registersAsType(bind(g, "p0"), "outsider", "virgin")).toEqual({ known: true, value: true });
    expect(proofQuery(g).registersAsType(bind(g, "p0"), "townsfolk", "virgin")).toEqual({ known: true, value: false });
    // In particular, pretending to be Soldier grants no Demon protection.
    expect(proofQuery(g).protectedFrom(bind(g, "p0"), "demon")).toEqual({ known: true, value: false });
  });

  it("simulated Monk never applies protection; simulated Slayer never kills or spends a real ability", () => {
    for (const shown of ["monk", "slayer"]) {
      const g = patchPlayer(proofGame(["drunk", "imp", "chef", "baron", "saint"], shown === "slayer" ? "day" : "night"), "p0",
        { shownRole: shown, behaviorMode: "drunk_fake_role_behavior" });
      expect(plan(g, request(g, "p0", shown, { target: pick(g, "p1") }))).toEqual({ ok: true, changed: false });
      expect(g.players.p1!.alive).toBe(true);
      expect(g.players.p1!.effects).toEqual([]);
      expect(g.players.p0!.abilityUsed).toBe(false);
      expect(g.informationDeliveries).toEqual([]);
    }
  });
});
