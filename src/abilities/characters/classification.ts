import type { RoleId } from "@/stores/types";

/**
 * Phase 10F Slice 7: VERIFIED-MANUAL classifications
 * (docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md Section 2) -- the official rules
 * are understood, but the correct 10F product representation is Manual /
 * reference only. These are NOT ability descriptors: nothing here is ever
 * invokable or evaluated. They are resolved only through the canonical
 * ownership gate (resolveAbilitySemantics), so a homebrew reuse of the id
 * inherits nothing -- not even the reference text.
 */
export const VERIFIED_MANUAL: ReadonlyMap<RoleId, string> = new Map([
  // Matrix Section 14.
  ["tinker", "Verified Manual: Storyteller discretion IS the Tinker's mechanic -- they might die at any time. Record it with Resolve manually / unmodeled interaction -> Death. A protected Tinker cannot die from this ability: check protection yourself (the Manual path does not). Never random; avoid a game-ending Tinker death (official guidance)."],
  // Matrix Section 16 (Fabled -- no participant; its hook is in modifierHooks.ts).
  ["toymaker", "Verified Manual (10G dependency): the Demon may choose not to attack and must do so at least once per game. Silverwick does not hold the skip history, so a Demon attack asks for your judgment. Evil players get normal starting information."],
  // Matrix Section 8: the Drunk has no ability of its own.
  ["drunk", "Verified: the Drunk has no ability. Its simulated wake runs through the SHOWN character's verified semantics (e.g. Drunk shown as the Empath records a delivery with performedRole); nothing else is automated."],
]);

/** Precise coverage notes for verified guided / guided-partial semantics and
 * narrow dependencies (presentation only -- never mechanics). */
export const COVERAGE_NOTES: Readonly<Record<RoleId, string>> = {
  empath: "Support semantic (matrix 8 / 18.2) for the Drunk shown as the Empath proof.",
  fortuneteller: "Red Herring is authoritative Effect state; a Fortune Teller first created mid-game without one stays Manual (matrix 7 / 19).",
  cultleader: "GUIDED-PARTIAL: nightly alignment only; the Day cult vote / win stays Manual (matrix 11).",
  pithag: "GUIDED-PARTIAL: ordinary transformation only; Demon creation (arbitrary deaths, 10G) and the optional Traveller rule stay Manual (matrix 12).",
  imp: "Includes the narrow Scarlet Woman star-pass priority (matrix 6 / 18.1).",
  scarletwoman: "Only the Imp star-pass priority dependency is verified (matrix 18.1); full coverage is Phase 11A.",
  harlot: "Information Action 'harlot-other-night' is Silverwick-authored with explicit owner authorization (no pinned action existed).",
};
