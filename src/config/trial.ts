/** Build-time only: neither a URL nor browser storage can enable/disable it. */
export const isTabletTrial = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env?.VITE_TABLET_TRIAL === "1";

export const TABLET_TRIAL_OFFLINE_MESSAGE = "This tablet trial is local only. Online lobbies are disabled.";
