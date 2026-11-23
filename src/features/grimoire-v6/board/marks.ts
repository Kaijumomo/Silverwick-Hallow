import { getFabled } from "@/data/fabled";
import { iconUrlFor } from "@/data/iconUrl";
import { getLoric } from "@/data/lorics";
import type { RoleRegistry } from "@/data/roleRegistry";
import { captureVotingContext, useStorytellerStore } from "@/stores/storytellerStore";
import type { RulesQuery } from "@/stores/rulesQuery";
import { currentVotingState } from "@/stores/voting";
import { ownsAbilityUseReminder } from "@/stores/abilityUseReminders";
import { butlerReminderOrigin } from "@/stores/butlerSelection";
import { isDeathEvent } from "@/stores/lifeEvents";
import { teaLadyCovers } from "@/abilities/characters/passiveRules";
import { haircutsTonight } from "@/abilities/characters/barber";
import { demonVotedOn, flowergirlDay } from "@/abilities/characters/flowergirl";
import { isCanonicalRole } from "@/data/canonical";
import { ruleFactForReminder } from "@/stores/reminderRuleFacts";
import { effectForReminder, reminderEffectIntents } from "@/stores/reminderEffects";
import { abnormalReasons } from "@/stores/abnormalMarks";
import { gainedRoleOf, gainedTokenShownOf } from "@/stores/gainedAbility";
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
  | { type: "notation"; group: ReminderRecord[]; modifierId?: string }
  /** A condition the rules derive from the table (the No Dashii's poison): drawn, never stored, so nothing to remove. */
  | { type: "derived"; reason: string };

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

/**
 * Only official reminder token art and character icons are drawn. Drunk, Poisoned and Safe come from their
 * characters' abilities (officialEffectPresentation); an Effect with no official token stays authoritative in the
 * game record but is not drawn, and no source-free disc is ever invented for it.
 */
const ROLE_SIZE = 100;

const times = (label: string, n: number) => (n > 1 ? `${label} ×${n}` : label);

function diedToday({ game, registry, query }: MarkEnv, player: STPlayerRecord): boolean {
  if (!query || player.alive || registry.get(player.actualRole)?.type !== "outsider") return false;
  if (!Object.values(game.players).some((other) => !other.isEmpty && other.alive && other.actualRole === "godfather")) return false;
  const moment = query.moment();
  if (!moment) return false;
  const day = moment.phase === "day" ? moment.day : moment.phase === "night" ? moment.day - 1 : 0;
  if (day < 1) return false;
  const deaths = query.lifeEvents({ phase: "day", day }, (event) => isDeathEvent(event) && event.subject.participantId === player.participantId);
  return deaths.status === "known" && deaths.events.length > 0;
}

/** The Day whose deaths a "Died Today" token follows: this Day, or the Day just ended once Night falls (none before Day 1). */
function diedTodayDay(query: RulesQuery): number {
  const moment = query.moment();
  if (!moment) return 0;
  return moment.phase === "day" ? moment.day : moment.phase === "night" ? moment.day - 1 : 0;
}

/**
 * The Undertaker's official DIED TODAY token: a dead player who died by execution during the Day the token follows, while a
 * living, real Undertaker (actual character Undertaker, so never a Drunk who believes it is one) is in play. An impaired
 * (drunk/poisoned) Undertaker still wakes, so the token is still drawn. Executions that do not kill, other deaths and exiles
 * do not count. Drawn from the Life Event Window, never stored.
 */
function undertakerDiedToday({ game, query }: MarkEnv, player: STPlayerRecord): boolean {
  if (!query || player.alive) return false;
  if (!Object.values(game.players).some((other) => !other.isEmpty && other.alive && other.actualRole === "undertaker")) return false;
  const day = diedTodayDay(query);
  if (day < 1) return false;
  const executions = query.lifeEvents({ phase: "day", day }, (event) => event.kind === "execution" && event.outcome === "died" && event.subject.participantId === player.participantId);
  return executions.status === "known" && executions.events.length > 0;
}

/**
 * The Town Crier's official tokens, drawn from the Day's nomination record: "Minions Not Nominated" from dawn, swapped for
 * "Minion Nominated" once a Minion has nominated. Only for a living, real Town Crier (or a Philosopher with its ability). A nomination whose nominator's
 * registration is the Storyteller's call (a Spy or Recluse) or a record that cannot be verified draws nothing.
 */
