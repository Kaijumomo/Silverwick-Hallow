# Sects & Violets SV-5 part 4: pair record for the Mastermind

> **History.** The Mastermind's pairs (a Bad Moon Rising character) stay in this record; the 300 pairs of the Sects & Violets script are in [SECTS_AND_VIOLETS_PAIRS.md](SECTS_AND_VIOLETS_PAIRS.md) (SV-6a).

Built on branch `claude/project-thread-x4i9rg` from main `2a0a9de`. In the style of the earlier pair records: each pair is **test** (a focused scenario names both, or the shared rule is tested with one of them), **code read** (the shared query or command was read, no dedicated scenario), or **Storyteller judgment**.

Scope: the Mastermind against every Sects & Violets character (25 rows) and the Trouble Brewing and Bad Moon Rising characters that touch its rule. The rules come from the saved Mastermind page ("If the Demon dies by execution (ending the game), play for 1 more day. If a player is then executed, their team loses.", its How to Run and its four jinxes) and the PO's answers of 2026-11-23: Q13 B (the End control's line plus "Day N · Mastermind's final day" in the Day card heading), Q14 A (the result shows when the final Day's execution is recorded; "nobody executed" waits for dusk), Q15 A (a Demon's death at night is a ruling line).

Facts that carry many rows:

