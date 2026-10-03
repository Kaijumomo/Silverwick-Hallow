import { expect } from "vitest";
import { buildRegistry } from "@/data/roleRegistry";
import { canonicalRoles } from "@/data/canonical";
import raw from "@/data/canonical/roles.json";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import {
  captureFingerprint,
  planAbilityResolution,
  type AbilityEnvironment,
  type AbilityPlanResult,
  type AbilityResolutionRequest,
  type ParticipantBinding,
} from "@/stores/abilityResolution";
import type { InvocationPath } from "@/abilities/invocation";
import type { AbilityInputs, AbilityInputValue } from "@/abilities/semantics";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { participantStepKey } from "@/stores/nightProgress";
import { makeSTPlayer } from "./fixtures";
import { dealtIdentity } from "@/stores/identity";
import type { RoleDef, RoleId, STPlayerRecord, Script, StorytellerLobbyRecord } from "@/stores/types";

/**
 * Phase 10F Slice 7 test support for the PRODUCTION proof-character semantics
 * (unlike src/test/abilityFixtures.ts, which is rules-neutral). Builds live
 * games over a script containing every canonical character, runs the real
 * coordinator with CANONICAL_ABILITY_SEMANTICS and the game's own modifiers.
 */
export const proofScript: Script = { id: "proof-test", name: "Proof test", characters: canonicalRoles((raw as { id: string }[]).map((r) => r.id)) };
export const proofRegistry = buildRegistry(proofScript);

/** A live game: seat `p{i}` holds roles[i] with its dealt identity and
 * canonical Actual Alignment. */
export function proofGame(roles: RoleId[], phase: "night" | "day" = "night", day = 2, over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const players = roles.map((actualRole, seat) => {
    const dealt = dealtIdentity(actualRole, proofRegistry);
    return makeSTPlayer({ id: "p" + seat, name: "Player " + seat, seat, ...dealt });
  });
  return {
    gameSchemaVersion: 24, code: "", storytellerUid: "local", scriptId: proofScript.id, phase, day,
    players: Object.fromEntries(players.map((p) => [p.id, p])), seatOrder: players.map((p) => p.id),
    plannedPlayerCount: roles.length, plannedTravelerCount: 0, rolePool: [], fabled: [], lorics: [], bluffs: [],
    notes: "", nightProgress: {}, pendingPlayers: {}, history: [], informationDeliveries: [],
    setupRolesDealt: true, setupRolesRevealed: true,
    lifeEventWindow: { coverageFrom: { phase: "night", day: 1 }, events: [] },
    ...over,
  };
}

export const patchPlayer = (g: StorytellerLobbyRecord, id: string, patch: Partial<STPlayerRecord>): StorytellerLobbyRecord =>
  ({ ...g, players: { ...g.players, [id]: { ...g.players[id]!, ...patch } } });

/** Seat reuse: the seat now holds a NEW participation instance. */
export const reseat = (g: StorytellerLobbyRecord, id: string): StorytellerLobbyRecord =>
  patchPlayer(g, id, { participantId: `${g.players[id]!.participantId}-replacement`, name: "Replacement" });

export const bind = (g: StorytellerLobbyRecord, id: string): ParticipantBinding => ({ playerId: id, participantId: g.players[id]!.participantId! });
export const pick = (g: StorytellerLobbyRecord, ...ids: string[]): AbilityInputValue => ({ kind: "participant", participants: ids.map((id) => bind(g, id)) });
export const yes = (value = true): AbilityInputValue => ({ kind: "boolean", value });
export const num = (value: number): AbilityInputValue => ({ kind: "number", value });

/** Applies a poisoned / drunk Effect with no source (a manual impairment). */
export const impair = (g: StorytellerLobbyRecord, id: string, type = "poisoned"): StorytellerLobbyRecord =>
  patchPlayer(g, id, { effects: [...g.players[id]!.effects, { id: `fx-${type}-${id}`, type, lifetime: { kind: "manual" }, state: "active",
    expiry: { kind: "none" }, appliedAt: { phase: g.phase, day: g.day } } as STPlayerRecord["effects"][number]] });

let ids = 0;
export function proofEnv(over: Partial<AbilityEnvironment> = {}): AbilityEnvironment {
  let n = 0;
  const next = (prefix: string) => () => `${prefix}-${++n}`;
  return {
    script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS,
    ids: { life: { eventId: next("le"), historyId: next("hl") }, effect: { effectId: next("fx"), historyId: next("he") },
      reminder: { reminderId: next("rm"), historyId: next("hr") }, role: { historyId: next("hro"), packetEpoch: next("ep") },
      alignment: { historyId: next("ha"), packetEpoch: next("ep") }, deliveryId: next("d"), resolutionId: () => `res-${++ids}` },
    ...over,
  };
}

export function request(
  g: StorytellerLobbyRecord,
  actor: string,
  roleId: RoleId,
  inputs: AbilityInputs = {},
  extra: Partial<Extract<AbilityResolutionRequest, { mode: "guided" }>> & { invocationPath?: InvocationPath; withStep?: boolean } = {},
): AbilityResolutionRequest {
  const { withStep, ...rest } = extra;
  const invocationPath = rest.invocationPath ?? (g.phase === "day" ? "dayEntry" : "nightOrder");
  const participantId = g.players[actor]!.participantId!;
  const step = withStep ? { day: g.day, stepKey: participantStepKey(participantId, roleId) } : undefined;
  return { mode: "guided", invocationPath, fingerprint: captureFingerprint(g, actor, step)!, roleId, inputs, ...rest } as AbilityResolutionRequest;
}

export const plan = (g: StorytellerLobbyRecord, req: AbilityResolutionRequest, env: AbilityEnvironment = proofEnv()): AbilityPlanResult =>
  planAbilityResolution(g, req, env);

/** The planned game of an accepted, changing plan (fails the test otherwise). */
export function planned(result: AbilityPlanResult): StorytellerLobbyRecord {
  expect(result).toMatchObject({ ok: true, changed: true });
  if (!result.ok || !result.changed) throw new Error("not a changing plan");
  return result.plan.game;
}

export const requirementIds = (result: AbilityPlanResult): string[] =>
  !result.ok && result.code === "needsInput" ? (result.requirements ?? []).map((r) => r.id) : [];

/** A script that redefines `roleId` as homebrew (same official id). */
export function homebrewScript(roleId: RoleId, patch: Partial<RoleDef> = {}): Script {
  const official = proofRegistry.get(roleId)!;
  return { id: "hb-" + roleId, name: "Homebrew", characters: [
    { ...official, ...patch, provenance: { status: "homebrew" } } as RoleDef,
    ...proofScript.characters.filter((c) => c.id !== roleId),
  ] };
}
export const homebrewEnv = (roleId: RoleId) => {
  const script = homebrewScript(roleId);
  return proofEnv({ script, registry: buildRegistry(script) });
};

/** Puts `g` into the store as the open game (Undo / one-commit tests). */
export function openInStore(g: StorytellerLobbyRecord) {
  useStorytellerStore.setState({ game: g, lobby: null, undoStack: [], localSeq: 5, customScripts: { [proofScript.id]: proofScript } });
}
