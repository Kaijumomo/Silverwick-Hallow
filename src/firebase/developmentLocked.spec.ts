import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";

let environment: RulesTestEnvironment;
beforeAll(async () => {
  const address = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  if (!address || !/^(127\.0\.0\.1|localhost):\d+$/.test(address)) {
    throw new Error("A local RTDB emulator is required. Run npm run test:rules.");
  }
  const [host, port] = address.split(":");
  environment = await initializeTestEnvironment({
    projectId: "demo-silverwick-rules",
    database: { host, port: Number(port), rules: readFileSync(resolve(__dirname, "development.locked.rules.json"), "utf8") },
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.database().ref("locked-test").set({ value: "synthetic emulator fixture" });
  });
});
afterAll(async () => { if (environment) await environment.cleanup(); });

describe("development database stays locked", () => {
  it.each([null, "synthetic-authenticated-user"])("denies reads and writes for %s", async (uid) => {
    const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext();
    await assertFails(context.database().ref("locked-test").get());
    await assertFails(context.database().ref("locked-test").set({ value: "denied" }));
    await assertFails(context.database().ref().get());
    await assertFails(context.database().ref().update({ "locked-test/value": "denied" }));
  });
});
