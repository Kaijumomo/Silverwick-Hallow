import { isCanonicalRole } from "@/data/canonical";
import { isTrulyAlive } from "@/stores/lifeState";
import { needsShownIdentity } from "@/stores/identity";
import { participantStepKey } from "@/stores/nightProgress";
import { toldRoleChangeIntents } from "@/stores/roleResolution";
import { changeAlignmentIntent } from "@/stores/alignmentResolution";
import { FANG_GU_ONCE } from "@/stores/gameRuleFactRegistry";
import type { AbilityOperation } from "@/stores/abilityResolution";
import type { STPlayerRecord } from "@/stores/types";
import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import { CONCEALED_MODES } from "./pithag";
import { scarletWomanSuccession } from "./scarletWoman";
import { answerOf, ask, deathAttempt, firstParticipant, lifeOperation, nameOf, nothing, requireLivingActor, survivedOutcome, tokenOutcome, deathOf } from "./shared";

/**
 * Fang Gu -- GUIDED (SV-2b, Sects & Violets). https://wiki.bloodontheclocktower.com/Fang_Gu (saved revision 3175)
 * Shared rules: docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (Section 3, the shared death rule; Section 12, the Pit-Hag's Role seam).
 *
 * "Each night*, choose a player: they die. The 1st Outsider this kills becomes an evil Fang Gu & you die instead. [+1 Outsider]"
 * "This can only happen once per game. If the new Fang Gu attacks an Outsider, the Outsider dies as normal." "The new Fang Gu counts
 * as the Demon ... They do not learn which players are Minions." "If the Fang Gu attacks an Outsider but that Outsider does not die,
 * that Outsider does not become an evil Fang Gu and the Fang Gu does not die." ONCE "stays there for the rest of the game. Don't
 * remove it, even if the Fang Gu dies or changes character." A Sweetheart who becomes the Fang Gu "did not die".
 *
 * One wake, tapped on the board like the Imp's. Dead target: nothing. Otherwise the shared Demon death gate decides (Monk, Innkeeper,
 * Soldier, Tea Lady, Fool ... exactly as for the Imp): a survivor changes nothing (ONCE stays unrecorded). A death:
 *  - not an Outsider, or ONCE already recorded: the target dies (the Fang Gu's DEAD token);
 *  - the first Outsider: ONE declared-order resolution (one Undo): the Fang Gu dies (DEAD token); the Outsider becomes the Fang Gu,
 *    told, and evil; the game-rule fact ONCE (FANG_GU_ONCE) is recorded; the new Fang Gu's own step tonight is marked skipped. The
 *    Outsider is not recorded as dead, so nothing that reads deaths (Sweetheart, Sage, Klutz, Barber) fires for them.
 * A player who might register as an Outsider or not (a Recluse, a Spy) is the Storyteller's ruling, asked once per player, only while
 * ONCE is not recorded. By hand (Manual): a Traveller or a concealed identity in the jump, an unofficial character, an unrecorded
 * alignment, or a Fang Gu who cannot die tonight while its jump would happen (the pages do not say what then).
 * ONCE on the board (PO 2026-11-21): the jump also places the official ONCE reminder beside the new Fang Gu (one commit, one Undo).
 * The reminder is notation; the game-rule fact stays the only truth (Reminders are never mechanics input). A jump resolved by hand
 * records no fact by itself.
 * Drunk or poisoned: the choice is made and nothing happens; ONCE is not recorded. A Scarlet Woman in play keeps the action by hand
 * (the official jinx is the Storyteller's judgment, plan 5A-3). The +1 Outsider is the setup count policy (setupPolicies.ts).
 */
export const FANG_GU_TARGET = "target";
/** The Storyteller's ruling whether this chosen player registers as an Outsider to the Fang Gu (a Recluse, a Spy). */
export const fangGuRegistersAsOutsiderId = (participantId: string) => `fanggu:registersAsOutsider:${JSON.stringify(participantId)}`;

/** The official ONCE reminder (roles.json: Fang Gu "Once"). */
export const FANG_GU_ONCE_LABEL = "Once";
/** A jump resolved by hand: placing ONCE from the token list records the ONCE rule (PO decision 2026-11-21), so no second jump follows. */
const PLACE_ONCE = " If the jump happens, place the Fang Gu's ONCE token from the token list: it records the ONCE rule.";

const concealed = (p: STPlayerRecord) => p.shownRole !== p.actualRole || needsShownIdentity(p.actualRole) || CONCEALED_MODES.includes(p.behaviorMode);

