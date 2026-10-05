import { KNOWN_EFFECT_TYPES } from "@/stores/effectRegistry";
import { reminderCleanupStatus, type ReminderCleanupStatus } from "@/stores/reminderResolution";
import type { ReminderRecord, STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";

/**
 * Phase 10C: Reminder PRESENTATION -- how Storyteller notation is drawn and
 * described. Nothing here is mechanics and nothing mechanical may import it:
 * Reminders are notation, never rules input. Everything is derived at render
 * time; nothing derived (aggregation, cleanup status) is ever stored.
 */

/**
 * Safe, generic, mechanically inert notation presets for the Drawer's quick
 * path. Deliberately EXCLUDES labels that would shadow an authoritative domain
 * -- Used (abilityUsed), Drunk / Poisoned / Protected / Mad (Effects) -- whose
 * truth lives elsewhere. Canonical per-character tokens are deferred to 10F.
 */
export const REMINDER_PRESETS = ["Knows", "Did not act", "Dies tonight"] as const;

const EFFECT_LABELS = new Map(KNOWN_EFFECT_TYPES.map((definition) => [definition.label.trim().toLowerCase(), definition.label]));

/**
 * A NON-BLOCKING hint when typed notation exactly names an authoritative
 * Effect ("Poisoned is tracked as an Effect."). It never prevents placement,
 * never converts or reinterprets the Reminder, and nothing inspects the label
 * later -- a Reminder labelled "Poisoned" stays inert notation.
 */
export function authoritativeLabelHint(label: string): string | null {
  const known = EFFECT_LABELS.get(label.trim().toLowerCase());
  return known ? `${known} is tracked as an Effect -- use Effects for the real condition. This Reminder is notation only.` : null;
}

/** Most-urgent-first ranking of cleanup statuses. */
const STATUS_RANK: Record<ReminderCleanupStatus, number> = { due: 3, check: 2, scheduled: 1, none: 0 };

/** Presentation aggregation of Reminders sharing an identical visible label
 * ("Chosen ×2"). The underlying instances are never merged. */
export type ReminderTokenGroup = {
  label: string;
  instances: ReminderRecord[];
  /** The most urgent cleanup status among the instances (derived). */
  status: ReminderCleanupStatus;
  dueCount: number;
  checkCount: number;
};

/** Groups a participant's Reminders by exact label, groups needing attention
 * (due cleanup, legacy check) first, otherwise in placement order. */
export function reminderTokenGroups(
  player: Pick<STPlayerRecord, "reminders">,
  game: Pick<StorytellerLobbyRecord, "phase" | "day">,
): ReminderTokenGroup[] {
  const groups = new Map<string, ReminderTokenGroup>();
  for (const reminder of player.reminders) {
    const status = reminderCleanupStatus(reminder, game);
    const group = groups.get(reminder.label) ?? { label: reminder.label, instances: [], status: "none" as ReminderCleanupStatus, dueCount: 0, checkCount: 0 };
    group.instances.push(reminder);
    if (STATUS_RANK[status] > STATUS_RANK[group.status]) group.status = status;
    if (status === "due") group.dueCount++;
    if (status === "check") group.checkCount++;
    groups.set(reminder.label, group);
  }
  const attention = (group: ReminderTokenGroup) => group.status === "due" || group.status === "check";
  const ordered = [...groups.values()];
  return [...ordered.filter(attention), ...ordered.filter((group) => !attention(group))];
}

export const groupText = (group: Pick<ReminderTokenGroup, "label" | "instances">): string =>
  `${group.label}${group.instances.length > 1 ? ` ×${group.instances.length}` : ""}`;

/** Phase 10H (contract §6.3, H2): the Reminder labels a density tier draws on
 * the Table -- the first `labels` groups (attention first) and an explicit
 * "+N more" for every remaining INSTANCE; 0 labels means count-only. The
 * Labels view and the Inspector always keep the full detail. */
export function tierReminderGroups(groups: ReminderTokenGroup[], labels: number): { shown: ReminderTokenGroup[]; hiddenCount: number } {
  const shown = groups.slice(0, Math.max(0, labels));
  const hiddenCount = groups.slice(shown.length).reduce((sum, group) => sum + group.instances.length, 0);
  return { shown, hiddenCount };
}

/** Words for a derived cleanup status (never color alone). */
export function cleanupStatusText(status: ReminderCleanupStatus): string | null {
  switch (status) {
    case "due": return "needs cleanup";
    case "check": return "needs check";
    default: return null;
  }
}

/**
 * The Storyteller-only accessible Reminder summary appended to a Grimoire
 * token's name, e.g. "3 reminders: Chosen ×2, Master; 1 needs cleanup".
 * Empty when there are none. Callers must not call it under Privacy Mode.
 */
export function reminderAccessibleSummary(
  player: Pick<STPlayerRecord, "reminders">,
  game: Pick<StorytellerLobbyRecord, "phase" | "day">,
): string {
  const count = player.reminders.length;
  if (count === 0) return "";
  const groups = reminderTokenGroups(player, game);
  const due = groups.reduce((sum, group) => sum + group.dueCount, 0);
  const check = groups.reduce((sum, group) => sum + group.checkCount, 0);
  const attention = [
    due ? `${due} needs cleanup` : "",
    check ? `${check} needs check` : "",
  ].filter(Boolean).join(", ");
  return `${count} reminder${count === 1 ? "" : "s"}: ${groups.map(groupText).join(", ")}${attention ? `; ${attention}` : ""}`;
}
