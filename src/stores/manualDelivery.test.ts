// Phase 10G, Slice 3: Manual Information Delivery (PHASE10G Section 12).
// Traceability: 10G-AC-18..21, 10G-AC-43; proof area 6.
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { captureFingerprint, composeAbilityOutcome, type AbilityOutcome, type ParticipantBinding } from "./abilityResolution";
import { planManualInformationDelivery } from "./informationDelivery";
import { InformationDeliveryRecordSchema, MAX_MANUAL_DELIVERY_TEXT, StorytellerGamePersistedSchema } from "./schemas";
import { participantStepKey } from "./nightProgress";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { buildRegistry } from "@/data/roleRegistry";
import type { StorytellerLobbyRecord } from "./types";

type Raw = Record<string, unknown>;
const state = () => store.getState();
const game = () => state().game!;
const registry = buildRegistry(setupScript);
// p0 monk, p1 slayer, p2 empath, p3 pithag, p4 imp, p5 chef, p6 drunk (shown as the Empath)
const ROLES = ["monk", "slayer", "empath", "pithag", "imp", "chef", "drunk"];

beforeEach(() => store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, customScripts: { [setupScript.id]: setupScript } }));

function liveGame(phase: "night" | "day" = "night", day = 2, over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase, day, setupRolesDealt: true, setupRolesRevealed: true, ...over });
  for (const p of Object.values(g.players)) p.actualAlignment = registry.alignmentOf(p.actualRole);
  g.players.p6 = { ...g.players.p6!, shownRole: "empath", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" };
  return g;
}
function live(phase: "night" | "day" = "night", day = 2) {
  store.setState({ game: liveGame(phase, day), undoStack: [], localSeq: 5 });
}
const bind = (id: string): ParticipantBinding => ({ playerId: id, participantId: game().players[id]!.participantId! });
const told = (id: string, text: string, performedRole?: string): AbilityOutcome["operations"][number] =>
  ({ domain: "manualInformation", recipient: bind(id), text, ...(performedRole ? { performedRole } : {}) });

describe("10G-AC-18: the explicit Manual variant", () => {
  it("plans a Manual record that carries no Information Action and validates under v25", () => {
    const g = liveGame();
    const result = planManualInformationDelivery(g, { recipientPlayerId: "p5", text: "You learn: your neighbour is not the Demon." }, { registry, deliveryId: () => "d-1" });
    expect(result).toEqual({ ok: true, record: { kind: "manual", id: "d-1", recipient: expect.objectContaining({ kind: "participant", playerId: "p5" }),
      actualRole: "chef", moment: { phase: "night", day: 2 }, text: "You learn: your neighbour is not the Demon." } });
    if (!result.ok) throw new Error("expected a record");
    expect(result.record).not.toHaveProperty("informationActionId");
    expect(result.record).not.toHaveProperty("values");
    expect(InformationDeliveryRecordSchema.safeParse(result.record).success).toBe(true);
  });

  it.each([
    ["an empty text", ""],
    ["a blank text", "   "],
    ["a non-string text", 7],
    [`text over ${MAX_MANUAL_DELIVERY_TEXT} characters`, "x".repeat(MAX_MANUAL_DELIVERY_TEXT + 1)],
  ])("refuses %s -- never truncated", (_label, text) => {
    expect(planManualInformationDelivery(liveGame(), { recipientPlayerId: "p5", text }, { registry })).toMatchObject({ ok: false });
  });

  it("accepts exactly the bound", () => {
    expect(planManualInformationDelivery(liveGame(), { recipientPlayerId: "p5", text: "x".repeat(MAX_MANUAL_DELIVERY_TEXT) }, { registry })).toMatchObject({ ok: true });
  });

  it("refuses an ended game, Setup and an empty seat", () => {
    expect(planManualInformationDelivery(liveGame("night", 2, { phase: "ended" }), { recipientPlayerId: "p5", text: "x" }, { registry })).toMatchObject({ ok: false, message: expect.stringMatching(/ended/) });
    expect(planManualInformationDelivery(liveGame("night", 2, { phase: "setup", day: 0 }), { recipientPlayerId: "p5", text: "x" }, { registry })).toMatchObject({ ok: false });
    expect(planManualInformationDelivery(liveGame(), { recipientPlayerId: "nobody", text: "x" }, { registry })).toMatchObject({ ok: false });
  });

  it("10G-AC-43 / proof area 6: the schema rejects any Manual record impersonating a structured action (and vice versa)", () => {
    const g = liveGame();
    const base = (planManualInformationDelivery(g, { recipientPlayerId: "p5", text: "told" }, { registry }) as { record: Raw }).record;
    for (const corrupt of [
      { informationActionId: "chef-first-night" },
      { values: [] },
      { text: "x".repeat(MAX_MANUAL_DELIVERY_TEXT + 1) },
      { text: "  " },
      { kind: "structured" },
      { recipient: { kind: "legacy", playerId: "p5" } },
      { moment: { phase: "setup", day: 0 } },
      { performedRole: "chef" },
      { stray: 1 },
    ]) {
      expect(InformationDeliveryRecordSchema.safeParse({ ...base, ...corrupt }).success, JSON.stringify(corrupt)).toBe(false);
    }
  });

  it("10G-AC-19: a structured delivery keeps its exact v24 shape -- no discriminator required, and a `kind` key is rejected", () => {
    live();
    state().recordInformationDelivery("p2", "empath-other-night", [{ requirementId: "evilNeighbors", kind: "number", value: 1 }]);
    const structured = game().informationDeliveries[0]!;
    expect(structured).not.toHaveProperty("kind");
    expect(InformationDeliveryRecordSchema.safeParse(structured).success).toBe(true);
    expect(InformationDeliveryRecordSchema.safeParse({ ...structured, kind: "manual" }).success).toBe(false);
    expect(InformationDeliveryRecordSchema.safeParse({ ...structured, kind: undefined, text: "smuggled" }).success).toBe(false);
  });
});

