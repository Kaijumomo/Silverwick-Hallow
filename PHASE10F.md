

## 28. SOL-10F-S7-F1 / F2 remediation record — 2026-10-03

Remediated only the two §27 findings, on top of `9153b4548f33445cb39b6635f3b8b6971b5efd81`. Code checkpoint: `53ab172a723d70b2de4220d448ec8da8f79a173a` (`c5d65f8` F1, `53ab172` F2). Schema / store version unchanged (v24); no Firebase Rules change. Phase 10F is NOT closed.

- **F1 — Harlot self-target:** the target is exactly one living participant (`notSelf` removed); a self-chosen Harlot is one participant, so the Storyteller-chosen death consequence makes exactly one death attempt for that ParticipantId (protection / judgment applied to it). The owner-authorized Information Action shape (`chosenPlayer` + `role`) is unchanged.
- **F2 — independent Storyteller facts:** `AbilityDescriptor.independentFacts` declares Effect types a workflow may initialize independently of actor functioning. The coordinator's non-functioning guard admits an Effect operation only when every intent is an `apply` of a declared type classified `storytellerFact`, with no source participant and no source character; all other mechanical output of a non-functioning ability is still refused, and simulated wakes are still refused every mechanical operation. The Fortune Teller declares `fortuneTellerRedHerring`: on Night 1 the actual Fortune Teller's missing Red Herring is established first (even while drunk / poisoned), then a functioning Fortune Teller computes and an impaired one receives an arbitrary Boolean, in one commit. A simulated Drunk shown as the Fortune Teller creates none.

Gate at `53ab172`: typecheck PASS; F1/F2 suites 49/49; proof-character suites 203/203 (15 files); 10F foundation / guard suites 355/355 (16 files); full normal suite 3,766/3,766 across 153 files (0 skipped); Firebase emulator 201/201 (0 skipped); build PASS; worktree and baseline-range `git diff --check` PASS. Three planted mutations of the new exception (dropping the `storytellerFact` check, the no-source check, or the descriptor declaration) were each caught and restored.


## 29. Sol acceptance of Slice 7 pre-Luna remediation — 2026-10-03

Sol independently spot-checked the §27 remediation at exact pushed target `bd9050c97acef292173ef3437b139465f8493f2e` (code checkpoint `53ab172a723d70b2de4220d448ec8da8f79a173a`) and accepts both targeted fixes:

- **SOL-10F-S7-F1 CLOSED for Luna review:** Harlot target is one living participant with self legal; self-target death consequence produces one death attempt for that ParticipantId.
- **SOL-10F-S7-F2 CLOSED for Luna review:** Fortune Teller Red Herring initialization is descriptor-authorized, source-independent `storytellerFact` state; an actual Night-1 Fortune Teller establishes it even while impaired, simulated wakes cannot create it, and the generic non-functioning mechanical guard remains intact.

The owner-authorized Harlot Information Action remains `harlot-other-night` with `chosenPlayer` + `role`; pinned publisher data remains unchanged.

This is a **Sol handoff decision only**, not Phase 10F closure. The next gate is an independent Luna mechanical/rules-fidelity review of the complete Slice 7 implementation at exact target `bd9050c97acef292173ef3437b139465f8493f2e`.
