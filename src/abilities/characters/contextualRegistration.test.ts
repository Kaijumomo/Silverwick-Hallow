// B1 rules-derived cases: official Spy/Recluse almanacs and States.
// https://wiki.bloodontheclocktower.com/{Spy,Recluse,States}
import { beforeEach, describe, expect, it } from "vitest";
import { bind, homebrewEnv, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, proofQuery, request } from "@/test/proofFixtures";
import { createRulesQuery } from "@/stores/rulesQuery";
import { captureCharacterActionContext, useStorytellerStore as store } from "@/stores/storytellerStore";
import { RED_HERRING } from "./fortuneteller";
import type { EffectRecord, StorytellerLobbyRecord } from "@/stores/types";

const effect = (type: string): EffectRecord => ({ id: `test-${type}`, type, state: "active", lifetime: { kind: "manual" }, expiry: { kind: "none" } });
const typeAnswer = (game: StorytellerLobbyRecord, type: "demon" | "minion" | "townsfolk") => proofQuery(game).registersAsType(bind(game, "p1"), type, "fortuneteller");

describe.each(["spy", "recluse"])("B1 %s contextual registration", role => {
  it.each([true, false])("healthy ability remains optional when alive=%s; identity never changes", alive => {
    const game = patchPlayer(proofGame(["fortuneteller", role, "imp"]), "p1", { alive });
    const before = structuredClone(game);
    const query = proofQuery(game);
    expect(query.registration(bind(game, "p1"), "ravenkeeper").character.known).toBe(false);
    expect(query.registration(bind(game, "p1"), "empath").alignment.known).toBe(false);
    expect(typeAnswer(game, "minion").known).toBe(false);
    expect(typeAnswer(game, role === "spy" ? "demon" : "townsfolk")).toEqual({ known: true, value: false });
    expect(game).toEqual(before);
  });

  it.each(["poisoned", "drunk", "abilityLost"])("%s disables false registration even while dead", impairment => {
    for (const alive of [true, false]) {
      const game = impair(patchPlayer(proofGame(["fortuneteller", role, "imp"]), "p1", { alive }), "p1", impairment);
      expect(proofQuery(game).registration(bind(game, "p1"), "ravenkeeper")).toEqual({ character: { known: true, value: role }, alignment: { known: true, value: role === "spy" ? "evil" : "good" } });
      expect(typeAnswer(game, "demon")).toEqual({ known: true, value: false });
      expect(typeAnswer(game, "minion")).toEqual({ known: true, value: role === "spy" });
    }
  });

  it("uncertain functioning only matters for a result it can change", () => {
    const game = impair(proofGame(["fortuneteller", role, "imp"]), "p1", "soberHealthy");
    expect(typeAnswer(game, "minion").known).toBe(false);
    expect(typeAnswer(game, role === "spy" ? "demon" : "townsfolk")).toEqual({ known: true, value: false });
  });

  it("an already matching actual alignment is definite despite optional registration", () => {
    const alignment = role === "spy" ? "good" : "evil";
    const game = patchPlayer(proofGame(["empath", role, "imp"]), "p1", { actualAlignment: alignment });
    expect(proofQuery(game).registration(bind(game, "p1"), "empath").alignment).toEqual({ known: true, value: alignment });
    expect(proofQuery(game).registration(bind(game, "p1"), "ravenkeeper").character.known).toBe(false);
  });

  it("role changes and source death restore the correct present-state answer", () => {
    let game = patchPlayer(proofGame(["poisoner", role, "imp"]), "p1", { alive: false });
    game = patchPlayer(game, "p1", { effects: [{ ...effect("poisoned"), sourceCharacter: "poisoner", sourceParticipant: { kind: "participant", playerId: "p0", participantId: game.players.p0!.participantId!, nameAtTime: "Poisoner" } }] });
    expect(typeAnswer(game, "minion")).toEqual({ known: true, value: role === "spy" });
    for (const next of [patchPlayer(game, "p0", { alive: false }), patchPlayer(game, "p0", { actualRole: "chef" })]) {
      expect(typeAnswer(next, "minion").known).toBe(false);
    }
    const changed = patchPlayer(game, "p1", { actualRole: "chef", actualAlignment: "good" });
    expect(proofQuery(changed).registration(bind(changed, "p1"), "ravenkeeper").character).toEqual({ known: true, value: "chef" });
  });

  it("custom definitions, explicit false-registration effects and stale bindings stay unknown", () => {
    const game = proofGame(["fortuneteller", role, "imp"]);
    expect(createRulesQuery(game, homebrewEnv(role)).registersAsType(bind(game, "p1"), "demon", "fortuneteller").known).toBe(false);
    expect(typeAnswer(impair(game, "p1", "registersFalsely"), "demon").known).toBe(false);
    expect(proofQuery(game).registersAsType({ playerId: "p1", participantId: "stale" }, "demon").known).toBe(false);
    expect(typeAnswer({ ...game, fabled: ["revolutionary"] }, "demon").known).toBe(false);
  });
});

