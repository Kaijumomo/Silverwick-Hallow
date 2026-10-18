// Phase 10H, Slice 6: the player phone (contract §11; E1, F1-F10).
// Traceability: 10H-AC-028, -029, -031, -039, -042, -058 (UI side).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { usePlayerStore } from "@/stores/playerStore";
import { __setEnvOverrideForTests, clearFirebaseConfig, saveFirebaseConfig } from "@/firebase/config";

vi.mock("@/firebase/playerSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/playerSync")>();
  return { ...actual, usePlayerSync: () => {}, leaveLobby: vi.fn(async () => {}), acknowledgeReveal: vi.fn(async () => {}) };
});
const connection = vi.hoisted(() => ({ backend: null as unknown }));
vi.mock("@/firebase/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/session")>();
  return { ...actual, connectFirebase: async () => ({ backend: connection.backend as never, uid: "alice" }) };
});

import { acknowledgeReveal } from "@/firebase/playerSync";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { createLobby } from "@/firebase/lobby";
import { requireActiveSession, sessionPath } from "@/firebase/lifecycle";
import { PlayerScreen, playerMilestone, revealModeOf } from "./PlayerScreen";
import { enterTown, receiveCharacter, turnToken } from "./phone/ceremonyTestUtils";
import { PlayerEnded } from "./PlayerTerminal";
import type { PublicLobbyRecord } from "@/stores/types";

const TOKEN = "tok_aaaaaaaaaaaaaaaaaaaaaa";
const lobby = (phase: PublicLobbyRecord["phase"], day = 0, life = true): PublicLobbyRecord => ({
  code: "ABCD2345", scriptId: "tb", phase, day, seatOrder: ["p-alice", "p-bob"], fabled: [], lorics: [],
  players: {
    "p-alice": { id: "p-alice", name: "Alice", seat: 0, online: true, joinedAt: 0, isTraveler: false, ...(life ? { alive: true, ghostVote: true } : {}) },
    "p-bob": { id: "p-bob", name: "Bob", seat: 1, online: true, joinedAt: 0, isTraveler: false, ...(life ? { alive: true, ghostVote: true } : {}) },
  },
});
function seat(over: Partial<ReturnType<typeof usePlayerStore.getState>> = {}) {
  usePlayerStore.setState({
    code: "ABCD2345", uid: "alice", playerId: "p-alice", requestedName: "Alice", status: "seated", error: null,
    self: { shownRole: "chef", shownAlignment: "good", revealToken: TOKEN }, publicLobby: lobby("setup"),
    revealed: false, ownRevealAck: null, townNotes: {}, seatGuesses: {}, terminalResult: null,
    remoteData: { public: "ready", self: "ready", membership: "ready", request: "ready" }, ...over,
  });
}
beforeEach(() => {
  localStorage.removeItem("swp-veil:ABCD2345:p-alice");
  connection.backend = new MemoryRoomBackend();
  __setEnvOverrideForTests({});
  saveFirebaseConfig({ apiKey: "AIzaSyTEST", databaseURL: "https://example-default-rtdb.firebaseio.com", projectId: "example-project" });
  vi.mocked(acknowledgeReveal).mockClear();
  seat();
});
afterEach(() => { cleanup(); clearFirebaseConfig(); __setEnvOverrideForTests(null); });

