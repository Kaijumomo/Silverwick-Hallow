# Phase 7 canonical data audit

Compared against clean HEAD `d0cf48c312c3cb38d7116f2f460249894d04eb87` on September 7, 2026 (local date).

All 172 previously bundled IDs were found in the publisher's [role assets](https://github.com/ThePandemoniumInstitute/botc-release/blob/f10cd02e3401af227ce406287eaae7bb99a06a42/resources/data/roles.json) and checked against the [ordered night sheet](https://github.com/ThePandemoniumInstitute/botc-release/blob/f10cd02e3401af227ce406287eaae7bb99a06a42/resources/data/nightsheet.json). The original script rosters remain unchanged. The raw asset also contains 9 additional records; they were not automatically added to the selectable roster.

## Reading this ledger

These are exact source-field differences, **not 172 separate semantic bugs**. Some previous abilities were reasonable abbreviations; some were incorrect, invented, or stale. Night numbers now come from a single ordered sheet, so a numeric difference alone is not a gameplay discrepancy. Prompt differences include replacing paraphrases with official reminders. Absent first/other-night slots remain absent. Formatting-only reminder markers are translated for display. `team: traveller` is adapted to the existing `type: traveler`; `edition: carousel` is adapted to `experimental`.

Every listed changed field is now sourced from the pinned publisher metadata (or the night-sheet adapter); no old competing prose/order table remains. Fields with exact prior/source matches remain canonical too. Once-per-game eligibility is derived from explicit canonical 'Once per game' ability text, and manually marked use remains authoritative to the assistant.

## Confirmed material examples

| Record | Prior problem | Verified correction |
|---|---|---|
| Pope | Invented unrelated effect | Duplicate good characters, which may also be bluffs |
| Storm Catcher | Incorrect invented effect | Named good character is execution-only if in play; evil learns that player |
| Toymaker | Invented 28-day rule | Demon must skip attacking at least once; normal evil starting information |
| King | Wrong living/dead threshold | Dead equal or outnumber living; Demon learns King |
| Legion | Wrong voting/death interpretation | Executions fail if only evil voted; registers as Minion too |
| Boomdandy | Loudest-player/incorrect execution resolution | 10-to-1 pointing countdown; most-pointed-at player dies |
| Butler | Missing first-night slot | Chooses a master on the first night as well |
| Seamstress | Missing first-night slot | May use the once-per-game ability on the first night |
| Evil introductions | Demon before Minion; unconditional | Minion before Demon, setup-dependent eligibility |
| BMR | Hand-maintained mismatched ordering | Publisher's protection/choices/deaths/resurrection/information sequence |

The source for every role correction above and every row below is the pinned role asset; ordering corrections use the pinned night sheet. Supplementary rule explanations are linked in [PHASE7.md](PHASE7.md).

## Complete field comparison

