#!/usr/bin/env node
// Read-only check: do the Realtime Database security rules DEPLOYED to a
// Firebase project match src/firebase/rules.json?
//
//   npm run rules:verify -- --project <PROJECT_ID> [--instance <DB_INSTANCE>]
//
// The web client ships from `main` automatically, but rules reach Firebase
// only through `npm run rules:deploy`. When they drift, a newer client's
// Storyteller startup is denied by older rules (the Phase 9R.6 Go Live
// failure). This command makes no deployment and no database write: it runs
// `firebase database:get /.settings/rules` (the Firebase CLI's own
// authenticated, read-only REST read of the rules source), normalizes both
// rule sets, and compares them. It exits 0 ONLY after an actual comparison
// found them identical; every other outcome -- missing project, missing
// Firebase login, unreadable or unparseable rules, or any difference --
// exits non-zero.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_RULES = join(repoRoot, "src", "firebase", "rules.json");
const DEFAULT_FIREBASE_BIN = join(repoRoot, "node_modules", "firebase-tools", "lib", "bin", "firebase.js");

/** Rules edited in the Firebase Console may carry // or /* *\/ comments,
 * which the rules language accepts but JSON does not. Strips them outside
 * string literals only. */
export function stripRulesComments(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") { out += text[++i] ?? ""; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
    if (ch === "/" && text[i + 1] === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i++; continue; }
    out += ch;
  }
  return out;
}

/** Parses a rules document. Throws a descriptive Error when it is not a
 * rules object ({ "rules": { ... } }). */
export function parseRules(text, label) {
  if (typeof text !== "string" || text.trim() === "" || text.trim() === "null") {
    throw new Error(`${label} is empty: no rules were returned.`);
  }
  let value;
  try { value = JSON.parse(stripRulesComments(text)); }
  catch (error) { throw new Error(`${label} is not valid rules JSON (${error.message}).`); }
  // The REST read may return the rules source as a JSON string.
  if (typeof value === "string") return parseRules(value, label);
  if (value === null || typeof value !== "object" || Array.isArray(value) || typeof value.rules !== "object" || value.rules === null) {
    throw new Error(`${label} is not a rules document (expected an object with a "rules" key).`);
  }
  return value;
}

/** Order-independent, whitespace-independent canonical form. */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

/** JSON paths (e.g. rules/lobbies/$code/membershipRevocations) where the two
 * rule sets differ: missing on either side, or a different value. */
export function diffRules(deployed, expected, path = "", out = []) {
  const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
  if (isObject(deployed) && isObject(expected)) {
    for (const key of [...new Set([...Object.keys(deployed), ...Object.keys(expected)])].sort()) {
      const child = path ? `${path}/${key}` : key;
      if (!(key in deployed)) out.push(`${child}: missing from deployed rules`);
      else if (!(key in expected)) out.push(`${child}: deployed only (not in src/firebase/rules.json)`);
      else diffRules(deployed[key], expected[key], child, out);
    }
  } else if (JSON.stringify(canonicalize(deployed)) !== JSON.stringify(canonicalize(expected))) {
    out.push(`${path || "(root)"}: value differs`);
  }
  return out;
}

/** Compares deployed rules text against the repository rules text. */
export function compareRulesText(deployedText, expectedText) {
  const deployed = parseRules(deployedText, "Deployed rules");
  const expected = parseRules(expectedText, "src/firebase/rules.json");
  const differences = diffRules(canonicalize(deployed), canonicalize(expected));
  return { match: differences.length === 0, differences };
}

export function parseArgs(argv) {
  const options = { project: null, instance: null, firebaseBin: DEFAULT_FIREBASE_BIN };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (!next || next.startsWith("--")) throw new Error(`${arg} requires a value.`);
      return next;
    };
    if (arg === "--project") options.project = value();
    else if (arg === "--instance") options.instance = value();
    else if (arg === "--firebase-bin") options.firebaseBin = resolve(value());
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

const USAGE = `Usage: npm run rules:verify -- --project <PROJECT_ID> [--instance <DB_INSTANCE>] [--firebase-bin <path>]

Read-only. Compares the Realtime Database rules deployed to <PROJECT_ID> with
src/firebase/rules.json. Requires a Firebase CLI login with access to the
project (npx firebase login). Never deploys and never writes data.`;

export function main(argv, env = process.env) {
  let options;
  try { options = parseArgs(argv); }
  catch (error) { console.error(`${error.message}\n\n${USAGE}`); return 2; }
  if (options.help) { console.log(USAGE); return 0; }
  if (!options.project) {
    console.error(`An explicit Firebase project is required.\n\n${USAGE}`);
    return 2;
  }
  if (env.FIREBASE_DATABASE_EMULATOR_HOST) {
    console.error("FIREBASE_DATABASE_EMULATOR_HOST is set, so the Firebase CLI would read the local emulator instead of the deployed rules. Unset it and retry.");
    return 2;
  }
  if (!existsSync(options.firebaseBin)) {
    console.error(`Firebase CLI not found at ${options.firebaseBin}. Run npm ci first.`);
    return 2;
  }
  let expectedText;
  try { expectedText = readFileSync(REPO_RULES, "utf8"); }
  catch (error) { console.error(`Could not read ${REPO_RULES}: ${error.message}`); return 2; }

  const outDir = mkdtempSync(join(tmpdir(), "silverwick-rules-verify-"));
  const outFile = join(outDir, "deployed-rules.json");
  try {
    const args = [options.firebaseBin, "database:get", "/.settings/rules", "--project", options.project, "--output", outFile];
    if (options.instance) args.push("--instance", options.instance);
    const run = spawnSync(process.execPath, args, { encoding: "utf8", env });
    if (run.error || run.status !== 0) {
      const detail = (run.error?.message ?? `${run.stderr ?? ""}\n${run.stdout ?? ""}`).trim();
      console.error(`Could not read the deployed rules for project "${options.project}". Nothing was compared.`);
      console.error("Check that you are logged in (npx firebase login) with access to this project, and that the project ID / --instance are correct.");
      if (detail) console.error(`\nFirebase CLI output:\n${detail}`);
      return 1;
    }
    if (!existsSync(outFile)) {
      console.error("The Firebase CLI reported success but produced no rules output. Nothing was compared.");
      return 1;
    }
    let result;
    try { result = compareRulesText(readFileSync(outFile, "utf8"), expectedText); }
    catch (error) { console.error(`${error.message} Nothing was compared.`); return 1; }
    const target = `project "${options.project}"${options.instance ? `, instance "${options.instance}"` : ""}`;
    if (result.match) {
      console.log(`Deployed Realtime Database rules for ${target} match src/firebase/rules.json.`);
      return 0;
    }
    console.error(`Deployed Realtime Database rules for ${target} DIFFER from src/firebase/rules.json (${result.differences.length} difference${result.differences.length === 1 ? "" : "s"}):`);
    for (const line of result.differences.slice(0, 40)) console.error(`  - ${line}`);
    if (result.differences.length > 40) console.error(`  ... and ${result.differences.length - 40} more`);
    console.error("\nDeploy the repository rules with: npx firebase use <PROJECT_ID> && npm run rules:deploy");
    return 1;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
