import type { RoleId } from "@/stores/types";

/**
 * Coverage LEVEL and EVIDENCE (Stage 5A-1, planning/MILESTONE_PLAN_v3_PROPOSAL.md).
 *
 * This file is bookkeeping, never mechanics: nothing here is read by any gate,
 * evaluator, picker or screen, and it grants no action authority. It records what
 * the repository ACTUALLY does for a character today, so the coverage list stops
 * being read as "unclassified = handled by hand".
 *
 * Levels describe what is BUILT, not what has been certified:
 *  - guided:   a registered ability descriptor exists (the app proposes, the
 *              Storyteller confirms). Some are guided-partial; read the note.
 *  - reviewed: on REVIEWED_INTERACTION_ROLES, no descriptor. Having this character
 *              in play does NOT push other automation to Manual; its own ability
 *              is resolved by the Storyteller. This is the SHAPE of plan Level A,
 *              not a certificate: rules text against the saved official wiki page
 *              and "every official token can be placed" are still unchecked
 *              (plan 5A-2 and 5A-3), and the ten Stage 4 characters were checked
 *              against the pinned publisher data and wiki summaries, not verbatim
 *              wiki pages.
 *  - partial:  not on the reviewed list, but at least one support piece exists
 *              (a setup rule or warning, a night-list slot or advisory, a gate, a
 *              voting or ending hook). With such a character in play the whole
 *              action falls back to Manual. Fabled and Loric are not seated, so
 *              they never trip that gate; they are gated per hook scope instead.
 *  - generic:  nothing beyond the generic night slot, reference text, reminder
 *              tokens and Storyteller tools.
 *
 * Evidence is kept honest by tests (coverageLevels.test.ts): every path exists,
 * and every hand-written entry names its character in the cited file.
 */
export type CoverageLevel = "guided" | "reviewed" | "partial" | "generic";

export type CoverageEvidence = {
  kind: "code" | "test";
  /** Repository-relative path. */
  path: string;
  /** What this file shows, in one sentence. For a test: it names or loops over the character; it is not a claim that every behaviour is proven. */
  what: string;
};

type Piece = { path: string; what: string };

