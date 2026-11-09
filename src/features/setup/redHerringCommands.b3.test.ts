import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureCharacterActionContext, useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { buildRegistry } from "@/data/roleRegistry";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { bind, pick, plan, proofEnv, request } from "@/test/proofFixtures";
import { redHerringSetup, RED_HERRING_EFFECT } from "./redHerringSetup";
import { selectSetupContext } from "./setupContext";

const state = () => store.getState();
const game = () => state().game!;
const registry = buildRegistry(troubleBrewing);
const idOf = (role: string) => Object.values(game().players).find(player => player.actualRole === role)!.id;
const facts = () => Object.values(game().players).flatMap(player => player.effects.filter(effect => effect.type === RED_HERRING_EFFECT).map(effect => ({ playerId: player.id, effect })));
function prepare(roles = ["fortuneteller", "chef", "soldier", "poisoner", "imp"]) {
  state().newGame("tb", { plannedPlayerCount: roles.length, plannedRoles: roles });
  for (let i = 0; i < roles.length; i++) state().addPlayerToSeat(`Player ${i}`);
  expect(state().dealRolePool().ok).toBe(true);
  store.setState({ undoStack: [], localSeq: 0 });
}
beforeEach(() => {
  localStorage.clear();
  usePrivacyStore.getState().reset();
  useSessionRuntime.setState({ backend: null, status: "idle" });
  store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [], localSeq: 0, customScripts: {} });
});
afterEach(() => { vi.restoreAllMocks(); usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" }); });

describe("B3 Red Herring setup command", () => {
  it.each(["fortuneteller", "chef", "soldier"])("accepts the good %s, including self, as one source-free persistent fact", role => {
    prepare();
    const teller = idOf("fortuneteller");
    const target = idOf(role);
    const before = game();
    expect(state().setSetupRedHerring(bind(game(), target), captureCharacterActionContext())).toMatchObject({ ok: true, changed: true });
    expect(facts()).toHaveLength(1);
    expect(facts()[0]).toMatchObject({ playerId: target, effect: { type: RED_HERRING_EFFECT, state: "active", lifetime: { kind: "manual" }, expiry: { kind: "none" },
      parameters: { fortuneTeller: { kind: "participant", participants: [bind(before, teller)] }, fortuneTellerIdentityEpoch: { kind: "text", value: before.players[teller]!.packetEpoch } } } });
    expect(facts()[0]!.effect).not.toHaveProperty("sourceCharacter");
    expect(facts()[0]!.effect).not.toHaveProperty("sourceParticipant");
    expect(game().players[target]!.reminders).toEqual([]);
    expect(state().undoStack).toHaveLength(1);
    // Existing setup semantics retain Undo without fabricating live History.
    expect(game().history).toEqual(before.history);
  });

  it.each(["poisoner", "imp"])("rejects an actually evil %s without partial writes", role => {
    prepare();
    const before = state(); const saved = localStorage.getItem("new-blood-st");
    expect(state().setSetupRedHerring(bind(game(), idOf(role)))).toMatchObject({ ok: false });
    expect(state()).toBe(before); expect(localStorage.getItem("new-blood-st")).toBe(saved);
  });

  it("uses actual good alignment rather than the identity a player is shown", () => {
    prepare();
    const evil = idOf("imp"); const good = idOf("chef");
    expect(state().setShownRole(evil, "soldier").ok).toBe(true);
    expect(state().setShownRole(good, "imp").ok).toBe(true);
    expect(state().setSetupRedHerring(bind(game(), evil)).ok).toBe(false);
    expect(state().setSetupRedHerring(bind(game(), good)).ok).toBe(true);
    expect(facts()[0]!.playerId).toBe(good);
  });

  it.each(["unbound", "stale participant", "stale game", "privacy", "reconnecting", "missing writer", "closing"])("refuses %s atomically", variant => {
    prepare();
    const target = bind(game(), idOf("chef"));
    const context = captureCharacterActionContext();
    if (variant === "stale game") store.setState({ game: { ...game(), notes: "changed" } });
    if (variant === "privacy") usePrivacyStore.getState().setEnabled(true);
    if (variant === "reconnecting" || variant === "missing writer") store.setState({ lobby: { code: "HERR2345", uid: "host", sessionId: "setup", status: variant === "reconnecting" ? "reconnecting" : "live" } });
    if (variant === "closing") store.setState({ terminalClose: { status: "closing" } as never });
    const chosen = variant === "unbound" ? { playerId: "absent", participantId: "absent" } : variant === "stale participant" ? { ...target, participantId: "former" } : target;
    const before = state(); const saved = localStorage.getItem("new-blood-st");
    const write = vi.spyOn(Storage.prototype, "setItem");
    expect(state().setSetupRedHerring(chosen, variant === "stale game" ? context : undefined)).toMatchObject({ ok: false });
    expect(state()).toBe(before); expect(write).not.toHaveBeenCalled(); expect(localStorage.getItem("new-blood-st")).toBe(saved);
  });

  it("requires the fact to begin Night 1, then applies selection once and rejects duplicate or moved selections", () => {
    prepare();
    expect(state().revealRoles().ok).toBe(true);
    const unprepared = state();
    expect(state().beginNightOne()).toMatchObject({ ok: false });
    expect(state()).toBe(unprepared);
    expect(state().setSetupRedHerring(bind(game(), idOf("chef"))).ok).toBe(true);
    const selected = state();
    expect(state().setSetupRedHerring(bind(game(), idOf("chef"))).ok).toBe(false);
    expect(state().setSetupRedHerring(bind(game(), idOf("soldier"))).ok).toBe(false);
    expect(state()).toBe(selected);
    expect(state().beginNightOne().ok).toBe(true);
    expect(facts()).toHaveLength(1);
    expect(state().setSetupRedHerring(bind(game(), idOf("soldier"))).ok).toBe(false);
  });

  it("fails storage atomically and publishes only the saved snapshot on success", () => {
    prepare();
    const target = bind(game(), idOf("chef"));
    const before = state(); const saved = localStorage.getItem("new-blood-st");
    const failure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    expect(state().setSetupRedHerring(target)).toMatchObject({ ok: false });
    expect(state()).toBe(before); expect(localStorage.getItem("new-blood-st")).toBe(saved);
    failure.mockRestore();
    let publications = 0;
    const write = vi.spyOn(Storage.prototype, "setItem");
    const unsubscribe = store.subscribe(next => { expect(JSON.parse(localStorage.getItem("new-blood-st")!).state.game).toEqual(next.game); publications++; });
    try { expect(state().setSetupRedHerring(target).ok).toBe(true); } finally { unsubscribe(); }
    expect(publications).toBe(1); expect(write).toHaveBeenCalledTimes(1); expect(state().undoStack).toHaveLength(1);
  });

  it("survives local rehydration and checkpoint decoding without public/self leakage; Undo removes the selection", async () => {
    prepare();
    expect(state().setSetupRedHerring(bind(game(), idOf("chef"))).ok).toBe(true);
    const expected = game(); const selected = facts(); const saved = localStorage.getItem("new-blood-st")!;
    store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
    expect(game()).toEqual(expected); expect(facts()).toEqual(selected);
    expect(StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(game())))).toEqual(game());
    for (const projection of [projectLobbyToPublic(game(), {}), projectLobbyToSelfMap(game(), registry)]) {
      expect(JSON.stringify(projection)).not.toContain(RED_HERRING_EFFECT);
      expect(JSON.stringify(projection)).not.toContain(selected[0]!.effect.id);
    }
    state().undo(); expect(facts()).toEqual([]);
    expect(redHerringSetup(selectSetupContext(game(), troubleBrewing)).status).toBe("missing");
  });

  it.each(["death", "poisoning", "role change"])("does not move or replace the fact after Fortune Teller %s", change => {
    prepare();
    const teller = idOf("fortuneteller"); const holder = idOf("chef");
    expect(state().setSetupRedHerring(bind(game(), holder)).ok).toBe(true);
    expect(state().revealRoles().ok).toBe(true); expect(state().beginNightOne().ok).toBe(true);
    const selected = facts();
    if (change === "death") state().setAlive(teller, false);
    if (change === "poisoning") expect(state().resolveEffects({ intents: [{ kind: "apply", target: bind(game(), teller), effect: { type: "poisoned", lifetime: { kind: "manual" } } }] }).ok).toBe(true);
    if (change === "role change") expect(state().assignRole(teller, "monk").ok).toBe(true);
    expect(facts()).toEqual(selected);
    expect(state().setPhase("day").ok).toBe(true);
    expect(state().setPhase("night").ok).toBe(true);
    expect(game().day).toBe(2);
    expect(facts()).toEqual(selected);
  });

  it("the initially selected good player registers as a Demon to this Fortune Teller's information", () => {
    prepare();
    const teller = idOf("fortuneteller"); const holder = idOf("chef"); const other = idOf("soldier");
    expect(state().setSetupRedHerring(bind(game(), holder)).ok).toBe(true);
    expect(state().revealRoles().ok).toBe(true); expect(state().beginNightOne().ok).toBe(true);
    const result = plan(game(), request(game(), teller, "fortuneteller", { targets: pick(game(), holder, other) }), proofEnv({ script: troubleBrewing, registry }));
    expect(result).toMatchObject({ ok: true, changed: true });
    if (result.ok && result.changed) expect(result.plan.game.informationDeliveries.at(-1)?.values).toContainEqual({ requirementId: "isDemon", kind: "boolean", value: true });
    expect(facts()).toHaveLength(1);
  });
});
