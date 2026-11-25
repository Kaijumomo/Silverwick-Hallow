import type { PlayerId, RoleId, RoleType, STPlayerRecord, Script, StorytellerLobbyRecord } from "@/stores/types";
import { buildRegistry } from "@/data/roleRegistry";
import { canonicalOrder, canonicalRoles, isCanonicalRole, roleAuthority } from "@/data/canonical";
import { wakeIdentity } from "@/stores/wakeIdentity";
import { evilInformationPolicy, type NightContext } from "@/rules/night/nightRules";
import { publicTravelerRole, travelerNeedsFirstNight } from "@/stores/travelers";
import { hasEffect } from "@/stores/effects";
import { isTrulyAlive } from "@/stores/lifeState";
import { TOYMAKER_DEMON_SKIP_OCCURRED } from "@/stores/gameRuleFacts";
import { FANG_GU_ONCE } from "@/stores/gameRuleFactRegistry";
import { participantScopedStepKey, participantStepKey, stepParticipantOf, travelerArrivalStepKey } from "@/stores/nightProgress";
import { gainedRecordOf, gainedRoleOf } from "@/stores/gainedAbility";
import { isDeathEvent, lifeEventsAt } from "@/stores/lifeEvents";
import { twinIntroduced, twinPairOf } from "@/stores/twinPair";

export type NightStep =
  | {
      kind: "global";
      stepKey: string;
      label: string;
      prompt: string;
      reminder: string;
      order: number;
      advisory?: string;
      recipientIds?: PlayerId[];
      setupRecipientIds?: PlayerId[];
      travelerArrivalId?: PlayerId;
      /** Phase 10F: the participant a participant-scoped global step is about. */
      participantId?: string;
    }
  | {
      kind: "player";
      stepKey: string;       // "p:{participantId}:{shownRoleId}" (Phase 10F, v24)
      playerId: PlayerId;
      /** Phase 10F: the participation instance this wake belongs to. */
      participantId: string;
      playerName: string;
      seat: number;
      alive: boolean;
      abilityUsed: boolean;
      effectiveRoleId: RoleId;
      effectiveRoleName: string;
      roleType: RoleType;
      prompt: string;
      reminder: string;
      order: number;
      advisory?: string;
      isDeceived: boolean;
      actualRoleId: RoleId;
      actualRoleName: string;
      shownRoleId: RoleId;
      /** SV-3a: this row is an ability the player GAINED (the Philosopher's chosen character), named by the character that gained
       * it. `effectiveRoleId` is the gained character; the player's own character is `actualRoleId`. */
      gainedFrom?: RoleId;
    };


type GlobalStep = Extract<NightStep, { kind: "global" }>;

// These are procedures performed ABOUT a character, not wakes of that player.
const FIRST_NIGHT_ADMIN = new Set(["king", "marionette", "snitch", "magician", "poppygrower"]);
const DEATH_CHECKS = new Set(["ravenkeeper", "sage", "barber", "sweetheart", "moonchild",
  "grandmother", "banshee", "choirboy", "godfather", "gossip", "tinker", "hatter", "plaguedoctor", "farmer"]);
const COMPLEX_ABILITIES = new Set(["alchemist", "cannibal", "amnesiac", "boffin", "apprentice"]);
/** SV-3a: a once-per-game wake that stops waking once used (the Philosopher wakes "each night" until they choose; SV-5b the Seamstress,
 * whose page says "remove their night token from the night sheet"). The night it is used, its row stays (done). */
const WAKES_UNTIL_USED = new Set(["philosopher", "seamstress"]);

