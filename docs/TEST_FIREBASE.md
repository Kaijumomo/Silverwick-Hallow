# Firebase test project (Milestone 4)

Multiplayer is tested against an isolated Firebase project, never against production.

| | Test | Production |
| --- | --- | --- |
| Firebase project | `silverwick-hollow` | `mobile-botc` |
| Realtime Database | `silverwick-hollow-default-rtdb` (us-central1) | `mobile-botc-default-rtdb` |
| Plan | Spark (free, no billing account) | |
| Rules | `src/firebase/rules.json`, the same file as production (owner decision, 2026-11-10) | `src/firebase/rules.json` |
| Sign-in | Anonymous only | Anonymous only |
| Who builds against it | Preview builds made with `npm run build:development`, and local `npm run dev:development` | Cloudflare Pages production (`main`) |
| Data | Synthetic test games only. Never copy production records here. | Real games |

Sessions in the cloud cannot reach Firebase or Cloudflare. Codex (or the owner) runs every command below that
touches them.

## How a build is pinned to the test project

A build made with `VITE_FIREBASE_ENVIRONMENT=development` (or Vite's `--mode development`) connects only when
all seven `VITE_FIREBASE_*` values exactly match the test app in `src/firebase/development.ts`. Any other
project, a mixed configuration, or a browser-saved configuration is refused before the Firebase SDK starts.
The test values are in `.env.development`; they are public client identifiers, not secrets.

Test previews are built locally with `npm run build:development` (output in `dist-development/`) and uploaded
to Cloudflare Pages as preview deployments; they are not built by Cloudflare. Before uploading, check that the
built JavaScript contains `silverwick-hollow` and does not contain `mobile-botc`. Cloudflare's own Production
variables stay on `mobile-botc` and are never changed for testing. Previews are behind Cloudflare Access.

## Commands (run from a checkout of the commit being tested)

Deploy Rules to the test project. Always pass `--project silverwick-hollow` explicitly. The repository has no
`.firebaserc`, but a local `firebase use` can set a default, which may be production.

```
npx firebase deploy --only database --project silverwick-hollow
```

Verify (read-only):

```
npm run rules:verify -- --project silverwick-hollow --instance silverwick-hollow-default-rtdb
```

Do not use `firebase.development.json` for this. It points at `development.locked.rules.json` (deny-all) and is
kept only as the rollback that locks the test project again:

```
npx firebase deploy --only database --project silverwick-hollow --config firebase.development.json
```

`npm run rules:development:verify` checks for that deny-all state, so it fails while the test project is open.
That failure is expected and is not drift.

`src/firebase/development.multiplayer.rules.json` (administrator grants per player and per game) is a stricter
option that was not chosen; it stays in the repository with its emulator tests.

## Rules release order

When a change touches `src/firebase/rules.json`, deploy it to the test project first, test on a preview, and
deploy it to production (`--project mobile-botc`) only with the owner's approval, before or together with the
`main` merge that needs it.

## Internal multiplayer game (no phones, no hosted Firebase)

```
npm run harness:multiplayer                 # report and screenshots in harness-output/<time>/
npm run harness:multiplayer -- --out=<dir>
```

One Storyteller tablet, five phones and a Public Display, each in its own browser context with its own anonymous
sign-in, play a short Trouble Brewing game against the local Firebase emulators (Authentication and Realtime
Database) running the production Rules. Steps: create the lobby, open the Display, five joins, seating, a fixed
deal (Chef, Imp, Empath, Poisoner, Washerwoman), reveals, Night 1 and Day 1, a death and its Undo, a phone that
goes offline and catches up, a phone refresh, a Storyteller refresh, and Good wins on the Display and phones. A
final check reads every Firebase data message each phone and the Display received (listener pushes and replies to
one-off reads). It fails on any path outside that device's allowlist (public data, the session, and its own
records), on any assigned character id or role/alignment key outside the device's own player view (the public
script list excepted), or if a phone never received its own character. It also plants seven kinds of leak into the
captured traffic and fails unless every one is flagged.

The harness tests the Rules file in this repository. It says nothing about the Rules deployed to a hosted project;
check those with `npm run rules:verify`.

How it reaches the emulators: `vite.config.ts` defines `__SILVERWICK_EMULATOR_HOST__` from the
`SILVERWICK_EMULATOR_HOST` environment variable, which only the harness sets (loopback hosts only, and only in a
test-mode build). When that variable is not set, which is every ordinary build (Cloudflare production, Codex's
preview builds, `npm run build`), the constant is empty, the bundler removes the emulator code, and the production
bundle is byte-identical to one built without this feature. The harness first checks that a production build
contains none of it. Never set `SILVERWICK_EMULATOR_HOST` for a build that will be uploaded. It uses the demo project `demo-silverwick-harness`, so nothing
leaves the machine.

It does not cover real phone hardware and browsers (iOS Safari, the installed app), real mobile networks, QR
scanning, the on-screen keyboard, or the hosted test project. Those stay in a short real-phone session.

Needs Java (for the emulators) and Node Playwright with Chromium.

## Local checks

```
npm run typecheck
npm test              # unit and regression tests
npm run test:rules    # Rules and multiplayer integration tests in the local emulator (needs Java)
```

`npm test` does not run the emulator suite, so run `npm run test:rules` for any change under `src/firebase/` or
to anything a phone or the Public Display receives.
