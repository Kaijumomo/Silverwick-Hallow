import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRegistry } from "@/data/roleRegistry";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { bind, homebrewScript, openInStore, patchPlayer, pick, proofGame, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import { officialEffectPresentation } from "@/features/reminders/officialReminderPresentation";
import { captureCharacterActionContext, useStorytellerStore as store } from "./storytellerStore";
import { createRulesQuery, type RulesQueryEnvironment } from "./rulesQuery";
import { StorytellerGamePersistedSchema } from "./schemas";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { usePrivacyStore } from "./privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";

// Independent boundary oracle: the single self-reference is the approved
// exception. Arbitrary source cycles and unverified character semantics must
// remain unknown; external impairment remains effective, without stored flags.
const state = () => store.getState();
const game = () => state().game!;
const environment = { registry: proofRegistry, script: proofScript };
const query = (env: RulesQueryEnvironment = environment) => createRulesQuery(game(), env);
const action = () => request(game(), "p0", "poisoner", { target: pick(game(), "p0") }, { withStep: true, completeStep: true });
const selfPoison = () => {
  expect(state().resolveAbility(action(), undefined, captureCharacterActionContext())).toMatchObject({ ok: true, changed: true });
  return game().players.p0!.effects[0]!;
};
const sourced = (source: string) => ({ type: "poisoned", source: bind(game(), source), sourceCharacter: "poisoner", lifetime: { kind: "throughFollowingDay" as const } });
beforeEach(() => {
  localStorage.clear(); usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null, finishedGameUndo: null, canUndoFinishedGame: false, sync: null });
  openInStore(proofGame(["poisoner", "poisoner", "chef", "monk", "imp"]));
});
afterEach(() => vi.restoreAllMocks());

