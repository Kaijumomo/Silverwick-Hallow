// Pure data helpers for the Home Character Reference overlay (Package 1).
// Everything is derived from data the app already ships: official roles, the
// canonical night sheet and the canonical jinx table. No rules, schema or data
// model are touched.

import type { RoleDef, RoleType } from "@/stores/types";
import { NIGHT_SHEET } from "@/data/canonical";
import { JINXES } from "@/data/jinxes";
import { lookupOfficialRole } from "@/data/officialRoles";

export const TEAMS: { type: RoleType; label: string; kicker: string; color: string }[] = [
  { type: "townsfolk", label: "Townsfolk", kicker: "Townsfolk", color: "#86b7d4" },
  { type: "outsider", label: "Outsiders", kicker: "Outsider", color: "#94c29a" },
  { type: "minion", label: "Minions", kicker: "Minion", color: "#d97a6c" },
  { type: "demon", label: "Demons", kicker: "Demon", color: "#e3894c" },
  { type: "traveler", label: "Travellers", kicker: "Traveller", color: "#b994d4" },
  { type: "fabled", label: "Fabled", kicker: "Fabled", color: "#e0c070" },
  { type: "loric", label: "Loric", kicker: "Loric", color: "#7fc4b4" },
];

export const teamOf = (type: RoleType) => TEAMS.find((t) => t.type === type);

export type TeamGroup = { type: RoleType; label: string; color: string; roles: RoleDef[] };

/** Team shelves in the design's order; empty teams are dropped. */
export function groupByTeam(roles: RoleDef[]): TeamGroup[] {
  return TEAMS.map((t) => ({ type: t.type, label: t.label, color: t.color, roles: roles.filter((r) => r.type === t.type) })).filter(
    (g) => g.roles.length > 0,
  );
}

/** Reminder text as shown to people: drop the :reminder: marker and *emphasis*. */
export function cleanReminder(text: string | undefined): string {
  return (text ?? "").replace(/:reminder:/g, "").replace(/\*([^*]+)\*/g, "$1").replace(/\s{2,}/g, " ").trim();
}

const SPECIAL_STEPS: Record<string, { name: string; text: string }> = {
  dusk: { name: "Dusk", text: "Check that all eyes are closed." },
  minioninfo: { name: "Minion info", text: "Wake the Minions; show them each other and the Demon." },
  demoninfo: { name: "Demon info", text: "Wake the Demon; show the Minions and 3 bluffs." },
  dawn: { name: "Dawn", text: "Wait a few seconds, then call for eyes open." },
};

export type NightRow =
  | { kind: "step"; id: string; name: string; text: string }
  | { kind: "role"; id: string; num: number; role: RoleDef; text: string };

export type NightColumn = { key: "first" | "other"; label: string; rows: NightRow[]; wakes: number };

/**
 * Night order for the characters in view: the published sheet order, keeping
 * only characters of this category that have a reminder for that night, plus
 * the Dusk / Minion info / Demon info / Dawn steps (Minion and Demon info on
 * the first night only).
 */
export function buildNightColumns(roles: RoleDef[]): NightColumn[] {
  const inView = new Map(roles.map((r) => [r.id, r]));
  const build = (ids: readonly string[], key: "firstNightReminder" | "otherNightReminder"): NightRow[] => {
    let n = 0;
    const rows: NightRow[] = [];
    for (const id of ids) {
      const step = SPECIAL_STEPS[id];
      if (step) {
        if (key === "otherNightReminder" && (id === "minioninfo" || id === "demoninfo")) continue;
        rows.push({ kind: "step", id, name: step.name, text: step.text });
        continue;
      }
      const role = inView.get(id) ?? undefined;
      const text = role?.[key];
      if (!role || !text) continue;
      n += 1;
      rows.push({ kind: "role", id, num: n, role, text: cleanReminder(text) });
    }
    return rows;
  };
  const columns: [NightColumn["key"], string, NightRow[]][] = [
    ["first", "First night", build(NIGHT_SHEET.firstNight, "firstNightReminder")],
    ["other", "Other nights", build(NIGHT_SHEET.otherNight, "otherNightReminder")],
  ];
  return columns.map(([key, label, rows]) => ({ key, label, rows, wakes: rows.filter((r) => r.kind === "role").length }));
}

export type JinxEntry = { id: string; name: string; reason: string; role: RoleDef | undefined };

/** Every jinx involving this character, in both directions (its own first, as the design lists them). */
export function jinxesOf(roleId: string): JinxEntry[] {
  const entry = (otherId: string, reason: string): JinxEntry => {
    const role = lookupOfficialRole(otherId);
    return { id: otherId, name: role?.name ?? otherId, reason, role };
  };
  return [
    ...JINXES.filter((j) => j.a === roleId).map((j) => entry(j.b, j.reason)),
    ...JINXES.filter((j) => j.b === roleId).map((j) => entry(j.a, j.reason)),
  ];
}

/** Distinct reminder-token labels (character + global), as the design does. */
export function reminderLabels(role: RoleDef): string[] {
  return [...new Set([...(role.reminders ?? []), ...(role.remindersGlobal ?? [])])];
}

/** Letters laid along the token's lower arc (radius 36, as in the design). */
export function arcLetters(label: string): { fs: number; letters: { ch: string; rot: number }[] } {
  const fs = label.length > 14 ? 9 : label.length > 9 ? 11 : 13;
  const chars = label.toUpperCase().split("");
  const step = ((fs * 0.78) / 36) * 57.3;
  const span = step * (chars.length - 1);
  return {
    fs,
    letters: chars.map((ch, i) => ({ ch: ch === " " ? " " : ch, rot: Math.round((span / 2 - i * step) * 10) / 10 })),
  };
}
