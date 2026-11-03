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
export type CurseNotice = { note: string; actions: ExtraAction[]; auto?: () => void };

export function curseNotice(ctx: V6Ctx, nominator: CurrentParticipantRef | { playerId: string; participantId: string } | null | undefined, inRound = false): CurseNotice | null {
  const { game } = ctx;
  if (!nominator || game.phase !== "day") return null;
  const player = game.players[nominator.playerId];
  if (!player || player.isEmpty || player.participantId !== nominator.participantId || !player.alive) return null;
  const curse = player.effects.find((effect) => effect.type === "witchCurse" && effect.state === "active");
  if (!curse || livingNonTravellers(game.players) <= 3) return null;
  const query = createRulesQuery(game, { registry: ctx.registry, script: ctx.script ?? null, semantics: CANONICAL_ABILITY_SEMANTICS });
  const binding = { playerId: player.id, participantId: player.participantId! };
  const applies = query.effectApplies(binding, curse);
  if (applies.known && !applies.value) return null;
  const die = () => {
    const message = runLifeAction(player.id, player.participantId, "die");
    flash(message ?? `${player.name} dies from the Witch's curse.`);
  };
  // Certain (the curse applies and nothing protects them): once the vote begins the death is recorded by itself, as one Life command
  // that Undo reverses. Anything the rules cannot settle stays a button for the Storyteller; a vote already begun keeps the button too.
  const protectedNow = query.protectedFrom(binding, "any");
  if (applies.known && protectedNow.known && !protectedNow.value && !inRound) {
    return { note: `${player.name} is cursed by the Witch: they die as the vote begins. The nomination still counts.`, actions: [], auto: die };
  }
  const note = applies.known
    ? `${player.name} is cursed by the Witch and has nominated: they die now. The nomination still counts.`
    : `${player.name} may be cursed by the Witch (${applies.reason}). If the curse applies, they die now.`;
  return { note, actions: [{ label: `${player.name} dies (Witch's curse)`, onClick: die }] };
}

/**
 * The Golem's single nomination: "You may only nominate once per game. When you do, if the
 * nominee is not the Demon, they die." https://wiki.bloodontheclocktower.com/Golem
 *
 * The first valid nomination spends the ability by itself: when the outcome is certain (a non-Demon
 * who can die, the Demon, a protected or dead nominee, or a Golem whose ability does not work) the card
 * offers no choice and `auto` applies it, as ONE Life command (the nominee's death and the Golem's one
 * nomination), right after the vote begins. When the rules cannot decide (a Recluse that may register as
 * the Demon, an unknown protection) the Storyteller rules with the buttons once the vote has begun. A
 * Golem whose one nomination is spent cannot nominate again: `blocked` greys out Begin the vote until
 * the nominator or nominee is changed.
 */
export type GolemNotice = { note: string; actions: ExtraAction[]; auto?: () => void; blocked?: boolean };

export function golemNotice(
  ctx: V6Ctx,
  nominator: { playerId: string; participantId: string } | null | undefined,
  nominee: { playerId: string; participantId: string } | null | undefined,
  inRound = false,
): GolemNotice | null {
  const { game } = ctx;
  if (!nominator || !nominee || game.phase !== "day") return null;
  const golem = game.players[nominator.playerId];
  const target = game.players[nominee.playerId];
  if (!golem || golem.isEmpty || golem.participantId !== nominator.participantId || golem.actualRole !== "golem" || !golem.alive) return null;
  if (!target || target.isEmpty || target.participantId !== nominee.participantId) return null;
  // Once the vote has begun the consequence has been applied (or, if it was ambiguous, ruled on): nothing more to say.
  if (golem.abilityUsed) return inRound ? null : { note: `${golem.name} has already nominated once this game and may not nominate again. Change the nominator or the accused.`, actions: [], blocked: true };

  const query = createRulesQuery(game, { registry: ctx.registry, script: ctx.script ?? null, semantics: CANONICAL_ABILITY_SEMANTICS });
  const golemBinding = { playerId: golem.id, participantId: golem.participantId! };
  const targetBinding = { playerId: target.id, participantId: target.participantId! };
  const run = (intents: { kind: "death" | "useAbility"; playerId: string }[], done: string) => () => {
    const result = useStorytellerStore.getState().resolveLife({ intents }, captureVotingContext());
    flash(result.ok ? result.manualReason ?? done : result.message);
  };
  const spendIntents = [{ kind: "useAbility" as const, playerId: golem.id }];
  const killIntents = [{ kind: "death" as const, playerId: target.id }, { kind: "useAbility" as const, playerId: golem.id }];
  const spendDone = `${golem.name}'s nomination is spent.`;
  const killDone = `${target.name} dies. ${golem.name}'s nomination is spent.`;
  const spend = (label: string): ExtraAction => ({ label, onClick: run(spendIntents, spendDone) });
  const kill = (label: string): ExtraAction => ({ label, onClick: run(killIntents, killDone) });
  // Certain outcomes need no button: the vote begins and the consequence is applied by itself.
  const certain = (note: string, intents: { kind: "death" | "useAbility"; playerId: string }[], done: string): GolemNotice => ({ note, actions: [], auto: run(intents, done) });

  const functioning = query.abilityFunctions(golemBinding);
  if (functioning.known && !functioning.value) return certain(`${golem.name}'s ability does not function: nothing happens, but this is their one nomination.`, spendIntents, spendDone);
  if (!functioning.known) return { note: `Whether the Golem's ability works is unclear (${functioning.reason}). Begin the vote, then rule.`, actions: inRound ? [kill(`${target.name} dies (Golem)`), spend("Nothing happens · spend nomination")] : [] };
  if (!target.alive) return certain(`${target.name} is already dead: nothing happens, but this is the Golem's one nomination.`, spendIntents, spendDone);

  const demon = query.registersAsType(targetBinding, "demon", "golem");
  if (demon.known && demon.value) return certain(`${target.name} is the Demon: nothing happens. This is the Golem's one nomination.`, spendIntents, spendDone);
  if (!demon.known) return { note: `${target.name} may register as the Demon (${demon.reason}). Begin the vote, then rule whether they die.`, actions: inRound ? [kill(`${target.name} dies (Golem)`), spend("Nothing happens · spend nomination")] : [] };
  const safe = query.protectedFrom(targetBinding, "any");
  if (safe.known && safe.value) return certain(`${target.name} cannot die right now: they are protected. Nothing happens, but this is the Golem's one nomination.`, spendIntents, spendDone);
  if (!safe.known) return { note: `${target.name} may be protected (${safe.reason}). Begin the vote, then rule whether they die.`, actions: inRound ? [kill(`${target.name} dies (Golem)`), spend("Protected · spend nomination")] : [] };
  return certain(`${golem.name} nominated ${target.name}, who is not the Demon: they die when the vote begins. The nomination still counts.`, killIntents, killDone);
}
