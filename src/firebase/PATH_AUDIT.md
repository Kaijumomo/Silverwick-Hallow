# Firebase path/rule audit

Membership paths below describe the AUD-001 implementation. Existing deployments
must follow [MEMBERSHIP_MIGRATION.md](MEMBERSHIP_MIGRATION.md); old client-written
roster entries are not evidence of valid membership.

| Path within `lobbies/{code}` | Used by | Read by | Write by / validation |
| --- | --- | --- | --- |
| `storytellerUid` | `createLobby`, authorization rules | Authenticated clients | Caller claims a completely new lobby as themselves; owner can repeat that value, not delete or transfer it |
| `joinRequests` | `watchJoinRequests` | ST | No parent write |
| `joinRequests/{uid}` | `knockOnLobby`, `cancelJoinRequest`, `seatPlayer`, player hook | ST or same UID | Own absent request in existing/non-ended lobby, no existing binding; 1–20 characters, no surrounding spaces, tabs or line breaks. Own cancellation or ST deletion |
| `roster` | `watchRoster` | ST | No parent write |
| `roster/{uid}` | `seatPlayer`, `revokeMembership`, player hook | ST or same UID | ST only; nonempty string player ID or deletion |
| `public` | Projections, player/public hooks | ST, own pending request, or own roster membership | ST only |
| `player/{playerId}` | Projections, `seatPlayer`, player hook | ST or exact same-lobby UID→playerId binding | ST only |
| `storyteller` | Projections | ST | ST only |
| `session` | Lifecycle identity/state | Authenticated clients | Owner creates active v2 record; writer-fenced owner transitions it to ended |
| `writer` / `writeGuard` | Single-writer lease and monotonic fence | Owner | Lease token/revision rules reject stale tabs and revisions |
| `outcomes/{uid}` | Durable rejected/revoked result | That UID | Storyteller writer only |
| `leaveRequests/{uid}` | Seated player's departure request | That UID and ST | Seated UID creates; Storyteller consumes |
| `presence` / `presence/{uid}` | Presence aggregate and heartbeat | ST parent / own child | ST reads parent; each UID reads/writes only itself |
| `displayAccess` | Public Display capability lifecycle (Phase 9C.6, OPUS-002) | Storyteller owner only | Fenced Storyteller `SessionWriter` only (same lease/writeGuard pattern as `roster`/`checkpoint`); shape is `{version, sessionId, token}` with a strong (32-byte, base64url) capability token; `sessionId` must equal the current `session/id` |
| `displayMembers/{uid}` | A display client's own enrollment binding | None required (no read rule at all) | Only the same authenticated UID; only while `session` is v2/active; only when the submitted value exactly equals the current `displayAccess/token` |

The Storyteller now subscribes to the exact `presence` parent authorized by the
rules (AUD-008). Player reads remain limited to their own child.

## Authorization invariant

A request is untrusted display text and is never used in a private-read rule.
Every authoritative roster write, including the first write, is ST-only.
A request named `p-alice` cannot authorize `player/p-alice`. Deleting a roster
binding revokes subsequent private access and cancels the authorized listener;
it cannot erase data already delivered to a device.

Only the owner writes public/private/ST projections. Player collection reads,
other UID bindings/requests, parent writes, transactions, and multi-path attacks
are exercised in the emulator suite. Rules, not client validation or the memory
backend, establish these permissions.

## Phase 9C.6 (OPUS-002): Public Display capability

Display membership grants `/public` only. It is not player membership. It
never authorizes private projections, `storyteller`, `checkpoint`, `roster`,
`joinRequests`, the `presence` parent, `displayAccess`, the `displayMembers`
collection, or another display's own binding. A UID authorized as a display
gains exactly one additional read branch on `/public`; every other rule is
unchanged for it.

`displayAccess` is Storyteller-owned security metadata, not game state — it
never enters `useStorytellerStore.game`, Zustand persistence, checkpoint
content, or any projection. Creation and rotation always go through the
already-live `SessionWriter`, using the same fenced conditions as every other
Storyteller write (active v2 session, valid unexpired writer lease, matching
`writeGuard` token, strictly advancing revision). `ensurePublicDisplayAccess`
is read-first: it reuses a valid current-session capability with zero writes,
and only commits when the record is absent, malformed, the wrong version, or
bound to a different session — a session mismatch is treated as rotation
(a fresh token, never the old one carried over) so a stale `displayMembers`
value can never reactivate under a later session.

`displayMembers/{uid}` write requires exact `isString()`/existence checks on
both the submitted value and the sibling `displayAccess` fields — a naive rule
comparing only `displayMembers/{auth.uid}.val() === displayAccess/token.val()`
would let two absent (`null`) paths satisfy `null === null` and authorize any
unrelated authenticated client; the explicit type/existence guards close that
hole (see rules.spec.ts's "closes the null===null hole" test). There is no
parent write rule on `displayMembers`, so a batch/parent write is always
denied regardless of content, and enrollment requires `newData.isString()`,
so a display client can never delete or overwrite its own or another UID's
binding through that rule.

Rotating the capability immediately revokes every existing display binding
without deleting or enumerating them: their stored token no longer equals the
current `displayAccess/token`, so `/public`'s rule denies them on their very
next read. Ending the session (`session/state !== "active"`) is the other
load-bearing revocation condition — `SessionWriter.close()` preserves the
session id while changing state to `"ended"`, so `sessionId` equality alone
is never sufficient; every display and enrollment rule also requires
`session/state === "active"`.

## What writes go where (verified by `sync.test.ts`)

`writeProjections` is the **single chokepoint** for any write outside
`storyteller/`. The MemoryBackend `writeLog` is asserted in tests to never
contain forbidden fields on `public/*` or `player/*`:

- `public/` forbidden: `actualRole`, `shownRole`, `shownAlignment`,
  `behaviorMode`, `privateInfo`, `stNotes`, `abilityUsed`, `statuses`,
  `reminders`, `bluffs`, `fakeMinions`
- `player/{id}/` forbidden: `actualRole`, `behaviorMode`, `privateInfo`,
  `stNotes`, `abilityUsed`, `statuses`, `reminders`
  (`shownRole`, `shownAlignment`, `bluffs`, `minions`, `extraText` are intentionally
  exposed on a player's *own* path — that's the projection's purpose)

## Phase 6: explicit private packets

Draft `privateInfo`, `packetEpoch`, and `publishedPacket`
metadata live only in Storyteller state and its owner-only checkpoint.
Drafts and previews are never copied to a player path by a normal sync.
`publishPrivatePacket` uses the existing session writer queue, authoritative
roster check, guarded atomic projection/checkpoint write, and retry receipts.
Only the sanitized payload is written to the intended player's existing path.
The internal draft key `fakeMinions` becomes neutral `minions` name/seat
snapshots; neither the key nor actual team identities are published.

Publication status means server acknowledgement, not player viewing or reading.
Ephemeral receipts are rebuilt by the acknowledged recovery flush. Reconnect
replays the saved published snapshot, not a newer draft. Identity changes
invalidate the packet. Membership removal still revokes the same paths.
No Firebase rule or authorization path was added.
