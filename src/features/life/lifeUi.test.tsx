import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "@/stores/identity";
import { GrimoireCircle } from "@/features/grimoire/GrimoireCircle";
import { PlayerDrawer } from "@/features/players/PlayerDrawer";
import { PublicSeat } from "@/features/publicDisplay/PublicSeat";
import { projectLobbyToPublic } from "@/stores/projections";
import { DayResolutionPanel, DuskReview } from "./DayResolution";
import { LifeEventsPanel } from "./LifeEventsPanel";
import type { PlayerId } from "@/stores/types";

// Phase 10A: the visual life grammar, its textual/accessible equivalents,
// Privacy Mode, and the Day Resolution / correction workflows.

const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null,
    customScripts: { [setupScript.id]: setupScript } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function liveGame(): { ids: PlayerId[]; traveler: PlayerId } {
  state().newGame(setupScript.id, { plannedPlayerCount: 7 });
  ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"].forEach((n) => state().addPlayerToSeat(n));
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) {
    if (needsShownIdentity(player(id).actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  const ids = [...game().seatOrder];
  state().addPlayerToSeat("Tess");
  const traveler = game().seatOrder.at(-1)!;
  state().assignRole(traveler, "thief");
  return { ids, traveler };
}

/** Alice dead+vote used, Bob dead+vote, Tess exiled+vote used, Carol a
 * legacy anomaly (alive without her vote). */
function everyState() {
  const ctx = liveGame();
  const [alice, bob, carol] = ctx.ids as [PlayerId, PlayerId, PlayerId];
  state().recordDeath(alice);
  state().advancePhase();
  state().recordExecution(bob, "died");
  state().spendGhostVote(alice);
  state().recordExile(ctx.traveler, "died");
  state().spendGhostVote(ctx.traveler);
  store.setState({ game: { ...game(), players: { ...game().players, [carol]: { ...player(carol), ghostVote: false } } } });
  return { ...ctx, alice, bob, carol };
}

describe("Phase 10A: Grimoire life grammar", () => {
  it("every state has an accessible name, a textual label, and a non-color mark", () => {
    const { alice, bob, carol, traveler } = everyState();
    render(<GrimoireCircle />);
    const tokenFor = (name: RegExp) => screen.getByRole("button", { name });
    const aliceToken = tokenFor(/^Alice, seat 1, dead, vote used$/);
    expect(within(aliceToken).getByText("Dead · vote used")).toBeInTheDocument();
    expect(within(aliceToken).getByTestId("life-shroud")).toHaveTextContent("Dead");
    expect(within(aliceToken).getByTestId("vote-token")).toHaveClass("used");
    const bobToken = tokenFor(/^Bob, seat 2, dead, vote available$/);
    expect(within(bobToken).getByTestId("vote-token")).toHaveClass("available");
    expect(within(bobToken).getByText("Dead · vote available")).toBeInTheDocument();
    const tessToken = tokenFor(/^Tess, seat 8, exiled, vote used$/);
    expect(within(tessToken).getByTestId("life-shroud")).toHaveTextContent("Exiled");
    expect(within(tessToken).getByText("Exiled · vote used")).toBeInTheDocument();
    const carolToken = tokenFor(/^Carol, seat 3, alive, needs check$/);
    expect(within(carolToken).getByText("Needs check")).toBeInTheDocument();
    expect(within(carolToken).queryByTestId("life-shroud")).toBeNull();
    // Never the ambiguous "voted".
    expect(screen.queryByText(/voted/i)).toBeNull();
    void alice; void bob; void carol; void traveler;
  });

  it("Privacy Mode keeps life, vote token and exile visible, but hides the Storyteller-only Needs check", () => {
    everyState();
    usePrivacyStore.setState({ enabled: true });
    render(<GrimoireCircle />);
    expect(screen.getByRole("button", { name: /^Alice, seat 1, dead, vote used$/ })).toBeInTheDocument();
    expect(screen.getByText("Dead · vote used")).toBeInTheDocument();
    expect(screen.getByText("Exiled · vote used")).toBeInTheDocument();
    expect(screen.getAllByTestId("life-shroud")).toHaveLength(3);
    expect(screen.queryByText("Needs check")).toBeNull();
    expect(screen.getByRole("button", { name: /^Carol, seat 3, alive$/ })).toBeInTheDocument();
  });

  it("tokens are keyboard reachable: Enter opens the player", () => {
    const { alice } = everyState();
    render(<GrimoireCircle />);
    const token = screen.getByRole("button", { name: /^Alice, seat 1/ });
    expect(token).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(token, { key: "Enter" });
    expect(state().selectedPlayerId).toBe(alice);
  });
});

describe("Phase 10A: drawer life controls", () => {
  function Drawer({ id }: { id: PlayerId }) { const p = store((s) => s.game!.players[id]!); return <PlayerDrawer player={p} />; }

  it("has no one-click alive/dead toggle; labelled semantic actions record Life Events", () => {
    const { ids } = liveGame();
    render(<Drawer id={ids[0]!} />);
    expect(screen.queryByRole("button", { name: /^(Alive|Dead)$/ })).toBeNull();
    expect(document.querySelector('[aria-pressed][class*="toggle"]')?.textContent ?? "").not.toMatch(/^(Alive|Dead)$/);
    fireEvent.click(screen.getByRole("button", { name: "Record death" }));
    expect(player(ids[0]!)).toMatchObject({ alive: false, ghostVote: true });
    expect(game().lifeEventWindow.events).toMatchObject([{ kind: "death" }]);
    fireEvent.click(screen.getByRole("button", { name: "Mark vote used" }));
    expect(player(ids[0]!).ghostVote).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Restore vote" }));
    expect(player(ids[0]!).ghostVote).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Resurrect" }));
    expect(player(ids[0]!).alive).toBe(true);
  });

  it("status correction is explicit and offers the Exiled states whatever the participant's current Role (ASTRA-10D-C01)", () => {
    const { ids } = everyState();
    const carol = ids[2]!;
    expect(player(carol).isTraveler).toBe(false);
    render(<Drawer id={carol} />);
    expect(screen.getByText(/Alive without a vote token/)).toBeInTheDocument();
    const select = screen.getByLabelText("Correct to");
    expect(within(select).getByText("Exiled — vote available")).toBeInTheDocument();
    expect(within(select).getByText("Exiled — vote used")).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "alive" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply correction" }));
    expect(player(carol).ghostVote).toBe(true);
    expect(game().history.at(-1)).toMatchObject({ correction: true });
  });

  it("the Privacy Mode safe view still states life", () => {
    const { alice } = everyState();
    usePrivacyStore.setState({ enabled: true });
    render(<Drawer id={alice} />);
    expect(screen.getByText("Dead · vote used")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record death" })).toBeNull();
  });
});

describe("Phase 10A: Day Resolution and the dusk review", () => {
  it("records the executee and outcome; an additional execution asks for inline confirmation", () => {
    const { ids } = liveGame();
    state().advancePhase();
    render(<DayResolutionPanel onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Executee"), { target: { value: ids[0]! } });
    fireEvent.click(within(screen.getByRole("group", { name: "Execution outcome" })).getByRole("button", { name: "Died" }));
    expect(game().lifeEventWindow.events).toMatchObject([{ kind: "execution", outcome: "died" }]);
    expect(screen.getByText("Alice — executed — died")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Executee"), { target: { value: ids[1]! } });
    fireEvent.click(within(screen.getByRole("group", { name: "Execution outcome" })).getByRole("button", { name: "Survived" }));
    expect(game().lifeEventWindow.events).toHaveLength(1);
    expect(screen.getByText(/already recorded for Day 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record anyway" }));
    expect(game().lifeEventWindow.events).toHaveLength(2);
  });

  it("offers Traveler exile with Died/Survived and lists Travelers separately as exceptional executees", () => {
    const { traveler } = liveGame();
    state().advancePhase();
    render(<DayResolutionPanel onClose={() => {}} />);
    expect(within(screen.getByLabelText("Executee")).getByRole("group", { name: "Travelers (exceptional executee)" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Traveler"), { target: { value: traveler } });
    fireEvent.click(within(screen.getByRole("group", { name: "Exile outcome" })).getByRole("button", { name: "Survived" }));
    expect(player(traveler).alive).toBe(true);
    expect(game().lifeEventWindow.events).toMatchObject([{ kind: "exile", outcome: "survived" }]);
  });

  it("dusk: with no execution recorded on a covered Day, continuing requires confirming none occurred -- and records nothing", () => {
    liveGame();
    state().advancePhase();
    const onContinue = vi.fn();
    render(<DuskReview onClose={() => {}} onRecord={() => {}} onContinue={onContinue} />);
    const cont = screen.getByRole("button", { name: "Continue to Night 2" });
    expect(cont).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/No execution happened today/));
    expect(cont).toBeEnabled();
    fireEvent.click(cont);
    expect(onContinue).toHaveBeenCalledOnce();
    expect(game().lifeEventWindow.events).toEqual([]);
  });

  it("dusk: with unknown coverage it says so instead of claiming nothing happened", () => {
    liveGame();
    state().advancePhase();
    store.setState({ game: { ...game(), lifeEventWindow: { coverageFrom: { phase: "night", day: 2 }, events: [] } } });
    render(<DuskReview onClose={() => {}} onRecord={() => {}} onContinue={() => {}} />);
    expect(screen.getAllByText(/cannot say whether anything else happened/)).toHaveLength(2);
    expect(screen.queryByText("No execution recorded.")).toBeNull();
    expect(screen.getByRole("button", { name: "Continue to Night 2" })).toBeEnabled();
  });

  it("dusk: lists the Day's executions and exiles", () => {
    const { ids, traveler } = liveGame();
    state().advancePhase();
    state().recordExecution(ids[0]!, "died");
    state().recordExile(traveler, "survived");
    render(<DuskReview onClose={() => {}} onRecord={() => {}} onContinue={() => {}} />);
    expect(screen.getByText("Alice — executed — died")).toBeInTheDocument();
    expect(screen.getByText("Tess — exiled — survived")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to Night 2" })).toBeEnabled();
  });
});

describe("Phase 10A: Life events corrections panel", () => {
  it("retract with the suggested status repair is one atomic correction", () => {
    const { ids } = liveGame();
    state().advancePhase();
    state().recordExecution(ids[0]!, "died");
    const seqBefore = state().localSeq;
    const gameBefore = game();
    render(<LifeEventsPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Retract…" }));
    expect(screen.getByLabelText("Also set status")).toHaveValue("alive");
    fireEvent.click(screen.getByRole("button", { name: "Retract event" }));
    expect(game().lifeEventWindow.events).toEqual([]);
    expect(player(ids[0]!).alive).toBe(true);
    // One commit (one localSeq step) whose Undo entry is the pre-correction game.
    expect(state().localSeq).toBe(seqBefore + 1);
    expect(state().undoStack.at(-1)).toEqual(gameBefore);
  });

  it("shows only the current and previous phase", () => {
    const { ids } = liveGame();
    state().recordDeath(ids[0]!);
    state().advancePhase();
    state().advancePhase(); // Night 2: Night 1 has expired
    render(<LifeEventsPanel onClose={() => {}} />);
    expect(screen.getByText("Night 2")).toBeInTheDocument();
    expect(screen.getByText("Day 1")).toBeInTheDocument();
    expect(screen.queryByText("Night 1")).toBeNull();
    expect(screen.queryByText(/Alice — died/)).toBeNull();
  });
});

// Phase 10D (ASTRA-10D-C01 / C02): exile-death is death-scoped. The explicit,
// progressively disclosed correction workflows offer the Exiled states and
// correction-recorded exile events for any participant; gameplay exile stays
// Traveler-only.
describe("Phase 10D: exile-death is independent of the current Role (correction UI)", () => {
  function Drawer({ id }: { id: PlayerId }) { const p = store((s) => s.game!.players[id]!); return <PlayerDrawer player={p} />; }
  const lifeSection = () => within(screen.getByRole("region", { name: "Life" }));

  it("an ORDINARY participant who is already exile-dead (a former Traveler) shows Exiled and can keep/select Exiled in the status correction", () => {
    const { traveler } = liveGame();
    state().advancePhase(); // Day 1
    expect(state().recordExile(traveler, "died")).toMatchObject({ ok: true });
    const t = player(traveler);
    expect(state().resolveRoles({ intents: [
      { kind: "changeActualRole", target: { playerId: traveler, participantId: t.participantId! }, expectedActualRole: "thief", expectedIsTraveler: true, actualRole: "chef" },
      { kind: "setPerception", target: { playerId: traveler, participantId: t.participantId! }, expectedShownRole: t.shownRole,
        expectedShownAlignment: t.shownAlignment, shownRole: "chef", shownAlignment: null },
    ] })).toMatchObject({ ok: true, changed: true });
    expect(player(traveler)).toMatchObject({ isTraveler: false, alive: false, exiled: true });
    render(<Drawer id={traveler} />);
    expect(lifeSection().getByText("Exiled · vote available")).toBeInTheDocument();
    expect(lifeSection().queryByText(/Needs check/)).toBeNull();
    const select = lifeSection().getByLabelText("Correct to");
    fireEvent.change(select, { target: { value: "exiledVoteUsed" } });
    fireEvent.click(lifeSection().getByRole("button", { name: "Apply correction" }));
    expect(player(traveler)).toMatchObject({ isTraveler: false, alive: false, ghostVote: false, exiled: true });
    expect(lifeSection().getByText("Exiled · vote used")).toBeInTheDocument();
  });

  it("an ORDINARY participant's wrongly missing exile-death is repaired through the explicit correction -- no Life Event; gameplay exile stays Traveler-only", () => {
    const { ids } = liveGame();
    state().advancePhase(); // Day 1
    const bob = ids[1]!;
    expect(state().recordDeath(bob)).toMatchObject({ ok: true });
    const events = game().lifeEventWindow.events.length;
    render(<Drawer id={bob} />);
    // Gameplay exile is not offered to an ordinary participant.
    expect(lifeSection().queryByRole("button", { name: /Exiled —/ })).toBeNull();
    // The correction is progressively disclosed and explicit.
    expect(lifeSection().getByText("Correct status…").closest("details")).not.toHaveAttribute("open");
    fireEvent.change(lifeSection().getByLabelText("Correct to"), { target: { value: "exiledVote" } });
    fireEvent.click(lifeSection().getByRole("button", { name: "Apply correction" }));
    expect(player(bob)).toMatchObject({ isTraveler: false, alive: false, ghostVote: true, exiled: true });
    expect(lifeSection().getByText("Exiled · vote available")).toBeInTheDocument();
    expect(game().lifeEventWindow.events).toHaveLength(events);
    expect(game().history.at(-1)).toMatchObject({ category: "life", correction: true });
  });

  it("a late-recorded exile may name a currently ordinary participant (C02)", () => {
    const { ids } = liveGame();
    state().advancePhase(); // Day 1
    state().advancePhase(); // Night 2: Day 1 is the previous phase
    const carol = ids[2]!;
    expect(player(carol).isTraveler).toBe(false);
    render(<LifeEventsPanel onClose={() => {}} />);
    fireEvent.click(screen.getByText("Late record for Day 1…"));
    fireEvent.change(screen.getByLabelText("Event"), { target: { value: "exile" } });
    const who = screen.getByLabelText("Player");
    expect(within(who).getByRole("option", { name: new RegExp(`^${player(carol).name} `) })).toBeInTheDocument();
    fireEvent.change(who, { target: { value: carol } });
    fireEvent.change(screen.getByLabelText("Also set status"), { target: { value: "exiledVote" } });
    fireEvent.click(screen.getByRole("button", { name: "Record for Day 1" }));
    expect(game().lifeEventWindow.events.at(-1)).toMatchObject({ kind: "exile", outcome: "died",
      moment: { phase: "day", day: 1 }, subject: { playerId: carol } });
    expect(player(carol)).toMatchObject({ alive: false, exiled: true, isTraveler: false });
  });
});

describe("Phase 10A: public display seat", () => {
  it("a dead Traveler whose Role art is shown stays visibly and textually dead/exiled", () => {
    const { traveler } = everyState();
    const pub = projectLobbyToPublic(game(), {}).players[traveler]!;
    render(<PublicSeat player={pub} size={80} x={0} y={0} />);
    const seat = screen.getByRole("group", { name: "Tess, seat 8, exiled, vote used" });
    expect(within(seat).getByTestId("life-shroud")).toHaveTextContent("Exiled");
    expect(within(seat).getByText("Exiled · vote used")).toBeInTheDocument();
    expect(within(seat).getByText("Thief")).toBeInTheDocument();
  });
});
