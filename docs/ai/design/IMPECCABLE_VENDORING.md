# Impeccable — Vendored Design Skill (Pinned Submodule)

**Status:** PINNED — Claude provider linked only\
**Upstream:** `https://github.com/pbakaus/impeccable`\
**Release tag:** `skill-v4.5.0` (annotated tag object `b06a8e043140ae0857482400882d16a5a2c1e697`)\
**Pinned commit:** `508d7e8955de3b3caf2d8676e85206723d41a887` — "Release skill 4.5.0 (#913)", 2026-10-01\
**Engine version (from `scripts/VERSION`):** `0.1.11`\
**Pinned on:** 2026-10-04\
**License:** Apache-2.0 (upstream `LICENSE`; third-party notices in upstream `NOTICE.md`)

## 1. Layout

| Path | What it is | Tracked |
|---|---|---|
| `vendor/impeccable/` | Git submodule, detached at the pinned commit. No `branch` is configured, so nothing tracks a moving branch. | gitlink only |
| `.claude/skills/impeccable` | Relative symlink created by `impeccable link`, pointing to `../../vendor/impeccable/.claude/skills/impeccable` | yes (symlink) |
| `.impeccable/` | Impeccable's project working directory, created on first use. | shared artifacts only (§3) |

Installed through upstream's documented Git-submodule path (`git submodule add` + `impeccable link --source=<checkout> --providers=claude`). The only deviation is the checkout path: upstream's example uses `.impeccable`, but the engine writes this project's runtime state and shared design artifacts to `<repo root>/.impeccable/`. A submodule at that path would put those files inside the vendored checkout, where this repository could not track them. `--source` is a documented `link` option, so the checkout lives at `vendor/impeccable/` instead.

Only the Claude provider is linked. The upstream checkout also contains other providers' folders and its own `.claude/agents/` and `.claude/settings.json`; none of those are linked or loaded by this project.

## 2. Cloning, verifying, updating

After cloning this repository:

```sh
git submodule update --init vendor/impeccable   # shallow per .gitmodules
```

Without this step the `.claude/skills/impeccable` symlink dangles and the skill does not load.

Verify the pin:

```sh
git submodule status vendor/impeccable
# expect 508d7e8955de3b3caf2d8676e85206723d41a887 vendor/impeccable (skill-v4.5.0)
```

To move to a new release, change the pin deliberately. Do **not** run upstream's `git submodule update --remote`, which moves the pin to the tip of the upstream default branch rather than a release:

```sh
git -C vendor/impeccable fetch --depth 1 origin tag skill-vX.Y.Z
git -C vendor/impeccable checkout skill-vX.Y.Z
npx impeccable link --source=vendor/impeccable --providers=claude -y   # picks up new skill folders, if any
git add vendor/impeccable .claude/skills
```

Before committing a new pin, review the diff of `vendor/impeccable/.claude/skills/impeccable/` (in particular `scripts/`), update this file's header, and, if the tag's README changes it, refresh the `.gitignore` block (§3).

## 3. `.impeccable/` ignore policy

`.gitignore` carries upstream's block verbatim from the pinned tag's README, between `# impeccable-ignore-start` and `# impeccable-ignore-end`. It ignores per-developer config, hook caches, screenshots, review and question scratch, and live-mode session, preview and cache state.

These shared project artifacts stay tracked and must not be added to `.gitignore`:

- `.impeccable/config.json`
- `.impeccable/live/config.json`
- `.impeccable/design.json`
- `.impeccable/surfaces/*.md`
- `.impeccable/critique/*.md`

## 4. Runtime notes

- **Engine binary.** The skill's launcher (`scripts/impeccable`) runs the engine from `$IMPECCABLE_BIN`, the user cache `~/.impeccable/bin/0.1.11/`, or `PATH`. Failing those, it downloads `engine-v0.1.11` from GitHub Releases and refuses to run it unless it matches the published `.sha256` sidecar. No engine binary is committed here.
- **Design hook: not installed.** `link` installs no hooks. Upstream's optional design hook (`/impeccable hooks`, or `npx impeccable install`) writes to `.claude/settings.local.json`. That file is **tracked** in this repository, so an installed hook would be committed for everyone rather than staying machine-local. Decide on that explicitly before enabling it.
- **Live mode** (`scripts/live-browser*.js`) talks only to a local `localhost` server and edits UI source. Its outputs are subject to the Phase 10H review baseline like any other UI change.
