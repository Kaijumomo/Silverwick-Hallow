# Phase 6 — deceptive wakes and private information

## History

Audit Phase 6 (AUD-013/AUD-027) was introduced in `8db33cd`.
`c9f3a6c` corrected fake-information applicability.
This focused workflow correction starts from `5c23fa9` (Privacy Mode).
It is intentionally uncommitted for review.

The original Phase 6 checks were 344 normal / 57 emulator tests.
The committed Privacy Mode baseline was 358 normal / 57 emulator tests.

## Architecture decision: B — simplify delivery state

A UI-only change would retain a duplicated saved preview and ready lifecycle.
Separate transport models for Demon bluffs, Lunatic setup and night results
would duplicate validation, synchronization and recovery code.

The correction retains one private draft and one last-sent sanitized snapshot.
Preview is now a pure calculation, captured only as an argument when the
Storyteller clicks Send. There is no saved `packetPreview`, store preview
action, ready state or universal `genericPacket` UI flag.

Retained internal fields:
- `privateInfo`: selected bluffs, apparent Minions and optional text.
- `publishedPacket`: last sent payload, ID and optional day/phase context.
- `packetEpoch`: invalidates stale identity operations.
- Ephemeral queued state and server receipts.

A transient fingerprint binds the clicked content to identity epoch,
selected player names/seats, and day/phase. The ordered writer checks that
fingerprint before writing; a new night cannot validate an old in-flight
review. The UI compares persistent setup content independently of day/phase,
so unchanged bluffs never become overdue solely because the night changes.

Persistence version 9 validates and strips obsolete saved previews from game
and undo snapshots. Remote snapshot schemas also strip the obsolete field.
Drafts, last sent information and active session identity are preserved.
No Firebase paths, rules or player payload format change.

## Storyteller workflow

The Night Assistant leads with the existing ordered procedure. A simulated
wake names the shown character and has one Storyteller-only actual-role note.

Information procedures offer collapsed Give information controls with a
freeform result, derived Player view, and Send to player view. Done is
independent: the Storyteller may give information physically and complete
the step without sending or changing mechanical ability state.

Drunk shown Empath and Marionette shown Fortune Teller use their existing
shown-role procedures. Drunk shown Soldier has no information task; Drunk
shown Monk has the action procedure without an information editor.
No result is calculated or required to be false.
Ordinary information roles, including poisoned Empath, can use the same
optional result entry without changing identity.

The optional text-entry affordance uses informational wording in existing
night prompts (show/tell/learn/information). This is a UI heuristic, not a
canonical character capability dataset or a rules engine. Custom wording
and complex non-textual procedures may still need manual notes/physical
delivery; richer capability metadata is deferred.

Demon and Lunatic setup is configured in the player drawer. Lunatic controls
say Demon setup information / Players shown as Minions, allow in-play good
characters as bluffs, and offer optional additional setup text.
Normal Demon bluffs continue excluding in-play characters.

The first-night introduction has compact collapsed setup controls. Later
nights only offer changed setup content. Drawer sending sits beside the
same bluff configuration, without a second generic editor.
Currently shown to player is a secondary collapsed sanitized projection;
offline copies are labelled as saved views requiring reconnect verification.

No gameplay control uses packet/publication/fingerprint terminology.
Publication receipts are represented as Sending / Sent to player view;
Sent never means a human read receipt.

## Privacy and synchronization guarantees

Draft editing, previewing, opening the assistant, changing phase and Done do
not send private draft content. Drafts may synchronize only to the existing
Storyteller-private state.

Send captures the current sanitized preview and uses the existing
SessionWriter exclusive operation. Membership is rechecked; reviewed content
is rebuilt and compared before the guarded write. The local sent snapshot
is recorded after acknowledgement. Duplicate concurrent sends are rejected.
Failed/lost responses use the existing writer retry/receipt behavior.

Edits made during a send stay in the draft. Identity changes invalidate its
epoch and old sent information; delayed acknowledgements cannot restore it.
Reconnect/host takeover restore the acknowledged snapshot separately from
new drafts. Removal, revocation, seat reuse and new-game cleanup are unchanged.

Actual/shown identity and wake identity remain separate. No projection
fallback to actualRole exists. Player records are allowlisted and contain
shown identity and intended bluffs/minion names/text only.
Simulated wakes do not assign or execute abilities.

Privacy Mode still replaces the night screen and player drawer with neutral
surfaces. The contextual information component additionally checks Privacy
Mode before rendering, including accessibility content.

## Verification

See the implementation handoff for final exact counts. Checks include the
full normal suite, Firebase emulator suite, production build and diff check.

Focused coverage includes contextual ordering/visibility, physical Done,
derived preview with no saved state or writes, explicit sending and delayed
acknowledgement, stale reviewed content, retries/lost responses, reconnect,
migration, role changes, safe projections, in-play Lunatic bluffs, unchanged
setup across nights, and Privacy Mode. A disposable localhost UI fixture was
used to inspect the rendered Drunk/Empath workflow and accessibility
concealment; it is removed before handoff. No production lobby was used.

## Deferred scope

Canonical role text/night ordering and global conditional introductions
(Poppy Grower, etc.) remain Phase 7 work. No complete Lunatic choice relay,
fake-Demon engine, independent actualAlignment model, gained-ability engine,
or multi-message history is introduced. The existing last-sent snapshot is
not a general chat log; information already seen by a person cannot be
retracted. Broader mobile, public-display, Traveler, ping and dependency work
remain out of scope.
