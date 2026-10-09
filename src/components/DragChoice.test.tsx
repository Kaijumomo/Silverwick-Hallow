import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DragChoice, type DragChoiceOption } from "./DragChoice";

type Choice = "alive" | "dead";
const options: readonly DragChoiceOption<Choice>[] = [{ value: "alive", label: "Alive" }, { value: "dead", label: "Dead" }];
const alive = () => screen.getByRole("radio", { name: "Alive" });
const dead = () => screen.getByRole("radio", { name: "Dead" });
const track = () => document.querySelector<HTMLElement>(".drag-choice-track")!;
const point = (x: number, y = 22, pointerType = "mouse", pointerId = 1) => ({ clientX: x, clientY: y, pointerId, pointerType, button: 0 });
class TestPointerEvent extends MouseEvent {
  pointerId: number; pointerType: string; isPrimary: boolean;
  constructor(type: string, options: PointerEventInit = {}) {
    super(type, options); this.pointerId = options.pointerId ?? 1;
    this.pointerType = options.pointerType ?? "mouse"; this.isPrimary = options.isPrimary ?? true;
  }
}
const move = (x: number, y = 22, kind = "mouse") => fireEvent.pointerMove(track(), point(x, y, kind));
const release = (x: number, y = 22, kind = "mouse") => fireEvent.pointerUp(track(), point(x, y, kind));
function Controlled({ onChange = vi.fn(), initial = "alive" }: { onChange?: (value: Choice) => void; initial?: Choice | null }) {
  const [value, setValue] = useState<Choice | null>(initial);
  return <DragChoice label="Life" value={value} options={options} onChange={next => { onChange(next); setValue(next); }} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 200, height: 44, right: 200, bottom: 44, toJSON() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(["mouse", "touch", "pen"])("supports %s taps and previews sliding with one commit on release", kind => {
  const onChange = vi.fn(); render(<Controlled onChange={onChange} />);
  fireEvent.pointerDown(dead(), point(150, 22, kind)); release(150, 22, kind);
  fireEvent.click(dead(), { detail: 1 }); expect(onChange).toHaveBeenCalledWith("dead");
  fireEvent.pointerDown(alive(), point(50, 22, kind)); release(50, 22, kind);
  fireEvent.click(alive(), { detail: 1 }); expect(onChange).toHaveBeenLastCalledWith("alive");
  onChange.mockClear();
  fireEvent.pointerDown(alive(), point(50, 22, kind)); move(80, 22, kind);
  expect(track().style.getPropertyValue("--drag-choice-position")).toBe("0.3");
  expect(alive()).toHaveAttribute("aria-checked", "true"); expect(onChange).not.toHaveBeenCalled();
  move(150, 22, kind); expect(onChange).not.toHaveBeenCalled();
  release(150, 22, kind);
  fireEvent.click(dead(), { detail: 0 }); release(150, 22, kind);
  expect(onChange).toHaveBeenCalledTimes(1); expect(onChange).toHaveBeenCalledWith("dead");
  expect(dead()).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("radiogroup", { name: "Life" })).not.toHaveAttribute("data-dragging");
  fireEvent.pointerDown(dead(), point(150, 22, kind)); release(50, 22, kind);
  expect(onChange).toHaveBeenNthCalledWith(2, "alive");
});

it("requires meaningful thumb travel, not a tap just across the divider or a drag returned to its starting side", () => {
  const onChange = vi.fn(); render(<Controlled onChange={onChange} />);
  fireEvent.pointerDown(alive(), point(99)); release(105); expect(onChange).not.toHaveBeenCalled();
  fireEvent.pointerDown(alive(), point(95)); release(110); expect(onChange).not.toHaveBeenCalled();
  fireEvent.pointerDown(alive(), point(50)); move(160); release(70); expect(onChange).not.toHaveBeenCalled();
  expect(track().style.getPropertyValue("--drag-choice-position")).toBe("0");
});

it.each(["pointerCancel", "lostPointerCapture"] as const)("cancels %s without a command and resets its preview", event => {
  const onChange = vi.fn(); render(<Controlled onChange={onChange} />);
  fireEvent.pointerDown(alive(), point(50)); move(150);
  fireEvent[event](track(), point(150)); release(150); fireEvent.click(dead(), { detail: 1 });
  expect(onChange).not.toHaveBeenCalled();
  expect(track().style.getPropertyValue("--drag-choice-position")).toBe("0");
});

it("cancels release above or below the track even after a predominantly horizontal slide", () => {
  const onChange = vi.fn(); render(<Controlled onChange={onChange} />);
  for (const y of [-5, 50]) {
    fireEvent.pointerDown(alive(), point(50)); move(150); release(150, y);
    expect(onChange).not.toHaveBeenCalled();
    expect(track().style.getPropertyValue("--drag-choice-position")).toBe("0");
  }
});

it("abandons vertical scrolling, unrelated pointers, and nonprimary presses without changing the choice", () => {
  const onChange = vi.fn(); render(<Controlled onChange={onChange} />);
  fireEvent.pointerDown(alive(), point(50)); move(52, 70); release(150, 70);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.pointerDown(alive(), { ...point(50), isPrimary: false }); release(150);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.pointerDown(alive(), point(50));
  fireEvent.pointerUp(track(), point(150, 22, "touch", 2)); expect(onChange).not.toHaveBeenCalled();
  release(150); expect(onChange).toHaveBeenCalledTimes(1); expect(onChange).toHaveBeenCalledWith("dead");
});

