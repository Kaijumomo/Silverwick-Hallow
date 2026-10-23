import { BUILTIN_SCRIPTS } from "@/data/scripts";
import { parseClocktowerScript } from "@/data/customScript";
import { iconUrlFor } from "@/data/iconUrl";
import { EDITION_LOGO } from "@/features/home/art";
import { FABLED_CHOICES, LORIC_CHOICES, SCRIPT_ORDER, TEAM_COLOR, compositionFor } from "@/features/newgame/setupFlowModel";
import { useStorytellerStore } from "@/stores/storytellerStore";
import type { RoleDef, Script } from "@/stores/types";
import type { V6Ctx } from "../ctx";
import { flash, useV6Ui, type V6UiState } from "../v6Store";
import { enterTown, leaveTown, setWizardCount, wizardHome, wizardTo } from "./flow";
import { TABLE_MAX, travellersOf, wizardScript } from "./draft";

type Wizard = NonNullable<V6UiState["wiz"]>;

const EXTRA_COLOR = { fabled: "#e0c070", loric: "#7fc4b4" } as const;
const ui = () => useV6Ui.getState();

const patchWiz = (patch: Partial<Wizard>) => {
  const wiz = ui().wiz;
  if (wiz) ui().set({ wiz: { ...wiz, ...patch } });
};

