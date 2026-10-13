import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { impair, num, openInStore, patchPlayer, pick, proofGame, proofRegistry, request, reseat, yes } from "@/test/proofFixtures";
import { withRedHerring } from "@/test/redHerringFixture";
import { captureCharacterActionContext, useStorytellerStore as store } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import type { AbilityInputs } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "./types";

// Independently derived from official Chef/Empath/Fortune Teller almanacs,
// not evaluator outputs. In particular pairs are edges, not evil groups;
// information records are communication, never replacement game truth.
// https://wiki.bloodontheclocktower.com/Chef
// https://wiki.bloodontheclocktower.com/Empath
// https://wiki.bloodontheclocktower.com/Fortune_Teller
const use = (g: StorytellerLobbyRecord, role: string, inputs: AbilityInputs = {}) =>
  store.getState().resolveAbility(request(g, "p0", role, inputs, { withStep: true, completeStep: true }), undefined, captureCharacterActionContext());
const number = () => store.getState().game!.informationDeliveries.at(-1)?.values?.find(v => v.kind === "number");
const boolean = () => store.getState().game!.informationDeliveries.at(-1)?.values?.find(v => v.kind === "boolean");
const ft = () => withRedHerring(proofGame(["fortuneteller", "imp", "scarletwoman", "chef", "monk"]), "p4");

beforeEach(() => {
  localStorage.clear();
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null, tokenPositions: {} });
  usePrivacyStore.getState().reset();
  useSessionRuntime.setState({ backend: null, status: "idle" });
});
afterEach(() => vi.restoreAllMocks());

