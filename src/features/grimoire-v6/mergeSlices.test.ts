// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mergeSlices } from "./useGrimoireVm";

describe("mergeSlices", () => {
  it("merges slices, then applies chrome overrides last", () => {
    expect(mergeSlices({ chrome: { dockOn: true, title: "A" }, setup: { wiz: 1 } }, { dockOn: false })).toEqual({ dockOn: false, title: "A", wiz: 1 });
  });
  it("rejects a key returned by two slices", () => {
    expect(() => mergeSlices({ chrome: { stop: 1 }, info: { stop: 2 } })).toThrow(/"stop" is returned by both the chrome and info slices/);
  });
  it("rejects an override of a key the chrome slice does not own", () => {
    expect(() => mergeSlices({ chrome: { dockOn: true }, setup: { wiz: 1 } }, { wiz: 2 })).toThrow(/override "wiz" is not a chrome key/);
  });
});