it.each(["disabled", "targetDisabled", "context", "value", "order"] as const)("cancels in-flight input when %s changes", changed => {
  const onChange = vi.fn(); const context = {}; const props = { label: "Life", value: "alive" as Choice, options, onChange, contextKey: context };
  const view = render(<DragChoice {...props} />);
  fireEvent.pointerDown(alive(), point(50)); move(150);
  view.rerender(<DragChoice {...props}
    disabled={changed === "disabled"}
    contextKey={changed === "context" ? {} : context}
    value={changed === "value" ? "dead" : "alive"}
    options={changed === "targetDisabled" ? [options[0]!, { ...options[1]!, disabled: true }] : changed === "order" ? [options[1]!, options[0]!] : options} />);
  release(150); fireEvent.click(dead(), { detail: 1 });
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("radiogroup", { name: "Life" })).not.toHaveAttribute("data-dragging");
});

it("keeps authoritative state when an action refuses the request and allows a fresh attempt", () => {
  const onChange = vi.fn(); render(<DragChoice label="Life" value="alive" options={options} onChange={onChange} />);
  fireEvent.pointerDown(alive(), point(50)); release(150);
  expect(onChange).toHaveBeenCalledTimes(1); expect(onChange).toHaveBeenCalledWith("dead"); expect(alive()).toHaveAttribute("aria-checked", "true");
  expect(track().style.getPropertyValue("--drag-choice-position")).toBe("0");
  fireEvent.pointerDown(alive(), point(50)); release(150); expect(onChange).toHaveBeenCalledTimes(2);
});

it("exposes radios, disabled explanations and deliberate keyboard activation", () => {
  const onChange = vi.fn(); render(<Controlled onChange={onChange} />);
  expect(alive()).toHaveAttribute("tabindex", "0"); expect(dead()).toHaveAttribute("tabindex", "-1");
  fireEvent.keyDown(alive(), { key: "ArrowRight" });
  expect(onChange).toHaveBeenCalledTimes(1); expect(onChange).toHaveBeenCalledWith("dead"); expect(dead()).toHaveFocus();
  fireEvent.keyDown(dead(), { key: "ArrowLeft", repeat: true }); expect(onChange).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(dead(), { key: "Home" }); expect(alive()).toHaveFocus();
  fireEvent.keyDown(alive(), { key: "End" }); expect(dead()).toHaveFocus();
  fireEvent.keyDown(alive(), { key: "Enter" }); expect(alive()).toHaveAttribute("aria-checked", "true");
  fireEvent.keyDown(dead(), { key: " " }); expect(dead()).toHaveAttribute("aria-checked", "true");
  expect(onChange).toHaveBeenCalledTimes(5);
});

it("supports assistive detail-zero clicks while suppressing pointer compatibility clicks and disabled choices", () => {
  const onChange = vi.fn(); const view = render(<Controlled onChange={onChange} />);
  fireEvent.click(dead(), { detail: 1 }); expect(onChange).toHaveBeenCalledTimes(1);
  fireEvent.click(alive(), { detail: 0 }); expect(onChange).toHaveBeenCalledTimes(2);
  fireEvent.pointerDown(alive(), point(50)); release(150); fireEvent.click(alive(), { detail: 0 });
  expect(onChange).toHaveBeenCalledTimes(3);
  act(() => vi.runOnlyPendingTimers());
  fireEvent.click(alive(), { detail: 0 }); expect(onChange).toHaveBeenCalledTimes(4);
  view.rerender(<DragChoice label="Life" value="alive" options={[options[0]!, { ...options[1]!, disabled: true, hint: "Locked during review" }]} onChange={onChange} />);
  expect(dead()).toBeDisabled(); expect(dead()).toHaveAccessibleDescription("Dead: Locked during review");
  fireEvent.keyDown(alive(), { key: "ArrowRight" }); fireEvent.click(dead(), { detail: 0 });
  expect(onChange).toHaveBeenCalledTimes(4);
});

it("snaps by the thumb's nearest position even when grabbed near its edge", () => {
  const onChange = vi.fn(); render(<Controlled onChange={onChange} />);
  fireEvent.pointerDown(alive(), point(5)); move(65); release(65);
  expect(onChange).toHaveBeenCalledOnce(); expect(dead()).toHaveAttribute("aria-checked", "true");
  fireEvent.pointerDown(dead(), point(195)); move(135); release(135);
  expect(onChange).toHaveBeenCalledTimes(2); expect(alive()).toHaveAttribute("aria-checked", "true");
});

it("does not pretend a nullable choice is selected and permits a deliberate slide from the centered thumb", () => {
  const onChange = vi.fn(); render(<Controlled initial={null} onChange={onChange} />);
  expect(alive()).toHaveAttribute("aria-checked", "false"); expect(dead()).toHaveAttribute("aria-checked", "false");
  expect(track().style.getPropertyValue("--drag-choice-position")).toBe("0.5");
  fireEvent.pointerDown(alive(), point(10)); release(150); expect(onChange).not.toHaveBeenCalled();
  fireEvent.pointerDown(dead(), point(110)); release(150);
  expect(onChange).toHaveBeenCalledTimes(1); expect(onChange).toHaveBeenCalledWith("dead");
});

it("escape cancels a preview without changing the value", () => {
  const onChange = vi.fn(); render(<Controlled onChange={onChange} />);
  fireEvent.pointerDown(alive(), point(50)); move(150);
  fireEvent.keyDown(alive(), { key: "Escape" }); release(150);
  expect(onChange).not.toHaveBeenCalled(); expect(track().style.getPropertyValue("--drag-choice-position")).toBe("0");
});
