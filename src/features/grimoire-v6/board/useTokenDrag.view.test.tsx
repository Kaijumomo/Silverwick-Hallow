// F-02: dragging a seat through the real Grimoire view. After the first move the seat's box is placed directly;
// the page must still end exactly where React draws it: on drop, on cancel, and when seats move mid-drag.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { GrimoireV6Screen } from "../GrimoireV6Screen";
import { useV6Ui } from "../v6Store";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { proofGame, proofScript } from "@/test/proofFixtures";

beforeEach(() => {
  useShellStore.getState().reset(); useV6Ui.getState().reset(); usePrivacyStore.setState({ enabled: false });
  store.setState({ game: proofGame(["gambler", "monk", "empath", "chef", "imp", "saint", "poisoner"], "day", 2), lobby: null, undoStack: [],
    localSeq: 0, selectedPlayerId: null, tokenPositions: {}, customScripts: { [proofScript.id]: proofScript } });
});
afterEach(() => { cleanup(); });

const discOf = (seat: number) => [...document.querySelectorAll<HTMLElement>(".gv-f1")].find((d) => d.getAttribute("aria-label")?.startsWith(`Seat ${seat},`))!;
const boxOf = (seat: number) => discOf(seat).parentElement!;
const at = (box: HTMLElement) => ({ left: parseFloat(box.style.left), top: parseFloat(box.style.top) });
const fire = (type: string, x: number, y: number) => act(() => { window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y })); });
// jsdom has no PointerEvent: a mouse event of the same type carries the coordinates (pointerId is undefined throughout).
const press = (seat: number, x: number, y: number) => act(() => { discOf(seat).dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: x, clientY: y })); });
const mount = () => render(<VotingProvider><GrimoireV6Screen /></VotingProvider>);

describe("F-02 dragging a seat in the real view", () => {
  it("follows the pointer, drops where it is released, and is drawn there by React afterwards", () => {
    mount();
    const box = boxOf(3);
    const start = at(box);
    press(3, 500, 400);
    fire("pointermove", 520, 410);
    expect(box.style.zIndex).toBe("30");
    fire("pointermove", 540, 430);
    expect(at(box)).toEqual({ left: start.left + 40, top: start.top + 30 });
    fire("pointerup", 560, 450);
    expect(box.style.zIndex).toBe("10");
    expect(at(boxOf(3))).toEqual({ left: start.left + 60, top: start.top + 50 });
    // A fresh page draws the saved position at the same place.
    cleanup(); mount();
    expect(at(boxOf(3))).toEqual({ left: start.left + 60, top: start.top + 50 });
  });

  it("a release away from the last move (a fast flick) still leaves the seat exactly where it was released", () => {
    mount();
    const box = boxOf(3);
    const start = at(box);
    press(3, 500, 400);
    fire("pointermove", 520, 410); // drawn by React here
    fire("pointermove", 560, 450); // placed directly here
    fire("pointerup", 520, 410);   // released back on the point React last drew
    expect(at(box)).toEqual({ left: start.left + 20, top: start.top + 10 });
  });

  it("a cancelled drag puts the seat back where it started", () => {
    mount();
    const box = boxOf(3);
    const start = at(box);
    press(3, 500, 400);
    fire("pointermove", 520, 410);
    fire("pointermove", 580, 470);
    expect(at(box)).toEqual({ left: start.left + 80, top: start.top + 70 });
    fire("pointercancel", 580, 470);
    expect(at(box)).toEqual(start);
    expect(store.getState().tokenPositions).toEqual({});
  });

  it("when the seats are re-ordered mid-drag, the seat that took the box is drawn at its own place and the dragged seat stays at the pointer", () => {
    mount();
    const box = boxOf(3);
    const start = at(box);
    const other = at(boxOf(4));
    press(3, 500, 400);
    fire("pointermove", 520, 410);
    fire("pointermove", 560, 450);
    expect(at(box)).toEqual({ left: start.left + 60, top: start.top + 50 });
    // Seat order changes under the drag: the dragged player is no longer drawn by that box.
    act(() => {
      const game = store.getState().game!;
      const [a, b] = [game.seatOrder[2]!, game.seatOrder[3]!];
      store.setState({ game: { ...game, seatOrder: game.seatOrder.map((id) => (id === a ? b : id === b ? a : id)) } });
    });
    const dragged = [...document.querySelectorAll<HTMLElement>(".gv-f1")].map((d) => d.parentElement!).find((b) => b.style.zIndex === "30")!;
    expect(dragged).not.toBe(box);
    expect(at(dragged)).toEqual({ left: start.left + 60, top: start.top + 50 });
    expect(at(box)).not.toEqual({ left: start.left + 60, top: start.top + 50 });
    void other;
    fire("pointerup", 560, 450);
  });
});
