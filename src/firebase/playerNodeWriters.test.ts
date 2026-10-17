import { describe, expect, it } from "vitest";

/**
 * Package 3 (C6): player/{id} carries a participation's private information
 * history, so its writers are an audited allowlist. A new writer of a
 * non-null player/{id} value must be added here deliberately, after checking
 * that it cannot expose a history to the wrong participation.
 */
const sources = import.meta.glob("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const production = Object.entries(sources).filter(([path]) => !/\.(test|spec)\.tsx?$/.test(path) && !path.includes("/test/"));

describe("writers of player/{id}", () => {
  it("only seatPlayer (a null-seeded record), writeProjections (the history-aware envelope) and the null cleanups write it", () => {
    const writers = production.flatMap(([path, text]) =>
      text.split("\n").filter((line) => /\bplayerPath\(code, \w+\)\]?\s*[:=]/.test(line)).map((line) => `${path.replace(/^\.\//, "firebase/").replace(/^\.\.\//, "")}: ${line.trim()}`));
    expect(writers.sort()).toEqual([
      "firebase/lobby.ts: [playerPath(code, playerId)]: null,",
      "firebase/lobby.ts: cleanups[playerPath(code, pid)] = null;",
      "firebase/lobby.ts: updates[playerPath(code, playerId)] = selfRecord as unknown as Json;",
      "firebase/sync.ts: updates[playerPath(code, playerId)] = null;",
      "firebase/sync.ts: updates[playerPath(code, playerId)] = selfEnvelopeOf(stState, playerId, self) as unknown as Json;",
    ]);
  });

  it("production seating never seeds a player record", () => {
    const callers = production.filter(([, text]) => /\bseatPlayerAndCommit\(\s*\n?\s*backend,\s*\n?\s*code,\s*\n?\s*uid,\s*\n?\s*targetSeatId,\s*\n?\s*(\w+),/.test(text));
    expect(callers.map(([path]) => path)).toEqual(["../features/grimoire/SeatAssignPopup.tsx"]);
    const match = /seatPlayerAndCommit\(\s*backend,\s*code,\s*uid,\s*targetSeatId,\s*(\w+),/.exec(callers[0]![1]);
    expect(match?.[1]).toBe("null");
  });
});
