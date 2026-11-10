// Phone Home (Package 3, D9), the one-time join hand-off store and the Character Reference categories.
// The tablet Home's entry paths, Resume/Review gating, Tablet Trial and Reference overlay are tested in
// grimoire-v6/home/HomeV6.test.tsx (the desktop Home they used to run against was unreachable; F-06).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HomeScreen } from "./HomeScreen";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { setupScript } from "@/test/setupFixtures";
import { JOIN_PREFILL_KEY, JOIN_PREFILL_TTL_MS, clearJoinPrefill, peekJoinPrefill, writeJoinPrefill } from "./joinPrefill";
import { buildReferenceCategories } from "./referenceCategories";
import { listOfficialRoles } from "@/data/officialRoles";
import { BUILTIN_SCRIPTS } from "@/data/scripts";

const trial = vi.hoisted(() => ({ on: false }));
vi.mock("@/config/trial", () => ({
  get isTabletTrial() { return trial.on; },
  TABLET_TRIAL_OFFLINE_MESSAGE: "This tablet trial is local only. Online lobbies are disabled.",
}));

const CODE = "BCDF2345";

beforeEach(() => {
  trial.on = false;
  window.sessionStorage.clear();
  store.setState({ game: null, view: "home", customScripts: { [setupScript.id]: setupScript } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
});

describe("Package 3 (D9): phone Home", () => {
  const phone = (matches: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: matches && query.includes("760"), media: query, addEventListener() {}, removeEventListener() {} }));
  afterEach(() => { vi.unstubAllGlobals(); });

  it("on a phone shows only Player, Character Reference and How to Play, and Player opens the join screen", () => {
    phone(true);
    const navigate = vi.fn();
    render(<HomeScreen navigate={navigate} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
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

});
