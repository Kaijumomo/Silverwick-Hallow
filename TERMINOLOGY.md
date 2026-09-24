# Terminology

## 1. Purpose

This is the repository's canonical vocabulary. Use these terms in new code,
comments, tests and current documentation. When a term here and older wording
disagree, this file wins, unless the older text is a historical record (the
`PHASE*.md` handoffs) or a persisted/wire name (see §20).

Each entry gives the meaning first, then where it lives in the code.

## 2. Current State vs History vs Information Delivery

Three separate things. Never merge them, and never derive one from another.

| Term | Meaning | Lives in |
|---|---|---|
| **Current State** | What is true now. The only authority for gameplay. | `StorytellerLobbyRecord` (players, phase, day, …) |
| **History** | Storyteller-private bookkeeping of which Mutations happened. Explains Current State but is not authoritative and is never used to rebuild it. | `game.history: HistoryRecord[]` (`src/stores/history.ts`) |
| **Information Delivery** | Storyteller-private record of information actually communicated to a player. Recording one is not a Mutation of Current State. | `game.informationDeliveries` (`src/stores/informationDelivery.ts`) |

A **History Record** has a `category`: `"role"`, `"alignment"`, `"life"`,
`"effect"` or `"reminder"`. `"role"` means a change to an Actual Role. (Store
v17 called it `"identity"`; the v18 migration renames it.)

## 3. Mutation

An accepted change to Current State that means something in the game. A no-op
(re-setting the same value) is not a Mutation: it records no History and
pushes no Undo entry.

## 4. Authoritative Mutation Command

A Storyteller-owned store command (`useStorytellerStore`, in
`src/stores/storytellerStore.ts`) through which authoritative game state
changes.

- Some commands are **History-eligible**. During Live Play they append their
  own History through `recordIfLive()`. Examples: `assignRole`,
  `setActualAlignment`, `setAlive`, `addEffect`, `addReminder`.
- Other commands change Current State without producing a History Record. An
  example is a phase transition through `setPhase` (it still pushes Undo).

For a History-eligible command, the Current State mutation and its History are
applied together or not at all. Either way, History remains explanatory
bookkeeping; Current State stays the authority (§2).

## 5. Mutation Context

The optional third argument some commands take (`MutationContext` in
`src/stores/history.ts`). Today it carries only Provenance input
(`ProvenanceInput`, which names its source by a live `PlayerId`). It is not a
general options bag.

## 6. Provenance

Stored information about where a recorded Mutation or Information Delivery
came from and why: `sourceParticipant` (a ParticipantRef), `sourceCharacter`,
`reason`, `note`. Never invented. When nothing is known, it is absent.

## 7. Game Moment

The point in the game a record belongs to: `GameMoment = { phase, day }`,
using Setup/Night/Day rather than wall-clock time. It is absent when the real
moment is unknown, such as a migrated legacy record, and is never guessed.

## 8. Setup vs Live Play

- **Setup**: the game before Live Play. Seating, bag construction, the Deal,
  perception configuration, and preparing the initial Reveal. Setup commands
  record no History.
- **Live Play**: Night or Day after the initial Reveal. `isLiveGamePhase()` is
  true only for the persisted phases `"night"` and `"day"`.

The persisted phase values stay `"setup" | "night" | "day" | "ended"`. "Live
Play" is only a name covering `"night"` and `"day"`; it is never stored.

## 9. Actual Role vs Shown Role

- **Actual Role** (`actualRole`): the Storyteller's authoritative truth.
- **Shown Role** (`shownRole`): what the player is explicitly shown. `null`
  means unrevealed.

Truth never automatically becomes perception. Changing an Actual Role
preserves the Shown Role (except where a command explicitly says otherwise).

## 10. Actual Alignment vs Shown Alignment

- **Actual Alignment** (`actualAlignment`): authoritative truth. When absent,
  it is unresolved, never invented.
