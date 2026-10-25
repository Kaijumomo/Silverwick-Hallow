import { createElement as E, useMemo } from "react";
import { useStorytellerStore, captureCharacterActionContext } from "@/stores/storytellerStore";
import { SETUP_COUNTS, MIN_PLAYERS } from "@/data/setupCounts";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { iconUrlFor as iconOf } from "@/data/iconUrl";
import { qrModules, buildPlayerJoinLink } from "@/features/newgame/qr";
import { analyzeSetup } from "@/features/setup/setupAnalyzer";
import { selectSetupContext } from "@/features/setup/setupContext";
import { setupPresentation } from "@/features/setup/setupPresentation";
import { initialRevealReadiness } from "@/features/setup/revealReadiness";
import type { V6Ctx } from "../ctx";
import { roman } from "../ringLayout";
import { confirmAsk, flash, showVeil, useV6Ui } from "../v6Store";
import { isDraftGame } from "../setup/draft";
import { endGathering, goInPerson, goOnline, useSetupFlow } from "../setup/flow";
import { buildPrepTasks, commitPrep, orderedTasks, prepTap, type PrepTask } from "../setup/prepare";
import { useTokenTapInterceptor } from "../board/overlay";
import { openDistributePicker as openDistribute } from "../board/picker";
import { TEAM_COLOR } from "../icons";
import { beginOffline, changeSeatCount, emptySeats, nameNextSeat, seatInArrivalOrder, seatPersonAtCursor, waitingOf } from "../setup/seating";
import { wizardSteps, wizardVm } from "../setup/wizard";
import type { SliceResult } from "./types";

const GOLD = { b: "#c0392e", bg: "linear-gradient(180deg, rgba(176,186,204,.22), rgba(176,186,204,.08))", c: "#ffb4a6" };
const OFF = { b: "rgba(176,186,204,.14)", bg: "rgba(176,186,204,.04)", c: "rgba(222,216,204,.35)" };
const PLAIN = { b: "rgba(176,186,204,.3)", bg: "transparent", c: "#ddd6c8" };
const TEAM_ORDER = ["townsfolk", "outsider", "minion", "demon"] as const;
const TEAM_LABEL = ["Townsfolk", "Outsider", "Minions", "Demon"];

const store = () => useStorytellerStore.getState();

/** Roles revealed → Begin Night 1. Entering the Grimoire never starts the night by itself. */
function beginNightOne(ctx: V6Ctx, refusal: string) {
  const result = store().beginNightOne(captureCharacterActionContext());
  if (!result.ok) {
    flash(refusal);
    ctx.ui.set({ panel: "players" });
    return;
  }
  showVeil("Night I", "The first night falls", false);
  ctx.ui.set({ panel: "night", prepEdit: null, picker: null, seatMode: false, wiz: null });
}

