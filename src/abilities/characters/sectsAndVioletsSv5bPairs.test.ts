// SV-5 part 2a (the Artist's question, the Savant's visit, the Mutant's and Cerenovus's Execute wording): the pairs of
// docs/ai/SECTS_AND_VIOLETS_SV5B_PAIRS.md that the focused files (artistDay.test.tsx, savantDay.test.tsx, madnessExecution.test.tsx)
// do not name.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PHILOSOPHER_CHARACTER } from "./philosopher";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { useV6Ctx } from "@/features/grimoire-v6/ctx";
import { useV6Ui } from "@/features/grimoire-v6/v6Store";
import { dayActionRows, dayVisitRows } from "@/features/grimoire-v6/day/dayCard";
import { executeOffered, mutantNotWorking } from "@/features/grimoire-v6/day/madnessExecution";
import { artistMayAsk, savantMayVisit } from "@/features/grimoire-v6/day/privateVisit";
import { changeRoleIntent } from "@/stores/roleResolution";
import { bind, openInStore, patchPlayer, plan, planned, proofGame, proofQuery, request } from "@/test/proofFixtures";
import type { AbilityInputValue } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";

const ctxOf = (g: StorytellerLobbyRecord) => { openInStore(g); return renderHook(() => useV6Ctx(store.getState().game!)).result.current; };
const character = (roleId: string): AbilityInputValue => ({ kind: "character", roleIds: [roleId] });
/** The Philosopher (p0) chooses `roleId` on Night 2; the game then moves to Day 2. */
function philosopherChose(roles: string[], roleId: string): StorytellerLobbyRecord {
  const g = proofGame(roles, "night", 2);
  return { ...planned(plan(g, request(g, "p0", "philosopher", { [PHILOSOPHER_CHARACTER]: character(roleId) }, { withStep: true, completeStep: true }))), phase: "day" };
}
/** Character changes through the store's own Role command (as a Pit-Hag, a Barber or a Fang Gu jump records them). */
function changeRoles(g: StorytellerLobbyRecord, changes: [string, string][]): StorytellerLobbyRecord {
  openInStore(g);
  const result = store.getState().resolveRoles({ intents: changes.map(([id, role]) => changeRoleIntent(store.getState().game!.players[id]!, role)) });
  if (!result.ok) throw new Error(result.message);
  return store.getState().game!;
}
const rowKeys = (g: StorytellerLobbyRecord) => dayVisitRows(ctxOf(g)).map((row) => row.key);

beforeEach(() => { useShellStore.getState().resetGameScope(); usePrivacyStore.getState().setEnabled(false); useV6Ui.getState().reset(); });

describe("SV-5b pairs: the Artist and the Savant", () => {
  it("Artist / Savant: both rows, in seat order, and neither is a Day action that raises the '!'", () => {
    const g = proofGame(["savant", "imp", "artist", "chef"], "day", 2);
    expect(rowKeys(g)).toEqual(["savant:p0", "artist:p2"]);
    expect(dayActionRows(ctxOf(g))).toEqual([]);
  });

  it.each(["artist", "savant"])("Philosopher / %s: a Philosopher who gained it gets no row (by hand); the real one, now drunk, keeps it", (roleId) => {
    const g = philosopherChose(["philosopher", "imp", roleId, "chef", "witch"], roleId);
    const ctx = ctxOf(g);
    expect(artistMayAsk(ctx, g.players.p0) || savantMayVisit(ctx, g.players.p0)).toBe(false);
    expect(proofQuery(g).abilityFunctions(bind(g, "p2"))).toEqual({ known: true, value: false });
    expect(rowKeys(g)).toEqual([`${roleId}:p2`]);
  });

  it.each(["artist", "savant"])("Pit-Hag or Barber / %s: a player who becomes it gets the row; the one who stops being it loses it", (roleId) => {
    const g = proofGame([roleId, "pithag", "chef", "imp", "barber"], "day", 2);
    const next = changeRoles(g, [["p0", "chef"], ["p2", roleId]]);
    expect(rowKeys(next)).toEqual([`${roleId}:p2`]);
  });

  it("Pit-Hag or Barber / Artist: a character change resets the used flag, so a player whose flag was set becomes an unspent Artist", () => {
    let g = patchPlayer(proofGame(["artist", "pithag", "chef", "imp"], "day", 2), "p0", { abilityUsed: true });
    g = patchPlayer(g, "p2", { abilityUsed: true });
    expect(rowKeys(g)).toEqual([]);
    const next = changeRoles(g, [["p0", "chef"], ["p2", "artist"]]);
    expect(next.players.p2).toMatchObject({ actualRole: "artist", abilityUsed: false });
    expect(rowKeys(next)).toEqual(["artist:p2"]);
  });

  it("Cerenovus / Artist and Savant: a mad Artist or Savant keeps the row (madness is the Storyteller's call); the seat offers Execute", () => {
    const g = proofGame(["artist", "cerenovus", "savant", "imp"], "night", 2);
    const mad = planned(plan(g, request(g, "p1", "cerenovus", { target: { kind: "participant", participants: [{ playerId: "p0", participantId: g.players.p0!.participantId! }] },
      character: character("chef") }, { withStep: true, completeStep: true })));
    const day = { ...mad, phase: "day" as const };
    expect(rowKeys(day)).toEqual(["artist:p0", "savant:p2"]);
    expect(executeOffered(ctxOf(day), day.players.p0)).toBe(true);
  });
});

describe("SV-5b pairs: the Mutant", () => {
  it("Philosopher / Mutant: a Philosopher who gained the Mutant gets no Execute (by hand); the real Mutant is drunk, so its line shows", () => {
    const g = philosopherChose(["philosopher", "imp", "mutant", "chef", "witch"], "mutant");
    const ctx = ctxOf(g);
    expect(executeOffered(ctx, g.players.p0)).toBe(false);
    expect(executeOffered(ctx, g.players.p2)).toBe(true);
    expect(mutantNotWorking(ctx, g.players.p2!)).toBe(true);
  });

  it("No Dashii / Mutant: the No Dashii poisons Townsfolk neighbours only, so a Mutant beside it keeps a working ability", () => {
    const g = proofGame(["nodashii", "mutant", "chef", "imp"], "day", 2);
    expect(mutantNotWorking(ctxOf(g), g.players.p1!)).toBe(false);
  });

  it("Fang Gu, Pit-Hag or Barber / Mutant: whoever holds the Mutant now gets Execute; a former Mutant does not", () => {
    const g = proofGame(["mutant", "pithag", "chef", "imp"], "day", 2);
    const next = changeRoles(g, [["p0", "fanggu"], ["p2", "mutant"]]);
    const ctx = ctxOf(next);
    expect(executeOffered(ctx, next.players.p0)).toBe(false);
    expect(executeOffered(ctx, next.players.p2)).toBe(true);
  });
});
