import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each invocation has its own report; a previous passing result cannot mask
// missing/skipped tests. The demo project and local emulator are mandatory.
const reportDir = mkdtempSync(join(tmpdir(), "silverwick-rules-"));
const report = join(reportDir, "results.json");
try {
  const run = spawnSync(process.execPath, [
    "node_modules/vitest/vitest.mjs", "run", "--config", "vitest.rules.config.ts",
    "--reporter=default", "--reporter=json", `--outputFile=${report}`,
  ], { stdio: "inherit", env: process.env });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`Rules tests failed (exit ${run.status}).`);
  const result = JSON.parse(readFileSync(report, "utf8"));
  const tests = result.testResults.flatMap((suite) => suite.assertionResults);
  if (!result.success || tests.length === 0 || tests.some((test) => test.status !== "passed")) {
    throw new Error("Security run must execute at least one test and pass every test; skips/todos are failures.");
  }
  console.log(`Verified ${tests.length} emulator security tests passed; 0 skipped.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  // Only this invocation's mkdtemp directory is removed.
  rmSync(reportDir, { recursive: true, force: true });
}
