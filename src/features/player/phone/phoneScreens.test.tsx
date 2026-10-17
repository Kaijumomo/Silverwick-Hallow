// Package 3 (3A): the phone player screens -- Home, Sign in, Waiting (public
// arrivals) and the connection / access / leave / end states. The Firebase
// handshake itself is covered elsewhere; here the store states and the
// screen-to-store mapping are pinned.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { usePlayerStore } from "@/stores/playerStore";
import { __setEnvOverrideForTests, clearFirebaseConfig, saveFirebaseConfig } from "@/firebase/config";

vi.mock("@/firebase/playerSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/playerSync")>();
  return { ...actual, usePlayerSync: () => {}, leaveLobby: vi.fn(async () => {}), joinLobby: vi.fn(async () => {}) };
});
const connection = vi.hoisted(() => ({ backend: null as unknown, hang: false, fail: false }));
vi.mock("@/firebase/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/session")>();
  return {
    ...actual,
    connectFirebase: async () => {
      if (connection.hang) await new Promise(() => {});
      if (connection.fail) throw new Error("offline");
      return { backend: connection.backend as never, uid: "alice" };
    },
  };
});

import { joinLobby, leaveLobby } from "@/firebase/playerSync";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { PlayerScreen } from "../PlayerScreen";
import { PhoneHome } from "./PhoneHome";
import { arrivalCountText, arrivalRows } from "./WaitingScreen";
import { formatCode } from "./PhoneStates";

const validCfg = { apiKey: "AIzaSyTEST", databaseURL: "https://example-default-rtdb.firebaseio.com", projectId: "example-project" };

/** Lets the screen's own connection attempt finish (the backend it leaves with). */
const connected = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const lobby = (extra: Record<string, unknown> = {}) => ({
  code: "WICK7Q3M", scriptId: "tb", phase: "setup" as const, day: 0, seatOrder: [] as string[], players: {}, fabled: [], lorics: [], ...extra,
});

function seed(patch: Record<string, unknown>) {
  usePlayerStore.setState({
    code: "WICK7Q3M", uid: "alice", playerId: null, requestedName: "Bram", status: "waiting", error: null, self: null,
    publicLobby: lobby() as never, revealed: false,
    remoteData: { public: "ready", self: "ready", membership: "ready", request: "ready" },
    ...patch,
  } as never);
}

beforeEach(() => {
  connection.backend = new MemoryRoomBackend();
  connection.hang = false;
  connection.fail = false;
  __setEnvOverrideForTests({});
  saveFirebaseConfig(validCfg);
  usePlayerStore.getState().reset();
  vi.mocked(leaveLobby).mockClear();
  vi.mocked(joinLobby).mockClear();
});
afterEach(() => { cleanup(); clearFirebaseConfig(); __setEnvOverrideForTests(null); });

describe("PhoneHome (D9): Player and Character Reference only", () => {
  it("offers exactly the two player paths and no Storyteller", () => {
    const onPick = vi.fn();
    render(<PhoneHome onPick={onPick} />);
    expect(screen.getByRole("button", { name: /Player/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Character Reference/ })).toBeInTheDocument();
    expect(screen.queryByText("Storyteller")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Player/ }));
    expect(onPick).toHaveBeenCalledWith("player");
  });
});

describe("waiting lobby rows (A1)", () => {
  it("marks the player's own row once, keeps arrival order, and always shows the player", () => {
    expect(arrivalRows(["Ada", "Bram", "Cleo"], "Bram")).toEqual([
      { name: "Ada", you: false }, { name: "Bram", you: true }, { name: "Cleo", you: false },
    ]);
    // The public list has not caught up yet: the player still sees themselves.
    expect(arrivalRows(["Ada"], "Bram")).toEqual([{ name: "Ada", you: false }, { name: "Bram", you: true }]);
    expect(arrivalRows(undefined, "Bram")).toEqual([{ name: "Bram", you: true }]);
  });

  it("a duplicate name marks only the first match as YOU", () => {
    const rows = arrivalRows(["Sam", "Sam"], "Sam");
    expect(rows.filter((r) => r.you)).toHaveLength(1);
  });

  it("counts against the planned total only when it is known and sensible", () => {
    const rows = arrivalRows(["Ada", "Bram"], "Bram");
    expect(arrivalCountText(rows, 12)).toBe("2 of 12 arrived");
    expect(arrivalCountText(rows, undefined)).toBe("2 arrived");
    expect(arrivalCountText(rows, 1)).toBe("2 arrived");
  });
});

