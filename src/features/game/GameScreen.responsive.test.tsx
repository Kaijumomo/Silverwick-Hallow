import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameScreen } from "./GameScreen";
import { useStorytellerStore as storyteller } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { choose, chosen } from "@/test/pickers";
import { useShellStore } from "@/stores/shellStore";

let narrow = false;
const mediaListeners = new Set<() => void>();
const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = [];

function setNarrow(value: boolean) {
  act(() => {
    narrow = value;
    mediaListeners.forEach(listener => listener());
  });
}

function resizeStage(stage: Element, width: number, height: number) {
  const observer = observers.find(item => item.targets.has(stage));
  expect(observer, "the available stage is observed independently of the canvas").toBeDefined();
  act(() => observer!.callback([
    { target: stage, contentRect: { width, height } } as ResizeObserverEntry,
  ], {} as ResizeObserver));
}

beforeEach(() => {
  narrow = false;
  mediaListeners.clear();
  observers.length = 0;
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    media: query,
    get matches() { return narrow; },
    addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
  })));
  vi.stubGlobal("ResizeObserver", class {
    targets = new Set<Element>();
    constructor(public callback: ResizeObserverCallback) { observers.push(this); }
    observe(target: Element) { this.targets.add(target); }
    disconnect() { this.targets.clear(); }
  });
  usePrivacyStore.setState({ enabled: false });
  storyteller.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, grimoireMode: "ring" });
  storyteller.getState().newGame("tb", { plannedPlayerCount: 5 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("responsive Storyteller workspace", () => {
  it("recalculates from stage width and height and caps large workspaces", () => {
    const view = render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "setup" })); // deliberately open Setup
    const stage = view.container.querySelector(".grimoire-stage")!;
    const canvas = view.container.querySelector(".grimoire")!;
    // Phase 10H (§§5.1, 6.1): the Table is an oval fitted to the measured
    // stage rectangle (tableStage) instead of a height-bound circle -- still
    // recalculated from both dimensions and still capped on large workspaces.
    resizeStage(stage, 1040, 540);
    expect(canvas).toHaveStyle({ width: "1040px", height: "540px" });
    resizeStage(stage, 472, 980);
    expect(canvas).toHaveStyle({ width: "472px", height: "900px" });
    fireEvent.click(screen.getByRole("button", { name: "Close setup panel" }));
    resizeStage(stage, 1800, 1200);
    expect(canvas).toHaveStyle({ width: "1735px", height: "900px" });
  });

  it("preserves the practical diameter as seat count changes from 5 through 15", () => {
    const view = render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "setup" })); // deliberately open Setup
    const stage = view.container.querySelector(".grimoire-stage")!;
    const canvas = view.container.querySelector(".grimoire")!;
    resizeStage(stage, 1000, 650);
    for (const count of [5, 7, 12, 15]) {
      act(() => {
        while (storyteller.getState().game!.seatOrder.length < count) storyteller.getState().addEmptySeat();
      });
      expect(view.container.querySelectorAll(".token.empty-seat")).toHaveLength(count);
      expect(canvas).toHaveStyle({ width: "1000px", height: "650px" });
    }
  });

  // Phase 10H (contract §10, S2; 10H-AC-025) amends the 10G mobile Setup
  // foreground: Setup is a Grimoire-centred stage workspace -- on a phone the
  // ONE bottom workspace beside the Table -- never a modal takeover page.
  it("Phase 10H: mobile Setup is the non-modal bottom workspace; the Table stays operable", () => {
    narrow = true;
    const view = render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "setup" })); // deliberately open Setup
    const panel = screen.getByRole("complementary", { name: "Setup helper" });
    const seat = view.container.querySelector<HTMLElement>(".token.empty-seat")!;
    expect(screen.queryByRole("dialog", { name: "Setup" })).toBeNull();
    expect(view.container.querySelector(".game-body")).toContainElement(panel);
    expect(seat.closest("[inert]")).toBeNull();
    expect(view.container.querySelector(".phase-bar")).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).not.toBe("hidden");
    act(() => seat.focus());
    expect(seat).toHaveFocus();
  });

  it("closes mobile Setup and returns focus to More actions", () => {
    narrow = true;
    const view = render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "setup" })); // deliberately open Setup
    fireEvent.click(screen.getByRole("button", { name: "Close setup panel" }));
    expect(screen.queryByRole("complementary", { name: "Setup helper" })).not.toBeInTheDocument();
    expect(view.container.querySelector(".grimoire-wrap")!.closest("[inert]")).toBeNull();
    expect(screen.getByRole("button", { name: "More actions" })).toHaveFocus();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("Phase 10H: an open Setup stays the same non-modal workspace across a desktop / phone resize", () => {
    const view = render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "setup" })); // deliberately open Setup
    expect(screen.getByRole("complementary", { name: "Setup helper" })).toBeInTheDocument();
    setNarrow(true);
    expect(screen.getByRole("complementary", { name: "Setup helper" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Setup" })).not.toBeInTheDocument();
    expect(view.container.querySelector(".grimoire-wrap")!.closest("[inert]")).toBeNull();
    setNarrow(false);
    expect(screen.getByRole("complementary", { name: "Setup helper" })).toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("removes active Setup when privacy is enabled, and nothing is isolated", () => {
    narrow = true;
    const view = render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "setup" })); // deliberately open Setup
    const before = structuredClone(storyteller.getState().game);
    expect(screen.getByRole("complementary", { name: "Setup helper" })).toBeInTheDocument();
    act(() => usePrivacyStore.setState({ enabled: true }));
    expect(screen.queryByRole("complementary", { name: "Setup helper" })).not.toBeInTheDocument();
    expect(view.container.querySelector(".grimoire-wrap")!.closest("[inert]")).toBeNull();
    expect(storyteller.getState().game).toEqual(before);
    expect(document.body.style.overflow).not.toBe("hidden");
    act(() => usePrivacyStore.setState({ enabled: false }));
    expect(screen.getByRole("complementary", { name: "Setup helper" })).toBeInTheDocument();
  });
});

