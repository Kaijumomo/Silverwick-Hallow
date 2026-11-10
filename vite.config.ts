import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  define: {
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
});
