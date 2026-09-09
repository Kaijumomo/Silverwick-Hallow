import type { RoleRegistry } from "@/data/roleRegistry";
import { isCanonicalRole } from "@/data/canonical";
import { getTraveler } from "@/data/travelers";
import type { STPlayerRecord, StorytellerLobbyRecord } from "./types";

export const newTravelerArrival = (): NonNullable<STPlayerRecord["travelerArrival"]> => ({ demonInfoComplete: false, firstNightComplete: false });

/** Public identity is deliberately limited to the centralized Traveler registry. */
export function publicTravelerRole(p: STPlayerRecord) {
  return p.isTraveler ? getTraveler(p.actualRole) : undefined;
}

export function travelerNeedsFirstNight(p: STPlayerRecord) {
  const role = publicTravelerRole(p);
  return !!role && !!(role.firstNight || role.firstNightPrompt || role.firstNightReminder);
}

// Gnome has canonical starting information but no night-sheet position.
export const travelerNeedsArrivalCheck = (p: STPlayerRecord) => publicTravelerRole(p)?.id === "gnome";

export function travelerGuidance(p: STPlayerRecord): string[] {
  if (!p.isTraveler || p.isEmpty) return [];
  if (p.exiled) return ["Exiled — remains seated and keeps their player view."];
  if (!p.alive) return ["Dead — remains seated and keeps their player view."];
  const checks: string[] = [];
  if (!publicTravelerRole(p)) checks.push("Choose a Traveler character.");
  if (!p.actualAlignment) checks.push("Choose actual alignment privately.");
  if (travelerNeedsArrivalCheck(p) && !p.travelerArrival?.arrivalCheckComplete)
    checks.push("Storyteller check: resolve this character's public starting information in person. Verify the permitted player and any interactions; no selection is inferred.");
  if (p.actualAlignment === "evil" && !p.travelerArrival?.demonInfoComplete)
    checks.push("Give Demon information privately.");
  if (travelerNeedsFirstNight(p) && !p.travelerArrival?.firstNightComplete)
    checks.push(p.travelerArrival ? "Complete this Traveler's first-night procedure." : "Storyteller check: prior first-night completion is unknown. Review before repeating.");
  return checks;
}

/** A conservative candidate, never an automatic delivery or a team reveal. */
export function travelerDemonInformation(p: STPlayerRecord, game: StorytellerLobbyRecord, registry: RoleRegistry) {
  if (!publicTravelerRole(p) || p.actualAlignment !== "evil" || !p.alive || p.exiled || p.isEmpty)
    return { check: "Only a living evil Traveler is eligible for arrival Demon information." };
  const seated = game.seatOrder.map(id => game.players[id]).filter((q): q is STPlayerRecord => !!q && !q.isEmpty);
  const complex = seated.some(q => !q.actualRole || !registry.get(q.actualRole) ||
    !isCanonicalRole(registry.get(q.actualRole)!) ||
    ["atheist", "legion", "lilmonsta", "poppygrower", "magician", "zombuul"].includes(q.actualRole));
  const demons = seated.filter(q => !q.isTraveler && q.alive && registry.get(q.actualRole)?.type === "demon");
  if (complex || game.fabled.length || game.lorics.length || demons.length !== 1)
    return { check: "Storyteller check: verify the current Demon and any special information rules. Give the permitted information in person; no automatic candidate is available." };
  const demon = demons[0]!;
  return { demon: { id: demon.id, name: demon.name, seat: demon.seat } };
}
/** Arrival policy only; existing occupied seats and reconnects keep their identity. */
export const arrivalsAreTravelers = (phase: string): boolean => phase === "day" || phase === "night";
