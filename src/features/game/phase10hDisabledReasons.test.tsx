// Phase 10H pre-checkpoint (contract §20): every disabled primary says WHY,
// adjacent, visible without hover and in words -- never by colour alone.
// Traceability: 10H-AC-067.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "@/stores/identity";
import { chooseSegmentValue } from "@/test/pickers";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { GameScreen } from "./GameScreen";
import { DuskReview } from "@/features/life/DayResolution";
import { PlayerDrawer } from "@/features/players/PlayerDrawer";
import { NightOrderPanel } from "@/features/nightOrder/NightOrderPanel";
import { ConfirmDialog } from "@/components/ConfirmDialog";

const state = () => store.getState();
const game = () => state().game!;

/** The adjacent reason a disabled control names through aria-describedby. */
function reasonOf(button: HTMLElement): HTMLElement {
  const ids = (button.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  const reason = ids.map((id) => document.getElementById(id)).find((el) => el?.classList.contains("disabled-reason"));
  expect(reason, "a disabled primary names a visible, worded reason").toBeTruthy();
  return reason!;
}

function liveNight() {
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
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null,
    customScripts: { [setupScript.id]: setupScript } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("10H-AC-067: disabled primaries explain themselves", () => {
  it("Setup: a disabled Reveal Roles counts who still needs a shown role, beside the button", () => {
    state().newGame(setupScript.id, { plannedPlayerCount: 6, plannedRoles: standardRoles(6) });
    for (let i = 0; i < 6; i++) state().addPlayerToSeat("Player " + i);
    act(() => { state().dealRolePool(); });
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "setup" }));
    const reveal = screen.getByRole("button", { name: "Reveal Roles" });
    expect(reveal).toBeDisabled();
    const reason = reasonOf(reveal);
    expect(reason).toHaveTextContent("1 player still needs a shown role before Reveal Roles.");
    expect(reason.parentElement).toBe(reveal.parentElement);
    const drunk = Object.values(game().players).find((p) => p.actualRole === "drunk")!;
    act(() => { state().setShownRole(drunk.id, "chef"); });
    expect(screen.getByRole("button", { name: "Reveal Roles" })).toBeEnabled();
    expect(document.getElementById("setup-primary-reason")).toBeNull();
  });

  it("Dusk: Continue to Night says to record an execution or confirm none happened", () => {
    liveNight();
    state().advancePhase();
    render(<DuskReview onClose={() => {}} onRecord={() => {}} onContinue={() => {}} />);
    const cont = screen.getByRole("button", { name: "Continue to Night 2" });
    expect(cont).toBeDisabled();
    expect(reasonOf(cont)).toHaveTextContent("Record an execution, or confirm that no execution happened today.");
    fireEvent.click(screen.getByLabelText(/No execution happened today/));
    expect(cont).toBeEnabled();
    expect(cont).not.toHaveAttribute("aria-describedby");
  });

  it("Night task surface: a completed step's Done says it is already done, in words", () => {
    liveNight();
    function Night() { const g = store((s) => s.game)!; return <NightOrderPanel game={g} script={troubleBrewing} onClose={() => {}} />; }
    render(<Night />);
    fireEvent.click(screen.getByRole("button", { name: "Add custom night step" }));
    const card = screen.getByText("Custom night step").closest(".step-card") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Done" }));
    const done = within(card).getByRole("button", { name: "Done" });
    expect(done).toBeDisabled();
    expect(reasonOf(done)).toHaveTextContent("This step is already done.");
  });

  it("Inspector: a custom Effect with no name says to name it before Add", () => {
    liveNight();
    const id = game().seatOrder[0]!;
    function Drawer() { const p = store((s) => s.game!.players[id]!); return <PlayerDrawer player={p} />; }
    render(<Drawer />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add effect" }));
    const form = screen.getByRole("form", { name: "Add effect" });
    chooseSegmentValue("Effect", "__custom__", form);
    expect(within(form).getByRole("button", { name: "Add" })).toBeDisabled();
    expect(within(form).getByText("Name the custom effect first.")).toHaveClass("disabled-reason");
    fireEvent.change(within(form).getByLabelText("Custom effect name"), { target: { value: "Cursed" } });
    expect(within(form).getByRole("button", { name: "Add" })).toBeEnabled();
    expect(within(form).queryByText("Name the custom effect first.")).toBeNull();
  });

  it("a true confirmation that is committing says so in words while its buttons are disabled", () => {
    render(<ConfirmDialog title="Remove Alice?" confirmLabel="Remove Alice" danger busy onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Remove Alice" })).toBeDisabled();
    expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent("Working…");
  });
});
