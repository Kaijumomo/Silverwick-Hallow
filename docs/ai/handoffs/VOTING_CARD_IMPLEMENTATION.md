# Voting Card implementation and local tablet trial

## Authorization and isolation

The owner approved implementation of the Claude Design **Card** workflow, with Traveler exile separated, explicit exceptional outcomes, Bureaucrat 3 Votes, Virgin resolution, Pacifist discretion, and no secret-voting interface. The subsequent request authorized a usable tablet trial.

- Repository: `Kaijumomo/Silverwick-Hallow`.
- Protected Info checkpoint: `modernization/info-grimoire`, `55e8ef2dc3c72c9495b3353523b38439b3d7d38d`.
- Implementation checkout: sibling `Silverwick-Voting`, local branch `modernization/voting-card`, based on that checkpoint.
- Work is uncommitted and unpublished. PR #4 remains draft/unmerged; no PR modification, merge, production deployment, database migration, or production resource write was performed.
- **Before any future publication**, verify the exact implementation branch's Cloudflare preview exclusion and production-routing behavior. Local execution is not evidence that publication is safe.

## Implemented behavior

`VotingWorkspace` follows the exported `Storyteller Grimoire Tablet v3.dc.html` Card: direct token selection, stable Yes/No areas, clockwise progression ending with the nominee, automatic tally/result, block/tie management, and the next nomination. Token labels remain visible during crowded voting. Closing the Card preserves accepted responses; reopening or reloading resumes them.

Owner trial feedback: match the prototype's thinner bottom phase pill (40px shell, 32px visual controls, sun/moon indicator, quiet divided Nominate action). Its touch targets remain 44px. Official reminder-token artwork remains explicitly deferred; existing notation and authoritative reminder actions continue to work.

The player token popup now uses a quiet Life row instead of execution/exile button groups. Mark dead, resurrect, and dead-vote corrections retain semantic Life commands. The full Life editor remains under More settings, while ordinary execution/exile outcomes stay in voting and Finish day. The popup does not expose its old Correct status disclosure.

The ordinary path stays compact. Corrections, adjustments, abandonment, and history are disclosed through the Card's options. Observed No and ineligible/unrecorded responses remain distinct. A dead Yes consumes its token in the same transaction as the response; correction refunds only when the original participant and subsequent Life evidence still permit it.

Exile counts supporters separately, including dead players, without weighted votes or dead-token consumption. It does not consume ordinary nomination allowances or create an execution block. The actual exile outcome remains explicit.

Finish day uses the block as a recommendation. The Storyteller can select the actual execution target, choose death or survival, or finish without execution. The accepted execution and the following Night transition are recoverable transactions: a failed transition retries the phase without duplicating execution. A qualifying Virgin ruling follows the same route. First Virgin nomination consumes the ability and places No Ability; poison, registration, and other exceptional judgments remain with the Storyteller. Pacifist never silently decides survival.

Bureaucrat selection records an authoritative participant-bound modifier and its official reminder together; the Night action also completes its step atomically. Free-form reminder text does not create mechanics. Removing the specifically linked official reminder removes its modifier. Source death, departure, or role loss retires the modifier; sober/functioning evaluation uses the existing rules boundary and canonical ownership checks.

## Authority and recovery

- `voting.ts` is the bounded pure planner; UI selections do not mutate game state.
- `resolveVoting` fences the rendered game, participant, lobby, lifecycle, revision, privacy, terminal state, current writer, and writer lease before committing.
- Life, Reminder, Night completion, history, and Undo are composed through their existing boundaries.
- Schema version 27 stores voting Current State and validates relationships, tally, order, and block. Legacy absence means unknown prior voting coverage; History is never reconstructed into gameplay state.
- Local game, Undo, sequence, and related persisted state are saved before an accepted voting mutation is published. A synchronous storage refusal leaves the game unchanged. This is not a general cross-tab transaction guarantee.
- Checkpoints and recovery retain the accepted cursor/responses. Public and player projections do not acquire private voting state.
- Corrections are refused when later Life events invalidate the evidence. Correct Life or use existing whole-state Undo before retrying; never infer the former occupant of a reused seat.
- Thresholds are recorded per round. A changed active table requires review; historical thresholds are not silently reinterpreted.

## Trial and verification

See [TABLET_TRIAL.md](../../TABLET_TRIAL.md) for the ready-to-run local build and sample scenarios. Its separate browser-storage key and compiled backend guards prevent an online lobby/Firebase connection. Artwork may load from the official image service. Each device keeps its own practice game.

Browser checks cover 1024×768 and 1194×834 landscape tablet dimensions, a 1366×900 laptop viewport, 15/20-player tables, keyboard input, weighted Yes, dead-token consumption/Undo, reload/resume, exile, and Virgin execution-to-Night. Yes/No targets measure 120×72 CSS pixels at the tested tablet widths. Automated coverage includes authority/recovery, canonical ownership, participant replacement, corrections, schema migration, privacy, and failure/retry paths.

