// The app shows the Launch Orbit splash over Home on a normal launch, and never over a join link or the Public Display.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App";

beforeEach(() => { window.sessionStorage.clear(); });
afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

describe("App launch splash", () => {
  it("plays over the app on a normal launch", () => {
    render(<App />);
    expect(screen.getByTestId("launch-splash")).toBeInTheDocument();
  });
  it("does not play when opened from a join link or QR code", () => {
    window.history.replaceState({}, "", "/?join=BCDF2345");
    render(<App />);
    expect(screen.queryByTestId("launch-splash")).toBeNull();
  });
  it("does not play on the Public Display", () => {
    window.history.replaceState({}, "", "/?display=public&code=BCDF2345");
    render(<App />);
    expect(screen.queryByTestId("launch-splash")).toBeNull();
  });
});
