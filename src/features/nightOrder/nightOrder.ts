import type { PlayerId, RoleId, RoleType, STPlayerRecord, Script } from "@/stores/types";
import { buildRegistry } from "@/data/roleRegistry";
import { canonicalOrder, canonicalRoles, isCanonicalRole, roleAuthority } from "@/data/canonical";
import { wakeIdentity } from "@/stores/wakeIdentity";
import { evilInformationPolicy, type NightContext } from "./nightRules";

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
    }
  | {
      kind: "player";
      stepKey: string;       // "p:{playerId}:{shownRoleId}"
      playerId: PlayerId;
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
    };


type GlobalStep = Extract<NightStep, { kind: "global" }>;

// These are procedures performed ABOUT a character, not wakes of that player.
const FIRST_NIGHT_ADMIN = new Set(["king", "marionette", "snitch", "magician", "poppygrower"]);
const DEATH_CHECKS = new Set(["ravenkeeper", "sage", "barber", "sweetheart", "moonchild",
  "grandmother", "banshee", "choirboy", "godfather", "gossip", "tinker", "hatter", "plaguedoctor", "farmer"]);
const COMPLEX_ABILITIES = new Set(["alchemist", "philosopher", "cannibal", "amnesiac", "boffin"]);

export function computeNightOrder(
  players: Record<PlayerId, STPlayerRecord>,
  seatOrder: PlayerId[],
  script: Script,
  isFirstNight: boolean,
  context: NightContext = {},
): NightStep[] {
  const registry = buildRegistry(script);
  const seated = seatOrder.map(id => players[id]).filter((p): p is STPlayerRecord => !!p && !p.isEmpty);
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
      ? "Toymaker grants normal starting information even below 7 players. Follow the eligible information steps later in this sheet; other suppression (such as Poppy Grower or Tor) still applies. Track the required no-attack night manually."
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
    if (isFirstNight) global("lunaticInfo:" + p.id, "Lunatic — simulated Demon introduction",
      policy.normalStartingInfo
        ? "Give the configured pretend Minions and good-character bluffs to " + p.name + ". Then privately inform the real Demon who the Lunatic is. Check Poppy Grower/jinx interactions before giving information."
        : "No ordinary fake team/bluffs at this player count. Privately inform the real Demon who the Lunatic is; check relevant jinxes.",
      at("lunatic"), { setupRecipientIds: policy.normalStartingInfo ? [p.id] : [] });
    if (!isFirstNight || shown.role.firstNight) global("lunaticTargets:" + p.id, "Lunatic choices — inform the real Demon",
      "After " + p.name + "'s simulated procedure, show their choice(s) to the real Demon before its action. No attack is caused by the Lunatic. Track choices and jinx exceptions manually.",
      at("lunatic") + 0.2);
  }

  const customOrders = new Map<number, string>();
  for (const player of seated) {
    if (!player.actualRole) continue;
    if (isFirstNight && player.alive && FIRST_NIGHT_ADMIN.has(player.actualRole) &&
        registry.get(player.actualRole)?.provenance?.status !== "homebrew" &&
        !["poppygrower", "magician"].includes(player.actualRole)) {
      const actual = canonicalRolesIfKnown(player.actualRole);
      if (actual) global("admin:" + player.id + ":" + actual.id, actual.name + " — Storyteller procedure",
        (actual.firstNightPrompt ?? actual.ability ?? "") +
        " This is not a wake of " + player.name + ". Check suppression, impairment and jinxes before delivery.", at(actual.id));
    }
    const resolved = wakeIdentity(player, registry);
    if (!resolved) continue;
    const { role: roleDef, shownRoleId: roleId, simulated: isDeceived } = resolved;
    const canonical = isCanonicalRole(roleDef);
    let order = isFirstNight ? roleDef.firstNight : roleDef.otherNight;
    if (!canonical && order === undefined && (isFirstNight ? roleDef.firstNightPrompt : roleDef.otherNightPrompt)) {
      global("missingOrder:" + player.id, "Night reference — Storyteller check required",
        player.name + ": instruction has no night position. Place a custom step manually.", 0.3);
    }
    if (order === undefined || order === 0) continue;
    let prompt = isFirstNight
      ? (roleDef.firstNightPrompt ?? roleDef.firstNightReminder ?? roleDef.ability ?? "")
      : (roleDef.otherNightPrompt ?? roleDef.otherNightReminder ?? roleDef.ability ?? "");
    if (!Number.isFinite(order) || order < 0 || !prompt.trim()) {
      global("invalid:" + player.id, "Night reference — Storyteller check required",
        player.name + ": invalid order or missing instruction. Add a manual step after checking the reference.", 0.3);
      continue;
    }
    if (isFirstNight && canonical && FIRST_NIGHT_ADMIN.has(roleId) && !isDeceived) {
      continue;
    }
    if (!isFirstNight && roleId === "poppygrower" && !isDeceived) continue;
    const afterDeath = !isFirstNight && (DEATH_CHECKS.has(roleId) || roleId === "zombuul" ||
      registry.get(player.actualRole)?.type === "minion" && seated.some(p => p.alive && p.actualRole === "vigormortis"));
    if (!player.alive && !afterDeath) continue;
    if (roleDef.oncePerGame && player.abilityUsed) continue;
    if (!isFirstNight && roleId === "king" && seated.filter(p => !p.alive).length < seated.filter(p => p.alive).length) continue;
    if (player.actualRole === "lunatic") order = at("lunatic") + (isFirstNight ? 0.1 : 0);
    if (isDeceived && FIRST_NIGHT_ADMIN.has(roleId)) prompt =
      "Storyteller check required: simulate the perception of " + roleDef.name +
      " only. Do not perform its actual team-information effects or reveal hidden players.";
    // A custom order may share a position; retain both, but do not imply a
    // canonical tiebreak between DIFFERENT characters. Same-role seats are OK.
    let advisory = !canonical ? roleAuthority(roleDef) + ": verify this procedure and timing." : "";
    if (!canonical && customOrders.has(order) && customOrders.get(order) !== roleId) {
      global("orderConflict:" + player.id, "Shared custom timing — Storyteller check required",
        "Different custom characters share a night position. Choose their relative order manually.", order - 0.01);
    }
    if (!canonical) customOrders.set(order, roleId);
    if (DEATH_CHECKS.has(roleId) || !player.alive) advisory += " Check the ability's death/event condition tonight; historical triggers are not tracked.";
    if (player.statuses.poisoned || player.statuses.drunk || player.behaviorMode === "poisoned")
      advisory += " Impaired: simulate the procedure as appropriate; do not apply a functioning ability or assume truthful information.";
    if (COMPLEX_ABILITIES.has(player.actualRole))
      advisory += " Storyteller check required: gained/custom abilities need manual procedures; wake identity does not model them.";
    if (policy.toymaker && roleDef.type === "demon" && !isDeceived && !isFirstNight)
      advisory += " Toymaker: check attack-skip history. Do not wake/allow a game-ending attack if the required skip has not occurred.";
    steps.push({
      kind: "player", stepKey: "p:" + player.id + ":" + roleId, playerId: player.id,
      playerName: player.name, seat: player.seat, alive: player.alive, abilityUsed: player.abilityUsed,
      effectiveRoleId: roleId, effectiveRoleName: roleDef.name, roleType: roleDef.type,
      prompt, reminder: roleDef.ability ?? "", order, advisory: advisory.trim(),
      isDeceived, actualRoleId: player.actualRole,
      actualRoleName: registry.get(player.actualRole)?.name ?? player.actualRole, shownRoleId: roleId,
    });
  }
  return steps.sort((a, b) => a.order - b.order ||
    (a.kind === "player" && b.kind === "player" ? a.seat - b.seat : a.kind === b.kind ? 0 : a.kind === "global" ? -1 : 1));
}

function canonicalRolesIfKnown(id: string) {
  try { return canonicalRoles([id])[0]; } catch { return undefined; }
}
