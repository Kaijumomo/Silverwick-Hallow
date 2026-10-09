import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureVotingContext, migrateStoreState, useStorytellerStore as store } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { currentVoter, currentVotingState, freshVotingDay, votingContextChanged } from "./voting";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { GAME_SCHEMA_VERSION, StorytellerGamePersistedSchema } from "./schemas";
import { detectLegacyGameVersion, migrateGameEntry } from "./gameMigration";
import { startStorytellerSession, useSessionRuntime } from "@/firebase/storytellerSync";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { SessionWriter } from "@/firebase/writer";
import { createLobby } from "@/firebase/lobby";
import { requireActiveSession } from "@/firebase/lifecycle";
import type { VotingIntent } from "./votingTypes";

type Action = VotingIntent extends infer I ? I extends VotingIntent ? Omit<I, "code" | "day" | "expectedRevision"> : never : never;
const state = () => store.getState();
const game = () => state().game!;
const binding = (id: string) => ({ playerId: id, participantId: game().players[id]!.participantId! });
function intent(action: Action): VotingIntent { return { ...action, code: game().code, day: game().day, expectedRevision: currentVotingState(game()).revision } as VotingIntent; }
function act(action: Action) { return state().resolveVoting(intent(action), captureVotingContext()); }
function begin() {
  const result = act({ kind: "begin", roundId: "r1", mode: "nomination", nominator: binding("p0"), nominee: binding("p1") });
  expect(result.ok, result.ok ? undefined : result.message).toBe(true);
}
const disposals: SessionWriter[] = [];
const managers: Array<{ stop: () => void }> = [];
beforeEach(() => {
  store.setState({ game: setupGame(["washerwoman", "chef", "empath", "poisoner", "imp"], { phase: "day", day: 1, voting: freshVotingDay(1) }),
    lobby: null, undoStack: [], localSeq: 0, terminalClose: null, customScripts: { [setupScript.id]: setupScript } });
  usePrivacyStore.getState().reset();
  useSessionRuntime.setState({ backend: null, status: "idle" });
});
afterEach(async () => { vi.restoreAllMocks(); for (const manager of managers.splice(0)) manager.stop(); for (const writer of disposals.splice(0)) await writer.dispose(); });

