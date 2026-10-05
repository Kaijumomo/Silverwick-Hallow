// Phase 10H, Slice 3: the Storyteller Grimoire seat system (contract §§6, 8.1).
// Traceability: 10H-AC-009, -010, -015, -016 (seat side), -017 (seat side),
// -021, -022, -023, -024.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GrimoireCircle } from "./GrimoireCircle";
import { MAX_TABLE_ASPECT, pickDensityTier, placeTable, seatShapes, tableStage, tierFits, tierSpec, TIER_SPECS, type DensityTier } from "./densityTiers";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { buildRegistry } from "@/data/roleRegistry";
import { setupGame, setupScript } from "@/test/setupFixtures";
import type { StorytellerLobbyRecord, STPlayerRecord } from "@/stores/types";

const state = () => store.getState();
const game = () => state().game!;
const registry = buildRegistry(setupScript);
const ROLES = ["chef", "imp", "empath", "monk", "poisoner", "saint", "washerwoman"];
const NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Finn", "Gail"];
const ORDER: DensityTier[] = ["L", "M", "M2", "S", "XS"];
const rank = (tier: DensityTier) => ORDER.indexOf(tier);

/** A ResizeObserver that reports a fixed stage size, like a real layout pass. */
let stage = { width: 680, height: 680 };
class SizedObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() { this.callback([{ contentRect: { width: stage.width, height: stage.height } } as ResizeObserverEntry], this as never); }
  disconnect() {}
  unobserve() {}
}

function liveGame(over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase: "night", day: 1, setupRolesDealt: true, setupRolesRevealed: true, ...over });
  for (const [index, p] of Object.values(g.players).entries()) { p.actualAlignment = registry.alignmentOf(p.actualRole); p.name = NAMES[index]!; }
  return g;
}
const patch = (id: string, value: Partial<STPlayerRecord>) =>
  store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...game().players[id]!, ...value } } } });
