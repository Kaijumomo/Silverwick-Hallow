import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { MOONCHILD_CHOICE, pendingMoonchildChoice } from "@/abilities/characters/moonchild";
import { isDeathEvent } from "@/stores/lifeEvents";
import { createRulesQuery } from "@/stores/rulesQuery";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { onGameScopeReset } from "@/stores/shellStore";
import { useTargetPicker, seatedParticipants } from "@/features/abilities/abilityUi";
import type { STPlayerRecord } from "@/stores/types";
import type { V6Ctx } from "../ctx";
import { flash } from "../v6Store";

/**
 * The Moonchild's public choice (https://wiki.bloodontheclocktower.com/Moonchild): "When you learn that you died, publicly
 * choose 1 alive player. Tonight, if it was a good player, they die." The Storyteller taps the chosen player on the
 * grimoire during the Day. A good player gets an authoritative `moonchildChoice` Effect (drawn with the Moonchild's own
 * official DEAD token, expiring at dawn); the Night wake reads it, so the death resolves tonight with the timing and
 * impairment rules of the wake. An evil player is simply unaffected, so nothing is recorded for them.
 */

/** Moonchilds the Storyteller has already ruled on this Day (an evil choice leaves no Effect). Session-only, never saved. */
const ruled = new Set<string>();
onGameScopeReset(() => ruled.clear());
const ruledKey = (ctx: V6Ctx, p: STPlayerRecord) => `${ctx.game.day}:${p.participantId}`;

/** The dead Moonchild who learned of their death during last night or today, and has not chosen yet. */
export function moonchildAwaitingChoice(ctx: V6Ctx, player: STPlayerRecord | undefined): boolean {
  const { game } = ctx;
  if (game.phase !== "day" || ctx.privacy || ctx.ended || !player || player.isEmpty || player.alive || player.actualRole !== "moonchild" || !player.participantId) return false;
  if (ruled.has(ruledKey(ctx, player))) return false;
  const query = createRulesQuery(game, { registry: ctx.registry, script: ctx.script ?? null, semantics: CANONICAL_ABILITY_SEMANTICS });
  const me = { playerId: player.id, participantId: player.participantId };
  if (pendingMoonchildChoice(query, me)) return false;
  const mine = (event: { subject: { participantId: string } }) => event.subject.participantId === player.participantId;
  const windows = (["night", "day"] as const).map((phase) => query.lifeEvents({ phase, day: game.day }, (event) => isDeathEvent(event) && mine(event)));
  // An unverifiable window is the Storyteller's call, so the choice stays available.
  return windows.some((w) => w.status !== "known" || w.events.length > 0);
}

/** Starts the board pick for the Moonchild's chosen player. */
export function startMoonchildChoice(ctx: V6Ctx, player: STPlayerRecord): void {
  const { game } = ctx;
  if (!moonchildAwaitingChoice(ctx, player)) return;
  const moonchild = { playerId: player.id, participantId: player.participantId! };
  const eligible = new Set(seatedParticipants(game).filter((p) => p.alive && !p.isTraveler).map((p) => p.participantId!));
  flash(`Tap the player ${player.name || "the Moonchild"} publicly chose.`);
  useTargetPicker.getState().start("the Moonchild's choice", (target) => {
    const current = useStorytellerStore.getState().game;
    if (!current || current !== game) { flash("The game changed. Choose again."); return; }
    const query = createRulesQuery(game, { registry: ctx.registry, script: ctx.script ?? null, semantics: CANONICAL_ABILITY_SEMANTICS });
    const chosen = game.players[target.playerId];
    const name = chosen?.name || "That player";
    if (!chosen || chosen.participantId !== target.participantId || !chosen.alive) { flash("Choose a living player."); return; }
    if (chosen.actualRole === "goon") { flash(`${name} is the Goon: their alignment when chosen decides. Use the Night wake to rule on it.`); return; }
    const alignment = query.registration(target, "moonchild").alignment;
    if (!alignment.known) { flash(`${name} may register as good or evil (${alignment.reason}). You decide at Night.`); return; }
    if (alignment.value !== "good") { ruled.add(ruledKey(ctx, player)); flash(`${name} is evil: nothing happens.`); return; }
    const result = useStorytellerStore.getState().resolveEffects({ intents: [{ kind: "apply", target,
      effect: { type: MOONCHILD_CHOICE, source: moonchild, sourceCharacter: "moonchild", lifetime: { kind: "untilDawn" } } }] });
    flash(result.ok ? `${name} will die tonight unless protected.` : result.message);
  }, { owner: "moonchild-choice", eligible });
}
