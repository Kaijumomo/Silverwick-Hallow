// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BUILD_INFO, describeBuild, formatBuiltAt, shortVersion } from "./buildInfo";

const SEMVER = /^\d+\.\d+\.\d+$/;

describe("build info", () => {
  it("package.json holds a plain MAJOR.MINOR.PATCH version (the single source of truth)", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    expect(pkg.version).toMatch(SEMVER);
  });
  it("shows the short version and a full description", () => {
    const info = { version: "0.5.0", commit: "6d3b2bd", builtAt: "2026-11-24T14:10:33.000Z", channel: "production" };
    expect(shortVersion(info)).toBe("v0.5.0");
    expect(describeBuild(info)).toBe("v0.5.0 · 6d3b2bd · built 2026-11-24 14:10Z · production");
  });
  it("copes with a missing or invalid build time", () => {
    expect(formatBuiltAt("")).toBe("unknown");
    expect(formatBuiltAt("not a date")).toBe("unknown");
  });
  it("falls back safely where the build does not inject values (Vitest)", () => {
    expect(BUILD_INFO.version).toMatch(SEMVER);
    expect(BUILD_INFO.commit).not.toBe("");
    expect(BUILD_INFO.channel).not.toBe("");
  });
});
