import { createElement as E, useMemo, type ReactNode } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { formatCode } from "@/firebase/lobby";
import { buildPlayerJoinLink, qrModules } from "@/features/newgame/qr";
import { endGameEligibility } from "@/stores/endGameEligibility";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { iconUrlFor } from "@/data/iconUrl";
import type { V6Ctx } from "../ctx";
import { ICON } from "../icons";
import { roman } from "../ringLayout";
import { crescentArt, moonBackdrop, useCrescentMemory } from "../boardArt";
import { flash, type AskState, type V6UiState } from "../v6Store";
import { useUndo } from "./undo";
import type { SliceResult } from "./types";

const EXTRA_COLOR = { fabled: "#e0c070", loric: "#7fc4b4" } as const;

/** The hint shown on the End control when the rules already settle the game. */
function endHint(ctx: V6Ctx): string {
  const { game, script, registry } = ctx;
  if (!script || game.phase === "setup" || game.phase === "ended") return "";
  const e = endGameEligibility(game, { registry, script });
  if (e.kind !== "verified") return "";
  const side = e.team === "good" ? "Good wins" : "Evil wins";
  if (e.reason === "demonDeath") return "The Demon is dead. Good wins";
  if (e.reason === "twoAlive") return "Only two players live. Evil wins";
  if (e.reason === "saint") return `The Saint was executed. ${side}`;
  return `The Mayor’s condition is met. ${side}`;
}

function joinInvitation(ctx: V6Ctx) {
  const lobby = useStorytellerStore.getState().lobby;
  if (!lobby) return null;
  const link = buildPlayerJoinLink(window.location, lobby.code);
  const formatted = formatCode(lobby.code);
  const [head = "", tail = ""] = formatted.includes("-") ? formatted.split("-") : [formatted, ""];
  return { lobby, link, head, tail, ctx };
}

