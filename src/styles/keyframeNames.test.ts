import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Keyframe names are global. Two stylesheets defining the same name silently override each other in the
// production bundle (the Player phone's swVeil once replaced the Grimoire's veil fade), so each name is defined once.

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? cssFiles(path) : path.endsWith(".css") ? [path] : [];
  });
}

describe("CSS keyframe names", () => {
  const defined = new Map<string, string[]>();
  for (const file of cssFiles(join(process.cwd(), "src"))) {
    for (const m of readFileSync(file, "utf8").matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) {
      defined.set(m[1]!, [...(defined.get(m[1]!) ?? []), file]);
    }
  }

  it("finds the stylesheets", () => {
    expect(defined.has("swVeil")).toBe(true);
    expect(defined.has("swpVeil")).toBe(true);
  });

  it("defines every @keyframes name exactly once across src", () => {
    const duplicates = [...defined].filter(([, files]) => files.length > 1).map(([name, files]) => `${name}: ${files.join(", ")}`);
    expect(duplicates).toEqual([]);
  });

  it("keeps every animation named in player-phone.css defined", () => {
    const phone = readFileSync(join(process.cwd(), "src/styles/player-phone.css"), "utf8");
    const used = new Set([...phone.matchAll(/animation(?:-name)?:\s*([A-Za-z][\w-]*)/g)].map((m) => m[1]!).filter((n) => /^sw/.test(n)));
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) expect(defined.has(name), name).toBe(true);
  });
});
