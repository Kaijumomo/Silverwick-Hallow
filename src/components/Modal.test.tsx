import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "./Modal";

afterEach(cleanup);

function Example() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  return <>
    <button onClick={() => setOpen(true)}>Open</button>
    {open && <Modal title="Example" onClose={() => setOpen(false)}>
      <input aria-label="Draft" value={text} onChange={event => setText(event.target.value)} />
      <button>Last</button>
      <button hidden>Hidden</button>
      <button disabled>Disabled</button>
      <details><summary>More</summary><button>Collapsed action</button></details>
    </Modal>}
  </>;
}

function openExample() {
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "Open" });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

describe("Modal accessibility", () => {
  it("uses dialog semantics, traps both Tab directions and excludes unavailable controls", () => {
    openExample();
    const dialog = screen.getByRole("dialog", { name: "Example" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(screen.getByText("More")).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(close).toHaveFocus();
  });

  it("preserves editing focus across fresh callbacks and restores the real opener on Escape", () => {
    const trigger = openExample();
    const draft = screen.getByRole("textbox", { name: "Draft" });
    draft.focus();
    fireEvent.change(draft, { target: { value: "still editing" } });
    expect(draft).toHaveFocus();
    fireEvent.keyDown(draft, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("isolates ancestor siblings, contains external focus and restores preexisting inert/scroll state", () => {
    document.body.style.overflow = "clip";
    const outside = document.createElement("div");
    outside.setAttribute("inert", "existing");
    document.body.append(outside);
    const trigger = openExample();
    expect(trigger).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    trigger.focus();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(trigger).not.toHaveAttribute("inert");
    expect(outside).toHaveAttribute("inert", "existing");
    expect(document.body.style.overflow).toBe("clip");
    outside.remove();
    document.body.style.overflow = "";
  });

  it("only closes the top dialog and retains the underlying dialog isolation", () => {
    function Nested() {
      const [outer, setOuter] = useState(false);
      const [inner, setInner] = useState(false);
      return <>
        <button onClick={() => setOuter(true)}>Open outer</button>
        {outer && <Modal title="Outer" onClose={() => setOuter(false)}>
          <button onClick={() => setInner(true)}>Open inner</button>
          {inner && <Modal title="Inner" onClose={() => setInner(false)}><button>Inner action</button></Modal>}
        </Modal>}
      </>;
    }
    render(<Nested />);
    const outerTrigger = screen.getByText("Open outer");
    outerTrigger.focus(); fireEvent.click(outerTrigger);
    const innerTrigger = screen.getByText("Open inner");
    innerTrigger.focus(); fireEvent.click(innerTrigger);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Inner" })).toBeNull();
    expect(innerTrigger).toHaveFocus();
    expect(outerTrigger).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(innerTrigger, { key: "Escape" });
    expect(outerTrigger).toHaveFocus();
    expect(outerTrigger).not.toHaveAttribute("inert");
  });

  it("uses explicit initial and fallback return focus for an automatically opened dialog", () => {
    function AutoOpen() {
      const [open, setOpen] = useState(true);
      const initial = useRef<HTMLInputElement>(null);
      const fallback = useRef<HTMLButtonElement>(null);
      return <><button ref={fallback}>More actions</button>
        {open && <Modal title="Setup" initialFocusRef={initial} returnFocusRef={fallback} onClose={() => setOpen(false)}>
          <input ref={initial} aria-label="Initial" />
        </Modal>}
      </>;
    }
    render(<AutoOpen />);
    expect(screen.getByLabelText("Initial")).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.getByText("More actions")).toHaveFocus();
  });

  it("restores to the fallback when a breakpoint hides the original opener", () => {
    function Responsive() {
      const [open, setOpen] = useState(false);
      const fallback = useRef<HTMLButtonElement>(null);
      return <>
        <button hidden={open} onClick={() => setOpen(true)}>Desktop setup</button>
        <button ref={fallback}>Mobile actions</button>
        {open && <Modal title="Setup" returnFocusRef={fallback} onClose={() => setOpen(false)}><button>Action</button></Modal>}
      </>;
    }
    render(<Responsive />);
    const trigger = screen.getByText("Desktop setup");
    trigger.focus();
    fireEvent.click(trigger);
    // Keep the old control hidden during the unmount cleanup, as a viewport change does.
    trigger.style.display = "none";
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.getByText("Mobile actions")).toHaveFocus();
  });

  it("keeps backdrop dismissal available", () => {
    const close = vi.fn();
    const view = render(<Modal title="Assign player to seat 1" onClose={close}><button>Assign</button></Modal>);
    const backdrop = view.container.querySelector(".dialog-backdrop")!;
    expect(backdrop.closest("[inert]")).toBeNull();
    fireEvent.click(backdrop);
    expect(close).toHaveBeenCalledOnce();
  });
});
