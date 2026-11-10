// How to Play (Claude Design v7): the seven steps, the rail, Back / Next / Done, and the tablet dialog's Home and Escape.
// The walk-through shows general rules only, so it must never read the Storyteller store (privacy rule for phones).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { HOW_STEPS, howRail, HowToPlayPhone, HowToPlayTablet } from "./HowToPlay";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { setupGame } from "@/test/setupFixtures";

afterEach(() => { cleanup(); useStorytellerStore.setState({ game: null }); });

function Harness({ which, onClose = () => {} }: { which: "tablet" | "phone"; onClose?: () => void }) {
  const [step, setStep] = useState(0);
  const View = which === "tablet" ? HowToPlayTablet : HowToPlayPhone;
  return <View step={step} onStep={setStep} onClose={onClose} />;
}

const titles = HOW_STEPS.map((s) => s.title);

describe("How to Play steps", () => {
  it("has the design's seven steps in order", () => {
    expect(HOW_STEPS.map((s) => s.short)).toEqual(["Gather", "Night", "Dawn", "Nominate", "Vote", "The dead", "Victory"]);
  });

  it("the rail lights the current step, half-lights earlier steps and leaves later ones dark", () => {
    const go = vi.fn();
    const rail = howRail(3, go);
    expect(rail.map((r) => r.dia)).toEqual([
      "rgba(232,88,74,.5)", "rgba(232,88,74,.5)", "rgba(232,88,74,.5)", "#e8584a",
      "rgba(9,10,15,.9)", "rgba(9,10,15,.9)", "rgba(9,10,15,.9)",
    ]);
    rail[5]!.go();
    expect(go).toHaveBeenCalledWith(5);
  });
});

describe.each(["tablet", "phone"] as const)("How to Play on the %s", (which) => {
  it("walks through all seven steps with Next, then Done closes it", () => {
    const onClose = vi.fn();
    render(<Harness which={which} onClose={onClose} />);
    titles.forEach((t, i) => {
      expect(screen.getByRole("heading", { name: t })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: i < 6 ? "Next" : "Done" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Back is disabled on the first step and steps back afterwards", () => {
    render(<Harness which={which} />);
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Night falls" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "The town gathers" })).toBeInTheDocument();
  });

  it("the rail jumps straight to a step and marks it current", () => {
    render(<Harness which={which} />);
    fireEvent.click(screen.getByRole("button", { name: "Vote" }));
    expect(screen.getByRole("heading", { name: "The vote" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vote" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "Night" })).not.toHaveAttribute("aria-current");
  });

  it("Home closes it", () => {
    const onClose = vi.fn();
    render(<Harness which={which} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Home/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows only general rules, nothing from a saved game", () => {
    useStorytellerStore.setState({ game: setupGame(["imp", "poisoner", "empath", "chef", "monk"], { phase: "night", day: 2 }) });
    const { container } = render(<Harness which={which} />);
    for (let i = 0; i < 7; i++) {
      expect(container.textContent).not.toMatch(/Poisoner|Night 2|Player \d/);
      fireEvent.click(screen.getByRole("button", { name: i < 6 ? "Next" : "Done" }));
    }
  });
});

describe("How to Play tablet dialog", () => {
  it("is a modal dialog that takes focus and closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness which="tablet" onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "How to Play" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(dialog);
    expect(screen.getByText("Step 1 of 7")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
