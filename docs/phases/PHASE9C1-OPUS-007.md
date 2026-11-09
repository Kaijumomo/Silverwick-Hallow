# Phase 9C.1 — OPUS-007 Architecture Proof Requirements

Independent architecture / Firebase-security / test-strategy review.
Checkpoint reviewed: `07f01e1 — feat: default active-game arrivals to travelers`.
Scope: **architecture contract only. No production code is changed by this
document.** Fact / inference / recommendation are labelled throughout. Where the
roadmap and the repository disagree, the repository wins and the discrepancy is
reported (Section 1).

---

## 1. Finding Validation

**Verdict: PARTIALLY CONFIRMED (finding overstated; a real but narrower gap
remains).**

The roadmap states: *"There is no integration suite exercising the real
application client/session/projection code against actually enforced Firebase
Emulator Security Rules … the [rules and client] layers are insufficiently
coupled."*

### Fact — the strong form of the finding is contradicted by the repository

`src/firebase/rules.spec.ts` is already an emulator-backed integration suite that
drives **real production code** against **enforced `rules.json`**:

- It boots the RTDB emulator via `initializeTestEnvironment({ projectId:
  "demo-silverwick-rules", database: { host, port, rules: readFileSync(rules.json) }})`
  (`rules.spec.ts:34`), so the deployed rule document is loaded and enforced.
- It builds per-identity backends from the **real** production adapter:
  `new FirebaseRoomBackend(env.authenticatedContext(uid).database())`
  (`rules.spec.ts:62`).
- It invokes the **real** production functions — not raw ref writes — for the
  Storyteller publication path:
  - `createLobby`, `knockOnLobby`, `cancelJoinRequest`, `seatPlayer`,
    `revokeMembership`, `revokePlayerMembership` (`lobby.ts`).
  - the real single-writer `SessionWriter` with lease renewal + `writeGuard`
    fencing (`writer.ts`), including a second-writer conflict, expiry fencing,
    monotonic-revision rejection, and the ordered `close()`.
  - the **real projection chokepoint** `writeProjections({ backend: writer, … })`
    (`sync.ts`) driven from the **real** `useStorytellerStore` +
    `previewPrivatePacket` + `publishPrivatePacket` (AUD-004 / AUD-027 / Phase 9B
    tests, `rules.spec.ts:403–530`).
- It asserts both **positive** (`assertSucceeds`) and **negative**
  (`assertFails`) authorization, and it already proves one form of
  rejection-through-production-code:
  `await expect(revokePlayerMembership(backend(bob), …)).rejects.toThrow(/permission denied/i)`
  (`rules.spec.ts:246`).

The central OPUS-007 assertion — *"a projection that starts accessing a
rules-prohibited path causes the integration test to fail"* — is therefore
**already satisfied for the Storyteller projection/writer/low-level-membership
path**: those writes flow through the real writer to the emulator and are
rejected by real rules.

### Fact — a genuine residual gap remains (the true 9C.1 scope)

Three production pathways are exercised **only** against `MemoryRoomBackend`,
which enforces **no** authorization (it is a pure nested-object tree; every
`set`/`update`/`transaction` unconditionally succeeds — `memoryBackend.ts`):

| Untested-against-rules production pathway | Defined in | Currently tested only in (MemoryRoomBackend) |
| --- | --- | --- |
| Player read/subscribe handshake: `startPlayerHandshake`, `joinLobby`, `leaveLobby` | `playerSync.ts` | `lifecycle.test.ts`, `membership.test.ts`, `privatePacketCommands.test.ts` |
| Storyteller app orchestration: `startStorytellerSession` (checkpoint/takeover recovery, debounced `flush`, join/leave reconciliation) | `storytellerSync.ts` | `lifecycle.test.ts`, `privatePacketCommands.test.ts` |
| Compensation-wrapped membership commands: `seatPlayerAndCommit`, `revokePlayerAndCommit` | `membershipCommands.ts` | `membershipCommands.test.ts`, `lifecycle.test.ts` |

Because `MemoryRoomBackend` never denies, none of these prove that the **reads
they install** and the **rejections they must handle** agree with enforced rules.
The sharpest example: a *revoked* player's real handshake (`startPlayerHandshake`)
must observe the live `player/{id}` read being denied by rules and converge the
player store to `status: "revoked"`. Today that denial is only *simulated*
in-memory, never produced by a real rule.

### Inference

A client change that alters **which paths the player handshake subscribes to**,
or **how the orchestration reconciles roster/leave/join**, or **how a denial is
classified**, can pass the entire `*.test.ts` suite while diverging from
`rules.json`. The Storyteller *write* side is protected by `rules.spec.ts`; the
**player read side and the app-level orchestration are not.** That is the real,
defensible OPUS-007 gap.

---

## 2. Current Test Architecture

Two suites exist and are wired separately (fact):

- Fast suite — `vitest.config.ts`, `include: ["src/**/*.test.{ts,tsx}"]`,
  jsdom, `MemoryRoomBackend`. `npm test`.
- Emulator suite — `vitest.rules.config.ts`, `include:
  ["src/firebase/rules.spec.ts"]`, node, real emulator + real rules. Run only via
  `npm run test:rules` (`firebase emulators:exec --project demo-silverwick-rules
  --only database --config firebase.rules-test.json` → `scripts/run-rules-tests.mjs`).
  `test:full = typecheck && test && test:rules`.

