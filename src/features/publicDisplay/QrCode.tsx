import { useMemo } from "react";
import qrcode from "qrcode-generator";

/**
 * Local QR rendering (qrcode-generator, MIT) for the waiting display. Nothing
 * leaves the device: the join link is encoded in the browser and drawn as one
 * SVG path. The cream plate around it (townSquare.css) is the quiet zone.
 */
export function qrPath(text: string): { path: string; size: number } {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  let path = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) path += `M${x} ${y}h1v1h-1z`;
  return { path, size: n };
}

export function QrCode({ text, label }: { text: string; label: string }) {
  const { path, size } = useMemo(() => qrPath(text), [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <path d={path} fill="#14151d" />
    </svg>
  );
}

/** The player join link for a lobby: `?join=CODE` on this app's own URL. Only
 * the lobby code travels -- never the Public Display token in the fragment. */
export function joinLinkFor(location: { origin: string; pathname: string }, code: string): string {
  const url = new URL(location.pathname, location.origin);
  url.search = `?join=${encodeURIComponent(code)}`;
  return url.toString();
}
