import { createElement as E, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { iconUrlFor } from "@/data/iconUrl";
import { deriveAlignment } from "@/data/roleRegistry";
import { revokePlayerAndCommit, storytellerOccupancyCompletion } from "@/firebase/membershipCommands";
import { friendlyFirebaseError } from "@/firebase/errors";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { litActorIdOf } from "@/features/grimoire/seatTap";
import { createRulesQuery } from "@/stores/rulesQuery";
import { arrivalsAreTravelers, publicTravelerRole } from "@/stores/travelers";
import type { PlayerId, RoleDef, STPlayerRecord } from "@/stores/types";
import type { V6Ctx } from "../ctx";
import { ICON, TEAM_COLOR, TEAM_LABEL } from "../icons";
import { roman } from "../ringLayout";
import { flash, useV6Ui } from "../v6Store";
import { mergedDecoration, offerTokenTap, useTokenDecorations } from "../board/overlay";
import { remArc, remFs, tokenArc } from "../board/remArc";
import { placeReminder, playerMarks, reminderPalette, removeMark, type Mark, type MarkEnv } from "../board/marks";
import { runLifeAction } from "../board/life";
import { buildPicker, openChoosePicker } from "../board/picker";
import { useTokenDrag } from "../board/useTokenDrag";
import { EMPTY, type SliceResult } from "./types";

const RING_DEFAULT = "rgba(236,240,250,.85)";
const RING_SWAP = "rgba(159,195,232,.85)";
const RING_SEAT = "rgba(232,88,74,.95)";
const DIM = "grayscale(.8) brightness(.7)";
const NO_ROLE_RING = "rgba(120,90,50,.5)";
const POP_W = 316;

const RADIAL_ICON = {
  kill: "M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14zM9.5 12h.01M14.5 12h.01M10 20v-2M14 20v-2",
  revive: "M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 12 5 5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z",
  ghost: "M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2.5 3 2.5-3 2.5 3 2.5-3 3 3V10a8 8 0 0 0-8-8z",
  change: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  show: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  swap: "M7 16V4M3 8l4-4 4 4M17 8v12M21 16l-4 4-4-4",
  more: ICON.info,
} as const;

/** What a seat shows: the Shown Role is primary on the Storyteller's table; Privacy Mode keeps only a public Traveller. */
function displayRoleOf(p: STPlayerRecord, ctx: V6Ctx): RoleDef | undefined {
  if (ctx.privacy) return publicTravelerRole(p);
  const id = p.shownRole ?? p.actualRole;
  return id ? ctx.registry.get(id) : undefined;
}

function alignmentText(p: STPlayerRecord, role: RoleDef | undefined): "Good" | "Evil" {
  if (p.actualAlignment === "evil") return "Evil";
  if (p.actualAlignment === "good") return "Good";
  return role && deriveAlignment(role) === "evil" ? "Evil" : "Good";
}

/**
 * Slice 4B: the board. Seat tokens with their reminder discs, the radial menu, the compact Details
 * card (with More settings), the character picker and the open-seat affordances. Game truth stays in
 * the store: every action here submits the command that already owned it.
 */
export function useBoardVm(ctx: V6Ctx): SliceResult {
  const { game, script, registry, ui, layout, positions, privacy, ended, setupPhase, mutationLocked } = ctx;
  const store = useStorytellerStore;
  const selectedRaw = useStorytellerStore((s) => s.selectedPlayerId);
  const selectPlayer = useStorytellerStore((s) => s.selectPlayer);
  const decorations = useTokenDecorations((s) => s.bySource);
  const litActor = useShellStore((s) => s.litActor);
  const picking = useTargetPicker((s) => s.active);
  const [segDrag, setSegDrag] = useState<{ key: "life" | "list"; f: number } | null>(null);
  const segMoved = useRef(false);
  const armTimer = useRef<ReturnType<typeof setTimeout>>();

  const selectedId = selectedRaw && game.players[selectedRaw] && !game.players[selectedRaw]!.isEmpty ? selectedRaw : null;
  const seatIndex = (id: PlayerId) => game.seatOrder.indexOf(id);
  const wizPre = !!(ui.wiz && setupPhase && ui.wiz.step !== "town");
  const litActorId = litActorIdOf(game, privacy, litActor);
  const query = useMemo(() => (script ? createRulesQuery(game, { script, registry }) : null), [game, script, registry]);
  const env: MarkEnv = { game, script, registry, query };

  // Privacy Mode: nothing private stays open. The seats keep the geometry they had (ctx freezes it).
  useEffect(() => {
    if (!privacy) return;
    ui.set({ picker: null, popMode: "main", remAll: false, remArm: null, show: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privacy]);
  // A removal armed on one player never carries to another.
  useEffect(() => { ui.set({ remArm: null }); clearTimeout(armTimer.current); }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(armTimer.current), []);
  // Leaving a seat that no longer exists never leaves a card pointing at it.
  useEffect(() => {
    if (selectedRaw && !selectedId) selectPlayer(null);
  }, [selectedRaw, selectedId, selectPlayer]);

  // ── Taps ──────────────────────────────────────────────────────────────────
  const swapSeats = (fromId: PlayerId, toId: PlayerId) => {
    const s = store.getState();
    const current = s.game;
    const a = current?.players[fromId], b = current?.players[toId];
    ui.set({ swapFrom: null });
    selectPlayer(null);
    if (!current || privacy || current.phase === "ended" || !a || !b || a.isEmpty || b.isEmpty) { flash("The roster changed. Select the players again to swap seats."); return; }
    if (fromId === toId) return;
    // The rendered positions are the fallback for seats never dragged: stored relative to the board centre.
    const layoutPositions = Object.fromEntries(current.seatOrder.flatMap((id) => positions[id] ? [[id, { x: positions[id]!.x - layout.w / 2, y: positions[id]!.y - layout.h / 2 }]] : []));
    const result = s.swapPlayerSeats({ playerId: fromId, participantId: a.participantId! }, { playerId: toId, participantId: b.participantId! }, { game: current, positions: layoutPositions });
    flash(result.ok ? `${a.name || "A player"} and ${b.name || "a player"} swapped seats.` : result.message ?? "Those seats could not be swapped.");
  };

  const tap = (id: PlayerId) => {
    if (wizPre) return;
    if (offerTokenTap(id)) return;
    const current = store.getState().game;
    if (!current) return;
    if (ui.seatMode && setupPhase) { const i = seatIndex(id); if (i >= 0) ui.set({ seatCur: i }); return; }
    if (ctx.voting?.tap(id)) return;
    if (ui.swapFrom) {
      if (ui.swapFrom === id) ui.set({ swapFrom: null }); else swapSeats(ui.swapFrom, id);
      return;
    }
    if (pickSeatIfPicking(current, id)) return;
    if (id === litActorId) { ui.set({ panel: "night" }); return; }
    selectPlayer(selectedId === id ? null : id);
    ui.set({ popMode: "main", card: false });
  };

  const drag = useTokenDrag({ boardRef: ctx.boardRef, layout, positions, onTap: tap, enabled: !mutationLocked });
  const at = (id: PlayerId) => (drag.ghost?.id === id ? { x: drag.ghost.x, y: drag.ghost.y } : positions[id]);

  // ── Tokens ────────────────────────────────────────────────────────────────
  const { S, crowded, nameMax } = layout;
  const tokens = game.seatOrder.flatMap((id, i) => {
    const p = game.players[id];
    const pos = at(id);
    if (!p || p.isEmpty || !pos) return [];
    const base = layout.angles[i] !== undefined
      ? { x: layout.cx + layout.rx * Math.cos(layout.angles[i]!), y: layout.cy + layout.ry * Math.sin(layout.angles[i]!) }
      : pos;
    let ux = layout.cx - base.x, uy = layout.cy - base.y;
    const len = Math.hypot(ux, uy) || 1;
    ux /= len; uy /= len;

    const marks = privacy ? [] : playerMarks(env, p);
    const cap = crowded ? 1 : 3;
    const shown = marks.length > cap + 1 ? marks.slice(0, cap) : marks;
    const extra = marks.length - shown.length;
    const items = [
      ...shown.map((m) => ({ label: m.label, fs: remFs(m.label), arc: remArc(m.label, `${id}-${m.key}`), src: m.src, size: m.size, hasImg: !!m.src, more: false, moreText: "" })),
      ...(extra > 0 ? [{ label: "more", fs: 0, arc: null as ReactNode, src: "", size: 0, hasImg: false, more: true, moreText: `+${extra}` }] : []),
    ];
    const m = items.length;
    const baseA = Math.atan2(uy, ux);
    const Rr = S / 2 + 46;
    const stepA = (crowded ? 46 : 54) / Rr;
    const rems = items.map((r, j) => {
      const a2 = baseA + (j - (m - 1) / 2) * stepA;
      const rr = Rr + 22 * Math.max(0, Math.sin(a2)) + 12 * Math.max(0, -Math.sin(a2));
      return { ...r, x: Math.round(Math.cos(a2) * rr), y: Math.round(Math.sin(a2) * rr) };
    });

    const role = displayRoleOf(p, ctx);
    const deco = mergedDecoration(decorations, id);
    const selected = selectedId === id;
    const seatHere = ui.seatMode && setupPhase && i === ui.seatCur;
    const swapHere = ui.swapFrom === id;
    const ring = deco.ringOn || selected || swapHere || seatHere;
    const ringColor = deco.ringOn && deco.ringColor ? deco.ringColor : seatHere ? RING_SEAT : swapHere ? RING_SWAP : RING_DEFAULT;
    const unnamed = !p.name;
    const dimName = wizPre || unnamed;
    const dead = !p.alive;
    const acting = id === litActorId;
    const glow = deco.glow ?? (acting ? E("div", { key: "g", style: { position: "absolute", inset: -7, borderRadius: "50%", animation: "swGlow 2.6s ease-in-out infinite", pointerEvents: "none" } }) : null);
    const dragging = drag.ghost?.id === id;
    const markSummary = marks.length ? `, ${marks.length} reminder${marks.length === 1 ? "" : "s"}` : "";
    const aria = `Seat ${i + 1}, ${p.name || "empty name"}${role ? `, ${role.name}` : ""}${dead ? ", dead" : ""}${!privacy && p.abilityUsed ? ", ability used" : ""}${markSummary}`;
    return [{
      id, x: Math.round(pos.x), y: Math.round(pos.y), s: S, seat: i + 1, seatR: roman(i + 1),
      name: wizPre || unnamed ? `Seat ${roman(i + 1)}` : p.name,
      z: dragging ? 30 : selected ? 20 : 10,
      transition: dragging ? "none" : "left .5s cubic-bezier(.2,.7,.2,1), top .5s cubic-bezier(.2,.7,.2,1)",
      rems, img: role ? iconUrlFor(role) : "", showArt: !!role, arc: role ? tokenArc(role.name, id) : null,
      initial: role ? role.name[0] ?? "" : "", monoSize: Math.round(S * 0.36),
      typeColor: role ? TEAM_COLOR[role.type] ?? NO_ROLE_RING : NO_ROLE_RING,
      filter: deco.filter ?? (dead ? DIM : "none"),
      dead, ghost: dead && p.ghostVote,
      dsOriginal: false, dsInk: false, dsStrike: false, dsShatter: false, dsTorn: dead, dsBurnt: false, dsClawed: false, dsRipped: false, dsCorner: false,
      nameColor: dimName ? (wizPre ? "rgba(216,201,164,.4)" : "rgba(216,201,164,.45)") : p.alive ? "#eadcb8" : "rgba(216,201,164,.5)",
      cursor: deco.cursor ?? (picking ? "crosshair" : ctx.voting?.open ? "pointer" : "grab"),
      ringOn: ring, ringColor, glow,
      handOn: !!deco.handOn, tagOn: !!deco.tagOn, tagText: deco.tagText ?? "", tagColor: deco.tagColor ?? "#f4a595",
      onDown: (e: React.PointerEvent) => drag.onDown(id, e),
      nameMax, aria,
      onKey: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(id); } },
    }];
  });

  // ── Open seats ────────────────────────────────────────────────────────────
  const emptySeats = game.seatOrder.flatMap((id, i) => (game.players[id]?.isEmpty && positions[id] ? [{ i, pos: positions[id]! }] : []));
  const lobbySlots: Array<{ i: number; pos: { x: number; y: number } }> = [];
  if (setupPhase && store.getState().lobby && game.seatOrder.length < 5) {
    for (let i = game.seatOrder.length; i < 5; i++) {
      const a = layout.angles[i];
      if (a !== undefined) lobbySlots.push({ i, pos: { x: layout.cx + layout.rx * Math.cos(a), y: layout.cy + layout.ry * Math.sin(a) } });
    }
  }
  const openSeats = ended ? [] : [...emptySeats, ...lobbySlots].map(({ i, pos }, k) => ({
    x: Math.round(pos.x), y: Math.round(pos.y), s: S, m: -Math.round(S / 2), dl: k * 380, label: `Seat ${roman(i + 1)}`,
  }));

  const addPlayer = () => {
    if (ended || mutationLocked) return;
    const s = store.getState();
    if (s.lobby) { ui.set({ panel: "players", card: false }); selectPlayer(null); return; }
    const name = window.prompt(arrivalsAreTravelers(game) ? "Traveller name?" : "Player name?");
    if (!name?.trim()) return;
    const before = s.game;
    s.addPlayerToSeat(name);
    const after = store.getState().game;
    if (after === before) { flash("Could not add a player. Check available seats and game capacity."); return; }
    flash("A new seat joins the circle.");
  };
  const resetPositions = () => {
    const result = store.getState().resetTokenPositions();
    flash(result.ok ? "Token positions reset." : result.message ?? "Token positions could not be reset.");
  };

  // ── Radial menu ───────────────────────────────────────────────────────────
  const sel = selectedId ? game.players[selectedId]! : null;
  const selPos = sel ? at(sel.id) : undefined;
  const live = game.phase === "night" || game.phase === "day";
  const life = (action: Parameters<typeof runLifeAction>[2]) => () => {
    if (!sel) return;
    const message = runLifeAction(sel.id, sel.participantId, action);
    if (message) flash(message);
  };
  const showPlayer = () => {
    if (!sel) return;
    if (!sel.shownRole) { flash(`Choose ${sel.name || "this player"}'s shown character before showing their token.`); return; }
    ui.set({ show: { kind: "char", title: "You Are", roleId: sel.shownRole }, card: false });
    selectPlayer(null);
  };
  const startSwap = () => { if (!sel) return; ui.set({ swapFrom: sel.id, card: false }); selectPlayer(null); };

  let rad: Record<string, unknown> = { on: false };
  if (sel && selPos && !ui.card && !ui.swapFrom && !ctx.voting?.open && !(ui.slay && game.phase === "day") && !picking && !ui.picker && !wizPre) {
    const list: Array<{ label: string; icon: string; onClick: () => void; color: string; border: string }> = [];
    const plain = { color: "#ece6da", border: "rgba(176,186,204,.35)" };
    if (!ended && live) list.push(sel.alive
      ? { label: "Kill", icon: RADIAL_ICON.kill, onClick: life("die"), color: "#ff8a78", border: "rgba(232,88,74,.6)" }
      : { label: "Revive", icon: RADIAL_ICON.revive, onClick: life("revive"), color: "#8fcf95", border: "rgba(143,207,149,.55)" });
    if (!ended && live && !sel.alive) list.push({ label: sel.ghostVote ? "Spend vote" : "Give vote", icon: RADIAL_ICON.ghost, onClick: life(sel.ghostVote ? "spendVote" : "restoreVote"), color: "#e6ecf8", border: "rgba(230,236,248,.4)" });
    if (!ended && !privacy) list.push({ label: "Character", icon: RADIAL_ICON.change, onClick: () => openChoosePicker(sel.id), ...plain });
    if (!privacy && sel.shownRole) list.push({ label: "Show", icon: RADIAL_ICON.show, onClick: showPlayer, ...plain });
    if (!ended) list.push({ label: "Swap seat", icon: RADIAL_ICON.swap, onClick: startSwap, ...plain });
    list.push({ label: "Details", icon: RADIAL_ICON.more, onClick: () => ui.set({ card: true }), ...plain });
    const r = S / 2 + 46;
    const out = Math.atan2(selPos.y - layout.cy, selPos.x - layout.cx);
    const n = list.length;
    const items = list.map((b, i) => {
      const a = out + (i - (n - 1) / 2) * (2 * Math.PI / Math.max(n, 6));
      let bx = Math.cos(a) * r, by = Math.sin(a) * r;
      bx = Math.max(30 - selPos.x, Math.min(layout.w - 30 - selPos.x, bx));
      by = Math.max(30 - selPos.y, Math.min(layout.h - 40 - selPos.y, by));
      return { ...b, x: Math.round(bx), y: Math.round(by), delay: i * 35 };
    });
    rad = { on: true, x: Math.round(selPos.x), y: Math.round(selPos.y), items, ringD: Math.round(r * 2), ringL: -Math.round(r) };
  }

  // ── Details card ──────────────────────────────────────────────────────────
  let pop: Record<string, unknown> = { open: false };
  if (sel && selPos && ui.card) {
    const H = Math.min(660, layout.h - 32);
    const right = selPos.x < layout.w / 2;
    let left = right ? selPos.x + S / 2 + 20 : selPos.x - S / 2 - 20 - POP_W;
    left = Math.max(12, Math.min(layout.w - POP_W - 12, left));
    const top = Math.max(16, Math.min(layout.h - H - 16, Math.max(76, selPos.y - 130)));
    const role = sel.actualRole ? registry.get(sel.actualRole) : undefined;
    const marks = privacy ? [] : playerMarks(env, sel);
    const palette = reminderPalette(env);
    const addList = ui.remAll ? palette.all : palette.inPlay;
    const place = (entry: (typeof addList)[number]) => () => {
      const result = placeReminder(sel.id, sel.participantId, entry);
      if (!result.ok) flash(result.message);
    };
    const armed = (m: Mark) => ui.remArm === m.key;
    const removeTap = (m: Mark) => () => {
      clearTimeout(armTimer.current);
      if (!armed(m)) {
        ui.set({ remArm: m.key });
        armTimer.current = setTimeout(() => { if (useV6Ui.getState().remArm === m.key) ui.set({ remArm: null }); }, 3000);
        return;
      }
      ui.set({ remArm: null });
      const result = removeMark(sel.id, sel.participantId, m);
      if (!result.ok) flash(result.message);
    };
    const guard = (fn: () => void) => () => { if (segMoved.current) return; fn(); };
    const lifeEditable = live && !ended;
    const setAlive = guard(life("revive")), setDead = guard(life("die"));
    const toggleGhost = life(sel.ghostVote ? "spendVote" : "restoreVote");

    // A segmented control that can also be slid: dragging past the middle picks the other side.
    const segDown = (key: "life" | "list", pick: (v: number) => void) => (e: React.PointerEvent) => {
      if (e.button) return;
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x0 = e.clientX;
      let moved = false, f = 0;
      const frac = (x: number) => Math.max(0, Math.min(1, (x - box.left - box.width / 4) / (box.width / 2)));
      const mv = (ev: PointerEvent) => { if (!moved && Math.abs(ev.clientX - x0) < 5) return; moved = true; f = frac(ev.clientX); setSegDrag({ key, f }); };
      const up = () => {
        window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
        if (!moved) return;
        segMoved.current = true;
        setTimeout(() => { segMoved.current = false; }, 0);
        setSegDrag(null);
        segMoved.current = false;
        pick(f > 0.5 ? 1 : 0);
        segMoved.current = true;
      };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    };
    const slide = (key: "life" | "list", side: number) => ({
      [`${key}X`]: segDrag && segDrag.key === key ? segDrag.f * 100 : side * 100,
      [`${key}T`]: segDrag && segDrag.key === key ? "background .2s" : "transform .28s cubic-bezier(.2,.7,.2,1), background .2s",
    });

    const removeFromGame = async () => {
      const name = sel.name || `Seat ${seatIndex(sel.id) + 1}`;
      const text = sel.isTraveler ? `${name} leaves the game and their seat is removed.` : `${name} leaves the game and their seat is removed.`;
      if (!window.confirm(`Remove ${name}?\n\n${text}`)) return;
      const s = store.getState();
      const completion = storytellerOccupancyCompletion("remove", sel.id);
      try {
        if (s.lobby) {
          const backend = useSessionRuntime.getState().backend;
          if (!backend) throw new Error("Firebase is reconnecting. The player was not changed locally.");
          await revokePlayerAndCommit(backend, s.lobby.code, sel.id, completion);
        } else completion.commit();
        selectPlayer(null);
        ui.set({ card: false, popMode: "main" });
        flash(`${name} left the game.`);
      } catch (e) {
        const friendly = e instanceof Error && !("code" in e) ? { title: "", message: e.message } : friendlyFirebaseError(e, "st");
        flash(friendly.title ? `${friendly.title}: ${friendly.message}` : friendly.message);
      }
    };
    const toggleTraveler = () => {
      const result = store.getState().setIsTraveler(sel.id, !sel.isTraveler);
      if (!result.ok) flash(result.message ?? "Could not change Traveller status.");
    };

    const hasRole = !!role && !privacy;
    pop = {
      open: true, left: Math.round(left), top: Math.round(top), maxH: H,
      arrowTop: Math.max(18, Math.min(H - 30, selPos.y - top - 6)), arrowLeft: right ? -7 : POP_W - 6,
      name: sel.name || `Seat ${roman(seatIndex(sel.id) + 1)}`, seat: seatIndex(sel.id) + 1, traveler: sel.isTraveler,
      roleName: privacy ? "" : role?.name ?? "Unassigned",
      typeLabel: privacy ? "" : role ? TEAM_LABEL[role.type] ?? role.type : TEAM_LABEL.townsfolk,
      typeColor: privacy ? NO_ROLE_RING : TEAM_COLOR[role?.type ?? "townsfolk"],
      img: hasRole ? iconUrlFor(role!) : "",
      ability: privacy ? "" : role ? role.ability ?? "" : "No character yet. Choose one below or distribute roles.",
      dead: !sel.alive,
      aliveBg: sel.alive ? "rgba(176,186,204,.2)" : "transparent", aliveFg: sel.alive ? "#ffb4a6" : "rgba(222,216,204,.55)",
      deadBg: !sel.alive ? "rgba(232,138,122,.16)" : "transparent", deadFg: !sel.alive ? "#f0b0a4" : "rgba(222,216,204,.55)",
      ghostDot: sel.ghostVote ? "#e8dcc0" : "transparent",
      setAlive, setDead, toggleGhost,
      rems: marks.map((m) => {
        const isArmed = armed(m);
        return {
          label: m.label, fs: remFs(m.label), arc: remArc(m.label, `pop-${m.key}`), src: m.src, size: m.size,
          shown: isArmed ? "Tap to remove" : "", title: isArmed ? `Tap again to remove ${m.label}` : `Remove ${m.label}`,
          ring: isArmed ? "0 0 0 2px #e88a7a, 0 0 14px rgba(232,138,122,.45)" : "0 0 0 0 transparent", op: isArmed ? 0.75 : 1,
          xBg: isArmed ? "#b8443a" : "#14151d", xFg: isArmed ? "#fff1ec" : "#f0b0a4", labelColor: isArmed ? "#f0b0a4" : "#ece6da",
          remove: removeTap(m),
        };
      }),
      addRems: addList.map((entry) => ({
        label: entry.label, fs: remFs(entry.label), arc: remArc(entry.label, `add-${entry.role.id}-${entry.label}`), size: 100, src: iconUrlFor(entry.role),
        title: `${entry.role.name}: ${entry.label}`, add: place(entry),
      })),
      canAdd: !ended, remCount: marks.length || "", noRems: marks.length === 0, allCount: palette.all.length,
      showPlay: guard(() => ui.set({ remAll: false })), showAll: guard(() => ui.set({ remAll: true })),
      playBg: !ui.remAll ? "rgba(176,186,204,.2)" : "transparent", playFg: !ui.remAll ? "#ffb4a6" : "rgba(222,216,204,.55)",
      allBg: ui.remAll ? "rgba(176,186,204,.2)" : "transparent", allFg: ui.remAll ? "#ffb4a6" : "rgba(222,216,204,.55)",
      change: () => openChoosePicker(sel.id),
      showPlayer,
      showRole: !privacy, priv: privacy, editable: lifeEditable, actions: !ended && !privacy, readOnly: ended && !privacy, showRems: !privacy,
      statusText: privacy ? "" : `${sel.alive ? "Survived" : "Died"} · ${alignmentText(sel, role)} team`,
      modeMain: ui.popMode === "main", modeMore: ui.popMode === "more",
      toMore: () => ui.set({ popMode: "more" }), toMain: () => ui.set({ popMode: "main" }),
      swap: startSwap,
      toggleTraveler,
      travelerText: sel.isTraveler ? "Yes" : "No", travelerColor: sel.isTraveler ? "#b994d4" : "rgba(222,216,204,.6)",
      alignment: privacy ? "" : alignmentText(sel, role),
      remove: removeFromGame,
      ...slide("life", sel.alive ? 0 : 1), ...slide("list", ui.remAll ? 1 : 0),
      lifeDown: segDown("life", (v) => (v ? setDead() : setAlive())),
      listDown: segDown("list", (v) => ui.set({ remAll: !!v })),
      lifeThumb: sel.alive ? "rgba(176,186,204,.22)" : "rgba(150,50,45,.35)", listThumb: "rgba(176,186,204,.2)",
    };
  }

  const pk = useMemo(() => buildPicker({ game, script, registry, ui }), [game, script, registry, ui]);

  void EMPTY;
  return { vm: { tokens, openSeats, addPlayer, resetPositions, rad, pop, pk } };
}
