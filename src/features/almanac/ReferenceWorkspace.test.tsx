import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReferenceWorkspace } from "./ReferenceWorkspace";
import { ReferenceBody } from "./ReferenceBody";
import { canonicalRoles } from "@/data/canonical";
import { GameScreen } from "@/features/game/GameScreen";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { setupGame } from "@/test/setupFixtures";
import { VotingCard, VotingProvider } from "@/features/voting/VotingWorkspace";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  useShellStore.getState().reset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function workspace(extra?: React.ReactNode) {
  return render(<ReferenceWorkspace enabled privacyMode={false} roles={canonicalRoles(["washerwoman", "imp"])} scriptName="Test script">
    <div>Board{extra}</div>
  </ReferenceWorkspace>);
}
function open() { fireEvent.click(screen.getByRole("button", { name: "Reference" })); }

describe("Reference presentation", () => {
  it("End closes a pinned panel without changing the game, and privacy disables the action", () => {
    const onEnd = vi.fn();
    const props = { enabled: true, roles: [], scriptName: "Script", onEnd, children: <div>Board</div> };
    const view = render(<ReferenceWorkspace {...props} privacyMode={false} />);
    open(); fireEvent.click(screen.getByRole("button", { name: "Pin Reference panel" }));
    const game = store.getState().game;
    fireEvent.click(screen.getByRole("button", { name: "End game" }));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector(".reference-workspace")).not.toHaveAttribute("data-reference-pinned");
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(store.getState().game).toBe(game);
    view.rerender(<ReferenceWorkspace {...props} privacyMode />);
    expect(screen.getByRole("button", { name: "End game" })).toBeDisabled();
    view.rerender(<ReferenceWorkspace {...props} privacyMode={false} endDisabled />);
    expect(screen.getByRole("button", { name: "End game" })).toBeDisabled();
  });

  it("Day opens the recorded nomination workflow while Night stays available in its phase", () => {
    store.setState({ game: setupGame(undefined, { phase: "day", day: 1 }), lobby: null });
    render(<VotingProvider><ReferenceWorkspace enabled privacyMode={false} roles={[]} scriptName="Script"
      night={() => <p>Night guide</p>}><VotingCard inline /></ReferenceWorkspace></VotingProvider>);
    const before = store.getState().game;
    expect(screen.queryByRole("button", { name: "Night" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    expect(screen.getByText("No nominations recorded today.")).toBeInTheDocument();
    expect(store.getState().game).toBe(before);
    act(() => store.setState({ game: { ...before!, phase: "night" } }));
    expect(screen.queryByRole("button", { name: "Day" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Night" }));
    expect(screen.getByText("Night guide")).toBeVisible();
  });

  it("offers retained history inside ended-game Info and never as a permanent rail item", () => {
    store.setState({ game: setupGame(undefined, { phase: "ended" }) });
    const onReviewHistory = vi.fn();
    render(<ReferenceWorkspace enabled privacyMode={false} roles={[]} scriptName="Script" info={<p>Game information</p>}
      onReviewHistory={onReviewHistory}><div>Board</div></ReferenceWorkspace>);
    expect(screen.queryByRole("button", { name: "History & activity" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    fireEvent.click(screen.getByRole("button", { name: "History & activity" }));
    expect(onReviewHistory).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("explicit Review Night navigation opens the guide from another tab without reopening after privacy", () => {
    const props = { enabled: true, roles: [], scriptName: "Script", children: <div>Board</div>,
      nightKey: "game:2", night: (visible: boolean) => <p>{visible ? "Night active" : "Night paused"}</p> };
    const view = render(<ReferenceWorkspace {...props} privacyMode={false} nightOpenRequest={0} />);
    open();
    expect(screen.getByRole("button", { name: "Night" })).toHaveAttribute("aria-expanded", "false");
    view.rerender(<ReferenceWorkspace {...props} privacyMode={false} nightOpenRequest={1} />);
    expect(screen.getByRole("button", { name: "Night" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Night active")).toBeVisible();
    view.rerender(<ReferenceWorkspace {...props} privacyMode nightOpenRequest={2} />);
    view.rerender(<ReferenceWorkspace {...props} privacyMode={false} nightOpenRequest={2} />);
    expect(screen.getByRole("button", { name: "Night" })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens each Night once, preserves its mounted content across tabs, and respects close/privacy", () => {
    let mounts = 0;
    function NightContent({ visible }: { visible: boolean }) {
      const [value, setValue] = useState("Poisoner");
      useEffect(() => { mounts++; }, []);
      return <div><p>{visible ? "Night active" : "Night paused"}</p><button onClick={() => setValue("Monk")}>{value}</button></div>;
    }
    const props = { enabled: true, roles: [], scriptName: "Script", children: <div>Board</div>,
      night: (visible: boolean) => <NightContent visible={visible} /> };
    const view = render(<ReferenceWorkspace {...props} nightKey="game:1" privacyMode={false} />);
    expect(screen.getByRole("button", { name: "Night" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Poisoner" }));
    open();
    expect(screen.queryByRole("button", { name: "Monk" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Night" }));
    expect(screen.getByRole("button", { name: "Monk" })).toBeVisible();
    expect(mounts).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Close Night panel" }));
    view.rerender(<ReferenceWorkspace {...props} nightKey="game:1" privacyMode={false} />);
    expect(screen.getByRole("button", { name: "Night" })).toHaveAttribute("aria-expanded", "false");
    view.rerender(<ReferenceWorkspace {...props} nightKey="game:2" privacyMode={false} />);
    expect(screen.getByRole("button", { name: "Night" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Pin Night panel" }));
    view.rerender(<ReferenceWorkspace {...props} nightKey="game:2" privacyMode />);
    expect(view.container.querySelector(".reference-panel")).toBeNull();
    expect(view.container.querySelector(".reference-workspace")).toHaveAttribute("data-reference-pinned");
    view.rerender(<ReferenceWorkspace {...props} nightKey="game:2" privacyMode={false} />);
    expect(screen.getByRole("button", { name: "Night" })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens as an overlay, closes/unpins, restores focus, and retains search on reopen", () => {
    const view = workspace();
    const trigger = screen.getByRole("button", { name: "Reference" });
    open();
    expect(screen.getByRole("heading", { name: "Reference" })).toHaveFocus();
    expect(view.container.querySelector(".reference-workspace")).not.toHaveAttribute("data-reference-pinned");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Washerwoman" } });
    fireEvent.click(screen.getByRole("button", { name: "Pin Reference panel" }));
    expect(view.container.querySelector(".reference-workspace")).toHaveAttribute("data-reference-pinned");
    fireEvent.click(screen.getByRole("button", { name: "Close Reference panel" }));
    expect(trigger).toHaveFocus();
    expect(view.container.querySelector(".reference-workspace")).not.toHaveAttribute("data-reference-pinned");
    open();
    expect(screen.getByRole("searchbox")).toHaveValue("Washerwoman");
    expect(screen.getByRole("button", { name: "Pin Reference panel" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("Escape dismisses Reference despite a mounted hidden action draft, but respects modal ownership", () => {
    const view = workspace(<section role="dialog" hidden>Hidden draft</section>);
    open();
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Reference" })).toBeNull();
    open();
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    view.container.append(modal);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("complementary", { name: "Reference" })).toBeInTheDocument();
    modal.remove();
  });

  it("searches name, ID and ability without filters; retains canonical-only wiki links and honest authority", () => {
    const roles = [...canonicalRoles(["washerwoman", "imp"]), { id: "homebrew", name: "Moon Keeper", type: "townsfolk" as const, ability: "Count silver moons." }];
    const onSearch = vi.fn();
    const view = render(<ReferenceBody roles={roles} search="silver" onSearch={onSearch} />);
    expect(screen.getByRole("button", { name: "Moon Keeper" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("group", { name: /filters/i })).toBeNull();
    view.rerender(<ReferenceBody roles={roles} search="washerwoman" onSearch={onSearch} />);
    expect(screen.getByRole("link", { name: "Washerwoman wiki (opens in a new tab)" }))
      .toHaveAttribute("href", "https://wiki.bloodontheclocktower.com/Washerwoman");
    expect(screen.getByText(/You start knowing/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Washerwoman" }));
    expect(screen.getByRole("button", { name: "Washerwoman" })).toHaveAttribute("aria-expanded", "true");
    view.rerender(<ReferenceBody roles={roles} search="no such character" onSearch={onSearch} />);
    expect(screen.getByRole("status")).toHaveTextContent("0 characters");
    expect(screen.getByText(/No characters match/)).toBeInTheDocument();
  });
});

describe("Reference game integration", () => {
  function game() {
    store.setState({ game: setupGame(["washerwoman", "empath", "monk", "poisoner", "imp"], { scriptId: "tb", phase: "day", day: 1 }),
      lobby: null, undoStack: [], selectedPlayerId: null, grimoireMode: "freeRoam", tokenPositions: { p0: { x: 120, y: -80 } } });
    return render(<GameScreen />);
  }
  const durableState = () => {
    const { game, undoStack, tokenPositions, grimoireMode } = store.getState();
    return structuredClone({ game, undoStack, tokenPositions, grimoireMode });
  };

  it("panel interactions never mutate game, Undo, seat identities or saved free-roam coordinates", () => {
    game();
    const before = durableState();
    open();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Imp" } });
    fireEvent.click(screen.getByRole("button", { name: "Pin Reference panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Unpin Reference panel" }));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(durableState()).toEqual(before);
  });

  it("privacy removes reference content while keeping a blank pinned footprint; privacy off never reopens it", () => {
    const view = game();
    const before = durableState();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Pin Reference panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable Privacy Mode" }));
    expect(view.container.querySelector(".reference-panel")).toBeNull();
    expect(view.container.querySelector(".reference-workspace")).toHaveAttribute("data-reference-pinned");
    expect(screen.getByRole("button", { name: "Reference" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Disable Privacy Mode" }));
    expect(view.container.querySelector(".reference-workspace")).not.toHaveAttribute("data-reference-pinned");
    expect(screen.queryByRole("complementary", { name: "Reference" })).toBeNull();
    expect(durableState()).toEqual(before);
  });

  it("does not carry an open panel or search into a replacement game", () => {
    game(); open();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "old query" } });
    fireEvent.click(screen.getByRole("button", { name: "Pin Reference panel" }));
    act(() => {
      store.getState().newGame("tb");
      store.setState({ game: { ...store.getState().game!, phase: "day", day: 1 } });
    });
    expect(screen.queryByRole("complementary", { name: "Reference" })).toBeNull();
    open();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Pin Reference panel" })).toHaveAttribute("aria-pressed", "false");
  });
});
