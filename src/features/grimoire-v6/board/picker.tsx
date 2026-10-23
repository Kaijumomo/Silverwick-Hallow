import type { ReactNode } from "react";
import { iconUrlFor } from "@/data/iconUrl";
import { TRAVELERS } from "@/data/travelers";
import type { RoleRegistry } from "@/data/roleRegistry";
import { captureCharacterActionContext, selectScriptById, useStorytellerStore } from "@/stores/storytellerStore";
import { changeRoleIntent, ordinaryRoleChoices } from "@/stores/roleResolution";
import { isPostDeal, selectSetupContext } from "@/features/setup/setupContext";
import { analyzeSetup } from "@/features/setup/setupAnalyzer";
import { canRefineSetup } from "@/features/setup/setupRefinement";
import { randomSetup } from "@/features/setup/randomSetup";
import { isInitialRevealComplete } from "@/stores/identity";
import type { PlayerId, RoleDef, RoleId, RoleType, Script, StorytellerLobbyRecord } from "@/stores/types";
import { TEAM_COLOR, TEAM_LABEL } from "../icons";
import { flash, useV6Ui, type PickerState, type V6UiActions, type V6UiState } from "../v6Store";
import { remArc, remFs } from "./remArc";
import { bluffHolderId, bluffsOf } from "./bluffs";

type Ui = V6UiState & V6UiActions;
export type PickerEnv = { game: StorytellerLobbyRecord; script: Script | undefined; registry: RoleRegistry; ui: Ui };

const TYPES = ["townsfolk", "outsider", "minion", "demon"] as const;
const GRAY = "grayscale(.8) brightness(.5)";
const USED = "grayscale(.7) brightness(.55)";

/** Opens the Distribute Roles picker with the bag the Storyteller would deal now. */
export function openDistributePicker() {
  const state = useStorytellerStore.getState();
  const { game, selectPlayer } = state;
  if (!game) return;
  const ui = useV6Ui.getState();
  const script = selectScriptById(state, game.scriptId);
  const context = selectSetupContext(game, script);
  ui.set({ picker: { mode: "distribute" }, pickSel: isPostDeal(game) ? [...context.assigned] : [...game.rolePool], pickHover: null, card: false });
  selectPlayer(null);
}

/** Opens the character chooser for one seat (not available once the game has ended). */
export function openChoosePicker(playerId: PlayerId) {
  if (useStorytellerStore.getState().game?.phase === "ended") return;
  useV6Ui.getState().set({ picker: { mode: "choose", playerId }, pickHover: null });
}

/** The shape `pk` takes while no picker is open. */
export const NO_PICKER = { open: false };

const roleTypeLabel = (type: RoleType) => TEAM_LABEL[type] ?? type;

function tileFor(role: RoleDef, o: { filter?: string; ring?: string; glow?: string; nameColor?: string; tag?: string; tagKind?: "bluff" | "mine" | "plain"; pressed: boolean; locked?: boolean; aria: string; click: () => void; hover: () => void }) {
  const kind = o.tagKind ?? "plain";
  return {
    name: role.name, img: iconUrlFor(role), filter: o.filter ?? "none", ring: o.ring ?? "transparent", glow: o.glow ?? "none", nameColor: o.nameColor ?? "#ece6da",
    hasTag: !!o.tag, tag: o.tag ?? "", tagColor: kind === "bluff" ? "#f4b88e" : kind === "mine" ? "#ffb4a6" : "#ddd6c8",
    tagBorder: kind === "bluff" ? "rgba(227,137,76,.65)" : kind === "mine" ? "rgba(232,88,74,.6)" : "rgba(176,186,204,.3)",
    pressed: o.pressed, opacity: o.locked ? 0.4 : 1, cursor: o.locked ? "not-allowed" : "pointer", aria: o.aria, click: o.click, hover: o.hover,
  };
}

/** Who holds each character right now (actual roles of the seated players). */
function holdersOf(game: StorytellerLobbyRecord): Record<RoleId, string[]> {
  const out: Record<RoleId, string[]> = {};
  for (const id of game.seatOrder) {
    const p = game.players[id];
    if (p && !p.isEmpty && p.actualRole) (out[p.actualRole] ??= []).push(p.name || `Seat ${p.seat + 1}`);
  }
  return out;
}

