import { z } from "zod";
import { isCanonicalRole } from "@/data/canonical";
import type { RoleRegistry } from "@/data/roleRegistry";
import { interactionCoverageEligibility } from "@/abilities/automationEligibility";
import { createRulesQuery, boundParticipant } from "./rulesQuery";
import { wakeIdentity } from "./wakeIdentity";
import { participantRefOf } from "./participants";
import { sameSnapshot } from "./history";
import { newReminderId, planReminderTransaction, applyReminderPlan, type ReminderIntent } from "./reminderResolution";
import { planInformationDelivery, applyInformationDeliveryPlan } from "./informationDelivery";
import { participantStepKey, planNightStepStatus } from "./nightProgress";
import type { ParticipantBinding } from "./abilityResolution";
import type { CurrentParticipantRef, InformationValue, PreparedInformationCharacter, PreparedInformationRecord, Script, StorytellerLobbyRecord } from "./types";

export type PreparationEnvironment = { registry: RoleRegistry; script: Script | null };
const binding = z.object({ playerId: z.string().min(1), participantId: z.string().min(1) }).strict();
const expected = z.object({ gameCode: z.string(), scriptId: z.string(), scriptFingerprint: z.string() }).strict();
const character = z.enum(["washerwoman", "librarian", "investigator"]);
const requestSchema = z.object({ character, source: binding, expected, clue: z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pair"), candidates: z.tuple([binding, binding]), shownCharacter: z.string().min(1), qualifyingParticipantId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("zero-outsiders") }).strict(),
]) }).strict();
export type PrepareInformationRequest = z.infer<typeof requestSchema>;
const deliverySchema = z.object({ preparationId: z.string().min(1), source: binding, expected }).strict();
export type DeliverPreparedInformationRequest = z.infer<typeof deliverySchema>;
export type PreparedInformationResult = { ok: true; changed: boolean; preparationId?: string } | { ok: false; message: string };
type Plan = { ok: true; changed: true; game: StorytellerLobbyRecord; preparationId: string } | { ok: true; changed: false; preparationId: string } | { ok: false; message: string };
const refuse = (message: string): { ok: false; message: string } => ({ ok: false, message });
const types = { washerwoman: "townsfolk", librarian: "outsider", investigator: "minion" } as const;
const labels = { washerwoman: "Townsfolk", librarian: "Outsider", investigator: "Minion" } as const;
// Schema parsing may reorder keys; equivalent saved scripts retain context.
const stableValue = (value: unknown): unknown => Array.isArray(value) ? value.map(stableValue)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, v]) => [key, stableValue(v)])) : value;
export const preparedInformationContext = (game: StorytellerLobbyRecord, script: Script | null) => ({
  gameCode: game.code, scriptId: game.scriptId, scriptFingerprint: JSON.stringify(stableValue(script)),
});
// A matching explicit communication closes pending intent. Its contents never
// become mechanical truth or reconstruct a missing clue.
const alreadyCommunicated = (game: StorytellerLobbyRecord, source: ParticipantBinding, role: PreparedInformationCharacter) => game.informationDeliveries.some(delivery =>
  delivery.kind !== "manual" && delivery.recipient.kind === "participant" && delivery.recipient.participantId === source.participantId &&
  delivery.recipient.playerId === source.playerId && (delivery.performedRole ?? delivery.actualRole) === role &&
  delivery.moment?.phase === "night" && delivery.moment.day === 1 &&
  (delivery.informationActionId === `${role}-first-night` || role === "librarian" && delivery.informationActionId === "librarian-first-night-zero"));

/** Official W/L/I almanacs: the chosen qualifying candidate owns the clue;
 * the other candidate is any distinct player, not necessarily another type.
 * https://wiki.bloodontheclocktower.com/Washerwoman
 * https://wiki.bloodontheclocktower.com/Librarian
 * https://wiki.bloodontheclocktower.com/Investigator
 * RulesQuery decides truth; reminders are inspected only for lifecycle integrity. */
