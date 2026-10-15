// Package 1: Home front door. Entry paths, Resume/Review gating, the one-time
// Player hand-off, Tablet Trial restrictions, and Character Reference coverage.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HomeScreen } from "./HomeScreen";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { JOIN_PREFILL_KEY, JOIN_PREFILL_TTL_MS, clearJoinPrefill, peekJoinPrefill, writeJoinPrefill } from "./joinPrefill";
import { buildReferenceCategories } from "./referenceCategories";
import { listOfficialRoles } from "@/data/officialRoles";
import { BUILTIN_SCRIPTS } from "@/data/scripts";

const trial = vi.hoisted(() => ({ on: false }));
vi.mock("@/config/trial", () => ({
  get isTabletTrial() { return trial.on; },
  TABLET_TRIAL_OFFLINE_MESSAGE: "This tablet trial is local only. Online lobbies are disabled.",
}));

const ROLES = ["monk", "imp", "empath", "chef", "poisoner", "saint", "washerwoman"];
const liveGame = (over = {}) => setupGame(ROLES, { phase: "night", day: 2, ...over });
const CODE = "BCDF2345";

beforeEach(() => {
  trial.on = false;
  window.sessionStorage.clear();
  store.setState({ game: null, view: "home", customScripts: { [setupScript.id]: setupScript } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const openPath = (name: string) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));

describe("Home entry paths", () => {
  it("offers Player, Storyteller and Character Reference", () => {
    render(<HomeScreen navigate={vi.fn()} />);
    for (const name of ["Player", "Storyteller", "Character Reference"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
  });

  it("opens on the Storyteller panel (tablet-first); Player is one tap away", () => {
    render(<HomeScreen navigate={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "The Grimoire" })).toBeInTheDocument();
    openPath("Player");
    expect(screen.getByRole("heading", { name: "Join the town" })).toBeInTheDocument();
  });

  it("New game opens the existing New Game view", () => {
    render(<HomeScreen navigate={vi.fn()} />);
    openPath("Storyteller");
    fireEvent.click(screen.getByRole("button", { name: "New Game" }));
    expect(store.getState().view).toBe("newgame");
  });
});

describe("Resume / Review gating", () => {
  it("no saved game: neither Resume nor Review appears", () => {
    render(<HomeScreen navigate={vi.fn()} />);
    openPath("Storyteller");
    expect(screen.queryByRole("button", { name: "Resume Game" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Review finished game/ })).toBeNull();
  });

  it("unfinished game: Resume appears and opens the Grimoire; Review does not", () => {
    store.setState({ game: liveGame() });
    render(<HomeScreen navigate={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "The Grimoire" })).toBeInTheDocument(); // defaults to Storyteller
    expect(screen.queryByRole("button", { name: /Review finished game/ })).toBeNull();
    const resume = screen.getByRole("button", { name: "Resume Game" });
    expect(resume).toHaveTextContent("Night 2");
    expect(resume).toHaveTextContent("7 players");
    fireEvent.click(resume);
    expect(store.getState().view).toBe("game");
  });

  it("finished game: Review appears (10G-AC-38), Resume does not, New game still available", () => {
    store.setState({ game: liveGame({ phase: "ended" }) });
    render(<HomeScreen navigate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Resume Game" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Review finished game/ }));
    expect(store.getState().view).toBe("game");
    expect(store.getState().game!.phase).toBe("ended");
    expect(screen.getByRole("button", { name: "New Game" })).toBeInTheDocument();
  });

  it("Public Display sits below Resume and keeps the prompt behaviour", () => {
    store.setState({ game: liveGame() });
    const navigate = vi.fn();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("bcdf-2345");
    render(<HomeScreen navigate={navigate} />);
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(rows.findIndex((t) => t.startsWith("Public Display"))).toBeGreaterThan(rows.findIndex((t) => t.startsWith("Resume Game")));
    fireEvent.click(screen.getByRole("button", { name: /Public Display/ }));
    expect(prompt).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(`?display=public&code=${CODE}`);
  });
});

describe("Player entry and the one-time hand-off", () => {
  const fill = (name: string, code: string) => {
    fireEvent.change(screen.getByPlaceholderText("Write it here"), { target: { value: name } });
    fireEvent.change(screen.getByLabelText(/Game code/), { target: { value: code } });
  };
  const enter = () => screen.getByRole("button", { name: "Enter the Town" });

  it("is disabled until a name and a full 8-character code exist", () => {
    render(<HomeScreen navigate={vi.fn()} />);
    openPath("Player");
    expect(enter()).toBeDisabled();
    fill("Ada", "BCDF234");
    expect(enter()).toBeDisabled();
    fill("", CODE);
    expect(enter()).toBeDisabled();
    fill("Ada", CODE);
    expect(enter()).toBeEnabled();
    expect(screen.getByText("Signed, Ada")).toBeInTheDocument();
  });

  it("caps the name at 20 characters and accepts a hyphenated code", () => {
    render(<HomeScreen navigate={vi.fn()} />);
    openPath("Player");
    expect(screen.getByPlaceholderText("Write it here")).toHaveAttribute("maxLength", "20");
    fill("Ada", "bcdf-2345");
    expect(enter()).toBeEnabled();
  });

  it("navigates with the code only; the name goes to sessionStorage, never the URL", () => {
    const navigate = vi.fn();
    render(<HomeScreen navigate={navigate} />);
    openPath("Player");
    fill("Ada Lovelace", "bcdf-2345");
    fireEvent.click(enter());
    expect(navigate).toHaveBeenCalledTimes(1);
    const url = navigate.mock.calls[0]![0] as string;
    expect(url).toBe(`?join=${CODE}`);
    expect(url).not.toContain("Ada");
    expect(peekJoinPrefill(CODE)).toBe("Ada Lovelace");
  });

  it("does not navigate when invalid", () => {
    const navigate = vi.fn();
    render(<HomeScreen navigate={navigate} />);
    openPath("Player");
    fill("Ada", "BCD");
    fireEvent.submit(enter().closest("form")!);
    expect(navigate).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(JOIN_PREFILL_KEY)).toBeNull();
  });

  it("clears a stale hand-off when Home mounts", () => {
    writeJoinPrefill("Old Name", CODE);
    render(<HomeScreen navigate={vi.fn()} />);
    openPath("Player");
    expect(window.sessionStorage.getItem(JOIN_PREFILL_KEY)).toBeNull();
  });

  it("Player path exposes no Storyteller-only information", () => {
    store.setState({ game: liveGame() });
    render(<HomeScreen navigate={vi.fn()} />);
    openPath("Player");
    const panel = screen.getByRole("heading", { name: "Join the town" }).closest("form")!;
    expect(panel.textContent).not.toMatch(/Resume|Night|players|Grimoire|Setup test/);
    for (const id of ROLES) expect(panel.textContent!.toLowerCase()).not.toContain(id);
  });
});

describe("join prefill store", () => {
  it("is bound to its lobby code, expires, and clears", () => {
    expect(writeJoinPrefill("Ada", CODE, 1000)).toBe(true);
    expect(peekJoinPrefill(CODE, 1000 + 1)).toBe("Ada");
    expect(peekJoinPrefill("ZZZZ2345", 1001)).toBeNull();            // unrelated join
    expect(peekJoinPrefill(CODE, 1000 + JOIN_PREFILL_TTL_MS + 1)).toBeNull(); // stale
    expect(peekJoinPrefill(undefined, 1001)).toBeNull();
    clearJoinPrefill();
    expect(peekJoinPrefill(CODE, 1001)).toBeNull();
  });
  it("refuses an invalid name/code and tolerates corrupt storage", () => {
    expect(writeJoinPrefill("", CODE)).toBe(false);
    expect(writeJoinPrefill("x".repeat(21), CODE)).toBe(false);
    expect(writeJoinPrefill("Ada", "SHORT")).toBe(false);
    window.sessionStorage.setItem(JOIN_PREFILL_KEY, "{not json");
    expect(peekJoinPrefill(CODE)).toBeNull();
    window.sessionStorage.setItem(JOIN_PREFILL_KEY, JSON.stringify({ name: 5, code: CODE, at: Date.now() }));
    expect(peekJoinPrefill(CODE)).toBeNull();
  });
});

describe("Tablet Trial restrictions", () => {
  beforeEach(() => { trial.on = true; });
  it("disables online entry: no join form, Public Display disabled, offline message shown", () => {
    render(<HomeScreen navigate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Enter the Town" })).toBeNull();
    expect(screen.getByText(/Online lobbies are disabled/)).toBeInTheDocument();
    openPath("Storyteller");
    expect(screen.getByRole("button", { name: /Public Display/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New Game" })).toBeEnabled();
  });
});

describe("Character Reference", () => {
  it("every official character is in exactly one category", () => {
    const all = listOfficialRoles();
    const cats = buildReferenceCategories();
    expect(cats.map((c) => c.id)).toEqual(["tb", "bmr", "snv", "carousel"]);
    const seen = new Map<string, number>();
    for (const c of cats) for (const r of c.roles) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
    expect(seen.size).toBe(all.length);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
    for (const r of all) expect(seen.has(r.id)).toBe(true);
  });
  it("edition categories hold their script plus that edition's Travellers; Carousel holds the rest", () => {
    const cats = Object.fromEntries(buildReferenceCategories().map((c) => [c.id, c]));
    for (const id of ["tb", "bmr", "snv"] as const) {
      expect(cats[id]!.scriptCount).toBe(BUILTIN_SCRIPTS[id]!.characters.length);
      for (const r of cats[id]!.roles) expect(r.edition).toBe(id);
      expect(cats[id]!.roles.filter((r) => r.type === "traveler").length).toBe(cats[id]!.travelerCount);
    }
    const carousel = cats.carousel!.roles;
    expect(carousel.every((r) => !["tb", "bmr", "snv"].includes(r.edition ?? ""))).toBe(true);
    expect(carousel.some((r) => r.type === "fabled")).toBe(true);
    expect(carousel.some((r) => r.type === "loric")).toBe(true);
    expect(carousel.some((r) => r.edition === "experimental")).toBe(true);
  });
  it("a tile opens the existing Almanac filtered to that category", () => {
    render(<HomeScreen navigate={vi.fn()} />);
    openPath("Character Reference");
    expect(screen.getAllByRole("button", { name: /Trouble Brewing|Bad Moon Rising|Sects & Violets|The Carousel/ })).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: /Trouble Brewing/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Character reference — Trouble Brewing/)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/Washerwoman/).length).toBeGreaterThan(0);
    expect(within(dialog).queryByText(/^Grandmother$/)).toBeNull(); // Bad Moon Rising only
  });
});
