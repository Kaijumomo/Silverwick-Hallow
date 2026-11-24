import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

// Build identity (src/config/buildInfo.ts is the only reader). The version is package.json's; the commit comes from
// Cloudflare Pages (CF_PAGES_COMMIT_SHA) or local git; the channel from Cloudflare's branch or the Vite mode.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as { version: string };
function buildCommit(): string {
  const cf = process.env.CF_PAGES_COMMIT_SHA?.trim();
  if (cf) return cf.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "unknown";
  } catch {
    return "unknown";
  }
}
function buildChannel(mode: string): string {
  if (process.env.CF_PAGES === "1") return process.env.CF_PAGES_BRANCH === "main" ? "production" : "preview";
  return mode === "development" ? "development" : "local";
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(buildCommit()),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
    __APP_CHANNEL__: JSON.stringify(buildChannel(mode)),
    // Local multi-device test harness only (src/firebase/emulator.ts). "" in every ordinary build.
    __SILVERWICK_EMULATOR_HOST__: JSON.stringify(process.env.SILVERWICK_EMULATOR_HOST ?? ""),
  },
  server: {
    port: parseInt(process.env.PORT ?? "5173"),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: true,
  },
  esbuild: {
    drop: process.env.NODE_ENV === "production" ? ["console", "debugger"] : [],
  },
}));
