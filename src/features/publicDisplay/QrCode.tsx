import { useMemo } from "react";
import { qrPath } from "@/features/newgame/qr";

/**
 * The waiting display's QR, drawn locally from the app's one QR module. The cream
 * plate around it (townSquare.css) is the quiet zone, so none is added here.
 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { path, size } = useMemo(() => qrPath(text), [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <path d={path} fill="#14151d" />
    </svg>
  );
}
