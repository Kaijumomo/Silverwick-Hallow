import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { usePlayerStore } from "@/stores/playerStore";
import { getBuiltinScript } from "@/data/scripts";
import type { PlayerSelfEnvelope, PublicLobbyRecord } from "@/stores/types";
import { GameScreen } from "./GameScreen";
import { LeaveSheet } from "./LeaveSheet";
import { ScriptTab } from "./ScriptTab";

afterEach(cleanup);

const tb = getBuiltinScript("tb")!;
const lobby: PublicLobbyRecord = {
  code: "ABCD2345", scriptId: "tb", phase: "day", day: 2, seatOrder: ["p-alice", "p-bob", "p-cy"], fabled: [], lorics: [],
  players: {
    "p-alice": { id: "p-alice", name: "Alice", seat: 0, online: true, joinedAt: 0, isTraveler: false, alive: true, ghostVote: true },
    "p-bob": { id: "p-bob", name: "Bob", seat: 1, online: true, joinedAt: 0, isTraveler: false, alive: true, ghostVote: true },
    "p-cy": { id: "p-cy", name: "Cy", seat: 2, online: true, joinedAt: 0, isTraveler: false, alive: false, ghostVote: true },
  },
};
const self: PlayerSelfEnvelope = { shownRole: "chef", shownAlignment: "good" };

function game(over: { leaving?: boolean; onLeave?: () => Promise<void> } = {}) {
  return render(
    <GameScreen
      publicLobby={lobby} self={self} playerId="p-alice" code="ABCD2345" name="Alice" phaseLabel="Day 2"
      scriptName={tb.name} scriptCharacters={tb.characters} referenceRoles={tb.characters}
      leaving={over.leaving ?? false} onLeave={over.onLeave ?? (async () => {})}
    />,
  );
}
const tab = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  usePlayerStore.setState({ seatGuesses: {}, townNotes: { "ABCD2345:p-bob": { confidence: "suspect", roles: [], text: "old" } } });
  localStorage.clear();
});

