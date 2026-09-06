// Vitest config for the Firebase RTDB rules tests. Runs only the rules
// suite. `npm run test:rules` starts/stops the emulator; direct runs fail
// when FIREBASE_DATABASE_EMULATOR_HOST is missing or unreachable.

import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    include: ["src/firebase/rules.spec.ts"],
    globals: false,
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    passWithNoTests: false,
  },
});