// Phase 10H pre-checkpoint (Forward rule; 10H-AC-067): on tablet and phone
// widths the compact command bar collapses SECONDARY actions into More
// actions, but the current phase-advance primary stays directly in the bar.
describe("Phase 10H: the phase-advance primary is never collapsed into the overflow", () => {
  function playing(phase: "night" | "day") {
    storyteller.setState({
      game: setupGame(standardRoles(5), { phase, day: 1, setupRolesDealt: true, setupRolesRevealed: true }),
      customScripts: { [setupScript.id]: setupScript },
    });
  }

  it.each([["night", "→ Day"], ["day", "→ Night"]] as const)("%s at compact width: %s sits in the bar, outside More actions", (phase, label) => {
    narrow = true;
    playing(phase);
    const view = render(<GameScreen />);
    const advance = screen.getByRole("button", { name: label });
    const bar = view.container.querySelector(".phase-bar")!;
    expect(advance).toHaveClass("phase-advance");
    expect(advance.parentElement).toHaveClass("phase-primary");
    expect(advance.parentElement!.parentElement).toBe(bar);
    expect(advance.closest(".phase-bar-right")).toBeNull();
    expect(screen.getByRole("button", { name: "More actions" })).toBeInTheDocument();
    expect(advance).toBeEnabled();
    expect(advance).not.toHaveAttribute("aria-describedby");
  });

  it("under Privacy Mode the advance stays visible, disabled, with an adjacent visible reason in words", () => {
    narrow = true;
    playing("night");
    usePrivacyStore.setState({ enabled: true });
    render(<GameScreen />);
    const advance = screen.getByRole("button", { name: "→ Day" });
    expect(advance).toBeDisabled();
    const reasonId = advance.getAttribute("aria-describedby")!;
    const reason = document.getElementById(reasonId)!;
    expect(reason).toHaveTextContent("Turn off Privacy Mode first");
    expect(reason.parentElement).toBe(advance.parentElement);
    // The visible words -- not the hover title -- are the accessible description.
    expect(advance).toHaveAccessibleDescription("Turn off Privacy Mode first");
    act(() => usePrivacyStore.setState({ enabled: false }));
    expect(advance).toBeEnabled();
    expect(document.getElementById(reasonId)).toBeNull();
  });
});

