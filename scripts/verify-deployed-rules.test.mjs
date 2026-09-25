// rules:verify: read-only deployed-rules comparison. The Firebase CLI is
// replaced by a fake executable so every outcome is deterministic and no
// network, login or project is involved.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareRulesText, main, parseRules, stripRulesComments } from "./verify-deployed-rules.mjs";

const repoRules = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/firebase/rules.json"), "utf8");
const preRevocation = (() => { const r = JSON.parse(repoRules); delete r.rules.lobbies.$code.membershipRevocations; return JSON.stringify(r); })();

let dir;
let errors;
let logs;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rules-verify-test-"));
  errors = [];
  logs = [];
  vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args.join(" ")); });
  vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
});
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });

/** A fake `firebase` CLI: records its argv, then behaves per FAKE_MODE. */
function fakeCli() {
  const bin = join(dir, "firebase.js");
  writeFileSync(bin, `
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(join(dir, "argv.json"))}, JSON.stringify(args));
const out = args[args.indexOf("--output") + 1];
const mode = process.env.FAKE_MODE;
if (mode === "auth") { console.error("Error: Failed to authenticate, have you run firebase login?"); process.exit(1); }
if (mode === "silent") process.exit(0);
fs.writeFileSync(out, fs.readFileSync(process.env.FAKE_RULES, "utf8"));
`);
  return bin;
}
function run(mode, rulesText, extra = []) {
  const rulesFile = join(dir, "served.json");
  if (rulesText !== undefined) writeFileSync(rulesFile, rulesText);
  return main(["--project", "demo-project", "--firebase-bin", fakeCli(), ...extra], { PATH: process.env.PATH, FAKE_MODE: mode, FAKE_RULES: rulesFile });
}

describe("rules comparison", () => {
  it("matches regardless of key order and whitespace", () => {
    const reordered = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(repoRules)).reverse()), null, 7);
    expect(compareRulesText(reordered, repoRules)).toEqual({ match: true, differences: [] });
  });
  it("names the exact drifted path", () => {
    const result = compareRulesText(preRevocation, repoRules);
    expect(result.match).toBe(false);
    expect(result.differences).toEqual(["rules/lobbies/$code/membershipRevocations: missing from deployed rules"]);
  });
  it("detects a changed condition", () => {
    const changed = repoRules.replace("newData.val() === 'unseat' || newData.val() === 'remove'", "true");
    expect(compareRulesText(changed, repoRules).differences).toEqual(["rules/lobbies/$code/membershipRevocations/$uid/action/.validate: value differs"]);
  });
  it("accepts Console-style comments and a JSON-string rules body, and rejects empty or non-rules bodies", () => {
    expect(stripRulesComments('{"a": "x // not a comment", /* c */ "b": 1 // trailing\n}')).toBe('{"a": "x // not a comment",  "b": 1 \n}');
    expect(compareRulesText(`// deployed\n${repoRules}`, repoRules).match).toBe(true);
    expect(compareRulesText(JSON.stringify(repoRules), repoRules).match).toBe(true);
    expect(() => parseRules("", "Deployed rules")).toThrow(/empty/);
    expect(() => parseRules("null", "Deployed rules")).toThrow(/empty/);
    expect(() => parseRules("{\"x\":1}", "Deployed rules")).toThrow(/not a rules document/);
    expect(() => parseRules("<html>", "Deployed rules")).toThrow(/not valid rules JSON/);
  });
});

describe("rules:verify command", () => {
  it("requires an explicit project", () => {
    expect(main([], {})).toBe(2);
    expect(errors.join("\n")).toMatch(/explicit Firebase project is required/);
  });
  it("refuses to run against an emulator host instead of the deployed project", () => {
    expect(main(["--project", "p", "--firebase-bin", fakeCli()], { FIREBASE_DATABASE_EMULATOR_HOST: "127.0.0.1:9000" })).toBe(2);
  });
  it("performs only the read-only rules GET, never a deploy or write", () => {
    expect(run("serve", repoRules)).toBe(0);
    const argv = JSON.parse(readFileSync(join(dir, "argv.json"), "utf8"));
    expect(argv.slice(0, 4)).toEqual(["database:get", "/.settings/rules", "--project", "demo-project"]);
    expect(argv.filter(arg => /^(deploy|database:(set|update|remove|push|import|settings:set))$/.test(arg))).toEqual([]);
  });
  it("passes --instance through", () => {
    expect(run("serve", repoRules, ["--instance", "my-db"])).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "argv.json"), "utf8"))).toEqual(expect.arrayContaining(["--instance", "my-db"]));
  });
  it("reports success only after comparing identical rules", () => {
    expect(run("serve", repoRules)).toBe(0);
    expect(logs.join("\n")).toMatch(/match src\/firebase\/rules\.json/);
  });
  it("fails clearly, naming the drifted path, when the deployed rules differ", () => {
    expect(run("serve", preRevocation)).toBe(1);
    expect(errors.join("\n")).toMatch(/DIFFER/);
    expect(errors.join("\n")).toMatch(/membershipRevocations: missing from deployed rules/);
    expect(logs).toEqual([]);
  });
  it("fails clearly, without claiming a comparison, when Firebase auth is unavailable", () => {
    expect(run("auth", undefined)).toBe(1);
    expect(errors.join("\n")).toMatch(/Could not read the deployed rules.*Nothing was compared/s);
    expect(errors.join("\n")).toMatch(/firebase login/);
    expect(logs).toEqual([]);
  });
  it("fails when the CLI returns no rules", () => {
    expect(run("silent", undefined)).toBe(1);
    expect(run("serve", "null")).toBe(1);
    expect(logs).toEqual([]);
  });
});
