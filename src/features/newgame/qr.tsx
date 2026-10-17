import { useMemo } from "react";
import qrcode from "qrcode-generator";

/**
 * Local QR rendering (qrcode-generator, MIT). Nothing leaves the device: the
 * join link is encoded in the browser and drawn as one SVG path.
 */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_, col) => qr.isDark(row, col)));
}

const QUIET = 4; // the QR spec's quiet zone

export function QrCode({ text, label }: { text: string; label: string }) {
  const { path, size } = useMemo(() => {
    const modules = qrModules(text);
    const n = modules.length;
    let d = "";
    modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`; }));
    return { path: d, size: n + QUIET * 2 };
  }, [text]);
  return (
    <svg className="sf-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#f4ead0" />
      <path d={path} fill="#1a0f0c" />
    </svg>
  );
}

/** The real player join link for a lobby: `?join=CODE` on this app's own URL.
 * Only the 8-character code travels; no name, token or account id. */
export function buildPlayerJoinLink(location: { origin: string; pathname: string }, code: string): string {
  const url = new URL(location.pathname, location.origin);
  url.search = `?join=${encodeURIComponent(code)}`;
  return url.toString();
}
