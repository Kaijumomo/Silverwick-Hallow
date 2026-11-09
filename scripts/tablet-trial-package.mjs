import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist-tablet-trial");
const archive = resolve(root, "silverwick-tablet-trial.zip");
if (process.platform !== "win32") throw new Error("This packaging helper uses Windows .NET ZIP support. Zip dist-tablet-trial with your platform's archive utility instead.");
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!process.argv.includes("--skip-build")) run(process.execPath, [resolve(root, "scripts/tablet-trial-build.mjs")]);
if (lstatSync(output).isSymbolicLink()) throw new Error("Trial output must be a regular directory.");
const manifest = JSON.parse(readFileSync(resolve(output, "tablet-trial.json"), "utf8"));
if (manifest.kind !== "silverwick-offline-tablet-trial" || manifest.firebaseEnabled !== false) throw new Error("Build the isolated tablet trial first.");
// Fixed command; filesystem paths are passed as data, never interpolated into shell code.
run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; if (Test-Path -LiteralPath $env:SILVERWICK_TRIAL_ARCHIVE) { Remove-Item -LiteralPath $env:SILVERWICK_TRIAL_ARCHIVE }; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:SILVERWICK_TRIAL_OUTPUT, $env:SILVERWICK_TRIAL_ARCHIVE, [System.IO.Compression.CompressionLevel]::Optimal, $true)"], {
  ...process.env, SILVERWICK_TRIAL_OUTPUT: output, SILVERWICK_TRIAL_ARCHIVE: archive,
});
console.log(`Packaged: ${archive}`);