export function computeNightOrder(
  players: Record<PlayerId, STPlayerRecord>,
  seatOrder: PlayerId[],
  script: Script,
  isFirstNight: boolean,
  context: NightContext = {},
): NightStep[] {
  const registry = buildRegistry(script);
  // Phase 10F (v24): every participant-scoped step is keyed by the occupant's
  // ParticipantId; a seat without a participation identity has no steps.
  const seated = seatOrder.map(id => players[id]).filter((p): p is STPlayerRecord & { participantId: string } =>
    !!p && stepParticipantOf(p) !== null);
  const policy = evilInformationPolicy(seated, registry, context);
  const steps: NightStep[] = [];
  const at = (id: string) => canonicalOrder(id, isFirstNight) ?? 0.5;
  const global = (stepKey: string, label: string, prompt: string, order: number, extra: Partial<GlobalStep> = {}) =>
    steps.push({ kind: "global", stepKey, label, prompt, reminder: "", order, ...extra });

  if (isFirstNight) {
    if (!policy.normalStartingInfo) global("smallGameInfo", "Starting information — small game",
      "Fewer than 7 non-Traveler players: no normal Minion/Demon introductions or starting Demon bluffs. Character-specific exceptions still require review.", at("minioninfo") - 0.1);
    if (policy.automaticTeamInfo) {
      global("minionInfo", "Minions — learn each other & the Demon",
        "Wake the listed Minions together; show the Demon. Do not wake the Marionette." +
        (policy.magician ? " Include the Magician when pointing out the Demon, without distinguishing them." : ""),
        at("minioninfo"), { recipientIds: policy.minions });
    }
    if (policy.automaticBluffs) {
      global("demonInfo", policy.automaticTeamInfo ? "Demon — learns Minions & Bluffs" : "Demon — bluffs only",
        policy.automaticTeamInfo
          ? "Wake each listed Demon; show their Minions and 3 not-in-play good characters as bluffs." +
            (policy.magician ? " Include the Magician among the indicated Minions." : "") +
            (policy.allowInPlayBluffs ? " Pope exception: duplicate good characters may also be bluffs." : "")
          : "Give only the 3 good-character bluffs. Do not reveal actual teammates while Poppy Grower information is suppressed." +
            (policy.allowInPlayBluffs ? " Pope permits in-play good-character bluffs." : ""),
        at("demoninfo"), { recipientIds: policy.demons, setupRecipientIds: policy.demons });
    }
  }

  if (policy.poppy) global("poppyInfo", "Poppy Grower — Storyteller check required",
    isFirstNight
      ? "Suppress normal team introductions. The Demon still gets bluffs where starting information applies. Check jinxes before showing the grimoire to a Spy/Widow."
      : "Only if the Poppy Grower died today or tonight with its ability: give the delayed evil team information. Being drunk/poisoned alone does not release it. Verify death timing, impairment at death and jinxes manually; this check does not authorize delivery.",
    at("poppygrower"));
  if (policy.complex.length) global("specialEvilInfo", "Evil information — Storyteller check required",
    "Normal introductions are not assumed for " + policy.complex.map(id => registry.get(id)?.name ?? id).join(", ") +
    ". Verify their special setup, recipients and bluffs from the character rules and jinxes; use notes/manual steps. No team information is sent automatically.",
    at("minioninfo") - 0.2);

  for (const id of [...new Set([...(context.fabled ?? []), ...(context.lorics ?? [])])]) {
    const role = canonicalRolesIfKnown(id);
    if (!role) {
      global("modifier:" + id, "Modifier — Storyteller check required", "Unverified modifier: check its reference and add manual instructions.", 0.1);
      continue;
    }
    const prompt = id === "toymaker" && isFirstNight
      ? "Toymaker grants normal starting information even below 7 players. Follow the eligible information steps later in this sheet; other suppression (such as Poppy Grower or Tor) still applies. Record the Demon's required no-attack skip under Game rule facts when it happens."
      : isFirstNight ? role.firstNightPrompt : role.otherNightPrompt;
    if (prompt) global("modifier:" + id, role.name + " — Storyteller check required",
      prompt + " Resolve selections and conditions manually; this assistant does not enforce the effect." +
      (id === "tor" ? " Identity concealment and death-triggered reveals are NOT automated. Review shown identities before any synchronization or delivery." : ""), at(id));
    else if (isFirstNight) global("modifier:" + id, role.name + " — setup check",
      role.ability ?? "Check this modifier's reference.", 0.2);
  }

  // Real Lunatic procedure is separate from the perceived Demon's procedure.
  // It precedes the real Demon so chosen targets can be conveyed in person.
  const lunatics = seated.filter(p => p.actualRole === "lunatic" && p.alive);
  for (const p of lunatics) {
    const shown = wakeIdentity(p, registry);
    if (!shown) continue;
    if (isFirstNight) global(participantScopedStepKey("lunaticInfo", p.participantId), "Lunatic — simulated Demon introduction",
      policy.normalStartingInfo
        ? "Give the configured pretend Minions and good-character bluffs to " + p.name + ". Then privately inform the real Demon who the Lunatic is. Check Poppy Grower/jinx interactions before giving information."
        : "No ordinary fake team/bluffs at this player count. Privately inform the real Demon who the Lunatic is; check relevant jinxes.",
      at("lunatic"), { setupRecipientIds: policy.normalStartingInfo ? [p.id] : [], participantId: p.participantId });
    if (!isFirstNight || shown.role.firstNight) global(participantScopedStepKey("lunaticTargets", p.participantId), "Lunatic choices — inform the real Demon",
      "After " + p.name + "'s simulated procedure, show their choice(s) to the real Demon before its action. No attack is caused by the Lunatic. Track choices and jinx exceptions manually.",
      at("lunatic") + 0.2, { participantId: p.participantId });
  }

  const customOrders = new Map<number, string>();
  for (const player of seated) {
    if (player.isTraveler && player.exiled) continue;
    if (player.isTraveler && player.alive && !isFirstNight && travelerNeedsFirstNight(player) &&
      (!player.travelerArrival?.firstNightComplete || player.travelerArrival.completedAtNight === context.day)) {
      const role = publicTravelerRole(player)!;
      global(travelerArrivalStepKey(player.participantId, role.id), `${player.name} — ${role.name} arrival`,
        role.firstNightPrompt ?? role.firstNightReminder ?? role.ability ?? "Review the character reference.", 0.25,
        { travelerArrivalId: player.id, participantId: player.participantId, advisory: "Storyteller timing check: this Traveler's first night is not the game's first night. Place this procedure among tonight's actions manually. Resolve any gained ability separately; the normal repeat wake is suppressed for this arrival night." });
      continue;
    }
    if (!player.actualRole) continue;
    if (isFirstNight && player.alive && FIRST_NIGHT_ADMIN.has(player.actualRole) &&
        registry.get(player.actualRole)?.provenance?.status !== "homebrew" &&
        !["poppygrower", "magician"].includes(player.actualRole)) {
      const actual = canonicalRolesIfKnown(player.actualRole);
      const demon = actual?.id === "marionette" ? seated.find(q => q.alive && registry.get(q.actualRole)?.type === "demon") : undefined;
      if (actual && demon) global(participantScopedStepKey("admin", player.participantId, actual.id), actual.name + " — wakes the Demon",
        `Wake ${demon.name} (the Demon). Show THIS PLAYER IS, then the Marionette token, and point to ${player.name}. The Marionette is not woken and does not learn the Demon.`, at(actual.id),
        { participantId: player.participantId });
      else if (actual) global(participantScopedStepKey("admin", player.participantId, actual.id), actual.name + " — Storyteller procedure",
        (actual.firstNightPrompt ?? actual.ability ?? "") +
        " This is not a wake of " + player.name + ". Check suppression, impairment and jinxes before delivery.", at(actual.id),
        { participantId: player.participantId });
    }
    const resolved = wakeIdentity(player, registry);
    if (!resolved) continue;
    const { role: roleDef, shownRoleId: roleId, simulated: isDeceived } = resolved;
    const canonical = isCanonicalRole(roleDef);
    // A player the Shabaloth regurgitated tonight has their ability back: a character whose ability only works on the first night
    // (no other-night wake) is listed at its first-night position with its first-night instruction.
    const reborn = !isFirstNight && !!roleDef.firstNight && !roleDef.otherNight && player.alive && hasEffect(player, "shabalothAlive") &&
      player.effects.some((effect) => effect.type === "shabalothAlive" && effect.appliedAt?.phase === "night" && effect.appliedAt.day === context.day);
    // SV-1d (https://wiki.bloodontheclocktower.com/Barber): a living player the Barber's swap made a character whose ability works only on
    // the first night learns "at that point" (Glossary). The swap marks that step for tonight; it is listed right after the Barber's step
    // with its first-night instruction, and answered by hand.
    const swappedIn = !isFirstNight && !reborn && canonical && !!roleDef.firstNight && !roleDef.otherNight && player.alive &&
      !FIRST_NIGHT_ADMIN.has(roleId) && context.day !== undefined && !!context.nightProgress?.[`${context.day}:${participantStepKey(player.participantId, roleId)}`];
    // SV-4c (https://wiki.bloodontheclocktower.com/Evil_Twin): the Twins are introduced on the first night. On a later night the row returns only
    // when the pair needs it again: it broke (both the same alignment, a Pit-Hag-made Evil Twin with no Good Twin chosen) or was re-chosen
    // since the Evil Twin's step was last done. Derived from the markers and the recorded steps, so Undo and reload need nothing.
    const twinAgain = !isFirstNight && !reborn && !swappedIn && canonical && roleId === "eviltwin" && !isDeceived && player.alive && !player.isTraveler && context.day !== undefined && (() => {
      const pair = twinPairOf(players);
      // A row done tonight stays tonight (done), exactly as the Philosopher's does; it is gone from the next night.
      const doneTonight = context.nightProgress?.[`${context.day}:${participantStepKey(player.participantId, roleId)}`]?.status === "done";
      return pair.kind === "single" && pair.evil.participantId === player.participantId && (!pair.valid || doneTonight || !twinIntroduced(pair, context.nightProgress, context.day!));
    })();
    const firstPass = isFirstNight || reborn || swappedIn || twinAgain;
    let order = swappedIn ? at("barber") + 0.01 : firstPass ? roleDef.firstNight : roleDef.otherNight;
    if (!canonical && order === undefined && (isFirstNight ? roleDef.firstNightPrompt : roleDef.otherNightPrompt)) {
      global(participantScopedStepKey("missingOrder", player.participantId), "Night reference — Storyteller check required",
        player.name + ": instruction has no night position. Place a custom step manually.", 0.3, { participantId: player.participantId });
    }
    if (order === undefined || order === 0) continue;
    let prompt = firstPass
      ? (roleDef.firstNightPrompt ?? roleDef.firstNightReminder ?? roleDef.ability ?? "")
      : (roleDef.otherNightPrompt ?? roleDef.otherNightReminder ?? roleDef.ability ?? "");
    if (!Number.isFinite(order) || order < 0 || !prompt.trim()) {
      global(participantScopedStepKey("invalid", player.participantId), "Night reference — Storyteller check required",
        player.name + ": invalid order or missing instruction. Add a manual step after checking the reference.", 0.3, { participantId: player.participantId });
      continue;
    }
    if (isFirstNight && canonical && FIRST_NIGHT_ADMIN.has(roleId) && !isDeceived) {
      continue;
    }
    if (!isFirstNight && roleId === "poppygrower" && !isDeceived) continue;
    if (WAKES_UNTIL_USED.has(roleId) && canonical && player.abilityUsed
      && !context.nightProgress?.[`${context.day}:${participantStepKey(player.participantId, roleId)}`]) continue;
    // SV-1 (https://wiki.bloodontheclocktower.com/Juggler): "On your 1st day, publicly guess ... That night, you learn how many you got
    // correct." The Juggler wakes once: on the night after the first Day as the Juggler -- Night 2 from the deal, or the night after a
    // change (a Barber swap, the Pit-Hag, by hand; becoming the Juggler again is a fresh start). Where that is not known (a game saved
    // before character timing existed), the row stays on every later night, as before, and the Storyteller decides.
    if (!isFirstNight && roleId === "juggler" && canonical && context.day !== undefined) {
      const firstDay = jugglerFirstDay(player, context);
      if (firstDay !== null && context.day !== firstDay + 1) continue;
    }
    // https://wiki.bloodontheclocktower.com/Vigormortis : a Minion the Vigormortis kills at night keeps its
    // ability while the Vigormortis lives. Which Minions were killed that way is not tracked, so the row is
    // shown for any dead Minion and the Storyteller is told exactly when to wake it.
    const keptMinion = !isFirstNight && !player.alive && registry.get(player.actualRole)?.type === "minion" &&
      seated.some(p => p.alive && p.actualRole === "vigormortis");
    // WP-5: a Minion the Vigormortis killed carries the official HAS ABILITY reminder, which already
    // says it keeps the ability: that row needs no advisory. Only an unmarked dead Minion keeps the old note.
    const markedKept = keptMinion && hasEffect(player, "retainsAbility");
    const afterDeath = !isFirstNight && (DEATH_CHECKS.has(roleId) || keptMinion);
    // BM-2: the TRUE life. A Zombuul who registers as dead still wakes ("the Zombuul still attacks"); a truly dead one never does.
    // Storyteller-only: the Night list is never projected.
    const living = isTrulyAlive(player);
    if (!living && !afterDeath) continue;
    // SOL-10F-L6: no generic suppression from prose-derived `oncePerGame`.
    // Usage authority is a verified AbilityDescriptor (enforced by the
    // coordinator); an unverified character stays visible (its "used" state is
    // shown on the row) for the Storyteller's own check / Manual path.
    if (!isFirstNight && roleId === "king" && seated.filter(p => !p.alive).length < seated.filter(p => p.alive).length) continue;
    if (player.actualRole === "lunatic") order = at("lunatic") + (isFirstNight ? 0.1 : 0);
    if (isDeceived && FIRST_NIGHT_ADMIN.has(roleId)) prompt =
      "Storyteller check required: simulate the perception of " + roleDef.name +
      " only. Do not perform its actual team-information effects or reveal hidden players.";
    // A custom order may share a position; retain both, but do not imply a
    // canonical tiebreak between DIFFERENT characters. Same-role seats are OK.
    let advisory = !canonical ? roleAuthority(roleDef) + ": verify this procedure and timing." : "";
    if (!canonical && customOrders.has(order) && customOrders.get(order) !== roleId) {
      global(participantScopedStepKey("orderConflict", player.participantId), "Shared custom timing — Storyteller check required",
        "Different custom characters share a night position. Choose their relative order manually.", order - 0.01, { participantId: player.participantId });
    }
    if (!canonical) customOrders.set(order, roleId);
    if (markedKept) { /* the reminder token on the board carries the reason */ }
    else if (keptMinion) advisory += " Vigormortis: wake this dead Minion ONLY if the Vigormortis killed them at night (a Minion who died by execution or any other way has lost the ability), they are still a Minion, and they are not drunk or poisoned. Otherwise skip this step.";
    else if (DEATH_CHECKS.has(roleId) || !living) advisory += " Check the ability's death/event condition tonight; historical triggers are not tracked.";
    if (hasEffect(player, "poisoned") || hasEffect(player, "drunk") || player.behaviorMode === "poisoned")
      advisory += " Impaired: simulate the procedure as appropriate; do not apply a functioning ability or assume truthful information.";
    if (COMPLEX_ABILITIES.has(player.actualRole))
      advisory += " Storyteller check required: gained/custom abilities need manual procedures; wake identity does not model them.";
    if (policy.toymaker && roleDef.type === "demon" && !isDeceived && !isFirstNight)
      advisory += (context.gameRuleFacts ?? []).some((fact) => fact.type === TOYMAKER_DEMON_SKIP_OCCURRED)
        ? " Toymaker: the Demon's required no-attack skip is recorded (Game rule facts)."
        : " Toymaker: the Demon's required no-attack skip is not recorded yet. Do not wake/allow a game-ending attack if the required skip has not occurred; record the skip when the Demon chooses not to attack.";
    // SV-2b: the Fang Gu's official ONCE reminder "stays there for the rest of the game"; it is a game-rule fact with no disc, so the
    // Fang Gu's own row says it is recorded.
    if (roleId === "fanggu" && canonical && !isDeceived && !isFirstNight && (context.gameRuleFacts ?? []).some((fact) => fact.type === FANG_GU_ONCE))
      advisory += " ONCE: a Fang Gu has already taken an Outsider's place. An Outsider it kills now dies.";
    steps.push({
      kind: "player", stepKey: participantStepKey(player.participantId, roleId), playerId: player.id,
      participantId: player.participantId,
      playerName: player.name, seat: player.seat, alive: living, abilityUsed: player.abilityUsed,
      effectiveRoleId: roleId, effectiveRoleName: roleDef.name, roleType: roleDef.type,
      prompt, reminder: roleDef.ability ?? "", order, advisory: advisory.trim(),
      isDeceived, actualRoleId: player.actualRole,
      actualRoleName: registry.get(player.actualRole)?.name ?? player.actualRole, shownRoleId: roleId,
    });
  }
  // The gained rows; the used flag is copied here, in the one reviewed snapshot unit (lifeAbilityUse guard).
  steps.push(...gainedSteps(seated, registry, isFirstNight, context).map(({ player, step }) => ({ ...step, abilityUsed: player.abilityUsed })));
  return steps.sort((a, b) => a.order - b.order ||
    (a.kind === "player" && b.kind === "player" ? a.seat - b.seat : a.kind === b.kind ? 0 : a.kind === "global" ? -1 : 1));
}

