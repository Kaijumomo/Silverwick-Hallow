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

**Supersedes** the "latest-only From the Storyteller" rule of 10H-AC-042 (F5): a player sees every piece of private information the Storyteller sent them, night by night. Also supplies the data path the evil team screen needs (section B, "Open item"). Status: REVISION 2, amended after independent review 1 (findings M1-M5, R1-R5 folded in below), awaiting independent review 2. No code exists for it yet.

**Superseded rules and tests** (to be rewritten, not deleted): 10H-AC-042 "latest-only From the Storyteller / no history list" (`phase10hPlayerPhone.test.tsx`, "the latest private information appears once revealed ... no history list"); the A1/3B reading of "From the Storyteller" as the latest packet only; 3B `teamOf` (reads the packet, will read `history`).

### C1. What is a history entry

Information reaches a phone only through the Storyteller's explicit, previewed, fingerprinted "Send" (`publishPrivatePacket`). Each successful send appends one entry to a new game-level, Storyteller-private, append-only log:

```
playerInfoLog: PlayerInfoEntry[]            // StorytellerLobbyRecord, required from v29
PlayerInfoEntry = {
  id: string                                // uuid, unique in the log
  recipient: CurrentParticipantRef          // { kind:"participant", participantId, playerId, nameAtTime }; never a bare seat
  moment?: { phase: "setup" | "night" | "day"; day: number }   // absent only for migrated entries with no known moment
  shown: PlayerInfoContent                  // exactly what the player currently sees
  versions: PlayerInfoContent[]             // ST-only: earlier `shown` values, oldest first, at most 10
}
PlayerInfoContent = { text?: string; demon?: {id,name,seat}; minions?: {id,name,seat}[]; bluffs?: RoleId[] }
```

`PlayerInfoContent` has its OWN strict schema (`PlayerInfoContentSchema`), not the packet schema: `text` 1..4000 characters (a hard limit, unlike the UI-only `slice` on `extraText`), `minions` at most 20, `bluffs` at most 5, at least one field present, no unknown keys. `extraText` of the packet maps to `text`. Nothing else can be written: no Actual role/alignment, Effects, Storyteller notes or other participant's identity.

`publishedPacket` keeps being written unchanged, so pre-v29 phones and the identity-match rule in `projectToSelf` behave as before. The phone ignores root packet fields whenever `history` is present (C6).

### C2. Team information (ordinary Minions and Demons)

A new private-information draft, `privateInfo.team: true`. Applicable ONLY to a seated, non-Traveller player whose actual type is Minion or Demon, `behaviorMode === "normal"`, with no simulated identity; mutually exclusive with `fakeMinions` and `travelerDemon` (`getPrivateInfoApplicability`, `hasPrivateDraft` and `pruneInapplicablePrivateInfo` gain a `team` flag). The preview is a pure function `teamInformationFor(game, script, registry, recipientId)` extracted from the `infoModel` setup views so both share one policy, returning `{ demon, minions }` with player id, name and seat (never a character). It fails closed on every refusal the setup views produce (`normalStartingInfo` false, e.g. fewer than 7 residents without Toymaker; `automaticTeamInfo` false; non-canonical roles; any Minion/Demon with a non-normal behaviour mode, covering Marionette; Poppy Grower and the other complex characters), and ALSO on: any living Magician (stricter than the views, which add them), anything other than exactly one Demon, the recipient appearing among their own minions, and more minions than the schema bound. The Storyteller then uses the manual `extraText` path. Team content is the roles at send time; sending after Setup is allowed and records the then-current roles. A Demon's bluffs keep using `privateInfo.bluffs`. Sending is the Storyteller's act, previewed and fingerprinted like every packet; arriving or being seated never sends anything. The stored `seat`/`name` are a snapshot "as told": the phone renders them as stored and never joins them to the live roster.

### C3. Corrections

One store command, `correctPlayerInfo(entryId, content)`. `content` must pass `PlayerInfoContentSchema` (so not empty). It replaces `shown`, pushes the previous `shown` onto `versions` (refused beyond 10), and, when the entry is the participant's latest, updates `publishedPacket.payload` in the same commit (keeping its `id`) so the root packet and `history` never disagree for any phone. In the player's view the entry is replaced silently (no marker, same `id` and `moment`). Refused unless `recipient.participantId` and `recipient.playerId` are the CURRENT occupant; refused in `ended`, during Privacy Mode and while a terminal close is in progress; refused when the C6 budget would be exceeded. It is not an identity change and never mints a reveal token. It commits through the same preflight and persistence seam as every authoritative change, and clears the Undo stack exactly as a send does. The log and correction UI are Storyteller-only and Privacy-Mode gated; `versions` are shown only there.

### C4. Undo, restore and size

Delivered information is never rewritten by Undo, and the log never multiplies:
1. **Snapshots carry no log.** `pushUndo` stores snapshots with `playerInfoLog: []`, never a copy of the log. Every restore path takes the CURRENT log: `undo()`, `undoFinishedGame` (`ended` and `live` keep the one real log), the seat-swap and setup undo, and recovery. `restoreRemoteCheckpoint` adopts the checkpoint's log (it clears Undo).
2. Sending and correcting clear the Undo stack (as `publishPrivatePacket` already does), so no snapshot taken before them is restorable.
3. **Budget.** At most 100 entries per participant, 10 `versions` per entry, and 1 MiB total for the serialized log. `publishPrivatePacket` and `correctPlayerInfo` run `persistencePreflight` / `validateCheckpointEnvelope` on the PLANNED game BEFORE any network write and refuse with a plain message instead of appending past a budget, so the game can never become unsaveable (localStorage quota, 10 MiB checkpoint leaf).
Entries are never deleted. The only mutation is C3.

