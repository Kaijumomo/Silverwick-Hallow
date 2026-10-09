import type { RoleRegistry } from "@/data/roleRegistry";
import { effectDefinitionOf } from "@/stores/effectRegistry";
import { gameRuleFactDefinition } from "@/stores/gameRuleFacts";
import { momentLabel, momentOrdinal } from "@/stores/lifeEvents";
import type {
  GameHistoryRecord,
  GameInformationDeliveryRecord,
  GameMoment,
  ParticipantRef,
  RecordedInformationValue,
  StorytellerLobbyRecord,
} from "@/stores/types";

/**
 * Phase 10G: the Storyteller Activity presentation (PHASE10G Section 13).
 *
 * PRESENTATION ONLY. It reads the bookkeeping the game already owns -- History
 * (`game.history`, "Changes") and Information Delivery
 * (`game.informationDeliveries`, "Information told") -- and never becomes a
 * mechanical source: no Rules Query, evaluator or planner imports this module
 * (architecture-guarded), and nothing here is persisted.
 *
 * Ordering honesty (Section 13.2): History and Information Delivery are
 * separate arrays with no shared sequence number, so this NEVER interleaves
 * them as if their relative order were known. It groups by Game Moment; within
 * a moment, records sharing a `resolutionId` are shown together (one ability
 * resolution -- its mechanical History, then its bookkeeping deliveries, the
 * order the coordinator records them); every other record stays in its own
 * source list, in that source's own order.
 */

export type ActivityItem =
  | { source: "history"; index: number; record: GameHistoryRecord }
  | { source: "delivery"; index: number; record: GameInformationDeliveryRecord };

export type ActivityResolution = { resolutionId: string; changes: ActivityItem[]; told: ActivityItem[] };

export type ActivityGroup = {
  /** Stable key: the moment's ordinal, or "unknown". */
  key: string;
  moment: GameMoment | null;
  label: string;
  resolutions: ActivityResolution[];
  /** Uncorrelated History, in History order. */
  changes: ActivityItem[];
  /** Uncorrelated deliveries, in delivery order. */
  told: ActivityItem[];
};

export type ActivityCategory = GameHistoryRecord["category"] | "information";
export const ACTIVITY_CATEGORIES: readonly { value: ActivityCategory; label: string }[] = [
  { value: "life", label: "Life" },
  { value: "voting", label: "Nominations and voting" },
  { value: "role", label: "Character" },
  { value: "alignment", label: "Alignment" },
  { value: "effect", label: "Effects" },
  { value: "reminder", label: "Reminders" },
  { value: "gameRuleFact", label: "Game rule facts" },
  { value: "information", label: "Information told" },
];

export type ActivityFilter = {
  /** A participant key (participantKey) -- matches History about them and
   * deliveries to them. Game-scoped records have no participant. */
  participant?: string;
  category?: ActivityCategory;
  /** A group key (a moment ordinal, or "unknown"). */
  moment?: string;
};

/** A stable key for a durable ParticipantRef (legacy refs keep their seat). */
export const participantKey = (ref: ParticipantRef): string =>
  ref.kind === "participant" ? `p:${ref.participantId}` : `legacy:${ref.playerId}`;

export const participantLabel = (ref: ParticipantRef): string =>
  ref.kind === "participant" ? (ref.nameAtTime || `Seat ${ref.playerId}`) : `Unknown participant (seat ${ref.playerId}, before identity tracking)`;

const historyParticipant = (record: GameHistoryRecord): ParticipantRef | null =>
  record.category === "gameRuleFact" ? null : record.participant ?? null;

/** Every participant any Activity record is about, for the filter. */
export function activityParticipants(game: Pick<StorytellerLobbyRecord, "history" | "informationDeliveries">): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const record of game.history) {
    const ref = historyParticipant(record);
    if (ref && !seen.has(participantKey(ref))) seen.set(participantKey(ref), participantLabel(ref));
  }
  for (const delivery of game.informationDeliveries) {
    if (!seen.has(participantKey(delivery.recipient))) seen.set(participantKey(delivery.recipient), participantLabel(delivery.recipient));
  }
  return [...seen].map(([key, label]) => ({ key, label }));
}

