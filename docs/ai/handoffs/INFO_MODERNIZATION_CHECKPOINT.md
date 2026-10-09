# Info and Grimoire modernization checkpoint

Prepared October 9, 2026. Base: `modernization/reference-players-night` at
`a2aa57dcc38552211168abb33bbd6ae88c81d2bb`. This is a review checkpoint, not a release.
The historical CURRENT_HANDOFF.md describes the earlier integrated mechanical program;
the owner's subsequent incremental modernization instructions govern this slice.

## Included work

- Info panel in the shared overlay/pin shell: ordinary counts, composition,
  per-recipient private bluffs, and read-only Fabled/Loric details.
- Seven information actions and four setup-information entry points with
  restricted local presentation payloads, recipient checks, stale-context guards,
  and explicit notices when setup policy prevents an automatic reveal.
- Shared selection-only character chooser, preserving search, artwork and Wiki.
- Shared viewport-root modal positioning and nested focus/isolation regressions.
- Approved Grimoire visual overhaul: Ritual Circle, atmosphere, watermark and
  prototype-matched interface icons; reduced-motion support.
- Full available free-roam board, with pinned-panel and advanced-action reservations.

No schema, authoritative store, Firebase Rules, backend or dependency changes.
Bluff edits call the existing Undo-aware command. Local Show does not publish a
packet, mutate gameplay or mark information delivered. Existing public/player
projections remain authoritative for remote audiences.

## Deferred requirements and risks

- FR-PRIV-004/005 and FR-SEC-003: preserve existing Public Display; its integration
  with this presentation system remains deferred and is not claimed complete.
- Official information-token artwork provenance remains unverified. The new SVGs
  reproduce approved prototype interface symbols, not certified official assets.
- Counts are ordinary available-vote/half-alive information, not a voting engine.
- Complex setup information retains the existing guarded/manual procedures.
- Physical-tablet acceptance and isolated backend/reconnect verification must be
  distinguished from browser emulation, unit tests and source review.
- Preview-to-production Firebase isolation is tracked in GitHub issue #3. A new
  branch must be verified excluded under Cloudflare Branch control before push.

## Review boundary

Final full tests/build and separate-context review target the resulting commit.
Their actual results and any gaps belong in the PR/checkpoint evidence, not an
assumed PASS in this document. Keep the PR draft. No merge, deployment, Rules
change, migration, Public Display integration or Nominations/Voting implementation
is authorized by this checkpoint. Voting UX work is planning only.
