import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bind, impair, openInStore, patchPlayer, proofGame, proofRegistry, proofScript, reseat } from "@/test/proofFixtures";
import { captureCharacterActionContext, useStorytellerStore as store } from "./storytellerStore";
import { preparedInformationContext, type PrepareInformationRequest } from "./preparedInformation";
import { usePrivacyStore } from "./privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { useShellStore } from "./shellStore";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { StorytellerGamePersistedSchema } from "./schemas";
import type { PreparedInformationCharacter, StorytellerLobbyRecord } from "./types";

// Independent expectations: official wiki How to Run sections bind the qualifying
// character and any OTHER player, not an opposite-team/category player.
// https://wiki.bloodontheclocktower.com/Washerwoman
// https://wiki.bloodontheclocktower.com/Librarian
// https://wiki.bloodontheclocktower.com/Investigator
const game = () => store.getState().game!;
const setup = (roles = ["washerwoman", "chef", "empath", "imp", "poisoner"]) => {
  const g = proofGame(roles, "night", 1, { phase: "setup", day: 0 });
  return { ...g, players: Object.fromEntries(Object.entries(g.players).map(([id, player]) => [id, { ...player, packetEpoch: "epoch-" + id }])) };
};
const prepareRequest = (g: StorytellerLobbyRecord, character: PreparedInformationCharacter = "washerwoman", shownCharacter = "chef", qualifying = "p1", wrong = "p2"): PrepareInformationRequest => ({
  character, source: bind(g, "p0"), expected: preparedInformationContext(g, proofScript),
  clue: { kind: "pair", candidates: [bind(g, qualifying), bind(g, wrong)], shownCharacter, qualifyingParticipantId: g.players[qualifying]!.participantId! },
});
const prepare = (req = prepareRequest(game())) => {
  const result = store.getState().prepareInformation(req, captureCharacterActionContext());
  return result;
};
const deliver = () => store.getState().deliverPreparedInformation({
  preparationId: game().preparedInformation[0]!.id, source: bind(game(), "p0"), expected: preparedInformationContext(game(), proofScript),
}, captureCharacterActionContext());
const toNight = () => store.setState({ game: { ...game(), phase: "night", day: 1 } });
const allReminders = (g = game()) => Object.values(g.players).flatMap(p => p.reminders);
beforeEach(() => {
  localStorage.clear(); store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null, finishedGameUndo: null, canUndoFinishedGame: false, sync: null });
  useShellStore.getState().reset(); usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
});
afterEach(() => vi.restoreAllMocks());