- Full normal regression: **4,666 tests passed in 216 files**.
- Isolated Firebase demo Rules emulator: **240 tests passed, 0 skipped, 4 files**; emulator stopped cleanly.
- Normal TypeScript/Vite build: passed; existing bundle-size advisory remains.
- Subsequent Bureaucrat arrival UI correction: **14 Night UI tests passed**, TypeScript check passed.
- Trial UI, fixture, isolation, and server checks: **13 passed**, including save-failure retry without duplicate execution and replacement of the former execution seat.

No physical tablet or external network reachability is claimed from viewport testing. The existing Info checkout was reverified clean at the protected commit; live PR #4 was rechecked draft/open/unmerged at the same head.

Latest visual feedback: the phase pill now keeps its 44px touch targets centered inside Claude's 40px outline with 32px visible button fills. Day advance reads `Begin Night N` and still opens the existing day-outcome review. Privacy explanations can wrap. The player popup uses compact Life controls; detailed execution/exile corrections remain in More settings. Official reminder-token artwork remains deferred. For the pill alignment/label adjustment, 46 focused responsive/voting/privacy tests passed and the trial TypeScript/build and ZIP refresh passed. Browser measurements at the actual 2210×1292 viewport confirmed zero vertical center offset for the label and both buttons; the requested tablet viewport override did not take effect in this check. The user's saved practice game was preserved.

Roll back locally by returning to the protected Info checkout. Do not open a version-27 game with an older client or overwrite its recovery copy. Discard/reset only the separate disposable tablet-trial data when testing.

## Character pop-out and information-token refinement — 2026-10-09

Owner requested the Claude pop-out interaction and appearance: Alive/Dead segmented control, dead-only Ghost vote, illustrated On this player reminders, In play/All script reminder palette, token-based character change, Swap seat, Show player, and More settings. Implemented through the existing guarded Life, reminder, seat, and Info boundaries. Palette placement remains notation; existing official ability commands retain their mechanics, and removing a linked Bureaucrat reminder removes its modifier atomically. Advanced effects and custom reminders remain in More settings.

Show player opens You Are using shownRole only, with no actual-role fallback. Reveal a Token opens the existing character chooser and a This Character screen. Both are local presentation only, preserve game/Undo/delivery state, use the safe full-screen privacy boundary, and restore focus on return. Character presentation styling follows the Claude export and supplied screenshots.

Two implementation agents and an independent review agent completed the work. All 334 unique targeted tests across 15 files passed after updating three obsolete test expectations. TypeScript and the tablet-trial build passed; the existing bundle-size advisory remains. Browser interaction checks used a separate offline practice origin at 127.0.0.1:4176 and covered Life/ghost switches, reminder placement/removal and filtering, keyboard activation, persistence after reload, seat swapping, character chooser entry, Show player/return, and Reveal a Token/return. Switches measured 44px high and footer actions 52px. Visual captures were made at the browser's actual 2210×1292 viewport; no new physical-tablet validation is claimed. Claude's live prototype was also exercised for Life/reminders and both reveal flows. The user's 4175 practice state was not modified.

The protected Info checkout remained clean at 55e8ef2dc3c72c9495b3353523b38439b3d7d38d. No commits, pushes, PR edits, deployments, schema changes, or production operations were performed for this refinement. Future publication still requires verified Cloudflare branch exclusion and production routing.

## Bounded verification remediation — October 9, 2026

The October 9 audit supersedes the earlier green-suite statements above: its exact preserved working tree had a correction/context integrity defect, eight stale UI regression failures, indistinguishable notation/effect presentation in the popover, and inapplicable exile weight controls. The owner authorized one bounded remediation pass, with no commit or publication.

The owner rejected a visible Note/Effect split during final review. The popover keeps the unified token design with no visible badges or explanatory line. Nonvisual accessible descriptions identify notation versus existing authoritative effects and linked voting modifiers. Linkage derives from existing authoritative state; token text does not infer mechanics or create a second source of truth. Existing effect actions and atomic linked Bureaucrat removal remain intact. This later product direction supersedes the originally requested visible distinction.

**Deferred: Functional Reminders & Effects Integration.** Palette placement is still informational notation, even for labels such as Poisoned, Safe or 3 Votes. Applying/removing arbitrary reminder labels does not create/remove effects; existing ability and effect commands remain the way to change mechanics. Future work must explicitly define which canonical tokens invoke which existing authoritative commands, their participant/source binding, lifetime, impairment, correction/Undo and persistence semantics. Homebrew and informational tokens need an explicit policy. This cosmetic distinction does not complete that future milestone and does not authorize an effects-engine expansion.

The independently verified remediation snapshot and final test evidence are recorded outside the checkout under `handoff-review/remediation-2026-10-09/`. Until that report is complete, this section is implementation context rather than a closure claim. The Info checkpoint remains protected; Cloudflare Voting-branch exclusion is unresolved and no publication is authorized.