| Layer | What it proves | What it does **not** prove |
| --- | --- | --- |
| **Rules/emulator suite** — `rules.spec.ts` (real `FirebaseRoomBackend` + real `SessionWriter` + real `writeProjections` + real store) | Storyteller publication, seating, revocation, privacy allowlist, writer lease/guard fencing, monotonic revision, ordered end, cross-lobby isolation, ownership claim, anon-provider claim — all against enforced `rules.json`. One ST command rejection propagates (`revokePlayerMembership(bob)` throws). | The **player** handshake pipeline (`startPlayerHandshake`/`joinLobby`/`leaveLobby`); the **orchestration** (`startStorytellerSession` incl. takeover/checkpoint, join/leave reconciliation); `seatPlayerAndCommit`/`revokePlayerAndCommit`; propagation of a real denial into **player-store domain state**. |
| **Projection unit tests** — `sync.test.ts`, `projections.test.ts` (MemoryBackend + `writeLog`) | `writeProjections` is the sole chokepoint; forbidden fields never appear on `public/*` or other-player `player/*` (`writeLog` assertions, per `PATH_AUDIT.md`). Allowlist is an API property. | That the emulator **rules** also reject any drift — memory backend cannot deny. (Covered instead by `rules.spec.ts` for the writer path.) |
| **Session/lifecycle/protocol tests** — `lifecycle.test.ts`, `sync.test.ts`, `session.test.ts`, `snapshots.test.ts` (MemoryBackend) | Handshake state machine (`knocking→waiting→seated→revoked/ended`), writer serialization/retry/guard-receipt logic, snapshot validation, reconnect ordering, presence math. | Any of it against **enforced rules or real permission errors**. Denials are injected as fake errors, not produced by rules. |
| **Membership command tests** — `membershipCommands.test.ts`, `membership.test.ts` (MemoryBackend) | `seatPlayerAndCommit`/`revokePlayerAndCommit` compensation/rollback and idempotence in the happy tree. | Compensation behaviour when the **real** rule denies the compensating write; that a non-owner is actually blocked by rules. |
| **Component tests** — `*.test.tsx` (jsdom, MemoryBackend/stub runtime) | UI rendering, packet panel, drawer, screens. | Anything about real Firebase authorization. |

**Net:** the ST **write** contract is proven end-to-end; the player **read**
contract and the **orchestration** contract are proven only against a permissive
in-memory double.

---

## 3. Missing Contract

Precisely (architecture-level), the unproven contract is:

> **The production player read/handshake pipeline and the Storyteller app-level
> session orchestration remain compatible with the enforced `rules.json`:**
> 1. every path the real `startPlayerHandshake` / `startStorytellerSession`
>    **subscribes to or reads** is authorized for the identity that installs it,
>    for each membership state (waiting, seated, revoked, ended); and
> 2. when a rule **denies** a read or write that these pipelines perform, the
>    denial **propagates to the correct domain outcome** (player store
>    `revoked`/`ended`/`error`; orchestration `flush` surfaced error) and is
>    **never swallowed, retried into apparent success, or masked by the
>    guard-receipt short-circuit.**

The ST projection-write half of OPUS-007 is already covered by `rules.spec.ts`
and must **not** be re-implemented. 9C.1 adds the **read/orchestration/propagation**
half as a small contract layer.

---

## 4. Required Production Code Paths

The harness must invoke these real modules (no re-implementation). "Why" = why a
memory double cannot substitute.

| Production entry point | File | Why the real path matters |
| --- | --- | --- |
| `FirebaseRoomBackend` (`set/get/update/transaction/setIfAbsent/subscribe/onDisconnectSet`) | `firebaseBackend.ts` | The only adapter that maps app ops to RTDB semantics and surfaces `permission_denied`. Memory backend never denies. |
| `SessionWriter` (`start/renew/runExclusive/commit/close`) | `writer.ts` | Produces the real writer-lease + `writeGuard` fence the rules require; its guard-receipt retry is a candidate false-positive site (Section 11). |
| `writeProjections` | `sync.ts` | The single publication chokepoint; must reach the emulator through the real writer so a forbidden path/field is actually rejected. (ST side already proven; reused as the authorized-write fixture.) |
| `startPlayerHandshake`, `joinLobby`, `leaveLobby`, `applyJoinIntent` | `playerSync.ts` | Installs listeners **from validated server membership**, reacts to real read denials (`watch` `onError` → `fail`/`schedule`→`reconcile`), and drives the player store. This reaction is meaningless without a real denial. |
| `startStorytellerSession` (and its `flush`, checkpoint/takeover recovery, join/leave watchers) | `storytellerSync.ts` | Orchestrates the real writer + debounce + reconciliation; takeover reads `checkpoint`/`roster` and revokes unresolvable binds — many rule-guarded paths in one flow. |
| `seatPlayerAndCommit`, `revokePlayerAndCommit` | `membershipCommands.ts` | Compensation/rollback must be validated when the compensating write is itself subject to rules. |
| `createLobby`, `knockOnLobby`, `seatPlayer`, `revokePlayerMembership`, `readOwnRosterEntry`, `readRosterBindings` | `lobby.ts` | The Firebase-first membership commands under test as fixtures and as subjects. |
| snapshot decoders + `subscribeDecoded` | `snapshots.ts` | The validation boundary the pipelines read through; `read_failed`/`invalid` handling must be exercised against real transport, not fabricated. |
| `friendlyFirebaseError`, `lifecycleMessage`, `isTransient`, `LifecycleError` | `errors.ts`, `lifecycle.ts` | The domain-error translation the propagation contract asserts on. |
| `usePlayerStore`, `useStorytellerStore`, `useSessionRuntime` | `stores/*` | The observable domain state where the contract's outcome is checked. |

