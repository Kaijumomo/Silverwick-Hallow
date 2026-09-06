# Lobby protocol — load-bearing decisions

These decisions are not negotiable without revisiting the privacy boundary.

## Request and membership paths

Names and authoritative IDs have separate paths. See
[MEMBERSHIP_MIGRATION.md](MEMBERSHIP_MIGRATION.md) before deploying this protocol.

| Path in `lobbies/{code}` | Meaning and access |
| --- | --- |
| `storytellerUid` | Caller claims a completely new lobby as themselves; the owner cannot be transferred/deleted by clients |
| `joinRequests/{uid}` | Untrusted name, 1–20 characters, no surrounding spaces, tabs or line breaks. Own create/cancel; ST may delete. Read by own UID and ST |
| `roster/{uid}` | Player ID, always ST-written. Read by own UID and ST |
| `public` | ST-written public projection; ST, request holders and members may read |
| `player/{playerId}` | ST-written private projection; ST or matching same-lobby roster UID may read |
| `storyteller` | ST-only full state |
| `presence/{uid}` | Existing presence behavior, unchanged in this pass |

The player calls `knockOnLobby`, which reads their own binding for reconnect
and otherwise creates an absent request. The rules independently enforce an
existing owner, a lobby not marked ended, no existing binding, and bounded text.
A request that happens to equal a real player ID is still only a name.

The Storyteller watches `joinRequests` for the pending queue and `roster` for
bindings. Manual seating calls `seatPlayer`, which atomically deletes the
request, writes the roster binding, and writes the private projection if present.
A seat without a role retains the existing null-projection placeholder behavior.
There is no name-versus-ID classification heuristic.

Player hooks watch the own request and own binding independently. Public access
starts after a request or binding is observed; private access starts only from
the binding. `cancelJoinRequest` removes a request; `revokeMembership` removes
the binding and Firebase cancels further private access. These helpers do not
wire new undo/removal/rejection UI in this pass.

## Why we don't use `playerId === uid`

Two reasons:
1. The ST can pre-populate seats *before* anyone joins (e.g., setup with 8
   placeholder seats from prior games), and these seats have stable UUIDs
   that have no auth identity.
2. A player who refreshes (and re-runs anonymous auth) gets a *new* uid. If
   `playerId === uid`, the player would lose their seat on refresh. With the
   roster binding, we can also let the player's seat survive a re-auth by
   ST re-binding `roster/{newUid} → existing playerId`. (This piece — the
   re-bind UX — is in 5c, not 5a.)

## Reconnect policy

**ST refresh:** *local store wins.* The ST is the only writer to `storyteller/`,
`public/`, and `player/{...}`. On refresh, the ST app:
1. Restores from localStorage (Zustand persist, already present).
2. Re-authenticates anonymously (uid stable across refresh in the same
   browser, but treat it as if it could change).
3. Re-establishes sync by calling `writeProjections` once with the local
   state. This re-uploads everything; any racing roster knock from a player
   that arrived during the refresh is read after sync starts.
4. Subscribes to `joinRequests/` to pick up pending requests that landed during
   the refresh.

This means: an ST refresh during gameplay does not lose ST state, but a
roster join request that arrived *during* the refresh is processed when the
ST app sees it after reconnect. There is no merging of state — local always
wins because there is no other writer.

**Player refresh:** *remote wins.* The player has no canonical state of
their own to merge — they are a pure consumer of the projection. On refresh:
1. Re-authenticate anonymously.
2. Read `roster/{uid}` to discover own playerId (or rebind if needed).
3. Subscribe to `player/{playerId}` and `public/`.

## Write amplification — the strategy is "full projection on every change, debounced 200ms"

`writeProjections` writes the full lobby projection on every call. We do not
diff per-player.

Rationale:
- A status-chip toggle and a role assignment both go through the same write.
  Predictable cost is better than a complex diff that might miss an edge.
- The projection functions are pure and deterministic given the input state,
  so re-running them is cheap.
- 200ms debounce prevents UI scrubbing (drag-reorder, fast toggling) from
  saturating the write rate.

To revisit if write costs become a real concern: implement per-path diff in
`writeProjections` while keeping it as the sole API. Callers don't change.

## TOCTOU on code generation

Use `setIfAbsent(lobbies/{code}/storytellerUid, uid)` (Firebase
`runTransaction`) to claim a lobby. If the transaction returns
`{ committed: false }`, regenerate a new code and retry. Never:

- Read code → check absent → write (TOCTOU race; two STs can claim the same
  code in parallel).
- Use a fixed code for testing — collision rate too high.

The 4-character random code from `[BCDFGHJKLMNPQRSTVWXYZ23456789]` (no
ambiguous-glyph chars) gives ~16M codes. Realistic collision rate at this
scale is negligible, but the transaction is the seatbelt.

## Lobby TTL — there is none

Firebase Realtime Database has no built-in TTL mechanism for arbitrary paths.
Lobbies are not automatically deleted after they end.

**What we do:** When the ST calls `endLobby`, we:
1. Write `public/status = "ended"` (immediate signal — players redirect).
2. Null `storyteller/` and `player/{id}/` paths (scrub private data, best-effort).

**What we do NOT do:** Delete `public/`, `roster/`, or `lobbies/{code}` itself.
Players need a roster entry to read `public/` (rules gate), so leaving roster
intact is correct. The top-level lobby node (and public/) can linger
indefinitely without creating a privacy or cost problem at typical usage scales.

**Future option:** A Cloud Function with a daily cleanup sweep could delete
ended lobbies older than N hours using a timestamp field. Not implemented —
the added complexity isn't justified until lobby volume becomes a concern.

## The privacy chokepoint

All writes outside `storyteller/` go through `writeProjections` in
`sync.ts`. There must be no other call site that touches `public/...`,
`player/{...}/...`, or `roster/{...}` *except* the join-protocol paths
described above.

The `sync.test.ts` suite asserts this is true at the unit-test layer by
inspecting `MemoryRoomBackend.writeLog`. Adding a new sync write *without*
adding it to the test suite is a code-review-blocking change.
