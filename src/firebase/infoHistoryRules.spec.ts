// Package 3 (3C): the persistent per-participant information history lives
// inside the player's own private node (player/{playerId}/infoHistory). These
// emulator tests prove the existing Rules already confine it: a player reads
// only their own history, never another player's, and cannot write or alter it.
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

let env: RulesTestEnvironment;
beforeAll(async () => {
  const address = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  if (!address || !/^(127\.0\.0\.1|localhost):\d+$/.test(address)) {
    throw new Error("A local RTDB emulator is required. Run npm run test:rules.");
  }
  const [host, port] = address.split(":");
  env = await initializeTestEnvironment({
    projectId: "demo-silverwick-rules",
    database: { host, port: Number(port), rules: readFileSync(resolve(__dirname, "rules.json"), "utf8") },
  });
});
afterAll(async () => { if (env) await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const code = "HIST2345";
const st = "uid-storyteller";
const alice = "uid-alice";
const bob = "uid-bob";
const mallory = "uid-mallory";
const path = (suffix: string) => `lobbies/${code}/${suffix}`;
const ref = (uid: string, suffix: string) => env.authenticatedContext(uid).database().ref(path(suffix));

const history = (text: string) => [{ id: `h-${text}`, text, moment: { phase: "night", day: 1 } }];

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.database().ref(`lobbies/${code}`).set({
      storytellerUid: st,
      session: { version: 2, id: "s", state: "active" },
      writer: { token: "fixture-writer", expiresAt: Date.now() + 30_000 },
      writeGuard: { token: "fixture-writer", revision: 0 },
      roster: { [alice]: "p-alice", [bob]: "p-bob" },
      public: { code, scriptId: "tb", phase: "day", day: 2 },
      player: {
        "p-alice": { shownRole: "chef", shownAlignment: "good", infoHistory: history("Alice was told two pairs") },
        "p-bob": { shownRole: "imp", shownAlignment: "evil", infoHistory: history("Bob was told his Minions") },
      },
    });
  });
}

describe("info history is private to its own player", () => {
  test("a seated player reads their own history, not another player's, not the collection", async () => {
    await seed();
    const own = await assertSucceeds(ref(alice, "player/p-alice/infoHistory").once("value"));
    expect(JSON.stringify(own.val())).toContain("Alice was told two pairs");
    await assertSucceeds(ref(alice, "player/p-alice").once("value"));
    await assertFails(ref(alice, "player/p-bob/infoHistory").once("value"));
    await assertFails(ref(alice, "player/p-bob").once("value"));
    await assertFails(ref(alice, "player").once("value"));
    await assertFails(ref(bob, "player/p-alice/infoHistory").once("value"));
  });

  test("an unrelated signed-in user reads no history", async () => {
    await seed();
    await assertFails(ref(mallory, "player/p-alice/infoHistory").once("value"));
    await assertFails(ref(mallory, "player/p-bob/infoHistory").once("value"));
  });

  test("a player cannot write, alter or delete any history, their own included", async () => {
    await seed();
    await assertFails(ref(alice, "player/p-alice/infoHistory").set(history("Forged")));
    await assertFails(ref(alice, "player/p-alice/infoHistory/0/text").set("Forged"));
    await assertFails(ref(alice, "player/p-alice/infoHistory").remove());
    await assertFails(ref(alice, "player/p-bob/infoHistory").set(history("Forged")));
  });

  test("revoking membership ends read access to the history", async () => {
    await seed();
    await env.withSecurityRulesDisabled(async (ctx) => { await ctx.database().ref(path(`roster/${alice}`)).remove(); });
    await assertFails(ref(alice, "player/p-alice/infoHistory").once("value"));
  });
});
