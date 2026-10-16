// Package 2C: Step III of the New Game flow against the real store, the shared
// Go Live and the in-memory lobby backend. No Firebase is contacted.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import type { RoomBackend } from "@/firebase/backend";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { knockOnLobby } from "@/firebase/lobby";
import { presencePath } from "@/firebase/paths";
import { sessionPath } from "@/firebase/lifecycle";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { StorytellerSession } from "@/firebase/StorytellerSession";
import { NewGameScreen } from "./NewGameScreen";
import { buildPlayerJoinLink, qrModules } from "./qr";

const env = vi.hoisted(() => ({ backend: null as RoomBackend | null, configured: true, connects: 0 }));
vi.mock("@/firebase/session", () => ({
  connectFirebase: async () => {
    env.connects++;
    if (!env.backend) throw new Error("Firebase is not configured.");
    return { backend: env.backend, uid: "host" };
  },
}));
vi.mock("@/firebase/config", async (original) => ({
  ...(await original<typeof import("@/firebase/config")>()),
  isFirebaseConfigured: () => env.configured,
}));

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const reset = () => {
  store.setState({ game: null, lobby: null, undoStack: [], sync: null, localSeq: 0, view: "newgame", terminalClose: null, customScripts: {} });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, joined: [], pending: 0, retry: 0, status: "idle", failure: null, closeFailed: false, leaveOffer: null, unattachedCleanupFailures: [] });
  try { sessionStorage.clear(); } catch { /* ignore */ }
};
beforeEach(() => {
  env.backend = null; env.configured = true; env.connects = 0;
  reset();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ui = () => render(<><StorytellerSession /><NewGameScreen /></>);
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const toStepThree = (opts: { more?: number; extras?: string[] } = {}) => {
  press("Trouble Brewing");
  for (let i = 0; i < (opts.more ?? 0); i++) press("One more player");
  press(/Fabled & Loric ›/);
  for (const id of opts.extras ?? []) press(id);
  press(/(Skip|Continue) to players ›/);
};
const nameSeats = (names: string[]) => names.forEach((name, i) => fireEvent.change(screen.getByLabelText(`Seat ${ROMAN[i]}`), { target: { value: name } }));

describe("Step III: choose", () => {
  it("offers Invite to phones and Play offline, with no CTA, and creates nothing", () => {
    ui();
    toStepThree();
    expect(screen.getByRole("heading", { name: "How will the town gather?" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Invite to phones/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Play offline/ })).toBeVisible();
    expect(store.getState().game).toBeNull();
    expect(env.connects).toBe(0);
  });

  it("Back from the choice returns to Step II with the choices kept", () => {
    ui();
    toStepThree({ extras: ["Angel"] });
    press(/Back/);
    expect(screen.getByRole("heading", { name: "Fabled & Loric" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Angel" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Step III: Offline, Seat the town", () => {
  const offline = (more = 0) => { ui(); toStepThree({ more, extras: ["Angel", "Bootlegger"] }); press(/Play offline/); };

  it("shows one named seat input per player (names up to 20) and a disabled CTA until 5 are named", () => {
    offline();
    expect(screen.getAllByRole("textbox")).toHaveLength(10);
    expect(screen.getByLabelText("Seat I")).toHaveAttribute("maxlength", "20");
    expect(screen.getByLabelText("Seat I")).toHaveAttribute("placeholder", "Seat I…");
    expect(screen.getByRole("button", { name: "Begin the night" })).toBeDisabled();
    expect(screen.getByText("Name at least 5 seats to begin.")).toHaveClass("sr-only");
    expect(screen.getByText("0 of 10 named · empty seats keep their number.")).toBeVisible();
    nameSeats(["Bram", "Odile", "Fenwick", "Marisol"]);
    expect(screen.getByRole("button", { name: "Begin the night" })).toBeDisabled();
    nameSeats(["Bram", "Odile", "Fenwick", "Marisol", "  "]);
    expect(screen.getByRole("button", { name: "Begin the night" })).toBeDisabled(); // blank is not a name
    nameSeats(["Bram", "Odile", "Fenwick", "Marisol", "Tobias"]);
    expect(screen.getByRole("button", { name: "Begin the night" })).toBeEnabled();
  });

  it("the status line and rail follow the names; a full table reads 'Every seat is named.'", () => {
    offline();
    nameSeats(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
    expect(screen.getByText("Every seat is named.")).toBeVisible();
    expect(within(screen.getByRole("navigation", { name: "Setup progress" })).getByText("10 of 10 named")).toBeVisible();
  });

  it("Begin the night creates one game with the seat names seated in order and opens the Grimoire; no Firebase is touched", async () => {
    offline(2); // 12 players
    fireEvent.change(screen.getByLabelText("Seat III"), { target: { value: "Fenwick" } });
    nameSeats(["Bram", "Odile", "Fenwick", "", "Tobias", "Wren", "Ingrid"]);
    press("Begin the night");
    await waitFor(() => expect(store.getState().view).toBe("game"));
    const { game, lobby } = store.getState();
    expect(env.connects).toBe(0);
    expect(lobby).toBeNull();
    expect(game!.phase).toBe("setup");
    expect(game!.plannedPlayerCount).toBe(12);
    expect(game!.fabled).toEqual(["angel"]);
    expect(game!.lorics).toEqual(["bootlegger"]);
    const seats = game!.seatOrder.map((id) => game!.players[id]!);
    expect(seats.map((p) => p.name)).toEqual(["Bram", "Odile", "Fenwick", "", "Tobias", "Wren", "Ingrid", "", "", "", "", ""]);
    expect(seats.filter((p) => !p.isEmpty)).toHaveLength(6);
  });

  it("Back returns to the choice and the typed names are kept for this flow", () => {
    offline();
    nameSeats(["Bram", "Odile"]);
    press(/Back/);
    expect(screen.getByRole("heading", { name: "How will the town gather?" })).toBeVisible();
    press(/Play offline/);
    expect((screen.getByLabelText("Seat II") as HTMLInputElement).value).toBe("Odile");
    expect(store.getState().game).toBeNull();
  });

  it("an existing game asks before it is replaced; declining changes nothing", async () => {
    store.getState().newGame("tb", { plannedPlayerCount: 7, keepView: true });
    const before = store.getState().game;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    offline();
    nameSeats(["A", "B", "C", "D", "E"]);
    press("Begin the night");
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(store.getState().game).toBe(before);
    expect(store.getState().view).toBe("newgame");
    confirm.mockReturnValue(true);
    press("Begin the night");
    await waitFor(() => expect(store.getState().view).toBe("game"));
    expect(store.getState().game).not.toBe(before);
  });
});

describe("Step III: Live, Invite to phones", () => {
  const live = async (more = 0) => {
    const b = new MemoryRoomBackend();
    env.backend = b;
    ui();
    toStepThree({ more, extras: ["Djinn"] });
    press(/Invite to phones/);
    await waitFor(() => expect(store.getState().lobby).not.toBeNull());
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
    const code = store.getState().lobby!.code;
    const knock = async (uid: string, name: string) => {
      await knockOnLobby(b, code, uid, name);
      await b.set(presencePath(code, uid), { online: true, lastSeen: Date.now() });
    };
    return { b, code, knock };
  };

  it("creates the lobby only now, shows the real 8-character code and a QR that encodes the join link", async () => {
    expect(store.getState().lobby).toBeNull();
    const { code } = await live();
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
    expect(screen.getByRole("heading", { name: "Invite the town" })).toBeVisible();
    expect(screen.getByLabelText(`Join code ${code.split("").join(" ")}`)).toHaveTextContent(code);
    const qr = screen.getByRole("img", { name: /^QR code to join with code/ });
    expect(qr.querySelector("path")?.getAttribute("d")?.length ?? 0).toBeGreaterThan(200);
    expect(store.getState().view).toBe("newgame");
    const game = store.getState().game!;
    expect(game.phase).toBe("setup");
    expect(game.fabled).toEqual(["djinn"]);
    expect(Object.values(game.players).every((p) => p.isEmpty)).toBe(true);
  });

  it("the join link is the app's own ?join=CODE and the QR matrix is deterministic and square", () => {
    expect(buildPlayerJoinLink({ origin: "https://example.test", pathname: "/play/" }, "BCDF7Q3Z")).toBe("https://example.test/play/?join=BCDF7Q3Z");
    const a = qrModules("https://example.test/?join=BCDF7Q3Z");
    expect(a.length).toBeGreaterThanOrEqual(21);
    expect(a.every((row) => row.length === a.length)).toBe(true);
    expect(qrModules("https://example.test/?join=BCDF7Q3Z")).toEqual(a);
  });

  it("arrivals appear as people join (named, distinct, nobody seated); Begin stays disabled until 5", async () => {
    const { knock } = await live();
    const begin = () => screen.getByRole("button", { name: /^Begin/ });
    expect(begin()).toBeDisabled();
    expect(screen.getByText("0 of 10")).toBeVisible();
    for (const [i, name] of ["Bram", "Odile", "Fenwick", "Marisol"].entries()) await act(async () => { await knock(`u${i}`, name); });
    await waitFor(() => expect(screen.getByText("4 of 10")).toBeVisible());
    expect(screen.getByText("Bram")).toBeVisible();
    expect(begin()).toHaveTextContent("Begin with 4");
    expect(begin()).toBeDisabled();
    await act(async () => { await knock("u0", "Bram"); }); // a repeated knock is not a second arrival
    expect(screen.getByText("4 of 10")).toBeVisible();
    await act(async () => { await knock("u4", "Tobias"); });
    await waitFor(() => expect(begin()).toBeEnabled());
    expect(begin()).toHaveTextContent("Begin with 5");
    expect(within(screen.getByRole("navigation", { name: "Setup progress" })).getByText("5 of 10 arrived")).toBeVisible();
    const game = store.getState().game!;
    expect(Object.values(game.players).every((p) => p.isEmpty)).toBe(true);
  });

  it("Begin enters the Grimoire without starting night one, keeping the lobby and the waiting players", async () => {
    const { knock, code } = await live();
    for (let i = 0; i < 5; i++) await act(async () => { await knock(`u${i}`, `P${i}`); });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Begin/ })).toBeEnabled());
    press(/^Begin with 5/);
    expect(store.getState().view).toBe("game");
    expect(store.getState().game!.phase).toBe("setup");
    expect(store.getState().lobby?.code).toBe(code);
    expect(Object.keys(store.getState().game!.pendingPlayers)).toHaveLength(5);
  });

  it("becomes 'Begin the night' once everyone planned has arrived", async () => {
    const { knock } = await live();
    for (let i = 0; i < 10; i++) await act(async () => { await knock(`u${i}`, `P${i}`); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Begin the night" })).toBeEnabled());
  });

  it("more people than planned seats are all listed, none dropped", async () => {
    const { knock } = await live();
    for (let i = 0; i < 11; i++) await act(async () => { await knock(`u${i}`, `P${i}`); });
    await waitFor(() => expect(screen.getByText("11 of 10")).toBeVisible());
    expect(screen.getAllByRole("listitem").filter((li) => li.classList.contains("sf-pill-here"))).toHaveLength(11);
  });

  it("Back with nobody joined closes the lobby authoritatively, then discards the setup game", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const { b, code } = await live();
    press(/Back/);
    await waitFor(() => expect(screen.getByRole("heading", { name: "How will the town gather?" })).toBeVisible());
    expect(confirm).not.toHaveBeenCalled();
    expect(await b.get(sessionPath(code))).toMatchObject({ state: "ended" });
    expect(store.getState().lobby).toBeNull();
    expect(store.getState().game).toBeNull();
  });

  it("Back with players joined asks first; declining keeps the lobby and the game", async () => {
    const { b, code, knock } = await live();
    await act(async () => { await knock("u0", "Bram"); });
    await waitFor(() => expect(screen.getByText("1 of 10")).toBeVisible());
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    press(/Back/);
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(store.getState().lobby?.code).toBe(code);
    expect(store.getState().game).not.toBeNull();
    expect(await b.get(sessionPath(code))).toMatchObject({ state: "active" });
    expect(screen.getByRole("heading", { name: "Invite the town" })).toBeVisible();
    confirm.mockReturnValue(true);
    press(/Back/);
    await waitFor(() => expect(screen.getByRole("heading", { name: "How will the town gather?" })).toBeVisible());
    expect(await b.get(sessionPath(code))).toMatchObject({ state: "ended" });
    expect(store.getState().game).toBeNull();
  });

  it("Back also asks when the joined list reads empty but somebody is waiting or presence is unreadable", async () => {
    const { code } = await live();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    act(() => { store.setState({ game: { ...store.getState().game!, pendingPlayers: { u9: "Wren" } } }); });
    press(/Back/);
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    act(() => { store.setState({ game: { ...store.getState().game!, pendingPlayers: {} } }); useSessionRuntime.setState({ presence: "error", joined: [] }); });
    press(/Back/);
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(store.getState().lobby?.code).toBe(code);
  });

  it("a close the server denies keeps the Live screen, the lobby and the game; nothing is discarded", async () => {
    const { b, code } = await live();
    const update = b.update.bind(b);
    b.update = async (updates) => { if (Object.keys(updates).some((p) => p.endsWith("/session"))) throw new Error("denied"); return update(updates); };
    press(/Back/);
    await waitFor(() => expect(useSessionRuntime.getState().closeFailed).toBe(true));
    expect(screen.getByRole("heading", { name: "Invite the town" })).toBeVisible();
    expect(store.getState().lobby?.code).toBe(code);
    expect(store.getState().game).not.toBeNull();
    // The shared connection banner is shown on this screen, with its recovery action.
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be ended/i);
    b.update = update;
  });

  it("the Home pill is Back on later steps; the rail step I closes the lobby first and returns to Step I", async () => {
    const { b, code } = await live();
    within(screen.getByRole("navigation", { name: "Setup progress" })).getByRole("button", { name: /Script & Players/ }).click();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Choose a script" })).toBeVisible());
    expect(await b.get(sessionPath(code))).toMatchObject({ state: "ended" });
    expect(store.getState().game).toBeNull();
  });

  it("Firebase not configured opens the existing settings dialog and creates no lobby; the setup game stays for a retry", async () => {
    env.configured = false;
    ui();
    toStepThree();
    press(/Invite to phones/);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
    expect(env.connects).toBe(0);
    expect(store.getState().lobby).toBeNull();
    expect(store.getState().game?.phase).toBe("setup");
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("a failed connection shows a retry on the Live screen; retrying attaches the lobby", async () => {
    ui();
    toStepThree();
    press(/Invite to phones/); // no backend: connect fails
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled());
    expect(store.getState().lobby).toBeNull();
    env.backend = new MemoryRoomBackend();
    press("Try again");
    await waitFor(() => expect(store.getState().lobby).not.toBeNull());
    await waitFor(() => expect(screen.getByLabelText(/^Join code/)).toBeVisible());
  });

  it("a refresh on the Live screen restores it from the persisted setup game and lobby", async () => {
    const { code } = await live(2);
    cleanup();
    useSessionRuntime.setState({ joined: [], status: "idle", presence: "unknown", online: {} });
    ui();
    expect(screen.getByRole("heading", { name: "Invite the town" })).toBeVisible();
    expect(screen.getByLabelText(`Join code ${code.split("").join(" ")}`)).toBeVisible();
    expect(screen.getByText("0 of 12")).toBeVisible();
  });

  it("without the Live-screen marker (arriving from Home) a leftover game is not restored", () => {
    store.getState().newGame("tb", { plannedPlayerCount: 7, keepView: true });
    ui();
    expect(screen.getByRole("heading", { name: "Choose a script" })).toBeVisible();
  });
});
