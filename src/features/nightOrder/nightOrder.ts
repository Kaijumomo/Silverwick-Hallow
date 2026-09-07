import type {
  PlayerId,
  RoleId,
  RoleType,
  STPlayerRecord,
  Script,
} from "@/stores/types";
import { buildRegistry } from "@/data/roleRegistry";
import { wakeIdentity } from "@/stores/wakeIdentity";

export type NightStep =
  | {
      kind: "global";
      stepKey: string;
      label: string;
      prompt: string;
      reminder: string;
      order: number;
      recipientIds?: PlayerId[];
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
      isDeceived: boolean;
      actualRoleId: RoleId;
      actualRoleName: string;
      shownRoleId: RoleId;
      packetPlayerId: PlayerId;
    };

// ---------------------------------------------------------------------------
// Global first-night step constants
// ---------------------------------------------------------------------------

const DEMON_INFO_BASE = {
  kind: "global" as const,
  stepKey: "demonInfo",
  order: 5,
  label: "Demon — learns Minions & Bluffs",
  reminder: "Review intended team information and bluffs. Check simulated private-information tasks separately; configuration is not delivery.",
};

const MINION_INFO_STEP: Extract<NightStep, { kind: "global" }> = {
  kind: "global",
  stepKey: "minionInfo",
  order: 7,
  label: "Minions — learn each other & the Demon",
  prompt: "Wake the listed Minion recipients together. They make eye contact. Show them who the Demon is.",
  reminder: "All Minions wake simultaneously. The Demon keeps their eyes closed. Marionette is NOT woken here.",
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function computeNightOrder(
  players: Record<PlayerId, STPlayerRecord>,
  seatOrder: PlayerId[],
  script: Script,
  isFirstNight: boolean
): NightStep[] {
  const registry = buildRegistry(script);

  const steps: NightStep[] = [];

  // Global steps — first night only.
  if (isFirstNight) {
    // Detect Marionette in play to annotate demonInfo prompt.
    const hasMarionette = seatOrder.some(
      (id) =>
        players[id]?.actualRole === "marionette" || players[id]?.behaviorMode === "marionette_fake_good_behavior"
    );
    const demonInfoPrompt =
      "Wake the Demon. Show them: these are your Minions. These 3 characters are not in play (bluffs)." +
      (hasMarionette
        ? " If a Marionette is in play, indicate them to the Demon."
        : "");

    const recipients = (type: RoleType) => seatOrder.filter(id => {
      const p = players[id];
      const wake = p && wakeIdentity(p, registry);
      return !!wake && !wake.simulated && registry.get(p!.actualRole)?.type === type;
    });
    steps.push({ ...DEMON_INFO_BASE, prompt: demonInfoPrompt, recipientIds: recipients("demon") });
    steps.push({ ...MINION_INFO_STEP, recipientIds: recipients("minion") });
  }

  // Player steps.
  for (const playerId of seatOrder) {
    const player = players[playerId];
    if (!player || player.actualRole === "") continue;

    const resolved = wakeIdentity(player, registry);
    if (!resolved) continue;

    const { role: roleDef, shownRoleId: roleId, simulated: isDeceived } = resolved;

    const orderValue = isFirstNight ? roleDef.firstNight : roleDef.otherNight;
    if (orderValue === undefined) continue; // no night action this night

    const prompt = isFirstNight
      ? (roleDef.firstNightPrompt ?? roleDef.ability ?? "")
      : (roleDef.otherNightPrompt ?? roleDef.ability ?? "");

    const reminder = isFirstNight
      ? (roleDef.firstNightReminder ?? "")
      : (roleDef.otherNightReminder ?? "");

    steps.push({
      kind: "player",
      stepKey: `p:${playerId}:${roleId}`,
      playerId,
      playerName: player.name,
      seat: player.seat,
      alive: player.alive,
      abilityUsed: player.abilityUsed,
      effectiveRoleId: roleId,
      effectiveRoleName: roleDef.name,
      roleType: roleDef.type,
      prompt,
      reminder,
      order: orderValue,
      isDeceived,
      actualRoleId: player.actualRole,
      actualRoleName: registry.get(player.actualRole)?.name ?? player.actualRole,
      shownRoleId: roleId,
      packetPlayerId: playerId,
    });
  }

  // Sort: by order ascending; globals before players at equal order; then by seat.
  steps.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    if (a.kind !== b.kind) return a.kind === "global" ? -1 : 1;
    if (a.kind === "player" && b.kind === "player") return a.seat - b.seat;
    return 0;
  });

  return steps;
}
