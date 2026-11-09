# B8 — temporal evidence for End assistance

The approved Saint/Mayor extension and Demon-death amendment reuse **schema v28** and the existing Game Rule Fact record shape. These facts are private evidence for the existing End control's `!`; only the Storyteller declares a result. They are not a winner state.

## Capture and representation

| Fact | Meaning | Exact trigger | Expiry |
| --- | --- | --- | --- |
| `saintExecutionGoodTeamLost` / `saintExecutionEvilTeamLost` | Saint functioned at execution death, with the named actual team | New execution Life Event ID in `resolutionId` | Day N+1 |
| `saintExecutionGoodTeamNotQualified` / `saintExecutionEvilTeamNotQualified` | Saint was known not to function at execution death, with the named actual team | New execution Life Event ID in `resolutionId` | Day N+1 |
| `mayorDayEndGoodTeamWon` / `mayorDayEndEvilTeamWon` | Functioning Mayor qualified at the completed Day boundary for their actual team | `recordedAt` Day N; no Life Event reference | Day N+1 |
| `resolvedDemonDeathNoSuccessor` | Supported Imp death and succession evaluation completed with no living Demon | Exact new death/execution-death Life Event ID in `resolutionId` | Same phase on day N+1 |

For these event-bound facts, `resolutionId` names **Life Event.id**, not its possibly shared action resolution ID. `provenance.sourceParticipant` is the durable participant and `sourceCharacter` is the actual qualifying character. No field contains an encoded payload. The meaning of each finite type asserts the accepted rule evaluation, including event-time functioning; it is never derived from text or artwork.

Saint reads the immediate pre-death state. Mayor reads the completed Day before phase-effect expiry. Demon evidence reads the immediate pre-Life state and the result after all supported consequences. The ability coordinator retains this pre-Life snapshot locally while composing the transaction; it never publishes or persists an intermediate state.

Supported capture paths are new single recorded outcomes, Voting's recorded execution, and canonical automatic Imp/Slayer outcomes. Raw Life corrections, manually composed outcomes, custom ability semantics, uncertain registration and incomplete succession cannot create Demon proof. A recorded Night Imp death qualifies only when no possible self-pass recipient exists, making its unknown cause immaterial. Otherwise it remains entirely manual.

## Validity and precedence

- Exact retained event, event outcome, trigger moment, durable source, lifetime and compatible fact collection must validate.
- The Demon fact requires an actual Imp death, one pre-death living Demon, no post-resolution living Demon, and no unfulfilled Scarlet Woman or Imp succession.
- An ordinary ending already reached before the action cannot be replaced by a later Saint/Mayor/Demon qualification.
- A positive Saint or Mayor ending is not overwritten by a later Demon death.
- One negative Saint fact may coexist with the Demon fact. It preserves the reason the earlier Saint execution did not supersede ordinary ending rules. Other competing temporal fact combinations are rejected.
- Ordinary two-survivor counting excludes Travellers; Mayor's three-player count includes them. Scarlet Woman's threshold uses living non-Travellers immediately before death.
- Poison expiry preserves event-time evidence. Missing evidence in old saves stays unknown; there is no History or Undo replay/backfill.
- Unsupported characters, rule facts, modifiers or ambiguous effects keep eligibility manual, independent of script name or ID.

## Lifecycle, authority and privacy

Facts expire atomically with their trigger's retained Life Event window. Relevant explicit corrections and participant/source changes invalidate them without rerunning past rules. Resurrection or a new living Imp invalidates Demon-death proof. Perception-only and descriptive changes do not recalculate event-time functioning. Undo restores the matching historical snapshot and validates that snapshot on its own terms.

Generic Game Rule Fact apply cannot create these capture-only facts. Accepted authoritative commands save the full result before publishing it, with one Undo entry and one writer sequence increment. Failed storage, stale writer/participant/UI context, Privacy Mode and pending terminal recovery refuse the entire action. The existing private checkpoint carries the evidence; public and player projections omit it.

## Verification ownership

Production behavior is exercised in `victoryEvidence.test.ts`, `b8Independent.test.ts`, `b8DemonIndependent.test.ts`, existing Imp/Slayer/Life/Voting suites, `b8EndIndicator.test.tsx` and the real Firebase `characterAuthority.spec.ts`. Independent review must distinguish supported automation from intentional manual and unknown outcomes. Desktop and S8 Ultra-sized touch simulations do not constitute physical-device acceptance.
