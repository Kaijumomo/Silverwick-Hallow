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
    const panel = screen.getByRole("form", { name: "Join the town" });
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
  it("tiles show only the design's single line of text; names stay as accessible labels", () => {
    render(<HomeScreen navigate={vi.fn()} />);
    openPath("Character Reference");
    const tiles = [...document.querySelectorAll(".home-door-tile")];
    expect(tiles.map((t) => t.querySelector(".home-door-tile-count")!.textContent)).toEqual(["22 characters", "25 characters", "25 characters", "Experimental"]);
    expect(tiles.every((t) => !/Travellers|Trouble Brewing|Carousel/.test(t.querySelector(".home-door-tile-count")!.textContent!))).toBe(true);
    expect(tiles.map((t) => t.getAttribute("aria-label"))).toEqual(["Trouble Brewing", "Bad Moon Rising", "Sects & Violets", "The Carousel"]);
  });
  it("a tile opens the Reference overlay for that category and Home closes behind it", () => {
    render(<HomeScreen navigate={vi.fn()} />);
    openPath("Character Reference");
    expect(screen.getAllByRole("button", { name: /Trouble Brewing|Bad Moon Rising|Sects & Violets|The Carousel/ })).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: /Trouble Brewing/ }));
    const dialog = screen.getByRole("dialog", { name: /Character reference: Trouble Brewing/ });
    expect(within(dialog).getAllByText(/Washerwoman/).length).toBeGreaterThan(0);
    expect(within(dialog).queryByText(/^Grandmother$/)).toBeNull(); // Bad Moon Rising only
    fireEvent.click(within(dialog).getByRole("button", { name: /Home/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps the chosen team tab when another script is opened, as the design does", () => {
    render(<HomeScreen navigate={vi.fn()} />);
    openPath("Character Reference");
    fireEvent.click(screen.getByRole("button", { name: /Trouble Brewing/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Demons/ }));
    fireEvent.click(screen.getByRole("button", { name: /Home/ }));
    fireEvent.click(screen.getByRole("button", { name: /Sects & Violets/ }));
    expect(screen.getByRole("button", { name: /^Demons/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Home/ }));
    // The Carousel has Fabled; a script without that team falls back to its first team.
    fireEvent.click(screen.getByRole("button", { name: /The Carousel/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Fabled/ }));
    fireEvent.click(screen.getByRole("button", { name: /Home/ }));
    fireEvent.click(screen.getByRole("button", { name: /Trouble Brewing/ }));
    expect(screen.getByRole("button", { name: /^Townsfolk/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Package 3 (D9): phone Home", () => {
  const phone = (matches: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: matches && query.includes("760"), media: query, addEventListener() {}, removeEventListener() {} }));
  afterEach(() => { vi.unstubAllGlobals(); });

  it("on a phone shows only Player and Character Reference, and Player opens the join screen", () => {
    phone(true);
    const navigate = vi.fn();
    render(<HomeScreen navigate={navigate} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByText("Storyteller")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Player/ }));
    expect(navigate).toHaveBeenCalledWith("?join=");
  });

  it("on a phone Character Reference opens the script picker, then a script's reference", () => {
    phone(true);
    render(<HomeScreen navigate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Character Reference/ }));
    expect(screen.getByRole("heading", { name: "Character Reference" })).toBeInTheDocument();
    // Its own screen: Home is not rendered underneath (nothing to scroll past).
    expect(screen.queryByRole("heading", { name: /Silverwick/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Player/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(screen.getByRole("button", { name: /^Player/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Character Reference/ }));
    fireEvent.click(screen.getByRole("button", { name: "Trouble Brewing" }));
    // Design screens 23 to 26: Scripts back button, three tabs, compact rows, card on tap.
    expect(screen.getByRole("button", { name: /Scripts/ })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([expect.stringMatching(/^Characters\d+$/), expect.stringMatching(/^First night\d+$/), expect.stringMatching(/^Other nights\d+$/)]);
    fireEvent.click(screen.getByRole("tab", { name: /First night/ }));
    expect(screen.getByRole("tab", { name: /First night/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Dusk")).toBeInTheDocument();
    // Phone design: the night tab counts list every row, including the four night-sheet steps.
    const rows = document.querySelectorAll(".swp-rs-night > li").length;
    expect(screen.getByRole("tab", { name: /First night/ })).toHaveTextContent(`First night${rows}`);
    expect([...document.querySelectorAll(".swp-rs-nrow-step .swp-rs-nicon-img")].map((e) => (e as HTMLElement).style.backgroundImage)).toEqual([
      ...["dusk", "minioninfo", "demoninfo", "dawn"].map((id) => `url("/nightsheet/${id}.png")`)]);
    expect(screen.queryByText("Townsfolk")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Characters/ }));
    fireEvent.click(screen.getByRole("button", { name: /Washerwoman/ }));
    expect(screen.getByRole("dialog", { name: "Washerwoman" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Scripts/ }));
    expect(screen.getByRole("button", { name: "Trouble Brewing" })).toBeInTheDocument();
  });

  it("on a phone The Carousel is one list with no tabs", () => {
    phone(true);
    render(<HomeScreen navigate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Character Reference/ }));
    fireEvent.click(screen.getByRole("button", { name: "The Carousel" }));
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Scripts/ })).toBeInTheDocument();
  });

  it("a wider screen keeps the Storyteller entry", () => {
    phone(false);
    render(<HomeScreen navigate={() => {}} />);
    expect(screen.getByRole("button", { name: /^Storyteller/ })).toBeInTheDocument();
  });
});
