import { isDeathEvent } from "@/stores/lifeEvents";
import type { AbilityDescriptor, AbilityEvaluation } from "../semantics";
import { scarletWomanSuccession } from "./scarletWoman";
import { ask, deathAttempt, deathOf, firstParticipant, lifeOperation, nothing, requireLivingActor, survivedOutcome, tokenOutcome } from "./shared";

/**
 * Zombuul -- GUIDED (BM-2b, Bad Moon Rising). https://wiki.bloodontheclocktower.com/Zombuul
 * Spec: planning/BM2_BUILD_PROPOSAL.md (PO approved 2026-11-25); the hidden life is BM-2a (lifeState.ts, passiveRules.ts row).
 * Shared rules: docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (Section 3, the shared death rule).
 *
 * "Each night*, if no-one died today, choose a player: they die. The 1st time you die, you live but register as dead."
 *  - Other nights only (no first-night order). The wake follows the PREVIOUS Day's recorded deaths, exactly as the Godfather reads
 *    them (the Life Event Window, `isDeathEvent`): any death that Day, his own registered death included, means he does not wake
 *    ("notApplicable": the Not Waking pill). An execution of a player already dead is not a death ("can't die again"), so he still
 *    wakes. A window that cannot be verified (a game migrated mid-Day) keeps the wake Manual, never a guess.
 *  - The gate is read BEFORE his sobriety: a drunk or poisoned Zombuul is not woken after a Day death either, so the wake itself never
 *    tells him he is impaired.
 *  - He wakes while truly alive (a Zombuul who registers as dead still wakes: requireLivingActor reads the true life).
 *  - Otherwise an Imp-shaped card: one player tapped; a Demon death through the shared death gate (Monk, Soldier, Sailor, Innkeeper, Tea
 *    Lady, Mayor and the rest). No star-pass. His own real death through his own choice leaves a Scarlet Woman succession Manual, as for
 *    the Vigormortis. Impaired / simulated: the choice is made and nobody dies.
 *  - A Demon chosen by a functioning Exorcist does not use this wake (the shared BM-1 rule, no Zombuul code here).
 */
export const ZOMBUUL_TARGET = "target";
export const ZOMBUUL_DAY_DEATH = "Someone died during the Day: the Zombuul does not wake tonight.";

export const ZOMBUUL: AbilityDescriptor = {
  roleId: "zombuul",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: ZOMBUUL_TARGET, kind: "participant", source: "player", label: "The player to kill" }],
  hooks: ["targeting", "death"],
  presentation: { complexity: "simple", action: "If no-one died today, choose a player to kill" },
  evaluator: (context): AbilityEvaluation => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    const { query } = context;
    const moment = query.moment();
    if (!moment || moment.phase !== "night" || moment.day < 2) return { kind: "notApplicable", message: "The Zombuul does not wake on the first night." };
    const deaths = query.lifeEvents({ phase: "day", day: moment.day - 1 }, isDeathEvent);
    if (deaths.status !== "known") return { kind: "unsupported", message: "Silverwick cannot verify whether anyone died during the Day -- resolve the Zombuul's wake manually." };
    if (deaths.events.length) return { kind: "notApplicable", message: ZOMBUUL_DAY_DEATH };
    if (context.simulated || !context.functioning) return nothing();

    const target = firstParticipant(context.inputs, ZOMBUUL_TARGET);
    const alive = query.trulyAlive(target);
    if (!alive.known || !alive.value) return nothing();
    const death = deathAttempt(context, target, "demon");
    if (death.kind === "ask") return ask(death.message, death.requirement);
    if (death.kind === "survives") return survivedOutcome(death);
    const succession = scarletWomanSuccession(query, target);
    if (succession.kind !== "none") return { kind: "unsupported", message: succession.kind === "manual" ? succession.reason : "A Scarlet Woman succession for this Demon is not modeled -- resolve manually." };
    return tokenOutcome(context, "zombuul", [lifeOperation([deathOf(target, death)])]);
  },
};
