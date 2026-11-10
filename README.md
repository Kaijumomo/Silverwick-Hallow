# Silverwick Hollow

A Storyteller companion for *Blood on the Clocktower*, built for a tablet in landscape. The Storyteller runs the
Grimoire, setup, night order, day and voting on the tablet. Players can join on their phones, and a separate
Public Display shows the town square. Games can be played fully offline on one device; online play uses Firebase
Realtime Database.

It is a personal, non-commercial app. Official character art under `public/art` is for personal use only (see
`public/art/PROVENANCE.md`).

## Run it

Requires Node.js 20 or later (developed on Node 22).

```sh
npm install
npm run dev          # local dev server (offline play works with no configuration)
```

For online play, copy `.env.example` to `.env.local` and fill in a Firebase project's web config. The full
Firebase setup (anonymous auth, rules) is in [docs/SETUP.md](docs/SETUP.md).

## Test and build

```sh
npm run typecheck    # TypeScript, includes the schema/type parity check
npm test             # unit and component tests (vitest)
npm run test:rules   # Firebase Rules tests in the local emulator (needs the Firebase CLI and Java)
npm run build        # production build into dist/
```

`npm run test:full` runs typecheck, tests and Rules tests in order.

### Test file names

- `*.test.ts(x)`: fast tests, run by `npm test`. Files that need no DOM start with `// @vitest-environment node`.
- `*.spec.ts`: Firebase emulator tests, run only by `npm run test:rules`.
- `*.sdk.test.ts`: checks against the real Firebase SDK's write encoding (no network).
- `*Independent.test.ts` / `*.independent.test.ts`: independent reviewers' tests for an accepted batch. They are
  evidence for that acceptance; do not delete or weaken them.
- `*.v6.test.tsx` and `*.view.test.tsx`: tests that drive the real tablet Grimoire view.

## Deploy

The web client is hosted on Cloudflare Pages, built with `npm run build` and served from `dist/`
(`public/_redirects` handles client-side routes). Firebase Rules live in `src/firebase/rules.json` and are deployed
with `npm run rules:deploy`, then checked with `npm run rules:verify`. Deploy Rules before the client that needs
them.

## Where things live

| Path | What it holds |
| --- | --- |
| `src/app` | App shell and routing |
| `src/features/grimoire-v6` | The Storyteller tablet Grimoire and Home (the main UI) |
| `src/features/player` | The player phone app |
| `src/features/publicDisplay` | The Public Display |
| `src/features/*` (others) | Night actions, abilities, voting, setup screens and other UI pieces |
| `src/rules` | Pure setup and night-order rules (no UI) |
| `src/stores` | Game state, commands, history, saved-data schemas and migration |
| `src/abilities` | Character ability semantics and evaluators |
| `src/data` | Characters, scripts, jinxes and other game data |
| `src/firebase` | Online sync, lobby, Firebase Rules and their tests |
| `src/test` | Shared test fixtures and helpers (never shipped) |
| `public` | Static assets: art, icons, fonts, manifest |
| `scripts` | Rules test runner, Rules checks and the offline tablet-trial build |
| `docs` | Setup, terminology, tablet trial, phase contracts (`docs/phases`), AI working docs (`docs/ai`) and archived material (`docs/archive`) |
| `vendor` | Vendored design skill (git submodule) |

Project working agreements for AI assistants are in [CLAUDE.md](CLAUDE.md), and the current state of the
project is in [docs/ai/handoffs/CURRENT_HANDOFF.md](docs/ai/handoffs/CURRENT_HANDOFF.md).
