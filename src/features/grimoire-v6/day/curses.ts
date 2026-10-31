import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { livingNonTravellers } from "@/abilities/characters/witch";
import { createRulesQuery } from "@/stores/rulesQuery";
import type { CurrentParticipantRef } from "@/stores/types";
import type { V6Ctx } from "../ctx";
import { flash } from "../v6Store";
import { runLifeAction } from "../board/life";
import type { ExtraAction } from "./NominationExtras";

/**
 * The Witch's curse is a Day event: "if they nominate tomorrow, they die".
 * When the nominator of the card carries an applicable `witchCurse` Effect, the card says so
 * and offers the death through the ordinary Life command. Nominations continue as normal, so
 * nothing here blocks or edits the vote. With just three living players the Witch has lost the
 * ability, so no prompt is made.
 */
export function curseNotice(ctx: V6Ctx, nominator: CurrentParticipantRef | { playerId: string; participantId: string } | null | undefined): { note: string; actions: ExtraAction[] } | null {
  const { game } = ctx;
  if (!nominator || game.phase !== "day") return null;
  const player = game.players[nominator.playerId];
  if (!player || player.isEmpty || player.participantId !== nominator.participantId || !player.alive) return null;
  const curse = player.effects.find((effect) => effect.type === "witchCurse" && effect.state === "active");
  if (!curse || livingNonTravellers(game.players) <= 3) return null;
  const query = createRulesQuery(game, { registry: ctx.registry, script: ctx.script ?? null, semantics: CANONICAL_ABILITY_SEMANTICS });
  const applies = query.effectApplies({ playerId: player.id, participantId: player.participantId! }, curse);
  if (applies.known && !applies.value) return null;
  const note = applies.known
    ? `${player.name} is cursed by the Witch and has nominated: they die now. The nomination still counts.`
    : `${player.name} may be cursed by the Witch (${applies.reason}). If the curse applies, they die now.`;
  return { note, actions: [{ label: `${player.name} dies (Witch's curse)`, onClick: () => {
    const message = runLifeAction(player.id, player.participantId, "die");
    flash(message ?? `${player.name} dies from the Witch's curse.`);
  } }] };
}
