import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bind, impair, openInStore, patchPlayer, pick, proofGame, proofRegistry, request } from "@/test/proofFixtures";
import { captureCharacterActionContext, useStorytellerStore as store } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { changeRoleIntent, correctRoleIntent } from "./roleResolution";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { StorytellerGamePersistedSchema } from "./schemas";

// Independent oracle: https://wiki.bloodontheclocktower.com/Slayer
// Official ability use is spent after any valid shot, even impaired or failed.
// Tokens are removable notation; Life's abilityUsed remains the authority.
const state = () => store.getState();
const game = () => state().game!;
const base = () => proofGame(["slayer", "imp", "scarletwoman", "poisoner", "chef"], "day", 2);
const tokens = () => game().players.p0!.reminders.filter(r => r.label === "No Ability" && r.sourceCharacter === "slayer");
const shoot = (target = "p4") => state().resolveAbility(request(game(), "p0", "slayer", { target: pick(game(), target) }));
beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
  usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
  openInStore(base());
});
afterEach(() => vi.restoreAllMocks());

describe("B7 independent Slayer ability and notation boundary", () => {
  it.each(["failed", "poisoned", "drunk", "dead-target", "self"])("%s valid shot spends use and adds official notation atomically", variant => {
    if (variant === "poisoned" || variant === "drunk") openInStore(impair(game(), "p0", variant));
    if (variant === "dead-target") openInStore(patchPlayer(game(), "p1", { alive: false }));
    const before = game(); const seq = state().localSeq;
    expect(shoot(variant === "dead-target" ? "p1" : variant === "self" ? "p0" : "p4")).toMatchObject({ ok: true });
    expect(game().players.p0!.abilityUsed).toBe(true); expect(tokens()).toHaveLength(1);
    expect(tokens()[0]!.sourceParticipant).toMatchObject({ participantId: before.players.p0!.participantId });
    expect(game().lifeEventWindow.events).toEqual([]);
    expect(state().undoStack).toEqual([before]); expect(state().localSeq).toBe(seq + 1);
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
    state().undo(); expect(game().players.p0!.abilityUsed).toBe(false); expect(tokens()).toEqual([]);
  });

  it("Demon death, Scarlet Woman succession, consumed use and token publish together", () => {
    const before = game(); let publications = 0;
    const stop = store.subscribe(s => {
      publications++;
      expect(s.game!.players.p0!.abilityUsed).toBe(true);
      expect(s.game!.players.p0!.reminders.some(r => r.label === "No Ability")).toBe(true);
      expect(s.game!.players.p1!.alive).toBe(false);
      expect(s.game!.players.p2!.actualRole).toBe("imp");
      expect(JSON.parse(localStorage.getItem("new-blood-st")!).state.game).toEqual(s.game);
    });
    try { expect(shoot("p1")).toMatchObject({ ok: true }); } finally { stop(); }
    expect(publications).toBe(1); expect(state().undoStack).toEqual([before]); expect(tokens()).toHaveLength(1);
    expect(game().lifeEventWindow.events).toHaveLength(1);
  });

  it("removing notation does not refund or recreate it on unrelated changes", () => {
    expect(shoot()).toMatchObject({ ok: true });
    expect(state().removeReminder("p0", tokens()[0]!.id)).toMatchObject({ ok: true });
    expect(game().players.p0!.abilityUsed).toBe(true); expect(tokens()).toEqual([]);
    state().setNotes("p4", "Discussion"); expect(tokens()).toEqual([]);
    const before = game(); expect(shoot()).toMatchObject({ ok: false }); expect(game()).toBe(before);
  });

  it("manual equivalent notation is preserved when a shot is consumed", () => {
    expect(state().resolveReminders({ intents: [{ kind: "place", target: bind(game(), "p0"), reminder: { label: "No Ability", sourceCharacter: "slayer" } }] })).toMatchObject({ ok: true });
    const manual = tokens()[0]!;
    expect(shoot()).toMatchObject({ ok: true });
    expect(game().players.p0!.reminders).toContainEqual(manual);
    // One or multiple underlying sources are acceptable; presentation owns deduplication.
    expect(game().players.p0!.abilityUsed).toBe(true);
  });

  it("role correction preserves used state; real role change resets it without altering unrelated notation", () => {
    expect(shoot()).toMatchObject({ ok: true });
    expect(state().resolveRoles({ intents: [correctRoleIntent(game().players.p0!, "chef")] })).toMatchObject({ ok: true });
    expect(game().players.p0!.abilityUsed).toBe(true);
    expect(state().resolveRoles({ intents: [changeRoleIntent(game().players.p0!, "slayer")] })).toMatchObject({ ok: true });
    expect(game().players.p0!.abilityUsed).toBe(false); expect(tokens()).toEqual([]);
    expect(shoot()).toMatchObject({ ok: true }); expect(tokens()).toHaveLength(1);
  });

  it("resurrection resets use through Life and retires generated consumed notation", () => {
    expect(shoot()).toMatchObject({ ok: true });
    expect(state().recordDeath("p0")).toMatchObject({ ok: true });
    expect(game().players.p0!.abilityUsed).toBe(true);
    expect(state().resurrect("p0")).toMatchObject({ ok: true });
    expect(game().players.p0!.abilityUsed).toBe(false); expect(tokens()).toEqual([]);
    expect(shoot()).toMatchObject({ ok: true });
  });

  it("reminder removal and reload retain spent authority and private projections", async () => {
    const publicBefore = projectLobbyToPublic(game(), {}); const selfBefore = projectLobbyToSelfMap(game(), proofRegistry);
    expect(shoot()).toMatchObject({ ok: true }); expect(state().removeReminder("p0", tokens()[0]!.id)).toMatchObject({ ok: true });
    const saved = localStorage.getItem("new-blood-st")!; const expected = game();
    store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
    expect(game()).toEqual(expected); expect(shoot()).toMatchObject({ ok: false });
    expect(projectLobbyToPublic(game(), {})).toEqual(publicBefore); expect(projectLobbyToSelfMap(game(), proofRegistry)).toEqual(selfBefore);
  });

  it.each(["privacy", "storage", "stale"])("%s refusal leaves ability and token unmodified", variant => {
    const action = request(game(), "p0", "slayer", { target: pick(game(), "p4") }); const context = captureCharacterActionContext();
    if (variant === "privacy") usePrivacyStore.getState().setEnabled(true);
    if (variant === "stale") state().setNotes("p4", "Changed");
    if (variant === "storage") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Full disk"); });
    const before = state(); expect(state().resolveAbility(action, undefined, context)).toMatchObject({ ok: false });
    expect(state()).toBe(before); expect(tokens()).toEqual([]); expect(game().players.p0!.abilityUsed).toBe(false);
  });
});