describe("10G-AC-20: Manual workspace communication commits through resolveAbility", () => {
  it("a Manual resolution with a death and Information told commits once, correlated and visibly manual", () => {
    live();
    const result = state().resolveAbility({ mode: "manual", reason: "Homebrew wake", roleId: "chef", outcome: { operations: [
      { domain: "life", intents: [{ kind: "death", target: bind("p1") }] },
      told("p5", "The Storyteller showed a thumbs down."),
    ] } });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(state().undoStack).toHaveLength(1);
    expect(state().localSeq).toBe(6);
    const delivery = game().informationDeliveries[0]!;
    expect(delivery).toMatchObject({ kind: "manual", text: "The Storyteller showed a thumbs down.", resolutionId: (result as { resolutionId: string }).resolutionId,
      provenance: { reason: "manual", note: "Homebrew wake" } });
    expect(game().players.p1!.alive).toBe(false);
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
  });

  it("oversized text refuses the WHOLE resolution -- the death is not committed either", () => {
    live();
    const before = { game: game(), undo: state().undoStack, seq: state().localSeq };
    const result = state().resolveAbility({ mode: "manual", reason: "x", outcome: { operations: [
      { domain: "life", intents: [{ kind: "death", target: bind("p1") }] },
      told("p5", "x".repeat(MAX_MANUAL_DELIVERY_TEXT + 1)),
    ] } });
    expect(result).toMatchObject({ ok: false, code: "domain", domain: "manualInformation" });
    expect(game()).toBe(before.game);
    expect(state().undoStack).toBe(before.undo);
    expect(state().localSeq).toBe(before.seq);
  });

  it("an ended game refuses it (the Manual delivery path itself refuses ended)", () => {
    live();
    store.setState({ game: { ...game(), phase: "ended" } });
    expect(state().resolveAbility({ mode: "manual", reason: "x", outcome: { operations: [told("p5", "late")] } })).toMatchObject({ ok: false });
  });

  it("a guided evaluator outcome can never record a Manual delivery", () => {
    const g = liveGame();
    const result = composeAbilityOutcome(g, { operations: [{ domain: "manualInformation", recipient: { playerId: "p5", participantId: g.players.p5!.participantId! }, text: "x" }] },
      { script: setupScript, registry }, { resolutionId: "r" });
    expect(result).toMatchObject({ ok: false, code: "invalid" });
  });

  it("a stale recipient is refused, never redirected to the seat's new occupant", () => {
    live();
    const stale = { playerId: "p5", participantId: "someone-else" };
    expect(state().resolveAbility({ mode: "manual", reason: "x", outcome: { operations: [{ domain: "manualInformation", recipient: stale, text: "x" }] } }))
      .toMatchObject({ ok: false, code: "stale" });
  });
});

describe("Section 12.3: performed Role only from the workflow's simulated wake", () => {
  it("the Drunk shown as the Empath may be recorded as the Empath procedure in the Empath workflow", () => {
    live();
    const fingerprint = captureFingerprint(game(), "p6", { day: 2, stepKey: participantStepKey(game().players.p6!.participantId!, "empath") })!;
    const result = state().resolveAbility({ mode: "manual", reason: "x", roleId: "empath", fingerprint, outcome: { operations: [told("p6", "You learn: 1", "empath")] }, completeStep: true });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(game().informationDeliveries[0]).toMatchObject({ kind: "manual", actualRole: "drunk", performedRole: "empath" });
  });

  it.each([
    ["an arbitrary unrelated Role", "p6", "empath", "imp"],
    ["a Role on someone other than the workflow's actor", "p5", "empath", "empath"],
    ["the workflow's Role when the recipient is not shown it", "p2", "chef", "chef"],
  ])("refuses %s", (_label, recipient, workflowRole, performed) => {
    live();
    const fingerprint = captureFingerprint(game(), "p6")!;
    const result = state().resolveAbility({ mode: "manual", reason: "x", roleId: workflowRole, fingerprint, outcome: { operations: [told(recipient, "told", performed)] } });
    expect(result).toMatchObject({ ok: false });
  });

  it("without a workflow Role, no performed Role can be recorded", () => {
    live();
    expect(state().resolveAbility({ mode: "manual", reason: "x", outcome: { operations: [told("p6", "told", "empath")] } })).toMatchObject({ ok: false });
  });
});
