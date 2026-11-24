// @vitest-environment node
// SV-6a: keeps docs/ai/SECTS_AND_VIOLETS_PAIRS.md honest. It checks the RECORD, not the game: exactly 300 rows, every unordered pair of the
// script's 25 characters once, in script order, every assessment one of the three honest words, every cited file present, and every "test" row
// citing a test file. The behaviour itself is tested by the files the rows cite.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sectsAndViolets } from "@/data/scripts/sectsAndViolets";

const record = readFileSync("docs/ai/SECTS_AND_VIOLETS_PAIRS.md", "utf8");
type Row = { id: string; subject: string; assessment: string; what: string; evidence: string; from: string };
const rows = (section: RegExp): Row[] => {
  const body = record.split(/^## /m).find((part) => section.test(part)) ?? "";
  return body.split("\n").filter((line) => /^\| (E?\d+) \| /.test(line)).map((line) => {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    return { id: cells[0]!, subject: cells[1]!, assessment: cells[2]!, what: cells[3]!, evidence: cells[4]!, from: cells[5]! };
  });
};
const pairs = rows(/^Pairs \(300\)/);
const endings = rows(/^Endings/);
const names = sectsAndViolets.characters.map((role) => role.name);
const links = (row: Row) => [...row.evidence.matchAll(/\]\(([^)#]+)[^)]*\)/g)].map((match) => match[1]!);

describe("SV-6a master pair record of Sects & Violets", () => {
  it("lists the script's 25 characters, so 300 unordered pairs", () => {
    expect(names).toHaveLength(25);
    expect(pairs).toHaveLength(300);
  });

  it("has every unordered pair exactly once, numbered 001 to 300 in script order, and no pair of a character with itself", () => {
    const expected: string[] = [];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) expected.push(`${names[i]} / ${names[j]}`);
    expect(pairs.map((row) => row.subject)).toEqual(expected);
    expect(pairs.map((row) => row.id)).toEqual(expected.map((_, index) => String(index + 1).padStart(3, "0")));
    expect(new Set(pairs.map((row) => row.subject)).size).toBe(300);
  });

  it("marks every row test, code read or Storyteller judgment, with the reason and the source row named", () => {
    for (const row of [...pairs, ...endings]) {
      expect(row.assessment, `${row.id} ${row.subject}`).toMatch(/\btest\b|code read|Storyteller judgment/);
      expect(row.what.length, `${row.id} ${row.subject}`).toBeGreaterThan(10);
      expect(row.from, `${row.id} ${row.subject}`).toMatch(/^(SV[1-5][A-H]?-\d{3}|SV-6a \(new row\))/);
    }
  });

  it("cites only files that exist; a test row cites a test file; a code read row names a file", () => {
    for (const row of [...pairs, ...endings]) {
      for (const link of links(row)) expect(existsSync(`docs/ai/${link}`), `${row.id} ${row.subject}: ${link}`).toBe(true);
      if (/\btest\b/.test(row.assessment)) expect(links(row).some((link) => /\.test\.tsx?$/.test(link)), `${row.id} ${row.subject} is marked test`).toBe(true);
      if (/code read/.test(row.assessment)) expect(links(row).length, `${row.id} ${row.subject} is marked code read`).toBeGreaterThan(0);
    }
  });

  it("has 15 new rows (the pairs no stage owned), all backed by the gap test file, and 25 ending rows", () => {
    const fresh = pairs.filter((row) => row.from.startsWith("SV-6a (new row)"));
    expect(fresh.map((row) => row.subject).sort()).toEqual([
      "No Dashii / Oracle", "No Dashii / Pit-Hag", "No Dashii / Town Crier", "No Dashii / Vigormortis", "No Dashii / Witch", "Oracle / Pit-Hag", "Oracle / Town Crier",
      "Oracle / Vigormortis", "Oracle / Witch", "Pit-Hag / Town Crier", "Pit-Hag / Vigormortis", "Pit-Hag / Witch", "Town Crier / Vigormortis", "Town Crier / Witch",
      "Vigormortis / Witch",
    ].map((pair) => { const [a, b] = pair.split(" / "); return names.indexOf(a!) < names.indexOf(b!) ? pair : `${b} / ${a}`; }).sort());
    for (const row of fresh) expect(links(row).some((link) => link.endsWith("sectsAndVioletsSv6GapPairs.test.ts")), row.subject).toBe(true);
    expect(endings.map((row) => row.subject)).toEqual(names);
  });

  it("is pointed to from every older record", () => {
    for (const tag of ["SV1", "SV2", "SV3", "SV4", "SV5A", "SV5B", "SV5C", "SV5D", "SV5F", "SV5G", "SV5H"]) {
      expect(readFileSync(`docs/ai/SECTS_AND_VIOLETS_${tag}_PAIRS.md`, "utf8"), tag).toContain("SECTS_AND_VIOLETS_PAIRS.md");
    }
  });
});
