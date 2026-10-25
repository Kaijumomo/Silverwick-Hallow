import { createElement as E, useEffect, useRef, type ReactNode } from "react";
import type { NightInformationHandle } from "@/features/nightOrder/NightInformationAction";
import { stepResolved } from "@/features/nightOrder/nightWork";
import { hasEffect } from "@/stores/effects";
import type { V6Ctx } from "../ctx";
import { renderNightCustom } from "../night/NightCustom";
import { dawnText, duskText, MARKER_ICON, stepIcon, stepLabel, stepWho, stripItem } from "../night/nightSteps";
import { useNightEngine } from "../night/useNightEngine";
import { EMPTY, type SliceResult } from "./types";

const BREATH = E("span", { style: { width: 8, height: 8, borderRadius: "50%", background: "#ff7a68", boxShadow: "0 0 10px #ff7a68", animation: "swBreath 1.8s ease-in-out infinite", flex: "none" } });

const lines = (parts: Array<string | undefined | false>): ReactNode => {
  const shown = parts.filter((part): part is string => !!part && !!part.trim());
  if (!shown.length) return null;
  return shown.length === 1 ? shown[0] : shown.map((part, index) => E("div", { key: index }, part));
};

/**
 * Night (4D): the V2 Night strip. Dusk, tonight's steps and Dawn along one carousel, with Previous, Next and
 * Begin Day under the card. All Night behaviour comes from useNightEngine (the guided Night logic, unchanged);
 * this hook only shapes it into the keys the generated view reads.
 */