const groupKeyOf = (moment: GameMoment | undefined): string => (moment ? String(momentOrdinal(moment)) : "unknown");

/**
 * The resolution a record belongs to, from its OWN stored evidence only: a
 * record's `resolutionId`, or -- for a "life" History Record, which carries its
 * correlation on the Life Events it mirrors (Phase 10A) -- the single
 * resolutionId those events share. Absent or ambiguous evidence: uncorrelated.
 */
export function correlationOf(item: ActivityItem): string | undefined {
  if (item.record.resolutionId) return item.record.resolutionId;
  if (item.source !== "history" || item.record.category !== "life") return undefined;
  const ids = new Set((item.record.lifeEvent?.operations ?? []).map((op) => op.event.resolutionId));
  const [only] = [...ids];
  return ids.size === 1 && typeof only === "string" ? only : undefined;
}

function matches(item: ActivityItem, filter: ActivityFilter): boolean {
  if (filter.category) {
    const category: ActivityCategory = item.source === "delivery" ? "information" : item.record.category;
    if (category !== filter.category) return false;
  }
  if (filter.participant) {
    const ref = item.source === "delivery" ? item.record.recipient : historyParticipant(item.record);
    if (!ref || participantKey(ref) !== filter.participant) return false;
  }
  if (filter.moment && groupKeyOf(item.record.moment) !== filter.moment) return false;
  return true;
}

/** The Activity groups, newest moment first; the unknown-moment group last. */
export function buildActivity(game: Pick<StorytellerLobbyRecord, "history" | "informationDeliveries">, filter: ActivityFilter = {}): ActivityGroup[] {
  const items: ActivityItem[] = [
    ...game.history.map((record, index): ActivityItem => ({ source: "history", index, record })),
    ...game.informationDeliveries.map((record, index): ActivityItem => ({ source: "delivery", index, record })),
  ].filter((item) => matches(item, filter));
  const groups = new Map<string, ActivityGroup>();
  for (const item of items) {
    const moment = item.record.moment ?? null;
    const key = groupKeyOf(item.record.moment);
    let group = groups.get(key);
    if (!group) {
      group = { key, moment, label: moment ? momentLabel(moment) : "Moment not recorded", resolutions: [], changes: [], told: [] };
      groups.set(key, group);
    }
    const resolutionId = correlationOf(item);
    if (resolutionId) {
      let resolution = group.resolutions.find((r) => r.resolutionId === resolutionId);
      if (!resolution) {
        resolution = { resolutionId, changes: [], told: [] };
        group.resolutions.push(resolution);
      }
      (item.source === "history" ? resolution.changes : resolution.told).push(item);
    } else {
      (item.source === "history" ? group.changes : group.told).push(item);
    }
  }
  return [...groups.values()].sort((a, b) =>
    a.key === "unknown" ? 1 : b.key === "unknown" ? -1 : Number(b.key) - Number(a.key));
}

/** The moment groups present (for the filter), newest first. */
export const activityMoments = (game: Pick<StorytellerLobbyRecord, "history" | "informationDeliveries">) =>
  buildActivity(game).map((group) => ({ key: group.key, label: group.label }));

// ---------------------------------------------------------------------------
// Plain-language descriptions (presentation only; never re-derived truth)
// ---------------------------------------------------------------------------

const roleNameOf = (registry: RoleRegistry, id: unknown): string =>
  typeof id === "string" && id ? registry.get(id)?.name ?? id : "no character";

const str = (value: unknown): string => (typeof value === "string" ? value : value === undefined ? "?" : JSON.stringify(value));

