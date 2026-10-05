import { create } from "zustand";
import { invocationEligibility, nightTriggerStatus, type GameMoment, type InvocationPath, type NightTriggerStatus } from "@/abilities/invocation";
import { resolveAbilitySemantics, type AbilityDescriptor, type AbilitySemanticsRegistry, type InputSource } from "@/abilities/semantics";
import type { RoleRegistry } from "@/data/roleRegistry";
import { effectDefinitionOf } from "@/stores/effectRegistry";
import { gameRuleFactDefinition } from "@/stores/gameRuleFacts";
import type { AbilityOperation, AbilityOutcome, ParticipantBinding } from "@/stores/abilityResolution";
import { boundParticipant, type RulesQuery } from "@/stores/rulesQuery";
import type { PlayerId, STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";

/**
 * Phase 10F: Storyteller-facing helpers for the guided workflow. Presentation
 * only -- every rule lives in the coordinator / semantics; nothing here
 * decides mechanics.
 */

/** Where a value came from (PHASE10F Section 15 / 10F-AC-11): the UI always
 * distinguishes these. */
export type ValueOrigin = "computed" | InputSource | "manual";
export const ORIGIN_LABEL: Record<ValueOrigin, string> = {
  computed: "Silverwick-computed",
  player: "Player choice",
  storyteller: "Storyteller choice",
  judgment: "Storyteller judgment",
  manual: "Manual / unmodeled",
};

export type StepAbility =
  /** `invocationPath` (Slice 7): the path the guided resolution uses when it
   * is not the row's ordinary one -- the explicit verified Night trigger. */
  | { kind: "guided"; descriptor: AbilityDescriptor; invocationPath?: InvocationPath; trigger?: NightTriggerStatus }
  | { kind: "manual"; reason: string };

/** How a Night row's ability resolves: verified semantics (through canonical
 * ownership) or the Manual workspace -- never a dead end. */
export function stepAbility(roleId: string, registry: RoleRegistry, semantics: AbilitySemanticsRegistry): StepAbility {
  const resolved = resolveAbilitySemantics(roleId, registry, semantics);
  if (resolved.kind === "supported") return { kind: "guided", descriptor: resolved.descriptor };
  if (resolved.kind === "homebrew") return { kind: "manual", reason: `${resolved.role.name} is not a verified official character.` };
  if (resolved.kind === "verifiedManual") return { kind: "manual", reason: resolved.note };
  return { kind: "manual", reason: "Silverwick has no verified rules for this ability yet." };
}

/**
 * SOL-10F-L3-R1: how a participant's ability resolves through ONE generic entry
 * point at the current Game Moment -- guided only when canonical ownership,
 * verified semantics AND the shared invocation-eligibility contract (the same
 * one the coordinator enforces) all allow it; otherwise the Manual path with
 * the reason.
 */
export function pathAbility(roleId: string, registry: RoleRegistry, semantics: AbilitySemanticsRegistry, path: InvocationPath, moment: GameMoment): StepAbility {
  const ability = stepAbility(roleId, registry, semantics);
  if (ability.kind !== "guided") return ability;
  const eligibility = invocationEligibility(ability.descriptor, path, moment);
  return eligibility.eligible ? ability : { kind: "manual", reason: eligibility.reason };
}

/**
 * Slice 7: the explicit verified Night-trigger path for one participant -- only
 * for a descriptor that DECLARES a verified trigger (the same shared contract
 * the coordinator enforces), with the trigger's status from authoritative
 * state. Null when the ability has no such path.
 */
export function triggerAbility(roleId: string, registry: RoleRegistry, semantics: AbilitySemanticsRegistry, query: RulesQuery, actor: ParticipantBinding): StepAbility | null {
  const ability = pathAbility(roleId, registry, semantics, "nightTrigger", query.game);
  if (ability.kind !== "guided") return null;
  return { ...ability, invocationPath: "nightTrigger", trigger: nightTriggerStatus(ability.descriptor, actor, query) };
}

export const bindingOf = (player: Pick<STPlayerRecord, "id" | "participantId">): ParticipantBinding =>
  ({ playerId: player.id, participantId: player.participantId ?? "" });

/**
 * SOL-10F-A2 / B1: the ONE way a UI selection becomes a participant answer --
 * the binding of the participation instance occupying `playerId` AT THIS
 * MOMENT (own-property safe), or null for an empty / unknown seat. Every
 * select control and the Grimoire picker capture through it, so a slot holds
 * `{playerId, participantId}` from the instant it is chosen, never a bare
 * PlayerId re-bound later.
 */
export function captureBinding(game: StorytellerLobbyRecord, playerId: PlayerId): ParticipantBinding | null {
  const player = Object.prototype.hasOwnProperty.call(game.players, playerId) ? game.players[playerId] : undefined;
  return player && !player.isEmpty && player.participantId ? bindingOf(player) : null;
}

/** Whether a captured binding still names the seat's CURRENT occupant. */
export const isCurrentBinding = (game: StorytellerLobbyRecord, binding: ParticipantBinding): boolean => !!boundParticipant(game, binding);

/** Current occupied participants, in seat order. */
export function seatedParticipants(game: StorytellerLobbyRecord): STPlayerRecord[] {
  return game.seatOrder.map((id) => game.players[id]).filter((p): p is STPlayerRecord => !!p && !p.isEmpty && !!p.participantId);
}

const nameOf = (game: StorytellerLobbyRecord, binding: { playerId: PlayerId } | undefined): string => {
  const player = binding ? game.players[binding.playerId] : undefined;
  return player?.name || (player ? `Seat ${player.seat + 1}` : "a player");
};

/** One plain-language line per operation -- the concise consequence preview. */
export function describeOperation(game: StorytellerLobbyRecord, operation: AbilityOperation, registry: RoleRegistry): string[] {
  const roleName = (id: string) => registry.get(id)?.name ?? id;
  switch (operation.domain) {
    case "life":
      return operation.intents.map((intent) => {
        const who = nameOf(game, intent.target);
        switch (intent.kind) {
          case "death": return `${who} dies`;
          case "resurrection": return `${who} is resurrected`;
          case "useAbility": return `${who}'s ability is used`;
          case "correctAbilityUsed": return `${who}'s ability is corrected to ${intent.used ? "used" : "unused"}`;
          case "spendGhostVote": return `${who}'s vote token is spent`;
          case "restoreGhostVote": return `${who}'s vote token is restored`;
          case "execution": return `${who} is executed (${intent.outcome})`;
          case "exile": return `${who} is exiled (${intent.outcome})`;
          case "correctStatus": return `${who}'s life status is corrected`;
        }
        return `${who}: life change`;
      });
    case "effect":
      return operation.intents.map((intent) => {
        const who = nameOf(game, intent.target);
        if (intent.kind === "apply" || intent.kind === "correctApply") return `${who} gains ${effectDefinitionOf(intent.effect.type).label}`;
        if (intent.kind === "remove" || intent.kind === "correctRemove") return `${who} loses an Effect`;
        return `${who}: Effect ${intent.kind}`;
      });
    case "reminder":
      return operation.intents.map((intent) => {
        const who = nameOf(game, intent.target);
        return intent.kind === "place" || intent.kind === "correctPlace" ? `Reminder "${intent.reminder.label}" on ${who} (notation only)` : `${who}: Reminder ${intent.kind}`;
      });
    case "role":
      return operation.intents.map((intent) => intent.kind === "setPerception"
        ? `${nameOf(game, intent.target)} is shown ${intent.shownRole ? roleName(intent.shownRole) : "nothing"}`
        : `${nameOf(game, intent.target)} becomes the ${roleName(intent.actualRole)}`);
    case "alignment":
      return operation.intents.map((intent) => `${nameOf(game, intent.target)} becomes ${intent.actualAlignment}`);
    case "gameRuleFact":
      return operation.intents.map((intent) => {
        const label = gameRuleFactDefinition(intent.type)?.label ?? intent.type;
        return intent.kind === "apply" ? `Game rule fact: ${label} (game-level)` : `Game rule fact removed: ${label}`;
      });
    case "information": {
      // Presentation only: what is recorded as told (never re-derived).
      const told = (Array.isArray(operation.values) ? operation.values : []).map((value) => {
        switch (value.kind) {
          case "number": return String(value.value);
          case "boolean": return value.value ? "Yes" : "No";
          case "text": return `"${value.value}"`;
          case "role": return roleName(value.roleId);
          case "alignment": return value.alignment;
          case "player": return value.participants.map((binding: ParticipantBinding) => nameOf(game, binding)).join(" & ");
        }
        return "";
      }).filter(Boolean);
      return [`Record what ${nameOf(game, operation.recipient)} was told${told.length ? `: ${told.join(" · ")}` : ""}`];
    }
    case "manualInformation":
      return [`Record what ${nameOf(game, operation.recipient)} was told (manual): "${operation.text}"${operation.performedRole ? ` -- as the ${roleName(operation.performedRole)}` : ""}`];
    case "nightStep":
      return [`Mark the step ${operation.status}`];
  }
}

export function describeOutcome(game: StorytellerLobbyRecord, outcome: AbilityOutcome, registry: RoleRegistry): string[] {
  return outcome.operations.flatMap((operation) => describeOperation(game, operation, registry));
}

/**
 * The Grimoire as a target picker (PHASE10F Section 15.3). Ephemeral UI memory
 * only. While active, a seat TAP selects that seat's CURRENT participation
 * instance (ParticipantId captured at the tap); drag / reposition are untouched
 * (GrimoireCircle routes only its tap-to-select path here). The accessible
 * list picker remains the primary fallback.
 */
/*
 * Phase 10H (10H-AC-017): `eligible` is the SAME eligibility result the slot's
 * Roster pick-strip renders (ParticipantPicker computes it once). The Table
 * marks exactly those seats pickable and refuses a tap on any other seat --
 * it is not consumed as a pick and does not fall through to inspection. An
 * absent `eligible` means every occupied seat (legacy callers). `owner`
 * identifies the slot that started the pick.
 */
export type TargetPick = {
  label: string;
  onPick: (binding: ParticipantBinding) => void;
  owner?: string;
  eligible?: ReadonlySet<string>;
};
type TargetPickerState = {
  active: TargetPick | null;
  /** Last refused Table tap (an ineligible seat), for an adjacent reason. */
  refused: string | null;
  start: (label: string, onPick: (binding: ParticipantBinding) => void, options?: { owner?: string; eligible?: ReadonlySet<string> }) => void;
  cancel: () => void;
};
export const useTargetPicker = create<TargetPickerState>((set) => ({
  active: null,
  refused: null,
  start: (label, onPick, options = {}) => set({ active: { label, onPick, ...options }, refused: null }),
  cancel: () => set({ active: null, refused: null }),
}));

/** Whether the current pick admits this seat's CURRENT occupant. */
export function seatPickable(game: StorytellerLobbyRecord | null, playerId: PlayerId, pick: TargetPick | null = useTargetPicker.getState().active): boolean {
  if (!pick || !game) return false;
  const binding = captureBinding(game, playerId);
  return !!binding && (!pick.eligible || pick.eligible.has(binding.participantId));
}

/** GrimoireCircle's tap-to-select: a pick while a picker is active, otherwise
 * the ordinary selection. Returns true when the tap was consumed (as a pick,
 * or refused as ineligible while picking). */
export function pickSeatIfPicking(game: StorytellerLobbyRecord | null, playerId: PlayerId): boolean {
  const active = useTargetPicker.getState().active;
  if (!active || !game) return false;
  const binding = captureBinding(game, playerId);
  if (!binding || (active.eligible && !active.eligible.has(binding.participantId))) {
    const player = game.players[playerId];
    useTargetPicker.setState({ refused: `${player?.name || "That seat"} can't be chosen for ${active.label}.` });
    return true;
  }
  useTargetPicker.setState({ active: null, refused: null });
  active.onPick(binding);
  return true;
}
