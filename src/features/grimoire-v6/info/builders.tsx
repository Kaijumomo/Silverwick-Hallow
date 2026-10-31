import { createElement as E } from "react";
import { iconUrlFor } from "@/data/iconUrl";
import { isCanonicalRole } from "@/data/canonical";
import { resolvedCharacters } from "@/data/roleRegistry";
import { wikiUrlFor } from "@/features/almanac/wikiUrl";
import { reminderLabels } from "@/features/home/reference/referenceData";
import { infoContextCurrent } from "@/features/info/infoCommands";
import { seatedPlayers } from "@/features/info/infoModel";
import type { PresentationPayload } from "@/features/info/PlayerPresentation";
import type { RoleDef, STPlayerRecord } from "@/stores/types";
import type { V6Ctx } from "../ctx";
import { ICON, TEAM_COLOR, TEAM_LABEL } from "../icons";
import { reminderArc, remFs } from "./reminderArc";
import type { ActiveShow } from "./showStore";
import { SETUP_LABEL, TEXT_STYLE } from "./tokens";

const seatName = (p: STPlayerRecord) => p.name || `Seat ${p.seat + 1}`;

// ── Show: the full-screen player view ─────────────────────────────────────────

const STALE_PAYLOAD: PresentationPayload = { kind: "setup", groups: [{ heading: "Information changed", names: ["Return to review the current information."] }] };

const GLOW = E("div", { key: "glow", style: { position: "absolute", left: "50%", top: "46%", width: 900, height: 700, marginLeft: -450, marginTop: -350, borderRadius: "50%", pointerEvents: "none", background: "radial-gradient(closest-side, rgba(242,190,110,.16), rgba(200,120,60,.07) 50%, transparent 100%)", animation: "swFlicker 5s ease-in-out infinite" } });

export function buildShowVm(current: ActiveShow | null, close: () => void): Record<string, unknown> {
  if (!current) return { open: false };
  const stale = !infoContextCurrent(current.context);
  const payload = stale ? STALE_PAYLOAD : current.payload;
  const base = { open: true, glow: GLOW, close, img: "", name: "", type: "", typeColor: "#ddd6c8", ability: "", icon: "", ink: "#3a2616", ring: "rgba(120,85,40,.45)", titleColor: "#e8c77a", halo: "rgba(232,170,90,.18)", cols: [] as unknown[] };
  if (payload.kind === "character") {
    const c = payload.character;
    return { ...base, title: payload.heading, aria: payload.heading, isChar: true, isText: false, isSetup: false, img: c.icon, name: c.name, type: TEAM_LABEL[c.type] ?? c.type, typeColor: TEAM_COLOR[c.type] ?? "#ddd6c8", ability: c.ability ?? "" };
  }
  if (payload.kind === "message") {
    const style = TEXT_STYLE[payload.symbol]!;
    return { ...base, title: payload.heading, aria: payload.heading, isChar: false, isText: true, isSetup: false, icon: ICON_OF[payload.symbol], ...style };
  }
  const label = !stale && current.setup ? SETUP_LABEL[current.setup] : "Information changed";
  const cols = payload.groups.map((group, i) => {
    const players = (group.names ?? []).map((name) => ({ name }));
    const chars = (group.characters ?? []).map((c) => ({ name: c.name, img: c.icon }));
    return {
      title: group.heading, players, chars, hasPlayers: players.length > 0, hasChars: chars.length > 0, isEmpty: !players.length && !chars.length, emptyText: "None",
      divider: i ? "1px solid rgba(176,186,204,.4)" : "none", dividerImg: i ? "linear-gradient(180deg, transparent, rgba(232,88,74,.5), transparent) 1" : "none",
    };
  });
  return { ...base, title: label, aria: label, isChar: false, isText: false, isSetup: true, cols };
}

const ICON_OF = { vote: ICON.vote, nominate: ICON.nominate, good: ICON.good, evil: ICON.evil } as const;

