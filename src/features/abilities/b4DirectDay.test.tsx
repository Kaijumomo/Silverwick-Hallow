// Slayer Day shot rules at the coordinator: one commit for consumption, death and Scarlet Woman succession, a Recluse
// registration ruling that resolves the whole shot once, and a pending ruling that cannot commit after the table changed.
//
// Package 4: the Player Drawer "Use ability…" entry and the held board picker are retired. The unified Grimoire's
// Slayer face-off (grimoire-v6/day/slayer.tsx) issues exactly these requests, so they are driven directly.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { registersAsDemonJudgment } from "@/abilities/characters/slayer";
import { captureFingerprint, type AbilityResolutionRequest } from "@/stores/abilityResolution";
import { impair, proofGame, proofScript } from "@/test/proofFixtures";
import type { RoleId } from "@/stores/types";

const game = () => store.getState().game!;
const binding = (id: string) => ({ playerId: id, participantId: game().players[id]!.participantId! });
const shot = (target: string, extra: Record<string, unknown> = {}): AbilityResolutionRequest => ({
  mode: "guided", invocationPath: "dayEntry", fingerprint: captureFingerprint(game(), "p0")!, roleId: "slayer",
  inputs: { target: { kind: "participant", participants: [binding(target)] }, ...extra },
} as AbilityResolutionRequest);
const fire = (request: AbilityResolutionRequest) => store.getState().resolveAbility(request, CANONICAL_ABILITY_SEMANTICS);
const install = (roles: RoleId[]) => store.setState({ game: proofGame(roles, "day", 2), lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });

beforeEach(() => {
  install(["slayer", "imp", "scarletwoman", "chef", "monk"]);
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
});
afterEach(() => { usePrivacyStore.setState({ enabled: false }); });

describe("Slayer shot at the Demon", () => {
  it("commits consumption, Imp death and mandatory succession once, and Undo restores them together", () => {
    const before = game();
    expect(fire(shot("p1")).ok).toBe(true);
    expect(game().players.p0!.abilityUsed).toBe(true);
    expect(game().players.p1!.alive).toBe(false);
    expect(game().players.p2!.actualRole).toBe("imp");
    expect(store.getState().undoStack).toHaveLength(1);
    act(() => store.getState().undo());
    expect(game().players.p0!.abilityUsed).toBe(before.players.p0!.abilityUsed);
    expect(game().players.p1!.alive).toBe(true);
    expect(game().players.p2!.actualRole).toBe("scarletwoman");
  });
});

describe("Recluse registration ruling", () => {
  beforeEach(() => install(["slayer", "imp", "recluse", "scarletwoman", "monk"]));

  it("without a ruling the shot asks for one and changes nothing", () => {
    const before = game();
    const result = fire(shot("p2"));
    expect(result).toMatchObject({ ok: false, code: "needsInput" });
    expect(game()).toBe(before);
    expect(store.getState().undoStack).toHaveLength(0);
  });

  it.each([false, true])("ruling %s resolves the entire shot once without Demon succession", (demon) => {
    const judgment = registersAsDemonJudgment(game().players.p2!.participantId!);
    expect(fire(shot("p2", { [judgment]: { kind: "boolean", value: demon } })).ok).toBe(true);
    expect(game().players.p0!.abilityUsed).toBe(true);
    expect(game().players.p2).toMatchObject({ alive: !demon, actualRole: "recluse", actualAlignment: "good" });
    expect(game().players.p1).toMatchObject({ alive: true, actualRole: "imp" });
    expect(game().players.p3!.actualRole).toBe("scarletwoman");
    expect(store.getState().undoStack).toHaveLength(1);
    act(() => store.getState().undo());
    expect(game().players.p0!.abilityUsed).toBe(false);
    expect(game().players.p2!.alive).toBe(true);
  });

  it.each(["state change", "reseat"])("a ruling held across a %s cannot commit", (change) => {
    const held = shot("p2", { [registersAsDemonJudgment(game().players.p2!.participantId!)]: { kind: "boolean", value: true } });
    if (change === "state change") act(() => store.setState({ game: { ...game(), day: 3 } }));
    if (change === "reseat") act(() => store.setState({ game: { ...game(), players: { ...game().players, p0: { ...game().players.p0!, shownRole: "chef" } } } }));
    const before = game();
    expect(fire(held).ok).toBe(false);
    expect(game()).toBe(before);
    expect(store.getState().undoStack).toHaveLength(0);
  });
});

describe("Slayer shot while impaired, dead or spent (ported from the retired popover R1 tests)", () => {
  it("a poisoned Slayer spends one shot without a death, and Undo restores it", () => {
    const g = impair(proofGame(["slayer", "imp", "chef", "monk", "soldier"], "day"), "p0");
    store.setState({ game: g, undoStack: [], localSeq: 0 });
    expect(fire(shot("p1")).ok).toBe(true);
    expect(game().players.p0!.abilityUsed).toBe(true);
    expect(game().players.p1!.alive).toBe(true);
    expect(store.getState().undoStack).toHaveLength(1);
    act(() => store.getState().undo());
    expect(game()).toEqual(g);
  });

  it.each(["dead", "spent"])("a %s Slayer has no ordinary shot: nothing is recorded", (condition) => {
    const g = proofGame(["slayer", "imp", "chef", "monk", "soldier"], "day");
    if (condition === "dead") g.players.p0!.alive = false; else g.players.p0!.abilityUsed = true;
    store.setState({ game: g, undoStack: [], localSeq: 0 });
    const before = game();
    expect(fire(shot("p1")).ok).toBe(false);
    expect(game()).toBe(before);
    expect(store.getState().undoStack).toHaveLength(0);
  });
});