export function useChromeVm(ctx: V6Ctx, slices: { advance?: SliceResult["advance"]; pill?: SliceResult["pill"]; acting: string | null; center: { kicker: string; title: string; sub: string } | null }): Record<string, unknown> {
  const { game, script, ui, layout, positions, privacy, ended, isNight, setupPhase } = ctx;
  const crescent = useCrescentMemory();
  const undo = useUndo(ctx);
  const lobby = useStorytellerStore((s) => s.lobby);
  const selectedId = useStorytellerStore((s) => s.selectedPlayerId);
  const selectPlayer = useStorytellerStore((s) => s.selectPlayer);
  const togglePrivacy = usePrivacyStore((s) => s.toggle);

  const seated = Object.values(game.players).filter((p) => !p.isEmpty);
  const alive = seated.filter((p) => p.alive).length;
  const votes = seated.filter((p) => p.alive || p.ghostVote).length;
  const day = game.day;
  const endedLabel = game.result ? `${winnerLabel(game)} wins` : "Game ended";
  const phaseLabel = setupPhase ? "Setup" : ended ? endedLabel : `${isNight ? "Night" : "Day"} ${day}`;
  const chapter = setupPhase ? "Setup" : ended ? endedLabel : `${isNight ? "Night" : "Day"} ${roman(day)}`;

  const extras = useMemo(() => {
    const ids = [...game.fabled.map((id) => ["fabled", id] as const), ...(game.lorics ?? []).map((id) => ["loric", id] as const)];
    return ids.flatMap(([kind, id]) => {
      const def = (kind === "fabled" ? FABLED : LORICS).find((r) => r.id === id) ?? ctx.registry.get(id);
      return def ? [{ name: def.name, icon: iconUrlFor(def), color: EXTRA_COLOR[kind] }] : [];
    });
  }, [game.fabled, game.lorics, ctx.registry]);

  const openPanel = (k: "players" | "night" | "info" | "reference") => () => {
    const locked = (k === "night" && (privacy || ended)) || ((k === "info" || k === "reference") && privacy);
    if (locked) { flash(k === "night" && ended ? "The game has ended." : "Show tokens to open this panel."); return; }
    ui.set({ panel: ui.panel === k ? null : k });
    selectPlayer(null);
  };
  const rail = ([["players", "Players", ICON.users], ["night", isNight || setupPhase ? "Night" : "Day", isNight || setupPhase ? ICON.moon : ICON.sun], ["info", "Info", ICON.info], ["reference", "Reference", ICON.book]] as const).map(([k, label, icon]) => {
    const locked = (k === "night" && (privacy || ended)) || ((k === "info" || k === "reference") && privacy);
    const active = ui.panel === k;
    return { label, icon, active, bg: active ? "rgba(176,186,204,.12)" : "transparent", color: active ? "#e8584a" : "rgba(222,216,204,.6)", onClick: openPanel(k), opacity: locked ? 0.38 : 1 };
  });

  // Where the ring's pointer star aims: the acting seat, else the selected one.
  const aim = selectedId && positions[selectedId] ? positions[selectedId]! : null;
  const dr = Math.min(layout.rx, layout.ry) * 0.72;
  const ring = {
    left: layout.cx - layout.rx, top: layout.cy - layout.ry, w: layout.rx * 2, h: layout.ry * 2, cx: layout.cx, cy: layout.cy,
    innerLeft: layout.cx - layout.rx * 0.62, innerTop: layout.cy - layout.ry * 0.62, innerW: layout.rx * 1.24, innerH: layout.ry * 1.24,
    tx: layout.cx, ty: layout.cy, fs: Math.round(dr * 0.115),
    art: crescentArt({ layout, night: isNight, target: aim, memory: crescent }),
  };

  const emblem = script?.characters.find((role) => role.type === "demon");
  const scriptEmblemUrl = emblem ? iconUrlFor(emblem) : "";
  const hint = endHint(ctx);
  const invitation = lobby && !ended ? joinInvitation(ctx) : null;
  const qr: ReactNode = useMemo(() => {
    if (!invitation) return null;
    const modules = qrModules(invitation.link);
    const n = modules.length;
    let d = "";
    modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x} ${y}h1v1h-1z`; }));
    return E("svg", { viewBox: `-1 -1 ${n + 2} ${n + 2}`, style: { width: 196, height: 196, display: "block" }, role: "img", "aria-label": "Join code", shapeRendering: "crispEdges" }, E("path", { d, fill: "#1c1216" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitation?.link]);

  const veil = ui.veil ? E("div", { key: ui.veil.key, style: { position: "absolute", inset: 0, zIndex: 90, pointerEvents: "none", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: ui.veil.day ? "radial-gradient(ellipse 90% 70% at 50% 110%, rgba(242,180,96,.42), rgba(26,16,10,.86) 55%, rgba(8,6,5,.94))" : "radial-gradient(ellipse 90% 70% at 50% -10%, rgba(110,130,200,.38), rgba(8,10,20,.88) 55%, rgba(3,4,8,.95))", animation: "swVeil 2.1s ease-in-out forwards" } },
    E("div", { style: { fontFamily: "'Cinzel Decorative', serif", fontSize: 13, fontWeight: 700, letterSpacing: ".5em", textTransform: "uppercase", color: "rgba(236,230,218,.72)" } }, ui.veil.sub),
    E("div", { style: { fontFamily: "'IM Fell English', serif", fontSize: 96, lineHeight: 1, color: ui.veil.day ? "#fbe6bd" : "#eef2fa", textShadow: "0 6px 40px rgba(0,0,0,.8)", animation: "swVeilText 2.1s cubic-bezier(.2,.7,.2,1) forwards" } }, ui.veil.label),
    E("div", { style: { width: 120, height: 1.5, background: "linear-gradient(90deg, transparent, #c0392e, transparent)" } })) : null;

  const adv = slices.advance;
  const pill = {
    showActing: isNight && !privacy && ui.panel !== "night" && !!slices.acting,
    actingText: slices.acting ? `${slices.acting} is awake` : "",
    isDay: game.phase === "day",
    advance: adv?.run, advanceText: adv?.text ?? "",
    ...slices.pill,
  };

  const center = slices.center;
  const cardShown = ctx.cards.strip || ctx.cards.town || ctx.cards.any;
  const quiet = cardShown || !!ctx.voting?.open;
  const centerKicker = quiet ? "" : center?.kicker ?? (setupPhase ? "Setup" : isNight ? `Night ${day}` : `Day ${day}`);
  const centerTitle = quiet ? "" : center?.title ?? "Silverwick Hollow";
  const centerSub = quiet ? "" : center?.sub ?? (isNight ? "The town sleeps" : ended ? (game.result ? `${winnerLabel(game)} has won` : "The story is complete") : setupPhase ? "The town gathers" : "The town wakes");

  return {
    boardRef: ctx.boardRef,
    themeClock: false, themeCandle: false, themeMoon: true, themeRitual: false, themeAlt: false,
    moonBg: moonBackdrop(isNight),
    nightOpacity: isNight ? 1 : 0, dayOpacity: isNight ? 0 : 1,
    ring, centerKicker, centerTitle, centerSub,
    chromeDisp: "flex",
    scriptName: script?.name ?? "Grimoire",
    scriptEmblem: scriptEmblemUrl,
    extrasLine: extras.length ? extras.map((x) => x.name).join(" · ") : "No Fabled or Loric",
    phaseLabel, chapter, chapterColor: isNight ? "#dfe5f2" : "#f2c46a",
    headerMeta: `${seated.length} players · ${alive} alive · ${votes} votes`,
    toggleHidden: togglePrivacy, hideLabel: privacy ? "Show tokens" : "Hide tokens", hideColor: privacy ? "#e0b96a" : "rgba(216,201,164,.55)",
    boardExtras: extras, hasBoardExtras: extras.length > 0,
    inviteDisp: invitation ? "flex" : "none",
    askDlg: askVm(ui),
    openQr: () => ui.set({ qrOpen: true }), closeQr: () => ui.set({ qrOpen: false }), stop: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    qr: ui.qrOpen && !!invitation, qrSvg: qr,
    code: invitation ? { head: invitation.head, tail: invitation.tail, aria: `Game code ${invitation.head}${invitation.tail}`, headChars: invitation.head.split(""), tailChars: invitation.tail.split(""), host: window.location.host } : undefined,
    copyCode: () => {
      if (!invitation) return;
      navigator.clipboard.writeText(invitation.link).then(() => flash("Invite link copied."), () => flash("Copy failed. Select the code instead."));
    },
    dockOn: true, dockL: rail.slice(0, 2), dockR: rail.slice(2), pill,
    openNight: () => ui.set({ panel: "night" }),
    phaseIconPath: isNight ? ICON.moon : ICON.sun, phaseIconColor: isNight ? "#e6ecf8" : "#f2c46a",
    undo: undo.run, undoOff: undo.disabled, undoTitle: undo.title, undoOpacity: undo.disabled ? 0.3 : 1,
    ended, endedText: `${endedLabel}. Finished game, read-only review.`,
    endOn: !ended && !privacy && (game.phase === "day" || game.phase === "night"), openEnd: () => ui.set({ endOpen: true }),
    winHint: !!hint, endTitle: hint ? `End game · ${hint}` : "End game", endColor: hint ? "#ff8a78" : "rgba(222,216,204,.45)",
    swapping: !!ui.swapFrom, swapName: ui.swapFrom ? game.players[ui.swapFrom]?.name ?? "" : "",
    clearSelection: () => { selectPlayer(null); ui.set({ swapFrom: null, card: false }); },
    veil,
    toast: { on: !!ui.toast, text: ui.toast ?? "" },
    closePanel: () => ui.set({ panel: null }),
  };
}

function winnerLabel(game: V6Ctx["game"]): string {
  const w = game.result?.winner;
  return w === "good" ? "Good" : w === "evil" ? "Evil" : "No result";
}

/** The ask dialog the Grimoire shows instead of window.confirm / window.prompt. Same panel language as the End dialog. */
function askVm(ui: { ask: AskState | null; set: (patch: Partial<V6UiState>) => void }) {
  const a = ui.ask;
  const close = () => ui.set({ ask: null });
  const ok = () => {
    if (!a) return;
    const value = a.input ? a.input.value.trim() : "";
    if (a.input && !value) return;
    ui.set({ ask: null });
    a.run(value);
  };
  return {
    open: !!a, title: a?.title ?? "", body: a?.body ?? "", okText: a?.okText ?? "OK",
    hasInput: !!a?.input, value: a?.input?.value ?? "", placeholder: a?.input?.placeholder ?? "", maxLength: a?.input?.maxLength ?? 20,
    onInput: (e: { target: { value: string } }) => { if (a?.input) ui.set({ ask: { ...a, input: { ...a.input, value: e.target.value } } }); },
    onKey: (e: { key: string; preventDefault: () => void }) => { if (e.key === "Enter") { e.preventDefault(); ok(); } else if (e.key === "Escape") close(); },
    ok, close, danger: !!a?.danger, okDisabled: !!a?.input && !a.input.value.trim(),
  };
}
