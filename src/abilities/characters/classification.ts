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
  fool: "Owned by the death gate (src/abilities/characters/passiveRules.ts, rulesQuery.deathOutcome): the first death a functioning Fool would suffer does not happen and the ability is spent (NO ABILITY); other protection is checked first and spends nothing. A drunk or poisoned Fool dies. The Storyteller still records executions and can override.",
  tealady: "Owned by the death gate (src/abilities/characters/passiveRules.ts): while both of a sober, healthy, living Tea Lady's alive neighbours register as good to her, neither can die from any cause but the Assassin. A Spy or Recluse neighbour uses the Storyteller's setup decision (Prepare the town); with none, the Storyteller is asked. The official CANNOT DIE tokens are drawn from the same rule (src/features/grimoire-v6/board/marks.ts).",
  mayor: "Owned by victory evidence (src/stores/victoryEvidence.ts) for the no-execution Day-end win; attack redirection stays Storyteller-controlled.",
  saint: "Owned by victory evidence (src/stores/victoryEvidence.ts): a functioning Saint's execution; the Storyteller declares the result.",
  recluse: "Owned by the rules query (src/stores/rulesQuery.ts, passiveRules.ts): optional evil/Minion/Demon registration, decided by the Storyteller per interaction.",
  spy: "Owned by the rules query and night order (src/stores/rulesQuery.ts, src/rules/night/nightOrder.ts): optional registration per interaction; the Spy views the existing Storyteller Grimoire directly.",
  scarletwoman: "Owned by succession (src/abilities/characters/scarletWoman.ts) and recorded deaths (src/stores/deathResolution.ts).",
};

/** Information-only characters whose cross-character interactions were reviewed
 * against the official rules and the pinned publisher data, so they sit in
 * REVIEWED_INTERACTION_ROLES and no longer push other automation to Manual.
 * Their own ability stays Storyteller-resolved (there is no descriptor and no
 * evaluator). Presentation only -- never mechanics, never read by any gate. */
export const REVIEWED_MANUAL: Readonly<Record<RoleId, string>> = {
  clockmaker: "Reviewed: reads the Demon and nearest Minion seating and changes nothing. The number stays the Storyteller's (Spy/Recluse registration and the Summoner jinx are judgments).",
  dreamer: "Reviewed: the Storyteller shows 1 good and 1 evil character, one of them the chosen player's. Changes nothing; impaired content is the Storyteller's choice.",
  mathematician: "Reviewed: counts abnormal abilities since dawn and changes nothing. The Abnormal reminders are Storyteller notation; the Chambermaid, Drunk, Marionette and Lunatic jinxes stay Storyteller judgments.",
  flowergirl: "Reviewed: reads whether a Demon voted today and changes nothing. Demon Voted / Demon Not Voted are Storyteller notation; the Storyteller answers with a nod or a shake of the head.",
  savant: "Reviewed: day information (one true, one false) given in private by the Storyteller. Changes nothing; it has no night wake.",
  seamstress: "Reviewed: once per game, compares two players' alignment and changes nothing. No Ability is Storyteller notation after use.",
  artist: "Reviewed: once per game, a private yes/no question answered by the Storyteller. Changes nothing; it has no night wake. No Ability is Storyteller notation after use.",
  juggler: "Reviewed: counts correct day-one guesses and changes nothing. The Correct reminders are Storyteller notation; the Cannibal jinx stays a Storyteller judgment.",
  mutant: "Reviewed: an Outsider with no information or effect on others. The official rules let the Storyteller execute a Mutant who breaks madness at any time, even at night or outside a nomination. A daytime one goes through the ordinary execution record, which the Undertaker reads like any other execution, and uses that day's one execution (the Storyteller keeps count; the app does not block a second). The app records executions only in the Day phase, so a night-time one is recorded as an ordinary death.",
  chambermaid: "Reviewed: counts who woke tonight because of their ability and changes nothing. The Mathematician jinx stays a Storyteller judgment.",
};
