# Phase 7 — canonical rules and Night Assistant

## Status

Implemented with **Option B**, uncommitted for review. Starting tree was clean at
HEAD **d0cf48c312c3cb38d7116f2f460249894d04eb87**. No commit, push, production deployment,
dependency upgrade, or Firebase authorization change is part of this phase.

Verification (final runs):

| Check | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Normal Vitest suite | 420 | 0 | 0 |
| Firebase RTDB emulator suite | 57 | 0 | 0 |

Production build: passed. Git diff whitespace check: passed.
The normal suite includes six literal complete-script golden procedure tests,
canonical provenance/data tests, rendered React interaction tests, and previous
projection, deception, lifecycle and Privacy Mode regressions. The emulator uses
the existing demo project and Java 17 installation; it does not contact production.
Existing React test act warnings and Firebase's future Java-21 notice are nonfatal.
No real-device play session is claimed by these automated results.

## Sources and verified corrections

All 172 existing bundled characters (TB, S&V, BMR, experimental, Travelers,
Fabled and Lorics) now use the publisher's role metadata. Existing roster membership
and stable IDs are retained. The complete field-by-field ledger is
[PHASE7-DATA-AUDIT.md](PHASE7-DATA-AUDIT.md).

Primary sources, pinned at revision f10cd02e3401af227ce406287eaae7bb99a06a42:

