import { beforeEach, describe, expect, it } from "vitest";
import { buildRegistry } from "@/data/roleRegistry";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { makeSTPlayer, roles } from "@/test/fixtures";
import { wakeIdentity } from "./wakeIdentity";
import { computeNightOrder } from "@/features/nightOrder/nightOrder";
import { getPrivateInfoApplicability, previewPrivatePacket } from "./privatePackets";
import { projectToSelf } from "./projections";
import { migrateStoreState, useStorytellerStore as store } from "./storytellerStore";
import { StorytellerGamePersistedSchema } from "./schemas";
import { decodeSelfSnapshot } from "@/firebase/snapshots";

const registry = buildRegistry({ ...troubleBrewing, characters: [...troubleBrewing.characters, roles.marionette!, roles.lunatic!] });
beforeEach(() => store.setState({ game: null, lobby: null, undoStack: [] }));
function configured() {
  store.getState().newGame("tb");
  store.getState().addPlayer("Alice");
  store.getState().addPlayer("Bob");
  const [id, other] = store.getState().game!.seatOrder as [string, string];
  store.getState().assignRole(id, "lunatic");
  store.getState().setBehaviorMode(id, "fake_demon_behavior");
  store.getState().setShownRole(id, "imp");
  store.getState().setFakeMinions(id, [other]);
  store.getState().setBluffs(id, ["chef", "saint", "washerwoman"]);
  store.getState().setPrivateText(id, "Your information tonight");
  return { id, other, p: () => store.getState().game!.players[id]!, game: () => store.getState().game! };
}

describe("AUD-013 wake identity is operational, never mechanical", () => {
  it.each([
    ["empath", "empath", false],
    ["drunk", "empath", true],
    ["marionette", "fortuneteller", true],
    ["lunatic", "imp", true],
  ])("%s shown as %s resolves without changing authoritative state", (actual, shown, simulated) => {
    const p = makeSTPlayer({ actualRole: actual as string, shownRole: shown as string });
    const before = structuredClone(p);
    const wake = wakeIdentity(p, registry)!;
    expect(wake.role.id).toBe(shown);
    expect(wake.simulated).toBe(simulated);
    const steps = computeNightOrder({ p }, ["p"], troubleBrewing, false);
    expect(steps.filter(step => step.kind === "player")).toEqual([expect.objectContaining({
      effectiveRoleId: shown, actualRoleId: actual, isDeceived: simulated,
    })]);
    expect(p).toEqual(before);
    expect(registry.get(p.actualRole)?.type).toBe(actual === "lunatic" || actual === "drunk" ? "outsider" : actual === "marionette" ? "minion" : "townsfolk");
    expect(p.abilityUsed).toBe(false);
  });

  it.each(["empath", "drunk", "marionette", "lunatic"])("%s without perception has no actual-role wake fallback", actual => {
    const p = makeSTPlayer({ actualRole: actual, shownRole: null });
    expect(wakeIdentity(p, registry)).toBeNull();
    expect(computeNightOrder({ p }, ["p"], troubleBrewing, false)).toEqual([]);
  });

  it("Marionette and Lunatic are excluded from real team introduction recipients", () => {
    const players = {
      m: makeSTPlayer({ id: "m", actualRole: "marionette", shownRole: "fortuneteller" }),
      l: makeSTPlayer({ id: "l", actualRole: "lunatic", shownRole: "imp" }),
      d: makeSTPlayer({ id: "d", actualRole: "imp", shownRole: "imp" }),
      p: makeSTPlayer({ id: "p", actualRole: "poisoner", shownRole: "poisoner" }),
    };
    const steps = computeNightOrder(players, Object.keys(players), troubleBrewing, true, { fabled: ["toymaker"] });
    expect(steps.find(s => s.stepKey === "minionInfo")).toMatchObject({ recipientIds: ["p"] });
    expect(steps.find(s => s.stepKey === "demonInfo")).toMatchObject({ recipientIds: ["d"] });
  });

  it("perception changes update future wakes and do not inherit the old step completion key", () => {
    const p = makeSTPlayer({ actualRole: "drunk", shownRole: "empath" });
    const old = computeNightOrder({ p }, ["p"], troubleBrewing, false)[0]!;
    p.shownRole = "fortuneteller";
    const next = computeNightOrder({ p }, ["p"], troubleBrewing, false)[0]!;
    expect(next).toMatchObject({ effectiveRoleId: "fortuneteller", actualRoleId: "drunk" });
    expect(next.stepKey).not.toBe(old.stepKey);
  });
});

