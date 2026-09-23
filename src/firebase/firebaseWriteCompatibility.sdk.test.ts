// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, setLogLevel } from "firebase/app";
import { getDatabase, goOffline, ref, update } from "firebase/database";
import { validateFirebaseWritableValue } from "./firebaseWriteCompatibility";

// Phase 9R.1 residual F2 (nested `.priority`): differential tests comparing
// validateFirebaseWritableValue against the REAL installed Firebase SDK
// (firebase 12.12.1 / @firebase/database 1.1.2), driven through the same
// modular update(ref(db), { "<destination>": value }) call
// FirebaseRoomBackend.update() makes. The database is offline (goOffline
// before any write, unroutable URL), so every verdict here is the SDK's
// SYNCHRONOUS client-side one -- validateFirebaseData, then nodeFromJSON /
// validatePriorityNode / resolveDeferredValue inside repoUpdate -- never a
// network or emulator response. rules.spec.ts's "residual F2" block covers
// the real emulator round trip.

setLogLevel("silent");
const app = initializeApp({ databaseURL: "http://127.0.0.1:1?ns=silverwick-priority-oracle" }, "priority-oracle");
const db = getDatabase(app);
goOffline(db);
afterAll(async () => { await deleteApp(app); });

const code = "PRIO2345";
const destination = ["lobbies", code, "storyteller"];

