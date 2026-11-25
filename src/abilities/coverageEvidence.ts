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
  thief: [
    { path: "src/features/grimoire-v6/night/t30Verbs.ts", what: "The night guide shows a one-line prompt for its night choice (wording only; no ability logic)." },
  ],
  bonecollector: [
    { path: "src/features/grimoire-v6/night/t30Verbs.ts", what: "The night guide shows a one-line prompt for its night choice (wording only; no ability logic)." },
  ],
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
  assassin: [
    { path: "src/abilities/characters/passiveRules.ts", what: "Death gate cause 'assassin' (LS-2a): it goes around every prevention row and Effect and around the Fool, so the gate is ready for the Assassin. The Assassin's own ability (once per game, NO ABILITY) is not built." },
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
  farmer: [
    { path: "src/rules/night/nightOrder.ts", what: "Death-check wake slot: the night list shows this character after a death night with a 'check the death condition' advisory; historical triggers are not tracked." },
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
    { path: "src/abilities/characters/passiveRules.ts", what: "Life-rules Storyteller-choice row (LS-2d): BM-1a: the execution prompt on the nomination, voting and seat-menu screens asks only when a Pacifist could matter (alive, certainly working, executed player certainly good or unknown); the Storyteller decides, the gate never does. A drunk or poisoned Pacifist, or an evil executed player, never sees the question." },
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
    { path: "src/abilities/characters/passiveRules.ts", what: "BM-2a: a life-rules row: the first death of a sober and healthy Zombuul only registers (a Storyteller-only hidden life on the player); the Assassin kills it for real." },
    { path: "src/stores/victoryEvidence.ts", what: "BM-2a: on the game-ending allow-list: every ending read uses its true life (the hidden life counts as alive; its real death is proved on the Day)." },
    { path: "src/stores/travelers.ts", what: "Counted as complex when a Traveller's Demon information is prepared: no automatic candidate is offered." },
  ],
};

/** Game-ending allow-list in src/stores/victoryEvidence.ts (supportedRoles).
 * Mirrored here only to state it as evidence; a test compares it with the source. */
export const ENDING_EVIDENCE_ROLES: readonly RoleId[] = [
  "washerwoman", "librarian", "investigator", "chef", "empath", "fortuneteller", "undertaker", "monk", "ravenkeeper", "virgin", "slayer", "soldier", "mayor",
  "butler", "drunk", "recluse", "saint", "poisoner", "spy", "scarletwoman", "baron", "imp", "bureaucrat", "thief", "gunslinger", "scapegoat", "beggar", "cerenovus", "eviltwin",
  "clockmaker", "dreamer", "snakecharmer", "mathematician", "flowergirl", "towncrier", "oracle", "savant", "seamstress", "philosopher", "artist", "juggler", "sage",
  "mutant", "sweetheart", "barber", "klutz", "witch", "pithag", "fanggu", "vigormortis", "nodashii", "vortox",
  "zombuul",
];

