import { butlerReminderId, butlerReminderOrigin } from "./butlerReminders";
export { butlerReminderId, butlerReminderOrigin, planButlerReminderCleanup, reconcileButlerReminders } from "./butlerReminders";
import { z } from "zod";
import { isCanonicalRole } from "@/data/canonical";
import { interactionCoverageEligibility } from "@/abilities/automationEligibility";
import { boundParticipant, createRulesQuery, type RulesQueryEnvironment } from "./rulesQuery";
import { preparedInformationContext } from "./preparedInformation";
import { sameSnapshot } from "./history";
import { participantStepKey, planNightStepStatus } from "./nightProgress";
import { StorytellerGamePersistedSchema } from "./schemas";
import { applyReminderPlan, planReminderTransaction, type ReminderIntent } from "./reminderResolution";
import type { ParticipantBinding } from "./abilityResolution";
import type { Script, StorytellerLobbyRecord } from "./types";

/** Official Butler procedure: record the player's chosen Master. This is
 * private notation only. Neither Voting nor RulesQuery reads this selection;
 * the player owns voting compliance, including when an illegal vote is counted.
 * https://wiki.bloodontheclocktower.com/Butler
 */

const binding = z.object({ playerId: z.string().min(1), participantId: z.string().min(1) }).strict();
const expected = z.object({ gameCode: z.string(), scriptId: z.string(), scriptFingerprint: z.string(),
  storytellerUid: z.string(), sourceEpoch: z.string().min(1), day: z.number().int().positive(),
  stepStatus: z.enum(["absent", "pending", "done", "skipped"]),
}).strict();
const requestSchema = z.object({ source: binding, target: binding, expected }).strict();
export type ButlerSelectionRequest = z.infer<typeof requestSchema>;
export type ButlerSelectionEnvironment = RulesQueryEnvironment & { script: Script | null };
export type ButlerSelectionResult = { ok: true; changed: boolean } | { ok: false; message: string };
export type ButlerSelectionPlan = { ok: true; changed: true; game: StorytellerLobbyRecord } | { ok: true; changed: false } | { ok: false; message: string };
const refuse = (message: string): { ok: false; message: string } => ({ ok: false, message });

export function butlerSelectionContext(game: StorytellerLobbyRecord, script: Script | null, source: ParticipantBinding) {
  return { ...preparedInformationContext(game, script), storytellerUid: game.storytellerUid,
    sourceEpoch: boundParticipant(game, source)?.packetEpoch ?? "", day: game.day,
    stepStatus: game.nightProgress[`${game.day}:${participantStepKey(source.participantId, "butler")}`]?.status ?? "absent" as const };
}

export function butlerSelectionAvailability(game: StorytellerLobbyRecord, source: ParticipantBinding, environment: ButlerSelectionEnvironment): { ok: true } | { ok: false; message: string } {
  const player = boundParticipant(game, source);
  if (game.phase !== "night" || game.day < 1) return refuse("Choose the Butler's Master during Night.");
  if (!player || !player.packetEpoch || !player.alive || player.actualRole !== "butler") return refuse("This living Butler's identity is no longer available.");
  const role = environment.registry.get("butler");
  if (!environment.script || !role || !isCanonicalRole(role)) return refuse("This Butler action is not supported by the current script.");
  const query = createRulesQuery(game, environment);
  const coverage = interactionCoverageEligibility(query);
  if (coverage.kind === "manual") return refuse(coverage.reason);
  if (query.modifierGate("butler", ["targeting", "wake"]).kind !== "clear") return refuse("A rule affecting this action needs manual Storyteller handling.");
  const functioning = query.abilityFunctions(source);
  if (!functioning.known || !functioning.value) return refuse(functioning.known ? "This Butler is impaired or has no ability. Continue manually." : functioning.reason);
  return { ok: true };
}

export function planButlerSelection(game: StorytellerLobbyRecord, input: ButlerSelectionRequest, environment: ButlerSelectionEnvironment): ButlerSelectionPlan {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return refuse("The Master selection is invalid.");
  const request = parsed.data;
  if (!sameSnapshot(request.expected, butlerSelectionContext(game, environment.script, request.source))) return refuse("The game, identity or Night turn changed. Select the Master again.");
  const available = butlerSelectionAvailability(game, request.source, environment);
  if (!available.ok) return available;
  if (!boundParticipant(game, request.target)) return refuse("The selected player is no longer in that seat.");
  if (request.target.participantId === request.source.participantId || request.target.playerId === request.source.playerId) return refuse("The Butler must choose another player.");
  const id = butlerReminderId(request.source.participantId, request.expected.sourceEpoch);
  const intents: ReminderIntent[] = [];
  for (const player of Object.values(game.players)) {
    if (player.isEmpty || !player.participantId) continue;
    for (const reminder of player.reminders) {
      const origin = butlerReminderOrigin(reminder);
      if (!origin || origin.participantId !== request.source.participantId || reminder.sourceParticipant?.kind !== "participant" || reminder.sourceParticipant.playerId !== request.source.playerId) continue;
      if (player.id === request.target.playerId && reminder.id === id && reminder.createdAt?.phase === "night" && reminder.createdAt.day === game.day) continue;
      intents.push({ kind: "remove", target: { playerId: player.id, participantId: player.participantId }, reminderId: reminder.id });
    }
  }
  const target = boundParticipant(game, request.target)!;
  const replaced = intents.some(intent => intent.kind === "remove" && intent.target.playerId === target.id && intent.reminderId === id);
  const existing = replaced ? undefined : target.reminders.find(reminder => reminder.id === id);
  if (!existing) intents.push({ kind: "place", target: request.target, reminder: { id, label: "Master", source: request.source, sourceCharacter: "butler" } });
  else if (!butlerReminderOrigin(existing) || existing.sourceParticipant?.kind !== "participant" || existing.sourceParticipant.playerId !== request.source.playerId) return refuse("This reminder identity has changed. Use Undo or correct it in player settings.");
  let next = game;
  if (intents.length) {
    const result = planReminderTransaction(game, { intents });
    if (!result.ok) return refuse(result.message);
    if (result.changed) next = applyReminderPlan(game, result.plan);
  }
  next = planNightStepStatus(next, game.day, participantStepKey(request.source.participantId, "butler"), "done") ?? next;
  if (!StorytellerGamePersistedSchema.safeParse(next).success) return refuse("The Master selection cannot be saved in this game state.");
  return next === game ? { ok: true, changed: false } : { ok: true, changed: true, game: next };
}