describe("10H-AC-028 (F1): only public-safe coarse milestones", () => {
  it("Setting Up -> Your Role Is Ready -> Night N / Day N, and nothing about the deal, the bag or who is unfinished", () => {
    const lines = [
      playerMilestone(lobby("setup"), false, false),
      playerMilestone(lobby("setup"), true, false),
      playerMilestone(lobby("setup"), true, true),
      playerMilestone(lobby("night", 2, false), true, true),
      playerMilestone(lobby("day", 2), true, true),
    ];
    expect(lines.map((l) => l.phase)).toEqual(["Setting up", "Setting up", "Setting up", "Night 2", "Day 2"]);
    expect(lines[1]!.line).toBe("Your role is ready.");
    for (const { line } of lines) expect(line).not.toMatch(/deal|bag|dealt|unfinished|waiting for (other|players)|check/i);
  });

  it("the game frame shows phase and seat, the name and the four tabs; Leave is secondary on the Script tab", async () => {
    render(<PlayerScreen />);
    await enterTown();
    const nav = await screen.findByRole("navigation", { name: "Player views" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Character", "Notes", "Town", "Script"]);
    expect(screen.getByText("Setting up · Seat 1")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    // Leave is secondary: not on the Character tab.
    expect(screen.queryByRole("button", { name: "Request to leave" })).toBeNull();
    fireEvent.click(within(nav).getByRole("button", { name: "Script" }));
    expect(screen.getByRole("heading", { name: "Reference" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request to leave" })).toBeInTheDocument();
  });

  it("F6 (superseded by Package 3 A1): a waiting player sees the public names-only arrivals, never the private queue", async () => {
    usePlayerStore.setState({ status: "waiting", playerId: null, self: null, requestedName: "Cara",
      publicLobby: { ...usePlayerStore.getState().publicLobby!, arrivals: ["Alice", "Bob", "Cara"], plannedPlayers: 8 } });
    render(<PlayerScreen />);
    const list = await screen.findByRole("list", { name: "In the town" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Alice", "Bob", "CaraYou"]);
    expect(screen.getByText("3 of 8 arrived")).toBeInTheDocument();
  });
});

describe("10H-AC-029 / AC-031 (E1, F2, F3): ceremonial first reveal, neutral update notice, explicit acknowledgement", () => {
  it("reveal modes come only from the player's own acknowledgement vs the current token", () => {
    expect(revealModeOf(TOKEN, null)).toBe("first");
    expect(revealModeOf(TOKEN, TOKEN)).toBe("seen");
    expect(revealModeOf(TOKEN, "tok_bbbbbbbbbbbbbbbbbbbbbb")).toBe("updated");
  });

  it("first reveal: a sealed circle, then a sealed token, then the turned token and an acknowledgement (3B)", async () => {
    render(<PlayerScreen />);
    // The circle says the character is sealed and names no character.
    await screen.findByRole("heading", { name: "Your place in the circle" });
    expect(screen.getByText("Alice, the night is coming. Your character has been sealed.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Chef/);
    await receiveCharacter();
    // Sealed token: nothing about the character is in the page.
    expect(screen.getByText("Tap the token to turn it over")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Chef|townsfolk|You are the/i);
    expect(document.querySelector("[style*='background-image']")).toBeNull();
    expect(acknowledgeReveal).not.toHaveBeenCalled();
    turnToken();
    expect(screen.getByRole("heading", { name: "Chef" })).toBeInTheDocument();
    expect(screen.getByText("You are the")).toBeInTheDocument();
    expect(acknowledgeReveal).toHaveBeenCalledTimes(1);
    // Turning it back and over again never re-acknowledges.
    fireEvent.click(screen.getByRole("button", { name: "Turn your token back over" }));
    turnToken();
    expect(acknowledgeReveal).toHaveBeenCalledTimes(1);
  });

  it("a changed visible identity shows ONLY a neutral notice on the circle -- no character, no detail", async () => {
    seat({ ownRevealAck: "tok_bbbbbbbbbbbbbbbbbbbbbb" });
    render(<PlayerScreen />);
    await screen.findByRole("heading", { name: "Your place in the circle" });
    expect(screen.getByText("Alice, the Storyteller has updated your character.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Chef|good|townsfolk/i);
  });

  it("an acknowledged current identity goes through the same sealed token without a second acknowledgement", async () => {
    seat({ ownRevealAck: TOKEN });
    render(<PlayerScreen />);
    await receiveCharacter();
    turnToken();
    expect(screen.getByRole("heading", { name: "Chef" })).toBeInTheDocument();
    expect(acknowledgeReveal).not.toHaveBeenCalled();
  });

  it("an acknowledged player in a running game goes straight to the Character tab, with no ceremony and no second acknowledgement", async () => {
    seat({ ownRevealAck: TOKEN, publicLobby: lobby("day", 1) });
    render(<PlayerScreen />);
    expect(await screen.findByRole("heading", { name: "Chef" })).toBeInTheDocument();
    expect(screen.getByText("You are the")).toBeInTheDocument();
    expect(screen.getByText("Day 1 · Seat 1")).toBeInTheDocument();
    expect(acknowledgeReveal).not.toHaveBeenCalled();
  });

  it("a changed identity mid-game returns to the circle with only the neutral notice, never the new character", async () => {
    seat({ ownRevealAck: TOKEN, publicLobby: lobby("day", 1) });
    render(<PlayerScreen />);
    await screen.findByRole("heading", { name: "Chef" });
    act(() => { usePlayerStore.setState({ self: { shownRole: "imp", shownAlignment: "evil", revealToken: "tok_cccccccccccccccccccccc" } }); });
    await screen.findByRole("heading", { name: "Your place in the circle" });
    expect(screen.getByText("Alice, the Storyteller has updated your character.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Imp|evil/i);
  });

  it("the store never persists 'revealed' (re-seal on reload is structural)", () => {
    const persisted = JSON.parse(localStorage.getItem("new-blood-player") ?? "{}");
    expect(persisted.state ?? {}).not.toHaveProperty("revealed");
  });
});

describe("10H-AC-039 (F7) and Package 3 D3/D7: own Life at Night, the complete information history", () => {
  it("at Night the player privately sees their OWN Life (ghost pill, veil once) while the public Town withholds everyone's", async () => {
    seat({ ownRevealAck: TOKEN, publicLobby: lobby("night", 2, false), self: { shownRole: "chef", revealToken: TOKEN, life: { alive: false, ghostVote: true } } });
    render(<PlayerScreen />);
    expect(await screen.findByRole("dialog", { name: "The veil has fallen" })).toHaveTextContent("You have died. You may still speak, and you keep one ghost vote.");
    fireEvent.click(screen.getByRole("button", { name: "Continue as a ghost" }));
    expect(screen.queryByRole("dialog", { name: "The veil has fallen" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Ghost · 1 vote");
    fireEvent.click(screen.getByRole("button", { name: "Town" }));
    // Names and seats stay; life, the alive count and the threshold do not.
    expect(screen.getAllByRole("img", { name: /^Seat \d/ })).toHaveLength(2);
    const town = document.querySelector(".swp-town")!;
    expect(town).not.toHaveTextContent(/alive|dead|ghost|votes to execute/i);
    expect(town).toHaveTextContent("The town sleeps");
  });

  it("the veil is shown once: a reload of the same dead player goes straight to the ghost view", async () => {
    seat({ ownRevealAck: TOKEN, publicLobby: lobby("day", 2), self: { shownRole: "chef", revealToken: TOKEN, life: { alive: false, ghostVote: false } } });
    const first = render(<PlayerScreen />);
    expect((await screen.findByRole("dialog", { name: "The veil has fallen" })).textContent).not.toMatch(/ghost vote/);
    fireEvent.click(screen.getByRole("button", { name: "Continue as a ghost" }));
    first.unmount();
    render(<PlayerScreen />);
    await screen.findByRole("heading", { name: "Chef" });
    expect(screen.queryByRole("dialog", { name: "The veil has fallen" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Ghost · vote used");
  });

  it("everything the Storyteller delivered stays under From the Storyteller, night by night, oldest first", async () => {
    seat({ ownRevealAck: TOKEN, publicLobby: lobby("day", 2), self: { shownRole: "chef", revealToken: TOKEN, infoHistory: [
      { id: "e1", moment: { phase: "night", day: 1 }, text: "First message" },
      { id: "e2", moment: { phase: "day", day: 2 }, text: "Latest message" },
    ] } });
    render(<PlayerScreen />);
    const info = await screen.findByRole("region", { name: "From the Storyteller" });
    expect(within(info).getByText("Night 1")).toBeInTheDocument();
    expect(within(info).getByText("First message")).toBeInTheDocument();
    expect(within(info).getByText("Day 2")).toBeInTheDocument();
    expect(within(info).getByText("Latest message")).toBeInTheDocument();
    expect(within(info).queryByText(/could not be loaded/)).toBeNull();
  });

  it("a Storyteller device without history still shows the current packet, and a partial history says so", async () => {
    seat({ ownRevealAck: TOKEN, publicLobby: lobby("day", 1), self: { shownRole: "chef", revealToken: TOKEN, extraText: "Legacy message" } });
    const view = render(<PlayerScreen />);
    expect(within(await screen.findByRole("region", { name: "From the Storyteller" })).getByText("Legacy message")).toBeInTheDocument();
    view.unmount();
    seat({ ownRevealAck: TOKEN, publicLobby: lobby("day", 1), self: { shownRole: "chef", revealToken: TOKEN, infoHistory: [{ id: "e1", text: "Kept" }], infoHistoryPartial: true } });
    render(<PlayerScreen />);
    const info = await screen.findByRole("region", { name: "From the Storyteller" });
    expect(within(info).getByText("Earlier")).toBeInTheDocument();
    expect(within(info).getByRole("status")).toHaveTextContent("Some earlier information could not be loaded.");
  });

  it("an evil player's team comes from the latest history entry: names, seats and designations, never a character", async () => {
    seat({ ownRevealAck: TOKEN, publicLobby: lobby("day", 1), self: { shownRole: "imp", shownAlignment: "evil", revealToken: TOKEN, infoHistory: [
      { id: "e1", moment: { phase: "night", day: 1 }, minions: [{ id: "p-bob", name: "Bob", seat: 1 }], bluffs: ["chef", "empath", "monk"] },
    ] } });
    render(<PlayerScreen />);
    const team = await screen.findByRole("region", { name: "Your team" });
    expect(within(team).getByText("Bob")).toBeInTheDocument();
    expect(within(team).getByText("Seat 2 · Minion")).toBeInTheDocument();
    expect(within(team).getByRole("group", { name: "Bluffs, not in play" }).textContent).toMatch(/Chef.*Empath.*Monk/);
    const info = screen.getByRole("region", { name: "From the Storyteller" });
    expect(info).toHaveTextContent("You learnt your Minion and bluffs");
  });
});

describe("10H-AC-058 (F10): notes survive the post-game review until Back to Start", () => {
  it("the ended screen lists this game's notes; Back to start clears them", () => {
    seat({ status: "ended", seatGuesses: { "ABCD2345:p-bob": { verdict: "evil", guesses: ["imp"] } } });
    const onBack = () => usePlayerStore.getState().reset();
    render(<PlayerEnded result={{ status: "ready", result: { winner: "good", declaredAt: { phase: "day", day: 4 } } } as never} onRetry={() => {}} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /Your town notes \(1\)/i }));
    expect(screen.getByText("Imp")).toBeInTheDocument();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Back to start" })); });
    expect(usePlayerStore.getState().seatGuesses).toEqual({});
  });
});

// The post-game review is collapsed by default and shows EVERY seat that has a
// verdict or guesses, named from the player-side catalogue, as the player's own
// guesses. Legacy free-text notes stay on the device but are not shown.
describe("the post-game notes review keeps every verdict and guess", () => {
  const town = (): PublicLobbyRecord => {
    const base = lobby("day", 4);
    const extra = ["p-carol", "p-dave", "p-erin", "p-frank"].map((id, index) => [id, { id, name: id.slice(2, 3).toUpperCase() + id.slice(3), seat: index + 2, online: true, joinedAt: 0, isTraveler: false, alive: true, ghostVote: true }] as const);
    return { ...base, seatOrder: [...base.seatOrder, ...extra.map(([id]) => id)], players: { ...base.players, ...Object.fromEntries(extra) } };
  };
  const NOTES = {
    "ABCD2345:p-bob": { verdict: "evil" as const, guesses: [] }, // verdict only
    "ABCD2345:p-carol": { verdict: null, guesses: ["imp", "spy"] }, // guesses only
    "ABCD2345:p-erin": { verdict: "unsure" as const, guesses: ["poisoner"] }, // both
    "ABCD2345:p-frank": { verdict: null, guesses: [] }, // empty
    "OTHERGAME:p-bob": { verdict: "good" as const, guesses: ["imp"] }, // unrelated game
  };
  function ended(notes: Record<string, unknown> = NOTES) {
    seat({ status: "ended", publicLobby: town(), seatGuesses: notes as never, townNotes: { "ABCD2345:p-dave": { confidence: null, roles: [], text: "legacy words" } } });
    const onBack = () => usePlayerStore.getState().reset();
    render(<PlayerEnded result={{ status: "ready", result: { winner: "evil", declaredAt: { phase: "day", day: 4 } } }} onRetry={() => {}} onBack={onBack} />);
    return screen.getByRole("button", { name: /Your town notes \(3\)/i });
  }

  it("is collapsed by default, then lists seats in order with names, guesses and verdicts; empty seats and other games are absent", () => {
    const head = ended();
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listitem")).toBeNull();
    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "true");
    const [bob, carol, erin] = screen.getAllByRole("listitem") as [HTMLElement, HTMLElement, HTMLElement];
    expect(bob).toHaveTextContent(/^2BobEvil$/);
    expect(carol).toHaveTextContent(/^3CarolImp, Spy$/);
    expect(erin).toHaveTextContent(/^5ErinPoisoner\?$/);
    expect(screen.queryByText(/Frank/)).toBeNull();
    expect(screen.getByText("Your own notes and guesses, not confirmed game information.")).toBeInTheDocument();
    expect(screen.getByText("These notes stay on this phone until you go Back to start.")).toBeInTheDocument();
    // Legacy notes are kept on the device but never shown.
    expect(screen.queryByText(/legacy words/)).toBeNull();
    expect(usePlayerStore.getState().townNotes["ABCD2345:p-dave"]).toBeDefined();
  });

  it("an unknown saved RoleId stays understandable; without the public lobby the seat falls back to a generic label", () => {
    seat({ status: "ended", publicLobby: null, seatGuesses: { "ABCD2345:p-zed": { verdict: null, guesses: ["notarole", "imp"] } } });
    render(<PlayerEnded result={{ status: "none" }} onRetry={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Your town notes \(1\)/i }));
    expect(screen.getByRole("listitem")).toHaveTextContent(/^–A seatUnrecognized character \(notarole\), Imp$/);
  });

  it("Back to start clears this game's notes and keeps another game's", () => {
    fireEvent.click(ended());
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Back to start" })); });
    expect(usePlayerStore.getState().seatGuesses).toEqual({ "OTHERGAME:p-bob": NOTES["OTHERGAME:p-bob"] });
  });
});

describe("ASTRA-10H-007: joining an already-ended lobby is a completed generic Game Ended", () => {
  it("the stale-ended-lobby join path shows Game ended with Back to Start -- never an endless 'Reading the final result'", async () => {
    // A real lobby whose session has already ended (e.g. a stale code).
    const backend = connection.backend as MemoryRoomBackend;
    await createLobby(backend, "st-host", { codeGenerator: () => "ENDD2345" });
    const session = await requireActiveSession(backend, "ENDD2345");
    await backend.set(sessionPath("ENDD2345"), { version: 2, id: session.id, state: "ended" });
    usePlayerStore.getState().reset();
    render(<PlayerScreen />);
    // The real join form and the real joinLobby.
    fireEvent.change(await screen.findByLabelText("Game code"), { target: { value: "ENDD2345" } });
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Zed" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Enter the Town/ })); });
    expect(await screen.findByRole("heading", { name: "Game ended" })).toBeInTheDocument();
    expect(usePlayerStore.getState()).toMatchObject({ status: "ended", terminalResult: { status: "none" } });
    expect(screen.queryByText(/Reading the final result/)).toBeNull();
    // Accessible way out.
    const back = screen.getByRole("button", { name: "Back to start" });
    act(() => { fireEvent.click(back); });
    expect(usePlayerStore.getState().status).toBe("idle");
  });

  it("an ended state whose result is genuinely being read still says so (explicit pending only)", () => {
    render(<PlayerEnded result={{ status: "pending" }} onRetry={() => {}} onBack={() => {}} />);
    expect(screen.getByText(/Reading the final result/)).toBeInTheDocument();
    cleanup();
    render(<PlayerEnded result={null} onRetry={() => {}} onBack={() => {}} />);
    expect(screen.queryByText(/Reading the final result/)).toBeNull();
    expect(screen.getByRole("button", { name: "Back to start" })).toBeInTheDocument();
  });
});

describe("ASTRA-10H-007 (residual): a pending result read always offers Back to Start", () => {
  it("the real PlayerScreen, ended with the result read pending, shows Back to start; it clears the terminal context", async () => {
    seat({ status: "ended", terminalResult: { status: "pending" }, self: null,
      townNotes: { "ABCD2345:p-bob": { confidence: null, roles: [], text: "Bob seemed nervous" }, "OTHER:p-z": { confidence: null, roles: [], text: "keep" } } });
    render(<PlayerScreen />);
    expect(await screen.findByText(/Reading the final result/)).toBeInTheDocument();
    const back = screen.getByRole("button", { name: "Back to start" });
    act(() => { fireEvent.click(back); });
    const ps = usePlayerStore.getState();
    expect([ps.status, ps.code, ps.uid, ps.terminalResult]).toEqual(["idle", null, null, null]);
    expect(Object.keys(ps.townNotes)).toEqual(["OTHER:p-z"]);
  });

  it("pending never becomes 'no result': the other terminal screens are unchanged", () => {
    const { unmount } = render(<PlayerEnded result={{ status: "pending" }} onRetry={() => {}} onBack={() => {}} />);
    expect(screen.queryByText(/Thanks for playing/)).toBeNull();
    expect(screen.queryByText(/wins/)).toBeNull();
    unmount();
    render(<PlayerEnded result={{ status: "ready", result: { winner: "good", declaredAt: { phase: "day", day: 3 } } }} onRetry={() => {}} onBack={() => {}} />);
    expect(screen.getByRole("heading", { name: "Good wins" })).toBeInTheDocument();
    cleanup();
    render(<PlayerEnded result={{ status: "none" }} onRetry={() => {}} onBack={() => {}} />);
    expect(screen.getByText(/Thanks for playing/)).toBeInTheDocument();
    cleanup();
    const retry = vi.fn();
    render(<PlayerEnded result={{ status: "error", message: "Network down." }} onRetry={retry} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Back to start" })).toBeInTheDocument();
  });
});
