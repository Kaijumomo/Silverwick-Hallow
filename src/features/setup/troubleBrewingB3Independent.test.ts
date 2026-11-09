import { beforeEach, expect, it } from "vitest";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { buildRegistry } from "@/data/roleRegistry";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { captureFingerprint } from "@/stores/abilityResolution";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { participantStepKey } from "@/stores/nightProgress";
import { computeNightOrder } from "@/features/nightOrder/nightOrder";
import { planManualInformationDelivery } from "@/stores/informationDelivery";
import { bind, patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, request, num } from "@/test/proofFixtures";
import { subjectId } from "@/abilities/characters/shared";
import type { AbilityInputValue } from "@/abilities/semantics";

// Independent expectations from the publisher's TB sheet and official Wiki:
// /Glossary (evil information), /Librarian (zero), /Drunk (no ability),
// /Fortune_Teller (only a real Fortune Teller gets a persistent Red Herring).
const game = () => store.getState().game!;
beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null,
    customScripts: { [proofScript.id]: proofScript } });
  useSessionRuntime.setState({ backend: null, status: "idle" });
});

it("all 22 official characters retain ordinary identity and the complete first-Night procedures", () => {
  const ids = ["washerwoman", "librarian", "investigator", "chef", "empath", "fortuneteller", "undertaker", "monk", "ravenkeeper", "virgin", "slayer", "soldier", "mayor", "butler", "drunk", "recluse", "saint", "poisoner", "spy", "scarletwoman", "baron", "imp"];
  expect(troubleBrewing.characters.map(r => r.id).sort()).toEqual([...ids].sort());
  // Inventory only, not a proposed 22-player bag.
  const g = proofGame(ids, "night", 1);
  const order = computeNightOrder(g.players, g.seatOrder, troubleBrewing, true);
  expect(order.filter(s => s.kind === "player").map(s => s.effectiveRoleId)).toEqual([
    "poisoner", "washerwoman", "librarian", "investigator", "chef", "empath", "fortuneteller", "butler", "spy",
  ]);
  for (const p of Object.values(g.players)) {
    expect(p.alive).toBe(true); expect(p.abilityUsed).toBe(false);
    expect(p.effects).toEqual([]);
    expect(p.actualAlignment).toBe(["poisoner", "spy", "scarletwoman", "baron", "imp"].includes(p.actualRole) ? "evil" : "good");
    expect(p.shownRole).toBe(p.actualRole === "drunk" ? null : p.actualRole);
  }
  const registry = buildRegistry(troubleBrewing);
  for (const [role, labels] of Object.entries({ washerwoman: ["Townsfolk", "Wrong"], librarian: ["Outsider", "Wrong"], investigator: ["Minion", "Wrong"], fortuneteller: ["Red Herring"], drunk: ["Is The Drunk"], butler: ["Master"], virgin: ["No Ability"], slayer: ["No Ability"], poisoner: ["Poisoned"], monk: ["Safe"], undertaker: ["Died Today"], scarletwoman: ["Is The Demon"], imp: ["Dead"] })) {
    const def = registry.get(role)!;
    expect([...(def.reminders ?? []), ...(def.remindersGlobal ?? [])], role).toEqual(labels);
  }
});

it.each([5, 6, 7])("%i ordinary players get exactly the applicable initial evil procedures without automatic publication", count => {
  const roles = ["imp", "baron", "chef", "empath", "soldier", "saint", "butler"].slice(0, count);
  const g = proofGame(roles, "night", 1);
  const before = JSON.stringify(g);
  const steps = computeNightOrder(g.players, g.seatOrder, troubleBrewing, true);
  expect(steps.filter(s => ["minionInfo", "demonInfo"].includes(s.stepKey)).map(s => s.stepKey)).toEqual(count < 7 ? [] : ["minionInfo", "demonInfo"]);
  if (count === 7) {
    expect(steps.find(s => s.stepKey === "minionInfo")).toMatchObject({ recipientIds: ["p1"] });
    expect(steps.find(s => s.stepKey === "demonInfo")).toMatchObject({ recipientIds: ["p0"], setupRecipientIds: ["p0"] });
  }
  expect(JSON.stringify(g)).toBe(before);
  expect(projectLobbyToSelfMap(g, proofRegistry).p0).not.toHaveProperty("bluffs");
  expect(projectLobbyToSelfMap(g, proofRegistry).p0).not.toHaveProperty("minions");
});

