// Package 3 (3B): the seating circle, the sealed token, the evil team and the
// Traveller's choice, driven through the real PlayerScreen.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { act } from "react";
import { usePlayerStore } from "@/stores/playerStore";
import { __setEnvOverrideForTests, clearFirebaseConfig, saveFirebaseConfig } from "@/firebase/config";

vi.mock("@/firebase/playerSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/playerSync")>();
  return { ...actual, usePlayerSync: () => {}, leaveLobby: vi.fn(async () => {}), acknowledgeReveal: vi.fn(async () => {}), chooseTraveler: vi.fn(async () => {}), useOwnTravelerChoice: () => null };
});
const connection = vi.hoisted(() => ({ backend: null as unknown }));
vi.mock("@/firebase/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/session")>();
  return { ...actual, connectFirebase: async () => ({ backend: connection.backend as never, uid: "alice" }) };
});

import { acknowledgeReveal } from "@/firebase/playerSync";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { PlayerScreen } from "../PlayerScreen";
import { SeatedChart } from "./SeatedChart";
import { teamOf } from "./PreGameFlow";
import { enterTown, receiveCharacter, turnToken } from "./ceremonyTestUtils";
import type { PlayerSelfEnvelope, PublicLobbyRecord } from "@/stores/types";

const TOKEN = "tok_aaaaaaaaaaaaaaaaaaaaaa";
const NAMES = ["Ada", "Alice", "Cleo", "Dmitri", "Elspeth", "Greta", "Hollis", "Iris"];

function lobby(phase: PublicLobbyRecord["phase"] = "setup", mine: { traveller?: boolean } = {}): PublicLobbyRecord {
  const players: PublicLobbyRecord["players"] = {};
  NAMES.forEach((name, i) => {
    players[`p-${name.toLowerCase()}`] = { id: `p-${name.toLowerCase()}`, name, seat: i, online: true, joinedAt: 0, isTraveler: name === "Alice" && !!mine.traveller, ...(phase === "night" ? {} : { alive: true, ghostVote: true }) };
  });
  return { code: "ABCD2345", scriptId: "tb", phase, day: phase === "setup" ? 0 : 1, seatOrder: Object.keys(players), players, fabled: [], lorics: [] };
}
function seat(self: PlayerSelfEnvelope | null, over: Partial<ReturnType<typeof usePlayerStore.getState>> = {}, mine: { traveller?: boolean } = {}) {
  usePlayerStore.setState({
    code: "ABCD2345", uid: "alice", playerId: "p-alice", requestedName: "Alice", status: "seated", error: null,
    self, publicLobby: lobby("setup", mine), revealed: false, ownRevealAck: null, townNotes: {}, terminalResult: null,
    remoteData: { public: "ready", self: "ready", membership: "ready", request: "ready" }, ...over,
  });
}

beforeEach(() => {
  connection.backend = new MemoryRoomBackend();
  __setEnvOverrideForTests({});
  saveFirebaseConfig({ apiKey: "AIzaSyTEST", databaseURL: "https://example-default-rtdb.firebaseio.com", projectId: "example-project" });
  vi.mocked(acknowledgeReveal).mockClear();
});
afterEach(() => { cleanup(); clearFirebaseConfig(); __setEnvOverrideForTests(null); });