export function buildPicker(env: PickerEnv): Record<string, unknown> {
  const { game, script, registry, ui } = env;
  const picker = ui.picker;
  if (!picker || !script) return NO_PICKER;
  const mode = picker.mode;
  const store = () => useStorytellerStore.getState();
  const set = ui.set;
  const close = () => set({ picker: null });
  const player = picker.mode === "choose" || picker.mode === "drunk" ? game.players[picker.playerId] : undefined;
  if ((picker.mode === "choose" || picker.mode === "drunk") && (!player || player.isEmpty)) return NO_PICKER;

  const ordinary = ordinaryRoleChoices(script);
  const roles: RoleDef[] = mode === "choose" && player?.isTraveler ? [...TRAVELERS] : ordinary;
  const context = selectSetupContext(game, script);
  const holders = holdersOf(game);
  const heldBy = (id: RoleId) => holders[id] ?? [];
  const bluffHolder = bluffHolderId(game, registry);
  const bluffs = bluffsOf(game, bluffHolder);
  const dist = mode === "distribute";
  const draft = ui.pickSel;
  const draftContext = dist ? selectSetupContext({ ...game, rolePool: draft }, script) : null;
  const draftAnalysis = draftContext ? analyzeSetup(draftContext) : null;
  const single = draftAnalysis?.pool.candidates?.length === 1 ? draftAnalysis.pool.candidates[0]! : null;
  const residents = context.population.targetNonTravelerCount ?? context.ordinary.length;
  const privateSetup = game.phase === "setup" && !isInitialRevealComplete(game);
  const slot = picker.mode === "bluff" ? picker.slot : -1;
  const shownChoices = ordinary.filter((r) => r.type === "townsfolk" && !context.occupied.some((p) => p.actualRole === r.id));

  const click = (role: RoleDef) => () => {
    set({ pickHover: role.id });
    pickTile(env, picker, role, { holders, shownChoices, bluffHolder, bluffs, context });
  };

  const group = (type: RoleType) => {
    const members = roles.filter((r) => r.type === type);
    const have = members.filter((r) => draft.includes(r.id)).length;
    const need = single ? ((single as Record<string, number>)[type] ?? 0) : 0;
    const tiles = members.map((role) => {
      const on = draft.includes(role.id);
      const holder = heldBy(role.id);
      const mine = mode === "choose" && player?.actualRole === role.id;
      const used = !dist && mode !== "show" && holder.length > 0 && !mine;
      let filter: string | undefined, ring: string | undefined, glow: string | undefined, nameColor: string | undefined, tag = "";
      let tagKind: "bluff" | "mine" | "plain" = "plain";
      if (dist) {
        if (on) { ring = TEAM_COLOR[type]; glow = `0 0 16px ${TEAM_COLOR[type]}66`; } else { filter = GRAY; nameColor = "rgba(222,216,204,.42)"; }
      } else if (mine) { ring = "#e8584a"; glow = "0 0 18px rgba(232,88,74,.5)"; tag = "Current"; tagKind = "mine"; }
      else if (used) { filter = USED; nameColor = "rgba(222,216,204,.48)"; tag = holder.join(", "); }
      else if (mode === "show" && holder.length) tag = holder.join(", ");
      const bi = bluffs.indexOf(role.id);
      if (bi >= 0 && !tag && !dist) {
        tag = mode === "bluff" && bi === slot ? "This slot" : "Bluff"; tagKind = "bluff";
        if (mode === "bluff") { ring = TEAM_COLOR.demon; glow = `0 0 16px ${TEAM_COLOR.demon}66`; }
      }
      const locked = (mode === "bluff" && type === "traveler") || (mode === "drunk" && !shownChoices.some((r) => r.id === role.id));
      return tileFor(role, {
        filter, ring, glow, nameColor, tag, tagKind, pressed: dist ? on : !!mine, locked,
        aria: `${role.name}${bi >= 0 ? ", Demon bluff" : ""}${dist ? (on ? ", selected" : "") : used ? `, in use by ${holder.join(", ")}` : mine ? ", current" : ""}`,
        click: click(role), hover: () => set({ pickHover: role.id }),
      });
    });
    return {
      label: type === "traveler" ? "Travelers" : type === "townsfolk" ? "Townsfolk" : type === "demon" ? "Demon" : `${roleTypeLabel(type)}s`,
      color: TEAM_COLOR[type], tiles,
      count: dist ? (single ? `${have} / ${need}` : `${have}`) : "",
      countColor: single && have === need ? TEAM_COLOR[type] : "#e7a35b",
      note: dist && type === "outsider" && draft.includes("baron") ? "Baron adds 2" : "",
    };
  };
  const G = Object.fromEntries([...TYPES, "traveler"].map((t) => [t, group(t as RoleType)])) as Record<string, ReturnType<typeof group>>;
  const present = (g: ReturnType<typeof group> | undefined) => (g && g.tiles.length ? [g] : []);
  const wide = typeof window === "undefined" || window.innerWidth >= 900;
  const rows = (mode === "drunk"
    ? [{ cols: "minmax(0,1fr)", groups: present(G.townsfolk) }]
    : [
      { cols: "minmax(0,1fr)", groups: present(G.townsfolk) },
      { cols: wide ? "minmax(0,4fr) minmax(0,4fr) minmax(0,1.3fr)" : "minmax(0,1fr)", groups: [...present(G.outsider), ...present(G.minion), ...present(G.demon)] },
      ...(dist ? [] : [{ cols: "minmax(0,1fr)", groups: present(G.traveler) }]),
    ]).filter((r) => r.groups.length);

  const detailId = ui.pickHover ?? (mode === "choose" ? player?.actualRole : undefined) ?? (mode === "bluff" ? bluffs[slot] : undefined) ?? draft[0] ?? roles[0]?.id;
  const detail = (detailId && (roles.find((r) => r.id === detailId) ?? registry.get(detailId))) || roles[0];
  const d = detail
    ? { name: detail.name, type: roleTypeLabel(detail.type), color: TEAM_COLOR[detail.type], ability: detail.ability ?? "No ability text provided.", img: iconUrlFor(detail),
      rems: (detail.reminders ?? []).map((label, i) => ({ label, fs: remFs(label), arc: remArc(label, `pk-${detail.id}-${i}`) as ReactNode, size: 100, src: iconUrlFor(detail) })), noRems: !(detail.reminders ?? []).length }
    : { name: "", type: "", color: "#ddd6c8", ability: "", img: "", rems: [], noRems: true };

  const ok = !!(privateSetup && draftAnalysis?.readiness.deal.ok);
  const firstFinding = draftAnalysis?.findings.find((f) => f.severity !== "info")?.message;
  const name = player ? player.name || `Seat ${player.seat + 1}` : "";
  const heading = {
    title: mode === "drunk" ? `Who does ${name || "the Drunk"} think they are?` : dist ? "Distribute Roles" : mode === "bluff" ? `Demon bluff ${slot + 1} of 3`
      : mode === "show" ? (picker as Extract<PickerState, { mode: "show" }>).title : `Choose a character for ${name}`,
    kicker: mode === "drunk" ? "The Drunk · choose a Townsfolk that is not in play" : mode === "bluff" ? "Choose a character that is not in play"
      : mode === "show" ? "Information token · choose a character to show"
      : dist ? `${script.name} · ${residents} residents${context.travelers.length ? ` · ${context.travelers.length} traveler${context.travelers.length === 1 ? "" : "s"}` : ""}`
      : `Seat ${player ? player.seat + 1 : ""} · ${player?.actualRole ? registry.get(player.actualRole)?.name ?? "Unassigned" : "Unassigned"}`,
  };

  return {
    open: true, isDist: dist, isChoose: mode === "choose", isShow: mode === "show", isBluff: mode === "bluff", rows,
    canClearBluff: mode === "bluff" && !!bluffs[slot], clearBluff: () => {
      if (!bluffHolder) return;
      store().setBluffs(bluffHolder, bluffs.filter((_, i) => i !== slot));
      close();
    },
    ...heading, d,
    status: `${draft.length} of ${residents} residents`,
    note: !ok ? (draft.length === residents && firstFinding ? firstFinding : "Select one role per seat to continue.") : "Matches the standard setup.",
    noteColor: !ok ? "rgba(222,216,204,.5)" : "#8fcf95",
    seatCount: `${context.ordinary.length} players`, blocked: !ok,
    goBorder: ok ? "#c0392e" : "rgba(176,186,204,.18)", goBg: ok ? "linear-gradient(180deg, rgba(176,186,204,.3), rgba(176,186,204,.12))" : "transparent",
    goFg: ok ? "#ffb4a6" : "rgba(222,216,204,.35)", goCursor: ok ? "pointer" : "not-allowed",
    go: () => {
      if (!ok) { flash(firstFinding ?? "Select one role per seat to continue."); return; }
      const result = store().dealRolePool(draft, captureCharacterActionContext());
      if (!result.ok) { flash(result.message ?? "Review setup before continuing."); return; }
      close();
      flash("Roles distributed privately. Review preparation before revealing.");
    },
    random: () => {
      const result = randomSetup({ scriptCharacters: script.characters, targetPlayerCount: context.population.targetNonTravelerCount, fabledIds: game.fabled, loricIds: game.lorics });
      if (result.ok) set({ pickSel: result.pool }); else flash(result.failure.message);
    },
    clear: () => set({ pickSel: [] }),
    close,
  };
}