function townCrierToken({ game, query }: MarkEnv, player: STPlayerRecord): "Minion Nominated" | "Minions Not Nominated" | null {
  // SV-3b: a Philosopher who gained the Town Crier's ability gets its tokens too ("use the duplicated character's reminders").
  if (!query || !player.alive || (player.actualRole !== "towncrier" && gainedRoleOf(player) !== "towncrier")) return null;
  const moment = query.moment();
  if (!moment) return null;
  const day = moment.phase === "day" ? moment.day : moment.phase === "night" ? moment.day - 1 : 0;
  if (day < 1 || game.voting?.day !== day || game.voting.coverage !== "known") return null;
  for (const round of game.voting.rounds) {
    if (round.mode !== "nomination") continue;
    const nominator = { playerId: round.nominator.playerId, participantId: round.nominator.participantId };
    if (!query.participant(nominator)) return null;
    const registered = query.registersAsType(nominator, "minion", "towncrier");
    if (!registered.known) return null;
    if (registered.value) return "Minion Nominated";
  }
  return "Minions Not Nominated";
}

/**
 * SV-5d: the Flowergirl's official tokens, read from the Day's voting record (PO Q3: derived, never stored): DEMON NOT VOTED from
 * dawn, DEMON VOTED once a Demon has voted, through the Night that follows (the record is the Day just ended). Only for a
 * living, real Flowergirl (or a Philosopher with her ability, as the Town Crier's). A vote the app cannot rule (a Recluse, a character
 * changed since the vote, an unfinished vote) or a record that cannot be verified draws nothing, like the Town Crier's.
 */
function flowergirlToken({ query }: MarkEnv, player: STPlayerRecord): "Demon Voted" | "Demon Not Voted" | null {
  if (!query || !player.alive || (player.actualRole !== "flowergirl" && gainedRoleOf(player) !== "flowergirl")) return null;
  const day = flowergirlDay(query);
  if (day < 1) return null;
  const record = demonVotedOn(query, day);
  return record.kind === "known" ? record.voted ? "Demon Voted" : "Demon Not Voted" : null;
}

/**
 * The Tea Lady's official CANNOT DIE token: on each of a living, real Tea Lady's two alive neighbours while both register as good to
 * her ("updated immediately... throughout the entire game"). Derived from seating, life and alignment on every draw, never stored.
 * Still drawn while she is drunk or poisoned (PO ruling 2026-11-12 22:51Z): the app then does not honour the protection, the
 * Storyteller sees the reminder. Unknown registration (no setup decision for a Spy or Recluse) draws nothing.
 */
function teaLadyGuards({ game, query }: MarkEnv, player: STPlayerRecord): STPlayerRecord[] {
  if (!query || !player.alive || !player.participantId) return [];
  return Object.values(game.players).filter((teaLady) => {
    if (teaLady.isEmpty || !teaLady.alive || !teaLady.participantId || teaLady.actualRole !== "tealady") return false;
    const role = query.roleOf(teaLady.actualRole);
    if (!role || !isCanonicalRole(role)) return false;
    const covered = teaLadyCovers(query, { playerId: teaLady.id, participantId: teaLady.participantId }, { playerId: player.id, participantId: player.participantId! });
    return covered.known && covered.value;
  });
}