**Not invoked (deliberately):** `connectFirebase`/`getActiveBackend` singleton
and the React `useEffect` wrappers `usePlayerSync`/`useStorytellerSync`. The
underlying functions accept an injected `RoomBackend` (both `playerSync.ts` and
`storytellerSync.ts` export the bare functions), so the harness injects a backend
directly, exactly as `lifecycle.test.ts`/`privatePacketCommands.test.ts` already
call `startPlayerHandshake`/`startStorytellerSession` with an explicit backend.
This avoids a browser E2E framework (see Section 14 / Constraints).

---

## 5. Proposed Harness Architecture

**Recommendation.** Add a *second* emulator spec beside `rules.spec.ts`, reusing
the identical emulator lifecycle, project, and rule-loading. Keep it compact.

- **Test runner / suite membership.** New file `src/firebase/contract.spec.ts`.
  Widen `vitest.rules.config.ts` `include` to `["src/firebase/*.spec.ts"]` (or add
  the file explicitly). Environment stays `node`, `globals: false`. This inherits
  `scripts/run-rules-tests.mjs`'s guard (≥1 test, zero skips/todos, non-zero exit
  on any failure) automatically.
- **Emulator lifecycle.** Unchanged: `npm run test:rules` →
  `firebase emulators:exec --project demo-silverwick-rules --only database
  --config firebase.rules-test.json`. The emulator is started once for the whole
  vitest.rules run; both specs share it. `test:full` remains the gate. **No new
  emulator, port, or npm script is required.**
- **Firebase app initialization + rules enforcement guarantee.** In `beforeAll`,
  assert `process.env.FIREBASE_DATABASE_EMULATOR_HOST` matches
  `^(127\.0\.0\.1|localhost):\d+$` (fail hard otherwise, mirroring
  `rules.spec.ts:29`), then
  `env = await initializeTestEnvironment({ projectId: "demo-silverwick-rules",
  database: { host, port, rules: readFileSync(resolve(__dirname,"rules.json")) }})`.
  Loading `rules.json` **inside this spec** is mandatory — never rely on rules a
  sibling spec happened to load (Section 10 failure mode).
- **Authentication (mock boundary — acquisition only).** Identities come from
  `env.authenticatedContext(uid)` (and `env.unauthenticatedContext()`), not from
  `signInAnonymously`. Where the anonymous provider claim itself matters, pass
  `{ firebase: { sign_in_provider: "anonymous", identities: {} }}` as
  `rules.spec.ts:112` already does. Rationale in Section 6.
- **Database isolation + cleanup.** `beforeEach(() => env.clearDatabase())`.
  `afterEach`: dispose any `SessionWriter` (`await writer.dispose()`), stop every
  `startPlayerHandshake`/`startStorytellerSession` (call their returned `stop`),
  and reset stores: `usePlayerStore.getState().reset()`,
  `useStorytellerStore.setState({ game:null, lobby:null, undoStack:[] })`,
  `useSessionRuntime.setState({ backend:null, error:null, presence:"unknown",
  online:{}, pending:0, retry:0 })`. Distinct lobby codes per test.
  `afterAll(() => env.cleanup())`. **Cleanup must not use
  `withSecurityRulesDisabled` to tear down state it is asserting on** — use
  `clearDatabase()` (Section 10 failure mode).
- **Storyteller identity.** `const st = "uid-storyteller";`
  `const host = new FirebaseRoomBackend(env.authenticatedContext(st).database());`
  Establish a lobby the **real** way: `await createLobby(host, st, { codeGenerator:
  () => code })`, read `session.id`, `const writer = new SessionWriter(host, code,
  sessionId); await writer.start();`. Use `writer` as the projection backend and
  as the membership-command backend (so writes carry the real fence).
- **Player identity.** `const alice = "uid-alice";`
  `const player = new FirebaseRoomBackend(env.authenticatedContext(alice).database());`
  Join the real way: `await joinLobby(player, code, alice, "Alice")` then
  `const stopP = startPlayerHandshake(player, code, alice)`. Await store
  convergence with a bounded poll on `usePlayerStore.getState()` (no fake timers;
  real emulator latency + real backoff).
- **How production code is injected/configured.** Only via the `RoomBackend`
  constructor argument and the exported bare functions. No singleton, no React
  render, no test-only production hook.
