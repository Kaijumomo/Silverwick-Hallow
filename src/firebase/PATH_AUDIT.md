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

## What writes go where (verified by `sync.test.ts`)

`writeProjections` is the **single chokepoint** for any write outside
`storyteller/`. The MemoryBackend `writeLog` is asserted in tests to never
contain forbidden fields on `public/*` or `player/*`:

- `public/` forbidden: `actualRole`, `shownRole`, `shownAlignment`,
  `behaviorMode`, `privateInfo`, `stNotes`, `abilityUsed`, `statuses`,
  `reminders`, `bluffs`, `fakeMinions`
- `player/{id}/` forbidden: `actualRole`, `behaviorMode`, `privateInfo`,
  `stNotes`, `abilityUsed`, `statuses`, `reminders`
  (`shownRole`, `shownAlignment`, `bluffs`, `fakeMinions` are intentionally
  exposed on a player's *own* path — that's the projection's purpose)
