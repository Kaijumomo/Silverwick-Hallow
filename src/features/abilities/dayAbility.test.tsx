// SOL-10F-L3: the Storyteller-private Day ability entry point opens the SAME
// AbilityWorkspace and commits through the SAME one-commit resolveAbility --
// no second (Day) resolver. Rules-neutral fixtures only (no Slayer semantics).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AbilityWorkspace } from "./AbilityWorkspace";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { canonicalRoles } from "@/data/canonical";
import { buildRegistry } from "@/data/roleRegistry";
import { makeSTPlayer } from "@/test/fixtures";
import { FIXTURE_SEMANTICS } from "@/test/abilityFixtures";
import { stripCommentsForGuard as stripComments } from "@/test/writerGuard";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";
import { choose } from "@/test/pickers";

const script: Script = { id: "day-test", name: "Day test", characters: canonicalRoles(["slayer", "chef", "monk", "imp", "empath"]) };
const registry = buildRegistry(script);
const state = () => store.getState();
const game = () => state().game!;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  const roles = ["slayer", "chef", "monk", "imp", "empath"];
  const players = roles.map((actualRole, seat) => makeSTPlayer({ id: `p${seat}`, name: ["Ann", "Ben", "Cat", "Dan", "Eli"][seat]!, seat,
    actualRole, shownRole: actualRole, actualAlignment: registry.alignmentOf(actualRole) }));
  const g: StorytellerLobbyRecord = {
    gameSchemaVersion: 29, preparedInformation: [], playerInfoLog: [], gameRuleFacts: [], code: "", storytellerUid: "local", scriptId: script.id, phase: "day", day: 2,
    players: Object.fromEntries(players.map((p) => [p.id, p])), seatOrder: players.map((p) => p.id),
    plannedPlayerCount: 5, plannedTravelerCount: 0, rolePool: [], fabled: [], lorics: [], bluffs: [], notes: "", nightProgress: {}, pendingPlayers: {},
    history: [], informationDeliveries: [], lifeEventWindow: { coverageFrom: { phase: "night", day: 1 }, events: [] }, setupRolesDealt: true, setupRolesRevealed: true,
  };
  store.setState({ game: g, undoStack: [], localSeq: 0, customScripts: { [script.id]: script }, selectedPlayerId: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** The Day ability workspace, exactly as the unified Grimoire opens it for a Day action. */
function Entry({ id, roleId = "slayer", manual = false }: { id: string; roleId?: string; manual?: boolean }) {
  const current = store((s) => s.game)!;
  const descriptor = manual ? null : FIXTURE_SEMANTICS.get(roleId) ?? null;
  return <AbilityWorkspace game={current} script={script} registry={registry} semantics={FIXTURE_SEMANTICS} descriptor={descriptor} manualReason={descriptor ? "" : "no verified rules"} strictGameplay={roleId === "slayer"}
    target={{ actorId: id, roleId, roleName: registry.get(roleId)!.name, invocationPath: "dayEntry" }} onClose={() => {}} onResolved={() => {}} />;
}

// Package 4: the Player Drawer's Abilities -> Use ability... / Record outcome... entries are retired (the Slayer
// face-off in grimoire-v6/day issues the Day request). The shared workspace and the one-commit coordinator are unchanged.
describe("SOL-10F-L3: Day ability through the same workspace / coordinator", () => {
  it("a verified Day descriptor launches the guided flow and commits once through resolveAbility (no direct writer)", () => {
    const resolveSpy = vi.spyOn(state(), "resolveAbility");
    const otherCommands = (["resolveLife", "resolveEffects", "resolveRoles", "resolveAlignments", "resolveReminders", "setAbilityUsed", "recordDeath"] as const)
      .map((name) => { const spy = vi.fn(); store.setState({ [name]: spy } as never); return spy; });
    store.setState({ resolveAbility: resolveSpy as never });
    render(<Entry id="p0" />);
    const dialog = screen.getByRole("dialog", { name: "Slayer" });
    const before = { undo: state().undoStack.length, seq: state().localSeq };
    choose("the chosen player", "p3", dialog);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy.mock.calls[0]![0]).toMatchObject({ mode: "guided", roleId: "slayer", fingerprint: { actor: { playerId: "p0" }, phase: "day", day: 2 } });
    for (const spy of otherCommands) expect(spy).not.toHaveBeenCalled();
    expect(game().players.p0!.abilityUsed).toBe(true);
    expect(game().players.p3!.alive).toBe(false);
    expect(state().undoStack).toHaveLength(before.undo + 1);
    expect(state().localSeq).toBe(before.seq + 1);
  });

  it("an unmodeled Role reaches the explicit Manual flow and commits once", () => {
    render(<Entry id="p1" roleId="chef" manual />); // Chef: canonical, no verified Day semantics in fixtures
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Reason for manual resolution" }), { target: { value: "Public claim, unmodeled" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "+ Death" }));
    choose("Step 1 player", "p4", dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm and record" }));
    expect(game().players.p4!.alive).toBe(false);
    expect(game().history.at(-1)!.provenance).toMatchObject({ reason: "manual", note: "Public claim, unmodeled" });
  });

  it("a Role / participant change while the workspace is open makes it stale (never applied)", () => {
    render(<Entry id="p0" />);
    act(() => { store.setState({ game: { ...game(), players: { ...game().players, p0: { ...game().players.p0!, participantId: "a-new-person" } } } }); });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/out of date/);
    expect(within(dialog).queryByRole("button", { name: /^(Confirm and record|Resolve)$/ })).toBeNull();
  });
});

describe("architecture: no second Day ability engine", () => {
  const SRC = resolve(__dirname, "../..");
  function productionSources(dir = SRC): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== "test" && name !== "node_modules") out.push(...productionSources(path)); }
      else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(relative(SRC, path).split("\\").join("/"));
    }
    return out;
  }
  it("only the coordinator runs evaluators; the entry point only opens the shared workspace", () => {
    const runners = productionSources().filter((m) => /\.evaluator\s*\(|\bevaluator\s*\(\s*\{/.test(stripComments(readFileSync(join(SRC, m), "utf8"))));
    expect(runners).toEqual(["abilities/automationEligibility.ts", "stores/abilityResolution.ts"]);
    // The Day entry points (the Slayer face-off and the workspace) only route through the coordinator.
    for (const file of ["features/abilities/AbilityWorkspace.tsx", "features/grimoire-v6/day/slayer.tsx"]) {
      const entry = stripComments(readFileSync(join(SRC, file), "utf8"));
      for (const forbidden of [/composeAbilityOutcome/, /plan(Life|Effect|Reminder|Role|Alignment)Transaction/, /resolve(Life|Effects|Reminders|Roles|Alignments)\b/]) {
        expect(entry, file).not.toMatch(forbidden);
      }
    }
  });
});