describe("voting command ownership and atomic persistence", () => {
  it("spends a dead vote, appends truthful history and updates cursor in one Undo/localSeq step", () => {
    state().recordDeath("p2"); begin();
    const previous = game(); const stack = state().undoStack.length; const seq = state().localSeq;
    expect(act({ kind: "respond", roundId: "r1", voter: binding("p2"), choice: "yes" }).ok).toBe(true);
    expect(game().players.p2!.ghostVote).toBe(false);
    expect(game().voting!.rounds[0]!.responses[0]!.choice).toBe("yes");
    expect(currentVoter(game())!.playerId).toBe("p3");
    expect(game().history.at(-1)).toMatchObject({ category: "voting", operation: "respond" });
    expect(state().undoStack).toHaveLength(stack + 1); expect(state().localSeq).toBe(seq + 1);
    state().undo(); expect(game().voting).toEqual(previous.voting); expect(game().players.p2!.ghostVote).toBe(true);
  });
  it("rejects duplicate, stale game and privacy/closure callbacks without mutations", () => {
    begin(); const oldContext = captureVotingContext(); const response = intent({ kind: "respond", roundId: "r1", voter: binding("p2"), choice: "yes" });
    expect(state().resolveVoting(response, oldContext).ok).toBe(true);
    const before = game(); const undo = state().undoStack; const seq = state().localSeq;
    expect(state().resolveVoting(response, oldContext).ok).toBe(false);
    usePrivacyStore.getState().setEnabled(true);
    expect(act({ kind: "respond", roundId: "r1", voter: binding("p3"), choice: "no" }).ok).toBe(false);
    usePrivacyStore.getState().reset();
    store.setState({ terminalClose: { status: "closing" } as never });
    expect(act({ kind: "respond", roundId: "r1", voter: binding("p3"), choice: "no" }).ok).toBe(false);
    expect(game()).toBe(before); expect(state().undoStack).toBe(undo); expect(state().localSeq).toBe(seq);
  });
  it("refuses Day to Night while a ballot is active", () => { begin(); const before = game(); expect(state().advancePhase().ok).toBe(false); expect(game()).toBe(before); });
  it("refused correction preserves persistence, history and Undo until context acknowledgement; accepted correction undoes atomically", () => {
    begin(); expect(act({ kind: "respond", roundId: "r1", voter: binding("p2"), choice: "no" }).ok).toBe(true);
    state().recordDeath("p4");
    const before = game(); const stack = state().undoStack; const seq = state().localSeq;
    const saved = localStorage.getItem("new-blood-st"); const write = vi.spyOn(Storage.prototype, "setItem");
    expect(act({ kind: "correctResponse", roundId: "r1", voter: binding("p2"), choice: "yes" })).toMatchObject({ ok: false, code: "stale" });
    expect(game()).toBe(before); expect(state().undoStack).toBe(stack); expect(state().localSeq).toBe(seq);
    expect(write).not.toHaveBeenCalled(); expect(localStorage.getItem("new-blood-st")).toBe(saved);
    expect(votingContextChanged(game(), game().voting!.rounds[0]!)).toBe(true);
    expect(act({ kind: "acknowledgeContext", roundId: "r1" }).ok).toBe(true);
    expect(game().voting!.rounds[0]!.threshold).toBe(2);
    const acknowledged = game(); const acknowledgedStack = state().undoStack.length; const acknowledgedSeq = state().localSeq;
    expect(act({ kind: "correctResponse", roundId: "r1", voter: binding("p2"), choice: "yes" }).ok).toBe(true);
    expect(game().history.at(-1)).toMatchObject({ category: "voting", operation: "correctResponse" });
    expect(game().history.slice(0, -1)).toEqual(acknowledged.history);
    expect(game().players).toEqual(acknowledged.players);
    expect(state().undoStack).toHaveLength(acknowledgedStack + 1); expect(state().localSeq).toBe(acknowledgedSeq + 1);
    state().undo(); expect(game()).toEqual(acknowledged);
    state().undo(); expect(game()).toEqual(before);
    expect(votingContextChanged(game(), game().voting!.rounds[0]!)).toBe(true);
  });
  it.each(["departed", "replaced"] as const)("store acknowledgement skips a %s participant without rebinding or losing Undo", change => {
    begin(); expect(act({ kind: "respond", roundId: "r1", voter: binding("p2"), choice: "no" }).ok).toBe(true);
    const former = currentVoter(game())!;
    expect(state().unseatPlayer("p3")).toBe(true);
    if (change === "replaced") state().addPlayerToSeat("Replacement", "p3");
    const before = game(); const stack = state().undoStack;
    expect(act({ kind: "correctResponse", roundId: "r1", voter: binding("p2"), choice: "yes" })).toMatchObject({ ok: false, code: "stale" });
    expect(game()).toBe(before); expect(state().undoStack).toBe(stack);
    expect(act({ kind: "acknowledgeContext", roundId: "r1" }).ok).toBe(true);
    expect(currentVoter(game())?.playerId).toBe("p4");
    expect(game().voting!.rounds[0]!.responses[1]).toMatchObject({ voter: former, choice: "skipped" });
    expect(game().players.p3!.participantId).not.toBe(former.participantId);
    const acknowledged = game();
    expect(act({ kind: "correctResponse", roundId: "r1", voter: former, choice: "yes" }).ok).toBe(false);
    expect(game()).toBe(acknowledged);
    state().undo(); expect(game()).toEqual(before); expect(currentVoter(game())).toEqual(former);
    expect(votingContextChanged(game(), game().voting!.rounds[0]!)).toBe(true);
  });
  it("the guarded day transition rejects stale or private context without advancing", () => {
    const context = captureVotingContext(); state().setNotes("p0", "Updated table context"); const before = game();
    expect(state().advancePhase(context).ok).toBe(false); expect(game()).toBe(before);
    usePrivacyStore.getState().setEnabled(true);
    expect(state().advancePhase(captureVotingContext()).ok).toBe(false); expect(game()).toBe(before);
  });
  it("keeps accepted round and dead-vote state through local reload", async () => {
    state().recordDeath("p2"); begin(); act({ kind: "respond", roundId: "r1", voter: binding("p2"), choice: "yes" });
    const expected = structuredClone(game()); const raw = localStorage.getItem("new-blood-st")!;
    store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", raw); await store.persist.rehydrate();
    expect(game()).toEqual(expected); expect(currentVoter(game())!.playerId).toBe("p3");
  });
  it("recovers a persisted partial ballot through the real checkpoint path without another token spend", async () => {
    state().recordDeath("p2"); begin(); act({ kind: "respond", roundId: "r1", voter: binding("p2"), choice: "yes" });
    const backend = new MemoryRoomBackend(); const code = "VRCR2345";
    await createLobby(backend, "host", { codeGenerator: () => code }); const session = await requireActiveSession(backend, code);
    const saved = { ...game(), code, storytellerUid: "host", scriptId: "tb" };
    await backend.set(`lobbies/${code}/checkpoint`, JSON.stringify({ game: saved, roster: {} }));
    const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
    store.setState({ game: null, undoStack: [], sync: null, localSeq: 0, lobby });
    const writer = new SessionWriter(backend, code, session.id); disposals.push(writer);
    const manager = await startStorytellerSession(backend, lobby, writer); managers.push(manager);
    expect(game().voting).toEqual(saved.voting); expect(game().history).toEqual(saved.history);
    expect(game().players.p2!.ghostVote).toBe(false); expect(currentVoter(game())!.playerId).toBe("p3");
    expect(act({ kind: "respond", roundId: "r1", voter: binding("p3"), choice: "no" }).ok).toBe(true);
    expect(game().players.p2!.ghostVote).toBe(false);
  });
  it("external Life token cycles permanently invalidate ballot refund until whole-state Undo", async () => {
    state().recordDeath("p2"); begin(); act({ kind: "respond", roundId: "r1", voter: binding("p2"), choice: "yes" });
    expect(game().voting!.rounds[0]!.responses[0]!.refundSafe).toBe(true);
    state().restoreGhostVote("p2"); state().spendGhostVote("p2");
    expect(game().voting!.rounds[0]!.responses[0]!.refundSafe).toBe(false);
    const raw = localStorage.getItem("new-blood-st")!; store.setState({ game: null }); localStorage.setItem("new-blood-st", raw); await store.persist.rehydrate();
    const before = game(); expect(act({ kind: "undoLast", roundId: "r1" }).ok).toBe(false); expect(game()).toBe(before);
  });
  it("Bureaucrat selection and reminder commit together; later source death permanently retires the modifier", () => {
    const source = { ...game().players.p0!, actualRole: "bureaucrat", shownRole: "bureaucrat", isTraveler: true };
    store.setState({ game: { ...game(), players: { ...game().players, p0: source } } });
    const seq = state().localSeq;
    expect(act({ kind: "bureaucrat", modifierId: "bureau-1", source: binding("p0"), target: binding("p2") }).ok).toBe(true);
    expect(game().voting!.modifiers).toHaveLength(1); expect(game().players.p2!.reminders).toContainEqual(expect.objectContaining({ label: "3 Votes", sourceCharacter: "bureaucrat" }));
    expect(state().localSeq).toBe(seq + 1);
    state().recordDeath("p0"); expect(game().voting!.modifiers).toEqual([]);
    state().resurrect("p0"); expect(game().voting!.modifiers).toEqual([]);
  });
  it("refuses malformed planned state and leaves token, cursor and Undo untouched", () => {
    begin(); const invalid = { ...game(), notes: undefined } as never; store.setState({ game: invalid });
    const before = game(); const undo = state().undoStack;
    expect(act({ kind: "respond", roundId: "r1", voter: binding("p2"), choice: "yes" }).ok).toBe(false);
    expect(game()).toBe(before); expect(state().undoStack).toBe(undo);
  });
  it("Bureaucrat retarget and removal update only linked notation in the same Undo step", () => {
    store.setState({ game: { ...game(), players: { ...game().players, p0: { ...game().players.p0!, actualRole: "bureaucrat", shownRole: "bureaucrat", isTraveler: true } } } });
    state().addReminder("p2", { label: "3 Votes" });
    expect(act({ kind: "bureaucrat", modifierId: "one", source: binding("p0"), target: binding("p2") }).ok).toBe(true);
    expect(game().players.p2!.reminders.find(r => r.id === "voting-one")?.note).toBe("Day 1 only.");
    const before = game(); const stack = state().undoStack.length;
    expect(act({ kind: "bureaucrat", modifierId: "two", source: binding("p0"), target: binding("p3") }).ok).toBe(true);
    expect(game().players.p2!.reminders).toHaveLength(1);
    expect(game().players.p3!.reminders).toContainEqual(expect.objectContaining({ id: "voting-two" }));
    expect(state().undoStack).toHaveLength(stack + 1);
    state().undo(); expect(game()).toEqual(before);
    expect(act({ kind: "removeModifier", modifierId: "one" }).ok).toBe(true);
    expect(game().voting!.modifiers).toEqual([]); expect(game().players.p2!.reminders).toHaveLength(1);
  });
  it("accepting the first Virgin nomination consumes ability and places official notation atomically", () => {
    store.setState({ game: { ...game(), players: { ...game().players, p1: { ...game().players.p1!, actualRole: "virgin", shownRole: "virgin" } } } });
    const before = game(); const stack = state().undoStack.length; begin();
    expect(game().players.p1!.abilityUsed).toBe(true);
    expect(game().players.p1!.reminders).toContainEqual(expect.objectContaining({ label: "No Ability", sourceCharacter: "virgin" }));
    expect(state().undoStack).toHaveLength(stack + 1);
    state().undo(); expect(game()).toEqual(before);
  });
  it("a browser storage refusal leaves the entire accepted ballot unchanged", () => {
    state().recordDeath("p2"); begin(); const before = game(); const stack = state().undoStack; const seq = state().localSeq;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    expect(act({ kind: "respond", roundId: "r1", voter: binding("p2"), choice: "yes" })).toMatchObject({ ok: false });
    expect(game()).toBe(before); expect(state().undoStack).toBe(stack); expect(state().localSeq).toBe(seq); expect(game().players.p2!.ghostVote).toBe(true);
  });
  it("each successful vote saves once before subscribers see the new state", () => {
    begin(); const write = vi.spyOn(Storage.prototype, "setItem"); let savedAtPublication = false;
    const unsubscribe = store.subscribe(s => { savedAtPublication = JSON.parse(localStorage.getItem("new-blood-st")!).state.game.voting.revision === s.game!.voting!.revision; });
    expect(act({ kind: "respond", roundId: "r1", voter: binding("p2"), choice: "yes" }).ok).toBe(true);
    unsubscribe(); expect(write).toHaveBeenCalledTimes(1); expect(savedAtPublication).toBe(true);
  });
  it("requires the actual live scoped writer and refuses it after stop", async () => {
    const backend = new MemoryRoomBackend(); const code = "VOTE2345";
    await createLobby(backend, "host", { codeGenerator: () => code }); const session = await requireActiveSession(backend, code);
    const writer = new SessionWriter(backend, code, session.id); disposals.push(writer); await writer.start();
    const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
    store.setState({ game: { ...game(), code, storytellerUid: "host" }, lobby });
    useSessionRuntime.setState({ backend: writer, status: "live" }); begin();
    const pending = intent({ kind: "respond", roundId: "r1", voter: binding("p2"), choice: "yes" }); const context = captureVotingContext();
    writer.stop(); const before = game(); expect(state().resolveVoting(pending, context).ok).toBe(false); expect(game()).toBe(before);
  });
});