// ASTRA-10H-002 / ASTRA-10H-008: the ONE Night dock on tablet / phone. (The
// dock's visual layout -- card width, Night list stepping aside -- is proven
// in a real browser; jsdom has no :has(). These prove the state wiring.)
describe("ASTRA-10H-002 / 008: the docked Night workspace", () => {
  function night() {
    narrow = true;
    const g = setupGame(["monk", "imp", "empath", "chef", "washerwoman"], { phase: "night", day: 2, setupRolesDealt: true, setupRolesRevealed: true });
    storyteller.setState({ game: g, customScripts: { [setupScript.id]: setupScript } });
    return render(<GameScreen />);
  }
  const rail = (c: HTMLElement) => c.querySelector<HTMLElement>(".shell-rail")!;

  it("008: Close hides the docked Night panel; the reopen toggle and the Night tab restore it", () => {
    const view = night();
    expect(rail(view.container)).not.toHaveAttribute("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Close night panel" }));
    expect(rail(view.container)).toHaveAttribute("hidden");
    // The Table is still there to reclaim the space.
    expect(view.container.querySelector(".shell-stage")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "night order" }));
    expect(rail(view.container)).not.toHaveAttribute("hidden");
    // Closing again, then choosing the Night tab while a seat is inspected, reopens it too.
    fireEvent.click(screen.getByRole("button", { name: "Close night panel" }));
    act(() => storyteller.getState().selectPlayer(storyteller.getState().game!.seatOrder[3]!));
    fireEvent.click(screen.getByRole("tab", { name: "Night 2" }));
    expect(rail(view.container)).not.toHaveAttribute("hidden");
  });

  it("002: the action card is the dock's own content, with a Night-list control and a Resume that keeps the draft", () => {
    const view = night();
    const monk = view.container.querySelector<HTMLElement>(".grimoire .token.acting")!;
    expect(monk).toBeTruthy();
    fireEvent.click(monk);
    const card = screen.getByRole("dialog", { name: /^Monk/ });
    expect(card.parentElement).toHaveClass("action-card-dock-host");
    expect(card.closest(".shell-rail")).toBe(rail(view.container));
    fireEvent.click(within(card).getByRole("button", { name: "Back to the Night list (keeps your choices)" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume Monk action" }));
    expect(screen.getByRole("dialog", { name: /^Monk/ }).parentElement).toHaveClass("action-card-dock-host");
  });
});

// ASTRA-10H-005: Privacy removes the private action card (and the private
// rule facts) WITHOUT moving the Table -- their tracks are held by EMPTY,
// non-private placeholders. (The seat-rectangle equality itself is proven in
// a real browser; jsdom has no layout.)
describe("ASTRA-10H-005: Privacy holds the shell geometry with empty placeholders", () => {
  it("desktop: an open Night action's column and the rule facts' slot stay as empty structure; nothing private remains", () => {
    narrow = false;
    const g = setupGame(["monk", "imp", "empath", "chef", "washerwoman"], { phase: "night", day: 2, setupRolesDealt: true, setupRolesRevealed: true });
    storyteller.setState({ game: g, customScripts: { [setupScript.id]: setupScript } });
    const view = render(<GameScreen />);
    fireEvent.click(view.container.querySelector<HTMLElement>(".grimoire .token.acting")!);
    const card = screen.getByRole("dialog", { name: /^Monk/ });
    expect(card.parentElement).toHaveAttribute("id", "action-card-stage-host");
    // jsdom has no layout: give the rule facts a measurable height.
    const slot = view.container.querySelector<HTMLElement>(".rule-fact-slot")!;
    slot.getBoundingClientRect = () => ({ height: 57, width: 800, x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 57, toJSON: () => ({}) }) as DOMRect;
    act(() => usePrivacyStore.getState().setEnabled(true));
    const stage = view.container.querySelector<HTMLElement>(".shell-stage")!;
    expect(stage).toHaveAttribute("data-action-column", "privacy");
    const host = view.container.querySelector<HTMLElement>("#action-card-stage-host")!;
    expect(host.childElementCount).toBe(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(view.container.querySelector(".token.acting")).toBeNull();
    const placeholder = view.container.querySelector<HTMLElement>(".rule-fact-slot")!;
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    expect(placeholder.childElementCount).toBe(0);
    expect(placeholder.style.height).toBe("57px");
    expect(document.body).not.toHaveTextContent(/Monk|guided resolution|Game rule facts/i);
    // Privacy off: the placeholders go and nothing private reopens by itself.
    act(() => usePrivacyStore.getState().setEnabled(false));
    expect(stage).not.toHaveAttribute("data-action-column");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ASTRA-10H-009: tapping the lit / current Night actor opens OR RESUMES its
// action -- and on a docked layout that always brings the Night dock forward,
// even when the action was already open but the Storyteller hid the dock.
describe("ASTRA-10H-009: the actor tap reopens a hidden Night dock", () => {
  function night() {
    narrow = true;
    useShellStore.getState().reset();
    const g = setupGame(["monk", "imp", "empath", "chef", "washerwoman"], { phase: "night", day: 2, setupRolesDealt: true, setupRolesRevealed: true });
    storyteller.setState({ game: g, customScripts: { [setupScript.id]: setupScript } });
    return render(<GameScreen />);
  }
  const rail = (c: HTMLElement) => c.querySelector<HTMLElement>(".shell-rail")!;
  const actor = (c: HTMLElement) => c.querySelector<HTMLElement>(".grimoire .token.acting")!;
  const card = () => screen.queryByRole("dialog");
  const slotOf = (el: HTMLElement) => el.querySelector<HTMLElement>("[data-pick-slot]")!.dataset.pickSlot!;
  // The command-bar Night toggle: the control that hides the dock while an
  // action card is showing (the Night list's own Close is behind the card).
  const hideDock = () => fireEvent.click(screen.getByRole("button", { name: "hide order" }));

  it("A. open -> valid draft -> hide the dock -> tap the lit actor: the dock reopens with the SAME draft", () => {
    const view = night();
    fireEvent.click(actor(view.container));
    const slot = slotOf(card()!);
    const target = storyteller.getState().game!.seatOrder[2]!;
    choose(slot, target, card()!);
    hideDock();
    expect(rail(view.container)).toHaveAttribute("hidden");
    expect(useShellStore.getState().actionOpen).toBe(true); // still open, only the dock is hidden
    fireEvent.click(actor(view.container));
    expect(rail(view.container)).not.toHaveAttribute("hidden");
    expect(useShellStore.getState().dockTab).toBe("night");
    expect(card()).toHaveAccessibleName(/^Monk/);
    expect(chosen(slot, card()!)).toBe(target);
  });

  it("B. hide the dock -> inspect another participant: the Night dock stays hidden; the actor tap reopens it", () => {
    const view = night();
    fireEvent.click(actor(view.container));
    hideDock();
    const other = storyteller.getState().game!.seatOrder[3]!;
    fireEvent.click(view.container.querySelector<HTMLElement>(`.grimoire .token[data-player-id="${other}"]`) ?? screen.getAllByRole("button", { name: /^Player 3, seat/ })[0]!);
    expect(storyteller.getState().selectedPlayerId).toBe(other);
    expect(rail(view.container)).toHaveAttribute("hidden");
    fireEvent.click(actor(view.container));
    expect(rail(view.container)).not.toHaveAttribute("hidden");
    expect(useShellStore.getState().dockTab).toBe("night");
    expect(card()).toHaveAccessibleName(/^Monk/);
  });

  it("C. hide the dock -> the current step moves to a NEW actor -> tapping the new lit actor opens the NEW action, not the old draft", () => {
    const view = night();
    fireEvent.click(actor(view.container));
    choose(slotOf(card()!), storyteller.getState().game!.seatOrder[2]!, card()!);
    hideDock();
    // The legitimate current-step flow (the rail's "Go to this step") moves to the Imp.
    const imp = storyteller.getState().game!.seatOrder[1]!;
    const impStep = view.container.querySelector<HTMLElement>(`.step-card button[aria-label="Make Imp the current step"]`)!;
    fireEvent.click(impStep);
    expect(useShellStore.getState().litActor?.playerId).toBe(imp);
    expect(card()).toBeNull(); // the Monk workspace was invalidated (ASTRA-10H-006)
    fireEvent.click(actor(view.container));
    expect(rail(view.container)).not.toHaveAttribute("hidden");
    expect(card()).toHaveAccessibleName(/^Imp/);
    expect(screen.queryByRole("dialog", { name: /^Monk/ })).toBeNull();
  });

  it("D. hide -> actor tap -> reopen works repeatedly (no one-shot effect)", () => {
    const view = night();
    fireEvent.click(actor(view.container));
    const slot = slotOf(card()!);
    const target = storyteller.getState().game!.seatOrder[3]!;
    choose(slot, target, card()!);
    for (let round = 0; round < 3; round++) {
      hideDock();
      expect(rail(view.container)).toHaveAttribute("hidden");
      fireEvent.click(actor(view.container));
      expect(rail(view.container)).not.toHaveAttribute("hidden");
      expect(chosen(slot, card()!)).toBe(target);
    }
  });

  it("008 still holds with an action open: the command-bar toggle and the Night tab reopen; the actor tap is an ADDITIONAL path; Close still hides", () => {
    const view = night();
    fireEvent.click(actor(view.container));
    hideDock();
    expect(rail(view.container)).toHaveAttribute("hidden");
    fireEvent.click(screen.getByRole("button", { name: "night order" }));
    expect(rail(view.container)).not.toHaveAttribute("hidden");
    expect(card()).toHaveAccessibleName(/^Monk/);
    hideDock();
    act(() => storyteller.getState().selectPlayer(storyteller.getState().game!.seatOrder[3]!));
    expect(rail(view.container)).toHaveAttribute("hidden");
    fireEvent.click(screen.getByRole("tab", { name: "Night 2" }));
    expect(rail(view.container)).not.toHaveAttribute("hidden");
    expect(card()).toHaveAccessibleName(/^Monk/);
    hideDock();
    fireEvent.click(actor(view.container));
    expect(rail(view.container)).not.toHaveAttribute("hidden");
    expect(card()).toHaveAccessibleName(/^Monk/);
    // The Night list's explicit Close still hides the dock.
    fireEvent.click(within(card()!).getByRole("button", { name: "Back to the Night list (keeps your choices)" }));
    fireEvent.click(screen.getByRole("button", { name: "Close night panel" }));
    expect(rail(view.container)).toHaveAttribute("hidden");
  });
});
