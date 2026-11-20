// SV-2a -- Snake Charmer: "Each night, choose an alive player: a chosen Demon swaps characters & alignments with you & is then
// poisoned." https://wiki.bloodontheclocktower.com/Snake_Charmer -- production semantics, the real coordinator and the real store.
import { beforeEach, describe, expect, it } from "vitest";
import { SNAKE_CHARMER, SNAKE_CHARMER_TARGET, snakeCharmerRegistersAsDemonId } from "./snakecharmer";
import { bind, homebrewEnv, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, proofQuery, proofRegistry, proofScript, request, requirementIds } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { participantStepKey } from "@/stores/nightProgress";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { computeNightOrder } from "@/rules/night/nightOrder";
import { officialEffectPresentation } from "@/features/reminders/officialReminderPresentation";
import type { StorytellerLobbyRecord } from "@/stores/types";

// p0 snakecharmer, p1 imp, p2 clockmaker, p3 dreamer, p4 witch, p5 mathematician
const ROLES = ["snakecharmer", "imp", "clockmaker", "dreamer", "witch", "mathematician"];
const game = () => store.getState().game!;
const pid = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.participantId!;
const charm = (g: StorytellerLobbyRecord, target: string, extra: Record<string, unknown> = {}, env = undefined as ReturnType<typeof homebrewEnv> | undefined, actor = "p0") =>
  plan(g, request(g, actor, "snakecharmer", { [SNAKE_CHARMER_TARGET]: pick(g, target), ...extra }, { withStep: true, completeStep: true }), env);
const roles = (g: StorytellerLobbyRecord) => g.seatOrder.map((id) => g.players[id]!.actualRole);
const functions = (g: StorytellerLobbyRecord, id: string) => proofQuery(g).abilityFunctions(bind(g, id));
const step = (g: StorytellerLobbyRecord, id: string, roleId: string) => g.nightProgress[`${g.day}:${participantStepKey(pid(g, id), roleId)}`]?.status;
/** Only the step record changed: nothing happened. */
const nothingHappened = (g: StorytellerLobbyRecord, next: StorytellerLobbyRecord, actor = "p0") => {
  expect(next.players).toEqual(g.players);
  expect(step(next, actor, "snakecharmer")).toBe("done");
};

beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));

