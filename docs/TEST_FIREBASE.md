# Firebase test project (Milestone 4)

Multiplayer is tested against an isolated Firebase project, never against production.

| | Test | Production |
| --- | --- | --- |
| Firebase project | `silverwick-hollow` | `mobile-botc` |
| Realtime Database | `silverwick-hollow-default-rtdb` (us-central1) | `mobile-botc-default-rtdb` |
| Plan | Spark (free, no billing account) | |
| Rules | `src/firebase/rules.json`, the same file as production (owner decision, 2026-11-10) | `src/firebase/rules.json` |
| Sign-in | Anonymous only | Anonymous only |
| Who builds against it | Cloudflare Pages **preview** deployments, and local `npm run dev:development` | Cloudflare Pages production (`main`) |
| Data | Synthetic test games only. Never copy production records here. | Real games |

Sessions in the cloud cannot reach Firebase or Cloudflare. Codex (or the owner) runs every command below that
touches them.

## How a build is pinned to the test project

A build made with `VITE_FIREBASE_ENVIRONMENT=development` (or Vite's `--mode development`) connects only when
all seven `VITE_FIREBASE_*` values exactly match the test app in `src/firebase/development.ts`. Any other
project, a mixed configuration, or a browser-saved configuration is refused before the Firebase SDK starts.
The test values are in `.env.development`; they are public client identifiers, not secrets.

Cloudflare Pages uses the **Preview** environment variables for every non-`main` branch:

```
VITE_FIREBASE_ENVIRONMENT=development
VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_DATABASE_URL, VITE_FIREBASE_PROJECT_ID,
VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID   (values from .env.development)
```

The **Production** variables stay on `mobile-botc` and are never changed for testing.

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

## Local checks

```
npm run typecheck
npm test              # unit and regression tests
npm run test:rules    # Rules and multiplayer integration tests in the local emulator (needs Java)
```

`npm test` does not run the emulator suite, so run `npm run test:rules` for any change under `src/firebase/` or
to anything a phone or the Public Display receives.