const ftGame = (role: string) => patchPlayer(proofGame(["fortuneteller", role, "imp", "chef", "monk"]), "p4", { effects: [effect(RED_HERRING)] });
const read = (game: StorytellerLobbyRecord, second = "p3") => plan(game, request(game, "p0", "fortuneteller", { targets: pick(game, "p1", second) }));
const answer = (game: StorytellerLobbyRecord) => game.informationDeliveries.at(-1)!.values!.find(value => value.requirementId === "isDemon");
const selfKill = (game: StorytellerLobbyRecord) => plan(game, request(game, "p0", "imp", { target: pick(game, "p0") }));

describe("B1 relevant cross-character results", () => {
  it.each([true, false])("Fortune Teller knows Spy is not Demon when alive=%s", alive => {
    const game = patchPlayer(ftGame("spy"), "p1", { alive });
    expect(answer(planned(read(game)))).toMatchObject({ value: false });
  });

  it("Recluse ambiguity is manual unless a Demon or Red Herring already makes Yes certain", () => {
    const game = ftGame("recluse");
    expect(read(game)).toMatchObject({ ok: false, code: "unsupported" });
    expect(answer(planned(read(game, "p2")))).toMatchObject({ value: true });
    expect(answer(planned(read(game, "p4")))).toMatchObject({ value: true });
    expect(answer(planned(read(impair(game, "p1"))))).toMatchObject({ value: false });
    expect(read(patchPlayer(game, "p1", { alive: false }))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("Slayer spends the shot without killing a Spy or impaired Recluse; healthy Recluse stays manual", () => {
    for (const role of ["spy", "recluse"]) {
      const healthy = proofGame(["slayer", role, "imp"], "day");
      const game = role === "recluse" ? impair(healthy, "p1") : healthy;
      const next = planned(plan(game, request(game, "p0", "slayer", { target: pick(game, "p1") })));
      expect(next.players.p0!.abilityUsed).toBe(true);
      expect(next.players.p1!.alive).toBe(true);
      if (role === "recluse") expect(plan(healthy, request(healthy, "p0", "slayer", { target: pick(healthy, "p1") }))).toMatchObject({ ok: false, code: "unsupported" });
    }
  });

  it("Empath computes an impaired Spy's real alignment but leaves optional healthy registration manual", () => {
    const game = proofGame(["empath", "spy", "chef"]);
    expect(plan(game, request(game, "p0", "empath"))).toMatchObject({ ok: false, code: "unsupported" });
    const impaired = impair(game, "p1");
    const next = planned(plan(impaired, request(impaired, "p0", "empath")));
    expect(next.informationDeliveries.at(-1)!.values).toContainEqual(expect.objectContaining({ kind: "number", value: 1 }));
  });

  it.each(["spy", "recluse"])("Imp checks %s succession only when an actual self-death needs it", role => {
    const game = proofGame(["imp", role, "poisoner"]);
    expect(selfKill(game)).toMatchObject({ ok: false, code: "unsupported" });
    expect(selfKill(impair(game, "p0"))).toEqual({ ok: true, changed: false });
    expect(selfKill(impair(game, "p0", "cannotDie"))).toEqual({ ok: true, changed: false });
    const dead = patchPlayer(game, "p1", { alive: false });
    expect(planned(selfKill(dead)).players.p2!.actualRole).toBe("imp");
    const priority = proofGame(["imp", role, "scarletwoman", "chef", "monk"]);
    expect(planned(selfKill(priority)).players.p2!.actualRole).toBe("imp");
  });

  it("an impaired Spy remains an actual Minion eligible for a deterministic star-pass", () => {
    const game = impair(proofGame(["imp", "spy", "chef"]), "p1");
    const next = planned(selfKill(game));
    expect(next.players.p0!.alive).toBe(false);
    expect(next.players.p1).toMatchObject({ actualRole: "imp", actualAlignment: "evil", alive: true });
  });
});

describe("B1 authoritative refusal and supported commit", () => {
  beforeEach(() => localStorage.clear());

  it("manual registration leaves store, persisted game, Undo and Night progress untouched", () => {
    const game = ftGame("recluse");
    openInStore(game);
    const before = store.getState();
    const saved = JSON.stringify(localStorage);
    const result = before.resolveAbility(request(game, "p0", "fortuneteller", { targets: pick(game, "p1", "p3") }, { withStep: true, completeStep: true }), undefined, captureCharacterActionContext());
    expect(result).toMatchObject({ ok: false, code: "unsupported" });
    expect(store.getState().game).toBe(before.game);
    expect(store.getState().undoStack).toBe(before.undoStack);
    expect(JSON.stringify(localStorage)).toBe(saved);
  });

  it("the definite Spy reading uses ordinary atomic history/Undo without changing identity", () => {
    const game = ftGame("spy");
    openInStore(game);
    const before = store.getState();
    expect(before.resolveAbility(request(game, "p0", "fortuneteller", { targets: pick(game, "p1", "p3") }, { withStep: true, completeStep: true }), undefined, captureCharacterActionContext())).toMatchObject({ ok: true });
    expect(answer(store.getState().game!)).toMatchObject({ value: false });
    expect(store.getState().game!.players.p1).toEqual(game.players.p1);
    expect(store.getState().undoStack.length).toBe(before.undoStack.length + 1);
    store.getState().undo();
    expect(store.getState().game!.informationDeliveries).toEqual(game.informationDeliveries);
    expect(store.getState().game!.nightProgress).toEqual(game.nightProgress);
  });
});
