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
  ["toymaker", "Verified Manual (no wake of its own): the Demon may choose not to attack and must do so at least once per game. Record the skip under Game rule facts when it happens; until then a Demon attack asks for your judgment (Silverwick never decides whether an attack would end the game). Evil players get normal starting information."],
  // Matrix Section 8: the Drunk has no ability of its own.
  ["drunk", "Verified: the Drunk has no ability. Its simulated wake runs through the SHOWN character's verified semantics (e.g. Drunk shown as the Empath records a delivery with performedRole); nothing else is automated."],
]);

/** Precise coverage notes for verified guided / guided-partial semantics and
 * narrow dependencies (presentation only -- never mechanics). */
export const COVERAGE_NOTES: Readonly<Record<RoleId, string>> = {
  empath: "Support semantic (matrix 8 / 18.2) for the Drunk shown as the Empath proof.",
  fortuneteller: "Red Herring is authoritative Effect state; a Fortune Teller first created mid-game without one stays Manual (matrix 7 / 19).",
  cultleader: "GUIDED-PARTIAL: nightly alignment only; the Day cult vote / win stays Manual (matrix 11).",
  pithag: "GUIDED-PARTIAL: ordinary transformation, and (Phase 10G) Demon creation with the game-scoped arbitrary-deaths Rule Fact; the optional Traveller rule and concealed identities stay Manual (matrix 12).",
  imp: "B4: ordinary kills and star-pass, mandatory Scarlet Woman priority and no second attack that Night. Uncertain registration and discretionary death remain manual.",
  scarletwoman: "B4: supported Imp death and star-pass succession, Slayer and execution, using pre-death functioning and five living non-Travellers. No invokable descriptor; exceptional succession remains manual.",
  harlot: "Information Action 'harlot-other-night' is Silverwick-authored with explicit owner authorization (no pinned action existed).",
};

/** Trouble Brewing characters whose behaviour is owned by a dedicated, reviewed
 * module rather than an AbilityDescriptor (docs/ai/TROUBLE_BREWING_B9_ACCEPTANCE.md).
 * Presentation only -- never mechanics, never read by any gate: "unclassified"
 * means "no descriptor", not "handled by hand". Every id here is also in
 * REVIEWED_INTERACTION_ROLES (asserted in abilityArchitecture.test.ts). */
export const OWNED_ELSEWHERE: Readonly<Record<RoleId, string>> = {
  washerwoman: "Owned by prepared information (src/stores/preparedInformation.ts): the Storyteller chooses the clue, the app validates it against actual roles and registration, places the linked reminders and delivers once. Impaired content is the Storyteller's free choice; no clue is suggested.",
  librarian: "Owned by prepared information (src/stores/preparedInformation.ts): Outsider clue or an explicit zero, validated against the actual roster (Drunk, Baron) with Spy/Recluse registration as the Storyteller's choice. Impaired content is the Storyteller's free choice.",
  investigator: "Owned by prepared information (src/stores/preparedInformation.ts): Minion clue validated against actual roles with Spy/Recluse registration as the Storyteller's choice; one validated delivery. Impaired content is the Storyteller's free choice.",
  butler: "Owned by Master selection (src/stores/butlerSelection.ts): other-player choice, exact reminder ownership, expiry and source retirement. Voting compliance is player-owned and deliberately not enforced.",
  virgin: "Owned by Voting (src/stores/voting.ts): first legal nomination consumes the ability once; the execution outcome stays an approved Storyteller confirmation.",
  soldier: "Owned by passive protection (src/abilities/characters/passiveRules.ts): a functioning Soldier blocks Demon harm in the supported envelope; poisoning disables it.",
  mayor: "Owned by victory evidence (src/stores/victoryEvidence.ts) for the no-execution Day-end win; attack redirection stays Storyteller-controlled.",
  saint: "Owned by victory evidence (src/stores/victoryEvidence.ts): a functioning Saint's execution; the Storyteller declares the result.",
  recluse: "Owned by the rules query (src/stores/rulesQuery.ts, passiveRules.ts): optional evil/Minion/Demon registration, decided by the Storyteller per interaction.",
  spy: "Owned by the rules query and night order (src/stores/rulesQuery.ts, src/rules/night/nightOrder.ts): optional registration per interaction; the Spy views the existing Storyteller Grimoire directly.",
  scarletwoman: "Owned by succession (src/abilities/characters/scarletWoman.ts) and recorded deaths (src/stores/deathResolution.ts).",
};
