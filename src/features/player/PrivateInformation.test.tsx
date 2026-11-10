import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PrivateInformation } from "./PrivateInformation";

afterEach(cleanup);

describe("PrivateInformation (the Storyteller's Player view preview)", () => {
  const payload = { shownRole: "clockwinder", shownAlignment: "good" as const, bluffs: ["dread", "imp"] };

  it("names a homebrew character from the game's own script instead of showing its id", () => {
    const names: Record<string, string> = { clockwinder: "Clockwinder", dread: "Dread" };
    render(<PrivateInformation payload={payload} showIdentity showBluffs roleNameOf={(id) => names[id]} />);
    expect(screen.getByText("Clockwinder · good")).toBeInTheDocument();
    expect(screen.getByText("Bluffs: Dread, Imp")).toBeInTheDocument();
  });

  it("without a script lookup it keeps the official catalogue, then the id", () => {
    render(<PrivateInformation payload={payload} showIdentity showBluffs />);
    expect(screen.getByText("clockwinder · good")).toBeInTheDocument();
    expect(screen.getByText("Bluffs: dread, Imp")).toBeInTheDocument();
  });
});
