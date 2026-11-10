#!/usr/bin/env node
// One command for the Milestone 4 internal multiplayer game (docs/TEST_FIREBASE.md):
//
//   npm run harness:multiplayer [-- --out=<dir>] [-- --skip-prod-check]
//
// 1. Production check: an ordinary `vite build` must contain no emulator code.
// 2. Builds the app in test mode with SILVERWICK_EMULATOR_HOST=127.0.0.1 into a temporary folder.
// 3. Starts the local Firebase emulators (Authentication and Realtime Database, production Rules from
//    src/firebase/rules.json, demo project: nothing leaves this machine) and serves the build.
// 4. Runs scripts/harness/multiplayer-game.mjs and writes REPORT.md with screenshots.
//
// Needs Java (Firebase emulators) and Node Playwright with Chromium. Never touches a hosted Firebase project.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const outArg = argv.find((a) => a.startsWith("--out="));
const out = outArg ? resolve(outArg.slice(6)) : join(root, "harness-output", new Date().toISOString().replace(/[:.]/g, "-"));
const PORT = 5199;
const vite = join(root, "node_modules", "vite", "bin", "vite.js");
const firebase = join(root, "node_modules", "firebase-tools", "lib", "bin", "firebase.js");

function run(label, args, env = {}) {
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? jsFiles(path) : path.endsWith(".js") ? [path] : [];
  });
}

/** Strings only the emulator branch of src/firebase/emulator.ts would put in a bundle. */
const EMULATOR_MARKERS = ["127.0.0.1:9099", "must be a loopback host", "SILVERWICK_EMULATOR_HOST"];

function productionCheck() {
  const dir = mkdtempSync(join(tmpdir(), "silverwick-prod-check-"));
  try {
    const env = { ...process.env };
    delete env.SILVERWICK_EMULATOR_HOST;
    const r = spawnSync(process.execPath, [vite, "build", "--outDir", dir, "--emptyOutDir", "--logLevel", "error"], { cwd: root, stdio: "inherit", env });
    if (r.status !== 0) throw new Error("production build failed");
    const hits = jsFiles(dir).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return EMULATOR_MARKERS.filter((m) => text.includes(m)).map((m) => `${file.slice(dir.length + 1)}: ${m}`);
    });
    if (hits.length) throw new Error(`production build contains emulator code:\n${hits.join("\n")}`);
    console.log("PASS  production build contains no emulator code");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function waitForServer(url, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server at ${url} did not start`);
}

async function main() {
  if (!argv.includes("--skip-prod-check")) productionCheck();

  const build = mkdtempSync(join(tmpdir(), "silverwick-harness-build-"));
  let server;
  try {
    run("harness build", [vite, "build", "--mode", "development", "--outDir", build, "--emptyOutDir", "--logLevel", "error"], { SILVERWICK_EMULATOR_HOST: "127.0.0.1" });
    const harnessHits = jsFiles(build).some((f) => readFileSync(f, "utf8").includes("127.0.0.1:9099") || readFileSync(f, "utf8").includes("must be a loopback host"));
    if (!harnessHits) throw new Error("harness build does not contain the emulator connection; it would not reach the emulators");

    server = spawn(process.execPath, [vite, "preview", "--outDir", build, "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: root, stdio: "ignore" });
    await waitForServer(`http://127.0.0.1:${PORT}/`);

    const game = `node scripts/harness/multiplayer-game.mjs --url=http://127.0.0.1:${PORT}/ --out=${JSON.stringify(out).slice(1, -1)}`;
    const r = spawnSync(process.execPath, [firebase, "emulators:exec", "--project", "demo-silverwick-harness", "--config", "firebase.harness.json", "--only", "auth,database", game], {
      cwd: root, stdio: "inherit", env: { ...process.env, CI: "true", NO_UPDATE_NOTIFIER: "1" },
    });
    process.exitCode = r.status === 0 ? 0 : 1;
    console.log(`\nReport: ${join(out, "REPORT.md")}`);
  } finally {
    server?.kill();
    rmSync(build, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