export function playerMarks(env: MarkEnv, player: STPlayerRecord): Mark[] {
  const { game, script, registry, query } = env;
  if (player.isEmpty || !player.participantId || !script || !query) return [];
  const effects = officialEffectPresentation(player, { query, target: { playerId: player.id, participantId: player.participantId } });
  const marks: Mark[] = [];
  for (const token of effects.tokens) {
    const label = times(token.label, token.instances.length);
    // SV-4a: the MAD token's tooltip names the character ("Cerenovus: Mad about being the Sage"); every other token keeps "Character: Label".
    // SV-5g: the ABNORMAL token's tooltip says why ("Mathematician: Abnormal (Vortox: false information)"), Storyteller-only like the seat.
    const reasons = token.key === "mathematician:abnormal" ? abnormalReasons(token.instances) : [];
    const title = token.about ? `${token.role.name}: ${token.label} about being the ${token.about}`
      : reasons.length ? `${token.role.name}: ${label} (${reasons.join("; ")})` : `${token.role.name}: ${label}`;
    // SV-5f: a CORRECT token is a Juggler's guess; it is taken back with Undo only (Q16 A), never by removing the disc.
    const removal: Mark["removal"] = token.key === "juggler:jugglerGuess"
      ? { type: "derived", reason: "This follows the Juggler's guesses. Undo the guess to take it back." } : { type: "effect", token };
    marks.push({ key: `effect:${token.key}`, kind: "effect", label, title, src: iconUrlFor(token.role), size: ROLE_SIZE, removal });
  }
  // The No Dashii's neighbours are poisoned by its passive. Drawn with its official Poisoned token, but read-only.
  const poisoned = query.noDashiiPoisoned({ playerId: player.id, participantId: player.participantId });
  if (poisoned.known && poisoned.value) {
    const source = officialNotationRole("nodashii", "Poisoned") ?? registry.get("nodashii");
    marks.push({ key: "derived:nodashii-poison", kind: "effect", label: "Poisoned", title: "No Dashii: Poisoned", src: source ? iconUrlFor(source) : "", size: ROLE_SIZE,
      removal: { type: "derived", reason: "This follows the No Dashii. It ends when the No Dashii dies or loses its ability." } });
  }
  // SV-3a: the Philosopher's official DRUNK token on whoever truly holds the character a living, functioning Philosopher gained.
  // Derived like the No Dashii's poison, so it disappears by itself when the Philosopher dies, is drunk or poisoned, or changes character.
  const gainedDrunk = query.gainedAbilityDrunk({ playerId: player.id, participantId: player.participantId });
  if (gainedDrunk.known && gainedDrunk.value) {
    const source = officialNotationRole("philosopher", "Drunk") ?? registry.get("philosopher");
    marks.push({ key: "derived:philosopher-drunk", kind: "effect", label: "Drunk", title: "Philosopher: Drunk", src: source ? iconUrlFor(source) : "", size: ROLE_SIZE,
      removal: { type: "derived", reason: "This follows the Philosopher. It ends when the Philosopher dies, is drunk or poisoned, or changes character." } });
  }
  // SV-3a: the official IS THE PHILOSOPHER token on a Philosopher whose seat shows the character they gained (nobody truly held it then).
  if (gainedTokenShownOf(player)) {
    const source = officialNotationRole(player.actualRole, "Is The Philosopher") ?? registry.get(player.actualRole);
    marks.push({ key: "derived:philosopher-is", kind: "effect", label: "Is The Philosopher", title: `${source?.name ?? "Philosopher"}: Is The Philosopher`, src: source ? iconUrlFor(source) : "", size: ROLE_SIZE,
      removal: { type: "derived", reason: "This follows the Philosopher's choice. Undo the choice to remove it." } });
  }
  // The Godfather's official DIED TODAY token: a dead Outsider whose death was during the Day the Godfather is acting on (this Day, or
  // the Day just ended once Night falls). Drawn from the Life Event Window, never stored, so Undo and reload need nothing.
  if (diedToday(env, player)) {
    const source = officialNotationRole("godfather", "Died Today") ?? registry.get("godfather");
    marks.push({ key: "derived:godfather-died-today", kind: "effect", label: "Died Today", title: "Godfather: Died Today", src: source ? iconUrlFor(source) : "", size: ROLE_SIZE,
      removal: { type: "derived", reason: "This follows the Day's deaths. It ends at dawn." } });
  }
  // The Undertaker's official DIED TODAY token: the player executed to death while a living Undertaker is in play. Derived like the Godfather's.
  if (undertakerDiedToday(env, player)) {
    const source = officialNotationRole("undertaker", "Died Today") ?? registry.get("undertaker");
    marks.push({ key: "derived:undertaker-died-today", kind: "effect", label: "Died Today", title: "Undertaker: Died Today", src: source ? iconUrlFor(source) : "", size: ROLE_SIZE,
      removal: { type: "derived", reason: "This follows the Day's execution. It ends at dawn." } });
  }
  // The Tea Lady's official CANNOT DIE token, derived like the Godfather's and the Undertaker's DIED TODAY.
  for (const teaLady of teaLadyGuards(env, player)) {
    const source = officialNotationRole("tealady", "Cannot Die") ?? registry.get("tealady");
    marks.push({ key: `derived:tealady-cannot-die:${teaLady.participantId}`, kind: "effect", label: "Cannot Die", title: "Tea Lady: Cannot Die", src: source ? iconUrlFor(source) : "", size: ROLE_SIZE,
      removal: { type: "derived", reason: "This follows the Tea Lady's alive neighbours. It ends when one of them is evil or the Tea Lady dies." } });
  }
  // The Barber's official HAIRCUTS TONIGHT token: on the dead Barber from their death (that Day or that Night) until the Demon has
  // chosen, or dawn. Derived from the death and the Night step, never stored; still drawn while the Barber was drunk or poisoned.
  if (haircutsTonight(query, { playerId: player.id, participantId: player.participantId })) {
    const source = officialNotationRole("barber", "Haircuts Tonight") ?? registry.get("barber");
    marks.push({ key: "derived:barber-haircuts", kind: "effect", label: "Haircuts Tonight", title: "Barber: Haircuts Tonight", src: source ? iconUrlFor(source) : "", size: ROLE_SIZE,
      removal: { type: "derived", reason: "This follows the Barber's death. It ends when the Demon has chosen, or at dawn." } });
  }
  const crier = townCrierToken(env, player);
  if (crier) {
    const source = officialNotationRole("towncrier", crier) ?? registry.get("towncrier");
    marks.push({ key: "derived:towncrier-nominations", kind: "effect", label: crier, title: `Town Crier: ${crier}`, src: source ? iconUrlFor(source) : "", size: ROLE_SIZE,
      removal: { type: "derived", reason: "This follows the Day's nominations. It ends at dawn." } });
  }
  const flowergirl = flowergirlToken(env, player);
  if (flowergirl) {
    const source = officialNotationRole("flowergirl", flowergirl) ?? registry.get("flowergirl");
    marks.push({ key: "derived:flowergirl-votes", kind: "effect", label: flowergirl, title: `Flowergirl: ${flowergirl}`, src: source ? iconUrlFor(source) : "", size: ROLE_SIZE,
      removal: { type: "derived", reason: "This follows the Day's votes. It ends at dawn." } });
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
  if (removal.type === "derived") return { ok: false, message: removal.reason };
  if (removal.type === "effect") {
    const instances = removal.token.instances;
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
  const remove = { intents: [{ kind: "remove" as const, target, reminderId: intended.id }] };
  // SV-2c: a token that records a rule (the Fang Gu's ONCE) clears it when the last such token leaves the board.
  const fact = ruleFactForReminder(intended.sourceCharacter, intended.label);
  const another = !!fact && Object.values(game.players).some((other) => !other.isEmpty && other.reminders.some((reminder) =>
    reminder.id !== intended.id && ruleFactForReminder(reminder.sourceCharacter, reminder.label) === fact));
  const result = fact && !another
    ? current.resolveRuleReminder({ notation: remove, facts: { intents: [{ kind: "remove", type: fact }] } }, context)
    : current.resolveReminders(remove, context);
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export type PaletteEntry = { role: RoleDef; label: string };

/**
 * The official reminder tokens a Storyteller can place: this script, the Fabled and Loric chosen for the game, and the
 * Travellers actually seated. A Fabled or Loric chosen at setup lives on the game record, not on the script, and a Fabled is
 * not in a script's role registry unless a custom script declares it, so those two catalogues are read directly (the
 * registry's own definition still wins, so a custom script's version of the same id is the one offered).
 */
export function reminderPalette(env: MarkEnv): { inPlay: PaletteEntry[]; all: PaletteEntry[] } {
  const { game, script, registry } = env;
  if (!script) return { inPlay: [], all: [] };
  const present = new Set(Object.values(game.players).filter((p) => !p.isEmpty).map((p) => p.actualRole));
  // SV-3a: "You can now use the duplicated character's reminders for the Philosopher": a gained character's tokens are in play too.
  for (const p of Object.values(game.players)) { const gained = gainedRoleOf(p); if (gained) present.add(gained); }
  const chosen = new Set([...(game.fabled ?? []), ...(game.lorics ?? [])]);
  const ids = new Set([
    ...script.characters.map((r) => r.id), ...(script.fabled ?? []).map((r) => r.id), ...chosen,
    ...Object.values(game.players).filter((p) => !p.isEmpty && p.isTraveler).map((p) => p.actualRole),
  ]);
  const all = [...ids].flatMap((id) => {
    const role = registry.get(id) ?? (chosen.has(id) ? getFabled(id) ?? getLoric(id) : undefined);
    return role ? [...new Set([...(role.reminders ?? []), ...(role.remindersGlobal ?? [])])].map((label) => ({ role, label })) : [];
  });
  return { all, inPlay: all.filter((entry) => present.has(entry.role.id) || chosen.has(entry.role.id)) };
}

/** Places one reminder with the source character that owns its artwork: notation only, except a token that records a rule
 * (reminderRuleFacts.ts) or a per-player Effect (reminderEffects.ts). */
export function placeReminder(playerId: PlayerId, participantId: string | undefined, entry: PaletteEntry): MarkResult {
  const ctx = bound(playerId, participantId);
  if (!ctx) return { ok: false, message: "The player changed. Reopen their details before continuing." };
  // SV-5g (PO Q7 A): the Mathematician's ABNORMAL token is a real mark on this player: the Effect alone is recorded and the token is
  // drawn from it, so it is taken away the same way as any drawn Effect.
  const effect = effectForReminder(entry.role.id, entry.label);
  if (effect) {
    const planned = reminderEffectIntents(ctx.game, effect, ctx.target);
    if (!planned.ok) return planned;
    const result = ctx.current.resolveEffects({ intents: planned.intents }, captureVotingContext());
    return result.ok ? { ok: true } : { ok: false, message: result.message };
  }
  const place = { intents: [{ kind: "place" as const, target: ctx.target, reminder: { label: entry.label, sourceCharacter: entry.role.id } }] };
  // SV-2c (PO decision 2026-11-21): a token that records a rule (the Fang Gu's ONCE) records it in the same commit.
  const fact = ruleFactForReminder(entry.role.id, entry.label);
  const result = fact
    ? ctx.current.resolveRuleReminder({ notation: place, facts: { intents: [{ kind: "apply", type: fact }] } }, captureVotingContext())
    : ctx.current.resolveReminders(place, captureVotingContext());
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}
