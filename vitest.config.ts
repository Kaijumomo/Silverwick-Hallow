import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Fast tests intentionally exclude the required emulator-only *.spec suite.
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
    globals: true,
    // Default for component tests. Pure-logic test files opt into the faster plain Node environment with a
    // `// @vitest-environment node` first line; add it only to a file that passes without a DOM.
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