- [Publisher role definitions](https://github.com/ThePandemoniumInstitute/botc-release/blob/f10cd02e3401af227ce406287eaae7bb99a06a42/resources/data/roles.json):
  verified name, team, edition, exact ability meaning, setup, reminders, flavor and special metadata.
- [Publisher night sheet](https://github.com/ThePandemoniumInstitute/botc-release/blob/f10cd02e3401af227ce406287eaae7bb99a06a42/resources/data/nightsheet.json):
  authoritative relative order, including global information positions.
- [Publisher jinxes](https://github.com/ThePandemoniumInstitute/botc-release/blob/f10cd02e3401af227ce406287eaae7bb99a06a42/resources/data/jinxes.json):
  replaced invented pair rules, preserving the existing reference lookup interface.
- [Butler](https://wiki.bloodontheclocktower.com/Butler) and
  [Seamstress](https://wiki.bloodontheclocktower.com/Seamstress):
  both have first-night procedures.
- [Toymaker](https://wiki.bloodontheclocktower.com/Toymaker):
  ordinary starting evil information even below seven players; required skipped attack.
- [Poppy Grower](https://wiki.bloodontheclocktower.com/Poppy_Grower):
  team suppression, continued Demon bluffs, death/impairment distinctions and relevant jinx checks.
- [Pope](https://wiki.bloodontheclocktower.com/Pope) and
  [Storm Catcher](https://wiki.bloodontheclocktower.com/Storm_Catcher):
  corrected Loric meanings, also captured in the pinned role asset.

Confirmed material corrections: Pope duplicates/bluff exception; Storm Catcher's
named good character and execution-only protection; Toymaker's actual ability
instead of an invented duration; King's equal-or-more dead threshold and Demon
knowledge; Legion's evil-only-vote execution failure; Boomdandy's ten-to-one pointing
countdown; missing Butler/Seamstress first-night handling; global Minion-before-Demon
ordering; BMR ordering; conditional evil introductions; invented jinx entries.

The ledger distinguishes source synchronization/paraphrase differences from material
rules errors. It does not falsely count every changed number or wording as a separate bug.
83 prior ability texts differed from source; 172 IDs matched source. Source metadata
also fills previously missing reminder, setup, flavor and special fields.

## Architecture decision

| Option | Assessment |
|---|---|
| A — patch inline tables | Low migration cost but retains duplicated prose/numbers, drifting global constants and repeated maintenance across scripts. Weakest regression protection. |
| B — canonical assets + focused procedure generator | One source of role/night/jinx truth, explicit eligibility helpers, existing UI/store/sync integration. Handles all base scripts and supported modifiers without a rules DSL or state migration. Best balance. |
| C — full structured rules-layer rebuild | Could represent histories and acquired abilities, but requires larger state migration/testing and risks the protected multiplayer/deception model. Unnecessary for a manual Storyteller aid in this phase. |

Removed: seven inline hand-maintained character tables, the invented inline jinx
table, independent fixed introduction-order constants, unconditional first-night
introductions and old tests asserting those mistakes.

Introduced: three pinned publisher JSON assets; a small RoleDef adapter and verified
provenance check; centralized evil-information eligibility; conditional Storyteller
procedure metadata; six literal golden procedures; a minimal custom-note step using
existing nightProgress records.

Not introduced: a general rules engine, new Firebase writer/path, private-message
protocol, role-state migration, or a second canonical numeric-order dataset.
RoleDef numeric positions are derived from the ordered sheet for compatibility with
current consumers/custom definitions. Zero means no wake; invalid numbers or
instructionless actions yield manual checks rather than confident instructions.
New custom imports reject negative/nonfinite order. Existing stored games are not
reset by stricter numeric validation. Different custom roles sharing timing get a
manual-order warning; duplicates of the same role remain seat ordered.

## Generated full-script procedures

These are coverage inventories with every character from the named script, not legal
game bags. Ordinary games include only relevant occupied players. Conditional
procedures still require their printed event conditions. BMR's Lunatic is explicitly
shown Po in these fixtures. Dusk/day transitions and day-only abilities are outside
the character-procedure list.

### Trouble Brewing — first night

Minion information → Demon information → Poisoner → Washerwoman → Librarian →
Investigator → Chef → Empath → Fortune Teller → Butler → Spy.

### Trouble Brewing — other nights

Poisoner → Monk → Scarlet Woman → Imp → Ravenkeeper (death condition) →
Empath → Fortune Teller → Undertaker → Butler → Spy.

### Sects & Violets — first night

Philosopher → Minion information → Demon information → Snake Charmer →
Evil Twin → Witch → Cerenovus → Clockmaker → Dreamer → Seamstress → Mathematician.

### Sects & Violets — other nights

Philosopher → Snake Charmer → Witch → Cerenovus → Pit-Hag → Fang Gu → No Dashii →
Vortox → Vigormortis → Barber → Sweetheart → Sage → Dreamer → Flowergirl →
Town Crier → Oracle → Seamstress → Juggler → Mathematician.

### Bad Moon Rising — first night

Minion information → Lunatic's simulated introduction → Demon information →
Sailor → Courtier → Godfather → Devil's Advocate → Pukka → Grandmother → Chambermaid.

### Bad Moon Rising — other nights

Sailor → Courtier → Innkeeper → Gambler → Devil's Advocate → Lunatic simulates Po →
privately relay Lunatic choices to real Demon → Exorcist → Zombuul → Pukka →
Shabaloth → Po → Assassin → Godfather → Gossip → Professor → Tinker → Moonchild →
Grandmother → Chambermaid.

Protection, choice, death, resurrection and information positions come from the
publisher sheet, not relative numbers copied from the old app. Lunatic's procedure
uses the shown Demon's instructions but happens before the real Demon so its
choices can be communicated. This does not give it a Demon ability.

## Global information and modifiers

- Count occupied non-Traveler players, including dead players in the game's count;
  empty seats and Travelers do not turn a five/six-player game into seven.
- At 5/6: do not insert normal Minion/Demon introductions or automatic starting-bluff
  tasks. Show the small-game rule; character-specific exceptions remain separate.
- At 7+: Minion introduction precedes Demon introduction. Recipients are real,
  living, non-simulated evil players with configured perception. No invented
  actual-role fallback is used to determine what a player sees.
- Toymaker restores starting information at smaller counts, subject to other
  suppression. Its first-night check points to later eligible information steps
  rather than duplicating delivery. Later-night Demon procedures warn to verify
  skipped-attack history and forbid a game-ending attack when the required skip
  has not happened. This history is not automated.
- Poppy Grower suppresses normal team introductions, **not** eligible Demon bluffs.
  Its own card is a Storyteller procedure, not a wake of the Poppy Grower.
  A dead or impaired Poppy Grower is not interpreted as permission to introduce
  everyone: death timing, ability at death, and jinxes need manual confirmation.
  On later nights the conditional check does not itself publish anything.
- Magician is included in the perceived team indications, not woken as a recipient.
  Resolve impairment and special interactions manually.
- King, Marionette and Snitch informational procedures are about those actual
  characters; they are not incorrectly modeled as waking that character to receive
  its own secret. Their reminders explicitly require suppression/impairment/jinx checks.
- Legion, Lil' Monsta and Atheist setups do not get assumed ordinary introductions.
  They get a manual evil-information check. No authoritative team composition is
  manufactured or sent.
- Active Fabled/Lorics use their canonical reminder or setup reference, with manual
  selections/conditions. Storm Catcher's announcement and evil information are a
  manual procedure. Pope permits in-play good-character bluffs in the normal Demon
  picker, with appropriate copy.
- Tor suppresses ordinary introductions/bluffs even with Toymaker and prominently
  warns that identity concealment/death-triggered revealing are **not automated**.
  Bootlegger rules also require manual review rather than assumed normal introductions.
- New/gained/changed roles and untracked historical events have a persistent manual
  caveat. Storytellers can add a custom step with private notes and complete/skip it.
  It appends to the sheet, persists/remounts via existing nightProgress, and resets
  with that night's progress; arbitrary drag-reordering is not implemented.

## Deception, delivery, privacy and reliability

Already fixed before Phase 7: no actual-role fallback, explicit shown identity,
neutral unconfigured identity, correct general simulated wake identity, role-specific
private-information applicability, on-demand preview and deliberate acknowledged
sending. These concepts are retained, not reimplemented.

- Drunk: shown-role procedure and optional manually selected information; no Demon
  setup fields or mechanical shown ability.
- Marionette: shown good-role simulated procedure; excluded from ordinary Minion
  recipients. Actual Marionette knowledge for the real Demon is a separate ST-only
  reminder, including in a small game.
- Lunatic: configured pretend Demon information beside its own introduction;
  shown-Demon procedure before real Demon; separate in-person target-relay reminder.
  Fake Minions/bluffs remain intentional selections, never actual-team inference.
- Ordinary Demon: existing collapsed bluff-send workflow beside eligible introduction.
  No duplicate generic packet UI or recurring unchanged-bluff task.
- On-demand player preview, serialized send capture/revalidation, server acknowledgement,
  current/last-sent state, reconnect and retry remain intact. Finishing/skipping a night
  step never sends information.
- For exceptional/manual setups, existing drawer sending remains available with a
  contextual Storyteller-check warning. A deliberate send is an explicit manual
  override, not proof that normal starting-information rules apply.
- Dead ordinary players and spent once-per-game abilities do not automatically wake.
  Death-triggered/retained-ability cases remain conditional manual checks. Impairment
  warnings do not claim truthful information or apply actual effects.
- Privacy Mode still returns the neutral night surface before rendering instructions,
  setup controls, warnings or custom notes. Drawer role/provenance details remain
  inside its existing sensitive-content boundary.
- No changes to actual/shown identity calculation, projection payloads, membership
  authority, runtime Firebase decoding, revocation, ordered/retry writer, lease,
  reconnect handshake or public display logic. Existing tests cover those boundaries;
  the emulator verifies guarded deception delivery and revocation.

## Authority and maintenance

Canonical content is marked **Official · verified** or **Official · experimental**
in reference surfaces. The status uses pinned metadata AND matching rules content,
not an arbitrary imported flag. Imported character objects are **Homebrew** even
when they reuse official IDs. String official IDs resolve to canonical definitions.
Legacy/unknown or modified alleged-canonical data is **Unverified reference**, with
manual night-reference warnings. No cached custom script is silently rewritten.

Revision/source details stay in metadata/docs, not the night UI. The canonical
folder README explains attribution and updating all assets/tests together.

## Deferred limitations

No complete rules/history engine or AUD-017 state redesign. In particular:
acquired/lost abilities, independent actual alignment, ability-at-death history,
Poppy Grower release timing, Toymaker skip/final-attack tracking, changed-character
first-night information, Lunatic target selection/history, registration effects,
and complex jinx interactions require Storyteller judgement. Tor is not an
end-to-end automated supported mode; manage shown identity/secrecy manually before
synchronization. Storm Catcher selections/protection and other modifier effects
are guidance, not automated effects.

Experimental source changes after the pinned revision require deliberate review.
The nine additional raw publisher records were not added to the app roster.
No Phase 6.5B ping, Traveler redesign, custom-script overhaul, general mobile
redesign, dependency upgrades or unrelated audit phases were implemented.

## Modified files

The list below includes added files and excludes the restored generated TypeScript
build cache. Paths are relative to this report's repository root.

- [PHASE7-DATA-AUDIT.md](PHASE7-DATA-AUDIT.md)
- [PHASE7.md](PHASE7.md)
- [src/data/canonical.test.ts](src/data/canonical.test.ts)
- [src/data/canonical/README.md](src/data/canonical/README.md)
- [src/data/canonical/index.ts](src/data/canonical/index.ts)
- [src/data/canonical/jinxes.json](src/data/canonical/jinxes.json)
- [src/data/canonical/nightsheet.json](src/data/canonical/nightsheet.json)
- [src/data/canonical/roles.json](src/data/canonical/roles.json)
- [src/data/customScript.ts](src/data/customScript.ts)
- [src/data/fabled.ts](src/data/fabled.ts)
- [src/data/jinxes.ts](src/data/jinxes.ts)
- [src/data/lorics.ts](src/data/lorics.ts)
- [src/data/scripts/badMoonRising.ts](src/data/scripts/badMoonRising.ts)
- [src/data/scripts/experimental.ts](src/data/scripts/experimental.ts)
- [src/data/scripts/sectsAndViolets.ts](src/data/scripts/sectsAndViolets.ts)
- [src/data/scripts/troubleBrewing.ts](src/data/scripts/troubleBrewing.ts)
- [src/data/travelers.ts](src/data/travelers.ts)
- [src/features/almanac/AlmanacBody.tsx](src/features/almanac/AlmanacBody.tsx)
- [src/features/nightOrder/NightOrderPanel.test.tsx](src/features/nightOrder/NightOrderPanel.test.tsx)
- [src/features/nightOrder/NightOrderPanel.tsx](src/features/nightOrder/NightOrderPanel.tsx)
- [src/features/nightOrder/canonicalNightOrder.test.ts](src/features/nightOrder/canonicalNightOrder.test.ts)
- [src/features/nightOrder/nightOrder.test.ts](src/features/nightOrder/nightOrder.test.ts)
- [src/features/nightOrder/nightOrder.ts](src/features/nightOrder/nightOrder.ts)
- [src/features/nightOrder/nightRules.ts](src/features/nightOrder/nightRules.ts)
- [src/features/players/PlayerDrawer.tsx](src/features/players/PlayerDrawer.tsx)
- [src/features/players/PlayerInformation.tsx](src/features/players/PlayerInformation.tsx)
- [src/features/players/PrivatePacketPanel.test.tsx](src/features/players/PrivatePacketPanel.test.tsx)
- [src/stores/privatePackets.test.ts](src/stores/privatePackets.test.ts)
- [src/stores/privatePackets.ts](src/stores/privatePackets.ts)
- [src/stores/schemas.ts](src/stores/schemas.ts)
- [src/stores/types.ts](src/stores/types.ts)

