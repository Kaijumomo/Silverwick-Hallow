// Package 1: Reference overlay (card shelf, night order, character detail).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ReferenceOverlay } from "./ReferenceOverlay";
import { buildReferenceCategories } from "../referenceCategories";
import { JINXES } from "@/data/jinxes";
import { lookupOfficialRole } from "@/data/officialRoles";
import { arcLetters, buildNightColumns, cleanReminder, groupByTeam, jinxesOf } from "./referenceData";

afterEach(cleanup);

const cats = Object.fromEntries(buildReferenceCategories().map((c) => [c.id, c]));
const open = (id: "tb" | "bmr" | "snv" | "carousel", onClose = vi.fn()) => {
  render(<ReferenceOverlay category={cats[id]!} onClose={onClose} />);
  return onClose;
};

describe("referenceData", () => {
  it("cleans reminder markup", () => {
    expect(cleanReminder("*Wake* the :reminder: Monk.  Now")).toBe("Wake the Monk. Now");
    expect(cleanReminder(undefined)).toBe("");
  });

  it("groups by team in design order and drops empty teams", () => {
    const g = groupByTeam(cats.tb!.roles);
    expect(g.map((x) => x.label)).toEqual(["Townsfolk", "Outsiders", "Minions", "Demons", "Travellers"]);
    expect(g.reduce((n, x) => n + x.roles.length, 0)).toBe(cats.tb!.roles.length);
    expect(groupByTeam(cats.carousel!.roles).map((x) => x.label)).toEqual(
      expect.arrayContaining(["Fabled", "Loric"]),
    );
  });

  it("night order: only this category's characters, numbered, with Dusk/Dawn and first-night-only info steps", () => {
    const [first, other] = buildNightColumns(cats.tb!.roles);
    const names = (c: typeof first) => c!.rows.map((r) => (r.kind === "step" ? r.name : r.role.name));
    expect(names(first)[0]).toBe("Dusk");
    expect(names(first).at(-1)).toBe("Dawn");
    expect(names(first)).toContain("Minion info");
    expect(names(first)).toContain("Demon info");
    expect(names(other)).not.toContain("Minion info");
    expect(names(other)).not.toContain("Demon info");
    expect(names(first)).toContain("Poisoner");
    expect(names(first)).not.toContain("Pukka"); // Bad Moon Rising only
    const nums = first!.rows.flatMap((r) => (r.kind === "role" ? [r.num] : []));
    expect(nums).toEqual(nums.map((_, i) => i + 1));
    expect(first!.wakes).toBe(nums.length);
  });

  it("jinxes are found in both directions", () => {
    const j = JINXES[0]!;
    expect(jinxesOf(j.a).some((x) => x.id === j.b && x.reason === j.reason)).toBe(true);
    expect(jinxesOf(j.b).some((x) => x.id === j.a && x.reason === j.reason)).toBe(true);
  });

  it("arc letters scale with label length", () => {
    expect(arcLetters("Dead").fs).toBe(13);
    expect(arcLetters("Is the Demon").fs).toBe(11);
    expect(arcLetters("Used a long label x").fs).toBe(9);
    const { letters } = arcLetters("Ab");
    expect(letters[0]!.rot).toBeGreaterThan(0);
    expect(letters[0]!.rot).toBe(-letters[1]!.rot);
  });
});

describe("ReferenceOverlay", () => {
  it("shows a shelf per team with counts and a character total", () => {
    open("tb");
    const dialog = screen.getByRole("dialog", { name: /Character reference: Trouble Brewing/ });
    expect(within(dialog).getByRole("heading", { level: 2, name: "Trouble Brewing" })).toBeInTheDocument();
    expect(within(dialog).getByText(`${cats.tb!.roles.length} characters`)).toBeInTheDocument();
    for (const team of ["Townsfolk", "Outsiders", "Minions", "Demons", "Travellers"]) {
      expect(within(dialog).getByRole("region", { name: team })).toBeInTheDocument();
    }
    expect(within(dialog).getAllByRole("button", { name: /Washerwoman/ }).length).toBe(1);
  });

  it("has Characters and Night order tabs for editions, switching views", () => {
    open("tb");
    expect(screen.getByRole("button", { name: "Characters", pressed: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Night order" }));
    expect(screen.getByRole("region", { name: "First night" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Other nights" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Townsfolk" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Characters" }));
    expect(screen.getByRole("region", { name: "Townsfolk" })).toBeInTheDocument();
  });

  it("Carousel has Fabled and Loric shelves and no night order tab", () => {
    open("carousel");
    expect(screen.queryByRole("button", { name: "Night order" })).toBeNull();
    expect(screen.getByRole("region", { name: "Fabled" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Loric" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "The Carousel" })).toBeInTheDocument();
  });

  it("a night-order row opens that character's detail", () => {
    open("tb");
    fireEvent.click(screen.getByRole("button", { name: "Night order" }));
    const first = screen.getByRole("region", { name: "First night" });
    fireEvent.click(within(first).getByRole("button", { name: /Poisoner/ }));
    expect(screen.getByRole("dialog", { name: "Poisoner" })).toBeInTheDocument();
  });

  it("detail shows team, ability, reminder tokens, night text and jinxes", () => {
    const j = JINXES.find((x) => cats.tb!.roles.some((r) => r.id === x.a) && lookupOfficialRole(x.b))!;
    const role = lookupOfficialRole(j.a)!;
    const other = lookupOfficialRole(j.b)!;
    open("tb");
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(`^${role.name}`) })[0]!);
    const detail = screen.getByRole("dialog", { name: role.name });
    expect(within(detail).getByRole("heading", { level: 3, name: role.name })).toBeInTheDocument();
    if (role.ability) expect(within(detail).getByText(role.ability)).toBeInTheDocument();
    if (role.reminders?.length) expect(within(detail).getByText("Reminder tokens")).toBeInTheDocument();
    expect(within(detail).getByText("Jinxes")).toBeInTheDocument();
    expect(within(detail).getByText(other.name)).toBeInTheDocument();
    expect(within(detail).getByText(j.reason)).toBeInTheDocument();
  });

  it("Escape closes the detail first, then the overlay; scrim click closes the detail", () => {
    const onClose = open("tb");
    fireEvent.click(screen.getAllByRole("button", { name: /Washerwoman/ })[0]!);
    expect(screen.getByRole("dialog", { name: "Washerwoman" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Washerwoman" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: /Washerwoman/ })[0]!);
    fireEvent.click(screen.getByRole("dialog", { name: "Washerwoman" }).parentElement!);
    expect(screen.queryByRole("dialog", { name: "Washerwoman" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a missing icon falls back to a marked temporary monogram, never a broken image", () => {
    open("tb");
    const card = screen.getAllByRole("button", { name: /Washerwoman/ })[0]!;
    const img = card.querySelector("img")!;
    fireEvent.error(img);
    const mono = card.querySelector('[data-temporary-art="true"]');
    expect(mono).not.toBeNull();
    expect(mono!.textContent).toBe("W");
    expect(card.querySelector("img")).toBeNull();
  });
});
