// Verifies the vitest JSON report of the Trouble Brewing run against the committed manifest.
// Usage: node check-trouble-brewing.mjs <report.json> <manifest.json>
import { readFileSync } from "node:fs";

const [reportPath, manifestPath] = process.argv.slice(2);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")).files;
const root = process.cwd().replace(/\\/g, "/") + "/";

const ran = new Map();
for (const file of report.testResults) {
  ran.set(file.name.replace(/\\/g, "/").replace(root, ""), file.assertionResults);
}

const problems = [];
if (!report.success) problems.push("vitest reported failure");
for (const [name, tests] of ran) {
  const bad = tests.filter((t) => t.status !== "passed");
  if (bad.length > 0) problems.push(`${name}: ${bad.length} test(s) not passed (failed/skipped/todo)`);
}
for (const [name, min] of Object.entries(manifest)) {
  const tests = ran.get(name);
  if (!tests) problems.push(`${name}: protected file missing from the run (deleted or renamed?)`);
  else if (tests.filter((t) => t.status === "passed").length < min) {
    problems.push(`${name}: ${tests.length} test(s) ran, manifest requires at least ${min}`);
  }
}
const added = [...ran.keys()].filter((name) => !(name in manifest));
if (added.length > 0) console.log(`Note: not in manifest yet (add them to protect them): ${added.join(", ")}`);

const total = [...ran.values()].reduce((n, t) => n + t.length, 0);
console.log(`Trouble Brewing: ${ran.size} files, ${total} tests; manifest lists ${Object.keys(manifest).length} files`);
if (problems.length > 0) {
  console.error(problems.map((p) => `FAIL ${p}`).join("\n"));
  process.exit(1);
}
