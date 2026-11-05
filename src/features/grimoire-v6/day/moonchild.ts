import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { MOONCHILD_CHOICE, MOONCHILD_UNAFFECTED, moonchildHasChosen } from "@/abilities/characters/moonchild";
import { isDeathEvent } from "@/stores/lifeEvents";
import { createRulesQuery } from "@/stores/rulesQuery";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { useTargetPicker, seatedParticipants } from "@/features/abilities/abilityUi";
import type { STPlayerRecord } from "@/stores/types";
import type { V6Ctx } from "../ctx";
import { flash } from "../v6Store";

/**
 * The Moonchild's public choice (https://wiki.bloodontheclocktower.com/Moonchild): "When you learn that you died, publicly
 * choose 1 alive player. Tonight, if it was a good player, they die." The Storyteller taps the chosen player on the
 * grimoire during the Day. A good player gets an authoritative `moonchildChoice` Effect (drawn with the Moonchild's own
 * official DEAD token, expiring at dawn); the Night wake reads it, so the death resolves tonight with the timing and
 * impairment rules of the wake. An evil player is unaffected: the choice is still recorded (Undo reverses it, and the Day stops asking) but draws no token.
 * The Moonchild chooses only in the Day, so the Night has no entry for it: the wake exists to resolve a recorded good choice.
 */

/** The dead Moonchild who learned of their death during last night or today, and has not chosen yet. */
export function moonchildAwaitingChoice(ctx: V6Ctx, player: STPlayerRecord | undefined): boolean {
  const { game } = ctx;
  if (game.phase !== "day" || ctx.privacy || ctx.ended || !player || player.isEmpty || player.alive || player.actualRole !== "moonchild" || !player.participantId) return false;
  const query = createRulesQuery(game, { registry: ctx.registry, script: ctx.script ?? null, semantics: CANONICAL_ABILITY_SEMANTICS });
  const me = { playerId: player.id, participantId: player.participantId };
  if (moonchildHasChosen(query, me)) return false;
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
    const record = (type: string) => useStorytellerStore.getState().resolveEffects({ intents: [{ kind: "apply", target,
      effect: { type, source: moonchild, sourceCharacter: "moonchild", lifetime: { kind: "untilDawn" } } }] });
    // The Goon's alignment when chosen, or a character that may register either way, is the Storyteller's ruling: the choice is recorded with the
    // official DEAD token on them, and the Storyteller takes that token away if they register as evil (an ordinary reminder removal).
    const alignment = query.registration(target, "moonchild").alignment;
    if (chosen.actualRole === "goon" || !alignment.known) {
      const result = record(MOONCHILD_CHOICE);
      flash(!result.ok ? result.message : chosen.actualRole === "goon"
        ? `${name} is the Goon: their alignment when chosen decides. The DEAD token is on them; remove it if they were evil.`
        : `${name} may register as good or evil (${(alignment as { reason?: string }).reason ?? "Storyteller ruling"}). The DEAD token is on them; remove it if they register as evil.`);
      return;
    }
    // An evil player is unaffected: recorded (so Undo can reverse it and the Day stops asking), but nothing is drawn.
    const result = record(alignment.value === "good" ? MOONCHILD_CHOICE : MOONCHILD_UNAFFECTED);
    flash(!result.ok ? result.message : alignment.value === "good" ? `${name} will die tonight unless protected.` : `${name} is evil: nothing happens.`);
  }, { owner: "moonchild-choice", eligible });
}
