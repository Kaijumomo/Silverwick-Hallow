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
    revealed: false, ownRevealAck: null, townNotes: {}, terminalResult: null,
    remoteData: { public: "ready", self: "ready", membership: "ready", request: "ready" }, ...over,
  });
}
beforeEach(() => {
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

  it("the shell shows phase, name and one status line, with touch-safe bottom navigation (Role / Town / More)", async () => {
    render(<PlayerScreen />);
    const nav = await screen.findByRole("navigation", { name: "Player views" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Role", "Town", "More"]);
    expect(screen.getByText("Setting up")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Your role is ready.");
    // Leave is secondary: not on the Role view.
    expect(screen.queryByText("Request to leave lobby")).toBeNull();
    fireEvent.click(within(nav).getByRole("button", { name: "More" }));
    expect(screen.getByRole("region", { name: "Reference" })).toBeInTheDocument();
    expect(screen.getByText("Request to leave lobby")).toBeInTheDocument();
  });

  it("F6: a waiting player sees already-seated public participants only", async () => {
    usePlayerStore.setState({ status: "waiting", playerId: null, self: null });
    render(<PlayerScreen />);
    const seated = await screen.findByRole("region", { name: "Already seated" });
    expect(within(seated).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["seat 1Alice", "seat 2Bob"]);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting — the Storyteller will seat you.");
  });
});

describe("10H-AC-029 / AC-031 (E1, F2, F3): ceremonial first reveal, neutral update notice, explicit acknowledgement", () => {
  it("reveal modes come only from the player's own acknowledgement vs the current token", () => {
    expect(revealModeOf(TOKEN, null)).toBe("first");
    expect(revealModeOf(TOKEN, TOKEN)).toBe("seen");
    expect(revealModeOf(TOKEN, "tok_bbbbbbbbbbbbbbbbbbbbbb")).toBe("updated");
  });

  it("first reveal is ceremonial, then a readable card with Hide and I've Seen My Role", async () => {
    render(<PlayerScreen />);
    const sealed = await screen.findByRole("button", { name: "Tap to reveal your role" });
    expect(sealed).toHaveTextContent("Your Role Is Ready");
    expect(document.body).not.toHaveTextContent("Chef");
    fireEvent.click(sealed);
    const card = screen.getByRole("article", { name: "Your role" });
    expect(card).toHaveClass("ceremony");
    expect(within(card).getByRole("heading", { name: /Chef/ })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "I've Seen My Role" }));
    expect(acknowledgeReveal).toHaveBeenCalledTimes(1);
    fireEvent.click(within(card).getByRole("button", { name: "Tap to seal your role" }));
    expect(screen.queryByRole("article", { name: "Your role" })).toBeNull();
  });

  it("a changed visible identity shows ONLY 'Your Role Was Updated' until revealed -- no character, no detail", async () => {
    seat({ ownRevealAck: "tok_bbbbbbbbbbbbbbbbbbbbbb" });
    render(<PlayerScreen />);
    const sealed = await screen.findByRole("button", { name: "Tap to reveal your role" });
    expect(sealed).toHaveTextContent("Your Role Was Updated");
    expect(document.body).not.toHaveTextContent(/Chef|good|townsfolk/i);
  });

  it("an acknowledged current identity is the plain sealed card; revealing shows the acknowledgement, no button", async () => {
    seat({ ownRevealAck: TOKEN });
    render(<PlayerScreen />);
    const sealed = await screen.findByRole("button", { name: "Tap to reveal your role" });
    expect(sealed).toHaveTextContent("Tap to reveal your role");
    fireEvent.click(sealed);
    expect(screen.getByRole("article", { name: "Your role" })).not.toHaveClass("ceremony");
    expect(screen.queryByRole("button", { name: "I've Seen My Role" })).toBeNull();
    expect(screen.getByText("✓ The Storyteller knows you've seen your role")).toBeInTheDocument();
  });

  it("the store never persists 'revealed' (re-seal on reload is structural)", () => {
    const persisted = JSON.parse(localStorage.getItem("new-blood-player") ?? "{}");
    expect(persisted.state ?? {}).not.toHaveProperty("revealed");
  });
});

describe("10H-AC-039 / AC-042 (F7, F5): own Life at Night; latest-only From the Storyteller", () => {
  it("at Night the player privately sees their OWN Life while the public Town withholds everyone's", async () => {
    seat({ publicLobby: lobby("night", 2, false), self: { shownRole: "chef", revealToken: TOKEN, life: { alive: false, ghostVote: true } } });
    render(<PlayerScreen />);
    expect(await screen.findByText(/^You:/)).toHaveTextContent("You: Dead · vote available");
    fireEvent.click(screen.getByRole("button", { name: "Town" }));
    expect(document.querySelectorAll(".town-row .life-state-text")).toHaveLength(0);
  });

  it("the latest private information appears once revealed, under From the Storyteller -- no history list", async () => {
    seat({ self: { shownRole: "imp", shownAlignment: "evil", revealToken: TOKEN, extraText: "Latest message", minions: [{ id: "p-bob", name: "Bob", seat: 1 }] } });
    render(<PlayerScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Tap to reveal your role" }));
    const info = screen.getByRole("region", { name: "From the Storyteller" });
    expect(within(info).getByText("Latest message")).toBeInTheDocument();
    expect(within(info).queryByText(/history|earlier|previous/i)).toBeNull();
  });
});

describe("10H-AC-058 (F10): Town notes survive the post-game review until Back to Start", () => {
  it("the ended screen lists this game's notes; Back to start clears them", () => {
    seat({ status: "ended", townNotes: { "ABCD2345:p-bob": { confidence: null, roles: [], text: "Bob seemed nervous" } } });
    const onBack = () => usePlayerStore.getState().reset();
    render(<PlayerEnded result={{ status: "ready", result: { winner: "good", declaredAt: { phase: "day", day: 4 } } } as never} onRetry={() => {}} onBack={onBack} />);
    fireEvent.click(screen.getByText("Your Town notes (1)"));
    expect(screen.getByText(/Bob seemed nervous/)).toBeInTheDocument();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Back to start" })); });
    expect(usePlayerStore.getState().townNotes).toEqual({});
  });
});

// PR-10H-002 (Sol R3): the post-game review shows EVERY non-empty Town note --
// confidence-only, role-only and text notes alike -- with all of its recorded
// content, named from the player-side catalogue, as the player's own guesses.
describe("PR-10H-002: the post-game Town notes review keeps every non-empty note and all of its content", () => {
  const town = (): PublicLobbyRecord => {
    const base = lobby("day", 4);
    const extra = ["p-carol", "p-dave", "p-erin", "p-frank"].map((id, index) => [id, { id, name: id.slice(2, 3).toUpperCase() + id.slice(3), seat: index + 2, online: true, joinedAt: 0, isTraveler: false, alive: true, ghostVote: true }] as const);
    return { ...base, seatOrder: [...base.seatOrder, ...extra.map(([id]) => id)], players: { ...base.players, ...Object.fromEntries(extra) } };
  };
  const NOTES = {
    "ABCD2345:p-bob": { confidence: "suspect" as const, roles: [], text: "" }, // A. confidence only
    "ABCD2345:p-carol": { confidence: null, roles: ["imp", "spy"], text: "" }, // B. role guesses only
    "ABCD2345:p-dave": { confidence: null, roles: [], text: "Claimed Chef, 1 pair" }, // C. text only
    "ABCD2345:p-erin": { confidence: "likely" as const, roles: ["poisoner"], text: "Odd vote" }, // D. all three
    "ABCD2345:p-frank": { confidence: null, roles: [], text: "   " }, // E. truly empty (whitespace)
    "OTHERGAME:p-bob": { confidence: "confirm" as const, roles: ["imp"], text: "other game" }, // H. unrelated game
  };
  function ended(notes: Record<string, unknown> = NOTES) {
    seat({ status: "ended", publicLobby: town(), townNotes: notes as never });
    const onBack = () => usePlayerStore.getState().reset();
    render(<PlayerEnded result={{ status: "ready", result: { winner: "evil", declaredAt: { phase: "day", day: 4 } } }} onRetry={() => {}} onBack={onBack} />);
    fireEvent.click(screen.getByText("Your Town notes (4)"));
    return screen.getAllByRole("listitem");
  }

  it("A-F: confidence-only, role-only, text-only and full notes are all listed in seat order; an empty note is absent", () => {
    const items = ended();
    // F. multiple seats, each identified by name and seat number, in seat order.
    expect(items.map(item => within(item).getByText(/^(Bob|Carol|Dave|Erin)$/).textContent)).toEqual(["Bob", "Carol", "Dave", "Erin"]);
    const [bob, carol, dave, erin] = items as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    // A. confidence only.
    expect(bob).toHaveTextContent(/^Bob seat 2Your confidence: Suspect$/);
    // B. role guesses only, by human-readable name.
    expect(carol).toHaveTextContent(/^Carol seat 3Your role guesses: Imp, Spy$/);
    // C. text only.
    expect(dave).toHaveTextContent(/^Dave seat 4Claimed Chef, 1 pair$/);
    // D. confidence + role + text.
    expect(erin).toHaveTextContent(/^Erin seat 5Your confidence: LikelyYour role guess: PoisonerOdd vote$/);
    // E. the whitespace-only note is not listed (and not counted).
    expect(screen.queryByText(/Frank/)).toBeNull();
    // H. another game's note is never shown here.
    expect(screen.queryByText(/other game/)).toBeNull();
  });

  it("accessible text, not icons: every value is real text; the review is labelled as the player's own guesses", () => {
    ended();
    const review = screen.getByText("Your Town notes (4)").closest("details")!;
    expect(review.querySelectorAll("img")).toHaveLength(0);
    expect(within(review).getByText("Suspect")).toBeVisible();
    expect(within(review).getByText("Your own notes and guesses, not confirmed game information.")).toBeInTheDocument();
    // Never the player's own character (Chef): the one "Chef" is Dave's note text.
    expect(review.textContent!.match(/Chef/g)).toHaveLength(1);
    expect(review).not.toHaveTextContent(/actual|alignment|reminder|effect/i);
  });

  it("an unknown saved RoleId stays understandable; without the public lobby the seat falls back to a generic label", () => {
    seat({ status: "ended", publicLobby: null, townNotes: { "ABCD2345:p-zed": { confidence: null, roles: ["notarole", "imp"], text: "" } } });
    render(<PlayerEnded result={{ status: "none" }} onRetry={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Your Town notes (1)"));
    expect(screen.getByRole("listitem")).toHaveTextContent(/^A seatYour role guesses: Unrecognized character \(notarole\), Imp$/);
  });

  it("G-H: Back to start clears this game's notes -- including confidence/role-only ones -- and keeps another game's", () => {
    ended();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Back to start" })); });
    expect(usePlayerStore.getState().townNotes).toEqual({ "OTHERGAME:p-bob": NOTES["OTHERGAME:p-bob"] });
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
    fireEvent.change(await screen.findByPlaceholderText("XXXX-XXXX"), { target: { value: "ENDD-2345" } });
    fireEvent.change(screen.getByPlaceholderText("Bob"), { target: { value: "Zed" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Knock to join" })); });
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
