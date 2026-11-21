import { canonicalOrder, isCanonicalRole } from "@/data/canonical";
import { needsShownIdentity } from "@/stores/identity";
import { participantStepKey } from "@/stores/nightProgress";
import { toldRoleChangeIntents } from "@/stores/roleResolution";
import { changeAlignmentIntent } from "@/stores/alignmentResolution";
import type { AbilityOperation } from "@/stores/abilityResolution";
import type { Alignment, RoleDef, STPlayerRecord } from "@/stores/types";
import type { AbilityDescriptor, AbilityEvaluation } from "../semantics";
import { CONCEALED_MODES } from "./pithag";
import { answerOf, ask, firstParticipant, nameOf, nothing, outcome, requireLivingActor } from "./shared";

/**
 * Snake Charmer -- GUIDED (SV-2a, Sects & Violets). https://wiki.bloodontheclocktower.com/Snake_Charmer (saved revision 2905)
 * Shared rules: docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (Section 12, the Pit-Hag's Role seam; Section 11, the Cult Leader's
 * alignment change).
 *
 * "Each night, choose an alive player: a chosen Demon swaps characters & alignments with you & is then poisoned."
 * "If that player is not the Demon, nothing happens." "the Demon becomes good and poisoned permanently."
 * "In the strange situation that the Snake Charmer is evil, or the Demon good, swap their alignments as appropriate."
 * "The Snake Charmer chooses themself, so nothing happens." A Pit-Hag'd Snake Charmer who chooses the Fang Gu: "Both remain evil."
 *
 * One night step, tapped on the board like the Imp's. When the chosen player is a Demon, ONE declared-order resolution (one Undo):
 *  1. the two characters swap through the Pit-Hag's seam, each player told their new character;
 *  2. the two alignments swap through the Cult Leader's alignment seam (only where they differ), each player told the new one;
 *  3. the new Snake Charmer (the old Demon) gets a POISONED Effect sourced by this Snake Charmer, with no end. It is declared
 *     `independent`: it keeps applying whatever happens to its source (the new Demon dies, changes character, ...). Removing the
 *     official POISONED token is the Storyteller's correction path;
 *  4. the new Snake Charmer's own step tonight is marked skipped (it must not choose again tonight). The new Demon acts tonight as
 *     usual: the Snake Charmer's place is before every Demon's. A character whose place tonight has passed is marked skipped,
 *     as the Barber's swap does.
 * A player who might register as a Demon (a Recluse) is the Storyteller's ruling, asked once per player: Yes swaps with them.
 * With two Demons alive, the one chosen swaps. By hand (Manual): a Traveller or a concealed identity on either side, a character
 * that is not a verified official one, or an alignment that is not recorded.
 * Drunk or poisoned (or a Drunk shown the Snake Charmer): the choice is made and nothing happens.
 * A Philosopher who gained this ability runs this same step (SV-3b): its own character, the Philosopher, is what the Demon gets.
 * Not built here: what the new Demon learns on the first night (the pages say only YOU ARE and the token; the Storyteller decides).
 */
export const SNAKE_CHARMER_TARGET = "target";
/** The Storyteller's ruling whether this chosen player registers as a Demon to the Snake Charmer (a Recluse). */
export const snakeCharmerRegistersAsDemonId = (participantId: string) => `snakecharmer:registersAsDemon:${JSON.stringify(participantId)}`;

const defaultAlignment = (role: RoleDef): Alignment => role.type === "townsfolk" || role.type === "outsider" ? "good" : "evil";
/** The player is told their new character and their new alignment; Normal (null) whenever the character already implies it. */
const told = (player: STPlayerRecord, role: RoleDef, alignment: Alignment) =>
  toldRoleChangeIntents(player, role.id, alignment === defaultAlignment(role) ? null : alignment);
const concealed = (p: STPlayerRecord) => p.shownRole !== p.actualRole || needsShownIdentity(p.actualRole) || CONCEALED_MODES.includes(p.behaviorMode);

