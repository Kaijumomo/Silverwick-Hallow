import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { livingNonTravellers } from "@/abilities/characters/witch";
import { createRulesQuery } from "@/stores/rulesQuery";
import type { CurrentParticipantRef } from "@/stores/types";
import type { V6Ctx } from "../ctx";
import { flash } from "../v6Store";
import { runLifeAction } from "../board/life";
import { captureVotingContext, useStorytellerStore } from "@/stores/storytellerStore";
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

/**
 * The Golem's single nomination: "You may only nominate once per game. When you do, if the
 * nominee is not the Demon, they die." https://wiki.bloodontheclocktower.com/Golem
 *
 * The card tells the Storyteller what the nomination does and offers it through the ordinary
 * Life command: the nominee's death (when not protected and not the Demon) and the Golem's
 * one nomination being spent are ONE transaction. Whether the nominee registers as the Demon
 * (a Recluse, say) or is protected is shown honestly: an unknown answer offers both outcomes
 * and the Storyteller decides. A second nomination is never blocked (the player is trusted),
 * only noted.
 */
export function golemNotice(
  ctx: V6Ctx,
  nominator: { playerId: string; participantId: string } | null | undefined,
  nominee: { playerId: string; participantId: string } | null | undefined,
): { note: string; actions: ExtraAction[] } | null {
  const { game } = ctx;
  if (!nominator || !nominee || game.phase !== "day") return null;
  const golem = game.players[nominator.playerId];
  const target = game.players[nominee.playerId];
  if (!golem || golem.isEmpty || golem.participantId !== nominator.participantId || golem.actualRole !== "golem" || !golem.alive) return null;
  if (!target || target.isEmpty || target.participantId !== nominee.participantId) return null;
  if (golem.abilityUsed) return { note: `${golem.name} has already nominated once this game and may not nominate again. Nothing happens.`, actions: [] };

  const query = createRulesQuery(game, { registry: ctx.registry, script: ctx.script ?? null, semantics: CANONICAL_ABILITY_SEMANTICS });
  const golemBinding = { playerId: golem.id, participantId: golem.participantId! };
  const targetBinding = { playerId: target.id, participantId: target.participantId! };
  const run = (intents: { kind: "death" | "useAbility"; playerId: string }[], done: string) => () => {
    const result = useStorytellerStore.getState().resolveLife({ intents }, captureVotingContext());
    flash(result.ok ? result.manualReason ?? done : result.message);
  };
  const spend = (label: string): ExtraAction => ({ label, onClick: run([{ kind: "useAbility", playerId: golem.id }], `${golem.name}'s nomination is spent.`) });
  const kill = (label: string): ExtraAction => ({ label, onClick: run([{ kind: "death", playerId: target.id }, { kind: "useAbility", playerId: golem.id }], `${target.name} dies. ${golem.name}'s nomination is spent.`) });

  const functioning = query.abilityFunctions(golemBinding);
  if (functioning.known && !functioning.value) return { note: `${golem.name}'s ability does not function: nothing happens, but this was their one nomination.`, actions: [spend("Spend the Golem's nomination")] };
  if (!functioning.known) return { note: `Whether the Golem's ability works is unclear (${functioning.reason}). You decide.`, actions: [kill(`${target.name} dies (Golem)`), spend("Nothing happens · spend nomination")] };
  if (!target.alive) return { note: `${target.name} is already dead: nothing happens, but this was the Golem's one nomination.`, actions: [spend("Spend the Golem's nomination")] };

  const demon = query.registersAsType(targetBinding, "demon", "golem");
  if (demon.known && demon.value) return { note: `${target.name} is the Demon: nothing happens. This was the Golem's one nomination.`, actions: [spend("Spend the Golem's nomination")] };
  if (!demon.known) return { note: `${target.name} may register as the Demon (${demon.reason}). You decide whether they die.`, actions: [kill(`${target.name} dies (Golem)`), spend("Nothing happens · spend nomination")] };
  const safe = query.protectedFrom(targetBinding, "any");
  if (safe.known && safe.value) return { note: `${target.name} cannot die right now: they are protected. Nothing happens, but this was the Golem's one nomination.`, actions: [spend("Spend the Golem's nomination")] };
  if (!safe.known) return { note: `${target.name} may be protected (${safe.reason}). You decide whether they die.`, actions: [kill(`${target.name} dies (Golem)`), spend("Protected · spend nomination")] };
  return { note: `${golem.name} nominated ${target.name}, who is not the Demon: they die now. The nomination still counts.`, actions: [kill(`${target.name} dies (Golem)`)] };
}
