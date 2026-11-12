import type { AbilityDescriptor } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import { ask, deathAttempt, firstParticipant, followUpParticipant, lifeOperation, nameOf, nothing, survivedOutcome, tokenOutcome, requireLivingActor, subjectId } from "./shared";
import { scarletWomanSuccession } from "./scarletWoman";

/**
 * Vigormortis -- GUIDED-PARTIAL (Treacherous 30th, owner-authorized; shared
 * protection rules of docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md, matrix
 * Section 3). https://wiki.bloodontheclocktower.com/Vigormortis
 *
 * "Each night*, choose a player: they die. Minions you kill keep their ability
 * & poison 1 Townsfolk neighbor. [-1 Outsider]"
 *
 *  - the kill is the ordinary Demon death (protection asked through the shared
 *    death rule; no star-pass; a Scarlet Woman takeover stays Manual).
 *  - when the victim is a Minion who actually dies, one sourced `poisoned`
 *    Effect (manual lifetime, `whileSourceFunctions`) is applied to the Minion's
 *    nearest Townsfolk clockwise OR counter-clockwise, dead included. When both
 *    sides differ the Storyteller chooses which one (follow-up bound to that
 *    Minion). The poison ends when the Vigormortis dies or loses the ability.
 *  - the -1 Outsider setup change lives in the setup count policy.
 *  - the killed Minion keeps its ability: it receives the official HAS ABILITY token (a sourced
 *    `retainsAbility` Effect), applied in the same outcome BEFORE the death so that dying does not end
 *    what it sourced. It lasts while this Vigormortis lives and functions and the holder is still a
 *    Minion; the poison is attached to that Minion and ends with it.
 *  - NOT modeled: the poison following later seating changes.
 *  - a victim whose registration as a Minion is ambiguous -> Storyteller judgment.
 */
export const POISONED_NEIGHBOUR = "vigormortis:poisoned";

export const VIGORMORTIS: AbilityDescriptor = {
  roleId: "vigormortis",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: "target", kind: "participant", source: "player", label: "The player to kill" }],
  hooks: ["targeting", "death", "registration"],
  sourcedEffects: [{ type: "poisoned", persistence: "whileSourceFunctions" }, { type: "retainsAbility", persistence: "whileSourceFunctions" }],
  presentation: { complexity: "complex", action: "Choose a player to kill (a Minion keeps its ability)" },
  evaluator: (context) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    if (context.simulated || !context.functioning) return nothing();
    const { query } = context;
    const target = firstParticipant(context.inputs, "target");
    const victim = query.participant(target);
    if (!victim?.alive) return nothing();
    const death = deathAttempt(context, target, "demon");
    if (death.kind === "ask") return ask(death.message, death.requirement);
    if (death.kind === "survives") return survivedOutcome(death);
    const succession = scarletWomanSuccession(query, target);
    if (succession.kind !== "none") return { kind: "unsupported", message: succession.kind === "manual" ? succession.reason : "A Scarlet Woman succession for this Demon is not modeled -- resolve manually." };
    const kill = lifeOperation([{ kind: "death", target }]);

    const isMinion = query.registersAsType(target, "minion", "vigormortis");
    if (!isMinion.known) return { kind: "unsupported", message: isMinion.reason };
    if (!isMinion.value) return tokenOutcome(context, "vigormortis", [kill]);

    const neighbours = query.nearestTownsfolk(target);
    if (!neighbours.known) return { kind: "unsupported", message: neighbours.reason };
    const candidates: ParticipantBinding[] = [];
    for (const side of [neighbours.value.clockwise, neighbours.value.counterclockwise]) {
      if (side && !candidates.some((c) => c.participantId === side.participantId)) candidates.push(side);
    }
    const retain = { kind: "apply" as const, target, effect: {
      type: "retainsAbility", source: context.actor.binding, sourceCharacter: "vigormortis", lifetime: { kind: "manual" as const },
    } };
    if (!candidates.length) return tokenOutcome(context, "vigormortis", [{ domain: "effect", intents: [retain] }, kill], true);
    let poisoned = candidates[0]!;
    if (candidates.length > 1) {
      const id = subjectId(POISONED_NEIGHBOUR, target);
      const chosen = followUpParticipant(context, context.inputs, id);
      if (!chosen) return ask(`${nameOf(context, target)} keeps their ability: the Storyteller chooses which neighbouring Townsfolk is poisoned.`,
        { id, kind: "participant", source: "storyteller", label: "The Townsfolk neighbour who is poisoned" });
      if ("refusal" in chosen) return chosen.refusal;
      if (!candidates.some((c) => c.participantId === chosen.binding.participantId)) {
        return { kind: "illegal", message: "Choose one of the Minion's two nearest Townsfolk neighbours." };
      }
      poisoned = chosen.binding;
    }
    return tokenOutcome(context, "vigormortis", [{ domain: "effect", intents: [retain, { kind: "apply", target: poisoned, effect: {
      type: "poisoned", source: context.actor.binding, sourceCharacter: "vigormortis", lifetime: { kind: "manual" },
      parameters: { minion: { kind: "participant", participants: [target] } },
    } }] }, kill], true);
  },
};
