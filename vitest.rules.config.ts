// Vitest config for the Firebase RTDB rules tests. Runs only the rules
// suite. `npm run test:rules` starts/stops the emulator; direct runs fail
// when FIREBASE_DATABASE_EMULATOR_HOST is missing or unreachable.

import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    include: ["src/firebase/rules.spec.ts", "src/firebase/contract.spec.ts"],
    // Both spec files initialize their own RulesTestEnvironment against the
    // SAME running emulator and clearDatabase() in beforeEach. Running the
    // two files concurrently (Vitest's default) would let one file's
    // clearDatabase() race the other file's in-flight assertions against the
    // same database. fileParallelism:false keeps emulator spec files
    // strictly sequential; tests within a single file already run in order.
    fileParallelism: false,
    globals: false,
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    passWithNoTests: false,
  },
});
