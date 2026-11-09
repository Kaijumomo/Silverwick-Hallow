// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mergeSlices } from "./useGrimoireVm";

describe("mergeSlices", () => {
  it("merges slices, then applies overrides last, in order", () => {
    expect(mergeSlices({ chrome: { dockOn: true, title: "A" }, setup: { wiz: 1, composition: ["planned"] } },
      { setup: { dockOn: false }, info: { composition: ["actual"] } })).toEqual({ dockOn: false, title: "A", wiz: 1, composition: ["actual"] });
  });
  it("lets an override supply a key no slice returns", () => {
    expect(mergeSlices({ chrome: { a: 1 } }, { info: { composition: [] } })).toEqual({ a: 1, composition: [] });
  });
  it("rejects a key returned by two slices", () => {
    expect(() => mergeSlices({ chrome: { stop: 1 }, info: { stop: 2 } })).toThrow(/"stop" is returned by both the chrome and info slices/);
  });
  it("rejects a slice overriding its own key, and two slices overriding the same key", () => {
    expect(() => mergeSlices({ setup: { wiz: 1 } }, { setup: { wiz: 2 } })).toThrow(/both returned and overridden by the setup slice/);
    expect(() => mergeSlices({ chrome: { dockOn: true } }, { setup: { dockOn: false }, info: { dockOn: true } })).toThrow(/overridden by both the setup and info slices/);
  });
});
