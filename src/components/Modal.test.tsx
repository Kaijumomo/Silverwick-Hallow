import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "./Modal";

afterEach(cleanup);

describe("Modal accessibility", () => {
  it("sets dialog semantics, focuses the first control, traps Tab, and restores focus", () => {
    render(
      <>
        <button type="button">Open</button>
        <Modal title="Example" onClose={() => undefined}>
          <button type="button">First</button>
          <button type="button">Last</button>
        </Modal>
      </>
    );
    const dialog = screen.getByRole("dialog", { name: "Example" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    screen.getByRole("button", { name: "Last" }).focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    const onClose = () => screen.getByRole("button", { name: "Open" }).focus();
    render(
      <>
        <button type="button" autoFocus>Open</button>
        <Modal title="Example" onClose={onClose}><button type="button">Action</button></Modal>
      </>
    );
    const dialog = screen.getByRole("dialog", { name: "Example" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
  });
});
