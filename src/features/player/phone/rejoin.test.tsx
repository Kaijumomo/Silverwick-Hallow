import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HomeScreen } from "@/features/home/HomeScreen";
import { displayCode, rejoinUrl, savedGameCode } from "./rejoin";

const KEY = "new-blood-player";
const save = (state: unknown) => localStorage.setItem(KEY, JSON.stringify({ state, version: 5 }));
const phone = () => vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("760"), media: query, addEventListener() {}, removeEventListener() {} }));
afterEach(() => { localStorage.removeItem(KEY); vi.unstubAllGlobals(); });

describe("savedGameCode", () => {
  it("reads the saved lobby code", () => { save({ code: "ABCD2345", uid: "u" }); expect(savedGameCode()).toBe("ABCD2345"); });
  it("is null with nothing saved, a null code, junk, or a malformed code", () => {
    expect(savedGameCode()).toBeNull();
    save({ code: null }); expect(savedGameCode()).toBeNull();
    save({ code: "ab/../x" }); expect(savedGameCode()).toBeNull();
    localStorage.setItem(KEY, "{not json"); expect(savedGameCode()).toBeNull();
  });
  it("formats and links the code", () => {
    expect(displayCode("ABCD2345")).toBe("ABCD 2345");
    expect(rejoinUrl("ABCD2345")).toBe("?join=ABCD2345");
  });
});

describe("phone Home: Rejoin game", () => {
  it("offers Rejoin for a saved game and goes to ?join=CODE; Player stays available", () => {
    phone(); save({ code: "ABCD2345", uid: "u" });
    const navigate = vi.fn();
    render(<HomeScreen navigate={navigate} />);
    expect(screen.getAllByRole("button")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: /Rejoin game/ }));
    expect(navigate).toHaveBeenCalledWith("?join=ABCD2345");
    expect(screen.getByText("Game ABCD 2345")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Player/ }));
    expect(navigate).toHaveBeenLastCalledWith("?join=");
  });
  it("shows no Rejoin button without a saved game", () => {
    phone();
    render(<HomeScreen navigate={() => {}} />);
    expect(screen.queryByRole("button", { name: /Rejoin game/ })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});
