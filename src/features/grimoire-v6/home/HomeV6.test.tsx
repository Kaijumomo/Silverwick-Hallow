// The tablet Home (V2 design): entry paths, Resume/Review gating, Public Display, Tablet Trial and Character
// Reference. These cases moved here from the old desktop Home (streamlining review F-06), which no screen reached.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HomeV6 } from "./HomeV6";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { JOIN_PREFILL_KEY, writeJoinPrefill } from "@/features/home/joinPrefill";
import { useV6Ui } from "../v6Store";

const trial = vi.hoisted(() => ({ on: false }));
vi.mock("@/config/trial", () => ({
  get isTabletTrial() { return trial.on; },
  TABLET_TRIAL_OFFLINE_MESSAGE: "This tablet trial is local only. Online lobbies are disabled.",
}));

const ROLES = ["monk", "imp", "empath", "chef", "poisoner", "saint", "washerwoman"];
const liveGame = (over = {}) => setupGame(ROLES, { phase: "night", day: 2, ...over });
const CODE = "BCDF2345";
const row = (name: RegExp) => screen.getByRole("link", { name });
const openReference = () => fireEvent.click(screen.getByRole("button", { name: /^Character Reference/ }));

beforeEach(() => {
  trial.on = false;
  window.sessionStorage.clear();
  useV6Ui.getState().reset();
  store.setState({ game: null, view: "home", customScripts: { [setupScript.id]: setupScript } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("tablet Home entry paths", () => {
  it("offers Storyteller, Character Reference and How to Play; joining is by invitation link or QR, so there is no join form", () => {
    render(<HomeV6 navigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^Storyteller/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Character Reference/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^How to Play/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Player/ })).toBeNull();
    expect(screen.queryByPlaceholderText("Write it here")).toBeNull();
  });

  it("New game opens the wizard", () => {
    render(<HomeV6 navigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^New game/ }));
    expect(store.getState().view).toBe("newgame");
    expect(useV6Ui.getState().wiz?.step).toBe("script");
  });

  it("clears a stale join hand-off when Home mounts", () => {
    writeJoinPrefill("Old Name", CODE);
    render(<HomeV6 navigate={vi.fn()} />);
    expect(window.sessionStorage.getItem(JOIN_PREFILL_KEY)).toBeNull();
  });
});

describe("tablet Home Resume / Review gating", () => {
  it("no saved game: neither Resume nor Review appears", () => {
    render(<HomeV6 navigate={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /Resume game/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Review finished game/ })).toBeNull();
  });

  it("unfinished game: Resume shows the saved game's summary and opens the Grimoire", () => {
    store.setState({ game: liveGame() });
    render(<HomeV6 navigate={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /Review finished game/ })).toBeNull();
    const resume = row(/Resume game/);
    expect(resume).toHaveTextContent("Night 2");
    expect(resume).toHaveTextContent("7 players");
    fireEvent.click(resume);
    expect(store.getState().view).toBe("game");
  });

  it("finished game: Review appears, Resume does not, New game is still available", () => {
    store.setState({ game: liveGame({ phase: "ended" }) });
    render(<HomeV6 navigate={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /Resume game/ })).toBeNull();
    fireEvent.click(row(/Review finished game/));
    expect(store.getState().view).toBe("game");
    expect(store.getState().game!.phase).toBe("ended");
    expect(screen.getByRole("button", { name: /^New game/ })).toBeInTheDocument();
  });

  it("Public Display asks for the lobby code and opens the display for it", () => {
    const navigate = vi.fn();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("bcdf-2345");
    render(<HomeV6 navigate={navigate} />);
    fireEvent.click(row(/Public display/));
    expect(prompt).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(`?display=public&code=${CODE}`);
  });
});

describe("tablet Home in the Tablet Trial", () => {
  beforeEach(() => { trial.on = true; });
  it("Public Display stays offline with the trial message; New game still works", () => {
    const navigate = vi.fn();
    const prompt = vi.spyOn(window, "prompt");
    render(<HomeV6 navigate={navigate} />);
    fireEvent.click(row(/Public display/));
    expect(prompt).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/Online lobbies are disabled/);
    fireEvent.click(screen.getByRole("button", { name: /^New game/ }));
    expect(store.getState().view).toBe("newgame");
  });
});

