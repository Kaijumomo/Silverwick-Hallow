// Required emulator tests: setup failure fails the suite, never skips it.
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "firebase/database";
import { FirebaseRoomBackend } from "./firebaseBackend";
import { cancelJoinRequest, createLobby, knockOnLobby, revokeMembership, seatPlayer } from "./lobby";

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

describe("Firebase RTDB membership authorization", () => {
  const code = "ABCD2345";
  const st = "uid-storyteller";
  const alice = "uid-alice";
  const bob = "uid-bob";
  const path = (suffix: string) => "lobbies/" + code + "/" + suffix;
  const db = (uid: string) => env.authenticatedContext(uid).database();
  // The modular SDK unwraps compat instances provided by rules-unit-testing.
  const backend = (uid: string) => new FirebaseRoomBackend(db(uid) as unknown as Database);
  const ref = (uid: string, suffix: string) => db(uid).ref(path(suffix));
  async function seed() {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref("lobbies/" + code).set({
        storytellerUid: st,
        roster: { [alice]: "p-alice" },
        public: { code, scriptId: "tb", phase: "setup", day: 0 },
        player: {
          "p-alice": { shownRole: "chef", shownAlignment: "good" },
          "p-bob": { shownRole: "imp", shownAlignment: "evil" },
        },
        storyteller: { notes: "secret", players: { "p-alice": { actualRole: "drunk" } } },
      });
    });
  }

  test("lobby helper claims a code with the caller's UID", async () => {
    expect(await createLobby(backend(st), st, { codeGenerator: () => code })).toEqual({ code });
    expect((await ref(st, "storytellerUid").once("value")).val()).toBe(st);
  });

  test("owner claim cannot name another UID", async () => {
    await assertFails(ref(bob, "storytellerUid").set(st));
  });

  test("non-owner cannot overwrite ownership", async () => {
    await seed();
    await assertFails(ref(bob, "storytellerUid").set(bob));
  });

  test("owner cannot delete or transfer ownership and orphan trusted bindings", async () => {
    await seed();
    await assertFails(ref(st, "storytellerUid").remove());
    await assertFails(ref(st, "storytellerUid").set(bob));
  });

  test("an orphaned pre-existing lobby cannot be claimed by a new UID", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref(path("player/p-alice")).set({ shownRole: "chef" });
    });
    await assertFails(ref(bob, "storytellerUid").set(bob));
  });

  test("authenticated anonymous UID can submit a valid request", async () => {
    await seed();
    const anonymous = env.authenticatedContext(bob, { firebase: { sign_in_provider: "anonymous", identities: {} } }).database();
    await assertSucceeds(anonymous.ref(path("joinRequests/" + bob)).set("Bob"));
    expect((await anonymous.ref(path("joinRequests/" + bob)).once("value")).val()).toBe("Bob");
  });

  test("request helper trims names, is idempotent, and never writes roster", async () => {
    await seed();
    const b = backend(bob);
    await knockOnLobby(b, code, bob, "  Bob  ");
    await knockOnLobby(b, code, bob, "Bob");
    expect(await b.get(path("joinRequests/" + bob))).toBe("Bob");
    expect(await b.get(path("roster/" + bob))).toBeUndefined();
  });

  test("player can cancel only their own request", async () => {
    await seed();
    await knockOnLobby(backend(bob), code, bob, "Bob");
    await assertFails(ref(alice, "joinRequests/" + bob).remove());
    await cancelJoinRequest(backend(bob), code, bob);
    expect(await backend(bob).get(path("joinRequests/" + bob))).toBeUndefined();
  });

  test("player cannot create another UID's request or overwrite an existing request", async () => {
    await seed();
    await assertFails(ref(bob, "joinRequests/" + alice).set("Alice"));
    await assertSucceeds(ref(bob, "joinRequests/" + bob).set("Bob"));
    await assertFails(ref(bob, "joinRequests/" + bob).set("Changed"));
  });

  test("Storyteller can read the request queue and reject a request", async () => {
    await seed();
    await knockOnLobby(backend(bob), code, bob, "Bob");
    expect((await ref(st, "joinRequests").once("value")).val()).toEqual({ [bob]: "Bob" });
    await cancelJoinRequest(backend(st), code, bob);
  });

  test.each(["Bob", "p-alice", "p-bob"])("fresh player cannot write own roster as %s", async (value) => {
    await seed();
    await assertFails(ref(bob, "roster/" + bob).set(value));
    await assertFails(ref(bob, "roster/" + bob).transaction(() => value));
  });

  test("original attack: a request naming a victim ID never grants private access", async () => {
    await seed();
    const attacker = db(bob);
    await assertSucceeds(attacker.ref(path("joinRequests/" + bob)).set("p-alice"));
    await assertSucceeds(attacker.ref(path("public")).once("value"));
    await assertFails(attacker.ref(path("roster/" + bob)).set("p-alice"));
    await assertFails(attacker.ref(path("player/p-alice")).once("value"));
    expect((await attacker.ref(path("roster/" + bob)).once("value")).exists()).toBe(false);
  });

  test("ancestor and multipath writes cannot smuggle a roster binding", async () => {
    await seed();
    const attacker = db(bob);
    await assertFails(attacker.ref(path("roster")).set({ [bob]: "p-alice" }));
    await assertFails(attacker.ref("lobbies/" + code).update({
      ["joinRequests/" + bob]: "Bob", ["roster/" + bob]: "p-alice",
    }));
    await assertFails(attacker.ref("lobbies/" + code).set({ storytellerUid: bob, roster: { [bob]: "p-alice" } }));
  });

  test("seating helper atomically consumes request, binds UID, and writes private projection", async () => {
    await seed();
    const b = backend(bob);
    await knockOnLobby(b, code, bob, "Bob");
    await seatPlayer(backend(st), code, bob, "p-bob", { shownRole: "imp", shownAlignment: "evil" });
    expect(await b.get(path("joinRequests/" + bob))).toBeUndefined();
    expect(await b.get(path("roster/" + bob))).toBe("p-bob");
    expect(await b.get(path("player/p-bob"))).toEqual({ shownRole: "imp", shownAlignment: "evil" });
    await knockOnLobby(b, code, bob, "Bob");
    expect(await b.get(path("joinRequests/" + bob))).toBeUndefined();
  });

  test("Storyteller can seat a player before a role is assigned", async () => {
    await seed();
    await knockOnLobby(backend(bob), code, bob, "Bob");
    await seatPlayer(backend(st), code, bob, "p-empty", null);
    expect(await backend(bob).get(path("roster/" + bob))).toBe("p-empty");
    expect(await backend(bob).get(path("player/p-empty"))).toBeUndefined();
  });

  test("seated player can read own record but not another player or the collection", async () => {
    await seed();
    await assertSucceeds(ref(alice, "player/p-alice").once("value"));
    await assertFails(ref(alice, "player/p-bob").once("value"));
    await assertFails(ref(alice, "player").once("value"));
  });

  test("players cannot alter/delete their binding or write another UID's binding", async () => {
    await seed();
    await assertFails(ref(alice, "roster/" + alice).set("p-bob"));
    await assertFails(ref(alice, "roster/" + alice).remove());
    await assertFails(ref(bob, "roster/" + alice).set("p-bob"));
  });

  test("revocation denies private reads even while the private record remains", async () => {
    await seed();
    await revokeMembership(backend(st), code, alice);
    await assertFails(ref(alice, "player/p-alice").once("value"));
    expect((await ref(st, "player/p-alice").once("value")).exists()).toBe(true);
    await assertFails(ref(alice, "roster/" + alice).set("p-alice"));
  });

  test("revocation cancels an already-authorized live private subscription", async () => {
    await seed();
    const record = ref(alice, "player/p-alice");
    let ready!: () => void;
    const firstValue = new Promise<void>((resolve) => { ready = resolve; });
    const denied = new Promise<Error>((resolve) => { record.on("value", () => ready(), resolve); });
    try {
      await firstValue;
      await revokeMembership(backend(st), code, alice);
      expect((await denied).message).toMatch(/permission_denied/i);
    } finally { record.off(); }
  });

  test("Lobby A membership/ownership cannot authorize private reads or binds in Lobby B", async () => {
    await seed();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref("lobbies/OTHER234").set({
        storytellerUid: "different-st", player: { "p-alice": { shownRole: "imp" } },
      });
    });
    await assertFails(db(alice).ref("lobbies/OTHER234/player/p-alice").once("value"));
    await assertFails(db(alice).ref("lobbies/OTHER234/roster/" + alice).set("p-alice"));
    await assertFails(db(st).ref("lobbies/OTHER234/roster/" + alice).set("p-alice"));
  });

  test.each([
    ["empty", ""], ["whitespace", "   "], ["oversized", "x".repeat(21)],
    ["number", 42], ["boolean", true], ["object", { name: "Bob", playerId: "p-alice" }],
    ["array", ["Bob"]], ["multiline", "Bob\nAlice"], ["untrimmed", " Bob "],
    ["carriage-return", "Bob\rAlice"], ["tab", "Bob\tAlice"],
  ])("rejects malformed request: %s", async (_label, value) => {
    await seed();
    await assertFails(ref(bob, "joinRequests/" + bob).set(value));
  });

  test("accepts a 20-character request at the limit", async () => {
    await seed();
    await assertSucceeds(ref(bob, "joinRequests/" + bob).set("x".repeat(20)));
  });

  test("nonexistent and ownerless lobbies deny new requests", async () => {
    await assertFails(ref(bob, "joinRequests/" + bob).set("Bob"));
    await env.withSecurityRulesDisabled(async (ctx) => { await ctx.database().ref(path("public/status")).set("active"); });
    await assertFails(ref(bob, "joinRequests/" + bob).set("Bob"));
  });

  test("ended lobby denies new requests but permits cancellation", async () => {
    await seed();
    await knockOnLobby(backend(bob), code, bob, "Bob");
    await ref(st, "public/status").set("ended");
    await assertFails(ref("uid-new", "joinRequests/uid-new").set("New"));
    await cancelJoinRequest(backend(bob), code, bob);
    await assertFails(ref(bob, "joinRequests/" + bob).set("Bob"));
  });

  test("seated UID cannot also create a new request", async () => {
    await seed();
    await assertFails(ref(alice, "joinRequests/" + alice).set("Alice"));
  });

  test("players can read only their own request/binding, not the collections", async () => {
    await seed();
    await assertSucceeds(ref(bob, "joinRequests/" + bob).once("value"));
    await assertSucceeds(ref(bob, "roster/" + bob).once("value"));
    for (const suffix of ["joinRequests", "roster", "joinRequests/" + alice, "roster/" + alice]) {
      await assertFails(ref(bob, suffix).once("value"));
    }
  });

  test("public access follows request/membership, and only ST can write it", async () => {
    await seed();
    await assertFails(ref(bob, "public").once("value"));
    await knockOnLobby(backend(bob), code, bob, "Bob");
    await assertSucceeds(ref(bob, "public").once("value"));
    await assertSucceeds(ref(alice, "public").once("value"));
    await assertFails(ref(bob, "public/status").set("ended"));
    await cancelJoinRequest(backend(bob), code, bob);
    await assertFails(ref(bob, "public").once("value"));
  });

  test("Storyteller writes private data; players cannot read ST data or write private data", async () => {
    await seed();
    await assertSucceeds(ref(st, "storyteller/notes").set("updated"));
    await assertFails(ref(alice, "storyteller").once("value"));
    await assertFails(ref(alice, "storyteller/notes").set("attack"));
    await assertFails(ref(alice, "player/p-alice").set({ shownRole: "imp" }));
    await assertFails(ref(alice, "player/p-alice").remove());
  });

  test("unauthenticated clients cannot request, bind, claim, or read private/public data", async () => {
    await seed();
    const guest = env.unauthenticatedContext().database();
    await assertFails(guest.ref(path("joinRequests/guest")).set("Guest"));
    await assertFails(guest.ref(path("roster/guest")).set("p-alice"));
    await assertFails(guest.ref("lobbies/NEW23456/storytellerUid").set("guest"));
    await assertFails(guest.ref(path("player/p-alice")).once("value"));
    await assertFails(guest.ref(path("public")).once("value"));
  });
});
