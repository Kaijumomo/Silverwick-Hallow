// Read metadata/Rules only through the signed-in CLI. Never reads game data.
// The public HTTP probe has no credentials and must be denied by locked Rules.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareRulesText } from "./verify-deployed-rules.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = "silverwick-hollow";
const instance = "silverwick-hollow-default-rtdb";
const appId = "1:863800899154:web:c9dc003334dfc4d547118b";
const databaseUrl = "https://silverwick-hollow-default-rtdb.firebaseio.com";
const cli = resolve(root, "node_modules/firebase-tools/lib/bin/firebase.js");

function firebase(args) {
  const run = spawnSync(process.execPath, [cli, ...args, "--project", project, "--json", "--non-interactive"], {
    cwd: root, encoding: "utf8", timeout: 60000,
    env: { ...process.env, CI: "true", NO_UPDATE_NOTIFIER: "1" },
  });
  if (run.error || run.status !== 0) throw new Error(`Development metadata check failed: ${args[0]}`);
  const response = JSON.parse(run.stdout);
  if (response.status !== "success") throw new Error(`Firebase did not confirm success: ${args[0]}`);
  return response.result;
}

async function verify() {
  if (process.argv.length !== 2) throw new Error("This verifier accepts no target overrides.");
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) throw new Error("Unset the emulator host for the hosted metadata check.");
  const expected = readFileSync(resolve(root, "src/firebase/development.locked.rules.json"), "utf8");
  if (!compareRulesText(expected, JSON.stringify({ rules: { ".read": false, ".write": false } })).match) {
    throw new Error("The local development policy must remain exactly deny-all.");
  }
  const apps = firebase(["apps:list", "WEB"]);
  if (apps.length !== 1 || apps[0].appId !== appId || apps[0].projectId !== project) {
    throw new Error("Expected exactly the registered development web app.");
  }
  const sdk = firebase(["apps:sdkconfig", "WEB", appId]).sdkConfig;
  const buildEnv = Object.fromEntries(readFileSync(resolve(root, ".env.development"), "utf8")
    .split(/\r?\n/).filter((line) => /^VITE_FIREBASE_[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  for (const [sdkKey, envKey] of Object.entries({
    apiKey: "API_KEY", appId: "APP_ID", projectId: "PROJECT_ID", authDomain: "AUTH_DOMAIN",
    storageBucket: "STORAGE_BUCKET", messagingSenderId: "MESSAGING_SENDER_ID",
  })) {
    if (!sdk[sdkKey] || sdk[sdkKey] !== buildEnv[`VITE_FIREBASE_${envKey}`]) {
      throw new Error(`Registered development SDK configuration differs from the build: ${sdkKey}`);
    }
  }
  if (buildEnv.VITE_FIREBASE_DATABASE_URL !== databaseUrl || buildEnv.VITE_FIREBASE_ENVIRONMENT !== "development") {
    throw new Error("Development build target or isolation marker mismatch.");
  }
  const instances = firebase(["database:instances:list"]);
  if (!instances || instances.length !== 1) throw new Error("Expected exactly one development database.");
  const db = instances[0];
  if (db.name !== instance || db.location !== "us-central1" || db.project !== "projects/863800899154" || db.databaseUrl !== databaseUrl || db.state !== "ACTIVE") {
    throw new Error("Development database identity, region, or state mismatch.");
  }
  const outputDirectory = mkdtempSync(join(tmpdir(), "silverwick-development-verify-"));
  const output = join(outputDirectory, "rules.json");
  try {
    // database:get streams raw Rules (which may contain comments) before the
    // CLI's JSON status. A separate output file keeps the two formats apart.
    firebase(["database:get", "/.settings/rules", "--instance", instance, "--output", output]);
    if (!compareRulesText(readFileSync(output, "utf8"), expected).match) {
      throw new Error("Hosted Rules do not match the deny-all development Rules.");
    }
  } finally {
    if (existsSync(output)) unlinkSync(output);
    rmdirSync(outputDirectory);
  }
  const probe = await fetch(`${databaseUrl}/__development_lock_verification__.json`, {
    redirect: "error", signal: AbortSignal.timeout(15000),
  });
  const denial = await probe.json();
  if (![401, 403].includes(probe.status) || denial.error !== "Permission denied") {
    throw new Error("Unauthenticated development probe was not denied as expected.");
  }
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(), project, appId, database: db,
    webAppCount: apps.length, databaseCount: instances.length,
    publicSdkConfiguration: "matches .env.development; API key not printed",
    rules: "deny-all; exact normalized match", unauthenticatedReadStatus: probe.status,
    authenticatedClientWrites: "denied by inspected false Rules; exercised only in local emulator",
    hostedMultiplayerTesting: "not authorized; no session was started",
  }, null, 2));
}
verify().catch((error) => { console.error(error.message); process.exitCode = 1; });
