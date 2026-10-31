import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useBoardRest } from "./boardRest";

function Harness({ keepOpener = true }: { keepOpener?: boolean }) {
  const [reveal, setReveal] = useState(false);
  const rest = useBoardRest(reveal, false);
  return <>
    <div data-testid="board" style={rest.boardStyle({ position: "relative" })}>
      {(keepOpener || !reveal) && <button type="button" onClick={() => setReveal(true)}>Show</button>}
    </div>
    {reveal && <div role="dialog" onAnimationEnd={rest.settleReveal}>
      <span data-testid="inner" />
      <button type="button" onClick={() => setReveal(false)}>Return to Grimoire</button>
    </div>}
    <button type="button" onClick={() => setReveal(false)}>Close from outside</button>
  </>;
}

const ended = (el: Element, animationName = "swRise") => fireEvent(el, Object.assign(new Event("animationend", { bubbles: true }), { animationName }));

afterEach(cleanup);

describe("board rest under a full-screen scene", () => {
  it("hides the board only after the scene's own fade-in ends, and shows it again when the scene closes", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    const board = screen.getByTestId("board");
    expect(board.style.visibility).toBe("");
    act(() => { ended(screen.getByTestId("inner")); });
    expect(board.style.visibility).toBe("");
    act(() => { ended(screen.getByRole("dialog"), "swGlow"); });
    expect(board.style.visibility).toBe("");
    act(() => { ended(screen.getByRole("dialog")); });
    expect(board.style.visibility).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Close from outside" }));
    expect(board.style.visibility).toBe("");
  });

  it("gives focus back to the control the scene was opened from", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Show" });
    opener.focus();
    fireEvent.click(opener);
    act(() => { ended(screen.getByRole("dialog")); });
    act(() => { opener.blur(); });
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Close from outside" }));
    expect(document.activeElement).toBe(opener);
  });

  it("leaves focus alone when it moved into the scene, or when the opener is gone", () => {
    const { unmount } = render(<Harness />);
    const opener = screen.getByRole("button", { name: "Show" });
    opener.focus();
    fireEvent.click(opener);
    act(() => { ended(screen.getByRole("dialog")); });
    const back = screen.getByRole("button", { name: "Return to Grimoire" });
    act(() => { back.focus(); });
    fireEvent.click(back);
    expect(document.activeElement).not.toBe(opener);
    unmount();

    render(<Harness keepOpener={false} />);
    const gone = screen.getByRole("button", { name: "Show" });
    gone.focus();
    fireEvent.click(gone);
    act(() => { ended(screen.getByRole("dialog")); });
    fireEvent.click(screen.getByRole("button", { name: "Close from outside" }));
    expect(document.activeElement).toBe(document.body);
  });
});
