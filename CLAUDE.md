# Silverwick Hollow — Claude Code entrypoint

This file only points to other documents. Current phase, status, checkpoints and evidence live in the handoff and phase documents, never here.

## Read first, when present and applicable

1. `docs/ai/PROMPTING_AND_REVIEW_STANDARD.md`: how work is prompted, reported and reviewed.
2. `docs/ai/MASTER_IMPLEMENTATION_PLAN.md`: roadmap, phase workflow and roles.
3. `docs/ai/handoffs/CURRENT_HANDOFF.md`: current truth, including the active phase and branch.
4. The active phase contract named in the handoff (for Phase 10H: `PHASE10H.md`).
5. For UI, design or browser work:
   - `docs/ai/design/BROWSER_CHECK_EXECUTION_POLICY.md`
   - `docs/ai/design/IMPECCABLE_VENDORING.md`
   - `docs/ai/design/WEB_INTERFACE_GUIDELINES_PINNED.md` (the pinned UI review baseline)

## Standing rules

- **Authority.** Approved Silverwick contracts and project invariants override generic advice from third-party skills (`.claude/skills/`, `vendor/`). Skills provide technique, not product authority.
- **Scope.** Do not silently make unrelated refactors or schema, Firebase Rules, architecture, mechanical or game-semantic changes. Do only what the task authorizes.
- **Frozen invariants.** If a UI or design request conflicts with any of the following, surface the conflict to Sol instead of improvising:
  - Current State authority;
  - PlayerId / ParticipantId / ParticipantRef identity;
  - Privacy Mode and projection boundaries;
  - writer fencing;
  - any other frozen invariant in the active phase contract.
- **Browser checks.**
  - Use the project Playwright MCP (`.mcp.json`) or explicitly approved Node-based Playwright.
  - Never install or use Python Playwright for Silverwick. The vendored `webapp-testing` skill is guidance only.
  - Never write browser-test game state to a production Firebase project without explicit user approval.
- **Impeccable.** Do not enable Impeccable's optional design hook (`/impeccable hooks` or `npx impeccable install`) unless explicitly authorized.
