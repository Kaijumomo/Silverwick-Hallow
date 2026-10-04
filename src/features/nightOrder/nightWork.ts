import type { RoleRegistry } from "@/data/roleRegistry";
import type { AbilitySemanticsRegistry } from "@/abilities/semantics";
import { createRulesQuery, type RulesQuery } from "@/stores/rulesQuery";
import { participantStepKey } from "@/stores/nightProgress";
import { wakeIdentity } from "@/stores/wakeIdentity";
import { bindingOf, seatedParticipants, triggerAbility, type StepAbility } from "@/features/abilities/abilityUi";
import { computeNightOrder, type NightStep } from "./nightOrder";
import type { Script, STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";

/**
 * Phase 10G (PHASE10G Section 14.1): the ONE derivation of the current Night's
 * work, shared by the Night Order dashboard and Dawn Review so the two can
 * never disagree. Pure: Current State (players, Night progress, Life Event
 * Window, Fabled / Lorics, game Rule Facts) in, derived rows out; nothing is
 * stored.
 *
 * It covers:
 *  - the current Night Order rows (computeNightOrder);
 *  - custom Night steps (`{day}:manual:*` progress keys);
 *  - verified triggered abilities open tonight (the explicit verified
 *    Night-trigger path), each flagged when the trigger itself needs a check.
 *
 * Phase 10G Section 16: the ordinary Rules Query is built with the SAME active
 * modifier derivation the Rules Query architecture defaults to (activeModifiers
 * over Current State) -- never a blanket empty modifier set. The coordinator
 * remains the final rules authority.
 */

export type NightWorkEnvironment = {
  script: Script | null;
  registry: RoleRegistry;
  semantics: AbilitySemanticsRegistry;
};

export type TriggeredNightWork = {
  player: STPlayerRecord;
  roleId: string;
  roleName: string;
  stepKey: string;
  ability: Extract<StepAbility, { kind: "guided" }>;
  eventId: string | null;
  /** The trigger itself is unknown from authoritative state (coverage) and
   * needs the Storyteller's check. */
  needsCheck: boolean;
};

export type NightWork = {
  /** Night Order rows, then custom steps, in display order. */
  steps: NightStep[];
  triggered: TriggeredNightWork[];
  query: RulesQuery;
};

export const CUSTOM_STEP_PREFIX = "manual:";

/** Custom Night steps of `day`, from Night progress. */
export function customNightSteps(game: Pick<StorytellerLobbyRecord, "nightProgress">, day: number): NightStep[] {
  const prefix = `${day}:${CUSTOM_STEP_PREFIX}`;
  return Object.keys(game.nightProgress ?? {}).filter((key) => key.startsWith(prefix)).map((key) => ({
    kind: "global", stepKey: key.slice(String(day).length + 1),
    label: "Custom night step", prompt: "Storyteller-defined procedure. Use the notes below; complete or skip manually.",
    reminder: "", order: Number.MAX_SAFE_INTEGER,
  }));
}

export function deriveNightWork(game: StorytellerLobbyRecord, environment: NightWorkEnvironment): NightWork {
  const { script, registry, semantics } = environment;
  const steps = script ? computeNightOrder(game.players, game.seatOrder, script, game.day === 1, game) : [];
  steps.push(...customNightSteps(game, game.day));
  const query = createRulesQuery(game, { registry, script, semantics });
  const triggered = seatedParticipants(game).flatMap((player): TriggeredNightWork[] => {
    const wake = wakeIdentity(player, registry);
    if (!wake || !player.participantId) return [];
    const ability = triggerAbility(wake.shownRoleId, registry, semantics, query, bindingOf(player));
    // SOL-10F-A10: open = the trigger status (consumption is per trigger event).
    if (!ability || ability.kind !== "guided" || !ability.trigger || ability.trigger.kind === "notTriggered") return [];
    return [{ player, roleId: wake.shownRoleId, roleName: wake.role.name, stepKey: participantStepKey(player.participantId, wake.shownRoleId),
      ability, eventId: ability.trigger.eventId, needsCheck: ability.trigger.kind === "unknown" }];
  });
  return { steps, triggered, query };
}

export const stepResolved = (game: Pick<StorytellerLobbyRecord, "nightProgress" | "day">, step: NightStep): boolean => {
  const status = game.nightProgress?.[`${game.day}:${step.stepKey}`]?.status;
  return status === "done" || status === "skipped";
};

export type UnfinishedNightWork = {
  /** Night Order rows neither done nor skipped. */
  rows: NightStep[];
  /** Custom steps neither done nor skipped. */
  customSteps: NightStep[];
  /** Verified triggers open tonight (triggered). */
  triggers: TriggeredNightWork[];
  /** Verified triggers whose trigger state needs a Storyteller check. */
  triggerChecks: TriggeredNightWork[];
  total: number;
};

/** What Dawn Review reports: every unfinished item of the derived Night work. */
export function unfinishedNightWork(game: StorytellerLobbyRecord, work: NightWork): UnfinishedNightWork {
  const open = work.steps.filter((step) => !stepResolved(game, step));
  const isCustom = (step: NightStep) => step.stepKey.startsWith(CUSTOM_STEP_PREFIX);
  const rows = open.filter((step) => !isCustom(step));
  const customSteps = open.filter(isCustom);
  const triggers = work.triggered.filter((item) => !item.needsCheck);
  const triggerChecks = work.triggered.filter((item) => item.needsCheck);
  return { rows, customSteps, triggers, triggerChecks, total: rows.length + customSteps.length + triggers.length + triggerChecks.length };
}

/** A short Storyteller-facing name for a Night row. */
export const nightStepName = (step: NightStep): string =>
  step.kind === "global" ? step.label : `${step.effectiveRoleName} — ${step.playerName || `seat ${step.seat + 1}`}`;
