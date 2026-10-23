import { createElement as E, type ReactNode } from "react";
import { resolvedCharacters } from "@/data/roleRegistry";
import { TRAVELERS } from "@/data/travelers";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { activeJinxesFor } from "@/data/jinxes";
import { iconUrlFor } from "@/data/iconUrl";
import { SETUP_COUNTS, type BagCounts } from "@/data/setupCounts";
import { shownRoleFilter } from "@/stores/identity";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import { compositionCandidates, emptyCounts } from "@/features/setup/setupPolicies";
import { randomSetup } from "@/features/setup/randomSetup";
import { currentDealtBag } from "@/features/setup/setupRefinement";
import { isPostDeal, selectSetupContext } from "@/features/setup/setupContext";
import { isInitialRevealComplete } from "@/stores/identity";
import type { RoleDef, RoleId } from "@/stores/types";
import { reminderLabels } from "@/features/home/reference/referenceData";
import type { V6Ctx } from "../ctx";
import { flash, useV6Ui } from "../v6Store";

/**
 * The shared character-picker frame, for the two modes Setup owns: "distribute" (deal the bag) and "drunk" (the
 * character a concealed player is shown). The frame itself is the design's; the lead composes it with the other
 * modes (choose, show, bluff). Official art only: tokens use the character's own icon, reminders the same icon with
 * the reminder's text on its arc.
 */
export const TEAM_COLOR = { townsfolk: "#86b7d4", outsider: "#94c29a", minion: "#d97a6c", demon: "#e3894c", traveler: "#b994d4" } as const;
const TEAM_LABEL = { townsfolk: "Townsfolk", outsider: "Outsider", minion: "Minion", demon: "Demon", traveler: "Traveler" } as const;
const GROUP_LABEL = { townsfolk: "Townsfolk", outsider: "Outsiders", minion: "Minions", demon: "Demon", traveler: "Travelers" } as const;
type Team = keyof typeof TEAM_COLOR;
const TEAMS: Team[] = ["townsfolk", "outsider", "minion", "demon"];
const BAG: (keyof BagCounts)[] = ["townsfolk", "outsider", "minion", "demon"];

const remFs = (label: string) => Math.max(9, Math.min(15, Math.round(150 / Math.max(1, label.length))));
let arcSeq = 0;
/** A reminder's label set along the bottom arc of its token, the design's own rendering. */
export function reminderArc(label: string): ReactNode {
  const id = `swRA${arcSeq++}`;
  return E("svg", { viewBox: "0 0 100 100", "aria-hidden": true, style: { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" } },
    E("defs", null, E("path", { id, d: "M 12 52 A 38 38 0 0 0 88 52", fill: "none" })),
    E("text", { fontSize: remFs(label), fontWeight: 800, fill: "#2b1c0e", letterSpacing: 0.4, textAnchor: "middle", style: { textTransform: "uppercase", fontFamily: "inherit" } },
      E("textPath", { href: `#${id}`, startOffset: "50%" }, label)));
}

const ui = () => useV6Ui.getState();
const store = () => useStorytellerStore.getState();
const teamOf = (def: RoleDef): Team | null => (def.type === "townsfolk" || def.type === "outsider" || def.type === "minion" || def.type === "demon" || def.type === "traveler" ? def.type : null);
const sameBag = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/** Opens the deal (or, after it, the redistribution) with the roles currently in the bag selected. */
export function openDistribute(): void {
  const game = store().game;
  if (!game || game.phase !== "setup") return;
  if (isInitialRevealComplete(game)) { flash("The roles are revealed. They can no longer be distributed here."); return; }
  const context = selectSetupContext(game);
  const travellerRoles = context.travelers.map((p) => p.actualRole).filter(Boolean);
  const selection = isPostDeal(game) ? [...currentDealtBag(context), ...travellerRoles] : [...game.rolePool, ...travellerRoles];
  ui().set({ picker: { mode: "distribute" }, pickSel: selection, pickHover: null, card: false, panel: "players", prepEdit: null });
  store().selectPlayer(null);
}

/** The composition the selected characters ask for: the single candidate the analyzer allows, else the base table. */
function requiredCounts(resN: number, selected: RoleDef[], modifiers: RoleDef[]): BagCounts {
  const base = SETUP_COUNTS[resN];
  if (!base) return emptyCounts();
  const hasJinx = activeJinxesFor([...selected, ...modifiers].map((r) => r.id)).length > 0;
  const { candidates } = compositionCandidates(resN, selected, modifiers, hasJinx);
  return candidates && candidates.length === 1 ? candidates[0]! : base;
}

function pickRandomTravellers(count: number): RoleId[] {
  const ids = TRAVELERS.map((r) => r.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j]!, ids[i]!]; }
  return ids.slice(0, count);
}