export function preparationAvailability(game: StorytellerLobbyRecord, source: ParticipantBinding, role: PreparedInformationCharacter, environment: PreparationEnvironment): { ok: true; mode: "verified" | "storyteller" } | { ok: false; message: string } {
  const player = boundParticipant(game, source);
  if (!player || !player.packetEpoch || !player.alive) return refuse("This player's current identity is unavailable for preparation.");
  const definition = environment.registry.get(role);
  if (!definition || !isCanonicalRole(definition) || !environment.script) return refuse("This information is not supported by the current script.");
  const wake = wakeIdentity(player, environment.registry);
  if (player.actualRole !== role && (!wake?.simulated || wake.shownRoleId !== role)) return refuse("This player does not own that information action.");
  if (wake?.simulated && wake.shownRoleId !== role) return refuse("The player's shown character changed.");
  const query = createRulesQuery(game, environment);
  const coverage = interactionCoverageEligibility(query);
  if (coverage.kind === "manual") return refuse(coverage.reason);
  const gate = query.modifierGate(role, ["information", "registration", "targeting", "wake"]);
  if (gate.kind !== "clear") return refuse("A rule affecting this clue needs manual Storyteller handling.");
  for (const effect of player.effects) if (effect.type === "abilityLost") {
    const applies = query.effectApplies(source, effect);
    if (!applies.known || applies.value) return refuse("This player's ability is unavailable.");
  }
  const functioning = query.abilityFunctions(source);
  if (!functioning.known) return refuse(functioning.reason);
  return { ok: true, mode: wake?.simulated || !functioning.value ? "storyteller" : "verified" };
}

export function assessPreparation(game: StorytellerLobbyRecord, input: PrepareInformationRequest, environment: PreparationEnvironment) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return refuse("The clue selection is invalid.");
  const request = parsed.data;
  if (!sameSnapshot(request.expected, preparedInformationContext(game, environment.script))) return refuse("The game or script changed. Select the clue again.");
  if (game.phase !== "setup" && !(game.phase === "night" && game.day === 1)) return refuse("First-night clues can only be prepared during Setup or Night 1.");
  if (game.nightProgress[`1:${participantStepKey(request.source.participantId, request.character)}`]?.status === "done") return refuse("This information action has already been completed.");
  if (alreadyCommunicated(game, request.source, request.character)) return refuse("This information has already been communicated.");
  const available = preparationAvailability(game, request.source, request.character, environment);
  if (!available.ok) return available;
  const query = createRulesQuery(game, environment);
  if (request.clue.kind === "zero-outsiders") {
    if (request.character !== "librarian") return refuse("Only the Librarian can learn that there are no Outsiders.");
    if (available.mode === "verified") for (const player of Object.values(game.players)) {
      if (player.isEmpty || !player.participantId) continue;
      const registered = query.registersAsType({ playerId: player.id, participantId: player.participantId }, "outsider", "librarian");
      if (!registered.known) return refuse(registered.reason);
      if (registered.value) return refuse("An Outsider is in play.");
    }
  } else {
    const clue = request.clue;
    if (clue.candidates[0].participantId === clue.candidates[1].participantId || clue.candidates[0].playerId === clue.candidates[1].playerId) return refuse("Choose two distinct players.");
    const targets = clue.candidates.map(target => boundParticipant(game, target));
    if (targets.some(target => !target?.packetEpoch)) return refuse("A selected player's identity changed or is unavailable.");
    const qualifying = clue.candidates.find(target => target.participantId === clue.qualifyingParticipantId);
    if (!qualifying) return refuse("The qualifying player must be one of the two selected players.");
    const shown = environment.registry.get(clue.shownCharacter);
    if (!shown || !isCanonicalRole(shown) || shown.type !== types[request.character]) return refuse("Choose a character of the appropriate type.");
    if (available.mode === "verified") {
      const registration = query.registration(qualifying, request.character).character;
      if (!registration.known) return refuse(registration.reason);
      if (registration.value !== clue.shownCharacter) return refuse("The qualifying player does not register as the selected character.");
    }
  }
  return available;
}

