# Terminology audit: work package report

Status: **implemented, awaiting independent review** (Luna → Astra → Sol).
This document does not close the audit. Phase 10 stays blocked until Sol closes it.

- Starting checkpoint: `1e33c8c1b3673f839abeadc67c3c4f6071324d2d`
  (Phase 9R.6 Luna correction). Phase 9 is closed.
- Branch: `claude/silverwick-terminology-audit-4p7ky8`, created from that
  checkpoint (the session's designated push branch; the unsuffixed
  `claude/silverwick-terminology-audit` also points at the same checkpoint and
  was not modified).
- Persisted schema: store v17 → **v18**.
- Canonical vocabulary: [TERMINOLOGY.md](TERMINOLOGY.md).

## 1. What changed

1. History category `"identity"` → `"role"` (type, schema, and production
   emission from `assignRole`).
2. `STORE_VERSION` 17 → 18, with one narrow, idempotent v17 → v18 migration
   step in the shared `migrateGameEntry()` path, used by the local store
   (Current State and every Undo snapshot) and remote checkpoint recovery.
3. Comments and current documentation that were materially misleading
   (listed in §3 A).
4. New `TERMINOLOGY.md` (canonical vocabulary) and this report.

No gameplay, authority, privacy, projection, Firebase rules, reconnect, or
membership logic changed. The only production code line that changed behavior
is the category literal in `assignRole`. The rest is the version constant, the
migration step, and comments.

## 2. Method

Searched every term in the work package (§5 list) across `src/`, root and
`src/firebase/*.md`, `scripts/`, and `firebase` config. `node_modules` and
generated build output were excluded. Each hit was classified before editing.
`tsc` was then used as a second sweep: once the enum narrowed, every typed
use of `"identity"` as a History category became a compile error. There was
one, a fixture in `sync.test.ts`. Untyped fixtures were found by grep.

Frequency of the canonical identifiers in `src/` (they are already used
consistently, so no rename was needed): `PlayerId` 363, `ParticipantId` 90,
`ParticipantRef` 55, `actualRole` 471, `shownRole` 369, `actualAlignment` 153,
`shownAlignment` 218, `Provenance` 87, `GameMoment` 24, `Mutation Context` 22,
`Information Delivery` 44, `PrivatePacket` 91, `Storyteller-private` 21,
`Current State` 58.

## 3. Inventory

Dispositions: **A** change · **B** keep (intentional) · **C** keep
(historical) · **D** compatibility/persisted · **E** escalate.

### A — CHANGE (done in this branch)