// ── Demon bluffs ──────────────────────────────────────────────────────────────

export function buildBluffSlots(opts: { bluffs: readonly string[]; get: (id: string) => RoleDef | undefined; open: (slot: number) => void }) {
  return [0, 1, 2].map((slot) => {
    const role = opts.get(opts.bluffs[slot] ?? "");
    return {
      filled: !!role, empty: !role, name: role?.name ?? "Add bluff", img: role ? iconUrlFor(role) : "",
      color: role ? TEAM_COLOR[role.type] ?? "#ddd6c8" : "rgba(222,216,204,.55)",
      aria: role ? `Demon bluff ${slot + 1}: ${role.name}. Tap to change` : `Add Demon bluff ${slot + 1}`,
      open: () => opts.open(slot),
    };
  });
}

// ── Reference ─────────────────────────────────────────────────────────────────

const REF_TYPES = ["townsfolk", "outsider", "minion", "demon", "traveler"] as const;
const REF_PLURAL: Record<string, string> = { townsfolk: "Townsfolk", outsider: "Outsiders", minion: "Minions", demon: "Demons", traveler: "Travelers" };

export function buildRefVm(ctx: V6Ctx, setSel: (id: string) => void): { vm: Record<string, unknown>; empty: boolean } {
  const { game, script, ui } = ctx;
  const query = ui.refQuery.trim().toLowerCase();
  const holders = new Map<string, string[]>();
  for (const p of seatedPlayers(game)) {
    if (p.actualRole) holders.set(p.actualRole, [...(holders.get(p.actualRole) ?? []), seatName(p)]);
    if (p.actualRole === "drunk" && p.shownRole && p.shownRole !== "drunk") holders.set(p.shownRole, [...(holders.get(p.shownRole) ?? []), `${seatName(p)} (Drunk)`]);
  }
  const roles = resolvedCharacters(script);
  const groups = REF_TYPES.map((type) => ({
    type, roles: roles.filter((r) => r.type === type && (!query || r.name.toLowerCase().includes(query) || (r.ability ?? "").toLowerCase().includes(query))),
  })).filter((g) => g.roles.length > 0);
  const all = groups.flatMap((g) => g.roles);
  const sel = all.find((r) => r.id === ui.refSel) ?? all[0];
  let selV: Record<string, unknown> = {};
  if (sel) {
    const who = holders.get(sel.id) ?? [];
    selV = {
      id: sel.id, name: sel.name, ability: sel.ability ?? "", img: iconUrlFor(sel), color: TEAM_COLOR[sel.type] ?? "#ddd6c8", type: TEAM_LABEL[sel.type] ?? sel.type,
      // Only the genuine canonical character has a wiki page; a homebrew one must not link to someone else's.
      wiki: isCanonicalRole(sel) ? wikiUrlFor(sel.name) : "", hasWiki: isCanonicalRole(sel),
      playText: who.length ? `In play · ${who.join(", ")}` : "Not in play", playColor: who.length ? "#ff8a78" : "rgba(222,216,204,.45)",
      hasRems: reminderLabels(sel).length > 0,
      rems: reminderLabels(sel).map((label, i) => ({ label, fs: remFs(label), arc: reminderArc(`swRA-${sel.id}-${i}`, label), size: 100, src: iconUrlFor(sel) })),
    };
  }
  return {
    empty: groups.length === 0,
    vm: {
      on: true, script: script?.name ?? "", count: all.length, has: !!sel, sel: selV,
      groups: groups.map((g) => ({
        label: REF_PLURAL[g.type], color: TEAM_COLOR[g.type], count: g.roles.length, note: "",
        tiles: g.roles.map((r) => {
          const on = !!sel && r.id === sel.id;
          return {
            name: r.name, ability: r.ability ?? "", img: iconUrlFor(r), inPlay: holders.has(r.id), on, pick: () => setSel(r.id),
            bg: on ? "rgba(232,88,74,.08)" : "transparent", ring: on ? "#e8584a" : "transparent", glow: on ? "0 0 16px rgba(232,88,74,.55)" : "none", nameColor: on ? "#f2ece0" : "rgba(222,216,204,.78)",
          };
        }),
      })),
    },
  };
}

