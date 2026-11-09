import { useStorytellerStore } from "@/stores/storytellerStore";
import type { PlayerId } from "@/stores/types";

/**
 * A Day built only through real Storyteller commands, shaped like the V2 prototype's town (Ada ... Kestrel
 * the Slayer, Lior the Gunslinger, Dmitri dead) so the Day card, vote and Slayer face-off can be compared
 * with the design state for state. Used by the Day tests and the browser harness; never by the app.
 */
const TOWN: ReadonlyArray<readonly [string, string]> = [
  ["Ada", "washerwoman"], ["Bram", "empath"], ["Cleo", "fortuneteller"], ["Dmitri", "butler"], ["Elspeth", "poisoner"],
  ["Felix", "monk"], ["Greta", "undertaker"], ["Hollis", "imp"], ["Iris", "virgin"], ["Jonah", "spy"], ["Kestrel", "slayer"],
];

export type DayTown = { ids: Record<string, PlayerId> };

const store = () => useStorytellerStore.getState();
function must(result: { ok: boolean; message?: string } | boolean, label: string) {
  if (result === false || (typeof result === "object" && !result.ok)) throw new Error(`day fixture: ${label} failed${typeof result === "object" && result.message ? ` -- ${result.message}` : ""}`);
}

/** Day `day` (1 or later) of the prototype town: Dmitri died in the night, Lior the Gunslinger joined. */
export function buildDayTown(day = 2, options: { traveler?: boolean } = {}): DayTown {
  store().newGame("tb", { plannedPlayerCount: TOWN.length, plannedTravelerCount: 0 });
  for (const [name] of TOWN) store().addPlayerToSeat(name);
  const game = () => store().game!;
  const ids: Record<string, PlayerId> = {};
  for (const id of game().seatOrder) ids[game().players[id]!.name] = id;
  store().setRolePool(TOWN.map(([, role]) => role));
  must(store().dealRolePool(), "deal");
  // The deal is random: swap characters until each seat holds the prototype's.
  for (const [name, role] of TOWN) {
    const holder = Object.values(game().players).find((p) => p.actualRole === role)!;
    if (holder.id !== ids[name]) must(store().swapSetupRoles(ids[name]!, holder.id), `give ${name} the ${role}`);
  }
  for (const id of game().seatOrder) must(store().showAssignedRole(id), "show role");
  must(store().setSetupRedHerring({ playerId: ids.Kestrel!, participantId: game().players[ids.Kestrel!]!.participantId! }), "red herring");
  must(store().revealRoles(), "reveal");
  must(store().beginNightOne(), "begin Night 1");
  if (options.traveler !== false) {
    // A Traveller arrives once the game is under way.
    store().addPlayerToSeat("Lior");
    ids.Lior = game().seatOrder.at(-1)!;
    must(store().assignRole(ids.Lior, "gunslinger"), "assign Lior");
    store().setTravelerAlignment(ids.Lior, "good", { provenance: { reason: "Storyteller selection", sourceCharacter: "gunslinger" } });
  }
  must(store().recordDeath(ids.Dmitri!, { provenance: { reason: "killed by the Demon" } }), "Dmitri dies");
  // Night 1 -> Day 1 -> Night 2 -> Day 2 ...
  for (let i = 0; i < (day - 1) * 2 + 1; i++) must(store().advancePhase(), "advance");
  store().selectPlayer(null);
  return { ids };
}
