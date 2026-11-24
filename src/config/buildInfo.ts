// The one place the UI reads build identity from. Values are injected at build time by vite.config.ts:
// version from package.json (the single source of truth), short commit, build time (UTC) and channel
// (production, preview, development or local). Vitest does not run the Vite `define`, so each falls back safely.
declare const __APP_VERSION__: string | undefined;
declare const __APP_COMMIT__: string | undefined;
declare const __APP_BUILT_AT__: string | undefined;
declare const __APP_CHANNEL__: string | undefined;

export type BuildInfo = {
  version: string;
  commit: string;
  builtAt: string;
  channel: string;
};

export const BUILD_INFO: BuildInfo = Object.freeze({
  version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0",
  commit: typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "unknown",
  builtAt: typeof __APP_BUILT_AT__ === "string" ? __APP_BUILT_AT__ : "",
  channel: typeof __APP_CHANNEL__ === "string" ? __APP_CHANNEL__ : "local",
});

/** "v0.5.0": what the Home footer shows. */
export function shortVersion(info: BuildInfo = BUILD_INFO): string {
  return `v${info.version}`;
}

/** "2026-11-24 14:10Z", or "unknown" when the build time is missing or invalid. */
export function formatBuiltAt(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "unknown";
  return `${d.toISOString().slice(0, 16).replace("T", " ")}Z`;
}

/** "v0.5.0 · 6d3b2bd · built 2026-11-24 14:10Z · production": what Copy puts on the clipboard. */
export function describeBuild(info: BuildInfo = BUILD_INFO): string {
  return `${shortVersion(info)} · ${info.commit} · built ${formatBuiltAt(info.builtAt)} · ${info.channel}`;
}
