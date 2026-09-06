# Setup

## 1. Install

```
npm install
```

## 2. Configure Firebase

Copy `.env.example` to `.env.local` and fill in your Firebase project values
(Firebase Console → Project Settings → SDK setup and configuration → Config):

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_DATABASE_URL=https://YOUR-PROJECT-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

The apiKey is **public** by Firebase design — the auth boundary is the
security rules at `src/firebase/rules.json`. Do NOT put service account keys
in env files.

## 3. Enable Anonymous Auth

In Firebase Console → Authentication → Sign-in method → enable the
**Anonymous** provider. Players authenticate anonymously to submit their own
join request. Only the Storyteller can write the authoritative roster binding.

If you skip this, the app will show:
> "Anonymous sign-in is disabled — Open Firebase Console → Authentication → Sign-in method, and enable the Anonymous provider for this project."

## 4. Enable Realtime Database

In Firebase Console → Build → Realtime Database → Create database. Choose a
location, then **Test mode** is fine because we'll override the rules in the
next step.

## 5. Deploy the security rules

Before deploying the AUD-001 membership change to an existing project, follow
[the migration procedure](src/firebase/MEMBERSHIP_MIGRATION.md). Old roster
values were client-writable and cannot be treated as trusted memberships.

```
npx firebase login           # one-time
npx firebase use YOUR-PROJECT-ID
npm run rules:deploy
```

This pushes `src/firebase/rules.json` to your project's Realtime Database. **You
must run this any time you change `rules.json`.** The default rules expire
after 30 days and become deny-all — that's the cause of most early
`permission_denied` errors.

## 6. Run the dev server

```
npm run dev
```

Open the printed URL on the Storyteller's tablet. The "Configure Firebase"
button is hidden when env vars are present; it stays available as a fallback
if config comes from `localStorage`.

## Player join flow

A player visits the join link on their phone, enters the lobby code and name,
and creates `joinRequests/{uid}`. The Storyteller sees the pending request and
assigns it to a seat. An atomic write consumes the request and creates the
Storyteller-controlled `roster/{uid}` binding, granting private role access.

## Features

**Storyteller**
- **Alive + Online chips** — ST header shows `{alive}/{total} alive` and `{online}/{total} online`
- **Copy lobby code** — ⧉ button inline with lobby pill copies code to clipboard
- **Drag-to-reorder seats** — HTML5 drag on grimoire tokens to rearrange the ring (mobile: ← / → buttons in drawer)
- **Night Order panel** — auto-opens on night phase; tri-state per step (undone / in-progress / done)
- **Lorics** — ST-controlled non-seated roles; selected in Setup panel, shown in game header and Public Display
- **Jinxes** — auto-detected pair rules from active roles/lorics/fabled; shown in Setup, header, and Public Display (declarative text only, no enforcement)
- **Experimental characters** — 60+ characters filterable in Almanac (`edition: "experimental"`)

**Player (phone)**
- **Presence / online indicators** — online pip on grimoire tokens; heartbeat every 30s; offline on disconnect
- **Per-bluff reveal** — Demon's three bluffs are hidden behind `?` until tapped (prevents shoulder-surfing)
- **Neighbour display** — Town view shows alive left/right neighbours per seat row
- **Private town notes** — tap any seat row to open an inline editor with a textarea and tag chips (good guess / evil guess / unsure); stored in `localStorage` only, never sent to Firebase
- **Wiki links** — Almanac entries and My Role card link to `wiki.bloodontheclocktower.com`
- **Flavor quotes** — italicised flavor text on My Role card
- **Role art** — wiki-hosted token images, lazy-loaded with text fallback if 404

**Public Display (projector)**
- Visit `?display=public&code=XXXX` on a second screen
- Shows all seated players (with online status), active Fabled, Lorics, and Jinxes
- Override icon base URL via `VITE_ICON_BASE_URL` env var if self-hosting token art

## Testing

```
npm run typecheck     # TypeScript across the project
npm test              # Vitest — protocol tests use MemoryRoomBackend
npm run build         # Production bundle
```

## Firebase rules tests (required security verification)

Install Java 21 and put `java` on PATH (or prepend `%JAVA_HOME%/bin`). Run
`npm ci` to install the pinned local Firebase CLI; no global CLI/login is needed.

```
npm run test:rules
```

This starts a loopback-only RTDB emulator on port 9000 with the isolated
`demo-silverwick-rules` project, runs the security tests, and stops the emulator.
The first run downloads the emulator. Java/startup/port/rules errors fail the
command. A fresh result report enforces at least one executed test, all passing,
with no skipped/pending/todo tests. Fast `npm test` explicitly excludes the
emulator suite. Run both commands for verification.

To use an emulator already running locally, set
`FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000` and run `npm run test:rules:run`.
Only use a disposable emulator: the suite clears `demo-silverwick-rules` data.
The suite refuses non-local addresses and never uses production credentials.

## Full pre-release test suite

Run all checks (typecheck, unit tests, and rules tests) in a single command:

```
npm run test:full
```

`test:full` = `typecheck` + `npm test` + `test:rules`. Each stage must pass.

## Deploying

Build a production bundle:

```
npm run build
```

This emits a `dist/` directory. The `firebaseBackend-*.js` chunk (Firebase SDK,
~340 kB gzip: ~73 kB) is split automatically — it loads on-demand when the
first Firebase call is made.

### Netlify / Cloudflare Pages

Drop `dist/` as the publish directory. The `public/_redirects` file (`/* /index.html 200`)
is copied into `dist/` automatically by Vite and enables client-side routing
(users can deep-link to `?join=ABCD` without getting a 404).

### Source maps

`build.sourcemap: true` is set in `vite.config.ts` — `.js.map` files are
included in `dist/`. They are safe to ship; they reveal source structure but
not secrets (no credentials live in source).

### Console stripping

`esbuild.drop: ["console", "debugger"]` is active for production builds — all
`console.log/warn/error` calls are removed from the bundle. This prevents
diagnostic output from leaking into players' browser consoles.

## Architecture documents

- `src/firebase/PROTOCOL.md` — load-bearing decisions (request/membership
  protocol, reconnect policy, write strategy)
- `src/firebase/PATH_AUDIT.md` — every RTDB path with its rule and access
  matrix
