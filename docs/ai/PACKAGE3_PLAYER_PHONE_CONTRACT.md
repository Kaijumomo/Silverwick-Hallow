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

## C. Persistent per-participant information history (slice 3C, schema v28 -> v29)

**Supersedes** the "latest-only From the Storyteller" rule of 10H-AC-042 (F5): a player now sees every piece of private information the Storyteller sent them, night by night. Also supplies the data path the evil team screen needs (section B, "Open item"). Status: DRAFT for independent review. No code exists for it yet.

### C1. What is a history entry

Information reaches a phone only through the Storyteller's explicit, previewed, fingerprinted "Send" (`publishPrivatePacket`). Each successful send appends one entry to a new game-level, Storyteller-private, append-only log:

```
playerInfoLog: PlayerInfoEntry[]            // StorytellerLobbyRecord, required from v29
PlayerInfoEntry = {
  id: string                                // random uuid
  participantId: ParticipantId              // the recipient participation instance (never the seat / PlayerId)
  nameAtTime: string                        // ST-side display only, never projected
  moment: { phase: "setup" | "night" | "day"; day: number }
  shown: PlayerInfoContent                  // exactly what the player currently sees
  versions: PlayerInfoContent[]             // ST-only: every earlier `shown`, oldest first ([] until corrected)
}
PlayerInfoContent = { text?: string; demon?: {id,name,seat}; minions?: {id,name,seat}[]; bluffs?: RoleId[] }
```

`PlayerInfoContent` is the packet allowlist minus identity: the same fields `PlayerSelfRecordSchema` already admits (`extraText` is stored as `text`). Nothing else can be written: no Actual role/alignment, no Effects, no Storyteller notes, no other participant's identity. Content is validated with that schema both when appended and when corrected.

The publish action also keeps writing `publishedPacket` unchanged, so pre-v29 phones and the identity-match rule in `projectToSelf` behave exactly as before.

### C2. Team information (ordinary Minions and Demons)

A new private-information draft, `privateInfo.team: true`, asks the existing preview to fill `demon` / `minions` for that player from the same policy the Storyteller's setup views use (`infoModel` `demon` / `minion` views: `normalStartingInfo`, `automaticTeamInfo`, canonical characters only, no non-normal behaviour modes). Whatever those views refuse (small games, Magician, homebrew, ambiguity) the preview refuses with the same message; the Storyteller then uses the manual `extraText` path. Exactly one Demon is supported; zero or several fails closed. Names and seats only, never a teammate's character, never a Traveller. A Demon's bluffs keep using `privateInfo.bluffs`. Sending is the Storyteller's act, previewed and fingerprinted like every other packet; arriving or being seated never sends anything.

### C3. Corrections

One store command, `correctPlayerInfo(entryId, content)`: replaces `shown`, pushes the previous `shown` onto `versions`. In the player's view the entry is replaced silently (no marker, no notice, same `id` and `moment`). Refused unless the entry's `participantId` is the CURRENT occupant of a seat. A correction is not an identity change and never mints a reveal token.

### C4. Undo and Undo-like paths

Delivered information is never rewritten by Undo. Two layers:
1. As today, sending clears the Undo stack (`publishPrivatePacket`); `correctPlayerInfo` does the same, so no snapshot taken before a send or a correction can ever be restored.
2. `undo()` additionally carries the CURRENT `playerInfoLog` into the restored snapshot, so no restore path (including a recovery snapshot) can remove or revert an entry.

Entries are never deleted. The only mutation is C3.

### C5. Identity

Entries are bound to the participation instance (`participantId`), never to a seat or PlayerId. A seat taken by someone else, a rejoin after a revoke (a new participation) and a re-seat all start from an empty history: the former participant's entries stay in the Storyteller log and are never projected to anyone else. A reconnect of the same participation keeps its history. Identity changes (shown role / alignment) do not erase history: it records what the player was told. Limitation (by design): history follows the participation, not the human.

### C6. Projection and delivery

`player/{id}` (the existing self envelope) gains `history?: { id, moment, text?, demon?, minions?, bluffs? }[]`, in append order, containing only the `shown` content of entries whose `participantId` is the current occupant's. It is written only through `writeProjections` (single privacy chokepoint, writer-fenced), and only when the player's identity itself is being projected (the Setup all-or-none rule still withholds everything until roles are revealed). Caps: at most 100 entries per participant (the send is refused beyond that), text <= 4000 characters per entry (existing limit). No Rules change: `player/{id}` is already writable only by the fenced Storyteller writer and readable only by that player and the Storyteller, and its shape is not validated server-side. The client decoder (`snapshots.ts`) validates `history` strictly and fails closed (a malformed history is dropped, never partially shown).

Phone fallback for a pre-v29 Storyteller: no `history` -> the latest packet is shown as a single undated entry.

### C7. Migration v28 -> v29

Adds `playerInfoLog`. For each player with a `participantId` and a `publishedPacket`, one entry is backfilled from that packet (`forPhase` / `forDay` as the moment, `shown` = the packet's allowlisted content, `versions: []`). Earlier sends are unrecoverable and are not invented. A player without a participant or packet gets nothing. `MIGRATABLE_GAME_SCHEMA_VERSIONS` and `PREVIOUS_GAME_SCHEMA_VERSION` advance; the strict game schema rejects any other shape. Undo stack entries and the ended-game archive migrate the same way.

### C8. Phone rendering

The Character tab's "From the Storyteller" lists the player's entries by moment (Night 1, Day 2, ...), each as the design's `{ when, what }` rows. Team entries read "Your Demon: {name}, seat {n}" / "Your Minions: ..." and bluffs by character name. The evil team screen (3B) and the Character tab's team box are built from the most recent entry carrying `demon` / `minions` (and `bluffs`), not from the latest packet, so a later unrelated send never erases the team. If team information is sent after the player has entered the town, it appears in the Character tab; the ceremony screen is best-effort.

### C9. Required tests

Append-only (no entry removed, no foreign field accepted); correction silently replaces, `versions` keeps the original, never projected; correction refused for a departed participant; Undo after a later action leaves the log and the projected history unchanged, and Undo cannot restore a pre-send snapshot; seat takeover and rejoin show an empty history to the new participation while the Storyteller log keeps the old one; projection contains only the current occupant's `shown` content (and never `versions`, `nameAtTime`, `participantId`); Setup withholding; caps; malformed `history` dropped by the client; v28 -> v29 migration (backfill, honest gaps, idempotent, strict schema); team preview parity with the setup views (refusals included); a real-Rules emulator test that a player can read their own `history` and not another's, and cannot write it.
