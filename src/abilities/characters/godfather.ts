import { isDeathEvent } from "@/stores/lifeEvents";
import { passiveRegistrationOptions } from "./passiveRules";
import type { AbilityDescriptor } from "../semantics";
import { ask, deathAttempt, firstParticipant, lifeOperation, nothing, outcome, requireLivingActor } from "./shared";

/**
 * Godfather -- GUIDED-PARTIAL (Treacherous 30th, owner-authorized; shared protection
 * rules of docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md, matrix Section 3).
 * https://wiki.bloodontheclocktower.com/Godfather
 *
 * "You start knowing which Outsiders are in play. If 1 died today, choose a player
 * tonight: they die. [-1 or +1 Outsider]"
 *
 * Other Nights: the Godfather acts only if an Outsider died DURING THE DAY that just
 * ended (an execution or any other Day death; Outsiders that die at night do not count,
 * and two Outsider deaths still allow ONE kill). The Life Event Window holds that Day, so
 * the answer is read from authoritative state: a known "no" ends the wake with nothing to
 * do; a Spy or Recluse death (who may register as another type) or a window that cannot
 * be verified keeps the whole action Manual. The kill is a non-Demon death (protection for "any").
 * The first-night Outsider information and the +1/-1 setup change are not abilities of
 * this wake (Night Order and the setup count policy own them). Impaired / simulated:
 * the choice is simulated; nobody dies.
 */
export const GODFATHER: AbilityDescriptor = {
  roleId: "godfather",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: "target", kind: "participant", source: "player", label: "The player to kill" }],
  hooks: ["targeting", "death", "registration"],
  presentation: { complexity: "complex", action: "If an Outsider died today, choose a player to kill" },
  evaluator: (context) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    if (context.simulated || !context.functioning) return nothing();
    const { query } = context;
    const moment = query.moment();
    if (!moment || moment.phase !== "night" || moment.day < 2) return { kind: "notApplicable", message: "The Godfather kills only after an Outsider died during a Day." };

    const deaths = query.lifeEvents({ phase: "day", day: moment.day - 1 }, isDeathEvent);
    let happened: boolean | null = null;
    if (deaths.status === "known") {
      let uncertain = false;
      happened = false;
      for (const event of deaths.events) {
        const role = event.actualRoleAtEvent;
        if (!role) { uncertain = true; continue; }
        const definition = query.roleOf(role);
        if (!definition) { uncertain = true; continue; }
        if (passiveRegistrationOptions(role)) { uncertain = true; continue; }
        if (definition.type === "outsider") happened = true;
      }
      if (!happened && uncertain) happened = null;
    }
    // A Spy / Recluse death or an unverifiable window is never guessed: the whole action is Manual.
    if (happened === null) return { kind: "unsupported", message: "Silverwick cannot verify whether an Outsider died during the Day -- resolve this wake manually." };
    if (!happened) return { kind: "notApplicable", message: "No Outsider died during the Day: the Godfather does not act tonight." };

    const target = firstParticipant(context.inputs, "target");
    if (!query.participant(target)?.alive) return nothing();
    const death = deathAttempt(context, target, "any");
    if (death.kind === "ask") return ask(death.message, death.requirement);
    if (death.kind === "survives") return nothing();
    return outcome([lifeOperation([{ kind: "death", target }])]);
  },
};
