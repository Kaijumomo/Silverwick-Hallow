/** Exact SVG geometry observed in the approved Claude tablet v3 prototype.
 * These are interface symbols, not a claim of official information-token art.
 */
const paths = {
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0",
  identify: "M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 21a8 8 0 0 1 11-7.4M17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M21.5 22l-2.2-2.2",
  selected: "M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 21a8 8 0 0 1 12-6.9M16 19l2 2 4-4",
  reveal: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0",
  vote: "M4 14h16v7H4zM8 14V4h8v10M10 9l1.5 1.5L14 8",
  nominate: "M3 11v3a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12",
  good: "M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z",
  evil: "M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z",
  crown: "M2 20h20M3 7l4.5 5L12 4l4.5 8L21 7l-2 10H5z",
  players: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  book: "M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z",
  night: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z",
  day: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 16v-4M12 8h.01",
  return: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  close: "M18 6 6 18M6 6l12 12",
} as const;

export type GrimoireIconName = keyof typeof paths;
export function GrimoireIcon({ name, size = 18, strokeWidth = 1.6 }: { name: GrimoireIconName; size?: number; strokeWidth?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
