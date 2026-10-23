import { create } from "zustand";
import { isInitialRevealComplete } from "@/stores/identity";
import { gameLifecycleToken, useStorytellerStore } from "@/stores/storytellerStore";
import { MIN_PLAYERS } from "@/data/setupCounts";
import { closeMultiplayerSession, useSessionRuntime } from "@/firebase/storytellerSync";
import { useGoLiveState } from "@/firebase/goLive";
import { lifecycleMessage } from "@/firebase/lifecycle";
import { createLiveGame, leaveLive, retryLive } from "@/features/newgame/setupFlowActions";
import { flash, useV6Ui, type WizardStep } from "../v6Store";
import { planExtras, TABLE_MAX, travellersOf, WIZARD_MAX, WIZARD_MIN, wizardScript } from "./draft";

/**
 * The New Game setup flow of the unified Grimoire, as plain actions over the real stores.
 *
 * Steps I and II (script, Fabled & Loric) are a draft held in the V6 UI store: nothing exists, and nothing touches
 * Firebase, until "Prepare the town". That step creates the pristine setup game exactly as the Ledger's Step III did
 * (confirming first when it would replace a game, closing the old lobby authoritatively). The lobby is created only
 * by choosing "Players join by code", and a lobby is always closed authoritatively before it is let go.
 */

/** Transient state of the lobby / import affordances. Session-local, never persisted. */
type Flow = {
  busy: boolean;
  /** `starting` while Go Live runs, `failed` when it could not attach a lobby. Idle otherwise. */
  lobby: "idle" | "starting" | "failed";
  notice: string | null;
  configOpen: boolean;
  importOpen: boolean;
  /** The gathering (names or arrivals) has ended: the town card moves on to seating, dealing and preparation. */
  gathered: boolean;
  /** The waiting queue (with Reject) is open. */
  queueOpen: boolean;
  set: (patch: Partial<Omit<Flow, "set">>) => void;
};
export const useSetupFlow = create<Flow>()((set) => ({ busy: false, lobby: "idle", notice: null, configOpen: false, importOpen: false, gathered: false, queueOpen: false, set: (patch) => set(patch) }));

const flow = () => useSetupFlow.getState();
const ui = () => useV6Ui.getState();
const store = () => useStorytellerStore.getState();

export const WIZARD_START = { step: "script" as WizardStep, script: null, customName: null, count: 10, extras: [] as string[], focus: null, xtab: "fabled" as const };

/** Home's "New game": the unified Grimoire opens on the wizard's first step. */
export function startWizard(): void {
  ui().set({ wiz: { ...WIZARD_START, extras: [] }, panel: null, picker: null, pickSel: [], card: false, seatMode: false, prepEdit: null, townCur: null, lobbyName: "", qrOpen: false, show: null });
  flow().set({ busy: false, lobby: "idle", notice: null, configOpen: false, importOpen: false, gathered: false, queueOpen: false });
  store().selectPlayer(null);
  store().setView("newgame");
}

/** Leaves the wizard for Home. A game the wizard created is kept until the Storyteller discards it. */
export function wizardHome(): void {
  ui().set({ wiz: null, panel: null, picker: null, seatMode: false, prepEdit: null });
  flow().set({ lobby: "idle", notice: null });
  store().setView("home");
}

export function setWizardCount(count: number): void {
  const wiz = ui().wiz;
  if (!wiz || wiz.step === "town") return;
  ui().set({ wiz: { ...wiz, count: Math.max(WIZARD_MIN, Math.min(WIZARD_MAX, count)) } });
}

/** The wizard step changes that need no game: forward from Script, and Back inside the draft. */
export function wizardTo(step: WizardStep): void {
  const wiz = ui().wiz;
  if (!wiz) return;
  if (step !== "script" && !wiz.script) return;
  ui().set({ wiz: { ...wiz, step } });
}

const somebodyMayBeHere = (): boolean => {
  const game = store().game;
  const runtime = useSessionRuntime.getState();
  return runtime.joined.length > 0 || Object.keys(game?.pendingPlayers ?? {}).length > 0 || (!!store().lobby && runtime.presence !== "ready");
};

/** "Prepare the town": creates the real setup game for the draft plan. */
export async function enterTown(): Promise<void> {
  const wiz = ui().wiz;
  if (!wiz || flow().busy) return;
  const script = wizardScript(wiz, store().customScripts);
  if (!script) { flash("Choose a script to continue."); return; }
  flow().set({ busy: true, notice: null });
  try {
    const outcome = await createLiveGame({ scriptId: script.id, total: wiz.count, travellers: travellersOf(wiz.count), extras: wiz.extras });
    if (outcome.kind === "cancelled") return;
    if (outcome.kind === "error") { flash(outcome.message); return; }
    const current = ui().wiz;
    if (!current) return;
    flow().set({ gathered: false });
    ui().set({ wiz: { ...current, step: "town" }, panel: "players", picker: null, seatMode: false, prepEdit: null, townCur: null, lobbyName: "" });
    store().setView("game");
  } finally {
    flow().set({ busy: false });
  }
}

/**
 * Back from "Prepare the town" to an earlier step. The pristine setup game is discarded (after its lobby, if any,
 * closed authoritatively); a game whose roles are revealed can no longer be left this way.
 */
