import { expect, it } from "vitest";
import { applyLifePlan, planLifeTransaction } from "@/stores/lifeResolution";
import { bind, patchPlayer, pick, plan, planned, proofGame, proofQuery, request } from "@/test/proofFixtures";

it("Monk-protected Imp self-kill with five living players does not kill or create a Scarlet Woman successor", () => {
  const initial = proofGame(["monk", "imp", "scarletwoman", "poisoner", "chef"]);
  const protectedGame = planned(plan(initial, request(initial, "p0", "monk", { target: pick(initial, "p1") }, { withStep: true, completeStep: true })));
  const next = planned(plan(protectedGame, request(protectedGame, "p1", "imp", { target: pick(protectedGame, "p1") }, { withStep: true, completeStep: true })));
  expect(next.players.p1!.alive).toBe(true);
  expect(next.players.p2!.actualRole).toBe("scarletwoman");
  expect(next.players.p3!.actualRole).toBe("poisoner");
  expect(next.lifeEventWindow).toEqual(protectedGame.lifeEventWindow);
  expect(Object.values(next.nightProgress).map(step => step.status)).toEqual(["done", "done"]);
  expect(Object.values(next.players).filter(player => player.actualRole === "imp")).toHaveLength(1);
});

it("the actual Life execution command remains authoritative despite a stored Monk protection", () => {
  const initial = proofGame(["monk", "chef", "imp", "poisoner", "soldier"]);
  const protectedGame = planned(plan(initial, request(initial, "p0", "monk", { target: pick(initial, "p1") })));
  expect(proofQuery(protectedGame).protectedFrom(bind(protectedGame, "p1"), "any")).toEqual({ known: true, value: false });
  // Even a Safe effect explicitly retained through manual correction must not
  // become execution immunity. Ordinary automatic Safe expires at dawn.
  const dayGame = { ...patchPlayer(protectedGame, "p1", { effects: protectedGame.players.p1!.effects.map(effect => ({
    ...effect, lifetime: { kind: "manual" as const }, expiry: { kind: "none" as const },
  })) }), phase: "day" as const };
  expect(proofQuery(dayGame).protectedFrom(bind(dayGame, "p1"), "demon")).toEqual({ known: true, value: true });
  const result = planLifeTransaction(dayGame, { intents: [{ kind: "execution", playerId: "p1", outcome: "died" }] });
  expect(result).toMatchObject({ ok: true, changed: true });
  if (!result.ok || !result.changed) throw new Error("Execution refused");
  const next = applyLifePlan(dayGame, result.plan);
  expect(next.players.p1!.alive).toBe(false);
  expect(next.lifeEventWindow.events.at(-1)).toMatchObject({ kind: "execution" });
  expect(next.players.p1!.effects).toEqual(dayGame.players.p1!.effects);
});

it("a stale Monk source cannot make an otherwise discretionary Mayor attack automatic", () => {
  const initial = proofGame(["monk", "mayor", "imp", "poisoner", "chef"]);
  const protectedGame = planned(plan(initial, request(initial, "p0", "monk", { target: pick(initial, "p1") })));
  const missingSource = patchPlayer(protectedGame, "p0", { participantId: "replacement-participant" });
  const before = JSON.stringify(missingSource);
  expect(proofQuery(missingSource).protectedFrom(bind(missingSource, "p1"), "demon").known).toBe(false);
  expect(plan(missingSource, request(missingSource, "p2", "imp", { target: pick(missingSource, "p1") }, { withStep: true, completeStep: true })))
    .toMatchObject({ ok: false, code: "unsupported" });
  expect(JSON.stringify(missingSource)).toBe(before);
});

it("suppressed Monk protection never bypasses the Mayor's unresolved death interaction", () => {
  const initial = proofGame(["monk", "mayor", "imp", "poisoner", "chef"]);
  const protectedGame = planned(plan(initial, request(initial, "p0", "monk", { target: pick(initial, "p1") })));
  const suppressed = patchPlayer(protectedGame, "p1", { effects: protectedGame.players.p1!.effects.map(effect => ({ ...effect, state: "suppressed" })) });
  expect(plan(suppressed, request(suppressed, "p2", "imp", { target: pick(suppressed, "p1") }, { withStep: true, completeStep: true })))
    .toMatchObject({ ok: false, code: "unsupported" });
  expect(suppressed.players.p1!.alive).toBe(true); expect(suppressed.nightProgress).toEqual({});
});