describe("B5a independent authoritative information verification", () => {
  it("Chef counts three overlapping circular edges, using seatOrder despite cosmetic positions", () => {
    let g = proofGame(["chef", "imp", "poisoner", "baron", "monk"], "night", 1);
    g = patchPlayer(g, "p0", { actualAlignment: "evil" });
    g = { ...g, seatOrder: ["p0", "p4", "p1", "p2", "p3"] };
    g = { ...g, players: Object.fromEntries(g.seatOrder.map((id, seat) => [id, { ...g.players[id]!, seat }])) };
    openInStore(g);
    store.getState().setTokenPosition("p4", 999, 4);
    store.getState().setTokenPosition("p1", 0, 0);
    expect(use(g, "chef")).toMatchObject({ ok: true, changed: true });
    expect(number()).toMatchObject({ value: 3 });
    expect(store.getState().game!.players).toEqual(g.players);
  });

  it("Chef counts disjoint evil pairs independently", () => {
    const g = proofGame(["chef", "imp", "baron", "monk", "poisoner", "scarletwoman"], "night", 1);
    openInStore(g); expect(use(g, "chef")).toMatchObject({ ok: true });
    expect(number()).toMatchObject({ value: 2 });
  });

  it.each(["spy", "recluse"])("Chef never chooses consequential %s registration without communicated information", role => {
    const g = proofGame(["chef", "imp", role, "monk", "poisoner"], "night", 1);
    openInStore(g); const before = store.getState(); const saved = localStorage.getItem("new-blood-st");
    expect(use(g, "chef")).toMatchObject({ ok: false, code: role === "recluse" ? "needsInput" : "unsupported" });
    expect(store.getState()).toBe(before); expect(localStorage.getItem("new-blood-st")).toBe(saved);
  });

  it.each(["poisoned", "drunk"])("Chef's %s choice may equal the true answer and never alters alignment", effect => {
    const g = impair(proofGame(["chef", "imp", "baron", "monk", "soldier"], "night", 1), "p0", effect);
    openInStore(g); expect(use(g, "chef", { communicated: num(1) })).toMatchObject({ ok: true });
    expect(number()).toMatchObject({ value: 1 }); expect(store.getState().game!.players).toEqual(g.players);
  });

  it("Chef refuses fractional, negative and impossible circular-edge choices without writes", () => {
    const g = impair(proofGame(["chef", "imp", "baron", "monk", "soldier"], "night", 1), "p0");
    openInStore(g); const before = store.getState();
    for (const value of [-1, 0.5, 6]) {
      expect(use(g, "chef", { communicated: num(value) })).toMatchObject({ ok: false });
      expect(store.getState()).toBe(before);
    }
  });

  it("Empath skips both dead adjacent players and sees current living alignments", () => {
    let g = proofGame(["empath", "chef", "baron", "monk", "soldier", "imp"]);
    g = patchPlayer(patchPlayer(g, "p1", { alive: false }), "p5", { alive: false });
    g = patchPlayer(g, "p4", { actualAlignment: "evil" });
    openInStore(g); expect(use(g, "empath")).toMatchObject({ ok: true });
    expect(number()).toMatchObject({ value: 2 });
  });

  it.each([0, 1, 2])("impaired Empath permits deliberate %s, with true identities preserved", value => {
    const g = impair(proofGame(["empath", "imp", "chef", "monk", "baron"]), "p0");
    openInStore(g); expect(use(g, "empath", { communicated: num(value) })).toMatchObject({ ok: true });
    expect(number()).toMatchObject({ value }); expect(store.getState().game!.players).toEqual(g.players);
  });

  it("a Drunk shown Empath records a simulated communication, never an actual Empath", () => {
    const g = patchPlayer(proofGame(["drunk", "imp", "chef", "monk", "baron"]), "p0", { shownRole: "empath", behaviorMode: "drunk_fake_role_behavior" });
    openInStore(g); expect(use(g, "empath", { communicated: num(0) })).toMatchObject({ ok: true });
    expect(store.getState().game!.informationDeliveries.at(-1)).toMatchObject({ actualRole: "drunk", performedRole: "empath" });
    expect(store.getState().game!.players.p0!.actualRole).toBe("drunk");
  });

  it("Fortune Teller detects a dead Demon and a changed/dead fixed Red Herring", () => {
    for (const target of ["p1", "p4"]) {
      let g = patchPlayer(ft(), target, { alive: false });
      if (target === "p4") g = patchPlayer(g, target, { actualAlignment: "evil", actualRole: "baron", shownRole: "baron" });
      openInStore(g); expect(use(g, "fortuneteller", { targets: pick(g, target, "p3") })).toMatchObject({ ok: true });
      expect(boolean()).toMatchObject({ value: true });
    }
  });

  it.each([true, false])("impaired Fortune Teller deliberately communicates %s independent of known Demon", value => {
    const g = impair(ft(), "p0"); const id = `communicated:${g.players.p1!.participantId}:${g.players.p3!.participantId}`;
    openInStore(g); const probe = use(g, "fortuneteller", { targets: pick(g, "p1", "p3") });
    expect(probe).toMatchObject({ ok: false, code: "needsInput" });
    // The requirement identity binds a chosen pair. Reading its identifier is
    // protocol discovery, not deriving the expected rules answer from output.
    const requirement = !probe.ok && "requirements" in probe ? probe.requirements?.[0]?.id : undefined;
    expect(requirement).toBeTruthy();
    expect(use(g, "fortuneteller", { targets: pick(g, "p1", "p3"), [requirement ?? id]: yes(value) })).toMatchObject({ ok: true });
    expect(boolean()).toMatchObject({ value }); expect(store.getState().game!.players).toEqual(g.players);
  });

  it("missing original Fortune Teller setup fact cannot be replaced by a caller answer", () => {
    const g = impair(proofGame(["fortuneteller", "imp", "chef", "monk", "baron"]), "p0");
    openInStore(g); const before = store.getState();
    expect(use(g, "fortuneteller", { targets: pick(g, "p1", "p2"), communicated: yes(true) })).toMatchObject({ ok: false, code: "unsupported" });
    expect(store.getState()).toBe(before);
  });

  it("an unverified information modifier remains entirely manual despite supplied values", () => {
    const g = { ...impair(proofGame(["empath", "imp", "chef", "monk", "baron"]), "p0"), fabled: ["revolutionary"] };
    openInStore(g); const before = store.getState();
    expect(use(g, "empath", { communicated: num(2) })).toMatchObject({ ok: false, code: "unsupported" });
    expect(store.getState()).toBe(before);
  });

  it.each(["chef", "empath", "fortuneteller"])("%s ability loss never fabricates an impaired information delivery", role => {
    const original = role === "fortuneteller" ? ft() : proofGame([role, "imp", "baron", "monk", "soldier"], "night", 1);
    const g = impair(original, "p0", "abilityLost"); openInStore(g); const before = store.getState();
    expect(use(g, role, role === "fortuneteller" ? { targets: pick(g, "p1", "p3"), communicated: yes(true) } : { communicated: num(1) })).toMatchObject({ ok: false });
    expect(store.getState()).toBe(before);
  });

  it("Chef accepted communication saves once, refuses duplicate, survives reload, Undo and private projections", async () => {
    const g = proofGame(["chef", "imp", "baron", "monk", "soldier"], "night", 1);
    openInStore(g); const write = vi.spyOn(Storage.prototype, "setItem");
    expect(use(g, "chef")).toMatchObject({ ok: true, changed: true });
    const next = store.getState().game!; expect(write).toHaveBeenCalledTimes(1); expect(store.getState().undoStack).toHaveLength(1);
    expect(use(next, "chef")).toMatchObject({ ok: false }); expect(store.getState().game).toBe(next);
    const projected = JSON.stringify([projectLobbyToPublic(next, {}), projectLobbyToSelfMap(next, proofRegistry)]);
    expect(projected).not.toMatch(/informationDeliveries|evilPairs|actualRole|actualAlignment/);
    const saved = localStorage.getItem("new-blood-st")!; store.setState({ game: null, undoStack: [] });
    localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate(); expect(store.getState().game).toEqual(next);
    store.getState().undo(); expect(store.getState().game).toEqual(g);
  });

  it.each(["privacy", "recovery", "stale", "no-writer", "storage"])("Chef refuses %s without publication", mode => {
    const g = proofGame(["chef", "imp", "baron", "monk", "soldier"], "night", 1);
    openInStore(g); const context = captureCharacterActionContext();
    if (mode === "privacy") usePrivacyStore.getState().setEnabled(true);
    if (mode === "recovery") store.setState({ terminalClose: { intent: { kind: "declare", winner: "good" }, status: "failed", message: "Retry", recoveryPending: true } });
    if (mode === "stale") store.getState().setNotes("p1", "Changed");
    if (mode === "no-writer") store.setState({ lobby: { code: "B5REVIEW", uid: "host", sessionId: "s", status: "live" }, game: { ...g, code: "B5REVIEW", storytellerUid: "host" } });
    if (mode === "storage") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    const before = store.getState(); const saved = localStorage.getItem("new-blood-st"); let published = 0; const stop = store.subscribe(() => published++);
    try {
      expect(store.getState().resolveAbility(request(g, "p0", "chef", {}, { withStep: true, completeStep: true }), undefined, mode === "stale" ? context : captureCharacterActionContext())).toMatchObject({ ok: false });
      expect(store.getState().game).toBe(before.game); expect(store.getState().undoStack).toBe(before.undoStack); expect(published).toBe(0);
      expect(localStorage.getItem("new-blood-st")).toBe(saved);
    } finally { stop(); }
  });

  it("a replaced target cannot inherit a pending Fortune Teller choice", () => {
    const g = ft(); const req = request(g, "p0", "fortuneteller", { targets: pick(g, "p1", "p3") }, { withStep: true, completeStep: true });
    const replacement = reseat(g, "p1"); openInStore(replacement); const before = store.getState();
    expect(store.getState().resolveAbility(req, undefined, captureCharacterActionContext())).toMatchObject({ ok: false, code: "stale" });
    expect(store.getState()).toBe(before);
  });
});
