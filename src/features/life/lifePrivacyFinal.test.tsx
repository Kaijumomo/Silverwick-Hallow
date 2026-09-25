import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "@/stores/identity";
import { GameScreen } from "@/features/game/GameScreen";
import { DayResolutionPanel, DuskReview } from "./DayResolution";
import { LifeEventsPanel } from "./LifeEventsPanel";

// Phase 10A final Astra privacy remediation (10A-ASTRA-003 residual):
// every Life Event-bearing dialog is private Storyteller UI. Under Privacy
// Mode it closes itself (its parent's open state clears) and it never stays
// mounted to turn private again when Privacy Mode ends; private review
// needs an explicit fresh open with Privacy Mode off.

const HISTORIC = "Zanzibar"; // name recorded in the Life Event snapshot
const CURRENT = "Quill";     // the same player's current public name
const state = () => store.getState();
const game = () => state().game!;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null,
    customScripts: { [setupScript.id]: setupScript } });
  // Day 1 with an execution recorded under the name "Zanzibar", after which
  // the executee was renamed "Quill".
  state().newGame(setupScript.id, { plannedPlayerCount: 7 });
  [HISTORIC, "Bea", "Cy", "Di", "Ed", "Flo", "Gus"].forEach((n) => state().addPlayerToSeat(n));
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) {
    if (needsShownIdentity(game().players[id]!.actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  expect(state().advancePhase().ok).toBe(true);
  const executee = game().seatOrder[0]!;
  expect(state().recordExecution(executee, "died").ok).toBe(true);
  state().renamePlayer(executee, CURRENT);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Private content absent from visible text, textContent, innerHTML,
 * Testing Library text queries and role/name accessibility queries. */
function expectNoPrivateContent() {
  const pattern = new RegExp(HISTORIC);
  expect(document.body.textContent ?? "").not.toContain(HISTORIC);
  expect(document.body.innerHTML).not.toContain(HISTORIC);
  expect(screen.queryAllByText(pattern)).toEqual([]);
  expect(screen.queryAllByLabelText(pattern)).toEqual([]);
  for (const role of ["dialog", "listitem", "option", "button", "group", "note", "heading"] as const) {
    expect(screen.queryAllByRole(role, { name: pattern })).toEqual([]);
  }
  expect(screen.queryAllByText(/executed — died/)).toEqual([]);
  expect(screen.queryByRole("dialog")).toBeNull();
}

type Surface = "Day Resolution" | "Dusk Review" | "Life Events";
const SURFACES: Surface[] = ["Day Resolution", "Dusk Review", "Life Events"];

/** A parent holding the dialog's open state, as GameScreen does. */
function Harness({ surface }: { surface: Surface }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open review</button>
      <output data-testid="open-state">{String(open)}</output>
      {open && surface === "Day Resolution" && <DayResolutionPanel onClose={close} />}
      {open && surface === "Dusk Review" && <DuskReview onClose={close} onRecord={() => {}} onContinue={() => {}} />}
      {open && surface === "Life Events" && <LifeEventsPanel onClose={close} />}
    </>
  );
}
const openState = () => screen.getByTestId("open-state").textContent;
const setPrivacy = (enabled: boolean) => act(() => { usePrivacyStore.setState({ enabled }); });

describe.each(SURFACES)("10A-ASTRA-003 final: %s", (surface) => {
  it("A. opened while Privacy Mode is on: closes itself, parent state clears, nothing private rendered", () => {
    setPrivacy(true);
    render(<Harness surface={surface} />);
    fireEvent.click(screen.getByRole("button", { name: "Open review" }));
    expect(openState()).toBe("false");
    expectNoPrivateContent();
  });

  it("B-D. enabling Privacy Mode closes it; disabling leaves it closed; an explicit reopen shows the review", () => {
    render(<Harness surface={surface} />);
    fireEvent.click(screen.getByRole("button", { name: "Open review" }));
    expect(openState()).toBe("true");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.body.textContent).toContain(HISTORIC); // control: private review is real

    // B. Privacy Mode on while open.
    setPrivacy(true);
    expect(openState()).toBe("false");
    expectNoPrivateContent();

    // C. Privacy Mode off afterwards: nothing reappears on its own.
    setPrivacy(false);
    expect(openState()).toBe("false");
    expectNoPrivateContent();

    // D. An explicit fresh open works normally.
    fireEvent.click(screen.getByRole("button", { name: "Open review" }));
    expect(openState()).toBe("true");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(HISTORIC)).length).toBeGreaterThan(0);
  });

  it("the regression sequence: reopened while private, then privacy disabled -- never becomes private by itself", () => {
    render(<Harness surface={surface} />);
    fireEvent.click(screen.getByRole("button", { name: "Open review" }));
    setPrivacy(true);
    fireEvent.click(screen.getByRole("button", { name: "Open review" })); // reopen attempt while private
    expect(openState()).toBe("false");
    setPrivacy(false);
    expect(openState()).toBe("false");
    expectNoPrivateContent();
  });

  it("even if a caller ignores onClose, the mounted dialog stays suppressed after Privacy Mode ends", () => {
    const ignore = vi.fn();
    render(surface === "Day Resolution" ? <DayResolutionPanel onClose={ignore} />
      : surface === "Dusk Review" ? <DuskReview onClose={ignore} onRecord={() => {}} onContinue={() => {}} />
      : <LifeEventsPanel onClose={ignore} />);
    expect(document.body.textContent).toContain(HISTORIC);
    setPrivacy(true);
    expect(ignore).toHaveBeenCalledOnce();
    setPrivacy(false);
    expectNoPrivateContent();
  });
});

describe("10A-ASTRA-003 final: GameScreen", () => {
  it("Day -> Night waits for Privacy Mode to end, then the dusk review opens only on an explicit click", () => {
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "→ Night" }));
    expect(screen.getByText(`${HISTORIC} — executed — died`)).toBeInTheDocument();
    setPrivacy(true);
    expectNoPrivateContent();
    expect(screen.getByRole("button", { name: "→ Night" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "→ Night" }));
    setPrivacy(false);
    expectNoPrivateContent();
    fireEvent.click(screen.getByRole("button", { name: "→ Night" }));
    expect(screen.getByText(`${HISTORIC} — executed — died`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to Night 2" })).toBeInTheDocument();
  });
});
