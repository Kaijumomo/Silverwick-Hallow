import type { AbilityDescriptor } from "../semantics";
import { firstParticipant, lifeOperation, outcome, requireLivingActor } from "./shared";

/**
 * Professor -- GUIDED (Treacherous 30th, owner-authorized; shared life rules of
 * docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md, matrix Section 3).
 * https://wiki.bloodontheclocktower.com/Professor
 *
 * "Once per game, at night*, choose a dead player: if they are a Townsfolk, they are
 * resurrected." Other Nights only. ONE use per game: committing the choice uses the ability
 * even when nothing happens (a non-Townsfolk, or an impaired Professor). A dead Spy
 * (who may register as a Townsfolk) is the Storyteller's call -> Manual.
 */
export const PROFESSOR: AbilityDescriptor = {
  roleId: "professor",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "oncePerGame" },
  inputs: [{ id: "target", kind: "participant", source: "player", constraints: ["dead"], label: "The dead player chosen" }],
  hooks: ["targeting", "registration", "death"],
  presentation: { complexity: "complex", action: "Choose a dead player: a Townsfolk is resurrected" },
  evaluator: (context) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    if (context.simulated) return outcome([]);
    const use = { kind: "useAbility" as const, target: context.actor.binding };
    const spent = () => outcome([lifeOperation([use])]);
    if (!context.functioning) return spent();
    const target = firstParticipant(context.inputs, "target");
    if (context.query.participant(target)?.alive) return { kind: "illegal", message: "The Professor chooses a dead player." };
    const registered = context.query.registersAsType(target, "townsfolk", "professor");
    if (!registered.known) return { kind: "unsupported", message: registered.reason };
    if (!registered.value) return spent();
    return outcome([lifeOperation([use, { kind: "resurrection", target }])]);
  },
};