describe("tablet Home Character Reference", () => {
  it("shows the four categories with the design's single line of text", () => {
    render(<HomeV6 navigate={vi.fn()} />);
    openReference();
    expect(screen.getAllByRole("button", { name: /characters$/ }).map((b) => b.textContent)).toEqual(["22 characters", "25 characters", "25 characters"]);
    expect(screen.getByRole("button", { name: /Carousel/ })).toBeInTheDocument();
  });

  it("a category opens the Reference overlay for it, and Home closes it", () => {
    render(<HomeV6 navigate={vi.fn()} />);
    openReference();
    fireEvent.click(screen.getAllByRole("button", { name: /characters$/ })[0]!);
    const dialog = screen.getByRole("dialog", { name: /Character reference: Trouble Brewing/ });
    expect(within(dialog).getAllByText(/Washerwoman/).length).toBeGreaterThan(0);
    expect(within(dialog).queryByText(/^Grandmother$/)).toBeNull(); // Bad Moon Rising only
    fireEvent.click(within(dialog).getByRole("button", { name: /Home/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the chosen team tab when another script is opened, as the design does", () => {
    render(<HomeV6 navigate={vi.fn()} />);
    openReference();
    const scripts = () => screen.getAllByRole("button", { name: /characters$/ });
    fireEvent.click(scripts()[0]!);
    fireEvent.click(screen.getByRole("button", { name: /^Demons/ }));
    fireEvent.click(screen.getByRole("button", { name: /Home/ }));
    fireEvent.click(scripts()[2]!);
    expect(screen.getByRole("dialog", { name: /Sects & Violets/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Demons/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Home/ }));
    // The Carousel has Fabled; a script without that team falls back to its first team.
    fireEvent.click(screen.getByRole("button", { name: /Carousel/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Fabled/ }));
    fireEvent.click(screen.getByRole("button", { name: /Home/ }));
    fireEvent.click(scripts()[0]!);
    expect(screen.getByRole("button", { name: /^Townsfolk/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("tablet Home How to Play (design v7)", () => {
  const openHow = () => fireEvent.click(screen.getByRole("button", { name: /^How to Play/ }));

  it("the How to Play row shows the seven-step rail and Begin", () => {
    render(<HomeV6 navigate={vi.fn()} />);
    openHow();
    expect(screen.getByText("Seven steps through a game, from the first night to the final vote.")).toBeInTheDocument();
    for (const s of ["Gather", "Night", "Dawn", "Nominate", "Vote", "The dead", "Victory"]) {
      expect(screen.getByRole("button", { name: s })).toBeInTheDocument();
    }
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Begin opens the walk-through at step 1, and Home closes it", () => {
    render(<HomeV6 navigate={vi.fn()} />);
    openHow();
    fireEvent.click(screen.getByRole("button", { name: "Begin" }));
    const dialog = screen.getByRole("dialog", { name: "How to Play" });
    expect(within(dialog).getByText("Step 1 of 7")).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "The town gathers" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Home/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a step on the Home rail opens the walk-through at that step", () => {
    render(<HomeV6 navigate={vi.fn()} />);
    openHow();
    fireEvent.click(screen.getByRole("button", { name: "Victory" }));
    const dialog = screen.getByRole("dialog", { name: "How to Play" });
    expect(within(dialog).getByText("Step 7 of 7")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the footer carries the Community Created Content badge and the design's links", () => {
    render(<HomeV6 navigate={vi.fn()} />);
    // The badge goes to the official website; the buy link goes to the board game itself (PO, 2026-11-10).
    expect(screen.getByRole("link", { name: /Community Created Content/ })).toHaveAttribute("href", "https://bloodontheclocktower.com/");
    expect(screen.getByRole("link", { name: "Buy Blood on the Clocktower" })).toHaveAttribute("href", "https://bloodontheclocktower.com/products/blood-on-the-clocktower-the-game");
    expect(screen.getByRole("link", { name: "Buy Blood on the Clocktower" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GitHub" })).toBeInTheDocument();
  });
});

describe("Home on a phone", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("a phone gets the player Home: Player and Character Reference only", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("760"), media: query, addEventListener() {}, removeEventListener() {} }));
    const navigate = vi.fn();
    render(<HomeV6 navigate={navigate} />);
    expect(screen.queryByRole("button", { name: /^Storyteller/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Player/ }));
    expect(navigate).toHaveBeenCalledWith("?join=");
  });
});
