import { describe, expect, it } from "vitest";
import { diagCss, installDiagnostics, parseDiag } from "./diagnostics";

describe("tablet diagnostics (preview-only)", () => {
  it("is inert without parameters", () => {
    expect(diagCss(parseDiag(""))).toBe("");
    installDiagnostics("");
    expect(document.getElementById("diag-style")).toBeNull();
  });

  it("builds the layer switches from the URL", () => {
    expect(diagCss(parseDiag("?diag=nomultiply"))).toContain("mix-blend-mode: multiply");
    expect(diagCss(parseDiag("?diag=nonoise"))).toContain('[style*="mix-blend-mode"]');
    expect(diagCss(parseDiag("?diag=noboard"))).toContain(":has(");
    expect(diagCss(parseDiag("?diag=vv"))).toBe("");
  });

  it("combines switches and reads the keyboard mode", () => {
    const f = parseDiag("?diag=nonoise,vv&kb=overlays");
    expect([...f.diag]).toEqual(["nonoise", "vv"]);
    expect(f.kb).toBe("overlays");
  });
});
