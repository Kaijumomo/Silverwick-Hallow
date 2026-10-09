import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bind, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, proofQuery, proofRegistry, request, reseat, yes } from "@/test/proofFixtures";
import { captureCharacterActionContext, useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { participantStepKey } from "@/stores/nightProgress";
import type { StorytellerLobbyRecord } from "@/stores/types";

// Independent examples derived from the official Spy, Recluse, States,
// Fortune Teller, Imp and Scarlet Woman almanac entries. Registration is a
// per-interaction answer, never a replacement for Actual Role or Alignment.
const ft = () => impair(proofGame(["fortuneteller", "spy", "recluse", "imp", "chef", "monk"]), "p5", "fortuneTellerRedHerring");
const ftRequest = (g: StorytellerLobbyRecord, a = "p1", b = "p4") => request(g, "p0", "fortuneteller", { targets: pick(g, a, b) }, { withStep: true, completeStep: true });
const answer = (g: StorytellerLobbyRecord) => g.informationDeliveries.at(-1)?.values?.find(v => v.requirementId === "isDemon");

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
  usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
});
afterEach(() => vi.restoreAllMocks());

describe("independent B1 contextual registration review", () => {
  it.each(["spy", "recluse"])("%s keeps optional registration alive and dead, but impairment or ability loss removes it", role => {
    for (const alive of [true, false]) {
      const g = patchPlayer(proofGame([role, "chef"]), "p0", { alive });
      const before = JSON.stringify(g);
      expect(proofQuery(g).registration(bind(g, "p0"), "ravenkeeper").character.known).toBe(false);
      for (const effect of ["poisoned", "drunk", "abilityLost"]) {
        const disabled = impair(g, "p0", effect);
        const result = proofQuery(disabled).registration(bind(disabled, "p0"), "ravenkeeper");
        expect(result.character).toEqual({ known: true, value: role });
        expect(result.alignment).toEqual({ known: true, value: role === "spy" ? "evil" : "good" });
      }
      expect(JSON.stringify(g)).toBe(before);
    }
  });

  it.each(["spy", "recluse"])("%s type limits stay definite even when impairment is unknown", role => {
    const g = impair(proofGame([role, "chef"]), "p0", "soberHealthy");
    const q = proofQuery(g); const target = bind(g, "p0");
    expect(q.abilityFunctions(target).known).toBe(false);
    expect(q.registersAsType(target, role === "spy" ? "demon" : "townsfolk", "slayer")).toEqual({ known: true, value: false });
    expect(q.registersAsType(target, "minion", "imp").known).toBe(false);
  });

  it.each(["spy", "recluse"])("%s alignment uncertainty disappears when optional and actual alignment coincide", role => {
    const alignment = role === "spy" ? "good" : "evil";
    const g = patchPlayer(proofGame([role, "chef"]), "p0", { actualAlignment: alignment });
    const result = proofQuery(g).registration(bind(g, "p0"), "empath");
    expect(result.alignment).toEqual({ known: true, value: alignment });
    expect(result.character.known).toBe(false);
    expect(g.players.p0!.actualRole).toBe(role);
  });

  it.each(["spy", "recluse"])("source death or character change restores dead %s optional registration", role => {
    let g = patchPlayer(proofGame([role, "poisoner", "chef"]), "p0", { alive: false });
    g = patchPlayer(g, "p0", { effects: [{ id: "sourced-poison", type: "poisoned", state: "active", lifetime: { kind: "manual" }, expiry: { kind: "none" },
      appliedAt: { phase: "night", day: 2 }, sourceCharacter: "poisoner", sourceParticipant: { kind: "participant", ...bind(g, "p1"), nameAtTime: "Poisoner" } }] });
    expect(proofQuery(g).registration(bind(g, "p0")).character).toEqual({ known: true, value: role });
    for (const changed of [patchPlayer(g, "p1", { alive: false }), patchPlayer(g, "p1", { actualRole: "baron", shownRole: "baron" })]) {
      expect(proofQuery(changed).registration(bind(changed, "p0")).character.known).toBe(false);
      expect(changed.players.p0!.effects).toEqual(g.players.p0!.effects);
    }
  });

  it("Fortune Teller can exclude a healthy dead Spy and accepts a decisive dead Demon or Red Herring beside Recluse", () => {
    const g = patchPlayer(ft(), "p1", { alive: false });
    expect(answer(planned(plan(g, ftRequest(g))))).toMatchObject({ value: false });
    for (const decisive of ["p3", "p5"]) for (const reverse of [false, true]) {
      const dead = patchPlayer(g, decisive, { alive: false });
      const next = planned(plan(dead, ftRequest(dead, ...(reverse ? [decisive, "p2"] : ["p2", decisive]) as [string, string])));
      expect(answer(next)).toMatchObject({ value: true });
      expect(next.players).toEqual(dead.players);
    }
  });

  it("relevant Recluse uncertainty refuses the whole Night action despite a supplied legacy judgment", () => {
    const g = ft(); openInStore(g); const before = store.getState(); const persisted = localStorage.getItem("new-blood-st");
    const write = vi.spyOn(Storage.prototype, "setItem"); let publications = 0; const unsubscribe = store.subscribe(() => publications++);
    try {
      const req = { ...ftRequest(g, "p2", "p4"), judgments: { [`registersAsDemon:${g.players.p2!.participantId}`]: yes(false) } };
      expect(store.getState().resolveAbility(req)).toMatchObject({ ok: false, code: "unsupported" });
      expect(store.getState()).toBe(before); expect(write).not.toHaveBeenCalled(); expect(publications).toBe(0);
      expect(localStorage.getItem("new-blood-st")).toBe(persisted); expect(g.nightProgress).toEqual({});
      expect(g.informationDeliveries).toEqual([]); expect(g.history).toEqual([]); expect(store.getState().undoStack).toEqual([]);
    } finally { unsubscribe(); }
  });

  it("Slayer spends on Spy or poisoned Recluse without changing identity; healthy Recluse stays manual", () => {
    for (const role of ["spy", "recluse"]) {
      let g = proofGame(["slayer", role, "imp", "chef", "monk"], "day");
      const shot = () => request(g, "p0", "slayer", { target: pick(g, "p1") });
      if (role === "recluse") { expect(plan(g, shot())).toMatchObject({ ok: false, code: "unsupported" }); g = impair(g, "p1"); }
      const next = planned(plan(g, shot()));
      expect(next.players.p0!.abilityUsed).toBe(true); expect(next.players.p1).toEqual(g.players.p1);
    }
  });

  it("a Recluse who cannot die makes Slayer registration irrelevant, while generic protection does not", () => {
    const g = proofGame(["slayer", "recluse", "imp", "chef", "monk"], "day");
    const req = (state: StorytellerLobbyRecord) => request(state, "p0", "slayer", { target: pick(state, "p1") });
    const immune = impair(g, "p1", "cannotDie");
    const next = planned(plan(immune, req(immune)));
    expect(next.players.p0!.abilityUsed).toBe(true); expect(next.players.p1).toEqual(immune.players.p1);
    const uncertain = impair(g, "p1", "protected");
    expect(plan(uncertain, req(uncertain))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("Empath sees impaired Spy truthfully but preserves healthy Spy discretion", () => {
    const g = proofGame(["empath", "spy", "imp", "chef", "monk"]);
    expect(plan(g, request(g, "p0", "empath"))).toMatchObject({ ok: false, code: "unsupported" });
    const impaired = impair(g, "p1"); const next = planned(plan(impaired, request(impaired, "p0", "empath")));
    expect(next.informationDeliveries.at(-1)?.values).toEqual([{ requirementId: "evilNeighbors", kind: "number", value: 1 }]);
  });

  it.each(["spy", "recluse"])("Ravenkeeper full-character reading of a dead %s remains manual until impaired", role => {
    let g = proofGame(["ravenkeeper", "imp", role, "chef", "monk"]);
    g = planned(plan(g, request(g, "p1", "imp", { target: pick(g, "p0") })));
    g = patchPlayer(g, "p2", { alive: false });
    const req = (state: StorytellerLobbyRecord) => request(state, "p0", "ravenkeeper", { target: pick(state, "p2") }, { invocationPath: "nightTrigger" });
    expect(plan(g, req(g))).toMatchObject({ ok: false, code: "unsupported" });
    const impaired = impair(g, "p2"); const next = planned(plan(impaired, req(impaired)));
    expect(next.informationDeliveries.at(-1)?.values).toContainEqual({ requirementId: "role", kind: "role", roleId: role });
  });

  it.each(["spy", "recluse"])("Imp self-pass keeps relevant %s registration manual but skips it for protected or impaired Imp", role => {
    const g = proofGame(["imp", role, "chef", "monk", "empath"]);
    const req = (state: StorytellerLobbyRecord) => request(state, "p0", "imp", { target: pick(state, "p0") });
    expect(plan(g, req(g))).toMatchObject({ ok: false, code: "unsupported" });
    for (const effect of ["poisoned", "cannotDie", "safeFromDemon"]) {
      const blocked = impair(g, "p0", effect); expect(plan(blocked, req(blocked))).toEqual({ ok: true, changed: false });
    }
    const priority = patchPlayer(g, "p2", { actualRole: "scarletwoman", shownRole: "scarletwoman", actualAlignment: "evil" });
    const next = planned(plan(priority, req(priority)));
    expect(next.players.p0!.alive).toBe(false); expect(next.players.p2!.actualRole).toBe("imp");
    expect(next.players.p1).toEqual(priority.players.p1);
    expect(next.nightProgress[`2:${participantStepKey(priority.players.p2!.participantId!, "imp")}`]?.status).toBe("skipped");
  });

  it.each(["spy", "recluse"])("an explicit definite Imp successor makes other %s registration irrelevant without granting an uncertain successor", role => {
    const g = proofGame(["imp", "poisoner", "baron", role, "chef"]);
    const req = (target?: string) => request(g, "p0", "imp", { target: pick(g, "p0"), ...(target ? { successor: pick(g, target) } : {}) });
    expect(plan(g, req())).toMatchObject({ ok: false, code: "unsupported" });
    expect(plan(g, req("p3"))).toMatchObject({ ok: false, code: "unsupported" });
    const next = planned(plan(g, req("p1")));
    expect(next.players.p0!.alive).toBe(false); expect(next.players.p1!.actualRole).toBe("imp");
    expect(next.players.p3).toEqual(g.players.p3);
    const priority = patchPlayer(g, "p2", { actualRole: "scarletwoman", shownRole: "scarletwoman" });
    const result = plan(priority, request(priority, "p0", "imp", { target: pick(priority, "p0"), successor: pick(priority, "p1") }));
    // Existing mandatory priority may ignore or reject an extraneous choice;
    // it must never make the non-priority Poisoner the successor.
    if (result.ok && result.changed) {
      expect(result.plan.game.players.p2!.actualRole).toBe("imp"); expect(result.plan.game.players.p1!.actualRole).toBe("poisoner");
    } else expect(result.ok).toBe(false);
  });

  it("newly safe Fortune Teller answer commits once, survives reload and Undo, and adds no public registration state", async () => {
    const g = ft(); openInStore(g); const write = vi.spyOn(Storage.prototype, "setItem");
    expect(store.getState().resolveAbility(ftRequest(g))).toMatchObject({ ok: true, changed: true });
    const next = store.getState().game!; expect(answer(next)).toMatchObject({ value: false });
    expect(write).toHaveBeenCalledTimes(1); expect(store.getState().undoStack).toHaveLength(1);
    expect(next.players).toEqual(g.players);
    const projected = JSON.stringify([projectLobbyToPublic(next, {}), projectLobbyToSelfMap(next, proofRegistry)]);
    expect(projected).not.toMatch(/informationDeliveries|fortuneTellerRedHerring|registersAsType|actualRole|actualAlignment/);
    const saved = localStorage.getItem("new-blood-st")!; store.setState({ game: null, undoStack: [] });
    localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate(); expect(store.getState().game).toEqual(next);
    store.getState().undo(); expect(store.getState().game).toEqual(g);
  });

  it.each(["privacy", "recovery", "stale-context", "no-writer", "storage"])("newly safe Fortune Teller action retains %s guard without publication", mode => {
    const g = ft(); openInStore(g); const context = captureCharacterActionContext();
    if (mode === "privacy") usePrivacyStore.getState().setEnabled(true);
    if (mode === "recovery") store.setState({ terminalClose: { intent: { kind: "declare", winner: "good" }, status: "failed", message: "Retry ending", recoveryPending: true } });
    if (mode === "stale-context") store.getState().setNotes("p1", "Changed after opening");
    if (mode === "no-writer") store.setState({ lobby: { code: "B1TEST01", uid: "host", sessionId: "session", status: "live" }, game: { ...g, code: "B1TEST01", storytellerUid: "host" } });
    if (mode === "storage") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    const before = store.getState(); const saved = localStorage.getItem("new-blood-st"); let publications = 0; const unsubscribe = store.subscribe(() => publications++);
    try {
      expect(store.getState().resolveAbility(ftRequest(g), undefined, mode === "stale-context" ? context : captureCharacterActionContext())).toMatchObject({ ok: false });
      expect(store.getState().game).toBe(before.game); expect(store.getState().undoStack).toBe(before.undoStack);
      expect(store.getState().localSeq).toBe(before.localSeq); expect(publications).toBe(0); expect(localStorage.getItem("new-blood-st")).toBe(saved);
    } finally { unsubscribe(); }
  });

  it("new query never grants a replacement occupant the former target's registration", () => {
    const g = ft(); const replaced = reseat(g, "p1");
    expect(proofQuery(replaced).registersAsType(bind(g, "p1"), "demon", "fortuneteller").known).toBe(false);
    expect(plan(replaced, ftRequest(g))).toMatchObject({ ok: false, code: "stale" });
  });
});
