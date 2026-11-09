// Effect and notation removal through the unified Grimoire's mark command (board/marks.ts removeMark).
// Replaces the retired PopoverReminders tests (b2, drunkRemoval, b9 self-poison removal, B2 removal-after-information): the
// two-tap arming UI is covered in vm/board.test; these are the command rules behind it.
import { renderHook } from "@testing-library/react";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { registerVotingAuthorityReader } from "@/firebase/votingAuthority";
import { createRulesQuery } from "@/stores/rulesQuery";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { useV6Ctx } from "../ctx";
import { playerMarks, removeMark, type Mark } from "./marks";

const state = () => store.getState();
const game = () => state().game!;
const marks = (id = "p0"): Mark[] => renderHook(() => {
  const g = store((s) => s.game)!;
  const ctx = useV6Ctx(g);
  const query = ctx.script ? createRulesQuery(g, { script: ctx.script, registry: ctx.registry }) : null;
  return playerMarks({ game: g, script: ctx.script, registry: ctx.registry, query }, g.players[id]!);
}).result.current;
const markNamed = (label: RegExp, id = "p0") => marks(id).find((m) => label.test(m.label))!;
const remove = (mark: Mark, id = "p0", participantId = game().players[id]!.participantId) => removeMark(id, participantId, mark);

const apply = (id: string, type: string, sourceCharacter: string, source: string, lifetime: object = { kind: "manual" }) =>
  expect(state().resolveEffects({ intents: [{ kind: "apply", target: { playerId: "p0", participantId: game().players.p0!.participantId! },
    effect: { id, type, sourceCharacter, source: { playerId: source, participantId: game().players[source]!.participantId! }, lifetime } }] } as never).ok).toBe(true);

beforeEach(() => {
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: setupGame(["chef", "poisoner", "monk", "imp"], { phase: "night", day: 2 }), lobby: null, undoStack: [], localSeq: 0, terminalClose: null,
    customScripts: { [setupScript.id]: setupScript } });
  apply("poison", "poisoned", "poisoner", "p1");
  apply("safe", "safeFromDemon", "monk", "p2", { kind: "untilDawn" });
  store.setState({ undoStack: [] });
});
afterEach(() => { registerVotingAuthorityReader(() => null); });

describe("effect mark removal", () => {
  it.each([["Poisoned", "safe"], ["Safe", "poison"]])("removes only the exact %s effect, records one Undo, and preserves completed gameplay", (label, remaining) => {
    const before = game();
    expect(remove(markNamed(new RegExp(label)))).toEqual({ ok: true });
    expect(game().players.p0!.effects.map((e) => e.id)).toEqual([remaining]);
    expect(game().nightProgress).toEqual(before.nightProgress);
    expect(game().informationDeliveries).toEqual(before.informationDeliveries);
    expect(game().players.p0!.alive).toBe(before.players.p0!.alive);
    expect(state().undoStack).toHaveLength(1);
    act(() => state().undo());
    expect(game()).toEqual(before);
  });

  it.each([false, true])("keeps one mark but refuses an ambiguous removal and preserves independent records (suppressed: %s)", (suppressed) => {
    apply("second", "poisoned", "poisoner", "p1");
    if (suppressed) expect(state().resolveEffects({ intents: [{ kind: "suppress", target: { playerId: "p0", participantId: game().players.p0!.participantId! }, effectId: "second" }] }).ok).toBe(true);
    expect(marks().filter((m) => /Poisoned/.test(m.label))).toHaveLength(1);
    const before = state();
    expect(remove(markNamed(/Poisoned/))).toMatchObject({ ok: false, message: expect.stringMatching(/More than one effect/) });
    expect(state()).toBe(before);
    expect(game().players.p0!.effects).toHaveLength(3);
  });

  it("same-label notation is inert: removing it leaves the Effect alone", () => {
    const target = { playerId: "p0", participantId: game().players.p0!.participantId! };
    state().resolveReminders({ intents: [{ kind: "place", target, reminder: { id: "effect:poisoner:poisoned", label: "Poisoned", sourceCharacter: "poisoner" } }] });
    const before = game();
    const notation = marks().find((m) => m.kind === "notation")!;
    expect(remove(notation)).toEqual({ ok: true });
    expect(game().players.p0!.reminders).toHaveLength(0);
    expect(game().players.p0!.effects).toEqual(before.players.p0!.effects);
  });

  it("refuses a stale rendered participant and changes nothing", () => {
    const mark = markNamed(/Poisoned/);
    const before = state();
    expect(remove(mark, "p0", "someone-else")).toMatchObject({ ok: false });
    expect(state()).toBe(before);
  });

  it("refuses removal in ended games", () => {
    const mark = markNamed(/Poisoned/);
    act(() => { store.setState({ game: { ...game(), phase: "ended" } }); });
    const before = state();
    expect(remove(mark)).toMatchObject({ ok: false });
    expect(state().game).toBe(before.game);
  });

  it("removing poison after later information does not rewrite the completed action or what was communicated", () => {
    store.setState({ game: { ...game(), players: { ...game().players, p1: { ...game().players.p1!, effects: [] } } } });
    expect(state().resolveAbility({ mode: "manual", reason: "Information already communicated", outcome: { operations: [
      { domain: "manualInformation", recipient: { playerId: "p1", participantId: game().players.p1!.participantId! }, text: "The Storyteller communicated one evil pair." },
    ] } })).toMatchObject({ ok: true, changed: true });
    const before = game();
    expect(before.informationDeliveries).toHaveLength(1);
    expect(remove(markNamed(/Poisoned/))).toEqual({ ok: true });
    expect(game().informationDeliveries).toEqual(before.informationDeliveries);
    expect(game().nightProgress).toEqual(before.nightProgress);
    expect(game().lifeEventWindow).toEqual(before.lifeEventWindow);
    for (const [id, player] of Object.entries(before.players)) {
      expect(game().players[id]!.alive).toBe(player.alive);
      expect(game().players[id]!.abilityUsed).toBe(player.abilityUsed);
    }
    expect(game().history.slice(0, before.history.length)).toEqual(before.history);
    expect(game().history.at(-1)).toMatchObject({ category: "effect", effectOperation: "remove" });
    expect(game().history.at(-1)?.correction).not.toBe(true);
  });
});
