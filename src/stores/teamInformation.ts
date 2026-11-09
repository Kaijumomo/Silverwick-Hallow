import type { RoleRegistry } from "@/data/roleRegistry";
import { isCanonicalRole } from "@/data/canonical";
import { evilInformationPolicy, setupInformationWarning } from "@/features/nightOrder/nightRules";
import type { PlayerInfoSeat, StorytellerLobbyRecord } from "./types";

/**
 * Package 3 (C2): the evil team a Minion or Demon is shown, as a pure and
 * fail-closed policy shared by the Storyteller's draft and the packet preview.
 *
 *  - A Minion is told the Demon and the OTHER Minions.
 *  - The Demon is told every Minion.
 *  - Names, seats and the Minion/Demon designation only -- never a character.
 *
 * It is the same automatic-team policy the setup views already apply
 * (nightRules.evilInformationPolicy / setupInformationWarning), plus the
 * conditions that make an automatic answer unsafe to give: a living Magician,
 * anything but exactly one Demon, a non-normal behaviour mode, a character
 * the app cannot vouch for, or a Traveller recipient. Each of those refuses
 * with a reason; the Storyteller uses the existing manual procedure instead.
 */
export type TeamInformation =
  | { ok: true; demon?: PlayerInfoSeat; minions?: PlayerInfoSeat[] }
  | { ok: false; message: string };

const CHECK = "This setup needs a Storyteller check before showing teammates. Use the existing private-information procedure.";

export function teamInformationFor(
  game: StorytellerLobbyRecord,
  registry: RoleRegistry,
  recipientId: string,
): TeamInformation {
  const seated = [...new Set(game.seatOrder)].map((id) => game.players[id]).filter((p): p is NonNullable<typeof p> => !!p && !p.isEmpty);
  const recipient = seated.find((p) => p.id === recipientId);
  if (!recipient || recipient.isTraveler) return { ok: false, message: "Choose a Minion or the Demon." };
  const type = registry.get(recipient.actualRole)?.type;
  if (type !== "minion" && type !== "demon") return { ok: false, message: "Choose a Minion or the Demon." };
  // The recipient must be shown as themselves; an apparent identity is a
  // deceptive setup the Storyteller handles by hand.
  if (recipient.behaviorMode !== "normal" || recipient.shownRole !== recipient.actualRole) return { ok: false, message: CHECK };
  const ordinary = seated.filter((p) => !p.isTraveler);
  const warning = setupInformationWarning(seated, registry, game);
  if (warning) return { ok: false, message: warning };
  const policy = evilInformationPolicy(seated, registry, game);
  if (!policy.normalStartingInfo || !policy.automaticTeamInfo || policy.magician) return { ok: false, message: CHECK };
  if (ordinary.some((p) => !registry.get(p.actualRole) || !isCanonicalRole(registry.get(p.actualRole)!))) return { ok: false, message: CHECK };
  const of = (kind: "minion" | "demon") => ordinary.filter((p) => registry.get(p.actualRole)?.type === kind);
  const minions = of("minion"), demons = of("demon");
  if ([...minions, ...demons].some((p) => p.behaviorMode !== "normal")) return { ok: false, message: CHECK };
  if (demons.length !== 1 || minions.length === 0) return { ok: false, message: CHECK };
  const seat = (p: { id: string; name: string; seat: number }): PlayerInfoSeat => ({ id: p.id, name: p.name, seat: p.seat });
  if (type === "minion") {
    const others = minions.filter((p) => p.id !== recipient.id);
    return { ok: true, demon: seat(demons[0]!), ...(others.length ? { minions: others.map(seat) } : {}) };
  }
  return { ok: true, minions: minions.map(seat) };
}
