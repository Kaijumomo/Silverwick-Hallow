import type { RoleRegistry } from "@/data/roleRegistry";
import type { StorytellerLobbyRecord } from "@/stores/types";

/**
 * Treacherous 30th card verbs (design_handoff_t30_script, section 3). Only used when the script is T30,
 * so Trouble Brewing's cards keep their wording.
 */
export const T30_VERBS: Record<string, string> = {
  thief: "The Thief chooses a player (not themselves): their vote counts negatively tomorrow.",
  poisoner: "The Poisoner chooses a player.",
  witch: "The Witch chooses a player. If they nominate tomorrow, they die.",
  bonecollector: "The Bone Collector might choose a dead player: they regain their ability until dusk.",
  innkeeper: "The Innkeeper chooses 2 players. They can’t die tonight; the first player tapped is drunk until dusk.",
  gambler: "The Gambler chooses a player & guesses their character. Tap the player, then pick the guess.",
  monk: "The Monk chooses a player (not themselves): safe from the Demon tonight.",
  imp: "The Imp chooses a player. If the Imp chooses themselves, an alive Minion becomes the Imp: wake them and show YOU ARE and the Imp token.",
  shabaloth: "The Shabaloth chooses 2 players.",
  nodashii: "The No Dashii chooses a player.",
  vigormortis: "The Vigormortis chooses a player. If that player is a Minion, they keep their ability and poison a neighbouring Townsfolk.",
  godfather: "An Outsider died today. The Godfather chooses a player: they die.",
  professor: "The Professor might choose a dead player. If they are a Townsfolk, they are resurrected.",
  moonchild: "The Moonchild chose a good player in the Day: they die tonight unless protected.",
  ravenkeeper: "The Ravenkeeper died tonight and chooses a player. Show that player’s character token.",
  empath: "Give a finger signal: how many alive neighbours are evil.",
  fortuneteller: "The Fortune Teller chooses 2 players. Nod if either is the Demon (or the RED HERRING).",
  oracle: "Give a finger signal: how many dead players are evil.",
};

/** First night: the Godfather is shown the Outsiders in play. */
export function godfatherInfoVerb(game: StorytellerLobbyRecord, registry: RoleRegistry): string {
  const names = Object.values(game.players)
    .filter((player) => !player.isEmpty && !player.isTraveler && player.actualRole && registry.get(player.actualRole)?.type === "outsider")
    .map((player) => registry.get(player.actualRole!)!.name);
  return names.length ? `Show the character tokens of all in-play Outsiders: ${names.join(", ")}.` : "No Outsiders are in play. Shake your head.";
}
