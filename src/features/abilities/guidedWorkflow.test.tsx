// Phase 10F, Slices 5-6: the simple Effect flow as ONE commit, the progressive workspace (preview, then
// confirm), the Manual / unmodeled path and a stale workflow. Rules-neutral fixture semantics only
// (src/test/abilityFixtures.ts).
// Traceability: 10F-AC-11, AC-19, AC-26, AC-30, AC-32.
//
// Package 4: the Night Order dashboard rows and the Roster/Table pickers these scenarios used to drive are
// retired. The coordinator command and the ability workspace are unchanged, so they are exercised
// directly: `resolveAbility` for the simple flow, and the live <AbilityWorkspace> (the component the
// unified Grimoire's Night card embeds) for the preview, stale and Manual flows. How the Night card opens
// the workspace is covered in grimoire-v6/night.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AbilityWorkspace } from "./AbilityWorkspace";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { canonicalRoles } from "@/data/canonical";
import { buildRegistry } from "@/data/roleRegistry";
import { makeSTPlayer } from "@/test/fixtures";
import { FIXTURE_SEMANTICS } from "@/test/abilityFixtures";
import { captureFingerprint } from "@/stores/abilityResolution";
import { choose } from "@/test/pickers";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";

const script: Script = { id: "guided-test", name: "Guided test", characters: canonicalRoles(["monk", "imp", "empath", "drunk", "chef", "slayer", "washerwoman", "poisoner"]) };
const registry = buildRegistry(script);
const state = () => store.getState();
const game = () => state().game!;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
  const roles = ["monk", "imp", "empath", "drunk", "chef", "washerwoman", "poisoner"];
  const players = roles.map((actualRole, seat) => makeSTPlayer({ id: `p${seat}`, name: ["Alice", "Bob", "Carol", "Dave", "Eve", "Finn", "Gail"][seat]!, seat,
    actualRole, shownRole: actualRole === "drunk" ? "empath" : actualRole, behaviorMode: actualRole === "drunk" ? "drunk_fake_role_behavior" : "normal",
    actualAlignment: registry.alignmentOf(actualRole) }));
  const g: StorytellerLobbyRecord = {
    gameSchemaVersion: 29, preparedInformation: [], playerInfoLog: [], gameRuleFacts: [], code: "", storytellerUid: "local", scriptId: script.id, phase: "night", day: 2,
    players: Object.fromEntries(players.map((p) => [p.id, p])), seatOrder: players.map((p) => p.id),
    plannedPlayerCount: 7, plannedTravelerCount: 0, rolePool: [], fabled: [], lorics: [], bluffs: [], notes: "", nightProgress: {}, pendingPlayers: {},
    history: [], informationDeliveries: [], lifeEventWindow: { coverageFrom: { phase: "night", day: 1 }, events: [] },
    setupRolesDealt: true, setupRolesRevealed: true,
  };
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [script.id]: script }, selectedPlayerId: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** The workspace for one character's step, exactly as the Night card embeds it. */
function Workspace({ actorId, roleId, descriptor, manualReason = "" }: { actorId: string; roleId: string; descriptor: boolean; manualReason?: string }) {
  const current = store((s) => s.game)!;
  const roleName = registry.get(roleId)!.name;
  const step = { day: current.day, stepKey: `p:${current.players[actorId]!.participantId}:${roleId}` };
  return <AbilityWorkspace game={current} script={script} registry={registry} semantics={FIXTURE_SEMANTICS} descriptor={descriptor ? FIXTURE_SEMANTICS.get(roleId)! : null}
    manualReason={manualReason} target={{ actorId, roleId, roleName, invocationPath: "nightOrder", step }} onClose={() => {}} onResolved={() => {}} />;
}