- **The trigger is a captured fact tied to the execution.** `mastermindFinalDay` (or `mastermindFinalDayRuling`) is recorded only inside the accepted Day execution of the last living Demon that died, with the Mastermind as its source and the execution's Life Event id as its cause. A retraction or amendment of that execution, or a correction bringing the Demon back, removes it in the same commit while that Day's record is held; Undo restores the earlier game. Once recorded it stands (a Mastermind who dies or becomes drunk later does not cancel the final day); a character correction showing the executed player was not the Demon removes it, and a living Demon during the extra day (a Pit-Hag's, or a later correction) turns the lines into a ruling and drops the heading. On the final Day the good-win results carry the Evil Twin's block.
- **It lasts from the execution through the final Day and the Night after it** (a new registered lifetime: recorded Day N, expires entering Day N+2).
- **Lines only.** The End control and the End dialog's "Possible game end" box carry the Mastermind's line; nothing ends the game, nothing is preselected, nothing is shown to players (the Demon gets its shroud as for any death). Hidden in Privacy Mode.
- **No stored-format change.** Two new registered capture-only fact types and one lifetime rule; no schema version, Firebase Rules or migration change.

| # | Pair | Assessment | What the app does | Evidence |
| --- | --- | --- | --- | --- |
| 001 | Mastermind / Clockmaker | code read | No interaction: the Clockmaker learns on the first Night only, long before any trigger. | — |
| 002 | Mastermind / Dreamer | code read | No interaction (information only). | — |
| 003 | Mastermind / Snake Charmer | code read (roles set by hand in the test) | A swap before the execution: whoever is the Demon when executed counts, and the Mastermind is whoever holds that character then. | [sectsAndVioletsSv5dPairs.test.ts](../../src/abilities/characters/sectsAndVioletsSv5dPairs.test.ts) |
| 004 | Mastermind / Mathematician | code read | No interaction (information only). | — |
| 005 | Mastermind / Flowergirl | code read | No interaction (information only). | — |
| 006 | Mastermind / Town Crier | code read | No interaction (information only). | — |
| 007 | Mastermind / Oracle | code read | No interaction; the executed Demon is a dead evil player for the Oracle's count, as for any death. | — |
| 008 | Mastermind / Savant | code read | No interaction (information only). | — |
| 009 | Mastermind / Seamstress | code read | No interaction (information only). | — |
| 010 | Mastermind / Philosopher | code read | A Philosopher can gain only a good character, never the Mastermind. Gaining a Townsfolk changes nothing here. | — |
| 011 | Mastermind / Artist | code read | No interaction (information only). | — |
| 012 | Mastermind / Juggler | code read | No interaction (information only). | — |
| 013 | Mastermind / Sage | code read | No interaction: the Sage's step only follows a Demon kill. | — |
| 014 | Mastermind / Mutant | test | A Mutant executed on the final Day is a good player executed: evil wins. A Mutant "executed" at night is recorded as a death, so a night Demon death is a ruling line, never a trigger (Q15 A). | [sectsAndVioletsSv5dPairs.test.ts](../../src/abilities/characters/sectsAndVioletsSv5dPairs.test.ts) |
| 015 | Mastermind / Sweetheart | test | The Sweetheart's drunkenness, if it falls on the Mastermind, is read at the execution like any drunkenness: a drunk Mastermind does not trigger. | [mastermindTrigger.test.ts](../../src/stores/mastermindTrigger.test.ts) |
| 016 | Mastermind / Barber | code read (roles set by hand in the test) | A swap before the execution: whoever holds the Demon and the Mastermind at that moment count. | [sectsAndVioletsSv5dPairs.test.ts](../../src/abilities/characters/sectsAndVioletsSv5dPairs.test.ts) |
| 017 | Mastermind / Klutz | test | Each keeps its own line on the final Day; the Klutz's line does not change the Mastermind's. | [sectsAndVioletsSv5dPairs.test.ts](../../src/abilities/characters/sectsAndVioletsSv5dPairs.test.ts) |
| 018 | Mastermind / Evil Twin | test | Both Twins alive and the Evil Twin working: good cannot win, so the Demon's execution does not end the game and nothing triggers. The pair in doubt (no Good Twin chosen, an Evil Twin whose sobriety is a judgment): the ruling fact. The Good Twin already dead: it triggers. | [mastermindTrigger.test.ts](../../src/stores/mastermindTrigger.test.ts)<br>[sectsAndVioletsSv5dPairs.test.ts](../../src/abilities/characters/sectsAndVioletsSv5dPairs.test.ts) |
| 019 | Mastermind / Witch | test | A cursed player dying on nominating is a death, not an execution: on the final Day nothing is decided by it; at dusk with nobody executed, good wins. | [sectsAndVioletsSv5dPairs.test.ts](../../src/abilities/characters/sectsAndVioletsSv5dPairs.test.ts) |
| 020 | Mastermind / Cerenovus | code read | A mad player executed on the final Day counts by their real team, as any execution. | — |
| 021 | Mastermind / Pit-Hag | test | A Demon made on the Night before the final Day: while it lives the line is "A Demon is alive again during the Mastermind's extra day. Your ruling" (no heading); once it is executed, an evil player was executed: good wins. No second trigger is recorded while a final day runs. | [sectsAndVioletsSv5dPairs.test.ts](../../src/abilities/characters/sectsAndVioletsSv5dPairs.test.ts) |
| 022 | Mastermind / Fang Gu | test | Any Demon type triggers it when executed. The jump is a night death of the old Fang Gu: never a trigger. | [mastermindTrigger.test.ts](../../src/stores/mastermindTrigger.test.ts)<br>[sectsAndVioletsSv5dPairs.test.ts](../../src/abilities/characters/sectsAndVioletsSv5dPairs.test.ts) |
| 023 | Mastermind / Vigormortis | test | Executed: triggers. The jinx ("A Mastermind that has their ability keeps it if the Vigormortis dies"): a dead Mastermind the Vigormortis let keep its ability gives the ruling fact. | [mastermindTrigger.test.ts](../../src/stores/mastermindTrigger.test.ts) |
| 024 | Mastermind / No Dashii | test | Executed: triggers. Its poison on a neighbouring Mastermind is read at the execution: poisoned means no trigger. | [mastermindTrigger.test.ts](../../src/stores/mastermindTrigger.test.ts) |
| 025 | Mastermind / Vortox | test | Executed: triggers. A dead Vortox records no dusk fact, so its no-execution line does not appear. | [mastermindTrigger.test.ts](../../src/stores/mastermindTrigger.test.ts) |
| 026 | Mastermind / Imp | test | Executed: triggers. Killed by the Slayer's shot or at night: no trigger (a night death is a ruling line). | [mastermindTrigger.test.ts](../../src/stores/mastermindTrigger.test.ts)<br>[mastermindFinalDay.test.tsx](../../src/stores/mastermindFinalDay.test.tsx) |
| 027 | Mastermind / Scarlet Woman | test | Five or more alive and she works: she becomes the Demon, nothing triggers. Four alive, or she is drunk or poisoned: it triggers. Her ability in doubt: the ruling fact. The app checks her itself, because the shared succession rule goes manual whenever the (unreviewed) Mastermind is seated. | [mastermindTrigger.test.ts](../../src/stores/mastermindTrigger.test.ts) |
| 028 | Mastermind / Poisoner, Drunk | test | A drunk or poisoned Mastermind at the execution: no trigger, and the old "Check before ending the game" line stays. Poison that ended before the execution: it triggers. | [mastermindTrigger.test.ts](../../src/stores/mastermindTrigger.test.ts) |
| 029 | Mastermind / Recluse, Spy | test | Executed on the final Day: may register either way, so the Storyteller's ruling. A drunk Recluse registers as good: evil wins. | [mastermindFinalDay.test.tsx](../../src/stores/mastermindFinalDay.test.tsx) |
| 030 | Mastermind / Saint, Mayor | code read | A Mastermind in play keeps the game-ending list manual (it is a Bad Moon Rising character, not reviewed), so no Saint or Mayor proposal is made; the final-day fact also withholds every ordinary proposal (SV-5q). | [sectsAndVioletsEndings.test.ts](../../src/stores/sectsAndVioletsEndings.test.ts) |
| 031 | Mastermind / Zombuul | test | Its first execution only "appears" to kill: the ruling fact. | [mastermindTrigger.test.ts](../../src/stores/mastermindTrigger.test.ts) |
| 032 | Mastermind / Alchemist | test | The jinx ("An Alchemist-Mastermind has no Mastermind ability & the Mastermind is not-in-play"): an Alchemist in play gives the ruling fact. | [mastermindTrigger.test.ts](../../src/stores/mastermindTrigger.test.ts) |
| 033 | Mastermind / Al-Hadikhia, Lleech | test | Their jinxes change what happens: the ruling fact. | [mastermindTrigger.test.ts](../../src/stores/mastermindTrigger.test.ts) |