/** Test files for guided and reviewed characters (the two most-referenced, or the loop that reviews them). */
export const TEST_EVIDENCE: Readonly<Record<RoleId, readonly string[]>> = {
  alhadikhia: ["src/abilities/characters/alhadikhia.test.ts", "src/abilities/characters/astraReverification.test.ts"],
  artist: ["src/abilities/characters/informationCharacterReview.test.ts", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  baron: ["src/features/grimoire-v6/night/nightGuide.port.test.tsx", "src/features/setup/setupRefinementCommands.test.ts"],
  barber: ["src/abilities/characters/barber.test.ts", "src/features/grimoire-v6/night/port/barberUi.v6.test.tsx", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  butler: ["src/stores/butlerSelection.test.ts", "src/stores/b7IndependentButler.test.ts"],
  chambermaid: ["src/abilities/characters/informationCharacterReview.test.ts"],
  chef: ["src/stores/roleResolution.test.ts", "src/stores/projections.test.ts"],
  clockmaker: ["src/abilities/characters/clockmaker.test.ts", "src/features/grimoire-v6/night/port/clockmakerUi.v6.test.tsx", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  cultleader: ["src/abilities/characters/cultleader.test.ts", "src/abilities/abilityArchitecture.test.ts"],
  devilsadvocate: ["src/abilities/characters/devilsAdvocate.test.ts"],
  dreamer: ["src/abilities/characters/dreamer.test.ts", "src/features/grimoire-v6/night/port/dreamerUi.v6.test.tsx", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  drunk: ["src/features/setup/troubleBrewingB3BaronDrunk.test.ts", "src/stores/effectLifecycle.test.ts"],
  empath: ["src/abilities/characters/informationCharacterReview.test.ts", "src/stores/roleResolution.test.ts"],
  fanggu: ["src/abilities/characters/fanggu.test.ts", "src/features/grimoire-v6/night/port/fangGuUi.v6.test.tsx", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  flowergirl: ["src/abilities/characters/flowergirl.test.ts", "src/features/grimoire-v6/night/port/flowergirlUi.v6.test.tsx", "src/features/grimoire-v6/board/marksFlowergirl.test.tsx", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  fortuneteller: ["src/abilities/characters/fortuneteller.test.ts", "src/abilities/characters/troubleBrewingB5aCommands.test.ts"],
  gambler: ["src/abilities/characters/gambler.test.ts", "src/features/grimoire-v6/night/nightGuide.port.test.tsx"],
  godfather: ["src/abilities/characters/godfatherMoonchild.test.ts", "src/rules/setup/randomSetup.test.ts"],
  golem: ["src/stores/publicScript.test.ts", "src/features/grimoire-v6/day/day.test.tsx"],
  harlot: ["src/abilities/characters/harlot.test.ts", "src/abilities/characters/astraRemediation.test.ts"],
  imp: ["src/features/grimoire-v6/night/nightGuide.port.test.tsx", "src/stores/projections.test.ts"],
  fool: ["src/abilities/characters/lifeRules.test.ts"],
  tealady: ["src/abilities/characters/teaLady.test.ts", "src/abilities/characters/troubleBrewingB2Interactions.test.ts"],
  innkeeper: ["src/abilities/characters/innkeeper.test.ts", "src/features/nightOrder/nightWork.test.ts"],
  investigator: ["src/features/setup/postR3ReclusePreparation.test.tsx", "src/stores/b6Independent.test.ts"],
  juggler: ["src/abilities/characters/juggler.test.ts", "src/features/grimoire-v6/day/jugglerDay.test.tsx", "src/features/grimoire-v6/night/port/jugglerUi.v6.test.tsx", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  klutz: ["src/abilities/characters/klutz.test.ts", "src/features/grimoire-v6/day/klutzDay.test.tsx", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  librarian: ["src/stores/roleResolution.test.ts", "src/stores/b6Independent.test.ts"],
  marionette: ["src/stores/projections.test.ts", "src/features/grimoire-v6/setup/prepareConcealed.test.tsx"],
  mathematician: ["src/abilities/characters/mathematician.test.ts", "src/abilities/abnormalInformation.test.ts", "src/stores/abnormalMarks.test.ts", "src/features/grimoire-v6/night/port/mathematicianUi.v6.test.tsx", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  mayor: ["src/stores/b8Independent.test.ts", "src/stores/victoryEvidence.test.ts"],
  monk: ["src/stores/abilityResolution.test.ts", "src/features/grimoire-v6/night/nightGuide.port.test.tsx"],
  moonchild: ["src/abilities/characters/godfatherMoonchild.test.ts", "src/features/grimoire-v6/night/nightGuide.port.test.tsx"],
  sailor: ["src/abilities/characters/sailor.test.ts", "src/abilities/characters/lifeRulesTable.test.ts"],
  exorcist: ["src/abilities/characters/exorcist.test.ts"],
  pacifist: ["src/abilities/characters/bm1Pacifist.test.ts", "src/abilities/characters/lifeRulesTable.test.ts"],
  zombuul: ["src/abilities/characters/zombuul.test.ts", "src/stores/zombuulLife.test.ts", "src/abilities/characters/lifeRulesGateLs2.test.ts"],
  mutant: ["src/abilities/characters/informationCharacterReview.test.ts", "src/features/grimoire-v6/day/madnessExecution.test.tsx", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  nodashii: ["src/abilities/characters/nodashii.test.ts", "src/rules/night/canonicalNightOrder.test.ts", "src/stores/sectsAndVioletsWholeGames.test.ts", "src/abilities/characters/sectsAndVioletsSv6GapPairs.test.ts"],
  oracle: ["src/abilities/characters/townCrierOraclePro.test.ts", "src/rules/night/canonicalNightOrder.test.ts", "src/stores/sectsAndVioletsWholeGames.test.ts", "src/abilities/characters/sectsAndVioletsSv6GapPairs.test.ts"],
  pithag: ["src/abilities/characters/astraReverification.test.ts", "src/abilities/characters/pithag.test.ts", "src/stores/sectsAndVioletsWholeGames.test.ts", "src/abilities/characters/sectsAndVioletsSv6GapPairs.test.ts"],
  poisoner: ["src/features/grimoire-v6/night/nightGuide.port.test.tsx", "src/abilities/characters/poisoner.test.ts"],
  professor: ["src/abilities/characters/townCrierOraclePro.test.ts", "src/abilities/characters/concealedSameAsPoisoned.test.ts"],
  ravenkeeper: ["src/stores/troubleBrewingB5bIndependent.test.ts", "src/abilities/characters/troubleBrewingB5b.test.ts"],
  recluse: ["src/abilities/characters/troubleBrewingB1.independent.test.ts", "src/features/grimoire-v6/night/nightGuide.port.test.tsx"],
  cerenovus: ["src/abilities/characters/cerenovus.test.ts", "src/features/grimoire-v6/night/port/cerenovusUi.v6.test.tsx", "src/features/grimoire-v6/day/madnessExecution.test.tsx", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  eviltwin: ["src/abilities/characters/eviltwin.test.ts", "src/features/grimoire-v6/night/port/eviltwinUi.v6.test.tsx", "src/stores/eviltwinEnding.test.ts", "src/abilities/characters/sectsAndVioletsSv4Pairs.test.ts", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  philosopher: ["src/abilities/characters/philosopher.test.ts", "src/abilities/characters/philosopherGained.test.ts", "src/abilities/characters/sectsAndVioletsSv3Pairs.test.ts", "src/features/grimoire-v6/night/port/philosopherUi.v6.test.tsx", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  sage: ["src/abilities/characters/sage.test.ts", "src/features/grimoire-v6/night/port/sageUi.v6.test.tsx", "src/abilities/characters/vortoxFalseCharacters.test.ts", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  snakecharmer: ["src/abilities/characters/snakecharmer.test.ts", "src/features/grimoire-v6/night/port/snakeCharmerUi.v6.test.tsx", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  saint: ["src/stores/roleResolution.test.ts", "src/stores/projections.test.ts"],
  savant: ["src/abilities/characters/informationCharacterReview.test.ts", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  scarletwoman: ["src/stores/troubleBrewingB4Death.test.ts", "src/stores/troubleBrewingB4Independent.test.ts"],
  seamstress: ["src/abilities/characters/seamstress.test.ts", "src/features/grimoire-v6/night/port/seamstressUi.v6.test.tsx", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  shabaloth: ["src/abilities/characters/shabaloth.test.ts", "src/features/grimoire-v6/night/regurgitate.test.ts"],
  slayer: ["src/abilities/characters/pithag.test.ts", "src/stores/abilityResolution.test.ts"],
  soldier: ["src/features/grimoire-v6/night/port/troubleBrewingB5aUi.v6.test.tsx", "src/stores/b8Independent.test.ts"],
  spy: ["src/abilities/characters/troubleBrewingB1.independent.test.ts", "src/abilities/characters/contextualRegistration.test.ts"],
  sweetheart: ["src/abilities/characters/sweetheart.test.ts", "src/features/grimoire-v6/day/sweetheartDay.test.tsx", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  towncrier: ["src/abilities/characters/townCrierOraclePro.test.ts", "src/rules/night/canonicalNightOrder.test.ts", "src/stores/sectsAndVioletsWholeGames.test.ts", "src/abilities/characters/sectsAndVioletsSv6GapPairs.test.ts"],
  undertaker: ["src/stores/troubleBrewingB5bIndependent.test.ts", "src/stores/b9WholeGames.test.ts"],
  vigormortis: ["src/abilities/characters/vigormortis.test.ts", "src/rules/setup/setupAnalyzer.test.ts", "src/stores/sectsAndVioletsWholeGames.test.ts", "src/abilities/characters/sectsAndVioletsSv6GapPairs.test.ts"],
  virgin: ["src/features/info/infoModel.test.ts", "src/stores/b7Virgin.test.ts"],
  vortox: ["src/abilities/characters/phase10gConsumers.test.ts", "src/abilities/characters/characterIntelligence.test.ts", "src/abilities/falseInformation.test.ts", "src/abilities/characters/vortoxFalseAnswers.test.ts", "src/stores/vortoxNoExecution.test.ts", "src/features/grimoire-v6/night/port/vortoxEndLine.v6.test.tsx", "src/abilities/characters/vortoxKill.test.ts", "src/features/grimoire-v6/night/port/vortoxKillUi.v6.test.tsx", "src/stores/sectsAndVioletsWholeGames.test.ts"],
  washerwoman: ["src/rules/setup/setupAnalyzer.test.ts", "src/stores/projections.test.ts"],
  witch: ["src/abilities/characters/witch.test.ts", "src/rules/night/nightOrder.test.ts", "src/stores/sectsAndVioletsWholeGames.test.ts", "src/abilities/characters/sectsAndVioletsSv6GapPairs.test.ts"],
};

/** Caveats read from code or from the Stage 4 review (src/abilities/characters/classification.ts REVIEWED_MANUAL notes). */
export const COVERAGE_CAVEATS: Readonly<Record<RoleId, readonly string[]>> = {
  fool: ["LS-1: the death gate applies the Fool's survival to Demon and ability kills and to a recorded execution (the Storyteller still records the outcome). A Witch curse, a Golem nomination (its \"survives\" button spends only the Golem) and a Pacifist in play still send the question to the Storyteller. Al-Hadikhia, the Harlot and the Slayer stay Manual when a Fool would be spent."],
  tealady: ["LS-2b: Spy and Recluse neighbours use the Storyteller's setup decision (Prepare the town), and the decision can be set or changed only during setup; a Spy or Recluse with no decision (a later neighbour, or a character created mid-game) sends the question to the Storyteller. Exile is not modelled: the exile flow stays the Storyteller's. The CANNOT DIE tokens are still drawn while the Tea Lady is drunk or poisoned (PO ruling); the app does not honour them then."],
  juggler: ["Official wiki: wakes once, on the night after the first Day as the Juggler (Night 2 from the deal, or the night after a change). A game saved before character timing existed shows the row every later night; the Storyteller skips it.",
    "SV-5f: on the first Day as the Juggler, the Day card's optional row records each guess at once (tap the player, pick the character; repeats allowed, a sixth refused, Undo corrects), judged when made against the character they register as; a Spy or Recluse who might register as it is one Yes / No ruling. The official CORRECT token is drawn from the correct guesses (hidden in Privacy Mode, never projected). Done closes the guesses (zero allowed). That night the Night card shows the count if the Juggler is sober and healthy; drunk or poisoned: the Storyteller chooses; a Vortox: any number but the true one; Done not recorded: the Storyteller's number (by hand under a Vortox). A functioning Juggler's Next removes the guesses (one Undo restores them); otherwise they expire at dawn. By hand: the Cannibal jinx, a Juggler gained by a Philosopher."],
  philosopher: ["SV-3a: the choice, the derived DRUNK on whoever truly holds the chosen character, and the IS THE PHILOSOPHER token swap on the Storyteller's board are guided. The gained ability wakes at the gained character's place; a gained Snake Charmer, Town Crier or Oracle runs exactly as the real character's step (SV-3b), every other gained ability is run by the Storyteller by hand. A drunk or poisoned Philosopher (or a Drunk shown the Philosopher) spends the ability and gains nothing; what such a player is later woken for is the Storyteller's. Choosing the Philosopher, or a character that is not a verified official one, goes by hand."],
  eviltwin: ["SV-4c: the Good Twin is chosen on the Prepare row before Night 1 (a TWIN reminder drawn from one source-free Effect); the first-night row shows the two reveals; the pair, its validity and whether the Evil Twin's ability works are derived, never stored. A Pit-Hag-made Evil Twin or a broken pair is re-chosen on the Night row. SV-4d: while both Twins live and the Evil Twin functions no ending proposes \"good wins\", and the Good Twin's execution raises an advisory line on the End control; the app never records a winner. A Traveller as a Twin, and more than one Evil Twin, are by hand."],
  cerenovus: ["SV-4a: the choice (a player, then a Townsfolk or an Outsider), the MAD Effect with the character on it, the reveal row and the official MAD token are guided. Whether the mad player tried is always the Storyteller's: the app never executes anyone by itself. SV-4b: the mad player's seat menu offers Execute while the MAD applies (a Day execution through the ordinary command; at night an ordinary death). A drunk or poisoned Cerenovus makes the choice and nobody goes mad. MAD applies only while the Cerenovus functions (a Vigormortis-kept one still does). SV-4d: the Cerenovus is on the game-ending list, so a mad Saint's execution is captured like any Saint's."],
  mathematician: ["SV-5g: the count of players holding an ABNORMAL mark (the Mathematician himself left out) is shown on the Night card every night for a finger signal, and his commit clears every mark (one Undo restores them), except while another living player also holds the ability (a Philosopher who gained it, or a second Mathematician made by a Pit-Hag or a Barber): then the marks stay until dawn, so each count is the same. The app marks by itself only the Vortox's false information and drunk or poisoned information its truth proves false (PO Q17 A); the Storyteller marks everything else by hand with the official ABNORMAL token, which records the mark (PO Q7 A). Marks last until dawn, so one made after he woke is never counted. Drunk or poisoned: the Storyteller chooses the number; a Vortox: any number but the true count. By hand: the Chambermaid, Drunk, Marionette and Lunatic jinxes, failed protections, registrations, a Philosopher-gained Mathematician."],
  clockmaker: ["SV-5a: the steps from the Demon to its nearest Minion are counted round the seating ring (the dead and Travellers are seats; an evil Traveller is not a Minion) and shown on the Night card for a finger signal. A Spy who is the only Minion is counted as that Minion (a count with no Minion has no answer to give). A Spy or Recluse in play otherwise offers only the numbers their registrations allow (a Recluse that may register as a second Demon adds its own count). Drunk or poisoned: the Storyteller chooses. A Vortox (SV-5i): the Storyteller chooses any number of steps but the certainly true one. By hand: more than one Demon, no Minion to count, a registration only the Storyteller can rule, a Clockmaker made after the first night or gained by a Philosopher."],
  seamstress: ["SV-5b: each night until used: Not Tonight closes the step and keeps the ability; two players tapped on the board (never herself; the dead and Travellers allowed) give YES or NO from their alignments as they register to her, in one commit with the use and the official NO ABILITY token. Only YES or NO is shown. A Spy or Recluse who could change the answer is one Yes / No ruling. Drunk or poisoned: pointing still uses the ability and the Storyteller chooses. A Vortox (SV-5i): the opposite answer, the Spy / Recluse ruling kept. By hand: a registration only the Storyteller can rule, a Seamstress gained by a Philosopher."],
  dreamer: ["SV-5c: the chosen player is tapped on the board (never the Dreamer or a Traveller; the dead allowed); the true token is the character they register as (a Drunk shows the Drunk, a Marionette the Marionette, a Philosopher the Philosopher); the Storyteller picks the false token from the other team on the script (tokens only), one commit. The two tokens are shown good first and evil second on one player-safe screen. Drunk or poisoned Dreamer, a Drunk shown the Dreamer, or a healthy Spy or Recluse chosen: the Storyteller picks both tokens. A Vortox (SV-5j): the Storyteller picks both tokens and neither may be the character the player registers as (a healthy Spy or Recluse: any pair). By hand: a registration only the Storyteller can rule, a Dreamer gained by a Philosopher."],
  flowergirl: ["SV-5d: each night but the first, YES or NO is read from the Day's voting record (PO Q3, never stored): a recorded YES in a nomination, not an exile, by a player who was a Demon when they voted (a dead Demon's ghost vote and either of two Demons count; a hand raised in a vote still open counts at once). Next records it; Undo takes it back. The official DEMON VOTED / DEMON NOT VOTED tokens are drawn from the same record on a living Flowergirl. One Yes / No question when no Demon certainly voted and a voter may have been one (a Recluse, a character changed since the vote, such as a Demon who moved to another player, or a YES in an abandoned vote); then no token is drawn. A game started before character changes were recorded asks this question for every YES, and draws no token. Drunk or poisoned: the Storyteller chooses. A Vortox (SV-5i): the opposite answer (the tokens still follow the record). By hand: an incomplete voting record, a Flowergirl gained by a Philosopher."],
  mutant: ["Official wiki: the Storyteller may execute a madness-breaking Mutant at any time, even at night. SV-4b: the seat menu's Execute does it (a Day execution through the ordinary command, with the additional-execution question). The app records executions only in Day, so at night Execute is an ordinary death that leaves the Day's execution free. The app still never decides that the Mutant broke madness."],
};

/** Why a "partial" character is partial, where the reason is NOT "a general support piece". Plain statements, no UI. */
export const PARTIAL_CAVEATS: Readonly<Record<RoleId, string>> = {
  lleech: "Partial because the app REFUSES to automate: an attack on a functioning Lleech sends the whole action to Manual (death-target gap). No Lleech ability is modelled.",
  thief: "Partial for two narrow reasons only: it is on the game-ending allow-list and the night guide shows a one-line prompt. Its own ability (negative vote) is not supported.",
  gunslinger: "Partial for one narrow reason only: it is on the game-ending allow-list. Its own ability is not supported.",
  scapegoat: "Partial for one narrow reason only: it is on the game-ending allow-list. Its own ability is not supported.",
  beggar: "Partial for one narrow reason only: it is on the game-ending allow-list. Its own ability is not supported.",
  bonecollector: "Partial for one narrow reason only: the night guide shows a one-line prompt. Its ability (a dead player regains their ability) is not supported.",
  goon: "Partial for one narrow reason only: Moonchild's pick of a Goon is sent to the Storyteller. The Goon's own ability is not supported.",
  bureaucrat: "The voting engine implements the three-votes modifier and an action card, so more is built than 'partial' suggests, but it is not on the reviewed-interaction list: in play, other automation still goes Manual.",
};

/** Applies to every character without a place on the game-ending allow-list (src/stores/victoryEvidence.ts). */
export const NOT_ON_ENDING_LIST_CAVEAT = "Not on the game-ending allow-list: a game with this character seated gets a Manual ending (victoryCoverageEligibility).";

/** Applies to every Fabled and Loric: game-ending automation is forced to Manual when one is in play. */
export const MODIFIER_ENDING_CAVEAT = "Any Fabled or Loric in play forces a manual game ending (src/stores/victoryEvidence.ts).";