- **Where assertions belong.** On the **domain outcome**, not on raw refs:
  player-store `status`/`self`/`remoteData`; `useSessionRuntime.error`; a rejected
  promise from a production command; `friendlyFirebaseError(err).title`. Raw
  `assertFails(ref…)` is used **only** as a corroborating check, never as the sole
  proof (the point of 9C.1 is behaviour at the production boundary, per the
  task's "Rejected operations" rule).

### Text flow diagram

```
 vitest.rules.config.ts  ──includes──►  rules.spec.ts (existing: ST write contract)
        │                               contract.spec.ts (NEW: player read + orchestration + propagation)
        │
 firebase emulators:exec (RTDB :9000, rules.json ENFORCED, singleProjectMode)
        │
 initializeTestEnvironment(projectId, database{host,port,rules:rules.json})
        │
   ┌────┴───────────────────────────── identities ─────────────────────────────┐
   authenticatedContext("uid-storyteller")            authenticatedContext("uid-alice")
   .database()                                        .database()
   │                                                  │
   new FirebaseRoomBackend(db)  ── REAL adapter ──    new FirebaseRoomBackend(db)
   │                                                  │
   createLobby → SessionWriter.start (REAL lease/guard)   joinLobby (REAL)
   writer ► writeProjections (REAL chokepoint)            startPlayerHandshake (REAL subscribe/validate)
   startStorytellerSession (REAL orchestration)           │
   │                                                  usePlayerStore  ◄── assert status/self/remoteData
   └──────────── RTDB emulator enforces rules.json ───────────────┘
                     (permission_denied is produced by REAL rules)
```

---

## 6. Mocking Boundary

Strict. "Real" = exercised as in production. "Substituted" = replaced, with
justification that it does **not** touch the thing under verification.

| Component | Real / Substituted | Why |
| --- | --- | --- |
| Firebase Security Rules (`rules.json`) | **Real** | This is the contract. Loaded and enforced by the emulator. |
| RTDB data store | **Real (emulator)** | Reads/writes/denials must be produced by the real database, not a tree. |
| `FirebaseRoomBackend` adapter | **Real** | The exact production read/write/subscribe surface + error shape. |
| `SessionWriter` lease + `writeGuard` fence | **Real** | The fence the rules require; its retry is a false-positive risk to prove out. |
| `writeProjections` + projection builders | **Real** | The publication chokepoint and allowlist. |
| Player handshake / ST orchestration / membership-commit commands | **Real** | These are the subjects of 9C.1. |
| Snapshot decoders + stores | **Real** | Domain outcome under test. |
| Error translation (`errors.ts`, `lifecycle.ts`) | **Real** | Propagation assertions. |
| **Firebase Auth token acquisition** (`signInAnonymously`, `ensureAuthUid`, `initFirebase`, Auth emulator) | **Substituted** — `authenticatedContext(uid)` mints the token | Rules only read `auth != null`, `auth.uid`, and `auth.token.firebase.sign_in_provider`. `authenticatedContext` injects a faithful token with an explicit, deterministic UID and (optionally) the anonymous provider claim. It substitutes **how a UID is obtained**, never **rules enforcement**. The Auth emulator is *not* configured (`firebase.json`) and not needed — adding it would only make identities non-deterministic. |
| React `useEffect` wrappers `usePlayerSync`/`useStorytellerSync` | **Substituted** — call bare `startPlayerHandshake`/`startStorytellerSession` | The wrappers only manage effect lifetime; the bare functions carry all logic and accept an injected backend (already the pattern in `lifecycle.test.ts`). Avoids a DOM/E2E runtime. |
| `connectFirebase`/`getActiveBackend` singleton | **Substituted** — direct injection | `initFirebase` does **not** connect to the emulator; using the singleton would either hit real Firebase or require production changes. Injection reaches the same code with enforced rules. |
| `onDisconnectSet` firing on real socket loss | **Partially real** — the arming write is real; the disconnect *event* is not forced | The emulator fires on-disconnect only on real socket teardown. Presence *heartbeat* writes (`set(presence/{uid})`) are real and rule-checked; forcing the disconnect event is out of scope for the contract and belongs to presence unit tests. |
| Wall clock / `setTimeout` backoff | **Real** | Lease timing uses server offset via `.info/serverTimeOffset` (`writer.ts:39`); real timers keep the emulator's time authoritative. Fake timers only if a test must force lease expiry — prefer `withSecurityRulesDisabled` to set `writer/expiresAt=0` exactly as `rules.spec.ts:386,534` does. |

**Absolutely must not be mocked:** the rules, the database, `FirebaseRoomBackend`,
the writer fence, `writeProjections`, the player handshake's subscribe/validate,
and the error classification. Mocking any of these mocks the thing under test.

---

## 7. Required Test Matrix

Identities: `ST` (owner), `A`/`B` (players), `NM` (authenticated non-member),
`GUEST` (unauthenticated). Keep **P0 compact** — it targets only the residual
gap; it does **not** re-prove the ST write contract already in `rules.spec.ts`.

| ID | Scenario | Identity | Expected result | Why required |
| --- | --- | --- | --- | --- |
| **P0-1** | Full positive loop: `createLobby`+`SessionWriter.start`+`seatPlayer(writer)`+`writeProjections` (host) → `joinLobby`+`startPlayerHandshake` (A) | ST + A | A's store reaches `status:"seated"`, `self` = projected shown identity, `remoteData.self:"ready"`, `public:"ready"` | Proves the **player read pipeline** agrees with rules on the authorized path (the currently uncovered half). |
| **P0-2** | Revocation propagation: host `revokePlayerAndCommit(writer)` while A's handshake is live | ST + A | A's live `player/{id}` read is denied by rules; A's store converges to `status:"revoked"`, `self:null`; A cannot re-`joinLobby` (outcome=revoked) | Proves a **real denial propagates** through the real client to the correct domain terminal state — the core "rejected operations propagate" requirement. |
| **P0-3** | Player cannot publish ST-owned state: A's backend calls `writeProjections`/`seatPlayer`/`revokePlayerMembership` | A | Each **rejects** (permission_denied); `friendlyFirebaseError` → "permission denied"; no `public/*`,`player/*`,`roster/*` mutation occurs | Proves the projection/membership **write** chokepoint is closed to players **through production code**, not just raw refs. |
| **P0-4** | Orchestration flush under enforced rules: `startStorytellerSession(host, lobby, writer)` initial `flush(true)` | ST | Resolves; `checkpoint`/`public`/`storyteller`/`player/*` written; `useSessionRuntime.error === null` | Proves the **real orchestration** (not just direct `writeProjections`) agrees with rules incl. the acknowledged-checkpoint gate. |
| **P0-5** | Forbidden-path regression tripwire: with the real writer, attempt a projection update that writes a rules-prohibited path (e.g. `player/{unbound-id}` or an out-of-fence write) | ST(writer) | Emulator rejects; the `writeProjections`/`flush` promise **rejects** (does not resolve); `useSessionRuntime.error` set | The literal OPUS-007 tripwire at the orchestration boundary: a future client change that reaches a prohibited path **fails the suite**. |
| **P0-6** | Denial is not swallowed: force a denied ST write (expired lease via `withSecurityRulesDisabled` `writer/expiresAt=0`) through `writer.commit` | ST | The op **rejects**; guard-receipt retry does **not** report success; `isTransient` false ⇒ no network retry | Guards the specific false-positive sites in `writer.ts` (Section 11). |

| ID | Scenario | Identity | Expected | Why (P1 — strongly recommended) |
| --- | --- | --- | --- | --- |
| P1-1 | Waiting player: `joinLobby` only (no seat) | A | `status:"waiting"`; can read `public` (request holder); cannot read `player/*` | Proves the pre-seat identity's authorized read set. |
| P1-2 | Ended propagation: host `writer.close()` while A live | ST + A | A converges to `status:"ended"`; new `joinLobby` denied | Session-terminal read/deny path through production. |
| P1-3 | Leave→revoke reconciliation: A `leaveLobby` → orchestration `leaveRequests` watcher → `revokePlayerAndCommit` | ST + A | Binding + `player/{id}` cleared; A → `revoked`/reset | Exercises `membershipCommands` + orchestration against rules. |
| P1-4 | Takeover recovery: second `startStorytellerSession` after seeding a `checkpoint`+`roster`, first writer expired | ST | Reconciles roster, revokes unresolvable binds, re-acquires writer, re-flushes; no denied read leaks | The recovery flow touches many guarded paths; memory-only today. |
| P1-5 | Stale/second Storyteller tab | ST(2 writers) | Second `writer.start()` conflicts until expiry, then fences the old token | Confirms orchestration-level fencing end-to-end (writer unit already in `rules.spec.ts`). |

| ID | Scenario | Identity | Expected | Why (P2 — useful, not required for closure) |
| --- | --- | --- | --- | --- |
| P2-1 | Authenticated non-member reads `public` | NM | **Denied today** (records current behaviour; flips when OPUS-002 lands) | Makes the harness able to prove the later OPUS-002 fix (Section 9). |
| P2-2 | Presence heartbeat write + ST parent read | A + ST | A writes own `presence/{uid}`; ST reads parent; A cannot enumerate | Presence contract through production (`startPresence`). |
| P2-3 | Snapshot-invalid handling on a real malformed node | A | `remoteData.self:"invalid"`, handshake keeps listening | Validation boundary against real transport. |
| P2-4 | Cross-lobby isolation via production reads | A | Lobby-B reads denied | Corroborates `rules.spec.ts` at the handshake layer. |

---

## 8. Projection Contract Tests

Goal: prove agreement between **production `writeProjections`**, the **Firebase
paths**, the **rules**, and the **Storyteller writer authority** — at the
*orchestration* boundary, without duplicating the field-allowlist unit tests
(`sync.test.ts`) or the writer-path AUD tests (`rules.spec.ts`).

Construction (fact about the code being exercised):
- Authorized write: `SessionWriter.start()` acquires the lease; `writeProjections`
  → `SessionWriter.update` → `commit` attaches `{ writeGuard:{ token, revision } }`
  → `FirebaseRoomBackend.update` → emulator. Rules require owner + active v2
  session + unexpired lease + matching token + strictly-increasing revision
  (`rules.json` `public`/`player`/`storyteller`/`checkpoint` write clauses). The
  test asserts the authorized publish **succeeds** and A reads the projected self.
- Unauthorized write: the same `writeProjections` called with a **player** backend
  (P0-3) or with an **expired lease** (P0-6) must **reject**. The promise rejecting
  — not a raw `assertFails` — is the assertion.

**Deliberate regressions that MUST turn these red** (this is the OPUS-007
tripwire, made concrete):
1. Adding a projection target outside the writer fence (e.g. writing `public`/`player`
   without going through `SessionWriter`/`writeGuard`) → rule denies → `flush`
   rejects (P0-5).
2. Publishing a `player/{id}` for an id with no authoritative `roster` binding
   readable by any seated UID, or writing to a path the player-read rule would
   later reject → the write rule (owner-fenced) still guards the *write*, and the
   *read* half is caught by P0-1/P0-2 when the intended reader is denied.
3. Advancing `writeGuard.revision` non-monotonically, or reusing a stale token →
   denied (already in `rules.spec.ts:558`; retained implicitly via the real writer).
4. A client change that makes the player handshake subscribe to a *new* path
   (e.g. reading `storyteller` or another player's `player/{x}`) → the real
   subscription errors with permission_denied → P0-1/P1-1 fail because the store
   never reaches the expected clean state (the denial surfaces via
   `remoteData`/`status:"error"`).

The last point is why the player-read tests are the load-bearing addition: they
convert "the client started touching a forbidden path" into a **red domain
outcome**, which is exactly what OPUS-007 asks for on the read side.

---

## 9. Authorization and Identity Matrix

Fact — derived by tracing `rules.json` against the paths each identity's
production flow touches. "Read/Write" = what the **rules** permit today.

| Identity (rules predicate) | Reads permitted | Writes permitted | Denied (key) |
| --- | --- | --- | --- |
| **Unauthenticated** (`auth == null`) | none | none | everything (`auth != null` fails everywhere) |
| **Authenticated non-member** (`auth!=null`, no request/roster/outcome) | `storytellerUid`, `session` | own `joinRequests/{uid}` create (→ waiting); own `presence/{uid}` only with active membership/request (else only `online:false`) | `public` (**denied** — needs member/request), all `player/*`, all collections, `roster/*`, `storyteller`, `writer`, `writeGuard`, `checkpoint` |
| **Waiting / join-request** (`joinRequests/{uid}` exists) | + `public`, own `joinRequests/{uid}`, own `outcomes/{uid}` | own request cancel; own `presence/{uid}` | others' requests/roster/player; collections; ST paths |
| **Seated player** (`roster/{uid}==id`) | + own `roster/{uid}`, own `player/{id}`, `public` | own `leaveRequests/{uid}=true`; own `presence/{uid}`; (no new request — seated) | other `player/{x}`, any collection read, `roster` writes, `storyteller`, `checkpoint`, `writer`, `writeGuard`, forging `outcomes` |
| **Revoked player** (roster removed, `outcomes/{uid}=="revoked"`) | own `outcomes/{uid}`; `session` | none meaningful | `player/{id}` (**now denied** — binding gone); new `joinRequests/{uid}` (outcome exists); `public` (no longer member) |
| **Storyteller** (`storytellerUid==auth.uid`) | entire `lobbies/{code}` subtree | `storytellerUid` claim (setIfAbsent) + `session` create; all guarded writes **iff** active v2 session + unexpired lease + matching `writer.token` + strictly-increasing `writeGuard.revision` | writes when lease expired / token mismatched / revision not advanced; deleting/transferring `storytellerUid` |
| **Stale / non-owner ST session** (owner uid, expired or replaced lease) | reads OK | writes to fenced paths **denied** until lease reacquired; concurrent second tab denied until expiry | any guarded write with stale token/revision |
| **Public-display identity** (today = authenticated non-member) | `storytellerUid`, `session` | — | `public` (**denied**) — this is the OPUS-002 surface |

Note (fact): the roadmap's list of identities is satisfied; the harness carries an
explicit `NM` identity so the OPUS-002 fix is later provable (Section 12/17).

---

## 10. Negative / Adversarial Cases

Focus on realistic **client-vs-rules mismatches**, not re-listing rule unit
tests. The harness must make each of these **red** if it ever regresses:

1. **Player handshake reaches a forbidden path.** Run the real
   `startPlayerHandshake` for A (waiting, seated, revoked). If any installed
   subscription is denied for that state, the store must show it
   (`remoteData.* !== "ready"` / `status:"error"`) — a green "seated+ready" while a
   read is actually denied is the failure to catch. (P0-1, P1-1.)
2. **Revoked client keeps stale access.** After `revokePlayerAndCommit`, A's live
   `player/{id}` read must be denied by rules and A must land in `revoked`; A must
   not be able to re-`knock` (outcome) or read `public`. A green "still seated" is
   the adversarial failure. (P0-2.)
3. **Player publishes ST state.** A calling `writeProjections`/`seatPlayer`/
   `revokePlayerMembership` must **reject**; a swallowed/absorbed rejection that
   leaves the promise resolved is the failure. (P0-3.)
4. **Denial masked by retry / guard-receipt.** A denied ST write (expired lease)
   must reject; `retryTransient` must not retry it (`isTransient`=false for
   permission), and the guard-receipt short-circuit in `writer.commit` must not
   treat "no receipt because the write was denied" as success. (P0-6.)
5. **Orchestration flush reaches a forbidden path.** A projection payload that
   escapes the fence or targets a prohibited path must make `flush` reject and set
   `useSessionRuntime.error`. (P0-5.)
6. **Admin/rules bypass leaking into a subject test.** Any use of
   `withSecurityRulesDisabled` is confined to *seeding preconditions* (e.g. forcing
   `writer/expiresAt=0`); the **asserted** operation always runs through an
   authenticated context with rules on. A test that both seeds and asserts under
   disabled rules proves nothing and must be treated as a defect.

---

## 11. Error Propagation Requirements

Fact — how a raw RTDB denial becomes a domain outcome, traced through the code:

- **Raw shape.** RTDB client rejects with `code:"PERMISSION_DENIED"` /
  `message:"permission_denied at /path"`. Surfaces from `FirebaseRoomBackend`
  `update/set/get`, and from `subscribe`'s `onError`.
- **Transient classification.** `isTransient` (`lifecycle.ts:27`) returns **false**
  for `/permission|invalid|unauthorized/`. Therefore `retryTransient`
  (`lifecycle.ts:39`) and `SessionWriter.commit`'s retry (`writer.ts:125`) **do not
  retry** a denial — it propagates. **The harness must assert this** (a denied op
  rejects promptly, not after masking).
- **Writer guard-receipt.** On retry, `commit` reads `writeGuard`; it returns
  (success) only if a receipt with **its own token and the current revision**
  exists (`writer.ts:128–132`). A denied write leaves no such receipt, so this
  cannot convert a denial into success — **assert it explicitly** (P0-6), because
  this is the most subtle false-positive site.
- **Player domain mapping.** `joinLobby` catch (`playerSync.ts:36`) maps
  `LifecycleError` kinds `notFound/rejected/revoked` (and `ended`) to store status,
  else `"error"` with `lifecycleMessage`. In the live handshake, a denied
  subscription runs `watch` `onError` → `fail` (`status:"error"`) →, since
  non-transient, `schedule()` → `reconcile()`, which reads `outcomes/{uid}` and
  calls `terminal("revoked"/"rejected"/…)`. **Contract:** a real revoke yields
  `status:"revoked"`, not a stuck `"error"`/`"seated"`. (P0-2.)
- **Storyteller domain mapping.** `flush` reports via `report("write", error)` →
  `useSessionRuntime.error = lifecycleMessage(error)`; `startStorytellerSession`
  rethrows on the **initial** flush (`storytellerSync.ts:142–145`). **Contract:**
  a denied publish sets `useSessionRuntime.error` (and rejects the initial flush),
  never silently resolves. (P0-4/P0-5.)
- **UI translation.** `friendlyFirebaseError` (`errors.ts`) maps
  `PERMISSION_DENIED`→"Firebase permission denied" with audience-specific guidance.
  P0-2/P0-3 may additionally assert `friendlyFirebaseError(err).title` for the
  player audience.

**Swallowed/ambiguous errors to watch (call-outs):**
- `startPlayerHandshake.stop()` intentionally swallows the presence-clear failure
  (`playerSync.ts:91` `catch {}`) — acceptable (device teardown), but the harness
  must not rely on that write, and must assert the *terminal status* instead.
- `watch`'s transient-retry branch (`playerSync.ts:117`) retries **read** errors up
  to 3× before reconciling; a *permission* error is non-transient and must fall to
  `schedule()` immediately — assert convergence, not timing.

---

## 12. Files Likely to Change (implementation phase — do NOT edit now)

- **Add** `src/firebase/contract.spec.ts` — the new contract suite (only real
  production imports + rules-unit-testing).
- **Add (optional)** `src/firebase/contractHarness.ts` *or* extend
  `src/test/fixtures.ts` — shared emulator/env bootstrap, identity/backends
  factory, store-convergence poll helper, deterministic teardown. Prefer a small
  test-only helper; must not import into production bundles.
- **Edit** `vitest.rules.config.ts` — widen `include` to `src/firebase/*.spec.ts`
  (or add the file). No other test-config change.
- **Possibly edit** `package.json` — only if a convenience alias is wanted; **not
  required** (`test:rules`/`test:full` already cover new `*.spec.ts`).
- **Docs** — this file; optionally a line in `SETUP.md`/`PATH_AUDIT.md` noting the
  contract suite.

No production `src/**` module needs to change to build the harness (all subjects
already accept an injected `RoomBackend`). If implementation reveals a subject
that cannot be reached without a production change, that is a finding to escalate,
not to patch silently (Constraints / no test-only backdoors).

---

## 13. Files That Should NOT Need Architectural Changes

Guard against scope creep — these stay untouched unless implementation proves
otherwise:

- `src/firebase/rules.json` — **do not weaken.** The contract enforces it.
- `src/firebase/firebaseBackend.ts`, `backend.ts`, `memoryBackend.ts` — the seam
  already exists; no new methods.
- `src/firebase/writer.ts`, `sync.ts`, `lobby.ts`, `membershipCommands.ts`,
  `lifecycle.ts`, `snapshots.ts`, `errors.ts` — subjects, not to be modified to
  suit tests.
- `src/firebase/playerSync.ts`, `storytellerSync.ts` — bare functions are already
  injectable; **no** new test-only export/hook.
- `src/firebase/session.ts` — the singleton path is bypassed, not extended
  (`__setActiveBackendForTests` already exists if ever needed).
- `src/stores/*`, `src/features/*` UI — out of scope.
- `rules.spec.ts` — the existing ST-write contract; **do not duplicate or
  refactor** its coverage into the new suite.

---

## 14. Acceptance Criteria (objectively verifiable)

OPUS-007 is closable when **all** hold:

1. **Real client code.** The suite imports and invokes production
   `startPlayerHandshake`/`joinLobby`/`leaveLobby`, `startStorytellerSession`,
   `writeProjections`, `SessionWriter`, and the membership commands — with **no**
   `MemoryRoomBackend` and **no** re-implementation of projection/handshake logic.
2. **Real Firebase rules.** The suite loads `src/firebase/rules.json` via
   `initializeTestEnvironment` and fails hard if the emulator host env var is
   absent/malformed.
3. **Real emulator enforcement.** Every asserted operation runs through an
   `authenticatedContext`/`unauthenticatedContext` with rules **on**; admin/
   `withSecurityRulesDisabled` appears only in precondition seeding, never around
   the asserted op.
4. **Positive auth path.** P0-1: a real join→seat→publish→read loop leaves the
   player store `seated` with the correct `self` and `remoteData.*:"ready"`.
5. **Negative auth path.** P0-3: a player identity driving a projection/membership
   **write rejects**; and a player cannot read another player's private path
   through the real handshake.
6. **Real projection write.** P0-4/P0-5: an authorized `writeProjections` through
   the real writer/orchestration succeeds and is readable; a forbidden-path
   projection **rejects** and sets `useSessionRuntime.error`.
7. **Rejection propagation.** P0-2: a real revocation converges the player store to
   `status:"revoked"`, `self:null`, and blocks re-join — proving the denial reaches
   the domain layer, not just a raw error.
8. **No masking.** P0-6: a denied write is not retried (`isTransient` false) and the
   guard-receipt path does not report success.
9. **Deterministic execution.** `clearDatabase` per test, disposal of writers +
   handshakes, store resets, distinct codes; the suite passes repeatedly and in any
   order with zero cross-test leakage.
10. **Suite integrity.** `scripts/run-rules-tests.mjs` reports ≥1 test, zero
    skips/todos; `npm run test:full` (typecheck + fast + rules) is green; the fast
    `npm test` suite is unchanged and still excludes `*.spec.ts`.
11. **No browser E2E.** Achieved in the node emulator env; a browser framework is
    **not** introduced (need not proven).
12. **No production/security change.** `rules.json` unchanged; no test-only branch,
    hook, or privileged path added to production modules.

---

## 15. Recommended Implementation Sequence (smallest safe increments)

1. **Harness skeleton.** Add `contract.spec.ts` with `beforeAll` env-var guard +
   `initializeTestEnvironment(rules.json)`, `beforeEach clearDatabase`,
   `afterEach` disposal/reset, `afterAll cleanup`. Add the backends/identity
   factory (copy the shape from `rules.spec.ts:47–62`). Widen
   `vitest.rules.config.ts` include. Land with **one** trivial passing assertion to
   verify wiring and the `run-rules-tests.mjs` gate. Run `npm run test:rules`.
2. **P0-1 positive loop.** Add the join→seat→publish→read test + a bounded
   store-convergence poll helper. This de-risks all async/timing concerns first.
3. **P0-3 player-write denial** and **P0-6 no-masking** — small, fast, high-value
   negatives that need no player handshake.
4. **P0-2 revocation propagation** — the marquee read-denial→domain-state test
   (depends on P0-1 helpers).
5. **P0-4 / P0-5 orchestration flush + tripwire** — exercise
   `startStorytellerSession` and the deliberate forbidden-path regression.
6. **P1 set** (waiting, ended, leave→revoke, takeover, stale ST) once P0 is green.
7. **P2 set** — incl. the OPUS-002-recording `NM` public-read test (asserts the
   current deny; annotated to flip on the OPUS-002 fix).
8. **Docs** — note the suite in `SETUP.md`/`PATH_AUDIT.md`. Re-run `npm run
   test:full`.

Stop after P0 if time-boxed: P0 alone closes OPUS-007 per Section 14.

---

## 16. Risks and Open Questions

Only genuinely unresolved items:

1. **Async convergence without fake timers (implementation risk, not
   architectural).** The player handshake reconciles via real subscriptions +
   250·2ⁿ ms backoff. Recommendation: a bounded poll on store state (e.g. ≤2 s) with
   the emulator's low latency; avoid fake timers where they would freeze the
   emulator's `.info/serverTimeOffset`/lease clock. Resolvable in step 2.
2. **Two `RulesTestEnvironment`s in one emulator process** (`rules.spec.ts` +
   `contract.spec.ts`). Both `clearDatabase` in `beforeEach` and use distinct
   codes; RTDB `singleProjectMode` shares one namespace, so ordering isolation must
   come from cleanup, not separate projects. Low risk; verify in step 1.
3. **OPUS-002 boundary (record, do not fix).** The `NM`/public-display identity is
   denied `public` today. The harness carries `NM` so the later fix is provable;
   9C.1 asserts *current* behaviour only. — **OUT OF SCOPE — RECORD FOR LATER.**
4. **`onDisconnect` semantics.** The emulator won't fire on-disconnect without a
   real socket drop; presence-teardown assertions are excluded from the contract
   (heartbeat writes are covered). Confirm no P0 depends on it (none do).

Non-questions (repository already answers, do not re-litigate): backend
injectability (yes — every subject takes a `RoomBackend`); node-env viability
(yes — `rules.spec.ts` runs stores in node; Node v22 has Web Crypto; zustand
`persist` tolerates absent `localStorage`); rule-loading mechanism (yes —
`initializeTestEnvironment`); emulator lifecycle (yes — `emulators:exec` +
`run-rules-tests.mjs`).

---

## 17. Final Architecture Verdict

**READY FOR SOL IMPLEMENTATION CONTRACT** — with the scope corrected per Section 1
(the ST projection-write half is already proven by `rules.spec.ts`; 9C.1
implements the **player-read + orchestration + rejection-propagation** half).

Recommended architecture (≤10 bullets):

1. Add `src/firebase/contract.spec.ts` beside `rules.spec.ts`; widen
   `vitest.rules.config.ts` `include` to `src/firebase/*.spec.ts`. No new emulator,
   port, script, or production change.
2. Reuse `initializeTestEnvironment({ projectId:"demo-silverwick-rules",
   database:{ host, port, rules: rules.json }})`, node env, `clearDatabase`
   per-test, hard env-var guard — identical enforcement path to `rules.spec.ts`.
3. Identities via `authenticatedContext(uid)`/`unauthenticatedContext()` (mocks
   token acquisition only); carry `ST`, `A`, `B`, `NM`, `GUEST`.
4. Inject the **real** `FirebaseRoomBackend` into the **bare** production functions
   (`startPlayerHandshake`, `joinLobby`, `startStorytellerSession`,
   `seatPlayer(writer)`, `writeProjections(writer)`); never the singleton or React
   wrappers; never `MemoryRoomBackend`.
5. Establish the Storyteller via real `createLobby` + real `SessionWriter.start`
   so all ST writes carry the real lease + `writeGuard` fence.
6. Assert on **domain outcomes** (player-store `status`/`self`/`remoteData`,
   `useSessionRuntime.error`, rejected production promises, `friendlyFirebaseError`),
   using raw `assertFails` only as corroboration.
7. Keep **P0 to six tests**: positive loop, revocation propagation, player-write
   denial, orchestration flush, forbidden-path tripwire, no-masking.
8. Confine `withSecurityRulesDisabled` to precondition seeding; every asserted op
   runs with rules enforced under an authenticated identity.
9. Deterministic teardown: dispose writers, stop handshakes, reset all three
   zustand stores, distinct codes; suite passes in any order.
10. Gate on `npm run test:full`; leave the fast `npm test` suite and `rules.spec.ts`
    untouched. Do not weaken `rules.json` or add any test-only production path.

---

### Adjacent observations — OUT OF SCOPE, RECORD FOR LATER

- **OPUS-002 (public-display authorization).** `public` read requires member/
  request today; an authenticated public display is denied. The 9C.1 harness is
  designed to prove the fix later (identity `NM`), but must not implement it here.
- **`revokeMembership` vs `revokePlayerMembership` duplication** (`lobby.ts`).
  Two revocation entry points exist; `storytellerSync` uses the `*AndCommit`
  wrapper. Not a 9C.1 concern; note for a future consolidation review.
- **`FixtureWriter` in `rules.spec.ts`** fabricates `writeGuard` for seed-based
  membership tests (a test-only shortcut). Legitimate for pure rule checks, but a
  future cleanup could route more of those through the real `SessionWriter`; not
  required for OPUS-007.
