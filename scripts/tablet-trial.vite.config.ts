import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, ".."),
  // Only explicit defines below are public in this dedicated build.
  envPrefix: "SILVERWICK_TRIAL_PUBLIC_UNUSED_",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
  define: {
    "import.meta.env.VITE_TABLET_TRIAL": JSON.stringify("1"),
    "import.meta.env.VITE_FIREBASE_API_KEY": JSON.stringify(""),
    "import.meta.env.VITE_FIREBASE_AUTH_DOMAIN": JSON.stringify(""),
    "import.meta.env.VITE_FIREBASE_DATABASE_URL": JSON.stringify(""),
    "import.meta.env.VITE_FIREBASE_PROJECT_ID": JSON.stringify(""),
    "import.meta.env.VITE_FIREBASE_STORAGE_BUCKET": JSON.stringify(""),
    "import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID": JSON.stringify(""),
    "import.meta.env.VITE_FIREBASE_APP_ID": JSON.stringify(""),
  },
  build: { sourcemap: false, emptyOutDir: true },
});