describe("AUD-027 private packet boundary and lifecycle", () => {
  it("central applicability keeps fake Demon fields exclusive to the fake Demon scenario", () => {
    const drunk = makeSTPlayer({ actualRole: "drunk", shownRole: "empath", behaviorMode: "drunk_fake_role_behavior" });
    const marionette = makeSTPlayer({ actualRole: "marionette", shownRole: "fortuneteller", behaviorMode: "marionette_fake_good_behavior" });
    const lunatic = makeSTPlayer({ actualRole: "lunatic", shownRole: "imp", behaviorMode: "fake_demon_behavior" });
    const demon = makeSTPlayer({ actualRole: "imp", shownRole: "imp", behaviorMode: "normal" });
    const normal = makeSTPlayer({ actualRole: "chef", shownRole: "chef", behaviorMode: "normal" });
    expect(getPrivateInfoApplicability(drunk, registry)).toMatchObject({ simulatedInfo: true, bluffs: false, fakeMinions: false, extraText: true });
    expect(getPrivateInfoApplicability(marionette, registry)).toMatchObject({ simulatedInfo: true, bluffs: false, fakeMinions: false, extraText: true });
    expect(getPrivateInfoApplicability(lunatic, registry)).toMatchObject({ simulatedInfo: true, bluffs: true, fakeMinions: true, extraText: true });
    expect(getPrivateInfoApplicability(demon, registry)).toMatchObject({ simulatedInfo: false, bluffs: true, fakeMinions: false });
    expect(getPrivateInfoApplicability(normal, registry)).toMatchObject({ simulatedInfo: false, bluffs: false, fakeMinions: false, extraText: true });
  });

  it("behavior changes prune fake Demon fields before they can be previewed or published", () => {
    const { id, p } = configured();
    expect(p().privateInfo?.fakeMinions).toBeDefined();
    expect(p().privateInfo?.bluffs).toBeDefined();
    store.getState().setBehaviorMode(id, "drunk_fake_role_behavior");
    expect(p().privateInfo).toEqual({ extraText: "Your information tonight" });
    expect(previewPrivatePacket(p(), store.getState().game!, registry).payload.extraText).toBe("Your information tonight");
    store.getState().setBehaviorMode(id, "normal");
    expect(p().privateInfo).toEqual({ extraText: "Your information tonight" });
  });

  it("configured and previewed drafts remain private until explicit publication", () => {
    const { p } = configured();
    expect(projectToSelf(p(), registry)).toEqual({ shownRole: "imp", shownAlignment: "evil" });

    expect(p().publishedPacket).toBeUndefined();
    expect(projectToSelf(p(), registry)?.extraText).toBeUndefined();
  });

  it("the preview is exactly the sanitized published payload, not actual team state", () => {
    const { id, p, game, other } = configured();
    const preview = previewPrivatePacket(p(), game(), registry);
    const published = { ...p(), publishedPacket: { id: "ack", payload: preview.payload } };
    expect(projectToSelf(published, registry)).toEqual(preview.payload);
    expect(preview.payload.minions).toEqual([{ id: other, name: "Bob", seat: 1 }]);
    expect(game().players[other]!.actualRole).toBe("");
    expect(preview.payload).not.toHaveProperty("fakeMinions");
    const json = JSON.stringify(preview.payload);
    for (const secret of ["actualRole", "actualAlignment", "lunatic", "behaviorMode", "privateInfo", "packetPreview", "publishedPacket", "stNotes"])
      expect(json).not.toContain(secret);
    expect(preview.payload).not.toHaveProperty(id);
  });

  it("schema sanitizes unknown ST fields even in a malformed publication snapshot", () => {
    const { p, game } = configured();
    const payload = { ...previewPrivatePacket(p(), game(), registry).payload, actualRole: "lunatic", behaviorMode: "secret" };
    const result = projectToSelf({ ...p(), publishedPacket: { id: "ack", payload } }, registry);
    expect(result).not.toHaveProperty("actualRole");
    expect(result).not.toHaveProperty("behaviorMode");
    expect(decodeSelfSnapshot(result)).toMatchObject({ status: "ready", data: result });
  });

  it.each([
    { id: "bob", name: "Bob", seat: "1" },
    { id: "bob", name: "Bob", seat: -1 },
    { id: "bob", name: {}, seat: 1 },
    null,
  ])("rejects malformed remote minion records: %j", minion => {
    expect(decodeSelfSnapshot({ shownRole: "imp", shownAlignment: "evil", minions: [minion] }).status).toBe("invalid");
  });

  it("published projection never reads actual identity, and drops legacy deception keys", () => {
    const { p, game } = configured();
    const player = { ...p(), publishedPacket: { id: "ack",
      payload: { ...previewPrivatePacket(p(), game(), registry).payload, fakeMinions: ["legacy"] } } };
    Object.defineProperty(player, "actualRole", { get: () => { throw new Error("actual identity accessed"); } });
    expect(projectToSelf(player, registry)?.shownRole).toBe("imp");
    expect(projectToSelf(player, registry)).not.toHaveProperty("fakeMinions");
  });

  it("editing a draft requires another preview and keeps earlier published information separate", () => {
    const { id, p, game } = configured();

    const packet = { id: "ack", payload: previewPrivatePacket(p(), game(), registry).payload };
    store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...p(), publishedPacket: packet } } } });
    store.getState().setPrivateText(id, "Not yet published");
    expect(projectToSelf(p(), registry)?.extraText).toBe("Your information tonight");
  });

  it.each(["shown", "actual", "alignment", "behavior"])("%s change invalidates previews and old delivery snapshots", change => {
    const { id, p, game } = configured();

    store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...p(),
      publishedPacket: { id: "ack", payload: previewPrivatePacket(p(), game(), registry).payload } } } } });
    if (change === "shown") store.getState().setShownRole(id, "chef");
    if (change === "actual") store.getState().assignRole(id, "drunk");
    if (change === "alignment") store.getState().setShownAlignment(id, "good");
    if (change === "behavior") store.getState().setBehaviorMode(id, "custom");
    expect(p()).not.toHaveProperty("packetPreview");
    expect(p().publishedPacket).toBeUndefined();
    expect(projectToSelf(p(), registry)?.extraText).toBeUndefined();
  });

  it("validated restoration preserves draft, publication, and wake independently", () => {
    const { id, p, game } = configured();

    const saved = { ...game(), players: { ...game().players, [id]: { ...p(),
      publishedPacket: { id: "ack", payload: previewPrivatePacket(p(), game(), registry).payload } } } };
    const restored = StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(saved)));
    expect(wakeIdentity(restored.players[id]!, registry)?.role.id).toBe("imp");
    expect(projectToSelf(restored.players[id]!, registry)).toEqual(previewPrivatePacket(p(), game(), registry).payload);
    delete restored.players[id]!.publishedPacket;
    expect(projectToSelf(restored.players[id]!, registry)?.minions).toBeUndefined();
  });

  it("seat reuse clears private state and cannot change the names in an earlier packet", () => {
    const { id, other, p, game } = configured();
    const preview = previewPrivatePacket(p(), game(), registry);

    store.getState().unseatPlayer(other);
    store.getState().addToPendingQueue("replacement", "Replacement");
    store.getState().assignPendingToSeat("replacement", other);
    expect(preview.payload.minions![0]!.name).toBe("Bob");
    expect(previewPrivatePacket(p(), game(), registry).fingerprint).not.toBe(preview.fingerprint);
    store.getState().unseatPlayer(id);
    store.getState().addToPendingQueue("next", "Next");
    store.getState().assignPendingToSeat("next", id);
    expect(p().privateInfo).toBeUndefined();
    expect(p()).not.toHaveProperty("packetPreview");
    expect(p().publishedPacket).toBeUndefined();
    expect(projectToSelf(p(), registry)).toBeNull();
  });

  it("new game cannot inherit private packets", () => {
    configured();

    store.getState().newGame("tb", { plannedPlayerCount: 2 });
    for (const p of Object.values(store.getState().game!.players)) {
      expect(p.privateInfo).toBeUndefined();
      expect(p).not.toHaveProperty("packetPreview");
      expect(p.publishedPacket).toBeUndefined();
    }
  });

  it("a new night preserves sent information while rejecting old send contexts", () => {
    const { id, p, game } = configured();

    const before = previewPrivatePacket(p(), game(), registry);
    const packet = { id: "ack", payload: before.payload, forDay: game().day, forPhase: game().phase };
    store.setState({ game: { ...game(), day: game().day + 1, players: { ...game().players, [id]: { ...p(), publishedPacket: packet } } } });
    expect(projectToSelf(p(), registry)).toEqual(packet.payload);
    expect(previewPrivatePacket(p(), game(), registry).fingerprint).not.toBe(before.fingerprint);

  });
});

it("v9 migration removes saved previews and retains drafts and sent information", () => {
  const { id, p, game } = configured();
  const payload = previewPrivatePacket(p(), game(), registry).payload;
  const legacy = { game: { ...game(), players: { ...game().players, [id]: { ...p(), packetPreview: { fingerprint: "old", payload }, publishedPacket: { id: "sent", payload } } } }, undoStack: [] };
  const restored = migrateStoreState(legacy, 8) as typeof legacy;
  expect(restored.game.players[id]).not.toHaveProperty("packetPreview");
  expect(restored.game.players[id]!.privateInfo).toEqual(p().privateInfo);
  expect(projectToSelf(restored.game.players[id]!, registry)).toEqual(payload);
});