const token = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}, seat`) });
const description = (el: HTMLElement) => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

beforeEach(() => {
  stage = { width: 680, height: 680 };
  vi.stubGlobal("ResizeObserver", SizedObserver);
  usePrivacyStore.setState({ enabled: false });
  useShellStore.getState().reset();
  useTargetPicker.setState({ active: null, refused: null });
  store.setState({ game: liveGame(), lobby: null, undoStack: [], localSeq: 0, customScripts: { [setupScript.id]: setupScript }, selectedPlayerId: null, view: "game" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("10H-AC-009: the largest collision-free density tier", () => {
  const stages = [[300, 300], [375, 360], [375, 520], [480, 420], [640, 640], [720, 720], [900, 700], [1120, 690], [1300, 820]]
    .map(([w, h]) => tableStage(w!, h!));
  const counts = [1, 3, 5, 7, 9, 12, 15, 18, 20];

  it("every chosen tier passes the collision / same-seat overprint / in-stage checks, and the next larger tier would not", () => {
    for (const stage of stages) for (const n of counts) {
      const tier = pickDensityTier(stage, n);
      if (tier !== "XS") expect(tierFits(stage, n, tierSpec(tier)), `${tier} @ ${stage.width}x${stage.height}/${n}`).toBe(true);
      const larger = ORDER[rank(tier) - 1];
      if (larger) expect(tierFits(stage, n, tierSpec(larger)), `${larger} would fit @ ${stage.width}x${stage.height}/${n}`).toBe(false);
    }
  });

  it("is monotonic: more seats never raise the tier; a stage larger in both directions never lowers it", () => {
    for (const stage of stages) for (let i = 1; i < counts.length; i++) {
      expect(rank(pickDensityTier(stage, counts[i]!))).toBeGreaterThanOrEqual(rank(pickDensityTier(stage, counts[i - 1]!)));
    }
    const nested = [[360, 360], [480, 480], [600, 600], [720, 720], [900, 760], [1300, 900]].map(([w, h]) => tableStage(w!, h!));
    for (const n of counts) for (let i = 1; i < nested.length; i++) {
      expect(rank(pickDensityTier(nested[i]!, n))).toBeLessThanOrEqual(rank(pickDensityTier(nested[i - 1]!, n)));
    }
  });

  it("RS-15 on a desktop stage keeps Table text; RS-20 on a phone falls to the last-resort disc (the Roster reads)", () => {
    expect(tierSpec(pickDensityTier(tableStage(1120, 690), 15)).text).toBe(true);
    expect(tierSpec(pickDensityTier(tableStage(720, 720), 15)).text).toBe(true);
    expect(pickDensityTier(tableStage(355, 420), 20)).toBe("XS");
    expect(pickDensityTier(tableStage(720, 720), 0)).toBe("L");
  });

  it("the Table is an oval on a wide stage (never wider than its aspect cap) and a circle on a square one", () => {
    const spec = tierSpec("M2");
    const wide = placeTable(tableStage(1400, 700), 15, spec);
    expect(wide.rx).toBeGreaterThan(wide.ry);
    expect(wide.rx).toBeLessThanOrEqual(wide.ry * MAX_TABLE_ASPECT + 1e-9);
    const square = placeTable(tableStage(700, 700), 15, tierSpec("S"));
    expect(Math.abs(square.rx - square.ry)).toBeLessThan(1e-9);
  });

  it("every seat target is at least 44px, and seat shapes stay inside the stage", () => {
    for (const spec of TIER_SPECS) expect(Math.min(spec.width, spec.height, spec.disc)).toBeGreaterThanOrEqual(44);
    const stage = tableStage(1120, 690);
    const spec = tierSpec(pickDensityTier(stage, 15));
    const table = placeTable(stage, 15, spec);
    for (let i = 0; i < 15; i++) for (const box of seatShapes(i, 15, spec, table)) {
      expect(Math.max(Math.abs(box.left), Math.abs(box.right))).toBeLessThanOrEqual(stage.width / 2);
      expect(Math.max(Math.abs(box.top), Math.abs(box.bottom))).toBeLessThanOrEqual(stage.height / 2);
    }
  });
});

describe("10H-AC-010 / AC-024: measured geometry, fixed footprints, no reflow leak", () => {
  it("the rendered tier comes from the measured stage and every seat has that tier's fixed footprint", () => {
    stage = { width: 420, height: 900 };
    const { container } = render(<GrimoireCircle />);
    const expected = pickDensityTier(tableStage(420, 900), 7);
    expect(container.querySelector(".grimoire")).toHaveAttribute("data-tier", expected);
    const spec = tierSpec(expected);
    for (const seat of container.querySelectorAll<HTMLElement>(".grimoire .token")) {
      expect(seat).toHaveAttribute("data-tier", expected);
      expect(seat.style.width).toBe(`${spec.width}px`);
      expect(seat.style.height).toBe(`${spec.height}px`);
    }
  });

  it("renders without any synchronous layout read (no offset*/getBoundingClientRect during render)", () => {
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const offsetWidth = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get");
    const offsetHeight = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get");
    const view = render(<GrimoireCircle />);
    act(() => { patch("p0", { reminders: [{ id: "r1", label: "Chosen", placedAt: { phase: "night", day: 1 } } as never] }); });
    view.rerender(<GrimoireCircle />);
    expect(rect).not.toHaveBeenCalled();
    expect(offsetWidth).not.toHaveBeenCalled();
    expect(offsetHeight).not.toHaveBeenCalled();
  });

  it("toggling Privacy Mode (and private content) never moves a seat", () => {
    patch("p0", { abilityUsed: true, reminders: [{ id: "r1", label: "Chosen", placedAt: { phase: "night", day: 1 } } as never] });
    patch("p1", { shownRole: "washerwoman" });
    const { container } = render(<GrimoireCircle />);
    const geometry = () => Array.from(container.querySelectorAll<HTMLElement>(".grimoire .token"))
      .map((el) => [el.style.left, el.style.top, el.style.width, el.style.height].join("|"));
    const before = geometry();
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(geometry()).toEqual(before);
    act(() => usePrivacyStore.getState().setEnabled(false));
    expect(geometry()).toEqual(before);
  });
});

describe("10H-AC-024: a private surface closing under Privacy Mode never moves a seat", () => {
  it("a stage resize while Privacy Mode is on is deferred until Privacy Mode ends", () => {
    let report: ((width: number, height: number) => void) | null = null;
    vi.stubGlobal("ResizeObserver", class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() { report = (width, height) => this.callback([{ contentRect: { width, height } } as ResizeObserverEntry], this as never); report(720, 720); }
      disconnect() {}
      unobserve() {}
    });
    const { container } = render(<GrimoireCircle />);
    const geometry = () => Array.from(container.querySelectorAll<HTMLElement>(".grimoire .token")).map((el) => [el.style.left, el.style.top, el.dataset.tier].join("|"));
    const before = geometry();
    act(() => usePrivacyStore.getState().setEnabled(true));
    // e.g. the action card's column or the Inspector unmounts: the stage widens.
    act(() => report!(1200, 720));
    expect(geometry()).toEqual(before);
    act(() => usePrivacyStore.getState().setEnabled(false));
    expect(geometry()).not.toEqual(before); // the real size applies once Privacy Mode ends
  });
});

describe("10H-AC-021 / AC-022 / AC-023: Shown primary, Actual explicit, Privacy absent", () => {
  beforeEach(() => patch("p0", { shownRole: "washerwoman" })); // actually the Chef

  it("the Table shows the Shown Role, marks Actual≠Shown in words, and describes both separately", () => {
    render(<GrimoireCircle />);
    const alice = token("Alice");
    expect(alice.querySelector(".token-role")).toHaveTextContent("Washerwoman");
    expect(alice.querySelector("[data-divergence]")).toHaveTextContent("≠ Actual");
    expect(description(alice)).toBe("Shown role: Washerwoman. Actual role: Chef (differs from shown)");
    // An undiverged seat says both without a divergence marker.
    const bob = token("Bob");
    expect(bob.querySelector("[data-divergence]")).toBeNull();
    expect(description(bob)).toBe("Shown role: Imp. Actual role: Imp");
    // Presentation only: nothing about the participant changed.
    expect(game().players.p0).toMatchObject({ actualRole: "chef", shownRole: "washerwoman" });
  });

  it("under Privacy Mode no divergence marker, no role name and no role description is in the DOM", () => {
    usePrivacyStore.setState({ enabled: true });
    const { container } = render(<GrimoireCircle />);
    expect(container.querySelector("[data-divergence]")).toBeNull();
    expect(container.innerHTML).not.toMatch(/Washerwoman|Chef|Actual|Shown role/);
    expect(token("Alice")).not.toHaveAttribute("aria-describedby");
  });
});

describe("10H-AC-015 / AC-016: the lit Night actor", () => {
  const light = (id: string) => useShellStore.getState().setLitActor({ playerId: id, participantId: game().players[id]!.participantId!, stepKey: `${id}:step` });

  it("the actor's seat is lit with the words 'Acting now', distinct from selection", () => {
    light("p1");
    store.setState({ selectedPlayerId: "p2" });
    render(<GrimoireCircle />);
    const bob = token("Bob");
    expect(bob).toHaveClass("acting");
    expect(bob).not.toHaveClass("selected");
    expect(bob).toHaveTextContent("Acting now");
    expect(description(bob)).toMatch(/Acting now/);
    const carol = token("Carol");
    expect(carol).toHaveClass("selected");
    expect(carol).not.toHaveClass("acting");
    expect(document.querySelectorAll(".token.acting")).toHaveLength(1);
  });

  it("tapping the acting seat opens/resumes the action; inspecting another participant never changes the actor", () => {
    light("p1");
    render(<GrimoireCircle />);
    fireEvent.click(token("Bob"));
    expect(useShellStore.getState()).toMatchObject({ actionOpen: true, actionRequest: 1 });
    expect(state().selectedPlayerId).toBeNull();
    fireEvent.click(token("Dave"));
    expect(state().selectedPlayerId).toBe("p3");
    expect(useShellStore.getState().litActor?.playerId).toBe("p1");
    expect(token("Bob")).toHaveClass("acting");
  });

  it("is absent at Day, under Privacy Mode, and once the participation instance left the seat", () => {
    light("p1");
    const view = render(<GrimoireCircle />);
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(document.querySelector(".token.acting")).toBeNull();
    expect(document.body).not.toHaveTextContent("Acting now");
    act(() => usePrivacyStore.getState().setEnabled(false));
    expect(document.querySelector(".token.acting")).not.toBeNull();
    act(() => patch("p1", { participantId: "someone-else" }));
    expect(document.querySelector(".token.acting")).toBeNull();
    act(() => store.setState({ game: { ...game(), phase: "day" } }));
    view.rerender(<GrimoireCircle />);
    expect(document.querySelector(".token.acting")).toBeNull();
  });
});

describe("10H-AC-017 (Table side): seats render the shared eligibility of an active pick", () => {
  it("eligible seats are framed, ineligible seats dimmed and described; a refused tap picks nothing", () => {
    const onPick = vi.fn();
    const eligible = new Set([game().players.p2!.participantId!, game().players.p3!.participantId!]);
    render(<GrimoireCircle />);
    act(() => useTargetPicker.getState().start("the target", onPick, { eligible }));
    expect(token("Carol")).toHaveClass("pickable");
    expect(description(token("Carol"))).toMatch(/Eligible target/);
    expect(token("Alice")).toHaveClass("unpickable");
    expect(description(token("Alice"))).toMatch(/Not an eligible target/);
    fireEvent.click(token("Alice"));
    expect(onPick).not.toHaveBeenCalled();
    expect(useTargetPicker.getState().refused).toMatch(/Alice can't be chosen for the target/);
    fireEvent.click(token("Dave"));
    expect(onPick).toHaveBeenCalledWith({ playerId: "p3", participantId: game().players.p3!.participantId });
    expect(state().selectedPlayerId).toBeNull();
  });
});
