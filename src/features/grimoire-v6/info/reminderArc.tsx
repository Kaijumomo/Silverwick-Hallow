import { createElement as E, type ReactNode } from "react";

/** Reminder-token label size, as the design sets it: shorter labels are larger. */
export const remFs = (label: string) => Math.max(9, Math.min(15, Math.round(150 / Math.max(1, (label || "").length))));

/** The label laid along the lower arc of a reminder token (the design's SVG text path). */
export function reminderArc(id: string, label: string): ReactNode {
  return E("svg", { viewBox: "0 0 100 100", "aria-hidden": true, style: { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" } },
    E("defs", null, E("path", { id, d: "M 12 52 A 38 38 0 0 0 88 52", fill: "none" })),
    E("text", { fontSize: remFs(label), fontWeight: 800, fill: "#2b1c0e", letterSpacing: 0.4, textAnchor: "middle", style: { textTransform: "uppercase", fontFamily: "inherit" } },
      E("textPath", { href: `#${id}`, startOffset: "50%" }, String(label || ""))));
}