/**
 * SV-3a (https://wiki.bloodontheclocktower.com/Philosopher): "If the Philosopher gains an ability that works at night, they wake when
 * that character would wake. If this ability is used on the first night only, they use it tonight." One row per gained ability, at the
 * gained character's place, with its own instruction, keyed by the player and the gained character. The night it was gained, a place
 * that has already passed waits for the next night, and a first-night-only ability is listed right after the gainer's own step. A
 * Juggler's ability works on the night after the gainer's first Day with it. A gained ability that only acts after its holder dies
 * (Sage, Barber, Sweetheart...) is listed only when the gainer died during the Day just ended or tonight (or that is unknown).
 * Derived from the gained record on every call, so Undo and reload need nothing.
 */
type GainedStep = { player: STPlayerRecord; step: Omit<Extract<NightStep, { kind: "player" }>, "abilityUsed"> };
function gainedSteps(seated: (STPlayerRecord & { participantId: string })[], registry: ReturnType<typeof buildRegistry>, isFirstNight: boolean, context: NightContext): GainedStep[] {
  const out: GainedStep[] = [];
  for (const player of seated) {
    const record = gainedRecordOf(player);
    const gained = gainedRoleOf(player);
    if (!record || !gained || player.isTraveler) continue;
    const wake = wakeIdentity(player, registry);
    const role = registry.get(gained);
    const own = registry.get(player.actualRole);
    if (!wake || wake.simulated || !role || !own) continue;
    const day = context.day;
    const tonight = day !== undefined && record.appliedAt?.phase === "night" && record.appliedAt.day === day;
    const firstOnly = !!role.firstNight && !role.otherNight;
    const ownOrder = (isFirstNight ? own.firstNight : own.otherNight) ?? 0;
    let order: number | undefined;
    let firstPass = isFirstNight;
    if (isFirstNight) order = role.firstNight;
    else if (firstOnly) { order = tonight ? ownOrder + 0.01 : undefined; firstPass = true; }
    else order = role.otherNight;
    if (order === undefined || order === 0 || !Number.isFinite(order) || order < 0) continue;
    if (tonight && order < ownOrder) continue;
    if (!isFirstNight && gained === "juggler" && (day === undefined || record.appliedAt?.day === undefined || day !== record.appliedAt.day + 1)) continue;
    const afterDeath = DEATH_CHECKS.has(gained);
    if (afterDeath && (player.alive || !diedTodayOrTonight(player, context))) continue;
    if (!player.alive && !afterDeath) continue;
    const prompt = firstPass ? (role.firstNightPrompt ?? role.firstNightReminder ?? role.ability ?? "") : (role.otherNightPrompt ?? role.otherNightReminder ?? role.ability ?? "");
    if (!prompt.trim()) continue;
    let advisory = `Gained from the ${own.name}.`;
    if (afterDeath) advisory += " Check the ability's death/event condition tonight; historical triggers are not tracked.";
    if (hasEffect(player, "poisoned") || hasEffect(player, "drunk") || player.behaviorMode === "poisoned")
      advisory += " Impaired: simulate the procedure as appropriate; do not apply a functioning ability or assume truthful information.";
    out.push({ player, step: {
      kind: "player", stepKey: participantStepKey(player.participantId, gained), playerId: player.id, participantId: player.participantId,
      playerName: player.name, seat: player.seat, alive: player.alive,
      effectiveRoleId: gained, effectiveRoleName: role.name, roleType: role.type, prompt, reminder: role.ability ?? "", order, advisory,
      isDeceived: false, actualRoleId: player.actualRole, actualRoleName: own.name, shownRoleId: gained, gainedFrom: player.actualRole,
    } });
  }
  return out;
}