describe("v27 voting validation and legacy coverage", () => {
  it("migrates each legacy game and Undo snapshot without inventing voting evidence", () => {
    const legacy = structuredClone(game()) as unknown as Record<string, unknown>; delete legacy.voting; legacy.gameSchemaVersion = 26;
    const result = migrateStoreState({ game: legacy, undoStack: [structuredClone(legacy)], customScripts: { [setupScript.id]: setupScript } }, 26) as ReturnType<typeof store.getState>;
    expect(result.game!.gameSchemaVersion).toBe(GAME_SCHEMA_VERSION); expect(result.undoStack[0]!.gameSchemaVersion).toBe(GAME_SCHEMA_VERSION);
    expect(result.game!.voting).toBeUndefined(); expect(currentVotingState(result.game!).coverage).toBe("unknown");
  });
  it.each([null, {}, { rounds: [] }])("rejects present malformed voting instead of defaulting (%j)", value => {
    const candidate = { ...game(), voting: value }; expect(StorytellerGamePersistedSchema.safeParse(candidate).success).toBe(false);
    const stale = { ...candidate, gameSchemaVersion: 26 }; migrateGameEntry(stale, 26, { kind: "canonical-only" }); expect(stale.gameSchemaVersion).toBe(26);
    const markerless = { ...candidate } as Record<string, unknown>; delete markerless.gameSchemaVersion; expect(detectLegacyGameVersion(markerless)).toBe(27);
  });
  it("creates known coverage only on a witnessed new Day, with Undo restoring the Night", () => {
    store.setState({ game: { ...game(), phase: "night", day: 2, voting: freshVotingDay(1) } }); const previous = game();
    expect(state().advancePhase().ok).toBe(true); expect(game().voting).toMatchObject({ day: 2, coverage: "known", rounds: [] });
    state().undo(); expect(game().voting).toEqual(previous.voting); expect(game().phase).toBe("night");
  });
});
