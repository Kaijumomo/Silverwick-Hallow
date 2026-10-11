import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { bind, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, proofQuery, proofRegistry, proofScript, request, reseat } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { StorytellerGamePersistedSchema } from "./schemas";
import { planLifeTransaction, applyLifePlan } from "./lifeResolution";
import { applyRolePlan, changeRoleIntent, defaultRoleIds, planRoleTransaction } from "./roleResolution";
import { officialEffectPresentation } from "@/features/reminders/officialReminderPresentation";
import { PopoverReminders } from "@/features/players/PopoverReminders";

const game = () => store.getState().game!;
const base = (day = 2) => proofGame(["poisoner", "chef", "empath", "imp", "saint"], "night", day);
const produce = (day = 2) => {
  const before = base(day);
  return planned(plan(before, request(before, "p0", "poisoner", { target: pick(before, "p0") }, { withStep: true, completeStep: true })));
};
const applies = (g: ReturnType<typeof base>) => proofQuery(g).effectApplies(bind(g, "p0"), g.players.p0!.effects[0]!);
const tokens = (g: ReturnType<typeof base>) => officialEffectPresentation(g.players.p0!, { query: proofQuery(g), target: bind(g, "p0") }).tokens;
beforeEach(() => { usePrivacyStore.setState({ enabled: false }); store.setState({ terminalClose: null }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("B9 canonical Poisoner self-target", () => {
  it.each([1, 4])("Night %s retains one official poison through the following Day and expires at dusk, with Undo", day => {
    openInStore(produce(day));
    expect(applies(game())).toEqual({ known: true, value: true });
    expect(tokens(game())).toEqual([expect.objectContaining({ label: "Poisoned", detail: "Poisoned: Currently affecting this player" })]);
    expect(game().players.p0!.reminders).toEqual([]);
    expect(store.getState().advancePhase()).toMatchObject({ ok: true });
    expect(game().phase).toBe("day");
    expect(applies(game())).toEqual({ known: true, value: true });
    const beforeDusk = game();
    expect(store.getState().advancePhase()).toMatchObject({ ok: true });
    expect(game()).toMatchObject({ phase: "night", day: day + 1 });
    expect(game().players.p0!.effects).toEqual([]);
    expect(tokens(game())).toEqual([]);
    expect(proofQuery(game()).abilityFunctions(bind(game(), "p0"))).toEqual({ known: true, value: true });
    store.getState().undo();
    expect(game()).toEqual(beforeDusk);
    expect(applies(game())).toEqual({ known: true, value: true });
  });

  it.each(["poisoned", "drunk", "abilityLost"])("outside %s suspends self-poison; removing it resumes the same effect", type => {
    const self = produce(); const effect = self.players.p0!.effects[0]!;
    const interrupted = impair(self, "p0", type);
    expect(applies(interrupted)).toEqual({ known: true, value: false });
    expect(proofQuery(interrupted).abilityFunctions(bind(interrupted, "p0"))).toEqual({ known: true, value: false });
    const resumed = patchPlayer(interrupted, "p0", { effects: [effect] });
    expect(applies(resumed)).toEqual({ known: true, value: true });
    expect(resumed.players.p0!.effects[0]).toBe(effect);
  });

  it.each(["poisoned", "drunk"])("already %s self-selection completes without an effect that could revive later", type => {
    const before = impair(base(), "p0", type);
    const next = planned(plan(before, request(before, "p0", "poisoner", { target: pick(before, "p0") }, { withStep: true, completeStep: true })));
    expect(next.players.p0!.effects).toEqual(before.players.p0!.effects);
    expect(Object.values(next.nightProgress)[0]?.status).toBe("done");
    expect(patchPlayer(next, "p0", { effects: [] }).players.p0!.effects).toEqual([]);
  });

  it("death followed by resurrection cannot revive self-poison; Undo restores the complete living source", () => {
    const self = produce(); openInStore(self);
    expect(store.getState().recordDeath("p0")).toMatchObject({ ok: true, changed: true });
    expect(game().players.p0!.effects).toEqual([]);
    expect(tokens(game())).toEqual([]);
    store.getState().undo(); expect(game()).toEqual(self);
    const result = planLifeTransaction(self, { intents: [{ kind: "death", playerId: "p0" }, { kind: "resurrection", playerId: "p0" }] }, undefined,
      { registry: proofRegistry, script: proofScript });
    if (!result.ok || !result.changed) throw new Error("Expected Life transition");
    expect(applyLifePlan(self, result.plan).players.p0!.effects).toEqual([]);
  });

  it("character loss removes the effect and participant replacement never inherits source authority", () => {
    const self = produce();
    const role = planRoleTransaction(self, { intents: [changeRoleIntent(self.players.p0!, "imp")] }, { script: proofScript, ids: defaultRoleIds });
    if (!role.ok || !role.changed) throw new Error("Expected character change");
    expect(applyRolePlan(self, role.plan).players.p0!.effects).toEqual([]);
    const replaced = reseat(self, "p0");
    expect(proofQuery(replaced).effectApplies(bind(replaced, "p0"), self.players.p0!.effects[0]!)).toMatchObject({ known: false });
  });

  it("unknown interaction refuses the entire action, including Night completion", () => {
    const before = impair(base(), "p0", "soberHealthy");
    const snapshot = JSON.stringify(before);
    expect(plan(before, request(before, "p0", "poisoner", { target: pick(before, "p0") }, { withStep: true, completeStep: true }))).toMatchObject({ ok: false, code: "unsupported" });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("v28 serialization preserves derived self-poison without a stored applicability flag", () => {
    const self = produce();
    const restored = StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(self)));
    expect(restored).toEqual(self);
    expect(applies(restored)).toEqual({ known: true, value: true });
    expect(proofQuery(restored).abilityFunctions(bind(restored, "p0"))).toEqual({ known: true, value: false });
    expect(tokens(restored)).toHaveLength(1);
  });

  it("self-poison uses the unchanged two-tap three-second removal, with Undo restoring poison and completed Night", () => {
    vi.useFakeTimers(); openInStore(produce());
    function View() { return <PopoverReminders player={store(s => s.game!.players.p0!)} />; }
    render(<View />);
    const button = () => screen.getByRole("button", { name: "Remove Poisoned effect from Poisoner" });
    const before = game();
    fireEvent.click(button()); expect(game()).toBe(before);
    expect(button()).toHaveAttribute("data-removal-armed", "true");
    act(() => vi.advanceTimersByTime(3000));
    expect(button()).not.toHaveAttribute("data-removal-armed");
    fireEvent.click(button()); expect(game()).toBe(before);
    fireEvent.click(button());
    expect(game().players.p0!.effects).toEqual([]);
    expect(game().nightProgress).toEqual(before.nightProgress);
    expect(store.getState().undoStack).toHaveLength(1);
    act(() => store.getState().undo());
    expect(game()).toEqual(before);
    expect(applies(game())).toEqual({ known: true, value: true });
    expect(screen.getAllByRole("button", { name: "Remove Poisoned effect from Poisoner" })).toHaveLength(1);
  });
});
