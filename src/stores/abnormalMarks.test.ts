// SV-5g1 -- the Mathematician's ABNORMAL mark (PO Q7 A, Q17 A, Q18 A; proposal sections 39-42): one Effect per affected player, a
// recorded Storyteller fact, drawn with the official ABNORMAL token, placed and removed by hand from the token list in one commit.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { openInStore, patchPlayer, proofGame, proofRegistry, proofScript } from "@/test/proofFixtures";
import { marksOn } from "@/test/v6Night";
import { placeReminder, removeMark } from "@/features/grimoire-v6/board/marks";
import { effectSemanticsOf, createRulesQuery } from "./rulesQuery";
import { StorytellerGamePersistedSchema } from "./schemas";
import { projectLobbyToPublic, projectToSelf } from "./projections";
import {
  ABNORMAL_BY_HAND, ABNORMAL_EFFECT, ABNORMAL_IMPAIRED, ABNORMAL_VORTOX, abnormalCount, abnormalMarkIntents, abnormalMarksOf, abnormalReasons,
  clearAbnormalIntents, mathematicianListening,
} from "./abnormalMarks";
import { planEffectTransaction, applyEffectPlan } from "./effectResolution";
import { KNOWN_EFFECT_TYPES, effectDefinitionOf } from "./effectRegistry";
import type { StorytellerLobbyRecord } from "./types";

const game = () => store.getState().game!;
const mathematician = proofScript.characters.find((role) => role.id === "mathematician")!;
const placeAbnormal = (id: string) => placeReminder(id, game().players[id]!.participantId, { role: mathematician, label: "Abnormal" });
// p0 mathematician, p1 clockmaker, p2 vortox, p3 witch, p4 sage
const ROLES = ["mathematician", "clockmaker", "vortox", "witch", "sage"];
const at = (g: StorytellerLobbyRecord, id: string) => ({ playerId: id, participantId: g.players[id]!.participantId! });
const apply = (g: StorytellerLobbyRecord, intents: ReturnType<typeof abnormalMarkIntents>): StorytellerLobbyRecord => {
  const result = planEffectTransaction(g, { intents });
  if (!result.ok) throw new Error(result.message);
  return result.changed ? applyEffectPlan(g, result.plan) : g;
};

beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, undoStack: [] }); usePrivacyStore.setState({ enabled: false }); });
afterEach(() => cleanup());

describe("the abnormal Effect", () => {
  it("is not offered by the Manual workspace's effect picker: only its own placement keeps one per player and gone at dawn", () => {
    expect(KNOWN_EFFECT_TYPES.map((definition) => definition.type)).not.toContain("abnormal");
    expect(KNOWN_EFFECT_TYPES.map((definition) => definition.type)).toContain("twin");
    expect(effectDefinitionOf("abnormal").label).toBe("Abnormal");
  });

  it("is a registered Storyteller fact, so no game-ending proposal turns manual because of it", () => {
    expect(effectSemanticsOf(ABNORMAL_EFFECT)).toBe("storytellerFact");
    const g = apply(proofGame(ROLES, "night", 2), abnormalMarkIntents(proofGame(ROLES, "night", 2).players, at(proofGame(ROLES), "p1"), ABNORMAL_VORTOX));
    const query = createRulesQuery(g, { script: proofScript, registry: proofRegistry });
    expect(query.factHolders(ABNORMAL_EFFECT)).toMatchObject({ known: true, value: [{ holder: at(g, "p1") }] });
  });

  it("one mark per player: a second occurrence adds its reason, never a second mark; the same reason twice changes nothing", () => {
    let g = proofGame(ROLES, "night", 2);
    g = apply(g, abnormalMarkIntents(g.players, at(g, "p1"), ABNORMAL_VORTOX));
    g = apply(g, abnormalMarkIntents(g.players, at(g, "p1"), ABNORMAL_IMPAIRED));
    expect(abnormalMarkIntents(g.players, at(g, "p1"), ABNORMAL_IMPAIRED)).toEqual([]);
    expect(abnormalMarksOf(g.players.p1!)).toHaveLength(1);
    expect(abnormalReasons(abnormalMarksOf(g.players.p1!))).toEqual([ABNORMAL_VORTOX, ABNORMAL_IMPAIRED]);
    expect(StorytellerGamePersistedSchema.safeParse(g).success).toBe(true);
  });

  it("lives until the next dawn (\"since dawn\"): made in Night 2 it ends at Day 2; made in Day 2 it lasts through Night 3", () => {
    let night = proofGame(ROLES, "night", 2);
    night = apply(night, abnormalMarkIntents(night.players, at(night, "p1"), ABNORMAL_BY_HAND));
    expect(abnormalMarksOf(night.players.p1!)[0]).toMatchObject({ lifetime: { kind: "untilDawn" }, expiry: { kind: "at", moment: { phase: "day", day: 2 } } });
    let day = proofGame(ROLES, "day", 2);
    day = apply(day, abnormalMarkIntents(day.players, at(day, "p1"), ABNORMAL_BY_HAND));
    expect(abnormalMarksOf(day.players.p1!)[0]).toMatchObject({ expiry: { kind: "at", moment: { phase: "day", day: 3 } } });
  });

  it("the count leaves out the Mathematician himself, and the clearing takes every mark", () => {
    let g = proofGame(ROLES, "night", 2);
    for (const id of ["p0", "p1", "p4"]) g = apply(g, abnormalMarkIntents(g.players, at(g, id), ABNORMAL_BY_HAND));
    expect(abnormalCount(g)).toBe(3);
    expect(abnormalCount(g, g.players.p0!.participantId)).toBe(2);
    g = apply(g, clearAbnormalIntents(g));
    expect(abnormalCount(g)).toBe(0);
  });

  it("the app marks by itself only while a living player has the Mathematician's ability", () => {
    expect(mathematicianListening(proofGame(ROLES))).toBe(true);
    expect(mathematicianListening(patchPlayer(proofGame(ROLES), "p0", { alive: false }))).toBe(false);
    expect(mathematicianListening(proofGame(["chef", "clockmaker", "vortox", "witch", "sage"]))).toBe(false);
  });

  it("is never in a player's projection", () => {
    let g = proofGame(ROLES, "night", 2);
    g = apply(g, abnormalMarkIntents(g.players, at(g, "p1"), ABNORMAL_VORTOX));
    const projection = JSON.stringify([projectLobbyToPublic(g, {}), projectToSelf(g.players.p1!, proofRegistry)]);
    expect(projection).not.toMatch(/abnormal|Abnormal|false information/);
  });
});