const currentRef = (game: StorytellerLobbyRecord, id: string) => participantRefOf(game, id) as CurrentParticipantRef;
const bindingOnly = (ref: ParticipantBinding): ParticipantBinding => ({ playerId: ref.playerId, participantId: ref.participantId });
const requestOf = (record: PreparedInformationRecord): PrepareInformationRequest => ({ character: record.character, source: { playerId: record.source.playerId, participantId: record.source.participantId },
  expected: { gameCode: record.gameCode, scriptId: record.scriptId, scriptFingerprint: record.scriptFingerprint },
  clue: record.clue.kind === "zero-outsiders" ? record.clue : { kind: "pair", candidates: record.clue.candidates.map(c => ({ playerId: c.participant.playerId, participantId: c.participant.participantId })) as [ParticipantBinding, ParticipantBinding], shownCharacter: record.clue.shownCharacter, qualifyingParticipantId: record.clue.qualifyingParticipantId },
});

function identitiesMatch(game: StorytellerLobbyRecord, record: PreparedInformationRecord): boolean {
  const source = boundParticipant(game, record.source);
  if (!source || source.actualRole !== record.actualRole || source.shownRole !== record.shownRole || source.packetEpoch !== record.sourceIdentityEpoch) return false;
  return record.clue.kind !== "pair" || record.clue.candidates.every(candidate => {
    const target = boundParticipant(game, candidate.participant);
    return !!target && target.actualRole === candidate.actualRole && target.shownRole === candidate.shownRole && target.packetEpoch === candidate.identityEpoch;
  });
}

function remindersMatch(game: StorytellerLobbyRecord, record: PreparedInformationRecord): boolean {
  return record.clue.kind !== "pair" || record.clue.reminders.every(link => {
    const token = boundParticipant(game, link.participant)?.reminders.find(reminder => reminder.id === link.id);
    return token?.label === link.label && token.sourceCharacter === record.character && token.sourceParticipant?.kind === "participant" && token.sourceParticipant.participantId === record.source.participantId;
  });
}

export function validatePreparedInformation(game: StorytellerLobbyRecord, record: PreparedInformationRecord, environment: PreparationEnvironment) {
  if (!game.preparedInformation.some(p => p.id === record.id && sameSnapshot(p, record)) || !identitiesMatch(game, record) || !remindersMatch(game, record)) return refuse("This prepared clue changed. Continue manually or prepare it again.");
  const result = assessPreparation(game, requestOf(record), environment);
  if (!result.ok) return result;
  if (result.mode !== record.mode) return refuse("This player's ability changed. Choose the information again or continue manually.");
  return result;
}

/** Applied in the existing commit seam, also covering deal, removal, script,
 * role corrections and raw reminder edits. Undo/recovery restore snapshots;
 * no intent is reconstructed from notation or History. */
export function reconcilePreparedInformation(game: StorytellerLobbyRecord, script: Script | null): StorytellerLobbyRecord {
  if (!game.preparedInformation?.length) return game;
  const context = preparedInformationContext(game, script);
  const remaining = game.preparedInformation.filter(record => record.gameCode === context.gameCode && record.scriptId === context.scriptId && record.scriptFingerprint === context.scriptFingerprint &&
    (game.phase === "setup" || game.phase === "night" && game.day === 1) && identitiesMatch(game, record) && remindersMatch(game, record) &&
    game.nightProgress[`1:${participantStepKey(record.source.participantId, record.character)}`]?.status !== "done" && !alreadyCommunicated(game, record.source, record.character));
  return remaining.length === game.preparedInformation.length ? game : { ...game, preparedInformation: remaining };
}

