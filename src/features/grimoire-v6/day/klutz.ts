import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { KLUTZ_TARGET, klutzLearnedDeath, klutzVerdict } from "@/abilities/characters/klutz";
import { captureFingerprint, type AbilityResolutionRequest } from "@/stores/abilityResolution";
import { createRulesQuery } from "@/stores/rulesQuery";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import { useTargetPicker, seatedParticipants } from "@/features/abilities/abilityUi";
import { iconUrlFor } from "@/data/iconUrl";
import type { STPlayerRecord } from "@/stores/types";
import type { V6Ctx } from "../ctx";
import { flash } from "../v6Store";

/**
 * SV-1c: the Klutz's public Day choice (https://wiki.bloodontheclocktower.com/Klutz), on the Moonchild's Day row and "!" (PO direction,
 * 2026-11-12). The Storyteller taps the row; the Klutz's card opens (PO design direction 2026-11-19) and the Storyteller taps the living
 * player the Klutz chose, then Confirm (Dismiss closes the card, nothing recorded). One coordinator commit (Day entry): the use, and for
 * a sober and healthy Klutz the fact the End control's "!" reads. Undo brings the row back. The row is offered only on the Day the Klutz
 * learned they died; after nightfall it is gone and the ability with it.
 */

const queryOf = (ctx: V6Ctx) => createRulesQuery(ctx.game, { registry: ctx.registry, script: ctx.script ?? null, semantics: CANONICAL_ABILITY_SEMANTICS });

/** The dead Klutz who learned they died during last night or today, and has not chosen yet. */
export function klutzAwaitingChoice(ctx: V6Ctx, player: STPlayerRecord | undefined): boolean {
  const { game } = ctx;
  if (game.phase !== "day" || ctx.privacy || ctx.ended || !player || player.isEmpty || player.alive || player.actualRole !== "klutz" || player.abilityUsed || !player.participantId) return false;
  return klutzLearnedDeath(queryOf(ctx), { playerId: player.id, participantId: player.participantId });
}

/** Opens the Klutz's card (PO design direction 2026-11-19): the Storyteller taps the living player the Klutz publicly chose, then Confirm. */
export function startKlutzChoice(ctx: V6Ctx, player: STPlayerRecord): void {
  if (!klutzAwaitingChoice(ctx, player)) return;
  ctx.ui.set({ klutz: { playerId: player.id } });
}

/** The living players the Klutz may choose (the board's picker offers only these). */
export function klutzEligible(ctx: V6Ctx): Set<string> {
  return new Set(seatedParticipants(ctx.game).filter((p) => p.alive).map((p) => p.participantId!));
}

/** Records the Klutz's choice: one coordinator commit (Day entry), as before; the card closes and the toast says what follows. */
export function confirmKlutzChoice(ctx: V6Ctx): void {
  const { game, ui } = ctx;
  const player = ui.klutz ? game.players[ui.klutz.playerId] : undefined;
  if (!player || !klutzAwaitingChoice(ctx, player)) { ui.set({ klutz: null }); return; }
  if (useStorytellerStore.getState().game !== game) { flash("The game changed. Choose again."); return; }
  const tapped = ui.klutz?.target;
  const chosen = klutzChosen(ctx);
  // The tapped participant, not just the seat: a seat that now holds someone else (or a player who has died since) is refused.
  if (!tapped || !chosen) { ui.set({ klutz: { playerId: player.id } }); flash(tapped ? "The game changed. Choose again." : "Choose a living player."); return; }
  const klutz = { playerId: player.id, participantId: player.participantId! };
  const target = { playerId: chosen.id, participantId: chosen.participantId! };
  const fingerprint = captureFingerprint(game, player.id);
  if (!fingerprint) { flash("The game changed. Choose again."); return; }
  const query = queryOf(ctx);
  const functions = query.abilityFunctions(klutz);
  const request = { mode: "guided", invocationPath: "dayEntry", fingerprint, roleId: "klutz",
    inputs: { [KLUTZ_TARGET]: { kind: "participant", participants: [target] } },
    // The recorded fact names the Klutz as its source (SV-5 reads it).
    context: { provenance: { sourcePlayer: player.id, sourceCharacter: "klutz" } } } as AbilityResolutionRequest;
  const result = useStorytellerStore.getState().resolveAbility(request, CANONICAL_ABILITY_SEMANTICS, captureCharacterActionContext());
  if (!result.ok) { flash(result.message); return; }
  useTargetPicker.getState().cancel();
  ui.set({ klutz: null });
  const name = chosen.name || "That player";
  const { verdict } = klutzVerdict(query, klutz, target, functions.known && functions.value);
  flash(verdict === "impaired" ? `${player.name || "The Klutz"} is drunk or poisoned: nothing happens.`
    : verdict === "ruling" ? `${name} may register as good or evil: your ruling.`
      : verdict === "loses" ? `${name} is evil: the Klutz’s team loses.` : `${name} is good: nothing happens.`);
}

/** The player in the card's slot: still in that seat (same participant) and alive; otherwise nobody. */
function klutzChosen(ctx: V6Ctx): STPlayerRecord | undefined {
  const tapped = ctx.ui.klutz?.target;
  const chosen = tapped ? ctx.game.players[tapped.playerId] : undefined;
  return chosen && chosen.participantId === tapped!.participantId && chosen.alive ? chosen : undefined;
}

/** The Klutz's card: whose choice, the prompt, the one slot, Confirm and Dismiss. Storyteller-only (off in Privacy Mode). */
export function buildKlutzCard(ctx: V6Ctx): Record<string, unknown> {
  const { game, ui, registry, layout } = ctx;
  const player = ui.klutz ? game.players[ui.klutz.playerId] : undefined;
  if (ctx.privacy || !player || !klutzAwaitingChoice(ctx, player)) return { on: false };
  const chosen = klutzChosen(ctx);
  const role = chosen ? registry.get(chosen.actualRole) : undefined;
  const name = player.name || "The Klutz";
  return {
    on: true, owner: `klutz-choice:${player.id}`, cx: layout.cx, cy: layout.cy,
    title: registry.get("klutz")?.name ?? "Klutz", meta: [player.name, `Seat ${player.seat + 1}`, "Dead"].filter(Boolean).join(" · "),
    prompt: `${name} learns they died. They publicly choose 1 alive player.`,
    filled: !!chosen, slotLabel: chosen ? chosen.name || `Seat ${chosen.seat + 1}` : "Player",
    slotSub: chosen ? role?.name ?? "" : "Tap on the board", slotImg: role ? iconUrlFor(role) : undefined,
    eligible: klutzEligible(ctx),
    pick: (target: { playerId: string; participantId: string }) => ui.set({ klutz: { playerId: player.id, target } }),
    confirm: () => confirmKlutzChoice(ctx),
    dismiss: () => { useTargetPicker.getState().cancel(); ui.set({ klutz: null }); },
  };
}