/** Deals the selection: the residents through the existing randomized deal, the Travellers into their seats. */
function distributeNow(ctx: V6Ctx, resN: number, travN: number): void {
  const state = store();
  const game = state.game;
  if (!game) return;
  const sel = ui().pickSel;
  const defs = new Map(resolvedCharacters(ctx.script).map((r) => [r.id, r]));
  const residents = sel.filter((id) => defs.get(id)?.type !== "traveler");
  const travellers = sel.filter((id) => defs.get(id)?.type === "traveler");
  if (residents.length !== resN || travellers.length !== travN) {
    flash(`Select ${resN} resident${resN === 1 ? "" : "s"}${travN ? ` and ${travN} traveler${travN === 1 ? "" : "s"}` : ""} to distribute.`);
    return;
  }
  const action = captureCharacterActionContext();
  const context = selectSetupContext(game, ctx.script);
  const redeal = isPostDeal(game);
  const result = !redeal ? state.dealRolePool(residents, action)
    : sameBag(residents, context.assigned) ? state.shuffleSetupRoles() : state.applyEditedBag(residents);
  if (!result.ok) { flash(result.message ?? "Setup changed. Review the selection and try again."); return; }
  // Travellers keep their separate workflow: each takes one of the chosen characters, in seat order.
  const shuffledTravellers = [...travellers].sort(() => Math.random() - 0.5);
  const seats = selectSetupContext(store().game!, ctx.script).travelers;
  seats.forEach((seat, i) => {
    const role = shuffledTravellers[i];
    if (!role || seat.actualRole === role) return;
    const assigned = store().assignRole(seat.id, role);
    if (!assigned.ok) flash(assigned.message ?? "A Traveler's character could not be set.");
  });
  ui().set({ picker: null, pickSel: [], pickHover: null });
  flash(redeal ? "Roles redistributed." : `Roles distributed to ${resN + travN} players.`);
}

