// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chooseAsk, useV6Ui } from "./v6Store";

describe("chooseAsk", () => {
  it("resolves with the answer the Storyteller taps, or null when dismissed", async () => {
    const first = chooseAsk("t", "b", "One", "Two");
    useV6Ui.getState().ask!.run("");
    expect(await first).toBe("first");
    const second = chooseAsk("t", "b", "One", "Two");
    useV6Ui.getState().ask!.alt!.run();
    expect(await second).toBe("second");
    const none = chooseAsk("t", "b", "One", "Two");
    useV6Ui.getState().ask!.cancel!();
    expect(await none).toBeNull();
  });
});