/** Everything the New Game wizard, the Prepare the Town card and guided seating draw. */
export function useSetupVm(ctx: V6Ctx): SliceResult {
  const { game, script, registry, ui, layout } = ctx;
  const lobby = useStorytellerStore((s) => s.lobby);
  const joined = useSessionRuntime((s) => s.joined);
  const flow = useSetupFlow();
  // An open preparation (Red Herring, first-night information) takes the board tap as its choice.
  useTokenTapInterceptor("setup", ctx.game.phase === "setup" && ctx.ui.prepEdit ? prepTap : null);
  const draft = isDraftGame(game);
  const wiz = ui.wiz;
  const setupOn = game.phase === "setup";

  const context = useMemo(() => selectSetupContext(game, script), [game, script]);
  const analysis = useMemo(() => analyzeSetup(context), [context]);
  const view = setupPresentation(game, analysis, context);
  const { dealt, revealed } = view;
  const joinLink = lobby ? buildPlayerJoinLink(window.location, lobby.code) : null;
  const qrNode = useMemo(() => {
    if (!joinLink) return null;
    const modules = qrModules(joinLink);
    const n = modules.length;
    let d = "";
    modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x} ${y}h1v1h-1z`; }));
    return E("svg", { viewBox: `-1 -1 ${n + 2} ${n + 2}`, style: { width: 96, height: 96, display: "block" }, role: "img", "aria-label": "Join code", shapeRendering: "crispEdges" }, E("path", { d, fill: "#1c1216" }));
  }, [joinLink]);

  if (draft && wiz) {
    // Steps I and II: a draft table behind the wizard. No dock, no centre text, no invitation.
    return { vm: {
      wiz: wizardVm(ctx, wiz, true), wizSteps: wizardSteps(wiz), town: { on: false }, seatC: { on: false, btnOn: false }, pe: { on: false, off: true }, setup: { segs: [] },
      composition: [], rosterMeta: "",
      dockOn: false, centerKicker: "", centerTitle: "", centerSub: "", inviteDisp: "none",
      scriptName: wiz.script ? script?.name ?? "New game" : "New game",
    } };
  }
  if (!setupOn && !ctx.cards.town) return { vm: { wizSteps: [], wiz: { on: false }, pe: { on: false, off: true } } };

  const occupied = context.occupied.length;
  const waiting = waitingOf(game);
  const empties = emptySeats(game);
  const present = new Set(joined.filter((p) => p.expiresAt > Date.now()).map((p) => p.uid)).size;
  const lobbyish = !!lobby || flow.lobby !== "idle";
  const open = setupOn && !dealt && !revealed;
  const onlineGathering = open && lobbyish && !flow.gathered && occupied === 0;
  const offlineGathering = open && !lobbyish && !flow.gathered && (wiz?.step === "town" || occupied < MIN_PLAYERS);
  const gathering = onlineGathering || offlineGathering;
  const planned = game.seatOrder.length;
  const needSeating = open && !gathering && (waiting.length > 0 || empties.length > 0);

  // Tasks.
  const tasks = setupOn && dealt && !revealed && script ? orderedTasks(buildPrepTasks(game, script, registry, context, view.findings)) : [];
  const hasT = tasks.length > 0;
  let ci = ui.townCur != null && ui.townCur < tasks.length ? ui.townCur : tasks.findIndex((t) => !t.done);
  if (ci < 0) ci = 0;
  const cur: PrepTask | undefined = tasks[ci];
  const reqLeft = tasks.filter((t) => t.req && !t.done).length;
  const readiness = initialRevealReadiness(context);
  const locked = !readiness.ready || reqLeft > 0;
  const accent = (t: PrepTask) => TEAM_COLOR[(t.type === "townsfolk" || t.type === "outsider" || t.type === "minion" || t.type === "demon" ? t.type : "traveler")];
  const tone = (t: PrepTask) => (t.req && !t.done ? GOLD : PLAIN);

  const town = (() => {
    if (!ctx.cards.town) return { on: false };
    const base = SETUP_COUNTS[Math.min(15, Math.max(MIN_PLAYERS, context.population.targetNonTravelerCount ?? MIN_PLAYERS))];
    const travellerPlan = Math.max(0, game.plannedTravelerCount ?? 0);
    const mix = base ? `${base.townsfolk} Townsfolk · ${base.outsider} Outsider${base.outsider === 1 ? "" : "s"} · ${base.minion} Minion${base.minion === 1 ? "" : "s"} · 1 Demon${travellerPlan ? ` + ${travellerPlan} Traveller${travellerPlan === 1 ? "" : "s"}` : ""}` : "";
    const namedSeats = occupied;
    const nextEmpty = game.seatOrder.findIndex((id) => game.players[id]?.isEmpty);
    const failed = flow.lobby === "failed";
    const starting = flow.lobby === "starting";
    const lobbyTitle = starting ? "Opening the lobby…" : failed ? "The lobby is not open" : present > 0 ? "The town gathers" : "Waiting for the town";
    const gate = present >= MIN_PLAYERS;
    const joinedText = present === 1 ? "1 player has joined" : `${present} players have joined`;
    const needText = failed ? "Tap Players join by code to try again" : gate ? (present >= planned ? "Ready to begin" : `Begin now with ${present}, or wait for ${planned - present} more`) : `${MIN_PLAYERS - present} more to begin`;
    const idleText = waiting.length > 0 && setupOn
      ? `${waiting.length} ${waiting.length === 1 ? "player is" : "players are"} waiting for a seat. Assign seats before dealing roles.`
      : setupOn ? (revealed ? "Roles are revealed. Begin the first night when the town is ready."
        : dealt ? "Every character is prepared. Reveal roles when the town is seated."
          : "Everyone is seated. Deal roles to begin, or add more players.")
        : "Tap any seat on the board to see or change that player. Drag a token to move its seat.";
    const wizTown = !!wiz && setupOn;
    return {
      on: true, online: onlineGathering, offline: offlineGathering, lobby: gathering,
      onlineBg: lobbyish ? "rgba(192,57,46,.3)" : "transparent", offlineBg: lobbyish ? "transparent" : "rgba(192,57,46,.3)",
      setOnline: () => {
        if (flow.busy || lobby) return;
        void (async () => {
          if (occupied > 0 && !(await confirmAsk("Players join by code", "Switch to players joining by code? The names you wrote will be cleared.", "Switch", true))) return;
          const current = store().game;
          if (!current || store().lobby) return;
          for (const id of [...current.seatOrder]) if (!current.players[id]?.isEmpty) store().unseatPlayer(id);
          void goOnline();
        })();
      },
      setOffline: () => { void goInPerson(); },
      count: planned, inc: () => changeSeatCount(1), dec: () => changeSeatCount(-1), mix,
      name: ui.lobbyName, onName: (e: { target: { value: string } }) => ui.set({ lobbyName: e.target.value.replace(/[\r\n\t]/g, " ").slice(0, 20) }),
      onNameKey: (e: { key: string }) => { if (e.key === "Enter" && nameNextSeat(ui.lobbyName)) ui.set({ lobbyName: "" }); },
      addName: () => { if (nameNextSeat(ui.lobbyName)) ui.set({ lobbyName: "" }); },
      namePh: nextEmpty >= 0 ? `Name for seat ${roman(nextEmpty + 1)}` : "Add another player",
      namedText: `${namedSeats} of ${planned} seats named${nextEmpty >= 0 ? ". Unnamed seats keep a number." : "."}`,
      lobbyTitle, qr: gathering ? qrNode : null, joinedText, needText,
      joinSegs: Array.from({ length: Math.max(planned, present) }, (_, i) => ({ bg: i < present ? "#e8584a" : "rgba(176,186,204,.18)" })),
      revealOn: setupOn && !gathering && dealt && !revealed,
      // PO review A18: in person, Prepare the Town always carries Assign seats and Deal roles, as V2 does. Both keep the
      // Package 2 gate: under five named seats they say so instead of going ahead.
      distOn: setupOn && !revealed && (offlineGathering || !gathering && !needSeating),
      inviteOn: !!lobby && !onlineGathering && !ctx.ended, idleOn: !hasT && !gathering,
      stepOn: wizTown, w: Math.round(wizTown ? Math.min(layout.w - 40, Math.max(600, Math.min(740, 2 * (layout.rx - layout.S / 2)))) : Math.max(340, Math.min(540, 2 * (layout.rx - layout.S / 2 - 70)))),
      kicker: setupOn ? "Prepare the town" : "The town",
      setup: hasT && !gathering, multiT: tasks.length > 1, tPos: `${ci + 1} / ${tasks.length}`,
      tPrev: () => ui.set({ townCur: Math.max(0, ci - 1), prepEdit: null }), tNext: () => ui.set({ townCur: Math.min(tasks.length - 1, ci + 1), prepEdit: null }),
      cur: cur ? {
        role: cur.roleName, who: cur.who, color: accent(cur), sub: cur.sub, subColor: cur.done ? "rgba(207,230,210,.8)" : cur.req ? "#f4a595" : "rgba(222,216,204,.55)",
        open: !cur.done && cur.open, done: cur.done, act: cur.act, actLabel: cur.actLabel, btnBorder: tone(cur).b, btnBg: tone(cur).bg, btnColor: tone(cur).c,
        altOn: !!cur.altLabel && !cur.done, altLabel: cur.altLabel ?? "", alt: cur.alt, undo: cur.undo,
      } : {},
      idle: !hasT, distLabel: !dealt ? "Deal roles" : "Redistribute", compOn: !gathering, addOn: !gathering && !ctx.ended,
      idleText,
    };
  })();
  // Roster composition under the card header.
  const counts = analysis.assigned.actual;
  const composition = TEAM_ORDER.map((t, i) => ({ n: counts[t], label: TEAM_LABEL[i], color: TEAM_COLOR[t] }));
  const seated = context.occupied;
  const alive = seated.filter((p) => p.alive).length;
  const rosterMeta = `${context.ordinary.length} residents · ${context.travelers.length} traveler${context.travelers.length === 1 ? "" : "s"} · ${alive} alive`;

  // Guided seating.
  const seatCur = Math.min(ui.seatCur, Math.max(0, planned - 1));
  const here = game.players[game.seatOrder[seatCur] ?? ""];
  const seatedCount = seated.length;
  const left = empties.length;
  const canFinish = left === 0 || waiting.length === 0;
  const seatC = (() => {
    const base = {
      btnOn: setupOn && !dealt && !revealed && (offlineGathering || !gathering),
      btnBorder: needSeating ? "#c0392e" : "rgba(176,186,204,.26)", btnBg: needSeating ? "rgba(192,57,46,.22)" : "rgba(9,10,15,.5)", btnColor: needSeating ? "#ffb4a6" : "#ece6da",
      open: () => {
        // In person, leaving the name list fills unnamed seats with their numbers first (the dock's Begin the night does the same).
        if (offlineGathering && !beginOffline()) return;
        const g = store().game ?? game;
        ui.set({ panel: "players", seatMode: true, seatCur: Math.max(0, g.seatOrder.findIndex((id) => g.players[id]?.isEmpty)), card: false });
      },
    };
    if (!ui.seatMode || !setupOn || dealt) return { ...base, on: false };
    return {
      ...base, on: true, w: Math.round(Math.max(340, Math.min(560, 2 * (layout.rx - layout.S / 2 - 70)))),
      meta: `${seatedCount} of ${planned} seated`, seatR: `Seat ${roman(seatCur + 1)}`,
      occ: here && !here.isEmpty ? here.name : "Empty", occColor: here && !here.isEmpty ? "#f2ece0" : "rgba(222,216,204,.45)",
      people: [
        ...waiting.map((w) => ({ name: w.name, badge: "", hasBadge: false, pick: () => { void seatPersonAtCursor({ uid: w.uid }); }, border: "rgba(176,186,204,.32)", bg: "rgba(9,10,15,.6)", color: "#f2ece0" })),
        ...game.seatOrder.flatMap((id, j) => {
          const p = game.players[id];
          if (!p || p.isEmpty) return [];
          return [{ name: p.name, badge: roman(j + 1), hasBadge: true, pick: () => { void seatPersonAtCursor({ playerId: id }); }, border: j === seatCur ? "#e8584a" : "rgba(176,186,204,.16)", bg: "transparent", color: "rgba(222,216,204,.5)" }];
        }),
      ],
      prev: () => ui.set({ seatCur: (seatCur - 1 + planned) % planned }), next: () => ui.set({ seatCur: (seatCur + 1) % planned }),
      order: () => { if (waiting.length) void seatInArrivalOrder(); else flash("Seats follow the order names were written."); },
      clear: () => {
        if (lobby) { flash("Seated players stay seated. Tap a seat to change who sits there."); return; }
        void confirmAsk("Clear every seat", "Clear every seat? The names will be cleared.", "Clear seats", true).then((yes) => {
          const current = store().game;
          if (!yes || !current) return;
          for (const id of [...current.seatOrder]) store().unseatPlayer(id);
          useV6Ui.getState().set({ seatCur: 0 });
        });
      },
      finish: () => {
        if (left > 0 && waiting.length > 0) { flash(`${left} left to seat.`); return; }
        const release = () => {
          const current = store().game;
          if (!current) return;
          for (const id of [...emptySeats(current)].reverse()) store().removePlayer(id);
          useV6Ui.getState().set({ seatMode: false });
          flash("Seats assigned.");
        };
        if (left === 0) { release(); return; }
        void confirmAsk("Release empty seats", `Release ${left} empty seat${left === 1 ? "" : "s"}? The town will have ${planned - left} players.`, "Release").then((yes) => { if (yes) release(); });
      },
      close: () => ui.set({ seatMode: false }),
      doneOp: canFinish ? 1 : 0.4, doneCursor: canFinish ? "pointer" : "not-allowed",
      doneLabel: left === 0 ? "Confirm seats" : waiting.length === 0 ? `Release ${left} empty seat${left === 1 ? "" : "s"}` : `${left} left to seat`,
    };
  })();

  // Preparation of the town (tap-on-the-board edit).
  const edit = ui.prepEdit;
  const editTask = edit ? tasks.find((t) => t.key === edit.key) : undefined;
  const editOwner = edit?.key.startsWith("info:") ? game.players[edit.key.slice(5)] : undefined;
  const editRole = edit?.key === "redherring" ? "fortuneteller" : editOwner?.actualRole;
  const editDef = editRole ? registry.get(editRole) : undefined;
  const A = edit?.a ? game.players[edit.a] : undefined;
  const B = edit?.b ? game.players[edit.b] : undefined;
  const ft = edit?.key === "redherring";
  const okEdit = ft ? !!A : !!(A && B && edit?.token);
  const wanted = editRole === "washerwoman" ? "Townsfolk" : editRole === "librarian" ? "Outsider" : "Minion";
  const pe = edit && setupOn ? {
    on: true, off: false, role: editDef?.name ?? editTask?.roleName ?? "", img: edit.token ? (registry.get(edit.token) ? iconOf(registry.get(edit.token)!) : "") : editDef ? iconOf(editDef) : "",
    prompt: ft ? "Tap a good player on the circle" : (edit.slot ?? "a") === "a" ? `Tap the player who holds the ${wanted}` : "Tap the decoy",
    okOp: okEdit ? 1 : 0.45, confirm: commitPrep, cancel: () => ui.set({ prepEdit: null }),
  } : { on: false, off: true };

  const setupKey = setupOn && dealt && !revealed ? {
    count: `${tasks.filter((t) => t.done).length} of ${tasks.length} prepared`,
    segs: tasks.map((t) => ({ bg: t.done ? "#94c29a" : t.req ? "rgba(244,165,149,.6)" : "rgba(176,186,204,.18)" })),
    locked, revBorder: locked ? OFF.b : GOLD.b, revBg: locked ? OFF.bg : GOLD.bg, revColor: locked ? OFF.c : GOLD.c, revCursor: locked ? "default" : "pointer",
    reveal: () => {
      const result = store().revealRoles(captureCharacterActionContext());
      if (!result.ok) flash(result.message ?? "Setup changed. Review the next step before continuing.");
    },
    hint: reqLeft ? "Finish the required preparations to continue." : "Anything left unprepared is asked for tonight.",
    hintColor: reqLeft ? "#f4a595" : "rgba(222,216,204,.5)",
  } : { count: "", segs: [], locked: true, reveal: () => {}, hint: "", hintColor: "rgba(222,216,204,.5)", revBorder: OFF.b, revBg: OFF.bg, revColor: OFF.c, revCursor: "default" };

  // The dock's advance control while the game is in Setup.
  const advance = setupOn ? (() => {
    if (onlineGathering) {
      return { text: present >= planned ? "Begin the night" : `Begin with ${present}`, run: () => endGathering() };
    }
    if (offlineGathering) return { text: "Begin the night", run: () => { beginOffline(); } };
    if (needSeating) return { text: "Assign seats", run: () => seatC.open() };
    if (!dealt) return { text: "Deal roles", run: () => openDistribute() };
    if (!revealed) {
      return { text: "Reveal roles", run: () => {
        if (locked) { ui.set({ panel: "players" }); flash(reqLeft ? "Finish the required preparations first." : view.message); return; }
        setupKey.reveal();
      } };
    }
    return { text: "Begin Night 1", run: () => beginNightOne(ctx, analysis.readiness.begin.ok ? "Setup changed. Review the next step before continuing." : view.message) };
  })() : undefined;


  return {
    advance,
    vm: {
      wiz: wiz ? wizardVm(ctx, wiz, false) : { on: false },
      wizSteps: wiz && setupOn ? wizardSteps(wiz) : [],
      town, rosterMeta, composition, setup: setupKey, seatC, pe,
      distribute: () => { if (offlineGathering && !beginOffline()) return; openDistribute(); },
      ...(lobby && setupOn && !gathering && waiting.length ? { queueCount: waiting.length } : {}),
    },
  };
}
