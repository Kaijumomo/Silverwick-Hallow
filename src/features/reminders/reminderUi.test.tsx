// Phase 10C: Reminder UI -- the fast Drawer path (participant -> reminder ->
// done), safe presets, the non-blocking authoritative-label hint, per-instance
// detail with amend/correction, the Grimoire notation grammar (distinct from
// Effects, aggregation, explicit overflow, words not colour), the accessible
// token summary, ParticipantId-keyed state and Privacy Mode DOM absence.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "@/stores/identity";
import { GrimoireCircle } from "@/features/grimoire/GrimoireCircle";
import { PlayerDrawer } from "@/features/players/PlayerDrawer";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { buildRegistry } from "@/data/roleRegistry";
import { selectActiveFabled, selectActiveLorics } from "@/features/publicDisplay/presenters";
import { MAX_VISIBLE_REMINDER_GROUPS, REMINDER_PRESETS } from "./reminderPresentation";
import type { ReminderParticipantBinding } from "@/stores/reminderResolution";
import type { PlayerId, ReminderRecord } from "@/stores/types";

const state = () => store.getState();
const game = () => state().game!;
const idOf = (name: string) => game().seatOrder.find((id) => game().players[id]!.name === name)!;
const player = (id: PlayerId) => game().players[id]!;
const bind = (id: PlayerId): ReminderParticipantBinding => ({ playerId: id, participantId: player(id).participantId! });
const place = (name: string, reminder: Record<string, unknown>) =>
  state().resolveReminders({ intents: [{ kind: "place", target: bind(idOf(name)), reminder } as never] });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null,
    customScripts: { [setupScript.id]: setupScript } });
  state().newGame(setupScript.id, { plannedPlayerCount: 7 });
  ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"].forEach((n) => state().addPlayerToSeat(n));
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) {
    if (needsShownIdentity(game().players[id]!.actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Renders the drawer for whoever occupies `seat` now (the component stays
 * mounted across a seat replacement, like the real GameScreen). */
function SeatDrawer({ seat }: { seat: PlayerId }) {
  const p = store((s) => s.game!.players[seat]!);
  return <PlayerDrawer player={p} />;
}
const reminderSection = () => screen.getByRole("region", { name: "Reminders" });
const tokenOf = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}, seat`) });

describe("Phase 10C Drawer fast path", () => {
  it("participant -> type -> Add places one Reminder in one commit; nothing else is asked for", () => {
    render(<SeatDrawer seat={idOf("Carol")} />);
    const input = within(reminderSection()).getByRole("textbox", { name: "Reminder text" });
    fireEvent.change(input, { target: { value: "Chosen" } });
    const seq = state().localSeq;
    fireEvent.submit(input.closest("form")!);
    expect(state().localSeq).toBe(seq + 1);
    expect(player(idOf("Carol")).reminders).toEqual([{ id: expect.stringMatching(/^rm-/), label: "Chosen", createdAt: { phase: "night", day: 1 } }]);
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("group", { name: "Reminder options" })).toBeNull();
  });

  it("a safe preset is one tap; authoritative-shadowing presets are gone", () => {
    render(<SeatDrawer seat={idOf("Carol")} />);
    const presets = within(reminderSection()).getByRole("group", { name: "Quick reminders" });
    expect(within(presets).getAllByRole("button").map((b) => b.textContent)).toEqual(REMINDER_PRESETS.map((p) => `+ ${p}`));
    for (const shadowing of ["Used", "Drunk", "Poisoned", "Protected", "Mad"]) {
      expect(within(presets).queryByRole("button", { name: `+ ${shadowing}` })).toBeNull();
    }
    fireEvent.click(within(presets).getByRole("button", { name: "+ Knows" }));
    expect(player(idOf("Carol")).reminders.map((r) => r.label)).toEqual(["Knows"]);
  });

  it("fast remove: one tap on the instance's remove control removes exactly that instance", () => {
    place("Carol", { id: "a", label: "Chosen" });
    place("Carol", { id: "b", label: "Chosen" });
    render(<SeatDrawer seat={idOf("Carol")} />);
    const removes = within(reminderSection()).getAllByRole("button", { name: "Remove Chosen reminder" });
    expect(removes).toHaveLength(2);
    fireEvent.click(removes[0]!);
    expect(player(idOf("Carol")).reminders.map((r) => r.id)).toEqual(["b"]);
  });

  it("typing an authoritative Effect label shows a non-blocking hint; the placed Reminder stays inert notation", () => {
    render(<SeatDrawer seat={idOf("Carol")} />);
    const input = within(reminderSection()).getByRole("textbox", { name: "Reminder text" });
    fireEvent.change(input, { target: { value: "poisoned" } });
    expect(within(reminderSection()).getByRole("note")).toHaveTextContent("Poisoned is tracked as an Effect");
    fireEvent.submit(input.closest("form")!);
    expect(player(idOf("Carol")).reminders.map((r) => r.label)).toEqual(["poisoned"]);
    expect(player(idOf("Carol")).effects).toEqual([]);
    fireEvent.change(input, { target: { value: "Chosen" } });
    expect(within(reminderSection()).queryByRole("note")).toBeNull();
  });

  it("More options adds source, character (pre-filled from the source), a cleanup hint and a note -- progressively", () => {
    render(<SeatDrawer seat={idOf("Carol")} />);
    fireEvent.click(within(reminderSection()).getByRole("button", { name: "More options" }));
    fireEvent.change(screen.getByRole("combobox", { name: "From player" }), { target: { value: idOf("Alice") } });
    expect((screen.getByRole("combobox", { name: "Character" }) as HTMLSelectElement).value).toBe(player(idOf("Alice")).actualRole);
    fireEvent.click(screen.getByRole("checkbox", { name: /Remind me to clean up as Day 1 begins/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "context" } });
    const input = within(reminderSection()).getByRole("textbox", { name: "Reminder text" });
    fireEvent.change(input, { target: { value: "Red Herring" } });
    fireEvent.submit(input.closest("form")!);
    expect(player(idOf("Carol")).reminders[0]).toMatchObject({
      label: "Red Herring", sourceParticipant: { kind: "participant", participantId: player(idOf("Alice")).participantId },
      sourceCharacter: player(idOf("Alice")).actualRole, cleanupCue: { kind: "at", moment: { phase: "day", day: 1 } }, note: "context",
    });
    expect(screen.queryByRole("button", { name: "Fewer options" })).toBeNull();
  });
});

describe("Phase 10C Drawer detail", () => {
  it("each instance reveals origin (departed shown by durable name, never the new occupant), placed moment, cleanup and note", () => {
    const alice = idOf("Alice");
    place("Carol", { id: "r1", label: "Chosen", source: bind(alice), note: "why" });
    state().unseatPlayer(alice);
    state().addPlayerToSeat("Mallory");
    render(<SeatDrawer seat={idOf("Carol")} />);
    const toggle = within(reminderSection()).getByRole("button", { name: "Chosen. Show details" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const section = reminderSection();
    expect(section).toHaveTextContent("Alice (left)");
    expect(section).not.toHaveTextContent("Mallory");
    expect(section).toHaveTextContent("Night 1");
    expect(section).toHaveTextContent("No cleanup reminder");
    expect(section).toHaveTextContent("why");
  });

  it("amend the cleanup hint and note from the detail; a due cue reads 'needs cleanup' in words", () => {
    place("Carol", { id: "r1", label: "Chosen" });
    render(<SeatDrawer seat={idOf("Carol")} />);
    fireEvent.click(within(reminderSection()).getByRole("button", { name: "Chosen. Show details" }));
    fireEvent.click(within(reminderSection()).getByRole("button", { name: "Clean up as Day 1 begins" }));
    expect(player(idOf("Carol")).reminders[0]!.cleanupCue).toEqual({ kind: "at", moment: { phase: "day", day: 1 } });
    fireEvent.change(within(reminderSection()).getByRole("textbox", { name: "Note" }), { target: { value: "noted" } });
    fireEvent.click(within(reminderSection()).getByRole("button", { name: "Save note" }));
    expect(player(idOf("Carol")).reminders[0]!.note).toBe("noted");
    act(() => { state().advancePhase(); });
    expect(within(reminderSection()).getByRole("button", { name: /^Chosen, needs cleanup\. Hide details/ })).toBeInTheDocument();
    expect(reminderSection()).toHaveTextContent("needs cleanup now");
  });

  it("a legacy unresolved cue shows 'needs check' and is resolved only through correction controls", () => {
    const carol = idOf("Carol");
    store.setState({ game: { ...game(), players: { ...game().players, [carol]: { ...player(carol),
      reminders: [{ id: "legacy", label: "Old", cleanupCue: { kind: "unresolved" } }] as ReminderRecord[] } } } });
    render(<SeatDrawer seat={carol} />);
    fireEvent.click(within(reminderSection()).getByRole("button", { name: "Old, needs check. Show details" }));
    const resolve = within(reminderSection()).getByRole("group", { name: "Resolve Old cleanup" });
    fireEvent.click(within(resolve).getByRole("button", { name: "Keep (no cleanup)" }));
    expect(player(carol).reminders[0]).toEqual({ id: "legacy", label: "Old" });
    expect(game().history.at(-1)).toMatchObject({ category: "reminder", correction: true, reminderOperation: "amend" });
  });

  it("'Recorded in error' is a correction removal", () => {
    place("Carol", { id: "r1", label: "Oops" });
    render(<SeatDrawer seat={idOf("Carol")} />);
    fireEvent.click(within(reminderSection()).getByRole("button", { name: "Oops. Show details" }));
    fireEvent.click(within(reminderSection()).getByRole("button", { name: "Recorded in error" }));
    expect(player(idOf("Carol")).reminders).toEqual([]);
    expect(game().history.at(-1)).toMatchObject({ correction: true, reminderOperation: "remove" });
  });

  it("draft and detail state never cross a ParticipantId replacement of the same seat", () => {
    const seat = idOf("Carol");
    place("Carol", { id: "r1", label: "Chosen" });
    render(<SeatDrawer seat={seat} />);
    fireEvent.change(within(reminderSection()).getByRole("textbox", { name: "Reminder text" }), { target: { value: "half-typed" } });
    fireEvent.click(within(reminderSection()).getByRole("button", { name: "Chosen. Show details" }));
    act(() => {
      state().unseatPlayer(seat);
      state().addPlayerToSeat("Zed");
    });
    expect(player(seat).name).toBe("Zed");
    expect((within(reminderSection()).getByRole("textbox", { name: "Reminder text" }) as HTMLInputElement).value).toBe("");
    expect(within(reminderSection()).queryByRole("button", { name: /Show details|Hide details/ })).toBeNull();
    expect(reminderSection()).toHaveTextContent("No reminders.");
  });
});

describe("Phase 10C Grimoire notation grammar", () => {
  it("aggregates identical labels, keeps a distinct notation family (never an Effect indicator), and names it in words", () => {
    place("Carol", { label: "Chosen" });
    place("Carol", { label: "Chosen" });
    place("Carol", { label: "Poisoned" }); // inert notation, NOT the Poisoned Effect
    const { container } = render(<GrimoireCircle />);
    const token = tokenOf("Carol");
    const chips = token.querySelectorAll(".token-reminders .reminder-pip");
    expect([...chips].map((c) => c.textContent)).toEqual(["✎Chosen ×2", "✎Poisoned"]);
    expect(token.querySelectorAll("[data-effect-indicator]")).toHaveLength(0);
    expect(container.querySelector(".status-chip-poisoned")).toBeNull();
    expect(token).toHaveAccessibleName(/, 3 reminders: Chosen ×2, Poisoned$/);
    // Decorative chips: the token's accessible name carries them in words.
    expect([...chips].every((c) => c.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  it("shows an explicit '+N more' overflow instead of silently hiding Reminder #5+", () => {
    for (const label of ["A", "B", "C", "D", "E", "F"]) place("Carol", { label });
    render(<GrimoireCircle />);
    const token = tokenOf("Carol");
    const shown = token.querySelectorAll(".token-reminders .reminder-pip:not(.reminder-overflow)");
    expect(shown).toHaveLength(MAX_VISIBLE_REMINDER_GROUPS - 1);
    expect(token.querySelector(".reminder-overflow")!.textContent).toBe("+3 more");
    expect(token).toHaveAccessibleName(/6 reminders: A, B, C, D, E, F$/);
  });

  it("a due cleanup cue is shown in words and spoken, and is prioritized into the visible chips", () => {
    for (const label of ["A", "B", "C", "D"]) place("Carol", { label });
    place("Carol", { label: "Clean", cleanup: { kind: "nextPhase" } });
    act(() => { state().advancePhase(); });
    render(<GrimoireCircle />);
    const token = tokenOf("Carol");
    const first = token.querySelector(".token-reminders .reminder-pip")!;
    expect(first.textContent).toBe("✎Clean · cleanup");
    expect(first.classList.contains("reminder-pip-due")).toBe(true);
    expect(token).toHaveAccessibleName(/5 reminders: Clean, A, B, C, D; 1 needs cleanup$/);
  });

  it("the token stays one keyboard/touch control that opens the Drawer's per-instance Reminder controls", () => {
    place("Carol", { label: "Chosen" });
    render(<GrimoireCircle />);
    const token = tokenOf("Carol");
    expect(token).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(token, { key: "Enter" });
    expect(state().selectedPlayerId).toBe(idOf("Carol"));
    // No nested interactive element hides inside the token.
    expect(token.querySelectorAll(".token-reminders button, .token-reminders [tabindex]")).toHaveLength(0);
  });
});

describe("Phase 10C Privacy Mode and projections", () => {
  it("Privacy Mode leaves no Reminder label, chip, count, overflow, cleanup state or accessible text in the Grimoire DOM", () => {
    for (const label of ["Secret-A", "Secret-B", "Secret-C", "Secret-D", "Secret-E"]) place("Carol", { label });
    place("Carol", { label: "Secret-due", cleanup: { kind: "nextPhase" } });
    act(() => { state().advancePhase(); });
    usePrivacyStore.setState({ enabled: true });
    const { container } = render(<GrimoireCircle />);
    expect(container.querySelector(".token-reminders")).toBeNull();
    expect(container.querySelector(".reminder-pip")).toBeNull();
    expect(container.innerHTML).not.toMatch(/Secret|reminder|more|cleanup/i);
    const token = screen.getByRole("button", { name: /^Carol, seat/ });
    expect(token.getAttribute("aria-label")).not.toMatch(/reminder|Secret|cleanup/i);
  });

  it("an open Reminder detail closes under Privacy Mode and does not reopen when it ends", () => {
    place("Carol", { id: "r1", label: "Secret", note: "private note" });
    render(<SeatDrawer seat={idOf("Carol")} />);
    fireEvent.click(within(reminderSection()).getByRole("button", { name: "Secret. Show details" }));
    expect(reminderSection()).toHaveTextContent("private note");
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(screen.queryByRole("region", { name: "Reminders" })).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/Secret|private note/);
    act(() => usePrivacyStore.getState().setEnabled(false));
    expect(within(reminderSection()).getByRole("button", { name: "Secret. Show details" })).toHaveAttribute("aria-expanded", "false");
    expect(reminderSection()).not.toHaveTextContent("private note");
  });

  it("no Reminder data reaches the public, self or Public Display projections", () => {
    place("Carol", { label: "SECRET-LABEL", note: "SECRET-NOTE", source: bind(idOf("Alice")), sourceCharacter: "fortuneteller", cleanup: { kind: "nextPhase" } });
    const registry = buildRegistry(setupScript);
    const publicLobby = projectLobbyToPublic(game(), {});
    const pub = JSON.stringify(publicLobby);
    const self = JSON.stringify(projectLobbyToSelfMap(game(), registry));
    // The Public Display renders only from the public projection.
    const display = JSON.stringify([publicLobby, selectActiveFabled(publicLobby), selectActiveLorics(publicLobby)]);
    for (const leak of ["SECRET-LABEL", "SECRET-NOTE", "reminders", "cleanupCue", "createdAt"]) {
      expect(pub).not.toContain(leak);
      expect(self).not.toContain(leak);
      expect(display).not.toContain(leak);
    }
  });
});