### C5. Identity

`recipient` is the project's `ParticipantRef` (participantId + playerId + nameAtTime). An entry is projected only when `recipient.participantId === occupant.participantId && recipient.playerId === occupant.id` of a non-empty seat. Seat swap (seat numbers only), rename and Traveller conversion keep the participation, so history is kept. A seat taken by someone else, and a rejoin after a revoke or on a new device/uid (a new participation by design), start from an empty history; the former participant's entries stay in the Storyteller log and are never projected to anyone else; the Storyteller can re-send. Identity changes (shown role / alignment) do not erase history: it records what the player was told. Limitation (by design): history follows the participation, not the human.

### C6. Projection and delivery

`player/{id}` (the existing self envelope) gains `history?: { id, moment?, text?, demon?, minions?, bluffs? }[]` with each entry's `shown` content only (never `versions`, `recipient`, `nameAtTime`, `participantId`), in append order. It is built by `selfEnvelopeOf(stState, playerId, self)` called from `writeProjections`, the sole writer of non-null `player/{id}` content. `seatPlayer` MUST keep writing null for a new participation (that is also what clears a previous occupant's node) and MUST NOT write a bare self record; a test fails if any other production site writes a non-null `player/*`. The Setup all-or-none rule still withholds the whole node until roles are revealed. The projection never emits `undefined` or empty arrays (RTDB drops them); a participant with no entries has no `history` key. No Rules change: `player/{id}` is writable only by the fenced Storyteller writer, readable only by that player and the Storyteller, with no server-side shape validation (`src/firebase/rules.json`). Every flush rewrites all players' envelopes: the C4 budget bounds that.

Client: `decodeSelfSnapshot` decodes `history` as `optionalNode(z.array(entry).catch(undefined))` so a malformed `history` is dropped (absent and empty alike) and can never invalidate the player's identity. Pre-v29 Storyteller (no `history`): the phone shows the latest root packet as one undated entry. The team screen (3B `teamOf`) and the Character tab read the most recent entry carrying `demon` / `minions` (and `bluffs`) from `history`, so a later unrelated send never erases the team.

### C7. Migration v28 -> v29

Bump `STORE_VERSION`, `GAME_SCHEMA_VERSION`, `MIGRATABLE_GAME_SCHEMA_VERSIONS` and `PREVIOUS_GAME_SCHEMA_VERSION`; add `hasV29Evidence` (`hasOwnKey(game, "playerInfoLog")`) with its early-return and detection rules, so a v28-marked game carrying the key is rejected, not stamped. The migration adds `playerInfoLog`, registry-free and non-throwing (remote checkpoint recovery has no registry). It backfills ONE entry per player that has a `participantId` and a `publishedPacket` whose payload passes `PlayerInfoContentSchema` and whose `shownRole` equals the player's current shown role (the same visibility test `projectToSelf` applies today); anything else is skipped, never invented. `moment` is `{phase, day}` from `forPhase`/`forDay` when valid (`setup|night|day`), else absent (the phone labels it "Earlier"). `id = "migrated-" + packet.id` so repeated migrations (local copy and checkpoint) agree. Undo snapshots get `playerInfoLog: []` with no backfill. The same function migrates `finishedGameUndo.{ended, live, undoStack}` and the terminal journal game. A migration producing a schema-invalid entry must be a test failure (a failed final schema would otherwise reset the user's state).

### C8. Phone rendering

The Character tab's "From the Storyteller" lists the player's entries by moment (Night 1, Day 2, Before the game, Earlier), each as the design's `{ when, what }` rows. Team entries read "Your Demon: {name}, seat {n}" / "Your Minions: ..." and bluffs by character name. If team information is sent after the player has entered the town, it appears in the Character tab; the ceremony screen is best-effort.

### C9. Required tests

Append-only (no entry removed, no foreign field accepted, unique ids); correction silently replaces, `versions` keeps the original, never projected; root packet and `history` agree after a correction; correction refused for a departed participant / ended / Privacy Mode / empty content; send is refused when it equals the participant's latest entry for the same moment; a failed or racing send neither loses nor duplicates an entry (the entry is appended to the LATEST local game after the remote write, and the roster check also compares participantId); Undo after a later action leaves the log and projected history unchanged, no pre-send snapshot is restorable, `undoFinishedGame` keeps the log; Undo snapshots contain no log; a maximal log still checkpoints under 10 MiB and a full Undo stack stays saveable, and over-budget sends refuse before any write; seat takeover, revoke+rejoin and a new uid show an empty history while the Storyteller log keeps the old one, and seat swap, rename and Traveller choice keep it; projection contains only the current occupant's `shown` content and nothing from `versions` / `recipient`; Setup withholding; no non-null `player/*` write outside `writeProjections`; `undefinedSafety` for the new records; malformed `history` dropped without failing the identity; v28 -> v29 migration (undo stack, finished-game archive, terminal journal, remote checkpoint, missing or `ended` `forPhase`, malformed packet, stale packet, idempotency, strict-schema validity); team preview parity with the setup views (every refusal) plus Magician, multiple Demons, self-in-minions; a real-Rules emulator test that a player can read their own `history` and not another's, and cannot write it.
