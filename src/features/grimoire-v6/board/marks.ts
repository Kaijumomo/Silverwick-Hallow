import { iconUrlFor } from "@/data/iconUrl";
import type { RoleRegistry } from "@/data/roleRegistry";
import { captureVotingContext, useStorytellerStore } from "@/stores/storytellerStore";
import type { RulesQuery } from "@/stores/rulesQuery";
import { currentVotingState } from "@/stores/voting";
import { ownsAbilityUseReminder } from "@/stores/abilityUseReminders";
import { butlerReminderOrigin } from "@/stores/butlerSelection";
import type { EffectIndicatorSummary } from "@/stores/effectRegistry";
import {
  firstInformationReminderGroups, officialEffectPresentation, officialNotationRole, redHerringNotationCovered,
  type OfficialEffectToken,
} from "@/features/reminders/officialReminderPresentation";
import type { PlayerId, ReminderRecord, RoleDef, Script, STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";

/**
 * Everything drawn as a small disc around a seat or listed in the Details card: Effects and
 * Reminders share one visual treatment (the design's reminder disc) but stay different things --
 * `kind` records which store owns the underlying fact and `remove` which command takes it away.
 * Reminders are notation only; an Effect is the authoritative condition.
 */
export type MarkRemoval =
  | { type: "effect"; token: OfficialEffectToken }
  | { type: "indicator"; summary: EffectIndicatorSummary }
  | { type: "notation"; group: ReminderRecord[]; modifierId?: string };

export type Mark = {
  key: string;
  kind: "effect" | "notation";
  label: string;
  title: string;
  /** Artwork on the disc ("" = plain parchment with the label on its rim). */
  src: string;
  /** Artwork scale inside the disc, in percent. */
  size: number;
  removal: MarkRemoval;
};

export type MarkEnv = { game: StorytellerLobbyRecord; script: Script | undefined; registry: RoleRegistry; query: RulesQuery | null };

/** Only official reminder token art and character icons are drawn; a condition without official art is a plain disc with its label as text. */
const ROLE_SIZE = 100;

const times = (label: string, n: number) => (n > 1 ? `${label} ×${n}` : label);

export function playerMarks(env: MarkEnv, player: STPlayerRecord): Mark[] {
  const { game, script, registry, query } = env;
  if (player.isEmpty || !player.participantId || !script || !query) return [];
  const effects = officialEffectPresentation(player, { query, target: { playerId: player.id, participantId: player.participantId } });
  const marks: Mark[] = [];
  for (const token of effects.tokens) {
    const label = times(token.label, token.instances.length);
    marks.push({ key: `effect:${token.key}`, kind: "effect", label, title: `${token.role.name}: ${label}`, src: iconUrlFor(token.role), size: ROLE_SIZE, removal: { type: "effect", token } });
  }
  for (const summary of effects.fallback) {
    const label = times(summary.indicator.label, summary.activeCount);
    marks.push({ key: `indicator:${summary.indicator.key}`, kind: "effect", label, title: `${label}${summary.suppressedCount ? " (suppressed)" : ""}`, src: "", size: ROLE_SIZE, removal: { type: "indicator", summary } });
  }
  const voting = currentVotingState(game);
  const linked = (id: string) => voting.modifiers.find((m) => m.target.playerId === player.id && m.target.participantId === player.participantId && `voting-${m.id}` === id);
  const notation = player.reminders.filter((reminder) => !redHerringNotationCovered(reminder, effects.tokens));
  for (const group of firstInformationReminderGroups(notation)) {
    const reminder = group[0]!;
    const role: RoleDef | undefined = reminder.sourceCharacter ? officialNotationRole(reminder.sourceCharacter, reminder.label) ?? registry.get(reminder.sourceCharacter) : undefined;
    const modifier = linked(reminder.id);
    const label = times(reminder.label, group.length);
    marks.push({
      key: `notation:${reminder.id}`, kind: modifier ? "effect" : "notation", label,
      title: role ? `${role.name}: ${label}` : label, src: role ? iconUrlFor(role) : "", size: ROLE_SIZE,
      removal: { type: "notation", group, modifierId: modifier?.id },
    });
  }
  return marks;
}

export type MarkResult = { ok: true } | { ok: false; message: string };

/** The same stale-seat guard the old popover used: the command is bound to the occupant that was drawn. */
function bound(playerId: PlayerId, participantId: string | undefined) {
  const current = useStorytellerStore.getState();
  const player = current.game?.players[playerId];
  if (!current.game || !player || player.isEmpty || !participantId || player.participantId !== participantId) return null;
  return { current, game: current.game, player, target: { playerId, participantId } };
}

/** Takes one drawn mark away through the command that owns it. */
export function removeMark(playerId: PlayerId, participantId: string | undefined, mark: Mark): MarkResult {
  const ctx = bound(playerId, participantId);
  if (!ctx) return { ok: false, message: "The player changed. Reopen their details before continuing." };
  const { current, game, player, target } = ctx;
  const context = captureVotingContext();
  const removal = mark.removal;
  if (removal.type === "effect" || removal.type === "indicator") {
    const instances = removal.type === "effect" ? removal.token.instances : removal.summary.instances;
    // Grouping is presentation only: never choose a source implicitly or cancel independent effects together.
    if (instances.length !== 1) return { ok: false, message: "More than one effect is represented. Remove the intended effect from its source." };
    const result = current.resolveEffects({ intents: [{ kind: "remove", target, effectId: instances[0]!.id }] }, context);
    return result.ok ? { ok: true } : { ok: false, message: result.message };
  }
  const { group, modifierId } = removal;
  const linkedIds = new Set(game.preparedInformation.flatMap((preparation) => preparation.clue.kind === "pair"
    ? preparation.clue.reminders.filter((link) => link.participant.participantId === target.participantId).map((link) => link.id) : []));
  const owned = group.filter((reminder) => linkedIds.has(reminder.id) || ownsAbilityUseReminder(player, reminder) || !!butlerReminderOrigin(reminder));
  const intended = group.length === 1 ? group[0] : owned.length === 1 ? owned[0] : undefined;
  if (!intended) return { ok: false, message: "More than one reminder is represented. Remove the intended reminder from its source." };
  if (modifierId) {
    const voting = currentVotingState(game);
    const result = current.resolveVoting({ kind: "removeModifier", modifierId, code: game.code, day: game.day, expectedRevision: voting.revision }, context);
    return result.ok ? { ok: true } : { ok: false, message: result.message };
  }
  const result = current.resolveReminders({ intents: [{ kind: "remove", target, reminderId: intended.id }] }, context);
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export type PaletteEntry = { role: RoleDef; label: string };

/** The official reminder tokens a Storyteller can place: this script plus the Travellers actually seated. */
export function reminderPalette(env: MarkEnv): { inPlay: PaletteEntry[]; all: PaletteEntry[] } {
  const { game, script, registry } = env;
  if (!script) return { inPlay: [], all: [] };
  const present = new Set(Object.values(game.players).filter((p) => !p.isEmpty).map((p) => p.actualRole));
  const ids = new Set([
    ...script.characters.map((r) => r.id), ...(script.fabled ?? []).map((r) => r.id),
    ...Object.values(game.players).filter((p) => !p.isEmpty && p.isTraveler).map((p) => p.actualRole),
  ]);
  const all = [...ids].flatMap((id) => {
    const role = registry.get(id);
    return role ? [...new Set([...(role.reminders ?? []), ...(role.remindersGlobal ?? [])])].map((label) => ({ role, label })) : [];
  });
  return { all, inPlay: all.filter((entry) => present.has(entry.role.id) || game.fabled.includes(entry.role.id)) };
}

/** Places one reminder (notation only) with the source character that owns its artwork. */
export function placeReminder(playerId: PlayerId, participantId: string | undefined, entry: PaletteEntry): MarkResult {
  const ctx = bound(playerId, participantId);
  if (!ctx) return { ok: false, message: "The player changed. Reopen their details before continuing." };
  const result = ctx.current.resolveReminders({ intents: [{ kind: "place", target: ctx.target, reminder: { label: entry.label, sourceCharacter: entry.role.id } }] }, captureVotingContext());
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}
