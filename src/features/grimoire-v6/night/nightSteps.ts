import type { RoleRegistry } from "@/data/roleRegistry";
import { iconUrlFor } from "@/data/iconUrl";
import { nightSheetIconUrl, nightSheetIdOfStep } from "@/data/nightSheetIcon";
import { lifeEventsAt } from "@/stores/lifeEvents";
import type { StorytellerLobbyRecord } from "@/stores/types";
import type { NightStep } from "@/features/nightOrder/nightOrder";
import { stepResolved } from "@/features/nightOrder/nightWork";
import { ICON } from "../icons";

/** The Night strip of the V2 design is Dusk, tonight's steps, then Dawn. */
export type NightPosition =
  | { kind: "dusk" }
  | { kind: "step"; step: NightStep }
  | { kind: "dawn" };

export const stepLabel = (step: NightStep): string => (step.kind === "player" ? step.effectiveRoleName : step.label);

/** The "who" line under the character name. */
export function stepWho(step: NightStep, game: StorytellerLobbyRecord): string {
  if (step.kind === "player") return `${step.playerName || `Seat ${step.seat + 1}`} · Seat ${step.seat + 1}${step.alive ? "" : " · Dead"}`;
  if (step.recipientIds?.length) {
    return step.recipientIds.map((id) => {
      const player = game.players[id];
      return player ? `${player.name || `Seat ${player.seat + 1}`} · Seat ${player.seat + 1}` : "";
    }).filter(Boolean).join("  ·  ");
  }
  return "Storyteller procedure";
}

export function stepIcon(step: NightStep, registry: RoleRegistry): string {
  if (step.kind === "player") {
    const role = registry.get(step.effectiveRoleId);
    return role ? iconUrlFor(role) : "";
  }
  const sheet = nightSheetIdOfStep(step.stepKey);
  return sheet ? nightSheetIconUrl(sheet) : "";
}

export function duskText(day: number): string {
  return day === 1
    ? "Check that all eyes are closed. Travellers with a first-night ability act first."
    : "Everyone closes their eyes. The night begins.";
}

/** Names of the players recorded as dying tonight, or null when the Night's deaths cannot be known from the record. */
export function nightDeaths(game: StorytellerLobbyRecord): string[] | null {
  const deaths = lifeEventsAt(game, { phase: "night", day: game.day }, (event) => event.kind === "death");
  if (deaths.status !== "known") return null;
  return [...new Set(deaths.events.map((event) => event.subject.nameAtTime || game.players[event.subject.playerId]?.name || "A player"))];
}

const listNames = (names: string[]) => names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

export function dawnText(game: StorytellerLobbyRecord): string {
  const deaths = nightDeaths(game);
  if (deaths === null) return "Check who died tonight before everyone opens their eyes.";
  return deaths.length
    ? `${listNames(deaths)} died in the night. Everyone else may open their eyes.`
    : "No one died tonight. Everyone may open their eyes.";
}

/** The dawn flash shown once Day begins. */
export function dawnFlash(deaths: string[] | null): string {
  if (deaths === null) return "Dawn breaks.";
  return deaths.length ? `Dawn breaks. ${listNames(deaths)} did not survive the night.` : "Dawn breaks. No one died in the night.";
}

/** One carousel disc of the strip. `index` is the item's index in the strip, `cursor` the current one. */
export function stripItem(opts: {
  label: string; img: string; marker: boolean; markerIcon: string; done: boolean;
  index: number; cursor: number; jump: () => void;
}) {
  const on = opts.index === opts.cursor;
  const before = opts.index < opts.cursor;
  return {
    role: opts.label, hasImg: !!opts.img, img: opts.img, marker: opts.marker, markerIcon: opts.markerIcon, done: opts.done,
    jump: opts.jump, scale: on ? 1.14 : 0.8, op: on ? 1 : before ? 0.5 : 0.88, filter: "none",
    labelColor: on ? "#ffb4a6" : "rgba(222,216,204,.6)", labelOp: on ? 1 : 0,
    bg: opts.marker ? "radial-gradient(circle at 50% 35%, #2a3048, #0d0f18 75%)" : "radial-gradient(circle at 38% 30%, #f1e6c9 0%, #dccaa0 48%, #b09566 100%)",
    shadow: on ? "0 0 0 3px #14151d, 0 0 0 5px #e8584a, 0 0 30px rgba(232,88,74,.55)" : "0 0 0 3px #14151d, 0 0 0 4px rgba(176,186,204,.35), 0 8px 18px rgba(0,0,0,.5)",
  };
}

export const MARKER_ICON = { dusk: ICON.moon, dawn: ICON.sun, step: ICON.moon } as const;

/** Where the strip rests, given the Night work, the Night cursor and any checkpoint the Storyteller moved to. */
export function resolvePosition(opts: {
  game: StorytellerLobbyRecord; steps: NightStep[]; cursorKey: string | undefined; checkpoint: "dusk" | "dawn" | null; held: NightStep | undefined;
}): NightPosition {
  const { game, steps, cursorKey, checkpoint, held } = opts;
  if (checkpoint === "dusk") return { kind: "dusk" };
  if (checkpoint === "dawn") return { kind: "dawn" };
  const heldStep = held && !steps.some((step) => step.stepKey === held.stepKey) ? held : undefined;
  const pinned = heldStep ?? (cursorKey ? steps.find((step) => step.stepKey === cursorKey) : undefined);
  if (pinned) return { kind: "step", step: pinned };
  if (!steps.length) return { kind: "dusk" };
  if (!steps.some((step) => stepResolved(game, step))) return { kind: "dusk" };
  const open = steps.find((step) => !stepResolved(game, step));
  return open ? { kind: "step", step: open } : { kind: "dawn" };
}
