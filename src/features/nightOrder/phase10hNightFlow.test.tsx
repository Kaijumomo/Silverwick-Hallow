// Phase 10H, Slice 4: the Night actor model and the floating modular action
// card (contract §§8.1-8.6, 9; I2, I3). Rules-neutral fixture semantics.
// Traceability: 10H-AC-015, -016, -017, -018, -019, -020, -063 (unit side).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NightOrderPanel } from "./NightOrderPanel";
import { GrimoireCircle } from "@/features/grimoire/GrimoireCircle";
import { RosterView } from "@/features/grimoire/RosterView";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { canonicalRoles } from "@/data/canonical";
import { buildRegistry } from "@/data/roleRegistry";
import { makeSTPlayer } from "@/test/fixtures";
import { FIXTURE_SEMANTICS } from "@/test/abilityFixtures";
import { choose, chosen, offered } from "@/test/pickers";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";

const script: Script = { id: "night-flow", name: "Night flow", characters: canonicalRoles(["monk", "imp", "empath", "drunk", "chef", "washerwoman", "poisoner"]) };
const registry = buildRegistry(script);
const state = () => store.getState();
const game = () => state().game!;
const NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Finn", "Gail"];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
  useTargetPicker.setState({ active: null, refused: null });
  useShellStore.getState().reset();
  const roles = ["monk", "imp", "empath", "drunk", "chef", "washerwoman", "poisoner"];
  const players = roles.map((actualRole, seat) => makeSTPlayer({ id: `p${seat}`, name: NAMES[seat]!, seat,
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

function Shell() {
  const current = store((s) => s.game)!;
  const privacy = usePrivacyStore((s) => s.enabled);
  return <>
    {current.phase === "night" && <NightOrderPanel game={current} script={script} onClose={() => {}} semantics={FIXTURE_SEMANTICS} />}
    <GrimoireCircle />
    {!privacy && <RosterView />}
  </>;
}
const seat = (name: string) => within(document.querySelector<HTMLElement>(".grimoire")!).getByRole("button", { name: new RegExp(`^${name}, seat`) });
const stepCard = (role: string, player: string) =>
  screen.getAllByText(role, { selector: ".step-role-name" }).map((el) => el.closest(".step-card") as HTMLElement)
    .find((el) => el.querySelector(".step-player-name")?.textContent?.startsWith(`${player} ·`))!;
const currentCard = () => document.querySelector<HTMLElement>('.step-card[aria-current="step"]');
const actionCard = () => screen.queryByRole("dialog");
/** Moves the Night cursor to the Monk (Alice) -- a guided simple step. */
function goToMonk() {
  const monk = stepCard("Monk", "Alice");
  if (monk.getAttribute("aria-current") !== "step") fireEvent.click(within(monk).getByRole("button", { name: "Make Monk the current step" }));
}

describe("10H-AC-015 / AC-016: the current step owns the action context", () => {
  it("exactly one rail step is current; its actor is the lit seat", () => {
    render(<Shell />);
    expect(document.querySelectorAll('.step-card[aria-current="step"]')).toHaveLength(1);
    goToMonk();
    expect(currentCard()).toBe(stepCard("Monk", "Alice"));
    expect(within(currentCard()!).getByText("Now")).toBeInTheDocument();
    expect(useShellStore.getState().litActor).toMatchObject({ playerId: "p0", participantId: game().players.p0!.participantId });
    expect(seat("Alice")).toHaveClass("acting");
    expect(document.querySelectorAll(".grimoire .token.acting")).toHaveLength(1);
  });

  it("tapping the acting seat opens the action card -- a NON-MODAL dialog that never inerts the Table", () => {
    render(<Shell />);
    goToMonk();
    fireEvent.click(seat("Alice"));
    const card = actionCard()!;
    expect(card).toHaveAttribute("aria-modal", "false");
    expect(within(card).getByRole("heading", { name: /^Monk/ })).toHaveFocus();
    expect(within(card).getByText("Alice · seat 1")).toBeInTheDocument();
    // The Table stays operable: nothing is inert, the page is not locked.
    expect(document.querySelector("[inert]")).toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(state().selectedPlayerId).toBeNull();
  });

  it("Hide keeps the draft; tapping the acting seat RESUMES it; inspecting someone else never changes the actor", () => {
    render(<Shell />);
    goToMonk();
    fireEvent.click(seat("Alice"));
    choose("the player to mark", "p2", actionCard()!);
    fireEvent.click(within(actionCard()!).getByRole("button", { name: /Hide the action card/ }));
    expect(actionCard()).toBeNull();
    // Inspect another participant: the actor stays Alice.
    fireEvent.click(seat("Dave"));
    expect(state().selectedPlayerId).toBe("p3");
    expect(useShellStore.getState().litActor?.playerId).toBe("p0");
    expect(seat("Alice")).toHaveClass("acting");
    // Resume: the same choice is still there.
    fireEvent.click(seat("Alice"));
    expect(chosen("the player to mark", actionCard()!)).toBe("p2");
  });

  it("Close discards the draft; the next tap opens a fresh card", () => {
    render(<Shell />);
    goToMonk();
    fireEvent.click(seat("Alice"));
    choose("the player to mark", "p2", actionCard()!);
    fireEvent.click(within(actionCard()!).getByRole("button", { name: "Close" }));
    fireEvent.click(seat("Alice"));
    expect(chosen("the player to mark", actionCard()!)).toBe("");
  });

  it("resolving records ONE commit, closes the card, and the next unresolved step becomes current", () => {
    render(<Shell />);
    goToMonk();
    fireEvent.click(seat("Alice"));
    choose("the player to mark", "p2", actionCard()!);
    const seq = state().localSeq;
    fireEvent.click(within(actionCard()!).getByRole("button", { name: /^(Resolve|Confirm and record)$/ }));
    expect(state().localSeq).toBe(seq + 1);
    expect(actionCard()).toBeNull();
    expect(stepCard("Monk", "Alice")).toHaveAttribute("data-status", "done");
    expect(currentCard()).not.toBe(stepCard("Monk", "Alice"));
    expect(seat("Alice")).not.toHaveClass("acting");
  });
});

describe("10H-AC-017: Table and Roster targeting share ONE eligibility", () => {
  it("the card's Roster strip, the Table seats and the Roster rows offer exactly the same eligible participants", () => {
    render(<Shell />);
    goToMonk();
    fireEvent.click(seat("Alice"));
    const card = actionCard()!;
    const strip = offered("the player to mark", card).filter((o) => !o.disabled).map((o) => o.value).sort();
    fireEvent.click(within(card).getByRole("button", { name: "Choose the player to mark on the Table" }));
    const tableEligible = Array.from(document.querySelectorAll<HTMLElement>(".grimoire .token.pickable")).map((el) => el.dataset.playerId!).sort();
    const rosterEligible = Array.from(document.querySelectorAll<HTMLElement>(".roster-row:not(.unpickable) .roster-button")).map((el) => el.dataset.playerId!).sort();
    expect(tableEligible).toEqual(strip);
    expect(rosterEligible).toEqual(strip);
    // A Roster pick binds the participant exactly like a Table tap.
    const target = strip[0]!;
    fireEvent.click(document.querySelector<HTMLElement>(`.roster-button[data-player-id="${target}"]`)!);
    expect(chosen("the player to mark", actionCard()!)).toBe(target);
    expect(state().selectedPlayerId).toBeNull();
  });
});

describe("10H-AC-019: a stale workspace never records; Refresh re-derives", () => {
  it("a reseated actor makes the card stale (nothing recordable); Refresh starts a fresh workflow with no stale input", () => {
    render(<Shell />);
    goToMonk();
    fireEvent.click(seat("Alice"));
    choose("the player to mark", "p2", actionCard()!);
    const before = game();
    act(() => {
      const g = game();
      store.setState({ game: { ...g, players: { ...g.players, p0: { ...g.players.p0!, participantId: "replacement" } } } });
    });
    const card = actionCard()!;
    expect(within(card).getByRole("alert")).toHaveTextContent(/out of date/);
    expect(within(card).queryByRole("button", { name: /^(Resolve|Confirm and record)$/ })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Refresh from the current game" }));
    // A fresh fingerprint: no stale message, and the old choice was NOT carried forward.
    expect(within(actionCard()!).queryByText(/out of date/)).toBeNull();
    expect(chosen("the player to mark", actionCard()!)).toBe("");
    expect(game().players.p2!.effects).toEqual(before.players.p2!.effects);
  });
});

describe("10H-AC-020 / AC-023: Day has no Night rail; Privacy Mode removes the action surfaces", () => {
  it("at Day there is no current step, no lit seat and no card", () => {
    render(<Shell />);
    goToMonk();
    fireEvent.click(seat("Alice"));
    act(() => { store.setState({ game: { ...game(), phase: "day" } }); });
    expect(screen.queryByRole("complementary", { name: /Night 2 order/ })).toBeNull();
    expect(useShellStore.getState().litActor).toBeNull();
    expect(actionCard()).toBeNull();
    expect(document.querySelector(".token.acting")).toBeNull();
  });

  it("Privacy Mode unmounts the card and its draft, and removes the lit seat", () => {
    render(<Shell />);
    goToMonk();
    fireEvent.click(seat("Alice"));
    choose("the player to mark", "p2", actionCard()!);
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(actionCard()).toBeNull();
    expect(document.querySelector(".token.acting")).toBeNull();
    expect(document.body).not.toHaveTextContent(/Monk|the player to mark/);
    act(() => usePrivacyStore.getState().setEnabled(false));
    // Nothing private reopens by itself; the draft is gone.
    expect(actionCard()).toBeNull();
    goToMonk();
    fireEvent.click(seat("Alice"));
    expect(chosen("the player to mark", actionCard()!)).toBe("");
  });
});

describe("10H-AC-063 (unit side): the Night step is keyboard-completable", () => {
  it("Enter on the lit seat opens the card; every control in the flow is a focusable native button; Escape hides and returns focus", () => {
    render(<Shell />);
    goToMonk();
    const alice = seat("Alice");
    alice.focus();
    fireEvent.keyDown(alice, { key: "Enter" });
    const card = actionCard()!;
    expect(card).toContainElement(document.activeElement as HTMLElement);
    const controls = within(card).getAllByRole("button");
    expect(controls.every((b) => b.tagName === "BUTTON" && b.tabIndex >= 0)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(actionCard()).toBeNull();
    expect(alice).toHaveFocus();
  });
});

describe("ASTRA-10H-006: changing the current Night step invalidates the old action workspace", () => {
  it("Monk/Alice current -> open -> target -> make Imp/Bob current: the Monk workspace is gone and Bob is the sole actor", () => {
    render(<Shell />);
    goToMonk();
    fireEvent.click(seat("Alice"));
    choose("the player to mark", "p2", actionCard()!);
    expect(within(actionCard()!).getByRole("button", { name: /^(Resolve|Confirm and record)$/ })).toBeEnabled();
    const seq = state().localSeq;
    // The Storyteller moves the current step to the Imp (Bob).
    const imp = stepCard("Imp", "Bob");
    fireEvent.click(within(imp).getByRole("button", { name: "Make Imp the current step" }));
    // The Monk workspace is no longer visible or actionable: no card, no Resolve.
    expect(actionCard()).toBeNull();
    expect(document.querySelector(".action-card")).toBeNull(); // no Monk Resolve anywhere
    expect(useShellStore.getState().actionOpen).toBe(false);
    expect(state().localSeq).toBe(seq); // nothing was recorded
    // Bob is the sole current actor.
    expect(currentCard()).toBe(stepCard("Imp", "Bob"));
    expect(useShellStore.getState().litActor?.playerId).toBe("p1");
    expect(seat("Bob")).toHaveClass("acting");
    expect(document.querySelectorAll(".grimoire .token.acting")).toHaveLength(1);
    // Tapping the lit seat opens the IMP's card -- the Monk's choices do not transfer.
    fireEvent.click(seat("Bob"));
    expect(within(actionCard()!).getByRole("heading", { name: /^Imp/ })).toBeInTheDocument();
  });

  it("returning to the old step goes through a newly validated workspace (the old draft is gone)", () => {
    render(<Shell />);
    goToMonk();
    fireEvent.click(seat("Alice"));
    choose("the player to mark", "p2", actionCard()!);
    fireEvent.click(within(stepCard("Imp", "Bob")).getByRole("button", { name: "Make Imp the current step" }));
    goToMonk();
    expect(actionCard()).toBeNull();
    fireEvent.click(seat("Alice"));
    expect(chosen("the player to mark", actionCard()!)).toBe("");
  });

  it("merely inspecting another participant keeps the current step's workspace actionable", () => {
    render(<Shell />);
    goToMonk();
    fireEvent.click(seat("Alice"));
    choose("the player to mark", "p2", actionCard()!);
    fireEvent.click(seat("Dave"));
    expect(state().selectedPlayerId).toBe("p3");
    expect(useShellStore.getState().litActor?.playerId).toBe("p0");
    expect(within(actionCard()!).getByRole("button", { name: /^(Resolve|Confirm and record)$/ })).toBeEnabled();
    expect(chosen("the player to mark", actionCard()!)).toBe("p2");
  });
});