- **Shown Alignment** (`shownAlignment`): explicit perception. `null` derives
  from the Shown Role only, never from the Actual Alignment.

## 11. PlayerId vs ParticipantId vs ParticipantRef

| Term | Meaning |
|---|---|
| **PlayerId** | A reusable live seat/slot address. Says nothing about who sat there before. |
| **ParticipantId** | One continuous participation instance: a person in a seat, from occupying it until unseated or removed. Never reused. |
| **ParticipantRef** | An immutable snapshot pointing at a participation instance, stored on historical records. `{ kind: "participant", … }`, or `{ kind: "legacy", playerId }` when pre-v17 data cannot prove who it was. |

Never infer historical continuity from a PlayerId, seat, name or UID.

## 12. Life State

A player's life/death situation: `alive`, `ghostVote`, and for Travelers
`exiled`. Covers death, exile and restoration. Life State changes use the
`"life"` History category.

## 13. Effect

A structured active gameplay effect on a player (`EffectRecord` in
`player.effects`). Examples are poisoned, drunk and protected, plus effects
later created by abilities. Several Effects of the same `type` from different
sources can coexist.

## 14. Reminder

A structured Storyteller bookkeeping token on a player (`ReminderRecord` in
`player.reminders`).

## 15. Information Action

A Role-defined interaction through which information may be communicated
(`InformationAction`, from `RoleDef.informationActions` or
`src/data/informationActions.ts`).

## 16. Information Requirement

One structured piece of information an Information Action needs
(`InformationRequirement`: kind and cardinality). It describes the shape of
the information, never the answer.

## 17. Information Value

The caller-supplied value that satisfies an Information Requirement
(`InformationValue`, which names players by live `PlayerId`). It is stored as
a `RecordedInformationValue`, where players become ParticipantRefs.

## 18. Information Delivery Record

The stored, Storyteller-private record of information that was actually
communicated (`InformationDeliveryRecord`): recipient, the Actual Role at
delivery time, the Information Action, the values, Game Moment and
Provenance. Created by `recordInformationDelivery()`. It is not a History
Record.

## 19. Storyteller-private

Visible only to the Storyteller: the `storyteller` and `checkpoint` Firebase
paths, which only the owner can read, and the local persisted store. Never
projected to public, player or display surfaces. History, Information
Delivery, Effects, Reminders, Actual Role/Alignment and ParticipantIds are all
Storyteller-private. Older code says "ST-only" with the same meaning.

## 20. Intentional vocabulary exceptions

These are correct as they stand. Do not "fix" them.

- **"identity"** is still correct when the subject really is identity:
  participant identity (ParticipantId/ParticipantRef), Firebase/auth identity
  (UIDs, anonymous display identity), and perception as a whole ("actual
  identity", "shown identity", `needsShownIdentity`, `projectIdentity`,
  `src/stores/identity.ts`, `wakeIdentity`). Only the History *category* for
  an Actual Role change stopped being "identity".
- **PrivatePacket** (`publishedPacket`, `publishPrivatePacket`,
  `packetDeliveryState`) is the workflow that publishes private information to
  a player's self view. It is not an Information Delivery Record, even though
  both involve "delivery".
- **"character"** is official Blood on the Clocktower vocabulary. Keep it in
  player-facing copy, script/role data (`Script.characters`, canonical JSON),
  Traveler "public character", and persisted fields such as
  `sourceCharacter` (which holds a Role id).
- **`statuses`** is a legacy compatibility field. Commands no longer write it,
  and it is not authoritative Effect state; `effects` is. It stays until a
  separately approved migration removes it. The `setStatus` command and the
  UI's "status" chips are the manual Effect toggle, and write Effects.
- **`NightStepStatus`** is the status of a night-order step, which is
  unrelated to Effects.
- **Night and Day** are the persisted phases that "Live Play" covers (§8).
- **Historical documents** (`PHASE*.md`) record past work in the vocabulary of
  their time. Leave them unchanged.
