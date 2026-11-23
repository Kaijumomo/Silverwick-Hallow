import type { AbilityDescriptor, AbilityEvaluationContext } from "./semantics";
import type { AbilityOperation, AbilityOutcome } from "@/stores/abilityResolution";
import type { EffectIntent } from "@/stores/effectResolution";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { ABNORMAL_IMPAIRED, ABNORMAL_VORTOX, abnormalMarkIntents, clearAbnormalIntents, mathematicianListening } from "@/stores/abnormalMarks";

/**
 * SV-5g2 (PO Q17 A, 2026-11-23): the ABNORMAL marks the app places BY ITSELF, read by the ability coordinator for every descriptor,
 * never per character. Only two cases, each settled by one comparison against a truth the app already works out:
 *  - the shared false-information rule applied (a Vortox: "Townsfolk abilities yield false info"), so the information delivered is false
 *    because of the Vortox ("Vortox: false information"; the page's third example counts each such Townsfolk);
 *  - a drunk or poisoned player's real ability delivered information whose answer its descriptor's truth proves false under any allowed
 *    registration (`InformationTruth.isFalse`: some delivered value is certainly false and none is true; the chosen players a delivery
 *    also records are neither) ("False information while drunk or poisoned"). True information under
 *    impairment is not abnormal (the page's poisoned Empath); a value a Spy or Recluse ruling could make true is not proven false.
 * Never marked here (the Storyteller's, by hand with the official token): a simulated wake (a Drunk, a Marionette or a Lunatic shown a
 * character: the jinxes), the Mathematician's own information ("does not detect their own ability failing"), anything without a
 * `truth`, failed protections, registrations, and every other case on the page. Nothing is marked while no living player has the
 * Mathematician's ability.
 * The mark goes on the information's recipient, in the same commit as the delivery (one Undo).
 */
export function abnormalInformationIntents(game: StorytellerLobbyRecord, input: {
  descriptor: AbilityDescriptor; context: AbilityEvaluationContext; outcome: AbilityOutcome; mustBeFalse: boolean;
}): EffectIntent[] {
  const { descriptor, context, outcome, mustBeFalse } = input;
  if (context.simulated || context.roleId === "mathematician" || !mathematicianListening(game)) return [];
  if (!mustBeFalse && context.functioning) return [];
  const truth = mustBeFalse ? null : descriptor.truth?.(context);
  const intents: EffectIntent[] = [];
  const marked = new Set<string>();
  for (const operation of outcome.operations) {
    if (operation.domain !== "information" || !operation.values.length || marked.has(operation.recipient.participantId)) continue;
    const reason = mustBeFalse ? ABNORMAL_VORTOX
      : truth?.known && truth.isFalse && operation.values.some((value) => truth.isFalse!(value)) && !operation.values.some((value) => truth.isTrue(value))
        ? ABNORMAL_IMPAIRED : undefined;
    if (!reason) continue;
    marked.add(operation.recipient.participantId);
    intents.push(...abnormalMarkIntents(game.players, operation.recipient, reason));
  }
  return intents;
}

/**
 * SV-5g3 (PO Q18 A): the Mathematician's Night commit removes every ABNORMAL mark ("Remove all ABNORMAL reminders"), whether or not his
 * ability works, in the same commit as his number (one Undo restores the marks and the count). A simulated wake (a Drunk shown the
 * Mathematician) has no ability and clears nothing.
 */
export function abnormalClearingIntents(game: StorytellerLobbyRecord, context: AbilityEvaluationContext, outcome: AbilityOutcome): EffectIntent[] {
  if (context.simulated || context.roleId !== "mathematician" || !outcome.operations.some((operation) => operation.domain === "information")) return [];
  return clearAbnormalIntents(game);
}

/** The outcome with `intents` as one Effect operation, placed after the outcome's own mechanics and before its information and step
 * bookkeeping (the coordinator's ordering rule); a second mechanical domain makes the list order the declared mechanical order. */
export function withEffectIntents(outcome: AbilityOutcome, intents: readonly EffectIntent[], isMechanical: (domain: AbilityOperation["domain"]) => boolean): AbilityOutcome {
  if (!intents.length) return outcome;
  const operations = [...outcome.operations];
  const firstBookkeeping = operations.findIndex((operation) => !isMechanical(operation.domain));
  const at = firstBookkeeping < 0 ? operations.length : firstBookkeeping;
  operations.splice(at, 0, { domain: "effect", intents });
  const mechanical = new Set(operations.map((operation) => operation.domain).filter(isMechanical));
  return { ...outcome, operations, ...(mechanical.size > 1 ? { mechanicalOrder: "declared" as const } : {}) };
}