// ── Victory scene ─────────────────────────────────────────────────────────────

const GOOD_SCENE = {
  base: "#0d1016",
  light: "radial-gradient(ellipse 80% 60% at 50% 105%, rgba(236,190,110,.42) 0%, rgba(160,110,60,.16) 40%, transparent 70%), radial-gradient(ellipse 90% 70% at 50% 0%, rgba(70,110,150,.35), transparent 70%), linear-gradient(180deg, #121a26 0%, #1a1a22 60%, #2a1c14 100%)",
  rays: "repeating-conic-gradient(from 0deg at 50% 50%, rgba(240,210,150,.10) 0deg 4deg, transparent 4deg 15deg)", line: "rgba(196,170,120,.3)",
  ring: "rgba(224,200,140,.8)", halo: "rgba(240,200,120,.28)", titleColor: "#f3dfa6", orn: "rgba(240,210,150,.85)", kickColor: "rgba(214,226,236,.75)", tokFilter: "grayscale(.5) brightness(.85)",
};
const EVIL_SCENE = {
  base: "#0a0405",
  light: "radial-gradient(ellipse 70% 55% at 50% 42%, rgba(150,24,20,.5) 0%, rgba(80,10,14,.3) 40%, transparent 72%), radial-gradient(ellipse 60% 40% at 15% 100%, rgba(90,40,120,.3), transparent 70%), radial-gradient(ellipse 60% 40% at 85% 0%, rgba(90,40,120,.22), transparent 70%), linear-gradient(180deg, #120607, #070304)",
  rays: "radial-gradient(closest-side, rgba(200,40,30,.35), transparent 70%)", line: "rgba(170,60,50,.35)",
  ring: "rgba(200,70,55,.85)", halo: "rgba(200,40,30,.4)", titleColor: "#f0b4a4", orn: "rgba(220,110,90,.85)", kickColor: "rgba(240,170,160,.72)", tokFilter: "none",
};

/** The victory scene. A game ended without a result has no scene: it opens straight on the review. */
export function buildWinVm(ctx: V6Ctx, close: () => void, home: () => void): Record<string, unknown> {
  const { game, registry, ui, ended, privacy } = ctx;
  const winner = game.result?.winner;
  if (!ui.winScene || !ended || privacy || (winner !== "good" && winner !== "evil")) return { open: false };
  const players = seatedPlayers(game);
  const demon = players.find((p) => registry.get(p.actualRole)?.type === "demon");
  const demonRole = demon ? registry.get(demon.actualRole) : undefined;
  const slain = winner === "good" && !!demon && !demon.alive;
  const walks = winner === "evil" && !!demon && demon.alive;
  const team = players.filter((p) => p.actualAlignment === winner).map((p) => {
    const role = registry.get(p.actualRole);
    return { name: seatName(p), img: role ? iconUrlFor(role) : "", op: p.alive ? 1 : 0.55 };
  });
  const common = { open: true, img: demonRole ? iconUrlFor(demonRole) : "", team, close, home };
  if (winner === "good") {
    return { ...common, ...GOOD_SCENE, title: "Good Wins", kicker: `Day ${game.day} · Dawn over Silverwick Hollow`, slain,
      line1: `${slain ? `The ${demonRole?.name ?? "Demon"} has been found and slain. ` : ""}The town of Silverwick Hollow will see another dawn.` };
  }
  return { ...common, ...EVIL_SCENE, title: "Evil Wins", kicker: `Night ${game.day} · The last candle gutters`, slain: false,
    line1: `${walks ? `The ${demonRole?.name ?? "Demon"} walks free and the town has fallen. ` : ""}Silverwick Hollow belongs to the dark.` };
}