describe("Snake Charmer -- the choice", () => {
  it("a player who is not the Demon: nothing happens, the step closes", () => {
    const g = proofGame(ROLES);
    for (const target of ["p2", "p4"]) nothingHappened(g, planned(charm(g, target)));
  });

  it("themself: nothing happens (wiki example)", () => {
    const g = proofGame(ROLES);
    nothingHappened(g, planned(charm(g, "p0")));
  });

  it("only an alive player may be chosen", () => {
    const g = patchPlayer(proofGame(ROLES), "p1", { alive: false });
    expect(charm(g, "p1")).toMatchObject({ ok: false });
    expect(SNAKE_CHARMER.inputs[0]).toMatchObject({ constraints: ["alive"], source: "player" });
    expect(SNAKE_CHARMER.presentation).toMatchObject({ complexity: "simple", action: "Choose an alive player" });
  });

  it("the Demon: characters and alignments swap, each player is told, the old Demon is poisoned for good, the new Snake Charmer does not choose again tonight", () => {
    const g = proofGame(ROLES);
    const next = planned(charm(g, "p1"));
    expect(roles(next).slice(0, 2)).toEqual(["imp", "snakecharmer"]);
    expect(next.players.p0).toMatchObject({ actualRole: "imp", shownRole: "imp", actualAlignment: "evil", shownAlignment: null });
    expect(next.players.p1).toMatchObject({ actualRole: "snakecharmer", shownRole: "snakecharmer", actualAlignment: "good", shownAlignment: null });
    const poison = next.players.p1!.effects;
    expect(poison).toEqual([expect.objectContaining({ type: "poisoned", sourceCharacter: "snakecharmer", lifetime: { kind: "manual" }, state: "active",
      sourceParticipant: expect.objectContaining({ playerId: "p0", participantId: pid(g, "p0") }) })]);
    expect(poison[0]!.expiry).toEqual({ kind: "none" });
    expect(functions(next, "p1")).toEqual({ known: true, value: false });
    // The new Snake Charmer's step tonight is skipped; the new Imp acts tonight as usual.
    expect(step(next, "p1", "snakecharmer")).toBe("skipped");
    expect(step(next, "p0", "imp")).toBeUndefined();
    expect(plan(next, request(next, "p1", "snakecharmer", { [SNAKE_CHARMER_TARGET]: pick(next, "p0") }))).toMatchObject({ ok: false, code: "notApplicable" });
    const order = computeNightOrder(next.players, next.seatOrder, proofScript, false, next);
    expect(order.some((s) => s.kind === "player" && s.playerId === "p0" && s.effectiveRoleId === "imp")).toBe(true);
    // The new Imp kills tonight through the real coordinator.
    expect(planned(plan(next, request(next, "p0", "imp", { target: pick(next, "p3") }, { withStep: true, completeStep: true }))).players.p3!.alive).toBe(false);
  });

  it("the poison is permanent: it outlasts the night, the new Demon's death and a later character change; the poisoned Snake Charmer's choice does nothing", () => {
    const next = planned(charm(proofGame(ROLES), "p1"));
    const later = { ...next, phase: "night" as const, day: 5 };
    expect(functions(later, "p1")).toEqual({ known: true, value: false });
    expect(functions(patchPlayer(later, "p0", { alive: false }), "p1")).toEqual({ known: true, value: false });
    expect(functions(patchPlayer(later, "p0", { actualRole: "chef", shownRole: "chef" }), "p1")).toEqual({ known: true, value: false });
    // The poisoned new Snake Charmer chooses the new Demon on a later night: nothing happens.
    nothingHappened(later, planned(charm(later, "p0", {}, undefined, "p1")), "p1");
  });

  it("the official POISONED token of the Snake Charmer is drawn on the old Demon", () => {
    const next = planned(charm(proofGame(ROLES), "p1"));
    const tokens = officialEffectPresentation(next.players.p1!, { query: proofQuery(next), target: bind(next, "p1") }).tokens;
    expect(tokens.map((t) => [t.key, t.label])).toEqual([["snakecharmer:poisoned", "Poisoned"]]);
  });

  it("drunk or poisoned, or a Drunk shown the Snake Charmer: the choice is made and nothing happens", () => {
    for (const type of ["drunk", "poisoned"]) {
      const g = impair(proofGame(ROLES), "p0", type);
      nothingHappened(g, planned(charm(g, "p1")));
    }
    const drunk = patchPlayer(proofGame(ROLES), "p0", { actualRole: "drunk", shownRole: "snakecharmer", behaviorMode: "drunk_fake_role_behavior" });
    expect(charm(drunk, "p1")).toMatchObject({ ok: true });
    const result = charm(drunk, "p1");
    if (result.ok && result.changed) expect(result.plan.game.players).toEqual(drunk.players);
  });

  it("a Recluse (who might register as a Demon): the Storyteller's ruling; Yes swaps, No changes nothing; a drunk Recluse is never asked", () => {
    const g = patchPlayer(proofGame(ROLES), "p4", { actualRole: "recluse", shownRole: "recluse", actualAlignment: "good" });
    const id = snakeCharmerRegistersAsDemonId(pid(g, "p4"));
    const asked = charm(g, "p4");
    expect(requirementIds(asked)).toEqual([id]);
    expect(asked).toMatchObject({ message: "Player 4 might register as a Demon." });
    nothingHappened(g, planned(charm(g, "p4", { [id]: { kind: "boolean", value: false } })));
    const yes = planned(charm(g, "p4", { [id]: { kind: "boolean", value: true } }));
    expect(yes.players.p0).toMatchObject({ actualRole: "recluse", actualAlignment: "good" });
    expect(yes.players.p4).toMatchObject({ actualRole: "snakecharmer", actualAlignment: "good" });
    expect(functions(yes, "p4")).toEqual({ known: true, value: false });
    const drunkRecluse = impair(g, "p4", "drunk");
    nothingHappened(drunkRecluse, planned(charm(drunkRecluse, "p4")));
  });

  it("two Demons alive: the chosen one swaps", () => {
    const g = patchPlayer(proofGame(ROLES), "p5", { actualRole: "vortox", shownRole: "vortox", actualAlignment: "evil" });
    const next = planned(charm(g, "p5"));
    expect(roles(next)).toEqual(["vortox", "imp", "clockmaker", "dreamer", "witch", "snakecharmer"]);
    expect(next.players.p1!.actualRole).toBe("imp");
  });

  it("\"swap their alignments as appropriate\": an evil Snake Charmer and an evil Demon both stay evil; a good Demon becomes a good Snake Charmer", () => {
    const evil = patchPlayer(proofGame(ROLES), "p0", { actualAlignment: "evil", shownAlignment: "evil" });
    const a = planned(charm(evil, "p1"));
    expect(a.players.p0).toMatchObject({ actualRole: "imp", actualAlignment: "evil", shownAlignment: null });
    expect(a.players.p1).toMatchObject({ actualRole: "snakecharmer", actualAlignment: "evil", shownAlignment: "evil" });
    const good = patchPlayer(proofGame(ROLES), "p1", { actualAlignment: "good", shownAlignment: "good" });
    const b = planned(charm(good, "p1"));
    expect(b.players.p0).toMatchObject({ actualRole: "imp", actualAlignment: "good", shownAlignment: "good" });
    expect(b.players.p1).toMatchObject({ actualRole: "snakecharmer", actualAlignment: "good", shownAlignment: null });
  });

  it("a concealed identity or an unofficial character: by hand", () => {
    const g = proofGame(ROLES);
    expect(charm(patchPlayer(g, "p1", { shownRole: "soldier" }), "p1")).toMatchObject({ ok: false, code: "unsupported" });
    expect(charm(g, "p1", {}, homebrewEnv("snakecharmer"))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("the first night: the swap happens after the Demon's information, with the same bookkeeping", () => {
    const g = proofGame(ROLES, "night", 1);
    const next = planned(charm(g, "p1"));
    expect(roles(next).slice(0, 2)).toEqual(["imp", "snakecharmer"]);
    expect(step(next, "p1", "snakecharmer")).toBe("skipped");
    const first = computeNightOrder(g.players, g.seatOrder, proofScript, true, g).map((s) => s.kind === "player" ? s.effectiveRoleId : s.stepKey);
    expect(first.indexOf("snakecharmer")).toBeGreaterThan(first.indexOf("demonInfo"));
  });

  it("a dead Snake Charmer has no ability", () => {
    const g = patchPlayer(proofGame(ROLES), "p0", { alive: false });
    expect(charm(g, "p1")).toMatchObject({ ok: false });
  });
});

describe("Snake Charmer -- one commit, Undo, reload, and what the phones see", () => {
  it("one commit; Undo restores both characters, both alignments, the poison and the steps together", () => {
    const g = proofGame(ROLES);
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "snakecharmer", { [SNAKE_CHARMER_TARGET]: pick(g, "p1") }, { withStep: true, completeStep: true })))
      .toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(1);
    expect(roles(game()).slice(0, 2)).toEqual(["imp", "snakecharmer"]);
    store.getState().undo();
    // By design a changed visible identity always gets a fresh reveal token, Undo included (revealTokens.ts): everything else is restored.
    const without = (x: StorytellerLobbyRecord) => Object.fromEntries(Object.entries(x.players).map(([id, p]) => [id, { ...p, revealToken: null }]));
    expect(without(game())).toEqual(without(g));
    expect(game().nightProgress).toEqual(g.nightProgress);
  });

  it("a saved and reloaded game keeps the swap and the permanent poison (same stored format)", () => {
    const next = planned(charm(proofGame(ROLES), "p1"));
    const parsed = StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(next)));
    expect(parsed.success).toBe(true);
    const reloaded = parsed.data as unknown as StorytellerLobbyRecord;
    expect(reloaded.gameSchemaVersion).toBe(next.gameSchemaVersion);
    expect(roles(reloaded).slice(0, 2)).toEqual(["imp", "snakecharmer"]);
    expect(functions(reloaded, "p1")).toEqual({ known: true, value: false });
  });

  it("only the two swapped players' own views change, each to their new character and alignment; no poison, no Minion list; the public view does not change", () => {
    const g = proofGame(ROLES);
    const next = planned(charm(g, "p1"));
    const before = projectLobbyToSelfMap(g, proofRegistry), after = projectLobbyToSelfMap(next, proofRegistry);
    for (const id of ["p2", "p3", "p4", "p5"]) expect(after[id]).toEqual(before[id]);
    expect(after.p0).toMatchObject({ shownRole: "imp", shownAlignment: "evil" });
    expect(after.p1).toMatchObject({ shownRole: "snakecharmer", shownAlignment: "good" });
    expect(JSON.stringify(after.p1)).not.toMatch(/poison/i);
    expect(JSON.stringify(after.p0)).not.toMatch(/witch|poison/i);
    expect(projectLobbyToPublic(next, {})).toEqual(projectLobbyToPublic(g, {}));
  });
});