| Location | Existing term | Meaning in context | Target / action | Persistence impact |
|---|---|---|---|---|
| `src/stores/storytellerStore.ts` `assignRole` | `category: "identity"` | Actual Role change | `"role"` | New records serialize `"role"` (see D1) |
| `src/stores/types.ts` HistoryCategory doc | "live-state domains", `"identity" vs "alignment"` | Current State domains / Role category | "Current State domains", `"role"`; notes the v17 name | none |
| `src/stores/types.ts` HistoryChange doc | "scalar/identity-like truth" | Actual Role / Actual Alignment / Life State value | named explicitly | none |
| `src/stores/storytellerStore.ts` migrate comment | "structured live-state" | Current State fields added in v14 | "structured Current State (Actual Alignment, Effects, Reminders)" | none |
| `src/stores/storytellerStore.ts` | `STORE_VERSION = 17`; `if (fromVersion < 17)` | current schema | 18; `< 18`, with a v18 comment | v18 |
| `src/stores/gameMigration.ts` header/docs | "v13…v17", "up through v17" | supported range | through v18; v17→v18 step documented; `detectLegacyGameVersion` explains why it never returns 18 | none |
| `src/stores/schemas.ts` snapshot-contract comment | "An already-v17 record is never migrated again" | no longer exactly true (the v18 step runs) | "never goes through v16 → v17 migration again" | none |
| `src/firebase/storytellerSync.ts` `readCheckpoint` doc | "v13->v16 migration rules" (already stale) | shared migration range | "v13->v18"; describes v17 detection + idempotent step | none |
| `src/firebase/PROTOCOL.md` | (missing) | checkpoint has no game schema version | new paragraph: inference, shared migration, idempotent v18 step, no version field | none |
| `src/test/phase9RichState.ts` | "identity/alignment/…", "Identity History" | Role History | "role/…", "Role History" | none |
| `src/stores/history.test.ts` | "(identity)", "identity domain", `toBe("identity")` | Role category | "role" | none |
| `src/stores/participantIdentity.test.ts:455` | `["identity", "alignment", "life"]` | Role category | `"role"` | none |
| `src/firebase/sync.test.ts:527` | current fixture `category: "identity"` | Role category | `"role"` | none |
| `src/firebase/sync.test.ts:498`, `src/stores/storytellerStore.test.ts:821` | "live state" | Current State | "Current State" | none |
| `src/stores/storytellerStore.test.ts` title | "v17->v17 … passes through" | now a v17→v18 run | "v17->v18 … with no legacy \"identity\" category" | none |
| Version-pinning tests: `phase9Integration.test.ts:53`, `participantIdentity.test.ts:515`, `revocationRecovery.test.ts:173`, `participantMembership.recovery.test.ts:498`, `travelers.test.ts:203`, `setupCommands.test.ts:238,353`, `seatRosterIntegrity.test.ts` (Phase 9R.5 B block) | `version` 17 as "current" | current persisted version | 18 | none |
| Current-version-path tests: `participantMigration.test.ts:163`, `historySnapshotSchema.test.ts:92`, `participantVersionDetection.test.ts:105` | `migrateStoreState(…, 17)` commented as the current/`merge` path | current version | 18, so each still tests what its comment says | none |

### B — KEEP (intentional)

| Location | Term | Why it stays |
|---|---|---|
| `src/stores/identity.ts` (`needsShownIdentity`, `dealtIdentity`, `isInitialRevealComplete`), `projections.ts` `projectIdentity`, `wakeIdentity.ts`, `privatePackets.ts`, `sync.ts:24–55`, `lobby.ts:137–139`, `types.ts` shownRole/`PlayerSelfRecord`/`packetEpoch` docs | "identity", "shown identity", "actual identity", "delivered identity" | Actual/Shown perception as a whole, the publication workflow |
| UI copy: `PlayerDrawer.tsx`, `setupAnalyzer.ts`, `setupPresentation.ts`, `revealReadiness.ts`, `GrimoireCircle.tsx`, `SeatAssignPopup.tsx`, `privatePacketCommands.ts` errors, `nightOrder.ts:109` | "Choose the identity each player will see", "shown identity" | Perception, in player/Storyteller-facing language |
| `isLiveGamePhase` doc (`history.ts`), `StorytellerLobbyRecord.history` doc (`types.ts`) | "identity preparation" | Setup's Actual/Shown perception preparation (not History) |
| `types.ts` ParticipantId/ParticipantRef docs, `participants.ts`, `hasV17IdentityEvidence`, `schemas.ts` seat-identity invariant, `storytellerStore.ts` occupancy docs, `PROTOCOL.md` Phase 9R.2 | "participant identity", "participation identity" | Participant identity |
| `writer.ts:119`, `storytellerSync.ts` guard docs, `PublicDisplayScreen.tsx:113`, `PROTOCOL.md` ("anonymous identity"), `MEMBERSHIP_MIGRATION.md:41`, `PATH_AUDIT.md` `session` row | "identity" | Firebase/auth, writer-lease, or lifecycle identity |
| `PROTOCOL.md` "Phase 5: actual, shown, and published identity" | "identity" | Perception (current protocol doc) |
| `PrivatePacket`, `publishedPacket`, `publishPrivatePacket`, `packetDeliveryState` | "packet", "delivery" | Private publication workflow, not the Information Delivery Record |
| `NightStepStatus` | "status" | Night-order step status |
| `setStatus` command, `STATUSES` chips in `PlayerDrawer.tsx` | "status" | The manual Effect toggle. Its doc comment already says it writes Effects and never `statuses`. See E1 |
| BOTC "character": UI copy (Almanac, Home, TravelerArrival, night order), Traveler "public character", `storytellerStore.ts:244,1616`, `STPlayerRecord.actualAlignment` doc (`types.ts`), `PlayerDrawer.tsx:217`, Traveler choice docs (`membershipCommands.ts`, `playerSync.ts`, `lifecycle.ts`, `StorytellerSession.tsx`), `informationActions.ts` labels | "character", "character change" | Official BOTC vocabulary. "Character change" is the rules' own name for an Actual Role change |
| `storytellerStore.ts:363` "Live History", `HistoryRecord` and `StorytellerLobbyRecord.history` docs (`types.ts`) / `history.test.ts:10` / `sync.test.ts:519` "live-game" | "live" | Means Live Play; not misleading |
| "ST-only" (13 hits) | "ST-only" | Synonym of Storyteller-private (documented in TERMINOLOGY.md §19) |
| `storytellerStore.ts:183,367` "Authoritative Information command" | — | Deliberately not called a Mutation Command: recording information does not mutate Current State |
| lowercase "current state" (`HistoryRecord` doc in `types.ts`, several tests) | — | Correct in context |
| `isLiveGamePhase`, persisted phases `"night"`/`"day"` | — | "Live Play" is only an umbrella name |

