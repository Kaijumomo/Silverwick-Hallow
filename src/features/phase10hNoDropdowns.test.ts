// Phase 10H (contract §§2.2, 8.4; 10H-AC-014 / AC-027): core gameplay is never
// dropdown-driven. Participant choice is Table / Roster, role choice is the
// searchable RolePicker, finite choices are explicit buttons. A <select> may
// remain only in a genuinely administrative, non-gameplay surface -- today
// only the Activity review FILTERS. This guard fails if any other production
// component renders one.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");
const ADMINISTRATIVE = new Set(["features/activity/ActivityPanel.tsx"]);

function components(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (name !== "test") out.push(...components(path)); }
    else if (name.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(name)) out.push(relative(SRC, path).split("\\").join("/"));
  }
  return out;
}

describe("10H-AC-014: no gameplay dropdowns", () => {
  it("only the administrative Activity filters render a <select>", () => {
    const withSelect = components().filter((file) => /<select\b/.test(readFileSync(join(SRC, file), "utf8")));
    expect(withSelect.sort()).toEqual([...ADMINISTRATIVE]);
  });
});