/** Whether this target counts as an Outsider for the jump: known, the Storyteller's answer, or a question. */
function outsiderJump(context: AbilityEvaluationContext, victim: STPlayerRecord): boolean | AbilityEvaluation {
  const target = { playerId: victim.id, participantId: victim.participantId! };
  const registers = context.query.registersAsType(target, "outsider", "fanggu");
  if (registers.known) return registers.value;
  const id = fangGuRegistersAsOutsiderId(victim.participantId!);
  const answer = answerOf(context.inputs, id, "boolean");
  const name = nameOf(context, target);
  return answer ? answer.value : ask(`${name} might register as an Outsider.`, { id, kind: "boolean", source: "storyteller", label: `${name} registers as an Outsider` });
}

export const FANG_GU: AbilityDescriptor = {
  roleId: "fanggu",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: FANG_GU_TARGET, kind: "participant", source: "player", label: "The player to kill" }],
  hooks: ["targeting", "death", "registration", "role", "alignment"],
  presentation: { complexity: "simple", action: "Choose a player to kill" },
  evaluator: (context): AbilityEvaluation => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    if (context.simulated || !context.functioning) return nothing();
    const { query } = context;
    const me = context.actor.player;
    const target = firstParticipant(context.inputs, FANG_GU_TARGET);
    const victim = query.participant(target);
    if (!victim || !isTrulyAlive(victim)) return nothing();
    const death = deathAttempt(context, target, "demon");
    if (death.kind === "ask") return ask(death.message, death.requirement);
    // "If the Fang Gu attacks an Outsider but that Outsider does not die, that Outsider does not become an evil Fang Gu."
    if (death.kind === "survives") return survivedOutcome(death);
    const kill = (): AbilityEvaluation => {
      const succession = scarletWomanSuccession(query, target);
      if (succession.kind !== "none") return { kind: "unsupported", message: succession.kind === "manual" ? succession.reason : "A Scarlet Woman succession for this Demon is not modeled -- resolve manually." };
      return tokenOutcome(context, "fanggu", [lifeOperation([deathOf(target, death)])]);
    };
    const once = query.gameRuleFact(FANG_GU_ONCE);
    if (!once.known) return { kind: "unsupported", message: once.reason };
    // "If the new Fang Gu attacks an Outsider, the Outsider dies as normal."
    if (once.value || victim.participantId === me.participantId) return kill();
    const jump = outsiderJump(context, victim);
    if (typeof jump !== "boolean") return jump;
    if (!jump) return kill();

    // The 1st Outsider this kills becomes an evil Fang Gu & the Fang Gu dies instead.
    if (victim.isTraveler) return { kind: "unsupported", message: `A Traveller is involved: resolve the Fang Gu's jump by hand.${PLACE_ONCE}` };
    if (concealed(victim) || concealed(me)) {
      return { kind: "unsupported", message: `A concealed identity is involved: what this player is shown is not modeled. Resolve the Fang Gu's jump by hand.${PLACE_ONCE}` };
    }
    const fanggu = query.roleOf("fanggu"), outsider = query.roleOf(victim.actualRole);
    if (!fanggu || !outsider || !isCanonicalRole(fanggu) || !isCanonicalRole(outsider)) {
      return { kind: "unsupported", message: `A character that is not a verified official one is involved: resolve the Fang Gu's jump by hand.${PLACE_ONCE}` };
    }
    if (!victim.actualAlignment) return { kind: "unsupported", message: `An alignment is not recorded: resolve the Fang Gu's jump by hand.${PLACE_ONCE}` };
    const own = deathAttempt(context, context.actor.binding, "demon");
    if (own.kind === "ask") return ask(own.message, own.requirement);
    if (own.kind === "survives") {
      return { kind: "unsupported", message: `${nameOf(context, context.actor.binding)} cannot die tonight, so the Fang Gu's jump is your ruling: resolve it by hand.${PLACE_ONCE}` };
    }
    const operations: AbilityOperation[] = [
      lifeOperation([{ kind: "death", target: context.actor.binding }]),
      { domain: "role", intents: toldRoleChangeIntents(victim, "fanggu", null) },
    ];
    if (victim.actualAlignment !== "evil") operations.push({ domain: "alignment", intents: [changeAlignmentIntent(victim, "evil")] });
    operations.push(
      { domain: "gameRuleFact", intents: [{ kind: "apply", type: FANG_GU_ONCE }] },
      { domain: "reminder", intents: [{ kind: "place", target, reminder: { label: FANG_GU_ONCE_LABEL, sourceCharacter: "fanggu", source: context.actor.binding } }] },
      { domain: "nightStep", day: query.game.day, stepKey: participantStepKey(victim.participantId!, "fanggu"), status: "skipped" },
    );
    return tokenOutcome(context, "fanggu", operations, true);
  },
};
