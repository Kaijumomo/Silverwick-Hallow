import { lifeStatusOf, hasVoteAvailable } from "@/stores/lifeState";
import { iconUrlFor } from "@/data/iconUrl";
import { isCanonicalRole } from "@/data/canonical";
import { buildRegistry } from "@/data/roleRegistry";
import { evilInformationPolicy, setupInformationWarning } from "@/features/nightOrder/nightRules";
import { getPrivateInfoApplicability, previewPrivatePacket } from "@/stores/privatePackets";
import { travelerDemonInformation } from "@/stores/travelers";
import type { RoleDef, Script, STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";
import type { PresentationPayload } from "./PlayerPresentation";

export type SetupView = "traveler" | "demon" | "minion" | "bluffs";
export const characterCard = (role: RoleDef) => ({ id: role.id, name: role.name, type: role.type, ability: role.ability, icon: iconUrlFor(role) });
export function seatedPlayers(game: StorytellerLobbyRecord) {
  return [...new Set(game.seatOrder)].map(id => game.players[id]).filter((p): p is STPlayerRecord => !!p && !p.isEmpty);
}
export function infoRecipients(game: StorytellerLobbyRecord, script: Script, view: SetupView) {
  const registry = buildRegistry(script), players = seatedPlayers(game);
  if (view === "traveler") return players.filter(p => p.isTraveler && p.actualAlignment === "evil" && p.alive && !p.exiled);
  if (view === "minion") return players.filter(p => !p.isTraveler && registry.get(p.actualRole)?.type === "minion" && p.behaviorMode === "normal");
  return players.filter(p => getPrivateInfoApplicability(p, registry).bluffs);
}
/** Ordinary table counts. Never claims to calculate weighted votes or the block. */
export function infoStatistics(game: StorytellerLobbyRecord) {
  const lives = seatedPlayers(game).map(p => lifeStatusOf(p).state);
  const alive = lives.filter(state => state === "alive").length;
  return { alive, votes: lives.filter(state => state === "alive" || hasVoteAvailable(state)).length, toExecute: alive ? Math.ceil(alive / 2) : 0 };
}
export function revisedBluffs(current: readonly string[], slot: number, choice?: string): string[] {
  const next = [...current];
  if (!choice) return next.filter((_, index) => index !== slot);
  const previous = next.indexOf(choice);
  if (previous >= 0 && previous !== slot) next[previous] = next[slot] ?? "";
  next[slot] = choice;
  return next.filter(Boolean).slice(0, 3);
}
export function bluffChoiceError(game: StorytellerLobbyRecord, script: Script, playerId: string, roleId: string) {
  const registry = buildRegistry(script), player = game.players[playerId], role = registry.get(roleId);
  if (!player || player.isEmpty || !seatedPlayers(game).includes(player) || !getPrivateInfoApplicability(player, registry).bluffs) return "Choose a current Demon information recipient.";
  if (!role || !["townsfolk", "outsider"].includes(role.type)) return "Choose a Townsfolk or Outsider character.";
  const policy = evilInformationPolicy(seatedPlayers(game), registry, game);
  if (!policy.allowInPlayBluffs && seatedPlayers(game).some(p => p.actualRole === roleId)) return `${role.name} is in play. Choose an out-of-play character.`;
  return undefined;
}

/** Only explicit apparent-Demon drafts or the existing supported setup policy. */
export function setupPayload(game: StorytellerLobbyRecord, script: Script, view: SetupView, recipientId: string): PresentationPayload {
  const registry = buildRegistry(script), players = seatedPlayers(game);
  const player = infoRecipients(game, script, view).find(p => p.id === recipientId);
  if (!player) throw new Error("Choose a current information recipient.");
  const policy = evilInformationPolicy(players, registry, game);
  const names = (ids: string[]) => ids.map(id => game.players[id]?.name).filter((name): name is string => !!name);
  const bluffs = (player.privateInfo?.bluffs ?? []).map(id => {
    const role = registry.get(id);
    if (!role) throw new Error("Review the bluff characters before showing them.");
    return characterCard(role);
  });
  if (view === "traveler") {
    const result = travelerDemonInformation(player, game, registry);
    if (!result.demon) throw new Error(result.check ?? "Review the Traveller's Demon information.");
    return { kind: "setup", groups: [{ heading: "Your Demon", names: [result.demon.name] }] };
  }
  if (view === "bluffs") {
    if (!bluffs.length) throw new Error("Choose at least one bluff before showing it.");
    return { kind: "setup", groups: [{ heading: "These Characters Are Not in Play", characters: bluffs }] };
  }
  if (player.behaviorMode === "fake_demon_behavior") {
    const packet = previewPrivatePacket(player, game, registry).payload;
    return { kind: "setup", groups: [{ heading: "Your Minions", names: (packet.minions ?? []).map(p => p.name) }, { heading: "These Characters Are Not in Play", characters: bluffs }] };
  }
  if (!policy.normalStartingInfo) throw new Error("With fewer than 7 residents and no Toymaker, normal Demon and Minion starting information is not given. This setup does not automatically reveal teammates.");
  const policyWarning = setupInformationWarning(players, registry, game);
  if (policyWarning) throw new Error(policyWarning);
  // A generic custom definition must not inherit automatic canonical team rules.
  if (!policy.automaticTeamInfo || players.some(p => ["minion", "demon"].includes(registry.get(p.actualRole)?.type ?? "") && p.behaviorMode !== "normal") || players.some(p => !registry.get(p.actualRole) || !isCanonicalRole(registry.get(p.actualRole)!))) {
    throw new Error("This setup needs a Storyteller check before showing teammates. Use the existing private-information procedure.");
  }
  // Setup display describes current character holders, not tonight's living
  // wake recipients. Death does not remove a teammate's character identity.
  const team = (type: "minion" | "demon") => players.filter(p => !p.isTraveler && registry.get(p.actualRole)?.type === type).map(p => p.id);
  const magician = policy.magician ? players.filter(p => p.actualRole === "magician" && p.alive).map(p => p.id) : [];
  if (view === "demon") return { kind: "setup", groups: [
    { heading: "Your Minions", names: names([...team("minion"), ...magician]) },
    { heading: "These Characters Are Not in Play", characters: bluffs },
  ] };
  return { kind: "setup", groups: [
    { heading: "Your Demon", names: names([...team("demon"), ...magician]) },
    { heading: "Your Minions", names: names(team("minion")) },
  ] };
}