/** Support pieces for characters without a descriptor. Each entry was read in the cited file. */
export const PARTIAL_SUPPORT: Readonly<Record<RoleId, readonly Piece[]>> = {
  alchemist: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/setup/setupPolicies.ts", what: "Marked as an uncertain composition: random setup and composition checks fall back to manual review." },
    { path: "src/rules/night/nightOrder.ts", what: "Flagged as a complex ability in the night list: the Storyteller resolves it by hand." },
  ],
  amnesiac: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/setup/setupPolicies.ts", what: "Marked as an uncertain composition: random setup and composition checks fall back to manual review." },
    { path: "src/rules/night/nightOrder.ts", what: "Flagged as a complex ability in the night list: the Storyteller resolves it by hand." },
  ],
  angel: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "Setup shows the ability as an information note only." },
  ],
  apprentice: [
    { path: "src/rules/night/nightOrder.ts", what: "Flagged as a complex ability in the night list: the Storyteller resolves it by hand." },
  ],
  atheist: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/setup/setupPolicies.ts", what: "Marked as an uncertain composition: random setup and composition checks fall back to manual review." },
    { path: "src/stores/travelers.ts", what: "Counted as complex when a Traveller's Demon information is prepared: no automatic candidate is offered." },
  ],
  balloonist: [
    { path: "src/rules/setup/setupPolicies.ts", what: "Setup count policy: the Outsider count may shift by the listed amounts (single-effect only)." },
  ],
  banshee: [
    { path: "src/rules/night/nightOrder.ts", what: "Death-check wake slot: the night list shows this character after a death night with a 'check the death condition' advisory; historical triggers are not tracked." },
  ],
  barber: [
    { path: "src/rules/night/nightOrder.ts", what: "Death-check wake slot: the night list shows this character after a death night with a 'check the death condition' advisory; historical triggers are not tracked." },
  ],
  bigwig: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "Setup shows the ability as an information note only." },
  ],
  boffin: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/setup/setupPolicies.ts", what: "Marked as an uncertain composition: random setup and composition checks fall back to manual review." },
    { path: "src/rules/night/nightOrder.ts", what: "Flagged as a complex ability in the night list: the Storyteller resolves it by hand." },
  ],
  bootlegger: [
    { path: "src/rules/setup/setupPolicies.ts", what: "Marked as an uncertain composition: random setup and composition checks fall back to manual review." },
  ],
  bountyhunter: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
  ],
  buddhist: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "Setup shows the ability as an information note only." },
  ],
  cannibal: [
    { path: "src/rules/night/nightOrder.ts", what: "Flagged as a complex ability in the night list: the Storyteller resolves it by hand." },
  ],
  choirboy: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "Setup warns when the paired character (Huntsman with Damsel, Choirboy with King) is missing from the roster." },
    { path: "src/rules/night/nightOrder.ts", what: "Death-check wake slot: the night list shows this character after a death night with a 'check the death condition' advisory; historical triggers are not tracked." },
  ],
  damsel: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "Setup warns when the paired character (Huntsman with Damsel, Choirboy with King) is missing from the roster." },
  ],
  drunk: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
  ],
  eviltwin: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
  ],
  fanggu: [
    { path: "src/rules/setup/setupPolicies.ts", what: "Setup count policy: the Outsider count may shift by the listed amounts (single-effect only)." },
  ],
  farmer: [
    { path: "src/rules/night/nightOrder.ts", what: "Death-check wake slot: the night list shows this character after a death night with a 'check the death condition' advisory; historical triggers are not tracked." },
  ],
  fool: [
    { path: "src/abilities/characters/passiveRules.ts", what: "Death-target gap: when an attack targets a functioning one, the app does not model it and the whole action goes manual." },
  ],
  fortuneteller: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
  ],
  gardener: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "Setup note: use manual assignment for deliberate placement; random dealing does not enforce it." },
  ],
  gnome: [
    { path: "src/stores/travelers.ts", what: "Traveller arrival check: public starting information is resolved in person." },
  ],
  godofug: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "Setup shows the ability as an information note only." },
  ],
  goon: [
    { path: "src/features/grimoire-v6/day/moonchild.ts", what: "Moonchild's pick of a Goon is treated as an unknown alignment and sent to the Storyteller." },
  ],
  gossip: [
    { path: "src/rules/night/nightOrder.ts", what: "Death-check wake slot: the night list shows this character after a death night with a 'check the death condition' advisory; historical triggers are not tracked." },
  ],
  grandmother: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/night/nightOrder.ts", what: "Death-check wake slot: the night list shows this character after a death night with a 'check the death condition' advisory; historical triggers are not tracked." },
  ],
  hatter: [
    { path: "src/rules/night/nightOrder.ts", what: "Death-check wake slot: the night list shows this character after a death night with a 'check the death condition' advisory; historical triggers are not tracked." },
  ],
  hellslibrarian: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "Setup shows the ability as an information note only." },
  ],
  hermit: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/setup/setupPolicies.ts", what: "Marked as an uncertain composition: random setup and composition checks fall back to manual review." },
  ],
  huntsman: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/setup/setupAnalyzer.ts", what: "Setup warns when the paired character (Huntsman with Damsel, Choirboy with King) is missing from the roster." },
    { path: "src/rules/setup/setupPolicies.ts", what: "Marked as an uncertain composition: random setup and composition checks fall back to manual review." },
  ],
  kazali: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/setup/setupPolicies.ts", what: "Marked as an uncertain composition: random setup and composition checks fall back to manual review." },
  ],
  king: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/setup/setupAnalyzer.ts", what: "Setup warns when the paired character (Huntsman with Damsel, Choirboy with King) is missing from the roster." },
    { path: "src/rules/night/nightOrder.ts", what: "First-night administration step in the night list (Storyteller procedure text)." },
  ],
  legion: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/setup/setupAnalyzer.ts", what: "Setup allows duplicate copies (analyzer allowance)." },
    { path: "src/rules/setup/setupPolicies.ts", what: "Marked as an uncertain composition: random setup and composition checks fall back to manual review." },
    { path: "src/stores/travelers.ts", what: "Counted as complex when a Traveller's Demon information is prepared: no automatic candidate is offered." },
  ],
  lilmonsta: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/setup/setupPolicies.ts", what: "Marked as an uncertain composition: random setup and composition checks fall back to manual review." },
    { path: "src/stores/travelers.ts", what: "Counted as complex when a Traveller's Demon information is prepared: no automatic candidate is offered." },
  ],
  lleech: [
    { path: "src/abilities/characters/passiveRules.ts", what: "Death-target gap: when an attack targets a functioning one, the app does not model it and the whole action goes manual." },
  ],
  lordoftyphon: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/setup/setupPolicies.ts", what: "Marked as an uncertain composition: random setup and composition checks fall back to manual review." },
  ],
  lunatic: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/night/nightOrder.ts", what: "Simulated Demon introduction and 'inform the real Demon' steps in the night list." },
  ],
  magician: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/night/nightOrder.ts", what: "First-night administration step in the night list (Storyteller procedure text)." },
    { path: "src/stores/travelers.ts", what: "Counted as complex when a Traveller's Demon information is prepared: no automatic candidate is offered." },
  ],
  marionette: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
  ],
  mastermind: [
    { path: "src/stores/endGameEligibility.ts", what: "Game-end advisory: Demon dead but Mastermind alive, check before ending." },
  ],
  pacifist: [
    { path: "src/features/grimoire-v6/day/nomination.tsx", what: "The execution prompt reminds the Storyteller that the Pacifist may apply (nomination and voting screens)." },
    { path: "src/features/voting/VotingWorkspace.tsx", what: "The voting workspace repeats the Pacifist reminder." },
  ],
  philosopher: [
    { path: "src/rules/night/nightOrder.ts", what: "Flagged as a complex ability in the night list: the Storyteller resolves it by hand." },
  ],
  plaguedoctor: [
    { path: "src/rules/night/nightOrder.ts", what: "Death-check wake slot: the night list shows this character after a death night with a 'check the death condition' advisory; historical triggers are not tracked." },
  ],
  pope: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "Setup note: duplicate good characters are allowed; actual alignment is not modelled." },
  ],
  poppygrower: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/night/nightOrder.ts", what: "First-night administration step in the night list (Storyteller procedure text)." },
    { path: "src/stores/travelers.ts", what: "Counted as complex when a Traveller's Demon information is prepared: no automatic candidate is offered." },
  ],
  puzzlemaster: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
  ],
  sage: [
    { path: "src/rules/night/nightOrder.ts", what: "Death-check wake slot: the night list shows this character after a death night with a 'check the death condition' advisory; historical triggers are not tracked." },
  ],
  sailor: [
    { path: "src/abilities/characters/passiveRules.ts", what: "Death-target gap: when an attack targets a functioning one, the app does not model it and the whole action goes manual." },
  ],
  scarletwoman: [
    { path: "src/stores/endGameEligibility.ts", what: "Game-end advisory: Demon dead but Scarlet Woman alive." },
  ],
  sentinel: [
    { path: "src/rules/setup/setupPolicies.ts", what: "Setup count policy: the Outsider count may shift by the listed amounts (single-effect only)." },
  ],
  snitch: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/night/nightOrder.ts", what: "First-night administration step in the night list (Storyteller procedure text)." },
  ],
  summoner: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/setup/setupPolicies.ts", what: "Marked as an uncertain composition: random setup and composition checks fall back to manual review." },
  ],
  sweetheart: [
    { path: "src/rules/night/nightOrder.ts", what: "Death-check wake slot: the night list shows this character after a death night with a 'check the death condition' advisory; historical triggers are not tracked." },
  ],
  tealady: [
    { path: "src/abilities/characters/passiveRules.ts", what: "External-protection gap: with a Tea Lady in play, Demon protection is not modelled and the whole action goes manual." },
  ],
  tinker: [
    { path: "src/rules/night/nightOrder.ts", what: "Death-check wake slot: the night list shows this character after a death night with a 'check the death condition' advisory; historical triggers are not tracked." },
  ],
  tor: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "Setup note: review shown identities before syncing." },
    { path: "src/rules/night/nightOrder.ts", what: "Night step warns that identity concealment is NOT automated." },
  ],
  ventriloquist: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "Setup shows the ability as an information note only." },
  ],
  villageidiot: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "Setup allows up to three copies and asks the Storyteller to choose the drunk extra by hand." },
  ],
  xaan: [
    { path: "src/rules/setup/setupAnalyzer.ts", what: "In the setup analyzer's manual-review list: setup shows a 'Review character setup' check and the Storyteller resolves the special choices by hand." },
    { path: "src/rules/setup/setupPolicies.ts", what: "Marked as an uncertain composition: random setup and composition checks fall back to manual review." },
  ],
  zombuul: [
    { path: "src/rules/night/nightOrder.ts", what: "Wakes after a death night (night list); the app does not track whether it has already used its ability." },
    { path: "src/abilities/characters/passiveRules.ts", what: "Death-target gap: when an attack targets a functioning one, the app does not model it and the whole action goes manual." },
    { path: "src/stores/travelers.ts", what: "Counted as complex when a Traveller's Demon information is prepared: no automatic candidate is offered." },
  ],
};