type Pick = { holders: Record<RoleId, string[]>; shownChoices: RoleDef[]; bluffHolder: PlayerId | null; bluffs: RoleId[]; context: ReturnType<typeof selectSetupContext> };

/** A tile was chosen: every mode applies it through the command that already owns that change. */
function pickTile(env: PickerEnv, picker: PickerState, role: RoleDef, p: Pick) {
  const { game, ui, script } = env;
  const store = () => useStorytellerStore.getState();
  const close = () => ui.set({ picker: null });
  if (picker.mode === "distribute") {
    ui.set({ pickSel: ui.pickSel.includes(role.id) ? ui.pickSel.filter((x) => x !== role.id) : [...ui.pickSel, role.id] });
    return;
  }
  if (picker.mode === "show") { ui.set({ picker: null, show: { kind: "char", title: picker.title, roleId: role.id } }); return; }
  if (picker.mode === "bluff") {
    if (role.type === "traveler") { flash("Travelers cannot be Demon bluffs."); return; }
    const held = p.holders[role.id];
    if (held?.length) { flash(`${role.name} is in play (${held.join(", ")}). Bluffs must be out of play.`); return; }
    if (!p.bluffHolder) { flash("There is no Demon to give bluffs to."); return; }
    // Slots are the positions of the stored list: choosing a character already in another slot swaps the two.
    const next: Array<RoleId | undefined> = [...p.bluffs];
    const j = next.indexOf(role.id);
    if (j >= 0 && j !== picker.slot) next[j] = next[picker.slot];
    next[Math.min(picker.slot, next.length)] = role.id;
    store().setBluffs(p.bluffHolder, next.filter((id): id is RoleId => !!id).slice(0, 3));
    close();
    return;
  }
  const player = game.players[picker.playerId];
  if (!player || player.isEmpty) { close(); return; }
  if (picker.mode === "drunk") {
    const current = store();
    if (!canRefineSetup(game).ok || player.actualRole !== "drunk" || !p.shownChoices.some((r) => r.id === role.id)) {
      const held = p.holders[role.id];
      flash(held?.length ? `${role.name} is in play (${held.join(", ")}). The Drunk must think they are a Townsfolk not in play.` : "Setup changed. Close this chooser and select the Drunk again.");
      return;
    }
    const result = current.setShownRole(player.id, role.id);
    if (!result.ok) { flash(result.message ?? "Review setup before continuing."); return; }
    close();
    flash(`${player.name} will be shown the ${role.name} token.`);
    return;
  }
  // choose
  if (role.id === player.actualRole) { close(); return; }
  const current = store();
  const name = player.name || `Seat ${player.seat + 1}`;
  let result: { ok: boolean; message?: string };
  let note = `${name} is now the ${role.name}.`;
  if (!player.isTraveler && canRefineSetup(game).ok) {
    const holders = p.context.ordinary.filter((q) => q.id !== player.id && q.actualRole === role.id);
    if (holders.length > 1) { flash("More than one player has this character. Choose a swap partner first."); return; }
    result = holders.length ? current.swapSetupRoles(player.id, holders[0]!.id) : current.replaceSetupRole(player.id, role.id);
    if (holders.length) note = `${name} and ${holders[0]!.name || "the other player"} swapped characters.`;
  } else {
    if (!player.isTraveler && game.phase === "setup") { flash("Deal roles before changing an assignment; revealed setup is locked until Night 1."); return; }
    result = current.resolveRoles({ intents: [changeRoleIntent(player, role.id)] });
  }
  if (!result.ok) { flash(result.message ?? "Review setup before continuing."); return; }
  close();
  flash(note);
  void script;
}