describe("the seating circle", () => {
  it("shows the real seat, count, script and both neighbours by name", async () => {
    seat({ shownRole: "chef", shownAlignment: "good", revealToken: TOKEN });
    render(<PlayerScreen />);
    await screen.findByRole("heading", { name: "Your place in the circle" });
    expect(screen.getByText("Trouble Brewing · 8 players")).toBeInTheDocument();
    expect(screen.getByText("You are in seat 2 of 8. On your left: Ada. On your right: Cleo.")).toBeInTheDocument();
    expect(screen.getByText("On your left").nextSibling).toHaveTextContent("Ada");
    expect(screen.getByText("On your right").nextSibling).toHaveTextContent("Cleo");
  });

  it("wraps neighbours around the circle and shrinks long names to fit their disc", () => {
    const seats = ["Ada", "Bartholomew", "Cleo"].map((name, i) => ({ seat: i + 1, name }));
    const { container } = render(<SeatedChart seats={seats} ownSeat={1} line="x" />);
    expect(screen.getByText("On your left").nextSibling).toHaveTextContent("Cleo");
    expect(screen.getByText("On your right").nextSibling).toHaveTextContent("Bartholomew");
    const discs = [...container.querySelectorAll(".swp-chart-disc")].map((d) => d.textContent);
    expect(discs).toEqual(["You", "B", "Cleo"]);
  });

  it("before a character exists the circle only says the game is being set up, with no button", async () => {
    seat(null);
    render(<PlayerScreen />);
    expect(await screen.findByText("Alice, the Storyteller is setting up the game.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Receive your character|Choose your Traveler/ })).toBeNull();
  });
});

describe("the sealed token", () => {
  it("re-seals on reload: a returning, already-acknowledged player in Setup meets a sealed token again", async () => {
    seat({ shownRole: "chef", shownAlignment: "good", revealToken: TOKEN }, { ownRevealAck: TOKEN });
    const first = render(<PlayerScreen />);
    await receiveCharacter();
    turnToken();
    expect(screen.getByRole("heading", { name: "Chef" })).toBeInTheDocument();
    first.unmount();
    render(<PlayerScreen />);
    await screen.findByRole("heading", { name: "Your place in the circle" });
    expect(document.body).not.toHaveTextContent(/Chef/);
  });

  it("a token turned back over holds no character text for a screen reader", async () => {
    seat({ shownRole: "chef", shownAlignment: "good", revealToken: TOKEN });
    render(<PlayerScreen />);
    await receiveCharacter();
    turnToken();
    fireEvent.click(screen.getByRole("button", { name: "Turn your token back over" }));
    expect(screen.queryByRole("heading", { name: "Chef" })).toBeNull();
    expect(screen.getByText("Tap the token to turn it over")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull(); // hidden from assistive tech until turned
    expect(screen.getByRole("button", { name: "Continue", hidden: true })).toBeDisabled();
  });

  it("a new identity sent mid-ceremony returns to the circle instead of swapping under the player's eyes", async () => {
    seat({ shownRole: "chef", shownAlignment: "good", revealToken: TOKEN });
    render(<PlayerScreen />);
    await receiveCharacter();
    turnToken();
    act(() => { usePlayerStore.setState({ self: { shownRole: "empath", shownAlignment: "good", revealToken: "tok_cccccccccccccccccccccc" } }); });
    expect(screen.getByRole("heading", { name: "Your place in the circle" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Chef|Empath/);
  });

  it("Enter the town leaves the ceremony and does not auto-start the night", async () => {
    seat({ shownRole: "chef", shownAlignment: "good", revealToken: TOKEN });
    render(<PlayerScreen />);
    await enterTown();
    expect(await screen.findByRole("button", { name: "More" })).toBeInTheDocument();
    expect(usePlayerStore.getState().publicLobby?.phase).toBe("setup");
  });
});

describe("the sealed token leaks nothing about the team or alignment", () => {
  it("no tone class and no team-revealing button label until the token is turned", async () => {
    seat({ shownRole: "imp", shownAlignment: "evil", revealToken: TOKEN, minions: [{ id: "p-greta", name: "Greta", seat: 5 }] });
    const { container } = render(<PlayerScreen />);
    await receiveCharacter();
    expect(container.innerHTML).not.toMatch(/swp-tone-|Meet your team|Enter the town/);
    turnToken();
    expect(container.innerHTML).toMatch(/swp-tone-evil/);
    fireEvent.click(screen.getByRole("button", { name: "Turn your token back over" }));
  });

  it("acknowledging mid-game does not eject the player from the ceremony before they enter", async () => {
    vi.mocked(acknowledgeReveal).mockImplementationOnce(async () => { usePlayerStore.setState({ ownRevealAck: TOKEN }); });
    seat({ shownRole: "imp", shownAlignment: "evil", revealToken: TOKEN, minions: [{ id: "p-greta", name: "Greta", seat: 5 }] }, { publicLobby: lobby("day") });
    render(<PlayerScreen />);
    await receiveCharacter();
    turnToken();
    await act(async () => {});
    expect(usePlayerStore.getState().ownRevealAck).toBe(TOKEN);
    fireEvent.click(screen.getByRole("button", { name: "Meet your team" }));
    expect(screen.getByRole("heading", { name: "Sworn in darkness" })).toBeInTheDocument();
  });
});

describe("the evil team", () => {
  const demonSelf: PlayerSelfEnvelope = {
    shownRole: "imp", shownAlignment: "evil", revealToken: TOKEN,
    minions: [{ id: "p-greta", name: "Greta", seat: 5 }, { id: "p-iris", name: "Iris", seat: 7 }],
    bluffs: ["mayor", "soldier", "chef"],
  };

  it("derives teammates and bluffs from the packet only, as names, seats and Minion/Demon -- never a character", () => {
    const team = teamOf({ ...demonSelf, demon: { id: "p-kestrel", name: "Kestrel", seat: 10 } }, false);
    expect(team.mates).toEqual([
      expect.objectContaining({ name: "Kestrel", seat: 10, designation: "Demon" }),
      expect.objectContaining({ name: "Greta", seat: 5, designation: "Minion" }),
      expect.objectContaining({ name: "Iris", seat: 7, designation: "Minion" }),
    ]);
    for (const mate of team.mates) expect(Object.keys(mate).sort()).toEqual(["designation", "icon", "name", "seat"]);
    expect(team.bluffs.map((b) => b.name)).toEqual(["Mayor", "Soldier", "Chef"]);
  });

  it("a Traveller never gets the team screen (their Demon information stays under From the Storyteller)", () => {
    expect(teamOf({ shownRole: "gunslinger", shownAlignment: "evil", demon: { id: "p-k", name: "Kestrel", seat: 3 } }, true)).toEqual({ mates: [], bluffs: [] });
  });

  it("Meet your team: names, seat numbers and designation with generic icons, then the bluffs, then the town", async () => {
    seat(demonSelf);
    const { container } = render(<PlayerScreen />);
    await receiveCharacter();
    turnToken();
    expect(screen.getByRole("heading", { name: "Imp" })).toBeInTheDocument();
    expect(screen.getByText("Evil")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Meet your team" }));
    expect(screen.getByRole("heading", { name: "Sworn in darkness" })).toBeInTheDocument();
    expect(screen.getByText("Seat 6 · Minion")).toBeInTheDocument();
    expect(screen.getByText("Seat 8 · Minion")).toBeInTheDocument();
    expect(screen.getByText("You · Imp")).toBeInTheDocument();
    const bluffs = screen.getByRole("region", { name: "Bluffs, not in play" });
    expect(within(bluffs).getAllByText(/^(Mayor|Soldier|Chef)$/)).toHaveLength(3);
    // The teammates are drawn with the generic Minion icon, never a character.
    const icons = [...container.querySelectorAll(".swp-coven-token .swp-token-art")].map((el) => (el as HTMLElement).style.backgroundImage);
    expect(icons.filter((i) => i.includes("/characters/generic/minion.png"))).toHaveLength(2);
    expect(container.textContent).not.toMatch(/Poisoner|Spy|Baron|Scarlet/);
    fireEvent.click(screen.getByRole("button", { name: "Enter the town" }));
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });

  it("an evil player the Storyteller gave no team to goes straight in: no team screen, 'Enter the town'", async () => {
    seat({ shownRole: "poisoner", shownAlignment: "evil", revealToken: TOKEN });
    render(<PlayerScreen />);
    await receiveCharacter();
    turnToken();
    expect(screen.queryByRole("button", { name: "Meet your team" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enter the town" }));
    expect(screen.queryByRole("heading", { name: "Sworn in darkness" })).toBeNull();
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });
});

describe("the Traveller", () => {
  it("the circle offers Choose your Traveler, and once the Storyteller applies it the token is received like any other", async () => {
    seat(null, {}, { traveller: true });
    render(<PlayerScreen />);
    expect(await screen.findByText("The Storyteller has marked you as a Traveler. Choose who you will be.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose your Traveler" }));
    expect(screen.getByRole("heading", { name: "Choose your Traveler" })).toBeInTheDocument();
    // The Storyteller applies the choice: public role set, identity delivered.
    act(() => {
      const current = usePlayerStore.getState().publicLobby!;
      usePlayerStore.setState({
        publicLobby: { ...current, players: { ...current.players, "p-alice": { ...current.players["p-alice"]!, publicDisplayRole: "gunslinger" } } },
        self: { shownRole: "gunslinger", shownAlignment: "good", revealToken: TOKEN },
      });
    });
    turnToken();
    expect(screen.getByRole("heading", { name: "Gunslinger" })).toBeInTheDocument();
    expect(screen.getByText("Traveller")).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument();
    expect(acknowledgeReveal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Enter the town" })).toBeEnabled();
  });
});