describe("Notes tab", () => {
  it("lists the other seats; a verdict toggles on, switches and clears; it is saved for this game", () => {
    game();
    tab("Notes");
    expect(screen.queryByRole("group", { name: "Verdict for Alice" })).toBeNull();
    const bob = within(screen.getByRole("group", { name: "Verdict for Bob" }));
    fireEvent.click(bob.getByRole("button", { name: "Evil" }));
    expect(bob.getByRole("button", { name: "Evil" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(bob.getByRole("button", { name: "Good" }));
    expect(bob.getByRole("button", { name: "Evil" })).toHaveAttribute("aria-pressed", "false");
    expect(usePlayerStore.getState().seatGuesses["ABCD2345:p-bob"]).toEqual({ verdict: "good", guesses: [] });
    fireEvent.click(bob.getByRole("button", { name: "Good" }));
    expect(usePlayerStore.getState().seatGuesses).toEqual({});
  });

  it("the guess sheet takes at most three characters, removes on tap and shows the count", () => {
    game();
    tab("Notes");
    fireEvent.click(screen.getByRole("button", { name: "Guess who Bob is" }));
    const sheet = within(screen.getByRole("dialog", { name: "Who is Bob?" }));
    expect(sheet.getByText("Seat 2 · 0 of 3 chosen")).toBeInTheDocument();
    for (const n of ["Chef", "Empath", "Monk"]) fireEvent.click(sheet.getByRole("button", { name: n }));
    expect(sheet.getByText("Seat 2 · 3 of 3 chosen")).toBeInTheDocument();
    fireEvent.click(sheet.getByRole("button", { name: "Imp" }));
    expect(usePlayerStore.getState().seatGuesses["ABCD2345:p-bob"]!.guesses).toEqual(["chef", "empath", "monk"]);
    fireEvent.click(sheet.getByRole("button", { name: "Empath" }));
    expect(usePlayerStore.getState().seatGuesses["ABCD2345:p-bob"]!.guesses).toEqual(["chef", "monk"]);
    fireEvent.click(sheet.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Who is Bob?" })).toBeNull();
  });

  it("legacy free-text notes are never shown but stay on the device; Back to start clears this game's guesses", () => {
    game();
    tab("Notes");
    expect(document.body).not.toHaveTextContent(/old|Suspect/);
    expect(usePlayerStore.getState().townNotes["ABCD2345:p-bob"]).toBeDefined();
    act(() => usePlayerStore.getState().setSeatGuess("ABCD2345", "p-bob", { verdict: "evil" }));
    usePlayerStore.setState({ code: "ABCD2345" });
    act(() => usePlayerStore.getState().reset());
    expect(usePlayerStore.getState().seatGuesses).toEqual({});
  });
});

describe("Script tab", () => {
  it("shows the script, marks the player's own character and filters by name and ability", () => {
    game();
    tab("Script");
    expect(screen.getByRole("heading", { name: "Reference" })).toBeInTheDocument();
    expect(screen.getByText(`${tb.name} · 22 characters`)).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Your character" })).toHaveLength(1);
    const search = screen.getByRole("searchbox", { name: "Search characters" });
    fireEvent.change(search, { target: { value: "poison" } });
    expect(screen.getByRole("button", { name: /Poisoner/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Soldier/ })).toBeNull();
    fireEvent.change(search, { target: { value: "zzzz" } });
    expect(screen.getByText("No characters match “zzzz”.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("button", { name: /Poisoner/ })).toBeInTheDocument();
  });

  it("opens a character card that turns over and closes", () => {
    game();
    tab("Script");
    fireEvent.click(screen.getByRole("button", { name: /Fortune Teller/ }));
    const card = within(screen.getByRole("dialog", { name: "Fortune Teller" }));
    expect(card.getByText("Tap to turn the card")).toBeInTheDocument();
    fireEvent.click(card.getByRole("button", { name: /Tap to turn the card/ }));
    expect(card.getByRole("link", { name: "Read on the official wiki" })).toHaveAttribute("href", "https://wiki.bloodontheclocktower.com/Fortune_Teller");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Fortune Teller" })).toBeNull();
  });
});

describe("Request to leave", () => {
  it("is the last thing on the Script tab, opens the sheet and Cancel closes it without leaving", () => {
    const onLeave = vi.fn(async () => {});
    game({ onLeave });
    tab("Script");
    fireEvent.click(screen.getByRole("button", { name: "Request to leave" }));
    const sheet = within(screen.getByRole("dialog", { name: "Request to leave?" }));
    expect(sheet.getByText("ABCD·2345 · Seat 1 · Alice")).toBeInTheDocument();
    expect(sheet.getByText("You will remain seated in the game until the Storyteller accepts your request.")).toBeInTheDocument();
    fireEvent.click(sheet.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Request to leave?" })).toBeNull();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("confirming sends the request once", async () => {
    const onLeave = vi.fn(async () => {});
    game({ onLeave });
    tab("Script");
    fireEvent.click(screen.getByRole("button", { name: "Request to leave" }));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog", { name: "Request to leave?" })).getByRole("button", { name: "Request to leave" })); });
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("while sending, both buttons are inert and the link is disabled", () => {
    const onClose = vi.fn(); const onConfirm = vi.fn();
    render(<LeaveSheet code="ABCD2345" seat={1} name="Alice" sending onConfirm={onConfirm} onClose={onClose} />);
    const send = screen.getByRole("button", { name: "Sending…" });
    expect(send).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.click(send); fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    cleanup();
    render(<ScriptTab roles={tb.characters} scriptName={tb.name} ownRoleId="chef" onOpen={() => {}} onLeave={() => {}} leaving />);
    expect(screen.getByRole("button", { name: "Request to leave" })).toBeDisabled();
  });
});
