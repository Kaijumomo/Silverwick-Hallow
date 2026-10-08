// Phase 10F, Slices 5-6: the interactive Night Order dashboard, the inline
// simple flow, the progressive workspace, the Manual / unmodeled path, Undo vs
// correction, the Grimoire target picker and Privacy Mode. Rules-neutral
// fixture semantics only (src/test/abilityFixtures.ts).
// Traceability: 10F-AC-11, AC-19, AC-26, AC-28, AC-30, AC-31, AC-32.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NightOrderPanel } from "@/features/nightOrder/NightOrderPanel";
import { GrimoireCircle } from "@/features/grimoire/GrimoireCircle";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { canonicalRoles } from "@/data/canonical";
import { buildRegistry } from "@/data/roleRegistry";
import { makeSTPlayer } from "@/test/fixtures";
import { FIXTURE_SEMANTICS } from "@/test/abilityFixtures";
import { pickSeatIfPicking, useTargetPicker } from "./abilityUi";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";
import { choose, chosen } from "@/test/pickers";

const script: Script = { id: "guided-test", name: "Guided test", characters: canonicalRoles(["monk", "imp", "empath", "drunk", "chef", "slayer", "washerwoman", "poisoner"]) };
const registry = buildRegistry(script);
const state = () => store.getState();
const game = () => state().game!;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
  useTargetPicker.setState({ active: null });
  const roles = ["monk", "imp", "empath", "drunk", "chef", "washerwoman", "poisoner"];
  const players = roles.map((actualRole, seat) => makeSTPlayer({ id: `p${seat}`, name: ["Alice", "Bob", "Carol", "Dave", "Eve", "Finn", "Gail"][seat]!, seat,
    actualRole, shownRole: actualRole === "drunk" ? "empath" : actualRole, behaviorMode: actualRole === "drunk" ? "drunk_fake_role_behavior" : "normal",
    actualAlignment: registry.alignmentOf(actualRole) }));
  const g: StorytellerLobbyRecord = {
    gameSchemaVersion: 26, gameRuleFacts: [], code: "", storytellerUid: "local", scriptId: script.id, phase: "night", day: 2,
    players: Object.fromEntries(players.map((p) => [p.id, p])), seatOrder: players.map((p) => p.id),
    plannedPlayerCount: 7, plannedTravelerCount: 0, rolePool: [], fabled: [], lorics: [], bluffs: [], notes: "", nightProgress: {}, pendingPlayers: {},
    history: [], informationDeliveries: [], lifeEventWindow: { coverageFrom: { phase: "night", day: 1 }, events: [] },
    setupRolesDealt: true, setupRolesRevealed: true,
  };
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [script.id]: script }, selectedPlayerId: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Night({ semantics = FIXTURE_SEMANTICS }: { semantics?: typeof FIXTURE_SEMANTICS }) {
  const current = store((s) => s.game)!;
  return <NightOrderPanel game={current} script={script} onClose={() => {}} semantics={semantics} />;
}
const card = (role: string, player: string) =>
  screen.getAllByText(role, { selector: ".step-role-name" }).map((el) => el.closest(".step-card") as HTMLElement)
    .find((el) => el.querySelector(".step-player-name")?.textContent?.startsWith(`${player} ·`))!;

