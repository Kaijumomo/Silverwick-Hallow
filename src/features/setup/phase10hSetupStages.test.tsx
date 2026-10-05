// Phase 10H, Slice 5: the frozen staged Setup inside the Grimoire-centred
// Setup workspace (contract §10, S2). Traceability: 10H-AC-025, -026, -027,
// -036, -037.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupPanel } from "./SetupPanel";
import { setupStageOf } from "./SetupStages";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";

const state = () => store.getState();
const game = () => state().game!;
const stages = () => within(screen.getByRole("list", { name: "Setup stages" }));
const current = () => stages().getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "step")!;

function Panel() {
  const g = store((s) => s.game)!;
  return <SetupPanel game={g} script={setupScript} onClose={() => {}} />;
}
function prepare(roles = standardRoles(5)) {
  const g = setupGame(roles, { rolePool: roles });
  Object.values(g.players).forEach((p) => { p.actualRole = ""; p.shownRole = null; });
  store.setState({ game: g, lobby: null });
}
beforeEach(() => {
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ revealAcks: {} });
  store.setState({ game: null, lobby: null, undoStack: [], customScripts: { [setupScript.id]: setupScript }, selectedPlayerId: null });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("10H-AC-025: the five frozen stages, inside the Setup workspace (no takeover pages)", () => {
  it("maps the existing Setup sequence onto Town -> Bag & Deal -> Preparation -> Private Reveal -> Begin Night", () => {
    expect(setupStageOf("count", false)).toBe("town");
    expect(setupStageOf("seats", false)).toBe("town");
    expect(["roles", "review", "deal"].map((n) => setupStageOf(n, false))).toEqual(["bag", "bag", "bag"]);
    expect(setupStageOf("reveal", false)).toBe("prepare");
    expect(setupStageOf("begin", true)).toBe("reveal");
  });

  it("walks the stages as the real sequence advances; the deal stays randomized (no manual initial assignment)", () => {
    prepare();
    render(<Panel />);
    expect(stages().getAllByRole("listitem").map((li) => li.textContent?.replace(/\s*\(done\)/, ""))).toEqual(
      ["✓Town", "2Bag & Deal", "3Preparation", "4Private Reveal", "5Begin Night"]);
    expect(current()).toHaveTextContent("Bag & Deal");
    expect(screen.queryByText(/Manual assignment/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Deal roles" }));
    expect(current()).toHaveTextContent("Preparation");
    // Not a page: the panel is a complementary region beside the Grimoire.
    expect(screen.getByRole("complementary", { name: "Setup helper" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("10H-AC-027: Preparation rows send the Storyteller to the Table, never a dropdown", () => {
  it("a participant still needing a shown role is a row whose Open selects them on the Table", () => {
    const roles = ["washerwoman", "chef", "drunk", "poisoner", "imp"];
    store.setState({ game: setupGame(roles, { setupRolesDealt: true, setupRolesRevealed: false }) });
    const drunk = Object.values(game().players).find((p) => p.actualRole === "drunk")!;
    store.setState({ game: { ...game(), players: { ...game().players, [drunk.id]: { ...drunk, shownRole: null, shownAlignment: null } } } });
    render(<Panel />);
    expect(current()).toHaveTextContent("Preparation");
    const rows = within(screen.getByRole("list", { name: "Preparation" }));
    expect(rows.getByText("Needs a shown role")).toBeInTheDocument();
    fireEvent.click(rows.getByRole("button", { name: `Open ${drunk.name} on the Table` }));
    expect(state().selectedPlayerId).toBe(drunk.id);
    expect(document.querySelector("select")).toBeNull();
  });
});

describe("10H-AC-036 / AC-037: Private Reveal readiness is advisory current-token equality", () => {
  function revealedLive() {
    store.setState({ game: setupGame(standardRoles(5), { setupRolesDealt: true, setupRolesRevealed: true }),
      lobby: { code: "ABCD", uid: "st", sessionId: "s1", status: "live" } });
    // Fresh participations carry reveal tokens (v26).
    const players = Object.fromEntries(Object.entries(game().players).map(([id, p], i) => [id, { ...p, revealToken: `tok-${i}` }]));
    store.setState({ game: { ...game(), players } });
  }

  it("Viewed only when the acknowledged token equals the CURRENT token; a stale one is not viewed", () => {
    revealedLive();
    const [a, b, c] = game().seatOrder;
    act(() => useSessionRuntime.setState({ revealAcks: { [a!]: "tok-0", [b!]: "stale-token", [c!]: "tok-2" } }));
    render(<Panel />);
    expect(current()).toHaveTextContent("Private Reveal");
    const reveal = within(screen.getByRole("region", { name: "Private reveal" }));
    expect(reveal.getByText(/of 5 have seen their role/)).toHaveTextContent("2 of 5 have seen their role");
    const row = (id: string) => document.querySelector(`.reveal-readiness-row:nth-child(${game().seatOrder.indexOf(id) + 1})`)!;
    expect(row(a!)).toHaveAttribute("data-viewed", "true");
    expect(row(b!)).toHaveAttribute("data-viewed", "false");
    expect(row(c!)).toHaveAttribute("data-viewed", "true");
  });

  it("never gates Begin Night: with NO acknowledgements Begin Night 1 is enabled and works; acks never touch the game", () => {
    revealedLive();
    const before = game();
    render(<Panel />);
    expect(screen.getByRole("region", { name: "Private reveal" })).toHaveTextContent("0 of 5 have seen their role");
    expect(screen.getByText(/Advisory only/)).toBeInTheDocument();
    act(() => useSessionRuntime.setState({ revealAcks: { [game().seatOrder[0]!]: "tok-0" } }));
    expect(game()).toBe(before); // an acknowledgement is runtime state only
    const begin = screen.getByRole("button", { name: "Begin Night 1" });
    expect(begin).toBeEnabled();
    fireEvent.click(begin);
    expect(game()).toMatchObject({ phase: "night", day: 1 });
  });

  it("offline (no phones) explains that roles are revealed in person", () => {
    store.setState({ game: setupGame(standardRoles(5), { setupRolesDealt: true, setupRolesRevealed: true }), lobby: null });
    render(<Panel />);
    expect(screen.getByText(/reveal roles in person/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Begin Night 1" })).toBeEnabled();
  });
});