/** One line describing what a History Record says changed. */
export function describeHistoryRecord(record: GameHistoryRecord, registry: RoleRegistry): string {
  if (record.category === "voting") return record.summary;
  const correction = record.correction ? " (correction)" : "";
  if (record.category === "gameRuleFact") {
    const label = gameRuleFactDefinition(record.ruleFactType)?.label ?? `Unregistered fact "${record.ruleFactType}"`;
    const verb = record.ruleFactOperation === "apply" ? "recorded" : record.ruleFactOperation === "expire" ? "expired" : "removed";
    return `Game rule fact ${verb}: ${label}${correction}`;
  }
  const who = participantLabel(record.participant);
  const change = record.change;
  switch (record.category) {
    case "role": {
      if (change?.kind === "value") return `${who}: character ${roleNameOf(registry, change.from.actualRole)} → ${roleNameOf(registry, change.to.actualRole)}${correction}`;
      break;
    }
    case "alignment": {
      if (change?.kind === "value") return `${who}: alignment ${str(change.from.actualAlignment ?? "unresolved")} → ${str(change.to.actualAlignment)}${correction}`;
      break;
    }
    case "life": {
      const events = record.lifeEvent?.operations.map((op) => `${op.kind === "added" ? "" : "retracted: "}${LIFE_EVENT_TEXT[op.event.kind] ?? op.event.kind}${"outcome" in op.event ? ` (${op.event.outcome})` : ""}`) ?? [];
      // The Current State fields an event already explains are not repeated.
      const fields = !events.length && change?.kind === "value" ? Object.keys(change.to).map((key) => lifeFieldText(key, change.to[key])) : [];
      return `${who}: ${[...events, ...fields].join(", ") || "life change"}${correction}`;
    }
    case "effect": {
      const item = change?.kind === "value" ? change.to : change?.item;
      const type = item && typeof item.type === "string" ? effectDefinitionOf(item.type).label : "Effect";
      return `${who}: ${type} ${record.effectOperation ?? (change?.kind === "added" ? "added" : change?.kind === "removed" ? "removed" : "changed")}${correction}`;
    }
    case "reminder": {
      const item = change?.kind === "value" ? change.to : change?.item;
      const label = item && typeof item.label === "string" ? `"${item.label}"` : "Reminder";
      return `${who}: Reminder ${label} ${record.reminderOperation ?? (change?.kind === "added" ? "placed" : change?.kind === "removed" ? "removed" : "changed")}${correction}`;
    }
  }
  return `${who}: ${record.category} change${correction}`;
}

const LIFE_EVENT_TEXT: Record<string, string> = { death: "died", execution: "executed", exile: "exiled", resurrection: "resurrected" };
const lifeFieldText = (key: string, value: unknown): string => {
  switch (key) {
    case "alive": return value === true ? "marked alive" : "marked dead";
    case "ghostVote": return value === true ? "vote token restored" : "vote token spent";
    case "abilityUsed": return value === true ? "ability marked used" : "ability marked unused";
    case "exiled": return value === true ? "marked exiled" : "exile cleared";
    default: return `${key} → ${str(value)}`;
  }
};

const valueText = (value: RecordedInformationValue, registry: RoleRegistry): string => {
  switch (value.kind) {
    case "number": return String(value.value);
    case "boolean": return value.value ? "Yes" : "No";
    case "text": return `"${value.value}"`;
    case "role": return roleNameOf(registry, value.roleId);
    case "alignment": return value.alignment;
    case "player": return value.participants.map(participantLabel).join(" & ") || "nobody";
  }
};

/** One line describing what an Information Delivery records as told. */
export function describeDelivery(delivery: GameInformationDeliveryRecord, registry: RoleRegistry): string {
  const who = participantLabel(delivery.recipient);
  const as = delivery.performedRole ? ` as the ${roleNameOf(registry, delivery.performedRole)} (actually the ${roleNameOf(registry, delivery.actualRole)})` : ` (${roleNameOf(registry, delivery.actualRole)})`;
  if (delivery.kind === "manual") return `${who}${as} was told (manual): "${delivery.text}"`;
  const told = delivery.values.map((value) => valueText(value, registry)).join(" · ");
  return `${who}${as} was told${told ? `: ${told}` : ""}`;
}