/** Game-ending allow-list in src/stores/victoryEvidence.ts (supportedRoles).
 * Mirrored here only to state it as evidence; a test compares it with the source. */
export const ENDING_EVIDENCE_ROLES: readonly RoleId[] = [
  "washerwoman", "librarian", "investigator", "chef", "empath", "fortuneteller", "undertaker", "monk", "ravenkeeper", "virgin", "slayer", "soldier", "mayor",
  "butler", "drunk", "recluse", "saint", "poisoner", "spy", "scarletwoman", "baron", "imp", "bureaucrat", "thief", "gunslinger", "scapegoat", "beggar",
];

/** Test files for guided and reviewed characters (the two most-referenced, or the loop that reviews them). */
export const TEST_EVIDENCE: Readonly<Record<RoleId, readonly string[]>> = {
  alhadikhia: ["src/abilities/characters/alhadikhia.test.ts", "src/abilities/characters/astraReverification.test.ts"],
  artist: ["src/abilities/characters/informationCharacterReview.test.ts"],
  baron: ["src/features/grimoire-v6/night/nightGuide.port.test.tsx", "src/features/setup/setupRefinementCommands.test.ts"],
  butler: ["src/stores/butlerSelection.test.ts", "src/stores/b7IndependentButler.test.ts"],
  chambermaid: ["src/abilities/characters/informationCharacterReview.test.ts"],
  chef: ["src/stores/roleResolution.test.ts", "src/stores/projections.test.ts"],
  clockmaker: ["src/abilities/characters/informationCharacterReview.test.ts"],
  cultleader: ["src/abilities/characters/cultleader.test.ts", "src/abilities/abilityArchitecture.test.ts"],
  dreamer: ["src/abilities/characters/informationCharacterReview.test.ts"],
  drunk: ["src/features/setup/troubleBrewingB3BaronDrunk.test.ts", "src/stores/effectLifecycle.test.ts"],
  empath: ["src/abilities/characters/informationCharacterReview.test.ts", "src/stores/roleResolution.test.ts"],
  flowergirl: ["src/abilities/characters/informationCharacterReview.test.ts"],
  fortuneteller: ["src/abilities/characters/fortuneteller.test.ts", "src/abilities/characters/troubleBrewingB5aCommands.test.ts"],
  gambler: ["src/abilities/characters/gambler.test.ts", "src/features/grimoire-v6/night/nightGuide.port.test.tsx"],
  godfather: ["src/abilities/characters/godfatherMoonchild.test.ts", "src/rules/setup/randomSetup.test.ts"],
  golem: ["src/stores/publicScript.test.ts", "src/features/grimoire-v6/day/day.test.tsx"],
  harlot: ["src/abilities/characters/harlot.test.ts", "src/abilities/characters/astraRemediation.test.ts"],
  imp: ["src/features/grimoire-v6/night/nightGuide.port.test.tsx", "src/stores/projections.test.ts"],
  innkeeper: ["src/abilities/characters/innkeeper.test.ts", "src/features/nightOrder/nightWork.test.ts"],
  investigator: ["src/features/setup/postR3ReclusePreparation.test.tsx", "src/stores/b6Independent.test.ts"],
  juggler: ["src/abilities/characters/informationCharacterReview.test.ts"],
  librarian: ["src/stores/roleResolution.test.ts", "src/stores/b6Independent.test.ts"],
  marionette: ["src/stores/projections.test.ts", "src/features/grimoire-v6/setup/prepareConcealed.test.tsx"],
  mathematician: ["src/abilities/characters/informationCharacterReview.test.ts"],
  mayor: ["src/stores/b8Independent.test.ts", "src/stores/victoryEvidence.test.ts"],
  monk: ["src/stores/abilityResolution.test.ts", "src/features/grimoire-v6/night/nightGuide.port.test.tsx"],
  moonchild: ["src/abilities/characters/godfatherMoonchild.test.ts", "src/features/grimoire-v6/night/nightGuide.port.test.tsx"],
  mutant: ["src/abilities/characters/informationCharacterReview.test.ts"],
  nodashii: ["src/abilities/characters/nodashii.test.ts", "src/rules/night/canonicalNightOrder.test.ts"],
  oracle: ["src/abilities/characters/townCrierOraclePro.test.ts", "src/rules/night/canonicalNightOrder.test.ts"],
  pithag: ["src/abilities/characters/astraReverification.test.ts", "src/abilities/characters/pithag.test.ts"],
  poisoner: ["src/features/grimoire-v6/night/nightGuide.port.test.tsx", "src/abilities/characters/poisoner.test.ts"],
  professor: ["src/abilities/characters/townCrierOraclePro.test.ts", "src/abilities/characters/concealedSameAsPoisoned.test.ts"],
  ravenkeeper: ["src/stores/troubleBrewingB5bIndependent.test.ts", "src/abilities/characters/troubleBrewingB5b.test.ts"],
  recluse: ["src/abilities/characters/troubleBrewingB1.independent.test.ts", "src/features/grimoire-v6/night/nightGuide.port.test.tsx"],
  saint: ["src/stores/roleResolution.test.ts", "src/stores/projections.test.ts"],
  savant: ["src/abilities/characters/informationCharacterReview.test.ts"],
  scarletwoman: ["src/stores/troubleBrewingB4Death.test.ts", "src/stores/troubleBrewingB4Independent.test.ts"],
  seamstress: ["src/abilities/characters/informationCharacterReview.test.ts"],
  shabaloth: ["src/abilities/characters/shabaloth.test.ts", "src/features/grimoire-v6/night/regurgitate.test.ts"],
  slayer: ["src/abilities/characters/pithag.test.ts", "src/stores/abilityResolution.test.ts"],
  soldier: ["src/features/grimoire-v6/night/port/troubleBrewingB5aUi.v6.test.tsx", "src/stores/b8Independent.test.ts"],
  spy: ["src/abilities/characters/troubleBrewingB1.independent.test.ts", "src/abilities/characters/contextualRegistration.test.ts"],
  towncrier: ["src/abilities/characters/townCrierOraclePro.test.ts", "src/rules/night/canonicalNightOrder.test.ts"],
  undertaker: ["src/stores/troubleBrewingB5bIndependent.test.ts", "src/stores/b9WholeGames.test.ts"],
  vigormortis: ["src/abilities/characters/vigormortis.test.ts", "src/rules/setup/setupAnalyzer.test.ts"],
  virgin: ["src/features/info/infoModel.test.ts", "src/stores/b7Virgin.test.ts"],
  vortox: ["src/abilities/characters/phase10gConsumers.test.ts", "src/abilities/characters/characterIntelligence.test.ts"],
  washerwoman: ["src/rules/setup/setupAnalyzer.test.ts", "src/stores/projections.test.ts"],
  witch: ["src/abilities/characters/witch.test.ts", "src/rules/night/nightOrder.test.ts"],
};

/** Caveats read from code or from the Stage 4 review (src/abilities/characters/classification.ts REVIEWED_MANUAL notes). */
export const COVERAGE_CAVEATS: Readonly<Record<RoleId, readonly string[]>> = {
  juggler: ["Official wiki: wakes once. The night list shows the row every later night; the Storyteller skips it."],
  mutant: ["Official wiki: the Storyteller may execute a madness-breaking Mutant at any time, even at night. The app records executions only in Day and does not block a second daytime execution."],
};

/** Applies to every Fabled and Loric: game-ending automation is forced to Manual when one is in play. */
export const MODIFIER_ENDING_CAVEAT = "Any Fabled or Loric in play forces a manual game ending (src/stores/victoryEvidence.ts).";