export function useNightVm(ctx: V6Ctx): SliceResult {
  const { game, layout } = ctx;
  const information = useRef<NightInformationHandle>(null);
  const engine = useNightEngine(ctx, information);
  const live = useRef(engine);
  live.current = engine;

  // ←/→ move along the strip while its card is open and no text field has the keys.
  useEffect(() => {
    if (!engine.visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input,textarea,select,[contenteditable=""],[contenteditable="true"],[role="dialog"],[role="textbox"]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      if (event.key === "ArrowRight") live.current.next(); else live.current.prev();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [engine.visible]);

  if (game.phase !== "night") return EMPTY;
  const advance = { text: "Begin Day", run: engine.beginDay };
  if (!engine.active) return { vm: { prevStep: engine.prev, nextStep: engine.next, beginDay: engine.beginDay }, advance };

  const { pos, steps, current } = engine;
  const total = steps.length + 2;
  const index = pos.kind === "dusk" ? 0 : pos.kind === "dawn" ? steps.length + 1 : engine.currentIndex + 1;

  const items = [
    stripItem({ label: "Dusk", img: "", marker: true, markerIcon: MARKER_ICON.dusk, done: false, index: 0, cursor: index, jump: () => engine.gotoCheckpoint("dusk") }),
    ...steps.map((step, i) => {
      const img = stepIcon(step, ctx.registry);
      return stripItem({ label: stepLabel(step), img, marker: !img, markerIcon: MARKER_ICON.step, done: stepResolved(game, step), index: i + 1, cursor: index, jump: () => engine.navigate(step) });
    }),
    stripItem({ label: "Dawn", img: "", marker: true, markerIcon: MARKER_ICON.dawn, done: false, index: steps.length + 1, cursor: index, jump: () => engine.gotoCheckpoint("dawn") }),
  ];
  const dawn = pos.kind === "dawn";

  let cur: Record<string, unknown>;
  if (current) {
    const { picker, correction, success, direct, canTarget, resolved, inlineInformation, successorChoice } = engine;
    const targetName = correction?.target ? game.players[correction.target.playerId]?.name || "The chosen player" : "";
    const player = current.kind === "player";
    const verb = player
      ? successorChoice ? "Choose the Minion who becomes the new Imp."
        : engine.manual || inlineInformation ? engine.role?.ability ?? current.prompt
        : engine.ability?.kind === "guided" ? engine.ability.descriptor.presentation.action : current.prompt
      : current.prompt;
    // PO review A03/C07: an impaired player is named by the pill beside the name, and the routine procedure lines
    // (manual prompt, impairment, death check) are not repeated in amber. Rarer Storyteller checks still show.
    const seat = player ? game.players[current.playerId] : undefined;
    const drunk = player && !!seat && (current.isDeceived && current.actualRoleId === "drunk" || hasEffect(seat, "drunk"));
    const poisoned = !!seat && !drunk && (hasEffect(seat, "poisoned") || seat.behaviorMode === "poisoned");
    const note = lines([
      player && current.isDeceived && !drunk ? `Follow the shown character’s procedure. This player is actually the ${current.actualRoleName}.` : undefined,
      quietAdvisory(current.advisory),
    ]);
    const waiting = canTarget && !resolved && !!picker && picker.owner === engine.owner || !!successorChoice;
    const celebrated = success?.key === current.stepKey && success.game === game;
    let result = "", resultHint = "";
    if (!inlineInformation) {
      if (direct && resolved) {
        result = targetName ? `${targetName} chosen.` : celebrated ? "Resolved." : "Completed";
        resultHint = canTarget ? "Tap another player to change." : correction?.message ?? "This action cannot be safely retargeted here. Open the player’s settings to correct its result.";
      } else if (celebrated) {
        result = "Resolved.";
        resultHint = steps.slice(engine.currentIndex + 1).some((step) => !stepResolved(game, step)) ? "Continuing…" : "";
      } else if (resolved) result = "Completed";
    }
    cur = {
      isRole: true, isMarker: false,
      role: stepLabel(current), who: stepWho(current, game),
      // PO review C09/C10: the Minion and Demon information steps carry only their title and the show row.
      verb: current.stepKey === "minionInfo" || current.stepKey === "demonInfo" ? "" : verb,
      impOn: drunk || poisoned, impLabel: drunk ? "Drunk" : "Poisoned",
      waiting, waitText: successorChoice ? "Choose the new Imp on the board" : "Tap a player on the board", picks: [],
      hasNumber: false, numberOpts: [], hasToken: false,
      hasResult: !!result, result, resultHint,
      hasNote: !!note, note,
      showOn: false,
    };
  } else if (pos.kind === "dusk") {
    cur = { isRole: false, isMarker: true, title: "Dusk", text: duskText(game.day) };
  } else {
    cur = { isRole: false, isMarker: true, isDawn: true, title: "Dawn", text: dawnText(game) };
  }

  const custom = renderNightCustom(engine, ctx, information);
  return {
    advance,
    vm: {
      actingName: current?.kind === "player" ? current.effectiveRoleName : null,
      prevStep: engine.prev, nextStep: engine.next, beginDay: engine.beginDay,
      night: {
        kicker: `Night ${game.day}`, breath: BREATH,
        dayButton: `Begin Day ${game.day}`,
        cur, hasCustom: !!custom, custom,
      },
      strip: {
        on: ctx.cards.strip && !ctx.ended, items,
        x: -(index * 68 + 28),
        w: Math.round(Math.max(340, Math.min(540, 2 * (layout.rx - layout.S / 2 - 70)))),
        pos: `${index + 1} / ${total}`,
        dayBorder: dawn ? "#f2c46a" : "rgba(242,196,106,.3)", dayBg: dawn ? "rgba(242,196,106,.16)" : "transparent",
      },
    },
  };
}


const ROUTINE = [/Impaired: simulate[^.]*\./g, /Check the ability's death\/event condition tonight; historical triggers are not tracked\./g];
/** The step's advisory without the routine sentences the card already conveys. */
function quietAdvisory(advisory: string | undefined): string | undefined {
  if (!advisory) return undefined;
  const rest = ROUTINE.reduce((text, pattern) => text.replace(pattern, ""), advisory).replace(/\s+/g, " ").trim();
  return rest || undefined;
}