it("a Traveller cannot convert a six-player Trouble Brewing game into seven-player evil introductions", () => {
  let g = proofGame(["imp", "baron", "chef", "empath", "soldier", "saint", "thief"], "night", 1);
  g = patchPlayer(g, "p6", { isTraveler: true });
  expect(computeNightOrder(g.players, g.seatOrder, proofScript, true).some(s => ["minionInfo", "demonInfo"].includes(s.stepKey))).toBe(false);
});

it("Librarian zero-Outsider communication stays Storyteller-owned, reloads privately and Undo restores the pending step", async () => {
  const g = proofGame(["librarian", "chef", "empath", "soldier", "mayor", "poisoner", "imp"], "night", 1);
  store.setState({ game: g });
  const stepKey = participantStepKey(g.players.p0!.participantId!, "librarian");
  const result = store.getState().resolveAbility({ mode: "manual", reason: "Storyteller gave the starting information", roleId: "librarian",
    fingerprint: captureFingerprint(g, "p0", { day: 1, stepKey })!, completeStep: true,
    outcome: { operations: [{ domain: "manualInformation", recipient: bind(g, "p0"), text: "There are zero Outsiders in play." }] } });
  expect(result).toMatchObject({ ok: true, changed: true });
  expect(game().informationDeliveries[0]).toMatchObject({ kind: "manual", actualRole: "librarian", text: "There are zero Outsiders in play." });
  expect(game().nightProgress[`1:${stepKey}`]?.status).toBe("done");
  expect(game().players).toEqual(g.players);
  expect(store.getState().undoStack).toHaveLength(1);
  const saved = localStorage.getItem("new-blood-st")!;
  store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved);
  await store.persist.rehydrate();
  expect(game().informationDeliveries).toHaveLength(1);
  for (const projection of [projectLobbyToPublic(game(), {}), projectLobbyToSelfMap(game(), proofRegistry)]) {
    expect(JSON.stringify(projection)).not.toContain("zero Outsiders");
    expect(JSON.stringify(projection)).not.toContain("informationDeliveries");
  }
  store.getState().undo();
  expect(game().informationDeliveries).toEqual([]);
  expect(game().nightProgress[`1:${stepKey}`]).toBeUndefined();
});

it.each(["empath", "fortuneteller"])("Drunk shown %s never computes authoritative information or creates a Red Herring", role => {
  let g = proofGame(["drunk", "soldier", "mayor", "poisoner", "imp"], "night", 1);
  g = patchPlayer(g, "p0", { shownRole: role, shownAlignment: "good" });
  const inputs: Record<string, AbilityInputValue> = role === "empath" ? {} : { targets: pick(g, "p1", "p2") };
  expect(plan(g, request(g, "p0", role, inputs))).toMatchObject({ ok: false, code: "needsInput" });
  const communicated: Record<string, AbilityInputValue> = role === "empath" ? { communicated: num(2) }
    : { [subjectId("communicated", bind(g, "p1"), bind(g, "p2"))]: { kind: "boolean" as const, value: true } };
  const after = planned(plan(g, request(g, "p0", role, { ...inputs, ...communicated })));
  expect(after.players).toEqual(g.players);
  expect(after.informationDeliveries).toHaveLength(1);
  expect(after.informationDeliveries[0]).toMatchObject({ actualRole: "drunk", performedRole: role });
  expect(Object.values(after.players).flatMap(p => p.effects)).toEqual([]);
});

it("correcting the Drunk's shown identity invalidates an already-open simulated information request", () => {
  let g = proofGame(["drunk", "soldier", "mayor", "poisoner", "imp"], "night", 1);
  g = patchPlayer(g, "p0", { shownRole: "empath", shownAlignment: "good" });
  const pending = request(g, "p0", "empath", { communicated: num(1) });
  const corrected = patchPlayer(g, "p0", { shownRole: "chef" });
  expect(plan(corrected, pending)).toMatchObject({ ok: false, code: "stale" });
  expect(corrected.informationDeliveries).toEqual([]);
});

it("manual information cannot misattribute a Drunk procedure to another player or a different disguise", () => {
  let g = proofGame(["drunk", "librarian", "mayor", "poisoner", "imp"], "night", 1);
  g = patchPlayer(g, "p0", { shownRole: "investigator", shownAlignment: "good" });
  for (const [recipientPlayerId, performedRole] of [["p0", "chef"], ["p1", "investigator"]]) {
    expect(planManualInformationDelivery(g, { recipientPlayerId: recipientPlayerId!, text: "Two players were shown.", performedRole },
      { registry: proofRegistry, workflowRole: "investigator" })).toMatchObject({ ok: false });
  }
});