export const SNAKE_CHARMER: AbilityDescriptor = {
  roleId: "snakecharmer",
  timing: ["firstNight", "otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: SNAKE_CHARMER_TARGET, kind: "participant", source: "player", constraints: ["alive"], label: "The alive player the Snake Charmer chooses" }],
  hooks: ["targeting", "registration", "role", "alignment"],
  sourcedEffects: [{ type: "poisoned", persistence: "independent" }],
  presentation: { complexity: "simple", action: "Choose an alive player" },
  evaluator: (context): AbilityEvaluation => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    // "the choice is made and nothing happens": a drunk or poisoned Snake Charmer swaps with nobody.
    if (context.simulated || !context.functioning) return nothing();
    const { query } = context;
    const me = context.actor.player;
    const target = firstParticipant(context.inputs, SNAKE_CHARMER_TARGET);
    const picked = query.participant(target);
    if (!picked) return { kind: "stale", message: "The chosen player is no longer in that seat." };
    if (!picked.alive) return { kind: "illegal", message: "Choose an alive player." };
    // "The Snake Charmer chooses themself, so nothing happens."
    if (picked.participantId === me.participantId) return nothing();
    const registers = query.registersAsType(target, "demon", "snakecharmer");
    if (registers.known && !registers.value) return nothing();
    if (!registers.known) {
      const id = snakeCharmerRegistersAsDemonId(picked.participantId!);
      const answer = answerOf(context.inputs, id, "boolean");
      const name = nameOf(context, target);
      if (!answer) return ask(`${name} might register as a Demon.`, { id, kind: "boolean", source: "storyteller", label: `${name} registers as a Demon` });
      if (!answer.value) return nothing();
    }
    if (picked.isTraveler || me.isTraveler) return { kind: "unsupported", message: "A Traveller is involved: swap their characters and alignments by hand, and place POISONED on the old Demon." };
    if (concealed(me) || concealed(picked)) {
      return { kind: "unsupported", message: "A concealed identity is involved: what these players are shown is not modeled. Swap their characters and alignments by hand, and place POISONED on the old Demon." };
    }
    const mine = query.roleOf(me.actualRole), theirs = query.roleOf(picked.actualRole);
    if (!mine || !theirs || !isCanonicalRole(mine) || !isCanonicalRole(theirs)) {
      return { kind: "unsupported", message: "A character that is not a verified official one is involved: swap their characters and alignments by hand, and place POISONED on the old Demon." };
    }
    const myAlignment = me.actualAlignment, theirAlignment = picked.actualAlignment;
    if (!myAlignment || !theirAlignment) return { kind: "unsupported", message: "An alignment is not recorded: swap their characters and alignments by hand, and place POISONED on the old Demon." };
    // 1. Characters, each player told their new character and new alignment. 2. Alignments ("swap their alignments as appropriate").
    const operations: AbilityOperation[] = [{ domain: "role", intents: [...told(me, theirs, theirAlignment), ...told(picked, mine, myAlignment)] }];
    if (myAlignment !== theirAlignment) {
      operations.push({ domain: "alignment", intents: [changeAlignmentIntent(me, theirAlignment), changeAlignmentIntent(picked, myAlignment)] });
    }
    // 3. "& is then poisoned": the new Snake Charmer, for the rest of the game.
    operations.push({ domain: "effect", intents: [{ kind: "apply", target, effect: {
      type: "poisoned", source: context.actor.binding, sourceCharacter: "snakecharmer", lifetime: { kind: "manual" },
    } }] });
    // 4. Tonight's steps: the new Snake Charmer does not choose again; a character whose place tonight has passed does not wake.
    const firstNight = query.game.day === 1;
    const at = canonicalOrder("snakecharmer", firstNight) ?? 0;
    // SV-3b: a Philosopher with the Snake Charmer's ability gives the Demon the Philosopher ("the Demon becomes a poisoned Philosopher"),
    // so the step skipped is that of the character the old Demon is given.
    operations.push({ domain: "nightStep", day: query.game.day, stepKey: participantStepKey(picked.participantId!, mine.id), status: "skipped" });
    if ((canonicalOrder(theirs.id, firstNight) ?? Infinity) < at) {
      operations.push({ domain: "nightStep", day: query.game.day, stepKey: participantStepKey(me.participantId!, theirs.id), status: "skipped" });
    }
    return outcome(operations, true);
  },
};
