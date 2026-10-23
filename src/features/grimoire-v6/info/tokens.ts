import { ICON } from "../icons";

/** The eight Information tokens of the design, in its order. `pick` tokens ask for a character first. */
export type InfoTokenDef = {
  label: string;
  icon: string;
  pick?: boolean;
  /** Heading shown on the player view when it differs from the label. */
  title?: string;
  symbol?: "vote" | "nominate" | "good" | "evil";
  color: string;
};

const DEFAULT_COLOR = "#e8584a";

export const INFO_TOKENS: InfoTokenDef[] = [
  { label: "You Are", icon: ICON.youAre, pick: true, color: DEFAULT_COLOR },
  { label: "This Player Is", icon: ICON.thisPlayer, pick: true, color: DEFAULT_COLOR },
  { label: "Selected You", icon: ICON.selected, pick: true, color: DEFAULT_COLOR },
  { label: "Reveal a Token", title: "This Character", icon: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", pick: true, color: DEFAULT_COLOR },
  { label: "Did You Vote Today?", icon: ICON.vote, symbol: "vote", color: DEFAULT_COLOR },
  { label: "Did You Nominate Today?", icon: ICON.nominate, symbol: "nominate", color: DEFAULT_COLOR },
  { label: "You Are Good", icon: ICON.good, symbol: "good", color: "#86b7d4" },
  { label: "You Are Evil", icon: ICON.evil, symbol: "evil", color: "#e88a7a" },
];

/** How the full-screen text token is dressed (disc ink, ring, title colour, glow). */
export type TextStyle = { ink: string; ring: string; titleColor: string; halo: string };
const NEUTRAL: TextStyle = { ink: "#3a2616", ring: "rgba(120,85,40,.45)", titleColor: "#e8c77a", halo: "rgba(232,170,90,.18)" };
export const TEXT_STYLE: Record<string, TextStyle> = {
  vote: NEUTRAL,
  nominate: NEUTRAL,
  good: { ink: "#1f4f72", ring: "rgba(40,100,150,.6)", titleColor: "#a9cde3", halo: "rgba(90,150,200,.2)" },
  evil: { ink: "#7a1a12", ring: "rgba(150,40,30,.6)", titleColor: "#eba597", halo: "rgba(200,60,40,.22)" },
};

export const SETUP_LABEL = {
  traveler: "Evil Traveller Information",
  demon: "Demon Information",
  minion: "Minion Information",
  bluffs: "Demon Bluffs",
} as const;
export const SETUP_ORDER = ["traveler", "demon", "minion", "bluffs"] as const;
export const SETUP_ICON = { traveler: ICON.crown, demon: ICON.crown, minion: ICON.users, bluffs: ICON.book } as const;
