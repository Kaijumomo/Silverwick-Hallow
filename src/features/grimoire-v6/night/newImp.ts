import type { StorytellerLobbyRecord, STPlayerRecord } from "@/stores/types";

/**
 * The player who has just become the Imp and must be woken and shown YOU ARE, then the Imp token
 * (https://wiki.bloodontheclocktower.com/Imp, https://wiki.bloodontheclocktower.com/Scarlet_Woman).
 * Read from the Life Event Window only (it keeps the current and the previous phase), so nothing is stored and nothing is asked again later:
 *  - the Imp killed themselves tonight: the new Imp is shown on the dead Imp's card once that step is done;
 *  - the Demon died today (an execution, usually) and a Scarlet Woman took over: the new Imp is shown on their own Imp card tonight.
 * The new Imp gets no bluffs; the official rules show only the Imp token.
 */
export function newImpToWake(game: StorytellerLobbyRecord, actor: STPlayerRecord | undefined, stepDone: boolean): STPlayerRecord | null {
  if (game.phase !== "night" || !actor?.participantId) return null;
  const impDeaths = game.lifeEventWindow.events.filter((event) => event.actualRoleAtEvent === "imp" &&
    (event.kind === "death" || (event.kind === "execution" && event.outcome === "died")));
  const livingImps = Object.values(game.players).filter((p) => !p.isEmpty && !!p.participantId && p.alive && !p.isTraveler && p.actualRole === "imp");
  if (!actor.alive) {
    // The Imp killed themselves tonight: their step is done and another Imp now lives.
    if (!stepDone || !impDeaths.some((event) => event.moment.phase === "night" && event.subject.participantId === actor.participantId)) return null;
    return livingImps.find((p) => p.participantId !== actor.participantId) ?? null;
  }
  if (actor.actualRole !== "imp") return null;
  // The Demon died in the Day and this living Imp is the one who took over.
  return impDeaths.some((event) => event.moment.phase === "day" && event.subject.participantId !== actor.participantId) ? actor : null;
}