describe("10F-AC-30 / AC-31: the Night Order is an operating dashboard", () => {
  it("rows expose status, chips and the next action; unsupported abilities offer the Manual path (never a dead end)", () => {
    render(<Night />);
    const monk = card("Monk", "Alice");
    expect(within(monk).getByText("Choose a player to mark")).toBeInTheDocument();
    const drunk = card("Empath", "Dave");
    expect(within(drunk).getByText("simulated wake")).toBeInTheDocument();
    // Poisoner: canonical, but no verified semantics -> Manual.
    const poisoner = card("Poisoner", "Gail");
    expect(within(poisoner).getByText(/no verified rules/)).toBeInTheDocument();
    expect(within(poisoner).getByRole("button", { name: "Resolve manually / unmodeled interaction" })).toBeInTheDocument();
  });

  it("a simple target -> Effect ability resolves inline in target + Resolve, as ONE commit that also completes the step", () => {
    render(<Night />);
    const monk = card("Monk", "Alice");
    const before = { undo: state().undoStack.length, seq: state().localSeq };
    choose("the player to mark", "p2", monk);
    fireEvent.click(within(monk).getByRole("button", { name: "Resolve" }));
    expect(game().players.p2!.effects.map((e) => e.type)).toEqual(["marked"]);
    expect(state().undoStack).toHaveLength(before.undo + 1);
    expect(state().localSeq).toBe(before.seq + 1);
    expect(game().nightProgress[`2:p:${game().players.p0!.participantId}:monk`]?.status).toBe("done");
    const done = card("Monk", "Alice");
    expect(done).toHaveAttribute("data-status", "done");
    expect(within(done).getByText("Resolved")).toBeInTheDocument();
    // Undo is offered while it is the latest commit, and undoes everything at once.
    fireEvent.click(within(done).getByRole("button", { name: "Undo" }));
    expect(game().players.p2!.effects).toEqual([]);
    expect(card("Monk", "Alice")).toHaveAttribute("data-status", "pending");
  });

  it("once a later action happens, the row offers a progressively disclosed Correct, not Undo", () => {
    render(<Night />);
    const monk = card("Monk", "Alice");
    choose("the player to mark", "p2", monk);
    fireEvent.click(within(monk).getByRole("button", { name: "Resolve" }));
    act(() => { state().setNotes("p4", "a later change"); });
    const done = card("Monk", "Alice");
    expect(within(done).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(within(done).getByText("Correct…")).toBeInTheDocument();
  });

  it("the Grimoire can pick the target (ParticipantId captured at the tap) without opening the drawer", () => {
    render(<><Night /><GrimoireCircle /></>);
    const monk = card("Monk", "Alice");
    fireEvent.click(within(monk).getByRole("button", { name: /^Choose .+ on the Table$/ }));
    expect(screen.getByText(/the player to mark · Tap a player/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Carol, seat 3/ }));
    expect(state().selectedPlayerId).toBeNull(); // consumed as a pick, not a selection
    expect(chosen("the player to mark", card("Monk", "Alice"))).toBe("p2");
    // With no pick active a tap is an ordinary selection again.
    fireEvent.click(screen.getByRole("button", { name: /^Carol, seat 3/ }));
    expect(state().selectedPlayerId).toBe("p2");
    // An empty seat is never a target.
    expect(pickSeatIfPicking(game(), "nobody")).toBe(false);
  });
});

describe("10F-AC-32: complex resolutions preview, then confirm", () => {
  it("the workspace previews combined consequences and commits once on explicit confirmation", () => {
    render(<Night />);
    fireEvent.click(within(card("Imp", "Bob")).getByRole("button", { name: "Guide" }));
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
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(state().undoStack).toHaveLength(before + 1);
    expect(game().players.p4).toMatchObject({ actualRole: "monk", alive: false });
  });

  it("a stale workflow is never silently resumed (10F-AC-26)", () => {
    render(<Night />);
    fireEvent.click(within(card("Imp", "Bob")).getByRole("button", { name: "Guide" }));
    act(() => { store.setState({ game: { ...game(), players: { ...game().players, p1: { ...game().players.p1!, shownRole: "chef" } } } }); });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/out of date/);
    expect(within(dialog).queryByRole("button", { name: /Confirm|Resolve$/ })).toBeNull();
  });
});

describe("10F-AC-11 / AC-19: Manual / unmodeled interaction", () => {
  it("builds an explicitly labelled, ordered outcome from frozen primitives and commits it once", () => {
    render(<Night />);
    fireEvent.click(within(card("Poisoner", "Gail")).getByRole("button", { name: "Resolve manually / unmodeled interaction" }));
    const dialog = screen.getByRole("dialog", { name: /Resolve manually \/ unmodeled interaction/ });
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

  it("a recorded delivery's Undo never claims the information was unsaid", () => {
    render(<Night />);
    fireEvent.click(within(card("Empath", "Dave")).getByRole("button", { name: "Guide" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "the number shown" }), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Resolve" }));
    expect(game().informationDeliveries).toEqual([expect.objectContaining({ actualRole: "drunk", performedRole: "empath" })]);
    const done = card("Empath", "Dave");
    expect(within(done).getByText(/cannot unsay it/)).toBeInTheDocument();
    expect(done).not.toHaveTextContent(/unsaid|erase what was told|take back/i);
  });
});

describe("10F-AC-28: Privacy Mode", () => {
  it("the workspace and every draft are absent under Privacy Mode and never reopen stale when it turns off", () => {
    render(<Night />);
    fireEvent.click(within(card("Imp", "Bob")).getByRole("button", { name: "Guide" }));
    choose("the player", "p4", screen.getByRole("dialog"));
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body).not.toHaveTextContent(/Eve becomes|guided resolution|Player choice|Silverwick-computed|Imp/);
    act(() => usePrivacyStore.getState().setEnabled(false));
    expect(screen.queryByRole("dialog")).toBeNull(); // not silently reopened
    expect(game().players.p4!.alive).toBe(true);
  });

  it("an active Grimoire pick is cancelled by Privacy Mode", () => {
    render(<Night />);
    fireEvent.click(within(card("Monk", "Alice")).getByRole("button", { name: /^Choose .+ on the Table$/ }));
    expect(useTargetPicker.getState().active).not.toBeNull();
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(useTargetPicker.getState().active).toBeNull();
  });
});