/** Whether this player died during the Day just ended or tonight; unknown coverage counts as yes (the Storyteller checks). */
function diedTodayOrTonight(player: STPlayerRecord, context: NightContext): boolean {
  const game = context as NightContext & Partial<Pick<StorytellerLobbyRecord, "phase" | "lifeEventWindow">>;
  if (!game.lifeEventWindow || game.phase === undefined || context.day === undefined) return true;
  const windows = [{ phase: "night" as const, day: context.day }, ...(context.day > 1 ? [{ phase: "day" as const, day: context.day - 1 }] : [])];
  return windows.some((moment) => {
    const deaths = lifeEventsAt({ phase: game.phase!, day: context.day!, lifeEventWindow: game.lifeEventWindow! }, moment,
      (event) => isDeathEvent(event) && event.subject.participantId === player.participantId);
    return deaths.status !== "known" || deaths.events.length > 0;
  });
}

/** The Day number of this player's first Day with their current character, or null when that is not known. */
export function jugglerFirstDay(player: STPlayerRecord, context: NightContext): number | null {
  if (player.characterSince) return player.characterSince.day;
  const from = context.characterSinceFrom;
  // Recorded from Night 1 (a game started with character timing): no change means since the deal, so Day 1.
  return from && from.phase === "night" && from.day === 1 ? 1 : null;
}

function canonicalRolesIfKnown(id: string) {
  try { return canonicalRoles([id])[0]; } catch { return undefined; }
}
