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
  return { ...chrome, ...board.vm, ...setup.vm, ...night.vm, ...day.vm, ...info.vm };
}
