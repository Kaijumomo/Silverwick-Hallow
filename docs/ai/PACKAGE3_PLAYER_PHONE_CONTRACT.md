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

## B. Pre-game ceremony (slice 3B)

Scope: what a seated phone shows between taking a seat and entering the game. No schema, Rules or wire change; everything below is client behaviour over the existing public lobby record and the player's own self envelope.

**Stages.** Circle -> sealed token -> (team) -> game. `showsPreGame` (src/features/player/phone/PreGameFlow.tsx) selects the ceremony while the phase is `setup`, while a Traveller still has to choose, or while the current identity (`revealToken`) has not been acknowledged. Anything else goes straight to the game shell.

**Re-seal.** The turned state, the stage and "entered" live only in component state. Nothing is persisted, so a reload (or a new `revealToken` mid-ceremony) returns to the circle with a sealed token. The sealed state contains no character text, art URL or ability in the page; the face is mounted only while the token is turned (and for the 1 s it takes to turn back).

**Acknowledgement.** `acknowledgeReveal` is called the first time the token is turned face up and never again for the same token (the existing per-token ack, advisory only). Turning it back and over again does not re-send. A changed identity is a new token: the circle then shows only the neutral "the Storyteller has updated your character", never what changed.

**Circle.** Public data only: seat numbers, names, count, script name. Neighbours are the previous and next seat in seat order, wrapping.

**Evil team (D2).** The screen is built from the self packet alone (`teamOf`): `demon` -> Demon, `minions` -> Minion, `bluffs` -> the Demon's bluffs. It shows name, seat and the Minion/Demon designation with a generic team icon, never a teammate's character, and appears only when the packet carries team or bluff information; otherwise the player goes straight in. Travellers never get it (their Demon information stays under From the Storyteller). Small-game restrictions are inherited, not recomputed: the Storyteller's own information rules (`infoModel`) decide what is given.

**Open item for the 3C contract.** Today an ordinary Minion's or Demon's packet carries no team data: starting team information is shown on the Storyteller's device (`infoModel` setup views), and `demon` / `minions` are only populated for a Traveller's Demon and a fake-Demon. The team screen therefore appears for those cases now, and for ordinary evil players once team information is delivered to the phone. That delivery is the same persistent per-participant delivery channel the history contract (3C, D3) must define, so the data path (what is delivered, when, how a correction or Undo treats it) is specified there, not improvised here.

**Traveller.** The circle offers "Choose your Traveler" while `isTraveler && !publicDisplayRole`; one tap sends the choice (`chooseTraveler`), a pending request is immutable until the Storyteller clears it, and applying the choice (public role set, identity delivered) moves straight to the sealed token. Traveller art is the neutral icon (`travellerArt`).

**Tests.** `src/features/player/phone/preGame.test.tsx`, plus the rewritten 10H reveal tests in `phase10hPlayerPhone.test.tsx` and Traveller tests in `PlayerScreen.test.tsx`.
