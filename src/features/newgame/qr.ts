import qrcode from "qrcode-generator";

/**
 * Local QR rendering (qrcode-generator, MIT). Nothing leaves the device: the
 * join link is encoded in the browser. The one QR module for the app: the
 * Grimoire invitation, the setup card and the Public Display all draw from it.
 */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_, col) => qr.isDark(row, col)));
}

/** The dark modules as one SVG path, offset by a quiet zone of `quiet` modules on every side. */
export function qrPath(text: string, quiet = 0): { path: string; size: number } {
  const modules = qrModules(text);
  let path = "";
  modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x + quiet} ${y + quiet}h1v1h-1z`; }));
  return { path, size: modules.length + quiet * 2 };
}

/** The real player join link for a lobby: `?join=CODE` on this app's own URL.
 * Only the 8-character code travels; no name, token or account id (never the
 * Public Display token in the fragment). */
export function buildPlayerJoinLink(location: { origin: string; pathname: string }, code: string): string {
  const url = new URL(location.pathname, location.origin);
  url.search = `?join=${encodeURIComponent(code)}`;
  return url.toString();
}