describe("Sign in (design screens 02-03)", () => {
  it("normalises the code, caps the name, and enables Enter only for a name plus eight characters", async () => {
    render(<PlayerScreen goHome={() => {}} />);
    const name = await screen.findByLabelText("Your name");
    const code = screen.getByLabelText("Game code");
    const enter = screen.getByRole("button", { name: /Enter the Town/ });
    expect(enter).toBeDisabled();
    expect(screen.getByText("Enter your name to continue")).toBeInTheDocument();

    fireEvent.change(name, { target: { value: "x".repeat(30) } });
    expect((name as HTMLInputElement).value).toHaveLength(20);
    fireEvent.change(name, { target: { value: "Bram" } });
    fireEvent.change(code, { target: { value: "wick-7q3" } });
    expect((code as HTMLInputElement).value).toBe("WICK7Q3");
    expect(enter).toBeDisabled();
    expect(screen.getByText("Enter the 8-letter game code")).toBeInTheDocument();

    fireEvent.change(code, { target: { value: "wick7q3mzz" } });
    expect((code as HTMLInputElement).value).toBe("WICK7Q3M");
    expect(enter).toBeEnabled();
    expect(screen.getByText("Signed, Bram")).toBeInTheDocument();
  });

  it("submits the canonical code and name to the existing join", async () => {
    render(<PlayerScreen goHome={() => {}} />);
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Bram" } });
    fireEvent.change(screen.getByLabelText("Game code"), { target: { value: "wick7q3m" } });
    fireEvent.click(screen.getByRole("button", { name: /Enter the Town/ }));
    await waitFor(() => expect(joinLobby).toHaveBeenCalledTimes(1));
    expect(vi.mocked(joinLobby).mock.calls[0]!.slice(1, 2)).toEqual(["WICK7Q3M"]);
    expect(vi.mocked(joinLobby).mock.calls[0]![3]).toBe("Bram");
  });

  it("Home goes back without joining", async () => {
    const goHome = vi.fn();
    render(<PlayerScreen goHome={goHome} />);
    fireEvent.click(await screen.findByRole("button", { name: /Home/ }));
    expect(goHome).toHaveBeenCalled();
    expect(joinLobby).not.toHaveBeenCalled();
  });

  it("shows Connecting while the connection is still being made, never a usable join form", async () => {
    connection.hang = true;
    render(<PlayerScreen goHome={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Connecting…" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Your name")).toBeNull();
  });

  it("a failed connection is the Lobby unavailable screen with Retry and Cancel", async () => {
    connection.fail = true;
    render(<PlayerScreen goHome={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Lobby unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry connection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel / request to leave" })).toBeInTheDocument();
  });

  it("a join-time error stays inline on Sign in", async () => {
    render(<PlayerScreen goHome={() => {}} />);
    await screen.findByLabelText("Your name");
    usePlayerStore.getState().setStatus("error", "Not connected to Firebase yet — try again in a moment.");
    expect(await screen.findByRole("alert")).toHaveTextContent("Not connected to Firebase yet");
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
  });
});

describe("Waiting (design screen 04)", () => {
  it("lists everyone who has arrived, marks YOU, shows the count, and leaks nothing else", () => {
    seed({ publicLobby: lobby({ arrivals: ["Ada", "Bram", "Cleo"], plannedPlayers: 12 }) });
    render(<PlayerScreen goHome={() => {}} />);
    expect(screen.getByRole("heading", { name: /Welcome, Bram/ })).toBeInTheDocument();
    expect(screen.getByText("3 of 12 arrived")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["Ada", "BramYou", "Cleo"]);
    expect(screen.getByText("Waiting for the Storyteller")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/uid|seat \d/i);
  });

  it("Leave town uses the existing leave command", async () => {
    seed({ publicLobby: lobby({ arrivals: ["Bram"], plannedPlayers: 8 }) });
    render(<PlayerScreen goHome={() => {}} />);
    await connected();
    fireEvent.click(screen.getByRole("button", { name: /Leave town/ }));
    expect(leaveLobby).toHaveBeenCalledTimes(1);
  });
});

describe("connection, access, leave and end screens (D11)", () => {
  const heading = (name: string) => screen.getByRole("heading", { name });

  it("knocking, reconnecting and the data-unavailable failure", () => {
    seed({ status: "reconnecting" });
    render(<PlayerScreen goHome={() => {}} />);
    expect(heading("Reconnecting…")).toBeInTheDocument();
    expect(screen.getByText(/Your character stays hidden until you are back/)).toBeInTheDocument();
    expect(screen.getByText(/WICK·7Q3M · Bram/)).toBeInTheDocument();
    cleanup();
    seed({ status: "seated", remoteData: { public: "error", self: "ready", membership: "ready", request: "ready" } });
    render(<PlayerScreen goHome={() => {}} />);
    expect(heading("Game data unavailable")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't receive game data. Check your connection and try again.");
  });

  it("reconnecting renders nothing private", () => {
    seed({
      status: "reconnecting", playerId: "p-bram",
      self: { shownRole: "imp", shownAlignment: "evil", revealToken: "tok_aaaaaaaaaaaaaaaaaaaaaa" },
    });
    render(<PlayerScreen goHome={() => {}} />);
    expect(document.body.textContent).not.toMatch(/imp|evil/i);
  });

  it("error shows the store's message with Retry and Cancel; notFound only Back to start", async () => {
    seed({ status: "error", error: "Connection lost. Check your network and retry." });
    render(<PlayerScreen goHome={() => {}} />);
    await connected();
    expect(heading("Lobby unavailable")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost. Check your network and retry.");
    expect(screen.getByRole("button", { name: "Retry connection" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel / request to leave" }));
    expect(leaveLobby).toHaveBeenCalled();
    cleanup();
    seed({ status: "notFound", error: "This lobby does not exist or has expired." });
    render(<PlayerScreen goHome={() => {}} />);
    expect(screen.queryByRole("button", { name: "Retry connection" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back to start" })).toBeInTheDocument();
  });

  it("rejected and revoked reset the store and go Home", () => {
    const goHome = vi.fn();
    seed({ status: "rejected", error: "Your join request was rejected." });
    render(<PlayerScreen goHome={goHome} />);
    expect(heading("Not admitted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to start" }));
    expect(goHome).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().status).toBe("idle");
    cleanup();
    seed({ status: "revoked", error: "Removed from lobby.", playerId: "p-bram",
      publicLobby: lobby({ seatOrder: ["p-bram"], players: { "p-bram": { id: "p-bram", name: "Bram", seat: 1, online: true, joinedAt: 0, isTraveler: false } } }) });
    render(<PlayerScreen goHome={goHome} />);
    expect(heading("Access revoked")).toBeInTheDocument();
    expect(screen.getByText("WICK·7Q3M · Bram")).toBeInTheDocument();
  });

  it("leaving shows the seat ring and the verbatim pending copy", () => {
    seed({ status: "leaving", playerId: "p-bram",
      publicLobby: lobby({ phase: "night", seatOrder: ["p-bram"], players: { "p-bram": { id: "p-bram", name: "Bram", seat: 1, online: true, joinedAt: 0, isTraveler: false } } }) });
    render(<PlayerScreen goHome={() => {}} />);
    expect(heading("Leave request pending")).toBeInTheDocument();
    expect(screen.getByText("Your seat is still reserved. Waiting for the Storyteller to accept or decline your request.")).toBeInTheDocument();
    expect(screen.getByText("WICK·7Q3M · Seat 2")).toBeInTheDocument();
  });

  it("ending, and each ended variant", () => {
    seed({ status: "ending" });
    render(<PlayerScreen goHome={() => {}} />);
    expect(heading("Ending…")).toBeInTheDocument();
    cleanup();
    const ended = (terminalResult: unknown) => seed({ status: "ended", terminalResult });
    ended({ status: "ready", result: { winner: "good", declaredAt: { day: 6, phase: "day" } } });
    render(<PlayerScreen goHome={() => {}} />);
    expect(heading("Good wins")).toBeInTheDocument();
    expect(screen.getByText("The Storyteller declared Good victory on Day 6.")).toBeInTheDocument();
    cleanup();
    ended({ status: "ready", result: { winner: "evil", declaredAt: { day: 4, phase: "night" } } });
    render(<PlayerScreen goHome={() => {}} />);
    expect(heading("Evil wins")).toBeInTheDocument();
    cleanup();
    ended({ status: "none" });
    render(<PlayerScreen goHome={() => {}} />);
    expect(screen.getByText("The Storyteller has ended the game. Thanks for playing!")).toBeInTheDocument();
    cleanup();
    ended({ status: "pending" });
    render(<PlayerScreen goHome={() => {}} />);
    expect(screen.getByText("Reading the final result…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to start" })).toBeInTheDocument();
    cleanup();
    ended({ status: "error", message: "Connection lost." });
    render(<PlayerScreen goHome={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't read the final result. Connection lost.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("formatCode", () => {
  it("shows the code as the design does", () => {
    expect(formatCode("WICK7Q3M")).toBe("WICK·7Q3M");
    expect(formatCode("AB")).toBe("AB");
  });
});
