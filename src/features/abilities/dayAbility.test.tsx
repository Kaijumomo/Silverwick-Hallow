// SOL-10F-L3: the Storyteller-private Day ability entry point. The Player
// Drawer's progressively disclosed Abilities -> Use ability... opens the SAME
// AbilityWorkspace and commits through the SAME one-commit resolveAbility --
// no second (Day) resolver. Rules-neutral fixtures only (no Slayer semantics).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AbilityEntry } from "./AbilityEntry";
import { PlayerDrawer } from "@/features/players/PlayerDrawer";
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
    gameSchemaVersion: 27, gameRuleFacts: [], code: "", storytellerUid: "local", scriptId: script.id, phase: "day", day: 2,
    players: Object.fromEntries(players.map((p) => [p.id, p])), seatOrder: players.map((p) => p.id),
    plannedPlayerCount: 5, plannedTravelerCount: 0, rolePool: [], fabled: [], lorics: [], bluffs: [], notes: "", nightProgress: {}, pendingPlayers: {},
    history: [], informationDeliveries: [], lifeEventWindow: { coverageFrom: { phase: "night", day: 1 }, events: [] }, setupRolesDealt: true, setupRolesRevealed: true,
  };
  store.setState({ game: g, undoStack: [], localSeq: 0, customScripts: { [script.id]: script }, selectedPlayerId: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Entry({ id }: { id: string }) {
  const player = store((s) => s.game?.players[id]);
  return player ? <AbilityEntry player={player} semantics={FIXTURE_SEMANTICS} /> : null;
}
const openAbilities = () => fireEvent.click(screen.getByText("Abilities"));

describe("SOL-10F-L3: Day ability entry through the same workspace / coordinator", () => {
  it("a verified Day descriptor launches the guided flow and commits once through resolveAbility (no direct writer)", () => {
    const resolveSpy = vi.spyOn(state(), "resolveAbility");
    const otherCommands = (["resolveLife", "resolveEffects", "resolveRoles", "resolveAlignments", "resolveReminders", "setAbilityUsed", "recordDeath"] as const)
      .map((name) => { const spy = vi.fn(); store.setState({ [name]: spy } as never); return spy; });
    store.setState({ resolveAbility: resolveSpy as never });
    render(<Entry id="p0" />);
    // Progressive disclosure: nothing actionable until Abilities is opened.
    expect(screen.queryByRole("button", { name: /Use ability/ })).not.toBeVisible();
    openAbilities();
    fireEvent.click(screen.getByRole("button", { name: "Use ability… (Slayer)" }));
    const dialog = screen.getByRole("dialog", { name: /Slayer — guided resolution/ });
    choose("the chosen player", "p3", dialog);
    const preview = within(dialog).getByRole("region", { name: "Result" });
    expect(preview).toHaveTextContent("Ann's ability is used");
    expect(preview).toHaveTextContent("Dan dies");
    const before = { undo: state().undoStack.length, seq: state().localSeq };
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm and record" }));
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy.mock.calls[0]![0]).toMatchObject({ mode: "guided", roleId: "slayer", fingerprint: { actor: { playerId: "p0" }, phase: "day", day: 2 } });
    for (const spy of otherCommands) expect(spy).not.toHaveBeenCalled();
    expect(game().players.p0!.abilityUsed).toBe(true);
    expect(game().players.p3!.alive).toBe(false);
    expect(state().undoStack).toHaveLength(before.undo + 1);
    expect(state().localSeq).toBe(before.seq + 1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a Night-only verified descriptor is NOT offered as a Day ability; Manual stays available", () => {
    render(<Entry id="p2" />); // the Monk fixture is otherNight-only
    openAbilities();
    expect(screen.queryByRole("button", { name: /Use ability/ })).toBeNull();
    expect(screen.getByText("Monk: This ability does not act during the Day.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve manually / unmodeled interaction" })).toBeInTheDocument();
  });

  it("an unsupported Role reaches the explicit Manual flow and commits once", () => {
    render(<Entry id="p1" />); // Chef: canonical, descriptor-only in fixtures (no Day timing)
    openAbilities();
    fireEvent.click(screen.getByRole("button", { name: "Resolve manually / unmodeled interaction" }));
    const dialog = screen.getByRole("dialog", { name: /Resolve manually \/ unmodeled interaction/ });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Reason for manual resolution" }), { target: { value: "Public claim, unmodeled" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "+ Death" }));
    choose("Step 1 player", "p4", dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm and record" }));
    expect(game().players.p4!.alive).toBe(false);
    expect(game().history.at(-1)!.provenance).toMatchObject({ reason: "manual", note: "Public claim, unmodeled" });
  });

  it("a Role / participant change while the workspace is open makes it stale (never applied)", () => {
    render(<Entry id="p0" />);
    openAbilities();
    fireEvent.click(screen.getByRole("button", { name: "Use ability… (Slayer)" }));
    act(() => { store.setState({ game: { ...game(), players: { ...game().players, p0: { ...game().players.p0!, participantId: "a-new-person" } } } }); });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/out of date/);
    expect(within(dialog).queryByRole("button", { name: /^(Confirm and record|Resolve)$/ })).toBeNull();
  });

  it("is reachable from the Player Drawer during Day, and Privacy Mode unmounts it (and it never reopens stale)", () => {
    function Drawer() {
      const player = store((s) => s.game?.players.p1);
      return player ? <PlayerDrawer player={player} /> : null;
    }
    render(<Drawer />);
    openAbilities();
    fireEvent.click(screen.getByRole("button", { name: "Resolve manually / unmodeled interaction" }));
    expect(screen.getByRole("dialog", { name: /Resolve manually/ })).toBeInTheDocument();
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(screen.queryByRole("dialog", { name: /Resolve manually/ })).toBeNull();
    expect(screen.queryByText("Abilities")).toBeNull();
    act(() => usePrivacyStore.getState().setEnabled(false));
    expect(screen.queryByRole("dialog", { name: /Resolve manually/ })).toBeNull();
  });

  it("is not offered outside Live Play", () => {
    store.setState({ game: { ...game(), phase: "setup", day: 0 } });
    render(<Entry id="p0" />);
    expect(screen.queryByText("Abilities")).toBeNull();
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
    expect(runners).toEqual(["stores/abilityResolution.ts"]);
    const entry = stripComments(readFileSync(join(SRC, "features/abilities/AbilityEntry.tsx"), "utf8"));
    expect(entry).toMatch(/<AbilityWorkspace\b/);
    for (const forbidden of [/planAbilityResolution/, /composeAbilityOutcome/, /plan(Life|Effect|Reminder|Role|Alignment)Transaction/, /resolve(Life|Effects|Reminders|Roles|Alignments)\b/, /\bset\(/]) {
      expect(entry).not.toMatch(forbidden);
    }
  });
});