### C — KEEP (historical)

| Location | Why |
|---|---|
| `PHASE6.md`, `PHASE7.md`, `PHASE7-DATA-AUDIT.md`, `PHASE8.md`, `PHASE9B.md`, `PHASE9C.md`, `PHASE9C1-OPUS-007.md`, `PHASE9C7.md` | Phase handoffs and audits. Describe past work in the vocabulary of their time and do not claim to be current architecture |
| Phase 9D.1 "structured live-state" as a work-package name: `liveState.test.ts` (filename, line 9), `storytellerStore.test.ts:508,907,947`, `checkpointMigration.test.ts:215`, `sync.test.ts:479` | Names the Phase 9D.1 deliverable. Renaming the file or test titles would be churn |
| Phase 9R.2 test titles about the v17 contract (`participantMigration.test.ts` "the v17 invariants…", `historySnapshotSchema.test.ts` "the exact v17 regression", `checkpointMigration.test.ts:301` "v17 remote checkpoint (already current)") | Still true for v17-shaped data. They test the v17 contract, which v18 keeps |

### D — COMPATIBILITY / PERSISTED

| Location | Term | Decision |
|---|---|---|
| **D1** History `category` (`HistoryCategory`, `HistoryCategorySchema`; local store, Undo, checkpoint) | `"identity"` | **Renamed to `"role"`**, as this work package approved: store v18 plus the v17 → v18 migration (§4) |
| `STPlayerRecord.statuses`, `StatusesSchema`, `Statuses` | `statuses` | Kept. Legacy compatibility only; `effects` is authoritative. Removal needs its own approved migration |
| `EffectRecord` / `ReminderRecord` / `Provenance` `.sourceCharacter` | "character" | Kept. Persisted field; BOTC vocabulary for a Role id |
| `Script.characters`, `RoleDef`, custom-script JSON, `src/data/canonical/*` | "characters" | Kept. External BOTC script format |
| `phase: "setup" \| "night" \| "day" \| "ended"` | — | Kept. Not renamed to "livePlay" |
| `publicDisplayRole`, `publishedPacket`, `packetEpoch`, Firebase paths (`player/{id}`, `storyteller`, `checkpoint`) | — | Kept. Persisted and wire names |
| Remote checkpoint `{ game, roster }`, no game schema version | — | Kept. No version field added (§5) |
| `participantVersionDetection.test.ts:167` | v16 fixture with `category: "identity"` | Kept. Deliberately legacy data, used for detection only |