describe("B6 independent official rules and authoritative lifecycle", () => {
  it.each([
    ["washerwoman", "chef", "empath", "Townsfolk"],
    ["librarian", "saint", "butler", "Outsider"],
    ["investigator", "poisoner", "baron", "Minion"],
  ] as const)("%s accepts a same-category Wrong candidate, places exact owned reminders, and delivers only at Night", (character, qualifying, wrong, label) => {
    const original = setup([character, qualifying, wrong, "imp", "monk"]); openInStore(original);
    const write = vi.spyOn(Storage.prototype, "setItem");
    expect(prepare(prepareRequest(game(), character, qualifying))).toMatchObject({ ok: true });
    expect(write).toHaveBeenCalledTimes(1); expect(store.getState().undoStack).toHaveLength(1);
    const prepared = game(); expect(prepared.preparedInformation).toHaveLength(1); expect(prepared.informationDeliveries).toEqual([]);
    expect(prepared.players.p1!.reminders).toHaveLength(1); expect(prepared.players.p1!.reminders[0]).toMatchObject({ label, sourceCharacter: character, sourceParticipant: { participantId: original.players.p0!.participantId } });
    expect(prepared.players.p2!.reminders[0]).toMatchObject({ label: "Wrong", sourceCharacter: character });
    expect(StorytellerGamePersistedSchema.safeParse(prepared).success).toBe(true);
    const accepted = store.getState(); const history = prepared.history.length;
    expect(prepare(prepareRequest(game(), character, qualifying))).toMatchObject({ ok: true });
    expect(game()).toBe(prepared); expect(store.getState().undoStack).toBe(accepted.undoStack); expect(game().history).toHaveLength(history);
    toNight(); const beforeDelivery = game(); const reminders = allReminders(); const undoCount = store.getState().undoStack.length;
    expect(deliver()).toMatchObject({ ok: true }); expect(game().informationDeliveries).toHaveLength(1); expect(game().preparedInformation).toEqual([]);
    expect(game().informationDeliveries[0]).toMatchObject({ actualRole: character, informationActionId: character + "-first-night" });
    expect(allReminders()).toEqual(reminders); expect(store.getState().undoStack).toHaveLength(undoCount + 1);
    expect(Object.values(game().nightProgress).some(Boolean)).toBe(true);
    store.getState().undo(); expect(game()).toEqual(beforeDelivery);
  });

  it("Librarian identifies the actual Drunk, not the Townsfolk token they received", () => {
    const g = patchPlayer(setup(["librarian", "drunk", "chef", "imp", "baron"]), "p1", { shownRole: "empath", behaviorMode: "drunk_fake_role_behavior" }); openInStore(g);
    expect(prepare(prepareRequest(g, "librarian", "drunk"))).toMatchObject({ ok: true });
    toNight(); expect(deliver()).toMatchObject({ ok: true });
    expect(game().informationDeliveries[0]!.values).toContainEqual({ requirementId: "role", kind: "role", roleId: "drunk" });
    expect(game().players.p1!.shownRole).toBe("empath");
  });

  it("Librarian zero is explicit, has no pair/reminders and creates no premature communication", () => {
    openInStore(setup(["librarian", "chef", "empath", "imp", "poisoner"]));
    expect(prepare({ character: "librarian", source: bind(game(), "p0"), expected: preparedInformationContext(game(), proofScript), clue: { kind: "zero-outsiders" } })).toMatchObject({ ok: true });
    expect(game().preparedInformation[0]!.clue).toEqual({ kind: "zero-outsiders" }); expect(allReminders()).toEqual([]); expect(game().informationDeliveries).toEqual([]);
    toNight(); expect(deliver()).toMatchObject({ ok: true }); expect(game().informationDeliveries).toHaveLength(1); expect(allReminders()).toEqual([]);
  });

  it.each(["drunk", "saint", "recluse", "spy"])("a healthy Librarian cannot silently prepare zero across %s", role => {
    openInStore(setup(["librarian", role, "chef", "imp", "baron"])); const before = store.getState();
    expect(prepare({ character: "librarian", source: bind(game(), "p0"), expected: preparedInformationContext(game(), proofScript), clue: { kind: "zero-outsiders" } })).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
  });

  it.each([
    ["washerwoman", "poisoned", "soldier"], ["washerwoman", "drunk", "soldier"],
    ["librarian", "poisoned", "saint"], ["librarian", "drunk", "saint"],
    ["investigator", "poisoned", "baron"], ["investigator", "drunk", "baron"],
  ] as const)("%s with %s may deliberately receive false character information", (character, effect, shown) => {
    openInStore(impair(setup([character, "chef", "empath", "imp", "poisoner"]), "p0", effect)); expect(prepare(prepareRequest(game(), character, shown))).toMatchObject({ ok: true });
    expect(game().preparedInformation[0]!.mode).toBe("storyteller"); toNight(); expect(deliver()).toMatchObject({ ok: true });
    expect(game().informationDeliveries[0]!.values).toContainEqual({ requirementId: "role", kind: "role", roleId: shown });
  });

  it.each([["washerwoman", "soldier"], ["librarian", "saint"], ["investigator", "baron"]] as const)("Drunk shown %s records simulation without changing actual identity", (character, shown) => {
    openInStore(patchPlayer(setup(["drunk", "chef", "empath", "imp", "poisoner"]), "p0", { shownRole: character, behaviorMode: "drunk_fake_role_behavior" }));
    expect(prepare(prepareRequest(game(), character, shown))).toMatchObject({ ok: true }); toNight(); expect(deliver()).toMatchObject({ ok: true });
    expect(game().informationDeliveries[0]).toMatchObject({ actualRole: "drunk", performedRole: character }); expect(game().players.p0!.actualRole).toBe("drunk");
  });

  it("poisoned Librarian may choose zero despite a Baron-adjusted table containing two actual Outsiders", () => {
    openInStore(impair(setup(["librarian", "saint", "drunk", "imp", "baron"]), "p0"));
    expect(prepare({ character: "librarian", source: bind(game(), "p0"), expected: preparedInformationContext(game(), proofScript), clue: { kind: "zero-outsiders" } })).toMatchObject({ ok: true });
    expect(game().preparedInformation[0]!.mode).toBe("storyteller"); expect(allReminders()).toEqual([]); toNight(); expect(deliver()).toMatchObject({ ok: true });
    expect(game().informationDeliveries[0]!.values).toEqual([{ requirementId: "outsiders", kind: "number", value: 0 }]);
    expect(game().players.p1!.actualRole).toBe("saint"); expect(game().players.p2!.actualRole).toBe("drunk");
  });

  it.each([
    ["washerwoman", "spy", "chef"], ["librarian", "spy", "saint"], ["investigator", "recluse", "poisoner"], ["investigator", "spy", "spy"],
  ] as const)("%s leaves discretionary %s registration entirely manual", (character, actual, shown) => {
    openInStore(setup([character, actual, "chef", "imp", "baron"])); const before = store.getState();
    expect(prepare(prepareRequest(game(), character, shown))).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
  });

  it("irrelevant Spy on the Wrong candidate does not invalidate a factual Washerwoman clue", () => {
    openInStore(setup(["washerwoman", "chef", "spy", "imp", "monk"])); expect(prepare()).toMatchObject({ ok: true });
  });

  it.each(["source-replaced", "target-replaced", "qualifier-role", "source-role", "source-shown", "poisoned", "script", "game"])("prepared clue refuses stale %s context without publication", scenario => {
    openInStore(setup()); expect(prepare()).toMatchObject({ ok: true }); toNight(); let changed = game();
    if (scenario === "source-replaced") changed = reseat(changed, "p0");
    if (scenario === "target-replaced") changed = reseat(changed, "p1");
    if (scenario === "qualifier-role") changed = patchPlayer(changed, "p1", { actualRole: "soldier" });
    if (scenario === "source-role") changed = patchPlayer(changed, "p0", { actualRole: "monk" });
    if (scenario === "source-shown") changed = patchPlayer(changed, "p0", { shownRole: "monk" });
    if (scenario === "poisoned") changed = impair(changed, "p0");
    if (scenario === "script") changed = { ...changed, scriptId: "tb" };
    if (scenario === "game") changed = { ...changed, code: "OTHER123" };
    store.setState({ game: changed }); const before = store.getState(); expect(deliver()).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
  });

  it("linked token removal invalidates pending intent and Undo restores both; manual notation survives", () => {
    openInStore(setup()); expect(store.getState().resolveReminders({ intents: [{ kind: "place", target: bind(game(), "p1"), reminder: { label: "Townsfolk" } }] })).toMatchObject({ ok: true });
    const manual = game().players.p1!.reminders[0]!; expect(prepare()).toMatchObject({ ok: true }); const prepared = game();
    const linked = prepared.players.p1!.reminders.find(r => r.id !== manual.id)!;
    expect(store.getState().removeReminder("p1", linked.id)).toMatchObject({ ok: true }); expect(game().preparedInformation).toEqual([]);
    expect(game().players.p1!.reminders).toContainEqual(manual); store.getState().undo(); expect(game()).toEqual(prepared);
  });

  it("post-delivery token correction preserves communication and other owned token identity", () => {
    openInStore(setup()); expect(prepare()).toMatchObject({ ok: true }); toNight(); expect(deliver()).toMatchObject({ ok: true });
    const delivered = game().informationDeliveries; const wrong = game().players.p2!.reminders[0]!; const first = game().players.p1!.reminders[0]!;
    expect(first.sourceParticipant).toMatchObject({ kind: "participant", participantId: game().players.p0!.participantId });
    expect(store.getState().removeReminder("p1", first.id)).toMatchObject({ ok: true });
    expect(game().informationDeliveries).toEqual(delivered); expect(game().players.p2!.reminders).toEqual([wrong]);
  });

  it("changed preparation replaces only exact generated reminder instances", () => {
    openInStore(setup()); expect(prepare()).toMatchObject({ ok: true }); const old = allReminders().map(r => r.id);
    expect(store.getState().resolveReminders({ intents: [{ kind: "place", target: bind(game(), "p1"), reminder: { label: "Townsfolk", source: bind(game(), "p0"), sourceCharacter: "washerwoman" } }] })).toMatchObject({ ok: true });
    const manual = game().players.p1!.reminders.find(r => !old.includes(r.id))!;
    expect(prepare(prepareRequest(game(), "washerwoman", "empath", "p2", "p3"))).toMatchObject({ ok: true });
    expect(game().preparedInformation).toHaveLength(1); expect(allReminders()).toHaveLength(3); expect(allReminders()).toContainEqual(manual);
    expect(allReminders().some(r => old.includes(r.id))).toBe(false); expect(game().players.p2!.reminders[0]!.label).toBe("Townsfolk");
  });

  it("false impaired preparation cannot become verified merely because poisoning ends", () => {
    openInStore(impair(setup(), "p0")); expect(prepare(prepareRequest(game(), "washerwoman", "soldier"))).toMatchObject({ ok: true });
    toNight(); store.setState({ game: patchPlayer(game(), "p0", { effects: [] }) }); const before = store.getState();
    expect(deliver()).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
  });

  it("same script id with altered character definition invalidates prepared truth", () => {
    openInStore(setup()); expect(prepare()).toMatchObject({ ok: true }); toNight();
    store.setState({ customScripts: { [proofScript.id]: { ...proofScript, characters: proofScript.characters.map(role => role.id === "chef" ? { ...role, ability: "Changed" } : role) } } });
    const before = store.getState(); expect(deliver()).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
  });

  it("an accepted delivery cannot be repeated from its captured request", () => {
    openInStore(setup()); expect(prepare()).toMatchObject({ ok: true }); toNight();
    const req = { preparationId: game().preparedInformation[0]!.id, source: bind(game(), "p0"), expected: preparedInformationContext(game(), proofScript) };
    expect(store.getState().deliverPreparedInformation(req, captureCharacterActionContext())).toMatchObject({ ok: true });
    const before = store.getState(); expect(store.getState().deliverPreparedInformation(req, captureCharacterActionContext())).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
  });

  it.each(["privacy", "recovery", "storage", "writer"])("%s barrier refuses delivery without consuming intent or completing Night", mode => {
    openInStore(setup()); expect(prepare()).toMatchObject({ ok: true }); toNight();
    if (mode === "privacy") usePrivacyStore.getState().setEnabled(true);
    if (mode === "recovery") store.setState({ terminalClose: { intent: { kind: "declare", winner: "good" }, status: "failed", message: "Retry", recoveryPending: true } });
    if (mode === "storage") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    if (mode === "writer") store.setState({ lobby: { code: "B6REVIEW", uid: "host", sessionId: "s", status: "live" }, game: { ...game(), code: "B6REVIEW", storytellerUid: "host" } });
    const before = store.getState(); let publications = 0; const stop = store.subscribe(() => publications++);
    try { expect(deliver()).toMatchObject({ ok: false }); expect(store.getState().game).toBe(before.game); expect(store.getState().undoStack).toBe(before.undoStack); expect(publications).toBe(0); }
    finally { stop(); }
  });

  it("pending clue and exact reminder linkage round-trip; neither private preparation nor delivery leaks to player projections", async () => {
    openInStore(setup()); expect(prepare()).toMatchObject({ ok: true }); const pending = game(); const saved = localStorage.getItem("new-blood-st")!;
    store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate(); expect(game()).toEqual(pending);
    expect(JSON.stringify([projectLobbyToPublic(game(), {}), projectLobbyToSelfMap(game(), proofRegistry)])).not.toMatch(/preparedInformation|qualifyingParticipantId|sourceIdentityEpoch|informationDeliveries/);
    toNight(); expect(deliver()).toMatchObject({ ok: true });
    expect(JSON.stringify([projectLobbyToPublic(game(), {}), projectLobbyToSelfMap(game(), proofRegistry)])).not.toMatch(/preparedInformation|qualifyingParticipantId|sourceIdentityEpoch|informationDeliveries/);
  });

  it.each(["privacy", "recovery", "storage", "writer"])("%s barrier refuses preparation without publishing partial reminders", mode => {
    openInStore(setup()); if (mode === "privacy") usePrivacyStore.getState().setEnabled(true);
    if (mode === "recovery") store.setState({ terminalClose: { intent: { kind: "declare", winner: "good" }, status: "failed", message: "Retry", recoveryPending: true } });
    if (mode === "storage") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    if (mode === "writer") store.setState({ lobby: { code: "B6REVIEW", uid: "host", sessionId: "s", status: "live" }, game: { ...game(), code: "B6REVIEW", storytellerUid: "host" } });
    const before = store.getState(); let publications = 0; const stop = store.subscribe(() => publications++);
    try { expect(prepare()).toMatchObject({ ok: false }); expect(store.getState().game).toBe(before.game); expect(store.getState().undoStack).toBe(before.undoStack); expect(publications).toBe(0); }
    finally { stop(); }
  });

  it.each(["preparation", "delivery"])("aggregate checkpoint envelope refusal leaves %s uncommitted", operation => {
    openInStore(setup()); if (operation === "delivery") { expect(prepare()).toMatchObject({ ok: true }); toNight(); }
    // Both individual string leaves fit; their serialized checkpoint does not.
    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    store.setState({ game: patchPlayer({ ...game(), notes: "x".repeat(5_300_000) }, "p4", { stNotes: "y".repeat(5_300_000) }) });
    writes.mockClear();
    const before = store.getState(); let publications = 0; const stop = store.subscribe(() => publications++);
    try {
      const result = operation === "preparation" ? prepare() : deliver(); expect(result).toMatchObject({ ok: false });
      if (!result.ok) expect(result.message).toMatch(/checkpoint/);
      expect(store.getState().game).toBe(before.game); expect(store.getState().undoStack).toBe(before.undoStack); expect(publications).toBe(0);
      expect(writes).not.toHaveBeenCalled();
    } finally { stop(); }
  });
});