export function buildPickerFrame(ctx: V6Ctx): Record<string, unknown> | undefined {
  const picker = ctx.ui.picker;
  if (!picker || (picker.mode !== "distribute" && picker.mode !== "drunk")) return undefined;
  const { game, script } = ctx;
  const roles = resolvedCharacters(script);
  const byId = new Map(roles.map((r) => [r.id, r]));
  const context = selectSetupContext(game, script);
  const wide = typeof window === "undefined" ? true : window.innerWidth >= 900;
  const hover = ctx.ui.pickHover;

  const detailOf = (id: RoleId | null | undefined) => {
    const def = (id && byId.get(id)) || undefined;
    if (!def) return { name: "", type: "", color: "#ddd6c8", ability: "", img: "", rems: [], noRems: true };
    const team = teamOf(def) ?? "townsfolk";
    const rems = reminderLabels(def).map((label) => ({ label, fs: remFs(label), arc: reminderArc(label), size: 100, src: iconUrlFor(def) }));
    return { name: def.name, type: TEAM_LABEL[team], color: TEAM_COLOR[team], ability: def.ability ?? "", img: iconUrlFor(def), rems, noRems: rems.length === 0 };
  };

  if (picker.mode === "drunk") {
    const me = game.players[picker.playerId];
    const filter = shownRoleFilter(me?.behaviorMode ?? "drunk_fake_role_behavior") ?? ((r: RoleDef) => r.type === "townsfolk");
    const candidates = roles.filter((r) => r.type !== "traveler" && filter(r));
    const holder = (id: RoleId) => context.occupied.find((p) => p.id !== picker.playerId && (p.actualRole === id || p.shownRole === id));
    const type = (candidates[0]?.type ?? "townsfolk") as Team;
    const tiles = candidates.map((def) => {
      const used = holder(def.id);
      const mine = me?.shownRole === def.id;
      return {
        name: def.name, img: iconUrlFor(def), filter: used ? "grayscale(.7) brightness(.55)" : "none", ring: mine ? "#e8584a" : "transparent", glow: mine ? "0 0 18px rgba(232,88,74,.5)" : "none",
        nameColor: used ? "rgba(222,216,204,.48)" : "#ece6da", hasTag: !!used || mine, tag: used ? used.name : mine ? "Current" : "", tagColor: mine ? "#ffb4a6" : "#ddd6c8", tagBorder: mine ? "rgba(232,88,74,.6)" : "rgba(176,186,204,.3)",
        pressed: mine, opacity: 1, cursor: "pointer", aria: `${def.name}${used ? `, in use by ${used.name}` : mine ? ", current" : ""}`,
        click: () => {
          ui().set({ pickHover: def.id });
          if (used) { flash(`${def.name} is in play (${used.name}). Choose a character that is not in play.`); return; }
          const result = store().setShownRole(picker.playerId, def.id);
          if (!result.ok) { flash(result.message ?? "That character cannot be shown."); return; }
          ui().set({ picker: null, pickHover: null });
          flash(`${me?.name || "They"} will be shown the ${def.name} token.`);
        },
        hover: () => ui().set({ pickHover: def.id }),
      };
    });
    const actual = me?.actualRole ? byId.get(me.actualRole) : undefined;
    return {
      pk: {
        open: true, isDist: false, isChoose: false, isShow: false, isBluff: false, canClearBluff: false, clearBluff: () => {},
        title: `Who does ${me?.name || "the player"} think they are?`,
        kicker: `${actual?.name ?? "Concealed"} · choose a ${TEAM_LABEL[type]} that is not in play`,
        rows: [{ cols: "minmax(0,1fr)", groups: [{ label: GROUP_LABEL[type], color: TEAM_COLOR[type], tiles, count: "", countColor: TEAM_COLOR[type], note: "" }] }],
        d: detailOf(hover ?? me?.shownRole ?? candidates[0]?.id), close: () => ui().set({ picker: null }),
        status: "", note: "", noteColor: "rgba(222,216,204,.5)", seatCount: "", blocked: false,
        go: () => {}, goBorder: "rgba(176,186,204,.18)", goBg: "transparent", goFg: "rgba(222,216,204,.35)", goCursor: "not-allowed", random: () => {}, clear: () => {},
      },
    };
  }

  // Distribute.
  const sel = ctx.ui.pickSel;
  const resN = context.population.targetNonTravelerCount ?? context.ordinary.length;
  const travN = context.travelers.length;
  const selectedDefs = sel.map((id) => byId.get(id)).filter((r): r is RoleDef => !!r);
  const modifiers = [...game.fabled, ...game.lorics].map((id) => FABLED.find((r) => r.id === id) ?? LORICS.find((r) => r.id === id)).filter((r): r is RoleDef => !!r);
  const req = requiredCounts(resN, selectedDefs.filter((r) => r.type !== "traveler"), modifiers);
  const base = SETUP_COUNTS[resN];
  const group = (t: Team | "traveler") => {
    const members = roles.filter((r) => r.type === t);
    const have = members.filter((r) => sel.includes(r.id)).length;
    const need = t === "traveler" ? travN : req[t];
    const locked = t === "traveler" && travN === 0;
    const tiles = members.map((def) => {
      const on = sel.includes(def.id);
      return {
        name: def.name, img: iconUrlFor(def), filter: on ? "none" : "grayscale(.8) brightness(.5)", ring: on ? TEAM_COLOR[t] : "transparent", glow: on ? `0 0 16px ${TEAM_COLOR[t]}66` : "none",
        nameColor: on ? "#ece6da" : "rgba(222,216,204,.42)", hasTag: false, tag: "", tagColor: "#ddd6c8", tagBorder: "rgba(176,186,204,.3)",
        pressed: on, opacity: locked ? 0.4 : 1, cursor: locked ? "not-allowed" : "pointer", aria: `${def.name}${on ? ", selected" : ""}`,
        click: () => {
          ui().set({ pickHover: def.id });
          if (locked) { flash("Mark a player as a Traveler first."); return; }
          ui().set({ pickSel: on ? sel.filter((x) => x !== def.id) : [...sel, def.id] });
        },
        hover: () => ui().set({ pickHover: def.id }),
      };
    });
    const bag = t !== "traveler" ? req[t] : 0;
    const adjusted = t === "outsider" && !!base && bag !== base.outsider;
    return {
      label: GROUP_LABEL[t], color: TEAM_COLOR[t], tiles, count: `${have} / ${need}`, countColor: have === need ? TEAM_COLOR[t] : "#e7a35b",
      note: t === "traveler" ? (travN ? `${travN} traveler seat${travN === 1 ? "" : "s"}` : "No traveler seats. Mark a player as Traveler first.") : adjusted ? `${bag > (base?.outsider ?? 0) ? "Adds" : "Removes"} ${Math.abs(bag - (base?.outsider ?? 0))}` : "",
    };
  };
  const G = Object.fromEntries([...TEAMS, "traveler" as const].map((t) => [t, group(t)])) as Record<Team, ReturnType<typeof group>>;
  const resHave = selectedDefs.filter((r) => r.type !== "traveler").length;
  const travHave = selectedDefs.filter((r) => r.type === "traveler").length;
  const ok = resHave === resN && travHave === travN;
  const std = !!base && BAG.every((t) => selectedDefs.filter((r) => r.type === t).length === base[t]);
  const dk = hover ?? sel[0] ?? roles.find((r) => r.type === "townsfolk")?.id;
  const redeal = isPostDeal(game);
  return {
    pk: {
      open: true, isDist: true, isChoose: false, isShow: false, isBluff: false, canClearBluff: false, clearBluff: () => {},
      rows: [
        { cols: "minmax(0,1fr)", groups: [G.townsfolk] },
        { cols: wide ? "minmax(0,4fr) minmax(0,4fr) minmax(0,1.3fr)" : "minmax(0,1fr)", groups: [G.outsider, G.minion, G.demon] },
        { cols: "minmax(0,1fr)", groups: [G.traveler] },
      ],
      title: redeal ? "Redistribute Roles" : "Distribute Roles",
      kicker: `${ctx.script?.name ?? "Script"} · ${resN} residents${travN ? ` · ${travN} traveler${travN === 1 ? "" : "s"}` : ""}`,
      d: detailOf(dk),
      status: `${resHave} of ${resN} residents${travN ? ` · ${travHave} of ${travN} traveler${travN === 1 ? "" : "s"}` : ""}`,
      note: !ok ? "Select one role per seat to continue." : std ? "Matches the standard setup." : `Differs from the standard setup for ${resN}.`,
      noteColor: !ok ? "rgba(222,216,204,.5)" : std ? "#8fcf95" : "#e7a35b",
      seatCount: `${resN + travN} players`, blocked: !ok,
      goBorder: ok ? "#c0392e" : "rgba(176,186,204,.18)", goBg: ok ? "linear-gradient(180deg, rgba(176,186,204,.3), rgba(176,186,204,.12))" : "transparent",
      goFg: ok ? "#ffb4a6" : "rgba(222,216,204,.35)", goCursor: ok ? "pointer" : "not-allowed",
      go: () => distributeNow(ctx, resN, travN),
      random: () => {
        const result = randomSetup({ scriptCharacters: ctx.script?.characters ?? [], targetPlayerCount: resN, fabledIds: game.fabled, loricIds: game.lorics });
        if (!result.ok) { flash(result.failure.message); return; }
        ui().set({ pickSel: [...result.pool, ...pickRandomTravellers(travN)], pickHover: null });
      },
      clear: () => ui().set({ pickSel: [] }),
      close: () => ui().set({ picker: null }),
    },
  };
}