describe("10F-AC-30 / AC-31: a simple target -> Effect ability is ONE commit that also completes the step", () => {
  const stepKey = () => `p:${game().players.p0!.participantId}:monk`;

  it("one coordinator commit applies the Effect, completes the step, and Undo takes everything back at once", () => {
    const before = { undo: state().undoStack.length, seq: state().localSeq };
    const result = state().resolveAbility({ mode: "guided", invocationPath: "nightOrder", fingerprint: captureFingerprint(game(), "p0", { day: 2, stepKey: stepKey() })!, roleId: "monk",
      completeStep: true, inputs: { target: { kind: "participant", participants: [{ playerId: "p2", participantId: game().players.p2!.participantId! }] } } } as never, FIXTURE_SEMANTICS);
    expect(result.ok).toBe(true);
    expect(game().players.p2!.effects.map((e) => e.type)).toEqual(["marked"]);
    expect(state().undoStack).toHaveLength(before.undo + 1);
    expect(state().localSeq).toBe(before.seq + 1);
    expect(game().nightProgress[`2:${stepKey()}`]?.status).toBe("done");
    act(() => { state().undo(); });
    expect(game().players.p2!.effects).toEqual([]);
    expect(game().nightProgress[`2:${stepKey()}`]?.status ?? "pending").not.toBe("done");
  });
});

describe("10F-AC-32: complex resolutions preview, then confirm", () => {
  it("the workspace previews combined consequences and commits once on explicit confirmation", () => {
    render(<Workspace actorId="p1" roleId="imp" descriptor />);
    const dialog = screen.getByRole("dialog", { name: /Imp — guided resolution/ });
    expect(within(dialog).getByText("Player choice")).toBeInTheDocument();
    choose("the player", "p4", dialog);
    const preview = within(dialog).getByRole("region", { name: "Result" });
    expect(preview).toHaveTextContent("Eve becomes the Monk");
    expect(preview).toHaveTextContent("Eve dies");
    expect(preview).toHaveTextContent(/Reminder "Chosen" on Eve \(notation only\)/);
    expect(within(preview).getByText("Silverwick-computed")).toBeInTheDocument();
    const before = state().undoStack.length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm and record" }));
    expect(state().undoStack).toHaveLength(before + 1);
    expect(game().players.p4).toMatchObject({ actualRole: "monk", alive: false });
  });

  it("a stale workflow is never silently resumed (10F-AC-26)", () => {
    render(<Workspace actorId="p1" roleId="imp" descriptor />);
    act(() => { store.setState({ game: { ...game(), players: { ...game().players, p1: { ...game().players.p1!, shownRole: "chef" } } } }); });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/out of date/);
    expect(within(dialog).queryByRole("button", { name: /Confirm|Resolve$/ })).toBeNull();
  });
});

describe("10F-AC-11 / AC-19: Manual / unmodeled interaction", () => {
  it("builds an explicitly labelled, ordered outcome from frozen primitives and commits it once", () => {
    render(<Workspace actorId="p6" roleId="poisoner" descriptor={false} manualReason="no verified rules" />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText("Manual / unmodeled").length).toBeGreaterThan(0);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Reason for manual resolution" }), { target: { value: "Homebrew interaction" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "+ Effect" }));
    choose("Step 1 player", "p4", dialog);
    const preview = within(dialog).getByRole("region", { name: "Result" });
    expect(preview).toHaveTextContent("Eve gains Poisoned");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm and record" }));
    expect(game().players.p4!.effects.map((e) => e.type)).toEqual(["poisoned"]);
    expect(game().history.at(-1)!.provenance).toMatchObject({ reason: "manual", note: "Homebrew interaction" });
    expect(game().nightProgress[`2:p:${game().players.p6!.participantId}:poisoner`]?.status).toBe("done");
  });

  it("a recorded delivery is an information delivery: it keeps the performed role and is never erased", () => {
    render(<Workspace actorId="p3" roleId="empath" descriptor />);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "the number shown" }), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Resolve" }));
    expect(game().informationDeliveries).toEqual([expect.objectContaining({ actualRole: "drunk", performedRole: "empath" })]);
  });
});
