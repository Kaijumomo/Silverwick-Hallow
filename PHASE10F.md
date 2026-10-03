

## 32. SOL-10F-A1…A10 remediation record — 2026-10-03

Remediated exactly the §31 findings, on top of `a5df7674067344900a57c508ecbfde0fb261ba0c`. Code checkpoint: `9b6a25bdd134f7d60fb8366c8f781252b2f4f3a6` (`35e1f67` A3+A8, `c5bb344` A1+A2+A6, `8508244` A4, `d6b9b1d` A5+A7, `9b6a25b` A9+A10). Schema / store version unchanged (v24; `actualRoleAtEvent` is optional and additive); no Firebase Rules change. Phase 10F is NOT closed.

- **A1:** evaluator follow-ups that belong to participants carry them in their id (`subjectId`, JSON-encoded ParticipantIds): Harlot consent / shown / judged character / death consequence; Al-Hadikhia choice per position + participant; impaired Fortune Teller answer per chosen pair; Ravenkeeper shown / judged character per target. The workspace clears every follow-up on a declared-input change and every later follow-up on a follow-up change.
- **A2:** inline, Grimoire and Manual selections capture `{playerId, participantId}` (Manual also the observed record for the Role / Alignment seams) at selection; an unpicked Manual step blocks resolution; the coordinator refuses any non-current Effect / Reminder / Role / Alignment target as `stale`.
- **A3:** the modifier gate carries every reaching unverified modifier AND every reaching verified hook result; the coordinator enforces both.
- **A4:** `prospectiveJinxes` (pinned pairs + represented canonical characters after the proposed Role changes; never script membership); an unverified created jinx sends the whole guided resolution to Manual before mutation.
- **A5:** `whileSourceFunctions`: unseated -> unknown; Role mismatch -> false; known dead -> false; then functioning.
- **A6:** Al-Hadikhia settles each player's consequence (judgment included) before asking the next; final deaths 1 -> 2 -> 3; one commit.
- **A7:** exact participant step keys (`participantRoleStepEntries`) replace prefix matching in the Role seam and Setup Traveler designation.
- **A8:** `abilityInputValueError` validates every supplied input and judgment before any evaluator runs.
- **A9:** gameplay Life Events record `actualRoleAtEvent`; corrections of past moments record none (an amend of the same subject keeps the original's); the Ravenkeeper trigger requires `ravenkeeper` evidence, missing evidence -> judgment.
- **A10:** the trigger resolves to its exact LifeEvent id, bound in the fingerprint, revalidated at commit and always consumed (`nightTriggerStepKey`) in the same snapshot regardless of `completeStep`.

Gate at `9b6a25b`: typecheck PASS; A1…A10 suites 61/61 (2 files); proof-character suites 252/252 (16 files); 10F foundation / architecture / writer guards 355/355 (16 files); Life Event migration / recovery / checkpoint suites 168/168 (6 files); full normal suite 3,827/3,827 across 155 files (0 skipped); Firebase emulator 201/201 (0 skipped); build PASS; worktree and baseline-range `git diff --check` PASS. Astra's ten pure counterexamples reproduced before the fixes and refuse / ask correctly after; the A1/A2 UI regressions fail 10/12 on the pre-fix UI; eleven planted seam mutations were each caught and restored.