describe("placing the official ABNORMAL token by hand (PO Q7 A)", () => {
  it("records the mark, with no Reminder, in one commit; the token is drawn from it with its reason; Undo takes it back", () => {
    openInStore(proofGame(ROLES, "night", 2));
    expect(placeAbnormal("p1")).toEqual({ ok: true });
    expect(game().players.p1!.reminders).toEqual([]);
    expect(abnormalReasons(abnormalMarksOf(game().players.p1!))).toEqual([ABNORMAL_BY_HAND]);
    expect(store.getState().undoStack).toHaveLength(1);
    const token = marksOn("p1").find((mark) => mark.label === "Abnormal")!;
    expect(token).toMatchObject({ kind: "effect", title: "Mathematician: Abnormal (Placed by hand)" });
    expect(token.src).toBeTruthy();
    act(() => { store.getState().undo(); });
    expect(abnormalMarksOf(game().players.p1!)).toEqual([]);
  });

  it("removing the drawn token removes the mark in one commit; Undo restores it", () => {
    openInStore(proofGame(ROLES, "day", 2));
    placeAbnormal("p4");
    const mark = marksOn("p4").find((m) => m.label === "Abnormal")!;
    let removed; act(() => { removed = removeMark("p4", game().players.p4!.participantId, mark); });
    expect(removed).toEqual({ ok: true });
    expect(abnormalMarksOf(game().players.p4!)).toEqual([]);
    expect(store.getState().undoStack).toHaveLength(2);
    act(() => { store.getState().undo(); });
    expect(abnormalMarksOf(game().players.p4!)).toHaveLength(1);
  });

  it("a second ABNORMAL on the same player is refused (it counts once); Setup refuses it with the reason", () => {
    openInStore(proofGame(ROLES, "night", 2));
    placeAbnormal("p1");
    expect(placeAbnormal("p1")).toEqual({ ok: false, message: "This player already has an ABNORMAL mark: it counts once." });
    expect(store.getState().undoStack).toHaveLength(1);
    openInStore({ ...proofGame(ROLES, "night", 2), phase: "setup", day: 0 });
    expect(placeAbnormal("p1")).toEqual({ ok: false, message: "An ABNORMAL mark is placed during the Night or the Day." });
    expect(game().players.p1!.effects).toEqual([]);
  });

  it("other Mathematician-free tokens still place notation only", () => {
    openInStore(proofGame(ROLES, "night", 2));
    const witch = proofScript.characters.find((role) => role.id === "witch")!;
    expect(placeReminder("p1", game().players.p1!.participantId, { role: witch, label: "Cursed" })).toEqual({ ok: true });
    expect(game().players.p1!.reminders.map((r) => r.label)).toEqual(["Cursed"]);
    expect(game().players.p1!.effects).toEqual([]);
  });
});