### E — ESCALATE (nothing changed; for Sol)

- **E1 `setStatus`** (public store command) and its "status chip" UI. Its
  behavior is correct and documented: it manages one deterministic manual
  Effect and never writes `statuses`. Renaming it (for example to
  `setManualEffect`) is an API/product decision with no correctness benefit,
  so it is out of scope here. Recommendation: keep.
- **E2 A local store labeled v17 that already contains `"role"`.** No v17
  writer can produce this: the v17 schema rejected `"role"`. Because the v17
  → v18 step is idempotent, as this package requires for remote checkpoints,
  and runs through the shared path, such a store would load as valid v18 data
  rather than being rejected. Rejecting it would need a local-only check
  alongside the shared migration. Recommendation: accept. The result is
  canonical, nothing is fabricated or reinterpreted, and a local store
  labeled **v18** that carries `"identity"` is still rejected (§4.4).

## 4. Persistence

### 4.1 Versions
Starting: store v17. Result: store **v18** (`STORE_VERSION`). No checkpoint
version field was added.

### 4.2 Exact v17 → v18 transformation (`migrateEntryV17ToV18`)
For each object in the entry's `history` array: if `category === "identity"`
(exact string), set `category = "role"`. Nothing else is touched:
- record ids, order, and count do not change, and no record is created or
  removed;
- `participant` (ParticipantRef), `moment`, `change`, `provenance`, and `note`
  are unchanged. Reassigning an existing key keeps its position, so the
  serialized record differs only in that value (verified byte-for-byte in
  tests);
- other categories, including unknown ones such as `"character"`, `"roles"` or
  `"Identity"`, are left for the schema gate to reject;
- non-object History entries are skipped and left for the schema gate;
- Current State (players, seats, phase, …) and `informationDeliveries` are not
  read or written.

It is idempotent (`"role"` is never rewritten) and runs for every
`fromVersion < 18`. It is independent of the v16 → v17 identity-evidence
gate, which concerns different fields.

### 4.3 Where it applies
- Local store: `migrateStoreState` runs the shared per-entry migration for
  `fromVersion < 18` on `game` and every `undoStack` entry.
- Remote checkpoint: `readCheckpoint` → `detectLegacyGameVersion` (reports 17
  for v17-or-newer) → `migrateGameEntry(game, 17)` → schema. For a v17
  checkpoint the step renames `"identity"`; for a v18 checkpoint it does
  nothing.

### 4.4 Current-version strictness
Zustand's `merge` passes every rehydrated store through
`migrateStoreState(state, 18)`. There no step runs, so a store labeled v18
that still carries `"identity"` in Current State or any Undo snapshot fails
`StorytellerStateSchema` and goes through the existing reset path. It is not
treated as v17 data.

### 4.5 Evidence (tests)
- `src/stores/historyCategoryMigration.test.ts` (34 tests):
  - A: emission, ParticipantRef, Provenance, moment, no-op, Undo, Setup;
  - B: local v17 → v18, including byte-for-byte record equality and unchanged
    Current State;
  - H: reused seat, with no identity following the PlayerId;
  - B: the v16 → v18 chain, and idempotence;
  - C: Undo snapshots, plus a real v17 localStorage blob of the rich Phase 9
    game rehydrating to exactly today's game and Undo stack;
  - D: v18 strictness, both unit and real rehydrate, including an Undo-only
    stale value;
  - G: the enum is exactly five values; `character`, `identity-change`,
    `roles`, `Identity`, `IDENTITY` and similar are rejected and never
    aliased;
  - the shared step is a byte-identical no-op on v18 data and on repeated
    application, and detection stays at 17.
