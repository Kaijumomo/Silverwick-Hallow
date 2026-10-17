# Package 3 — Player phone: contract changes

Scope: contract amendments approved by the Product Owner for Package 3. This file records only what changed; the Phase 10H contract stays the baseline. Sections are added per slice.

## A1. Public arrivals (slice 3A)

**Supersedes** the waiting-player rule of 10H-AC-028 (F6): a waiting player used to see only the already-seated public roster. A waiting player now also sees who has arrived.

**What is published.** Two optional fields on the existing public lobby record (`lobbies/{code}/public`):

| Field | Meaning |
| --- | --- |
| `arrivals` | Display names of the players currently joined, in arrival order. |
| `plannedPlayers` | The Storyteller's planned player count (the "M" in "N of M arrived"). |

**Rules.**

1. Published only while the game phase is `setup`. Outside Setup both fields are absent and the public roster is the table's public face.
2. Names only. No uid, no ParticipantId/PlayerId, no seat binding, no role, no Storyteller information. A client cannot tell which arrival is which uid; the waiting client finds its own row by the name it asked to join with.
3. A seated arrival is shown under the Storyteller's seat name; an unseated arrival under the name it requested. One uid is one arrival (re-knock or duplicate request never double counts).
4. "Currently joined" is the writer's existing runtime view (`useSessionRuntime.joined`): online and a heartbeat fresher than 45 s. A cancel, disconnect or silent heartbeat expiry removes the arrival, and the expiry timer itself triggers the republish.
5. Single authoritative writer: derived by `src/firebase/arrivals.ts`, projected by `projectLobbyToPublic`, written only through `writeProjections` (writer-fenced, same chokepoint as every other public view). Seating stays an explicit Storyteller act; arriving never seats anyone.
6. No Firebase Rules change: `public` is already readable by a lobby requester or roster member, writable only by the Storyteller, and its shape is not validated (`rules.spec.ts`, "public access follows request/membership, and only ST can write it").

**Tests.** `src/firebase/arrivals.test.ts` (derivation, privacy, setup-only, schema), `src/firebase/setupFlowLifecycle.test.tsx` ("public arrivals" — live writer publish, cancel/offline cleanup), existing `rules.spec.ts` public-read cases.
