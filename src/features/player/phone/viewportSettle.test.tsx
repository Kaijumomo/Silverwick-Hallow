// iPhones can leave the page panned after the keyboard closes, so the next phone screen loaded shifted up with an
// empty band under the tab bar until the player scrolled. The phone shell puts the page back at the top.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { PhoneFrame } from "./PhoneParts";
import { settlePhoneViewport } from "./viewportSettle";

let scrollTo: ReturnType<typeof vi.spyOn>;
beforeEach(() => { scrollTo = vi.spyOn(window, "scrollTo"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("phone screens load at the top of the screen", () => {
  it("every phone screen puts the page back at the top when it opens", () => {
    const { rerender } = render(<PhoneFrame label="reveal"><p>reveal</p></PhoneFrame>);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockClear();
    rerender(<PhoneFrame label="game"><p>game</p></PhoneFrame>);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("settles again once the keyboard has closed after typing", () => {
    vi.useFakeTimers();
    const { getByLabelText } = render(<PhoneFrame label="sign-in"><input aria-label="Your name" /></PhoneFrame>);
    act(() => { vi.advanceTimersByTime(1000); });
    const input = getByLabelText("Your name");
    input.focus();
    scrollTo.mockClear();
    act(() => { input.blur(); fireEvent.focusOut(input); vi.advanceTimersByTime(1000); });
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("never moves the page while the player is typing", () => {
    render(<PhoneFrame label="sign-in"><input aria-label="Game code" /></PhoneFrame>);
    (document.querySelector("input") as HTMLInputElement).focus();
    scrollTo.mockClear();
    settlePhoneViewport();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("leaves a pinch-zoomed page alone", () => {
    vi.stubGlobal("visualViewport", Object.assign(new EventTarget(), { scale: 2, offsetTop: 0, offsetLeft: 0, height: 400, width: 200 }));
    settlePhoneViewport();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("stops listening once the phone screen closes", () => {
    vi.useFakeTimers();
    const { unmount } = render(<PhoneFrame label="game"><button type="button">Tab</button></PhoneFrame>);
    unmount();
    scrollTo.mockClear();
    act(() => { fireEvent.focusOut(document.body); vi.advanceTimersByTime(1000); });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