/** The installed SDK's own verdict: does update() throw synchronously? */
function sdkAccepts(value: unknown): boolean {
  try {
    // Offline: the returned promise never settles; only a synchronous throw matters.
    void update(ref(db), { [destination.join("/")]: value }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

function silverwickAccepts(value: unknown): boolean {
  return validateFirebaseWritableValue(value, destination).ok;
}

/** Astra's reproduction location: game.history[].change.item. */
function inHistoryItem(item: unknown): unknown {
  return { history: [{ id: "h", category: "life", playerId: "a", change: { kind: "added", item } }] };
}

// [label, priority value, expected verdict for { ".priority": P, "child": true }]
// -- the expected column documents the SDK's own matrix and is asserted
// independently of the oracle, so a broken oracle cannot mask a regression.
const priorityMatrix: [string, unknown, boolean][] = [
  ["null", null, true],
  ["0", 0, true],
  ["1", 1, true],
  ["-1", -1, true],
  ["finite decimal 1.5", 1.5, true],
  ["string", "abc", true],
  ["empty string", "", true],
  ['server value { ".sv": "timestamp" }', { ".sv": "timestamp" }, true],
  ['server value { ".sv": { increment: 1 } }', { ".sv": { increment: 1 } }, true],
  ['server value { ".sv": { increment: -2.5, extra: 1 } }', { ".sv": { increment: -2.5, extra: 1 } }, true],
  ['server value with null own priority { ".sv": "timestamp", ".priority": null }', { ".sv": "timestamp", ".priority": null }, true],
  ['{ ".sv": <anything>, ".value": <number> } (".value" replaces the server value)', { ".sv": "bogus", ".value": 5 }, true],
  ["boolean true", true, false],
  ["boolean false", false, false],
  ["[]", [], false],
  ["{}", {}, false],
  ["ordinary object { a: 1 }", { a: 1 }, false],
  ['unknown scalar server value { ".sv": "bogus" }', { ".sv": "bogus" }, false],
  ['non-string/object server value { ".sv": 5 }', { ".sv": 5 }, false],
  ['non-string/object server value { ".sv": true }', { ".sv": true }, false],
  ['null server value { ".sv": null }', { ".sv": null }, false],
  ['{ ".sv": {} } (no increment)', { ".sv": {} }, false],
  ['{ ".sv": [] }', { ".sv": [] }, false],
  ['{ ".sv": { increment: "x" } } (non-numeric increment)', { ".sv": { increment: "x" } }, false],
  ['server value with its own priority { ".sv": "timestamp", ".priority": 1 }', { ".sv": "timestamp", ".priority": 1 }, false],
  ['server value with invalid own priority { ".sv": "timestamp", ".priority": true }', { ".sv": "timestamp", ".priority": true }, false],
  ['{ ".sv": "x", ".value": true } (".value" makes it a boolean priority)', { ".sv": "x", ".value": true }, false],
  ['{ ".sv": "x", ".value": { a: 1 } } (".value" makes it a non-leaf priority)', { ".sv": "x", ".value": { a: 1 } }, false],
  // Non-finite numbers are not JSON-reachable except via overflow (1e400 ->
  // Infinity); validateFirebaseData rejects them anywhere, `.priority` included.
  ["NaN", NaN, false],
  ["Infinity", Infinity, false],
  ["-Infinity", -Infinity, false],
];

describe("residual F2: nested '.priority' value validation matches the installed Firebase SDK", () => {
  it.each(priorityMatrix)('{ ".priority": %s, "child": true } -- Silverwick matches the SDK', (_label, priority, expected) => {
    const value = { ".priority": priority, child: true };
    expect(sdkAccepts(value)).toBe(expected);
    expect(silverwickAccepts(value)).toBe(expected);
  });

  it.each(priorityMatrix)('the same priority (%s) inside game.history[].change.item -- Silverwick matches the SDK at depth', (_label, priority, expected) => {
    const value = inHistoryItem({ ".priority": priority, child: true });
    expect(sdkAccepts(value)).toBe(expected);
    expect(silverwickAccepts(value)).toBe(expected);
  });

  // Every other position a `.priority` can take relative to `.value` and
  // to the node's emptiness: the SDK only builds/resolves a priority node
  // for a node that is non-empty, but type-checks `.priority` itself on
  // every object node it visits.
  const shapes: [string, (p: unknown) => unknown][] = [
    ['{ ".priority": P } (node ends up empty)', (p) => ({ ".priority": p })],
    ['{ ".value": 1, ".priority": P } (prioritized leaf)', (p) => ({ ".value": 1, ".priority": p })],
    ['{ ".value": [1], ".priority": P } (array branch, non-empty)', (p) => ({ ".value": [1], ".priority": p })],
    ['{ ".value": [], ".priority": P } (array branch, empty)', (p) => ({ ".value": [], ".priority": p })],
    ['{ c: {}, ".priority": P } (only an empty child)', (p) => ({ c: {}, ".priority": p })],
    ['[{ ".priority": P, c: 1 }] (inside an array element)', (p) => [{ ".priority": p, c: 1 }]],
  ];
  for (const [shapeLabel, shape] of shapes) {
    it.each(priorityMatrix)(`${shapeLabel} with P = %s -- Silverwick matches the SDK`, (_label, priority) => {
      const value = shape(priority);
      expect(silverwickAccepts(value)).toBe(sdkAccepts(value));
    });
  }

  it("Astra's exact reproduction ({ \".priority\": true, \"child\": true } in history[].change.item) is rejected by BOTH the SDK and Silverwick", () => {
    const value = inHistoryItem({ ".priority": true, child: true });
    expect(sdkAccepts(value)).toBe(false);
    expect(silverwickAccepts(value)).toBe(false);
    expect(() => update(ref(db), { [destination.join("/")]: value })).toThrow(/Invalid priority type found: boolean/);
  });

  it('the SDK never inherits a parent\'s ".priority": an invalid priority nested under a valid one is still rejected, and a valid nested one under an ordinary parent is accepted', () => {
    const invalidNested = { ".priority": 1, a: { ".priority": false, b: true } };
    const validNested = { a: { ".priority": "x", b: true } };
    expect(sdkAccepts(invalidNested)).toBe(false);
    expect(silverwickAccepts(invalidNested)).toBe(false);
    expect(sdkAccepts(validNested)).toBe(true);
    expect(silverwickAccepts(validNested)).toBe(true);
  });

  it('a ".priority" nested inside a non-null ".value" object is only checked where the SDK checks it', () => {
    // The outer node's own `.priority` check has already run when `.value`
    // replaces its content, so the replacement's own `.priority` is skipped
    // as metadata -- but a grandchild's is checked normally.
    const skipped = { ".value": { ".priority": true, x: 1 } };
    const checked = { ".value": { a: { ".priority": true, x: 1 } } };
    expect(sdkAccepts(skipped)).toBe(true);
    expect(silverwickAccepts(skipped)).toBe(true);
    expect(sdkAccepts(checked)).toBe(false);
    expect(silverwickAccepts(checked)).toBe(false);
  });
});

describe("residual F2: '.sv' server values reached by the same SDK layer match the installed Firebase SDK", () => {
  const serverValueCases: [string, unknown, boolean][] = [
    ['{ ".sv": "timestamp" }', { ".sv": "timestamp" }, true],
    ['{ ".sv": { increment: 3 } }', { ".sv": { increment: 3 } }, true],
    ['{ ".value": 1, ".sv": "timestamp" } (".value" wins)', { ".value": 1, ".sv": "timestamp" }, true],
    ['{ ".sv": "bogus", ".value": 1 } (".value" wins)', { ".sv": "bogus", ".value": 1 }, true],
    ['{ ".sv": "timestamp", x: { ".priority": true } } (a server-value leaf never builds x)', { ".sv": "timestamp", x: { ".priority": true } }, true],
    ['{ c: null, ".priority": { ".sv": "bogus" } } (priority of an empty node is never resolved)', { c: null, ".priority": { ".sv": "bogus" } }, true],
    ['{ ".sv": "bogus" }', { ".sv": "bogus" }, false],
    ['{ a: { ".sv": "bogus" } }', { a: { ".sv": "bogus" } }, false],
    ['{ ".sv": null }', { ".sv": null }, false],
    ['{ ".sv": { increment: "1" } }', { ".sv": { increment: "1" } }, false],
    ['{ ".value": null, ".sv": "bogus" } (null ".value" is ignored)', { ".value": null, ".sv": "bogus" }, false],
    ['{ ".sv": "timestamp", ".priority": { ".sv": "bogus" } }', { ".sv": "timestamp", ".priority": { ".sv": "bogus" } }, false],
    ['[{ ".sv": "timestamp" }, { ".sv": "bogus" }]', [{ ".sv": "timestamp" }, { ".sv": "bogus" }], false],
  ];

  it.each(serverValueCases)("%s -- Silverwick matches the SDK", (_label, value, expected) => {
    expect(sdkAccepts(value)).toBe(expected);
    expect(silverwickAccepts(value)).toBe(expected);
  });
});

describe("the SDK's each() helper: an own 'hasOwnProperty' key matches the installed Firebase SDK", () => {
  it.each([
    ["at the root", '{"hasOwnProperty":1}'],
    ["nested", '{"a":{"hasOwnProperty":true}}'],
    ["inside history[].change.item", '{"history":[{"change":{"item":{"hasOwnProperty":"x"}}}]}'],
    ["inside a server value", '{".sv":{"increment":1,"hasOwnProperty":1}}'],
  ])("an own \"hasOwnProperty\" key %s is rejected by both", (_label, json) => {
    // JSON.parse creates it as an ordinary own data property, exactly as a
    // raw remote checkpoint would.
    const value = JSON.parse(json) as unknown;
    expect(sdkAccepts(value)).toBe(false);
    expect(silverwickAccepts(value)).toBe(false);
  });

  it('a "__proto__" JSON key (an own data property after JSON.parse) is accepted by both', () => {
    const value = JSON.parse('{"__proto__":{"a":1},"b":2}') as unknown;
    expect(sdkAccepts(value)).toBe(true);
    expect(silverwickAccepts(value)).toBe(true);
  });
});

describe("residual F2: seeded differential fuzz against the installed Firebase SDK", () => {
  // Deterministic PRNG (mulberry32) so any disagreement reproduces exactly.
  function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const keys = [".priority", ".priority", ".value", ".sv", "a", "b", "0", "increment", "hasOwnProperty", "bad.key"];
  const scalars: unknown[] = [null, true, false, 0, 1, -2.5, "", "s", "timestamp", "bogus"];

  function generate(next: () => number, depth: number): unknown {
    const roll = next();
    if (depth <= 0 || roll < 0.4) return scalars[Math.floor(next() * scalars.length)];
    if (roll < 0.5) {
      return Array.from({ length: Math.floor(next() * 3) }, () => generate(next, depth - 1));
    }
    const obj: Record<string, unknown> = {};
    const size = Math.floor(next() * 4);
    for (let i = 0; i < size; i++) obj[keys[Math.floor(next() * keys.length)]!] = generate(next, depth - 1);
    return obj;
  }

  it("5000 generated values dense in .priority/.value/.sv combinations: Silverwick's verdict equals the SDK's for every one", () => {
    const next = prng(0x9e1);
    const disagreements: string[] = [];
    let accepted = 0;
    for (let i = 0; i < 5000; i++) {
      const value = generate(next, 4);
      const sdk = sdkAccepts(value);
      if (sdk) accepted++;
      if (silverwickAccepts(value) !== sdk) disagreements.push(`#${i} sdk=${sdk}: ${JSON.stringify(value)}`);
    }
    expect(disagreements).toEqual([]);
    // Both verdicts are genuinely exercised, not a degenerate all-accept/all-reject corpus.
    expect(accepted).toBeGreaterThan(500);
    expect(accepted).toBeLessThan(4500);
  });
});
