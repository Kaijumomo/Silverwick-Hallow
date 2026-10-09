import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "dist-tablet-trial");
// Vite may clear this directory. Never follow an output-directory junction.
if (existsSync(out) && lstatSync(out).isSymbolicLink()) throw new Error("Trial output must be a regular directory inside this checkout.");
const env = { ...process.env, VITE_TABLET_TRIAL: "1" };
for (const key of Object.keys(env)) if (key.startsWith("VITE_FIREBASE_")) env[key] = "";
const run = args => {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run(["node_modules/typescript/bin/tsc", "-b", "--noEmit"]);
// Explicit defines defeat .env.local fallback values in this dedicated build.
// Vite loads the selected config below rather than modifying the normal build.
const { build } = await import("vite");
await build({ configFile: resolve(root, "scripts/tablet-trial.vite.config.ts"), mode: "tablet-trial", envFile: false, build: { outDir: out } });
writeFileSync(resolve(out, "tablet-trial.json"), JSON.stringify({ kind: "silverwick-offline-tablet-trial", firebaseEnabled: false, builtAt: new Date().toISOString() }, null, 2));
copyFileSync(resolve(root, "scripts/tablet-trial-server.mjs"), resolve(out, "server.mjs"));
copyFileSync(resolve(root, "docs/TABLET_TRIAL.md"), resolve(out, "README.md"));
writeFileSync(resolve(out, "Start-Tablet-Trial.ps1"), '$ErrorActionPreference = "Stop"\n& node (Join-Path $PSScriptRoot "server.mjs")\n');
writeFileSync(resolve(out, "Start-Tablet-Trial.cmd"), '@echo off\r\nnode "%~dp0server.mjs"\r\nif errorlevel 1 pause\r\n');
const index = readFileSync(resolve(out, "index.html"), "utf8");
if (!index.includes("/assets/")) throw new Error("The tablet trial did not produce the expected application entry.");
console.log(`\nLocal-only build ready: ${out}\nStart: node scripts/tablet-trial-server.mjs\nPackage: node scripts/tablet-trial-package.mjs --skip-build`);