- `src/firebase/historyCategoryCheckpoint.test.ts` (9 tests):
  - E: a legacy v17 checkpoint recovers with `"role"`, and
    ParticipantRef/Provenance/change data, players, seats and Information
    Delivery are unchanged;
  - E: a v16 checkpoint runs both steps;
  - E: a rich game checkpointed with v17 names restores exactly the current
    game;
  - E: an already-v18 checkpoint is left unchanged;
  - G: unknown categories are rejected;
  - F: `writeProjections` and a real live session's checkpoint contain
    `"role"` and never `"identity"`, and a fresh device recovers that
    checkpoint unchanged.
- Mutation check: with the v17 → v18 call disabled, 7 local and 3 remote tests
  fail. With it restored, all pass.

## 5. Behavioral invariants

Unchanged: Storyteller authority, player permissions, projections
(`projections.ts` not modified; History is still never projected), privacy
boundaries, Current State semantics, participant identity (ParticipantId,
ParticipantRef and PlayerId behavior), reconnect decisions
(`reconnectDecision.ts` not modified), membership, writer fencing, Firebase
authorization (`rules.json` not modified), the phase state machine, and
Setup/Reveal. The existing identity-integrity suites (participant migration,
history snapshot schema, seat reuse, provenance, information delivery,
revocation recovery) are all green.

## 6. Verification

Baseline at the starting checkpoint: typecheck clean; `npm test` 87 files,
2295 tests passed.

On this branch (final tree):

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | 89 files, **2338 passed**, 0 failed, 0 skipped (2295 + 43 new: 34 local, 9 remote) |
| `npm run test:rules` (Firebase emulator) | 2 files, **176 passed** |
| `npm run build` | pass (the existing chunk-size warning only) |
| `git diff --check` | clean |

`tsconfig.app.tsbuildinfo`, which `tsc -b` regenerates, was restored rather
than committed, following the repository convention (`70da5e2`).

## 7. Diff scope

| File | Why it is in scope |
|---|---|
| `src/stores/types.ts` | `HistoryCategory` `"role"`; misleading History docs |
| `src/stores/schemas.ts` | Canonical category enum; a comment made inaccurate by v18 |
| `src/stores/storytellerStore.ts` | `STORE_VERSION` 18; Role History emission; local migration routing and docs |
| `src/stores/gameMigration.ts` | v17 → v18 step; supported-range and remote-detection docs |
| `src/firebase/storytellerSync.ts` | `readCheckpoint` migration doc (range was stale) |
| `src/firebase/PROTOCOL.md` | Current protocol doc: checkpoint schema-version behavior |
| `src/test/phase9RichState.ts` | Fixture comments: Role History |
| `src/stores/history.test.ts`, `participantIdentity.test.ts`, `src/firebase/sync.test.ts` | Expect/emit `"role"`; stale descriptions |
| `src/stores/storytellerStore.test.ts` | Test titles ("live state", v17 → v18) |
| `phase9Integration.test.ts`, `participantIdentity.test.ts`, `revocationRecovery.test.ts`, `participantMembership.recovery.test.ts`, `travelers.test.ts`, `setupCommands.test.ts`, `seatRosterIntegrity.test.ts` | The current persisted version is now 18 |
| `participantMigration.test.ts`, `historySnapshotSchema.test.ts`, `participantVersionDetection.test.ts` | The current-version (`merge`) path is now 18 |
| `src/stores/historyCategoryMigration.test.ts` (new) | Test contract A, B, C, D, G, H and idempotence |
| `src/firebase/historyCategoryCheckpoint.test.ts` (new) | Test contract E, F and remote G |
| `TERMINOLOGY.md` (new) | Canonical vocabulary |
| `TERMINOLOGY-AUDIT.md` (new) | This inventory and report |

No Firebase rules, projection, reconnect, membership, writer, UI, or
role-data file was modified.
