import { create } from "zustand";
import { resolveAbilitySemantics, type AbilityDescriptor, type AbilitySemanticsRegistry, type InputSource } from "@/abilities/semantics";
import type { RoleRegistry } from "@/data/roleRegistry";
import { effectDefinitionOf } from "@/stores/effectRegistry";
import type { AbilityOperation, AbilityOutcome, ParticipantBinding } from "@/stores/abilityResolution";
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
  | { kind: "guided"; descriptor: AbilityDescriptor }
  | { kind: "manual"; reason: string };

/** How a Night row's ability resolves: verified semantics (through canonical
 * ownership) or the Manual workspace -- never a dead end. */
export function stepAbility(roleId: string, registry: RoleRegistry, semantics: AbilitySemanticsRegistry): StepAbility {
  const resolved = resolveAbilitySemantics(roleId, registry, semantics);
  if (resolved.kind === "supported") return { kind: "guided", descriptor: resolved.descriptor };
  if (resolved.kind === "homebrew") return { kind: "manual", reason: `${resolved.role.name} is not a verified official character.` };
  return { kind: "manual", reason: "Silverwick has no verified rules for this ability yet." };
}

export const bindingOf = (player: Pick<STPlayerRecord, "id" | "participantId">): ParticipantBinding =>
  ({ playerId: player.id, participantId: player.participantId ?? "" });

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
    case "information":
      return [`Record what ${nameOf(game, operation.recipient)} was told`];
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
type TargetPickerState = {
  active: { label: string; onPick: (binding: ParticipantBinding) => void } | null;
  start: (label: string, onPick: (binding: ParticipantBinding) => void) => void;
  cancel: () => void;
};
export const useTargetPicker = create<TargetPickerState>((set) => ({
  active: null,
  start: (label, onPick) => set({ active: { label, onPick } }),
  cancel: () => set({ active: null }),
}));

/** GrimoireCircle's tap-to-select: a pick while a picker is active, otherwise
 * the ordinary selection. Returns true when the tap was consumed as a pick. */
export function pickSeatIfPicking(game: StorytellerLobbyRecord | null, playerId: PlayerId): boolean {
  const active = useTargetPicker.getState().active;
  if (!active || !game) return false;
  const player = Object.prototype.hasOwnProperty.call(game.players, playerId) ? game.players[playerId] : undefined;
  if (!player || player.isEmpty || !player.participantId) return false;
  useTargetPicker.setState({ active: null });
  active.onPick(bindingOf(player));
  return true;
}