/** Reads an imported script file through the existing custom-script parser and selects it. */
function importScript(event: { target: { files?: FileList | null; value?: string } }): void {
  const file = event.target.files?.[0];
  if (!file) return;
  void file.text().then((text) => {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch (error) { flash(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`); return; }
    const result = parseClocktowerScript(parsed);
    if (!result.ok) { flash(result.error); return; }
    const added = useStorytellerStore.getState().addCustomScript(result.script);
    if (!added.ok) { flash(added.error); return; }
    patchWiz({ script: "custom", customName: result.script.id });
  });
  event.target.value = "";
}

/** The wizard steps rail (shared by the script card and the Prepare the Town card). */
export function wizardSteps(wiz: Wizard | null): unknown[] {
  if (!wiz) return [];
  const idx = { script: 0, extras: 1, town: 2 }[wiz.step];
  return ([["Script & Players", "script"], ["Fabled & Loric", "extras"], ["Prepare the town", "town"]] as const).map(([label, key], i) => {
    const act = i === idx;
    const done = i < idx;
    return {
      label, num: done ? "" : ["I", "II", "III"][i], done, line: i < 2, lineBg: i < idx ? "rgba(192,57,46,.65)" : "rgba(176,186,204,.16)",
      border: act ? "#e8584a" : done ? "rgba(192,57,46,.75)" : "rgba(176,186,204,.25)",
      bg: act ? "rgba(232,88,74,.14)" : done ? "rgba(192,57,46,.24)" : "transparent",
      glow: act ? "0 0 14px rgba(232,88,74,.45)" : "none",
      numColor: act ? "#ff8a78" : "rgba(222,216,204,.45)",
      labelColor: act ? "#f2ece0" : done ? "rgba(222,216,204,.75)" : "rgba(222,216,204,.42)",
      cursor: done ? "pointer" : "default",
      go: () => {
        if (!done) return;
        if (wiz.step === "town") void leaveTown(key);
        else wizardTo(key);
      },
    };
  });
}

/** `wiz`: Steps I and II of New Game, drawn in the Grimoire over a draft table. */
export function wizardVm(ctx: V6Ctx, wiz: Wizard, on: boolean): Record<string, unknown> {
  const customScripts = useStorytellerStore.getState().customScripts;
  const picked = wizardScript(wiz, customScripts);
  const n = wiz.count;
  const trav = travellersOf(n);
  const comp = compositionFor(Math.min(TABLE_MAX, n));
  const compKeys = ["townsfolk", "outsider", "minion", "demon"] as const;
  const compLabels = ["Townsfolk", "Outsiders", "Minions", "Demon"];
  const composition = comp.map((count, i) => ({
    n: count, color: TEAM_COLOR[compKeys[i]!],
    label: i === 1 && count === 1 ? "Outsider" : i === 2 && count === 1 ? "Minion" : compLabels[i],
  }));

  const customPicked = wiz.script === "custom";
  const scripts = [
    ...SCRIPT_ORDER.map((id) => ({ k: id, name: BUILTIN_SCRIPTS[id]?.name ?? id, logo: EDITION_LOGO[id] ?? "", custom: false, notCustom: true })),
    { k: "custom", name: customPicked && picked ? picked.name : "Custom", logo: "", custom: true, notCustom: false },
  ].map((x) => {
    const sel = wiz.script === x.k;
    return {
      ...x, hint: customPicked && picked ? "Imported script" : "Import a JSON file", check: sel,
      pick: () => patchWiz({ script: x.k }),
      border: sel ? "#c0392e" : "rgba(176,186,204,.22)",
      bg: sel ? "linear-gradient(180deg, rgba(192,57,46,.2), rgba(12,13,20,.92))" : "rgba(9,10,15,.55)",
      glow: sel ? "0 0 0 1px #c0392e, 0 0 22px rgba(192,57,46,.35)" : "none",
      op: wiz.script && !sel ? 0.55 : 1,
    };
  });

  const extras: (RoleDef & { team: "fabled" | "loric" })[] = [
    ...FABLED_CHOICES.map((r) => ({ ...r, team: "fabled" as const })),
    ...LORIC_CHOICES.map((r) => ({ ...r, team: "loric" as const })),
  ];
  const byId = new Map(extras.map((r) => [r.id, r]));
  const chosen = wiz.extras.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
  const toggle = (id: string) => () => patchWiz({ extras: wiz.extras.includes(id) ? wiz.extras.filter((x) => x !== id) : [...wiz.extras, id] });
  const tab = wiz.xtab;
  const grid = extras.filter((r) => r.team === tab).map((r) => {
    const sel = wiz.extras.includes(r.id);
    const focused = wiz.focus === r.id;
    const col = EXTRA_COLOR[r.team];
    return {
      id: r.id, name: r.name, icon: iconUrlFor(r), pick: () => patchWiz({ focus: r.id }), on: sel, color: col, op: sel || focused ? 1 : 0.82,
      nameColor: focused ? "#f2ece0" : sel ? col : "rgba(222,216,204,.6)",
      shadow: focused ? "0 0 0 3px #14151d, 0 0 0 5px #f2ece0, 0 0 22px rgba(242,236,224,.35)" : sel ? `0 0 0 3px #14151d, 0 0 0 5px ${col}, 0 0 22px ${col}88` : "0 0 0 3px #14151d, 0 0 0 4px rgba(176,186,204,.3), 0 8px 18px rgba(0,0,0,.5)",
    };
  });
  const tabs = (["fabled", "loric"] as const).map((k) => {
    const act = tab === k;
    const count = chosen.filter((r) => r.team === k).length;
    const col = EXTRA_COLOR[k];
    return {
      label: k === "fabled" ? "Fabled" : "Loric", act, count: extras.filter((r) => r.team === k).length, go: () => patchWiz({ xtab: k }),
      border: act ? `${col}88` : "transparent", bg: act ? `${col}22` : "transparent", color: act ? col : "rgba(222,216,204,.55)",
      countBg: count ? col : "rgba(176,186,204,.14)", countColor: count ? "#14151d" : "rgba(222,216,204,.6)",
    };
  });
  const focus = wiz.focus ? byId.get(wiz.focus) : undefined;
  const focusOn = !!focus && wiz.extras.includes(focus.id);
  const focusCol = focus ? EXTRA_COLOR[focus.team] : "#f2ece0";
  const board = ctx.layout;

  return {
    on, w: Math.round(Math.min(board.w - 40, Math.max(600, Math.min(740, 2 * (board.rx - board.S / 2))))),
    isScript: wiz.step === "script", isExtras: wiz.step === "extras", scripts, onImport: importScript,
    count: n, inc: () => setWizardCount(n + 1), dec: () => setWizardCount(n - 1), composition,
    travText: trav ? `+ ${trav} Traveller${trav === 1 ? "" : "s"} beyond the table` : "Seats fill the circle as you count.",
    nextOp: wiz.script && picked ? 1 : 0.4, nextEv: wiz.script && picked ? "auto" : "none",
    status1: picked ? `${picked.name} · ${n} players` : "Choose a script to continue",
    toExtras: () => { if (wiz.script && picked) wizardTo("extras"); },
    home: () => wizardHome(), back: () => wizardTo("script"), toTown: () => { void enterTown(); },
    tabs, grid, chosenIcons: chosen.map((r) => ({ name: r.name, icon: iconUrlFor(r), color: EXTRA_COLOR[r.team], pick: () => patchWiz({ focus: r.id, xtab: r.team }) })),
    stopWheel: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    tabNote: tab === "fabled" ? "Fabled help new players, fix awkward counts, or add a twist." : "Loric change the rules for everyone at the table.",
    idleNote: trav ? `Spirit of Ivory is recommended with ${n} players. Tap any token to read its ability.` : "Tap any token to read its ability. Choose any, or none.",
    hasFocus: !!focus, noFocus: !focus, focusName: focus?.name ?? "", focusText: focus?.ability ?? "", focusColor: focusCol,
    focusIcon: focus ? iconUrlFor(focus) : "", focusTeam: focus ? (focus.team === "fabled" ? "Fabled" : "Loric") : "",
    focusToggle: focus ? toggle(focus.id) : null, focusBtn: focusOn ? "Remove from game" : "Add to game",
    focusBtnBorder: focusOn ? "rgba(176,186,204,.3)" : focusCol, focusBtnBg: focusOn ? "transparent" : `${focusCol}26`, focusBtnColor: focusOn ? "#ddd6c8" : focusCol,
    detailBorder: focus ? `${focusCol}55` : "rgba(176,186,204,.14)",
    status2: chosen.length ? `${chosen.length} in play` : "None chosen", cta2: chosen.length ? "Prepare the town" : "Skip to the town",
  };
}

export type { Script };