describe("B9 independent Poisoner self-source boundary", () => {
  it("ordinary command publishes one complete transaction, survives local reload, and Undo restores the pending Night", async () => {
    const before = game(), undo = state().undoStack.length, seq = state().localSeq;
    const write = vi.spyOn(Storage.prototype, "setItem"); const effect = selfPoison();
    expect(write).toHaveBeenCalledTimes(1); expect(state().undoStack).toHaveLength(undo + 1); expect(state().localSeq).toBe(seq + 1);
    expect(query().effectApplies(bind(game(), "p0"), effect)).toEqual({ known: true, value: true });
    expect(query().abilityFunctions(bind(game(), "p0"))).toEqual({ known: true, value: false });
    expect(Object.values(game().nightProgress)).toContainEqual(expect.objectContaining({ status: "done" }));
    const accepted = game(), saved = localStorage.getItem("new-blood-st")!;
    store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
    expect(game()).toEqual(accepted); expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
    expect(query().effectApplies(bind(game(), "p0"), effect)).toEqual({ known: true, value: true });
    for (const projection of [projectLobbyToPublic(game(), {}), projectLobbyToSelfMap(game(), proofRegistry)])
      expect(JSON.stringify(projection)).not.toMatch(/effects|sourceParticipant|throughFollowingDay|nightProgress/);
    state().undo(); expect(game()).toEqual(before);
  });

  it.each(["privacy", "stale", "storage"])("%s refusal cannot partly poison self or complete Night", refusal => {
    const command = action(), context = captureCharacterActionContext();
    if (refusal === "privacy") usePrivacyStore.getState().setEnabled(true);
    if (refusal === "stale") state().setNotes("p0", "Changed after opening action");
    if (refusal === "storage") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
    const before = state();
    expect(state().resolveAbility(command, undefined, context)).toMatchObject({ ok: false }); expect(state()).toBe(before);
    expect(game().players.p0!.effects).toEqual([]); expect(game().nightProgress).toEqual({});
  });

  it.each(["homebrew", "missing", "undeclared"])("%s Poisoner semantics cannot acquire the official self-source exception", variant => {
    const effect = selfPoison(); let env: RulesQueryEnvironment;
    if (variant === "homebrew") { const script = homebrewScript("poisoner", { ability: "A different custom ability" }); env = { script, registry: buildRegistry(script) }; }
    else {
      const semantics = new Map(CANONICAL_ABILITY_SEMANTICS);
      if (variant === "missing") semantics.delete("poisoner");
      else semantics.set("poisoner", { ...semantics.get("poisoner")!, sourcedEffects: [] });
      env = { ...environment, semantics };
    }
    expect(query(env).effectApplies(bind(game(), "p0"), effect)).toMatchObject({ known: false });
    expect(game().players.p0!.effects).toEqual([effect]);
  });

  it("two external source dependencies stay unknown instead of becoming a global fixed-point solver", () => {
    const self = selfPoison();
    expect(state().resolveEffects({ intents: [
      { kind: "apply", target: bind(game(), "p0"), effect: sourced("p1") },
      { kind: "apply", target: bind(game(), "p1"), effect: sourced("p0") },
    ] }, captureCharacterActionContext())).toMatchObject({ ok: true });
    const saved = JSON.stringify(game());
    for (const player of ["p0", "p1"]) {
      expect(query().abilityFunctions(bind(game(), player))).toMatchObject({ known: false });
      for (const effect of game().players[player]!.effects) expect(query().effectApplies(bind(game(), player), effect)).toMatchObject({ known: false });
    }
    expect(query().effectApplies(bind(game(), "p0"), self)).toMatchObject({ known: false });
    expect(JSON.stringify(game())).toBe(saved);
  });

  it("overlapping self and external poison retain two source identities behind one token; correction/Undo does not merge them", () => {
    const self = selfPoison();
    expect(state().resolveEffects({ intents: [{ kind: "apply", target: bind(game(), "p0"), effect: sourced("p1") }] }, captureCharacterActionContext())).toMatchObject({ ok: true });
    const overlap = game(); const external = game().players.p0!.effects.find(effect => effect.id !== self.id)!;
    expect(external.sourceParticipant).not.toEqual(self.sourceParticipant);
    expect(query().effectApplies(bind(game(), "p0"), self)).toEqual({ known: true, value: false });
    expect(query().effectApplies(bind(game(), "p0"), external)).toEqual({ known: true, value: true });
    const presentation = officialEffectPresentation(game().players.p0!, { query: query(), target: bind(game(), "p0") });
    expect(presentation.tokens).toHaveLength(1); expect(presentation.tokens[0]!.instances).toHaveLength(2);
    expect(state().resolveEffects({ intents: [{ kind: "correctRemove", target: bind(game(), "p0"), effectId: external.id }] }, captureCharacterActionContext())).toMatchObject({ ok: true });
    expect(game().players.p0!.effects).toEqual([self]); expect(query().effectApplies(bind(game(), "p0"), self)).toEqual({ known: true, value: true });
    state().undo(); expect(game()).toEqual(overlap); expect(game().players.p0!.effects).toHaveLength(2);
  });

  it("correction removing self-poison restores functioning without reopening its completed Night action", () => {
    const self = selfPoison(), accepted = game();
    expect(state().resolveEffects({ intents: [{ kind: "correctRemove", target: bind(game(), "p0"), effectId: self.id }] }, captureCharacterActionContext())).toMatchObject({ ok: true });
    expect(query().abilityFunctions(bind(game(), "p0"))).toEqual({ known: true, value: true }); expect(game().nightProgress).toEqual(accepted.nightProgress);
    expect(state().resolveAbility(action(), undefined, captureCharacterActionContext())).toMatchObject({ ok: false });
    state().undo(); expect(game()).toEqual(accepted);
  });

  it("same-seat stale participation cannot be treated as self, even with an official source label", () => {
    const self = selfPoison();
    const replaced = patchPlayer(game(), "p0", { participantId: "replacement-poisoner" });
    expect(createRulesQuery(replaced, environment).effectApplies(bind(replaced, "p0"), self)).toMatchObject({ known: false });
    expect(replaced.players.p0!.effects[0]).toBe(self);
  });
});
