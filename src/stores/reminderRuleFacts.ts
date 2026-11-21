import { FANG_GU_ONCE } from "./gameRuleFactRegistry";
import type { GameRuleFactType } from "./types";

/**
 * SV-2c (PO decision 2026-11-21, a first narrow use of the approved "reminders become effects" direction): the official
 * reminder tokens whose hand placement RECORDS a Game Rule Fact. Placing one from the token list applies the fact in the
 * same commit as the reminder (one Undo); removing one by hand clears the fact unless another token of the same kind is
 * still on the board.
 *
 * This is a command-layer mapping only: it is keyed by the palette entry (source character + label) the Storyteller
 * picked. Mechanics never read Reminders -- they read the fact, which stays the one authoritative record.
 */
const REMINDER_RULE_FACTS: readonly { sourceCharacter: string; label: string; type: GameRuleFactType }[] = [
  // The Fang Gu's ONCE: "If the Fang Gu chooses an Outsider (once only), they become an evil Fang Gu instead".
  { sourceCharacter: "fanggu", label: "Once", type: FANG_GU_ONCE },
];

/** The Game Rule Fact a hand-placed official token records, if any. */
export function ruleFactForReminder(sourceCharacter: string | undefined, label: string): GameRuleFactType | undefined {
  if (!sourceCharacter) return undefined;
  return REMINDER_RULE_FACTS.find((entry) => entry.sourceCharacter === sourceCharacter && entry.label === label)?.type;
}
