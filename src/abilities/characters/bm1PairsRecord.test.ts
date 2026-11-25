// @vitest-environment node
// BM-1d: keeps docs/ai/BAD_MOON_RISING_BM1_PAIRS.md honest. It checks the RECORD, not the game: exactly 210 rows, the Sailor, the Exorcist and the
// Pacifist each against the 69 other characters of the three base scripts once (in script order) and the three among themselves, every
// assessment one of the three honest words, every cited file present, every "test" row citing a test file and naming a scenario (T1, T2, ...)
// that exists in bm1Pairs.test.ts or a test file it cites. The behaviour itself is tested by the files the rows cite.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { sectsAndViolets } from "@/data/scripts/sectsAndViolets";
import { badMoonRising } from "@/data/scripts/badMoonRising";
import { REVIEWED_INTERACTION_ROLES } from "./passiveRules";

const record = readFileSync("docs/ai/BAD_MOON_RISING_BM1_PAIRS.md", "utf8");
const scenarios = readFileSync("src/abilities/characters/bm1Pairs.test.ts", "utf8");
type Row = { id: string; subject: string; assessment: string; what: string; evidence: string };
const rows: Row[] = record.split("\n").filter((line) => /^\| \d{3} \| /.test(line)).map((line) => {
  const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
  return { id: cells[0]!, subject: cells[1]!, assessment: cells[2]!, what: cells[3]!, evidence: cells[4]! };
});
const FOCUS = ["Sailor", "Exorcist", "Pacifist"];
const others = [...troubleBrewing.characters, ...sectsAndViolets.characters, ...badMoonRising.characters].map((role) => role.name).filter((name) => !FOCUS.includes(name));
const links = (row: Row) => [...row.evidence.matchAll(/\]\(([^)#]+)[^)]*\)/g)].map((match) => match[1]!);

describe("BM-1d pair record", () => {
  it("lists 69 other characters, so 210 pairs with the three among themselves", () => {
    expect(others).toHaveLength(69);
    expect(rows).toHaveLength(210);
  });
  it("has every pair once, numbered 001 to 210: each focus character against the others in script order, then the three among themselves", () => {
    const expected = [...FOCUS.flatMap((focus) => others.map((other) => `${focus} / ${other}`)), "Sailor / Exorcist", "Sailor / Pacifist", "Exorcist / Pacifist"];
    expect(rows.map((row) => row.subject)).toEqual(expected);
    expect(rows.map((row) => row.id)).toEqual(expected.map((_, index) => String(index + 1).padStart(3, "0")));
  });
  it("marks every row test, code read or Storyteller judgment, with a reason", () => {
    for (const row of rows) {
      expect(row.assessment, `${row.id} ${row.subject}`).toMatch(/^(test|code read|test \+ code read|Storyteller judgment)$/);
      expect(row.what.length, `${row.id} ${row.subject}`).toBeGreaterThan(30);
    }
  });
  it("cites only files that exist; a test row cites a test file and names a scenario; a code read row names a file", () => {
    for (const row of rows) {
      for (const link of links(row)) expect(existsSync(`docs/ai/${link}`), `${row.id} ${row.subject}: ${link}`).toBe(true);
      if (/\btest\b/.test(row.assessment)) expect(links(row).some((link) => /\.test\.tsx?$/.test(link)), `${row.id} ${row.subject} is marked test`).toBe(true);
      if (/code read/.test(row.assessment)) expect(links(row).length, `${row.id} ${row.subject} is marked code read`).toBeGreaterThan(0);
      for (const tag of row.what.match(/\bT\d+\b/g) ?? []) expect(scenarios, `${row.id} ${row.subject} names ${tag}`).toMatch(new RegExp(`it(\\.each\\([^)]*\\))?\\("${tag} `));
    }
  });
  it("a row about a character that is not on the reviewed list is Storyteller judgment (the whole game stays by hand)", () => {
    const names = new Map([...troubleBrewing.characters, ...sectsAndViolets.characters, ...badMoonRising.characters].map((role) => [role.name, role.id]));
    for (const row of rows) {
      const other = row.subject.split(" / ")[1]!;
      const id = names.get(other);
      if (id && !REVIEWED_INTERACTION_ROLES.has(id)) expect(row.assessment, `${row.id} ${row.subject}`).toBe("Storyteller judgment");
    }
  });
});
