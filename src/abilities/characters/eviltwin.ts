import type { AbilityDescriptor, AbilityEvaluation } from "../semantics";
import { nothing, requireLivingActor } from "./shared";

/**
 * Evil Twin -- GUIDED (SV-4c, Sects & Violets). https://wiki.bloodontheclocktower.com/Evil_Twin (saved revision 2994)
 *
 * "You & an opposing player know each other. If the good player is executed, evil wins. Good can't win if you both live."
 * How to Run: "While setting up the game, choose a Good Twin by marking any good character with the TWIN reminder. During the first night,
 * wake both Twins. Let them make eye contact. Point at the Evil Twin, then show the Evil Twin token to the Good Twin. Point at the Good
 * Twin, then show the Good Twin's character token to the Evil Twin."
 *
 * The Good Twin is chosen on the Prepare row before Night 1 (stores/twinPair.ts: one source-free TWIN Effect naming the Evil Twin; the Red
 * Herring's pattern). The wake is one Night row at the Evil Twin's place: it shows the two reveals (the Evil Twin's character to the Good
 * Twin, the Good Twin's TRUE character to the Evil Twin: PO 2026-11-21) and the step is done once the pair stands. Showing information is
 * presentation only and records nothing. The row is listed again on a later Night only when the pair changed or broke, where the
 * Storyteller chooses the new Good Twin (the TWIN token moves with that choice). Nothing here mutates anything by itself: whether the
 * pair still stands, and whether the ability works, are DERIVED from the two players' characters, alignments and impairment.
 * By hand (Manual): more than one Evil Twin; a Traveller as the Good Twin.
 * Shared rules: docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (matrix Section 7, a Storyteller-fact Effect established at setup like the Fortune
 * Teller's Red Herring; Section 1, the pair is derived and never rewritten).
 */
export const EVIL_TWIN: AbilityDescriptor = {
  roleId: "eviltwin",
  timing: ["firstNight", "otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [],
  hooks: ["information"],
  presentation: { complexity: "complex", action: "Introduce the Twins" },
  // The wake is bookkeeping: the Night card completes the step; a plain resolution (the workspace) records nothing.
  evaluator: (context): AbilityEvaluation => requireLivingActor(context) ?? nothing(),
};
