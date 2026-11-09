import type { V6Ctx } from "./ctx";
import { useBoardVm } from "./vm/board";
import { useChromeVm } from "./vm/chrome";
import { useDayVm } from "./vm/day";
import { useInfoVm } from "./vm/info";
import { useNightVm } from "./vm/night";
import { useSetupVm } from "./vm/setup";

/**
 * Composes the view-model the generated Grimoire view reads. Each slice owns a set of top-level keys
 * (board: tokens, popover, picker; setup: wizard and town card; night: strip; day: day card, nominations;
 * info: info, reference, show, end) and may contribute the dock's advance control; the chrome slice
 * (header, dock, backdrop, ring, invitation, undo, toast) wraps them.
 */
export function useGrimoireVm(ctx: V6Ctx): Record<string, unknown> {
  const board = useBoardVm(ctx);
  const setup = useSetupVm(ctx);
  const night = useNightVm(ctx);
  const day = useDayVm(ctx);
  const info = useInfoVm(ctx);
  const phase = ctx.game.phase;
  const owner = phase === "setup" ? setup : phase === "night" ? night : phase === "day" ? day : null;
  const chrome = useChromeVm(ctx, {
    advance: owner?.advance,
    pill: { ...night.pill, ...day.pill },
    acting: (night.vm.actingName as string | null | undefined) ?? null,
    center: (day.vm.center as { kicker: string; title: string; sub: string } | undefined) ?? null,
  });
  return mergeSlices({ chrome, board: board.vm, setup: setup.vm, night: night.vm, day: day.vm, info: info.vm },
    { setup: setup.overrides ?? {}, info: info.overrides ?? {} });
}

/**
 * Spreads the slices into one view-model. Each top-level key must come from exactly one slice: a key two slices
 * both return would silently let the later one win, so tests fail on it and the dev server logs it. A deliberate
 * replacement goes in a slice's `overrides`, applied after all slices in the order given; a slice may not also
 * return an override key in its own `vm`, and two slices may not override the same key. Production skips the
 * checks.
 */
export function mergeSlices(slices: Record<string, Record<string, unknown>>, overrides: Record<string, Record<string, unknown>> = {}): Record<string, unknown> {
  if (import.meta.env.DEV) {
    // Tests fail on a clash; the dev server only reports it, so a clash never blanks the Grimoire mid-session.
    const fail = (message: string) => {
      if (import.meta.env.MODE === "test") throw new Error(message);
      console.error(message);
    };
    const owner = new Map<string, string>();
    for (const [name, slice] of Object.entries(slices)) {
      for (const key of Object.keys(slice)) {
        const previous = owner.get(key);
        if (previous) fail(`Grimoire view-model key "${key}" is returned by both the ${previous} and ${name} slices`);
        owner.set(key, name);
      }
    }
    const overridden = new Map<string, string>();
    for (const [name, slice] of Object.entries(overrides)) {
      for (const key of Object.keys(slice)) {
        if (owner.get(key) === name) fail(`Grimoire view-model key "${key}" is both returned and overridden by the ${name} slice`);
        const previous = overridden.get(key);
        if (previous) fail(`Grimoire view-model key "${key}" is overridden by both the ${previous} and ${name} slices`);
        overridden.set(key, name);
      }
    }
  }
  return Object.assign({}, ...Object.values(slices), ...Object.values(overrides));
}