| Character ID | Previous catalog | Fields replaced/normalized against source |
|---|---|---|
| washerwoman | troubleBrewing | ability, flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders |
| librarian | troubleBrewing | ability, flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders |
| investigator | troubleBrewing | ability, flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders |
| chef | troubleBrewing | flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders |
| empath | troubleBrewing | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| fortuneteller | troubleBrewing | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| undertaker | troubleBrewing | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| monk | troubleBrewing | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| ravenkeeper | troubleBrewing | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| virgin | troubleBrewing | flavor, setup, reminders |
| slayer | troubleBrewing | flavor, setup, reminders |
| soldier | troubleBrewing | flavor, setup, reminders |
| mayor | troubleBrewing | flavor, setup, reminders |
| butler | troubleBrewing | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| drunk | troubleBrewing | flavor, setup, reminders, remindersGlobal, special |
| recluse | troubleBrewing | flavor, setup, reminders |
| saint | troubleBrewing | flavor, setup, reminders |
| poisoner | troubleBrewing | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| spy | troubleBrewing | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders, special |
| scarletwoman | troubleBrewing | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| baron | troubleBrewing | flavor, reminders |
| imp | troubleBrewing | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| clockmaker | sectsAndViolets | flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders |
| dreamer | sectsAndViolets | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| snakecharmer | sectsAndViolets | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| mathematician | sectsAndViolets | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| flowergirl | sectsAndViolets | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| towncrier | sectsAndViolets | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| oracle | sectsAndViolets | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| savant | sectsAndViolets | flavor, setup, reminders |
| seamstress | sectsAndViolets | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| philosopher | sectsAndViolets | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders, remindersGlobal, special |
| artist | sectsAndViolets | flavor, setup, reminders |
| juggler | sectsAndViolets | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| sage | sectsAndViolets | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| mutant | sectsAndViolets | ability, flavor, setup, reminders |
| sweetheart | sectsAndViolets | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| barber | sectsAndViolets | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| klutz | sectsAndViolets | flavor, setup, reminders |
| eviltwin | sectsAndViolets | flavor, firstNight, otherNight, firstNightPrompt, firstNightReminder, setup, reminders |
| witch | sectsAndViolets | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| cerenovus | sectsAndViolets | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| pithag | sectsAndViolets | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| fanggu | sectsAndViolets | flavor, otherNight, otherNightPrompt, otherNightReminder, reminders |
| vigormortis | sectsAndViolets | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, reminders |
| nodashii | sectsAndViolets | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| vortox | sectsAndViolets | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| grandmother | badMoonRising | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| sailor | badMoonRising | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| chambermaid | badMoonRising | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| exorcist | badMoonRising | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| innkeeper | badMoonRising | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| gambler | badMoonRising | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| gossip | badMoonRising | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| courtier | badMoonRising | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| professor | badMoonRising | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| minstrel | badMoonRising | flavor, setup, reminders |
| tealady | badMoonRising | ability, flavor, setup, reminders |
| pacifist | badMoonRising | flavor, setup, reminders |
| fool | badMoonRising | flavor, setup, reminders |
| tinker | badMoonRising | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| moonchild | badMoonRising | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| goon | badMoonRising | flavor, setup, reminders |
| lunatic | badMoonRising | ability, flavor, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| godfather | badMoonRising | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, reminders |
| devilsadvocate | badMoonRising | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| assassin | badMoonRising | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| mastermind | badMoonRising | flavor, setup, reminders |
| zombuul | badMoonRising | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| pukka | badMoonRising | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| shabaloth | badMoonRising | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| po | badMoonRising | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| acrobat | experimental | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| alchemist | experimental | ability, flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders, remindersGlobal, special |
| alsaahir | experimental | name, ability, flavor, setup, reminders |
| amnesiac | experimental | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| atheist | experimental | flavor, setup, reminders, special |
| balloonist | experimental | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, reminders |
| banshee | experimental | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| bountyhunter | experimental | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, reminders |
| cannibal | experimental | ability, flavor, otherNight, setup, reminders |
| choirboy | experimental | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| cultleader | experimental | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| engineer | experimental | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| farmer | experimental | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| fisherman | experimental | flavor, setup, reminders |
| general | experimental | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| highpriestess | experimental | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| huntsman | experimental | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, reminders |
| king | experimental | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| knight | experimental | flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders |
| lycanthrope | experimental | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| magician | experimental | flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders |
| nightwatchman | experimental | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| noble | experimental | flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders |
| pixie | experimental | ability, flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders |
| poppygrower | experimental | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| preacher | experimental | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| princess | experimental | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| steward | experimental | flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders |
| villageidiot | experimental | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders, special |
| damsel | experimental | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| golem | experimental | ability, flavor, setup, reminders |
| hatter | experimental | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| heretic | experimental | flavor, setup, reminders |
| hermit | experimental | ability, flavor, firstNight, setup, reminders |
| ogre | experimental | ability, flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders |
| plaguedoctor | experimental | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| politician | experimental | flavor, setup, reminders |
| puzzlemaster | experimental | ability, flavor, setup, reminders |
| snitch | experimental | ability, flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders |
| zealot | experimental | flavor, setup, reminders |
| boomdandy | experimental | ability, flavor, setup, reminders, special |
| boffin | experimental | ability, flavor, firstNight, otherNight, firstNightPrompt, firstNightReminder, setup, reminders |
| fearmonger | experimental | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| goblin | experimental | ability, flavor, setup, reminders |
| marionette | experimental | ability, flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders, remindersGlobal, special |
| mezepheles | experimental | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| organgrinder | experimental | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders, special |
| psychopath | experimental | ability, flavor, setup, reminders |
| vizier | experimental | ability, flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders |
| widow | experimental | ability, flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders, remindersGlobal, special |
| wizard | experimental | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| wraith | experimental | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders, special |
| xaan | experimental | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, reminders |
| alhadikhia | experimental | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| legion | experimental | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, reminders, special |
| lilmonsta | experimental | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, reminders, remindersGlobal, special |
| lleech | experimental | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| ojo | experimental | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| riot | experimental | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| yaggababble | experimental | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| angel | fabled | edition, flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders |
| buddhist | fabled | edition, ability, flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders |
| doomsayer | fabled | edition, ability, flavor, setup, reminders |
| hellslibrarian | fabled | name, edition, flavor, setup, reminders |
| fiddler | fabled | edition, ability, flavor, setup, reminders, special |
| revolutionary | fabled | edition, ability, flavor, setup, reminders |
| toymaker | fabled | edition, ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| djinn | fabled | edition, flavor, setup, reminders |
| duchess | fabled | edition, ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| fibbin | fabled | edition, ability, flavor, setup, reminders |
| sentinel | fabled | edition, flavor, setup, reminders |
| spiritofivory | fabled | edition, flavor, setup, reminders |
| bigwig | lorics | ability, flavor, firstNightReminder, otherNightReminder, setup, reminders |
| bootlegger | lorics | ability, flavor, setup, reminders |
| gardener | lorics | ability, flavor, setup, reminders, special |
| godofug | lorics | ability, flavor, setup, reminders, special |
| hindu | lorics | ability, flavor, setup, reminders |
| knaves | lorics | ability, flavor, setup, reminders |
| pope | lorics | ability, flavor, setup, reminders, special |
| stormcatcher | lorics | ability, flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders |
| tor | lorics | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| ventriloquist | lorics | ability, flavor, setup, reminders |
| zenomancer | lorics | ability, flavor, setup, reminders |
| scapegoat | travelers | flavor, setup, reminders |
| gunslinger | travelers | ability, flavor, setup, reminders |
| beggar | travelers | ability, flavor, setup, reminders |
| bureaucrat | travelers | flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders, special |
| thief | travelers | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders, special |
| butcher | travelers | flavor, setup, reminders |
| bonecollector | travelers | ability, flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| harlot | travelers | flavor, otherNight, otherNightPrompt, otherNightReminder, setup, reminders |
| barista | travelers | ability, flavor, firstNight, otherNight, firstNightPrompt, otherNightPrompt, firstNightReminder, otherNightReminder, setup, reminders |
| deviant | travelers | flavor, setup, reminders |
| apprentice | travelers | ability, flavor, firstNight, firstNightPrompt, firstNightReminder, setup, reminders, special |
| matron | travelers | flavor, setup, reminders |
| voudon | travelers | ability, flavor, setup, reminders |
| judge | travelers | flavor, setup, reminders |
| bishop | travelers | flavor, setup, reminders |
| gangster | travelers | ability, flavor, setup, reminders |
| gnome | travelers | ability, flavor, setup, reminders |

## Jinxes

The old 22-entry table contained fabricated pair rules. It is replaced by all 131 pairs from the publisher's [pinned jinx asset](https://github.com/ThePandemoniumInstitute/botc-release/blob/f10cd02e3401af227ce406287eaae7bb99a06a42/resources/data/jinxes.json). Existing symmetric lookup APIs remain. Removed invented examples include Poisoner/Fortune Teller, Vortox/Courtier's alleged continuing false information, Imp/Pukka's alleged ban on multiple Demons, and Marionette/Lunatic's alleged co-existence prohibition. Jinxes are references, not automated ability implementations.