export function planPreparedInformation(game: StorytellerLobbyRecord, input: PrepareInformationRequest, environment: PreparationEnvironment): Plan {
  const assessment = assessPreparation(game, input, environment);
  if (!assessment.ok) return assessment;
  const request = requestSchema.parse(input);
  const old = game.preparedInformation.find(record => record.source.participantId === request.source.participantId && record.character === request.character);
  if (old && sameSnapshot(requestOf(old), request) && old.mode === assessment.mode && identitiesMatch(game, old) && remindersMatch(game, old)) return { ok: true, changed: false, preparationId: old.id };
  const player = boundParticipant(game, request.source)!;
  const id = newReminderId();
  const intents: ReminderIntent[] = [];
  if (old?.clue.kind === "pair") for (const link of old.clue.reminders) {
    if (boundParticipant(game, link.participant)?.reminders.some(token => token.id === link.id)) intents.push({ kind: "remove", target: bindingOnly(link.participant), reminderId: link.id });
  }
  let clue: PreparedInformationRecord["clue"] = { kind: "zero-outsiders" };
  if (request.clue.kind === "pair") {
    const selected = request.clue;
    const candidates = selected.candidates.map(target => { const player = boundParticipant(game, target)!; return { participant: currentRef(game, target.playerId), actualRole: player.actualRole, shownRole: player.shownRole, identityEpoch: player.packetEpoch! }; }) as Extract<PreparedInformationRecord["clue"], {kind:"pair"}>["candidates"];
    const reminders = candidates.map(candidate => ({ id: newReminderId(), participant: candidate.participant,
      label: candidate.participant.participantId === selected.qualifyingParticipantId ? labels[request.character] : "Wrong" as const })) as Extract<PreparedInformationRecord["clue"], {kind:"pair"}>["reminders"];
    for (const link of reminders) intents.push({ kind: "place", target: bindingOnly(link.participant), reminder: { id: link.id, label: link.label, source: request.source, sourceCharacter: request.character } });
    clue = { kind: "pair", candidates, shownCharacter: selected.shownCharacter, qualifyingParticipantId: selected.qualifyingParticipantId, reminders };
  }
  let next = game;
  if (intents.length) {
    const reminders = planReminderTransaction(next, { intents, resolutionId: id });
    if (!reminders.ok) return reminders;
    if (reminders.changed) next = applyReminderPlan(next, reminders.plan);
  }
  const record: PreparedInformationRecord = { id, character: request.character,
    informationActionId: request.clue.kind === "zero-outsiders" ? "librarian-first-night-zero" : `${request.character}-first-night`,
    source: currentRef(game, player.id), actualRole: player.actualRole, shownRole: player.shownRole, sourceIdentityEpoch: player.packetEpoch!,
    ...request.expected, mode: assessment.mode, clue };
  return { ok: true, changed: true, preparationId: id, game: { ...next, preparedInformation: [...game.preparedInformation.filter(p => p.id !== old?.id), record] } };
}

export function planPreparedInformationDelivery(game: StorytellerLobbyRecord, input: DeliverPreparedInformationRequest, environment: PreparationEnvironment): Plan {
  const parsed = deliverySchema.safeParse(input);
  if (!parsed.success) return refuse("The prepared information request is invalid.");
  const request = parsed.data;
  if (!sameSnapshot(request.expected, preparedInformationContext(game, environment.script))) return refuse("The game or script changed.");
  if (game.phase !== "night" || game.day !== 1) return refuse("Prepared information is delivered during Night 1.");
  const record = game.preparedInformation.find(p => p.id === request.preparationId && p.source.playerId === request.source.playerId && p.source.participantId === request.source.participantId);
  if (!record) return refuse("This preparation is no longer pending.");
  const validation = validatePreparedInformation(game, record, environment);
  if (!validation.ok) return validation;
  const values: InformationValue[] = record.clue.kind === "zero-outsiders" ? [{ requirementId: "outsiders", kind: "number", value: 0 }] : [
    { requirementId: "players", kind: "player", playerIds: record.clue.candidates.map(candidate => candidate.participant.playerId) },
    { requirementId: "role", kind: "role", roleId: record.clue.shownCharacter },
  ];
  const information = planInformationDelivery(game, { recipientPlayerId: record.source.playerId, informationActionId: record.informationActionId, values,
    performedRole: record.character, resolutionId: record.id, context: { provenance: { sourcePlayer: record.source.playerId, sourceCharacter: record.character } } }, environment);
  if (!information.ok) return information;
  const next = applyInformationDeliveryPlan(game, information.record);
  const completed = planNightStepStatus(next, 1, participantStepKey(record.source.participantId, record.character), "done") ?? next;
  return { ok: true, changed: true, preparationId: record.id, game: { ...completed, preparedInformation: completed.preparedInformation.filter(p => p.id !== record.id) } };
}
