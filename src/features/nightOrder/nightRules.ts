import type { RoleRegistry } from "@/data/roleRegistry";
import type { STPlayerRecord } from "@/stores/types";
import { wakeIdentity } from "@/stores/wakeIdentity";

export type NightContext = { fabled?: string[]; lorics?: string[]; day?: number };

export function evilInformationPolicy(players: STPlayerRecord[], registry: RoleRegistry, context: NightContext = {}) {
  const seated = players.filter(p => !p.isEmpty);
  const active = seated.filter(p => p.alive);
  const has = (id: string) => seated.some(p => p.actualRole === id);
  const hasAlive = (id: string) => active.some(p => p.actualRole === id);
  const count = seated.filter(p => !p.isTraveler).length;
  const toymaker = !!context.fabled?.includes("toymaker");
  const normalStartingInfo = count >= 7 || toymaker;
  // Current snapshots cannot prove when the Poppy Grower died or whether it
  // had its ability then. Never infer that a dead PG means "introduce now".
  const poppy = has("poppygrower");
  const complex = [
    ...["atheist", "legion", "lilmonsta"].filter(has),
    ...(context.lorics ?? []).filter(id => id === "tor" || id === "bootlegger"),
  ];
  const eligible = (type: "minion" | "demon") => active.filter(p => {
    const wake = wakeIdentity(p, registry);
    return wake && !wake.simulated && registry.get(p.actualRole)?.type === type;
  }).map(p => p.id);
  return {
    count, toymaker, normalStartingInfo, poppy, complex,
    automaticTeamInfo: normalStartingInfo && !poppy && !complex.length,
    automaticBluffs: normalStartingInfo && !complex.length,
    minions: eligible("minion"), demons: eligible("demon"),
    magician: hasAlive("magician"),
    allowInPlayBluffs: !!context.lorics?.includes("pope"),
  };
}

/** Warnings belong beside deliberate manual sending, not in player payloads. */
export function setupInformationWarning(players: STPlayerRecord[], registry: RoleRegistry, context: NightContext): string | undefined {
  const policy = evilInformationPolicy(players, registry, context);
  if (!policy.normalStartingInfo) return "Storyteller check required: fewer than 7 players without Toymaker do not get normal evil starting information. Send only for an explicitly verified exception.";
  if (policy.complex.length) return "Storyteller check required: this setup changes normal evil information. Verify the character rules and jinxes before sending.";
  if (policy.poppy) return "Poppy Grower: Demon bluffs remain available, but do not give actual teammates while their information is suppressed. Death timing and exceptions require a Storyteller check.";
  return undefined;
}
