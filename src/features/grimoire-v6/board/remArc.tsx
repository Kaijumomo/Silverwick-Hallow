import { createElement as E, type ReactNode } from "react";

/** Label size on a reminder disc: longer text shrinks, the way the design sets it. */
export const remFs = (label: string): number => Math.max(9, Math.min(15, Math.round(150 / Math.max(1, (label || "").length))));

/**
 * The curved label along the lower rim of a reminder disc (the design's `remArc`). The path id is
 * derived from a stable key so a re-render never renames it.
 */
export function remArc(label: string, key: string): ReactNode {
  const id = `swRA-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  return E("svg", { viewBox: "0 0 100 100", "aria-hidden": true, style: { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" } },
    E("defs", null, E("path", { id, d: "M 12 52 A 38 38 0 0 0 88 52", fill: "none" })),
    E("text", { fontSize: remFs(label), fontWeight: 800, fill: "#2b1c0e", letterSpacing: 0.4, textAnchor: "middle", style: { textTransform: "uppercase", fontFamily: "inherit" } },
      E("textPath", { href: `#${id}`, startOffset: "50%" }, String(label || ""))));
}

/** The character name along the rim of a seat token (the design's token `arc`). */
export function tokenArc(name: string, key: string): ReactNode {
  const id = `arc-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  return E("svg", { viewBox: "0 0 100 100", style: { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" } },
    E("defs", null, E("path", { id, d: "M 10 54 A 40 40 0 0 0 90 54", fill: "none" })),
    E("text", { style: { fontFamily: "'Cormorant Garamond', serif", fontWeight: 700, fontSize: "12.5px", letterSpacing: "0.6px", fill: "#3b2a17" }, textAnchor: "middle" },
      E("textPath", { href: `#${id}`, startOffset: "50%" }, name.toUpperCase())));
}