export async function leaveTown(step: WizardStep): Promise<boolean> {
  const wiz = ui().wiz;
  const game = store().game;
  if (!wiz || flow().busy) return false;
  if (game) {
    if (game.phase !== "setup" || isInitialRevealComplete(game)) { flash("The roles are revealed. The town can no longer be changed here."); return false; }
    const named = game.seatOrder.some((id) => !game.players[id]?.isEmpty);
    const dealt = !!game.setupRolesDealt;
    if (store().lobby ? somebodyMayBeHere() : named || dealt) {
      const message = store().lobby
        ? "Go back? Everyone who has joined will be disconnected and the lobby will close."
        : "Go back? The seated names and any dealt roles will be cleared.";
      if (!window.confirm(message)) return false;
    }
    flow().set({ busy: true });
    try {
      const outcome = await leaveLive();
      if (outcome.kind === "stayed") { flash(outcome.message); return false; }
    } finally { flow().set({ busy: false }); }
  }
  flow().set({ lobby: "idle", notice: null, gathered: false });
  ui().set({ wiz: { ...wiz, step }, panel: null, picker: null, seatMode: false, prepEdit: null, townCur: null, lobbyName: "", card: false });
  return true;
}

/** Go Live for the setup game already open: the first attempt, a retry, or after saving the Firebase settings. */
export async function goOnline(): Promise<void> {
  if (store().lobby || !store().game) return;
  if (flow().lobby === "starting") return;
  flow().set({ lobby: "starting", notice: null, gathered: false });
  const mine = gameLifecycleToken();
  let outcome = await retryLive();
  if (outcome.kind === "busy") {
    await new Promise<void>((resolve) => {
      if (!useGoLiveState.getState().busy) return resolve();
      const unsubscribe = useGoLiveState.subscribe((state) => { if (!state.busy) { unsubscribe(); resolve(); } });
    });
    if (gameLifecycleToken() !== mine || !store().game || store().lobby) { flow().set({ lobby: "idle" }); return; }
    outcome = await retryLive();
  }
  if (gameLifecycleToken() !== mine) { flow().set({ lobby: "idle" }); return; }
  if (outcome.kind === "attached") { flow().set({ lobby: "idle" }); return; }
  if (outcome.kind === "needsConfig") flow().set({ lobby: "failed", configOpen: true });
  else if (outcome.kind === "failed") flow().set({ lobby: "failed", notice: outcome.error.message });
  else if (outcome.kind === "unavailable") flow().set({ lobby: "failed", notice: outcome.message });
  else flow().set({ lobby: "failed" });
}

/** "In person": the lobby closes authoritatively first; whoever was waiting for a seat is let go with it. */
export async function goInPerson(): Promise<void> {
  if (flow().busy) return;
  if (!store().lobby) { flow().set({ lobby: "idle", notice: null }); return; }
  if (somebodyMayBeHere() && !window.confirm("Switch to in person? Everyone who has joined will be disconnected and the lobby will close.")) return;
  flow().set({ busy: true });
  try {
    try { await closeMultiplayerSession(); }
    catch (error) { flash(useSessionRuntime.getState().errors.close ?? lifecycleMessage(error)); return; }
    for (const uid of Object.keys(store().game?.pendingPlayers ?? {})) store().removePendingPlayer(uid);
    flow().set({ lobby: "idle", notice: null, gathered: false });
  } finally { flow().set({ busy: false }); }
}

/** Whether the lobby may be let go of the gathering: five distinct players present and a live, current writer. */
export function gatheringGate(): { ok: boolean; present: number } {
  const runtime = useSessionRuntime.getState();
  const current = store();
  const now = Date.now();
  const present = new Set(runtime.joined.filter((player) => player.expiresAt > now).map((player) => player.uid)).size;
  const writer = runtime.backend;
  const ok = !!current.lobby && runtime.status === "live" && runtime.presence === "ready" && present >= MIN_PLAYERS &&
    !!writer && writer.code === current.lobby.code && writer.sessionId === current.lobby.sessionId && !writer.leaseMayHaveLapsed();
  return { ok, present };
}

export const emptySeatIds = (game: NonNullable<ReturnType<typeof store>["game"]>): string[] =>
  game.seatOrder.filter((id) => game.players[id]?.isEmpty);

/**
 * "Begin with N": the gathering ends. Seats nobody is waiting for are released (the plan shrinks with them, exactly
 * as removing an unused seat does), then the Storyteller seats the people who arrived.
 */
export function endGathering(): void {
  const gate = gatheringGate();
  if (!gate.ok) { flash(`At least ${MIN_PLAYERS} players must have joined and the lobby must be live.`); return; }
  trimUnusedSeats();
  flow().set({ gathered: true });
  const game = store().game;
  if (!game) return;
  const first = game.seatOrder.findIndex((id) => game.players[id]?.isEmpty);
  ui().set({ panel: "players", seatMode: true, seatCur: Math.max(0, first), card: false });
  store().selectPlayer(null);
}

/** Removes the empty seats nobody is waiting for. Waiting players keep exactly as many empty seats as there are of them. */
export function trimUnusedSeats(): void {
  const game = store().game;
  if (!game) return;
  let spare = emptySeatIds(game).length - Object.keys(game.pendingPlayers).length;
  for (const id of [...emptySeatIds(game)].reverse()) {
    if (spare <= 0) break;
    if (store().removePlayer(id)) spare--;
  }
}

export { TABLE_MAX, planExtras };
