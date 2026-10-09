import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FinishGameDialog, GameResultSummary } from "./ResultDeclaration";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { buildRegistry } from "@/data/roleRegistry";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { endGameWithIntent } from "@/firebase/terminal";

vi.mock("@/firebase/terminal", () => ({ endGameWithIntent: vi.fn() }));
const end = vi.mocked(endGameWithIntent);
const registry = buildRegistry(setupScript);
beforeEach(() => { usePrivacyStore.getState().reset(); useStorytellerStore.setState({ terminalClose: null }); end.mockReset(); end.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

describe("approved shell End popup", () => {
  it("retries an interrupted ending with its saved intent and offers no false return to play", async () => {
    useStorytellerStore.setState({ terminalClose: { status: "failed", intent: { kind: "declare", winner: "evil" }, message: "An ending was interrupted.", recoveryPending: true } });
    const onClose = vi.fn();
    const onEnded = vi.fn();
    render(<FinishGameDialog onClose={onClose} onEnded={onEnded} multiplayer />);
    expect(screen.getByRole("button", { name: "Keep playing" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Good wins" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Evil wins" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(document.querySelector(".shell-ending-backdrop")!);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry finishing game" })));
    expect(end).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledWith({ kind: "declare", winner: "evil" });
    expect(onEnded).toHaveBeenCalledOnce();
  });

  it("keeps the live game unchanged on cancel and focuses the safe action", () => {
    const onClose = vi.fn();
    const view = render(<><button>Underlying board</button><FinishGameDialog onClose={onClose} onEnded={vi.fn()} multiplayer={false} /></>);
    const dialog = screen.getByRole("dialog", { name: "End the game" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Keep playing" })).toHaveFocus();
    expect(view.container).toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(end).not.toHaveBeenCalled();
    view.unmount();
    expect(view.container).not.toHaveAttribute("inert");
  });

  it.each(["good", "evil"] as const)("declares %s only through the terminal seam", async winner => {
    const onEnded = vi.fn();
    render(<FinishGameDialog onClose={vi.fn()} onEnded={onEnded} multiplayer={false} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: `${winner === "good" ? "Good" : "Evil"} wins` })));
    expect(end).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledWith({ kind: "declare", winner });
    expect(onEnded).toHaveBeenCalledOnce();
  });

  it("preserves end without result behind the quiet exceptional disclosure", async () => {
    render(<FinishGameDialog onClose={vi.fn()} onEnded={vi.fn()} multiplayer={false} />);
    fireEvent.click(screen.getByText("Other outcome"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "End without a result" })));
    expect(end).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledWith({ kind: "noResult" });
  });

  it("blocks repeat declarations, backdrop/Escape closure and cancellation in flight, then allows retry", async () => {
    let resolve!: (result: Awaited<ReturnType<typeof endGameWithIntent>>) => void;
    end.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const onClose = vi.fn();
    const onEnded = vi.fn();
    render(<FinishGameDialog onClose={onClose} onEnded={onEnded} multiplayer />);
    fireEvent.click(screen.getByRole("button", { name: "Good wins" }));
    fireEvent.click(screen.getByRole("button", { name: "Evil wins" }));
    fireEvent.click(document.querySelector(".shell-ending-backdrop")!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Keep playing" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Ending the game…");
    expect(onClose).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledOnce();
    await act(async () => resolve({ ok: false, message: "Please retry the failed closure." }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please retry");
    expect(onEnded).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Good wins" })));
    expect(onEnded).toHaveBeenCalledOnce();
  });
});

describe("approved victory scene", () => {
  function ended(winner: "good" | "evil" = "good") {
    const game = setupGame(["imp", "monk", "poisoner"], { phase: "ended", day: 2, result: { winner, declaredAt: { phase: "day", day: 2 } } });
    game.players.p0!.name = "Demon";
    game.players.p0!.actualAlignment = "good";
    game.players.p1!.name = "Converted Monk";
    game.players.p1!.actualAlignment = "evil";
    game.players.p2!.name = "Poisoner";
    game.players.p2!.actualAlignment = "evil";
    return game;
  }
  const callbacks = () => ({ onReview: vi.fn(), onActivity: vi.fn(), onNewGame: vi.fn(), onHome: vi.fn() });

  it("uses actual alignment, preserves both teams in details, and does not invent a Demon death", () => {
    const game = ended();
    render(<GameResultSummary game={game} registry={registry} {...callbacks()} />);
    const scene = screen.getByRole("dialog", { name: "Good Wins" });
    expect(scene).toHaveAttribute("aria-modal", "true");
    const winners = screen.getByRole("list", { name: "Good — winners" });
    expect(within(winners).getByText("Demon")).toBeInTheDocument();
    expect(within(winners).queryByText("Converted Monk")).not.toBeInTheDocument();
    expect(screen.queryByText(/found and slain/)).not.toBeInTheDocument();
    expect(document.querySelector(".is-slain")).toBeNull();
    fireEvent.click(screen.getByText("Game details & history"));
    expect(screen.getByRole("heading", { name: "Evil" })).toBeInTheDocument();
    expect(screen.getByText("Converted Monk")).toBeInTheDocument();
    expect(screen.getByText("Declared Day 2", { exact: false })).toBeInTheDocument();
  });

  it("uses the approved evil theme and review action, restores focus, and preserves the snapshot", () => {
    const game = ended("evil");
    const prior = JSON.stringify(game);
    const actions = callbacks();
    const view = render(<GameResultSummary game={game} registry={registry} {...actions} />);
    expect(document.querySelector(".shell-result-layer")).toHaveAttribute("data-winner", "evil");
    expect(screen.getByRole("button", { name: "Review the Grimoire" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Review the Grimoire" }));
    expect(actions.onReview).toHaveBeenCalledOnce();
    expect(JSON.stringify(game)).toBe(prior);
    view.unmount();
  });

  it("does not name a winner for exceptional endings and retains history access", () => {
    const game = ended();
    delete game.result;
    const actions = callbacks();
    render(<GameResultSummary game={game} registry={registry} {...actions} />);
    expect(screen.getByRole("dialog", { name: "The game is over" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /winners/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Game details & history"));
    fireEvent.click(screen.getByRole("button", { name: "History & Activity" }));
    expect(actions.onActivity).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "New game" }));
    expect(actions.onNewGame).toHaveBeenCalledOnce();
  });

  it("removes every private scene detail and releases isolation when privacy switches on", () => {
    const view = render(<GameResultSummary game={ended()} registry={registry} {...callbacks()} />);
    expect(view.container).toHaveAttribute("inert");
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Demon|Converted Monk|Poisoner/);
    expect(view.container).not.toHaveAttribute("inert");
  });
});
