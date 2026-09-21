// Required emulator tests: setup failure fails the suite, never skips it.
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { Database } from "firebase/database";
import { FirebaseRoomBackend } from "./firebaseBackend";
import type { Json } from "./backend";
import { SessionWriter } from "./writer";
import { writeProjections } from "./sync";
import { makeSTPlayer, tbScript } from "@/test/fixtures";
import { buildRegistry } from "@/data/roleRegistry";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { previewPrivatePacket } from "@/stores/privatePackets";
import { publishPrivatePacket } from "./privatePacketCommands";
import type { StorytellerLobbyRecord } from "@/stores/types";
import {
  cancelJoinRequest,
  createLobby,
  knockOnLobby,
  revokeMembership,
  revokePlayerMembership,
  seatPlayer,
} from "./lobby";
import { acceptLeaveRequest, applyTravelerChoice, rejectLeaveRequest } from "./membershipCommands";
import { requireActiveSession } from "./lifecycle";
import {
  authorizePublicDisplay,
  ensurePublicDisplayAccess,
  generatePublicDisplayToken,
  rotatePublicDisplayAccess,
} from "./publicDisplayAuth";
import { buildRichPhase9Game } from "@/test/phase9RichState";

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
  let revision = 0;
  // Existing membership scenarios submit ST mutations with a valid lease
  // receipt. Unauthorized/player writes still use the unwrapped SDK.
  class FixtureWriter extends FirebaseRoomBackend {
    async set(target: string, value: Json) {
      if (target.endsWith('/session')) return super.set(target, value);
      return this.update({ [target]: value });
    }
    async update(updates: Record<string, Json>) {
      return super.update({ ...updates, [path('writeGuard')]: { token: 'fixture-writer', revision: ++revision } });
    }
  }
  const backend = (uid: string) => uid === st ? new FixtureWriter(db(uid) as unknown as Database) : new FirebaseRoomBackend(db(uid) as unknown as Database);
  const ref = (uid: string, suffix: string) => db(uid).ref(path(suffix));
  async function seed() {
    revision = 0;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref("lobbies/" + code).set({
        storytellerUid: st,
        session: { version: 2, id: "test-session", state: "active" },
        writer: { token: "fixture-writer", expiresAt: Date.now() + 30_000 },
        writeGuard: { token: "fixture-writer", revision: 0 },
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

  test("player revocation clears both bindings atomically, leaves Bob alone, and is idempotent", async () => {
    await seed();
    await backend(st).set(path("roster/" + bob), "p-bob");

    await revokePlayerMembership(backend(st), code, "p-alice");
    expect((await ref(st, "roster/" + alice).once("value")).exists()).toBe(false);
    expect((await ref(st, "player/p-alice").once("value")).exists()).toBe(false);
    await assertFails(ref(alice, "player/p-alice").once("value"));
    await assertSucceeds(ref(bob, "player/p-bob").once("value"));

    await revokePlayerMembership(backend(st), code, "p-alice");
    expect((await ref(st, "roster/" + bob).once("value")).val()).toBe("p-bob");
    expect((await ref(st, "player/p-bob").once("value")).exists()).toBe(true);
  });

  test("a player cannot invoke storyteller revocation for another membership", async () => {
    await seed();
    await expect(revokePlayerMembership(backend(bob), code, "p-alice")).rejects.toThrow(/permission denied/i);
    expect(await backend(st).get(path("roster/" + alice))).toBe("p-alice");
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
    await backend(st).set(path("public/status"), "ended");
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
    await assertSucceeds(backend(st).set(path("storyteller/notes"), "updated"));
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

  test("Storyteller reads the exact presence parent while players cannot enumerate it", async () => {
    await seed();
    await ref(alice, "presence/" + alice).set({ online: true, lastSeen: Date.now() });
    await assertSucceeds(ref(st, "presence").once("value"));
    await assertSucceeds(ref(alice, "presence/" + alice).once("value"));
    await assertFails(ref(alice, "presence").once("value"));
    await assertFails(ref(bob, "presence/" + alice).once("value"));
  });

  test("presence lastSeen must be a nonnegative integer; a negative timestamp cannot poison the map", async () => {
    await seed();
    // OPUS-007 remediation: a negative lastSeen (used to defeat the client's
    // staleness math / decoder) is rejected at the rules layer, not just the
    // client decoder.
    await assertFails(ref(alice, "presence/" + alice).set({ online: false, lastSeen: -1 }));
    await assertFails(ref(alice, "presence/" + alice).set({ online: true, lastSeen: -1 }));
    // A fractional value is not an integer timestamp either.
    await assertFails(ref(alice, "presence/" + alice).set({ online: true, lastSeen: 1.5 }));
    // A valid offline shape still succeeds for an authorized (seated) UID.
    await assertSucceeds(ref(alice, "presence/" + alice).set({ online: false, lastSeen: 0 }));
    // Valid heartbeat shapes still succeed.
    await assertSucceeds(ref(alice, "presence/" + alice).set({ online: true, lastSeen: Date.now() }));
  });

  test("session metadata is readable before joining but only the owner can create it", async () => {
    await seed();
    await assertSucceeds(ref(bob, "session").once("value"));
    await assertFails(ref(bob, "session/state").set("ended"));
    await assertFails(ref(st, "session").remove());
    await assertFails(backend(st).set(path("session"), { version: 2, id: "different", state: "active" }));
  });

  test("legacy lobbies without lifecycle metadata cannot accept joins or private reads", async () => {
    await seed();
    await env.withSecurityRulesDisabled(async ctx => { await ctx.database().ref(path("session")).remove(); });
    await assertFails(ref(bob, "joinRequests/" + bob).set("Bob"));
    await assertFails(ref(alice, "player/p-alice").once("value"));
  });

  test("rejected UID observes its outcome but cannot remove it or create another request", async () => {
    await seed();
    await knockOnLobby(backend(bob), code, bob, "Bob");
    await backend(st).update({ [path("outcomes/" + bob)]: "rejected", [path("joinRequests/" + bob)]: null });
    expect((await ref(bob, "outcomes/" + bob).once("value")).val()).toBe("rejected");
    await assertFails(ref(bob, "outcomes/" + bob).remove());
    await assertFails(ref(bob, "joinRequests/" + bob).set("Bob"));
    await assertFails(ref(alice, "outcomes/" + bob).once("value"));
  });

  test("leaving is a request; players cannot revoke their own authoritative binding", async () => {
    await seed();
    await assertSucceeds(ref(alice, "leaveRequests/" + alice).set(true));
    await assertFails(ref(bob, "leaveRequests/" + alice).set(true));
    await assertFails(ref(alice, "roster/" + alice).remove());
    await revokePlayerMembership(backend(st), code, "p-alice");
    await assertFails(ref(alice, "player/p-alice").once("value"));
    expect((await ref(alice, "leaveRequests/" + alice).once("value")).exists()).toBe(false);
  });

  // Phase 9C.3 (OPUS-003): the request/approval workflow's remaining
  // security-boundary proofs. "leaving is a request" above already proves a
  // seated player can create only their own request and cannot revoke their
  // own binding; these extend that boundary to the unseated case, outcome
  // forgery, cross-UID reads, and the Storyteller's own fenced accept/reject
  // paths.

  test("an unseated player cannot create a leave request", async () => {
    await seed(); // only alice ("p-alice") is seated; bob has no roster binding
    await assertFails(ref(bob, "leaveRequests/" + bob).set(true));
    expect((await ref(st, "leaveRequests/" + bob).once("value")).exists()).toBe(false);
  });

  test("a player cannot forge their own revoked outcome", async () => {
    await seed();
    await assertFails(ref(alice, "outcomes/" + alice).set("revoked"));
    await assertFails(ref(alice, "outcomes/" + alice).set("rejected"));
  });

  test("an unrelated authenticated user cannot read another player's leave request", async () => {
    await seed();
    await assertSucceeds(ref(alice, "leaveRequests/" + alice).set(true));
    await assertFails(ref(bob, "leaveRequests/" + alice).once("value"));
    // The Storyteller — the other party the workflow authorizes — still can.
    expect((await ref(st, "leaveRequests/" + alice).once("value")).val()).toBe(true);
  });

  test("Storyteller rejection clears only the leave request through the fenced writer path, leaving roster and private data intact", async () => {
    await seed();
    await assertSucceeds(ref(alice, "leaveRequests/" + alice).set(true));

    await rejectLeaveRequest(backend(st), code, alice);

    expect((await ref(st, "leaveRequests/" + alice).once("value")).exists()).toBe(false);
    expect((await ref(st, "roster/" + alice).once("value")).val()).toBe("p-alice");
    expect((await ref(alice, "player/p-alice").once("value")).val()).toEqual({ shownRole: "chef", shownAlignment: "good" });
    expect((await ref(st, "outcomes/" + alice).once("value")).exists()).toBe(false);
  });

  test("Storyteller acceptance through the existing revocation path removes membership and private access", async () => {
    await seed();
    await assertSucceeds(ref(alice, "leaveRequests/" + alice).set(true));

    await acceptLeaveRequest(backend(st), code, alice, () => true);

    expect((await ref(st, "roster/" + alice).once("value")).exists()).toBe(false);
    expect((await ref(st, "leaveRequests/" + alice).once("value")).exists()).toBe(false);
    expect((await ref(st, "outcomes/" + alice).once("value")).val()).toBe("revoked");
    await assertFails(ref(alice, "player/p-alice").once("value"));
  });

  // Phase 9 Setup finalization B4: a player's self-scoped Traveler
  // character choice. Mirrors the leaveRequests boundary proofs above --
  // same self-write shape, restricted to the supported Traveler catalogue.

  test("a seated player can write their own Traveler choice, restricted to the supported catalogue", async () => {
    await seed();
    await assertSucceeds(ref(alice, "travelerChoices/" + alice).set("thief"));
    expect((await ref(st, "travelerChoices/" + alice).once("value")).val()).toBe("thief");
    await assertFails(ref(alice, "travelerChoices/" + alice).set("chef")); // not a Traveler
    await assertFails(ref(alice, "travelerChoices/" + alice).set("nonexistent-role"));
  });

  test("a player cannot write another UID's Traveler choice", async () => {
    await seed();
    await assertFails(ref(bob, "travelerChoices/" + alice).set("thief"));
  });

  test("an unseated player cannot submit a Traveler choice", async () => {
    await seed(); // only alice is seated
    await assertFails(ref(bob, "travelerChoices/" + bob).set("thief"));
    expect((await ref(st, "travelerChoices/" + bob).once("value")).exists()).toBe(false);
  });

  test("an unrelated authenticated user cannot read another player's Traveler choice; the Storyteller can", async () => {
    await seed();
    await assertSucceeds(ref(alice, "travelerChoices/" + alice).set("thief"));
    await assertFails(ref(bob, "travelerChoices/" + alice).once("value"));
    expect((await ref(st, "travelerChoices/" + alice).once("value")).val()).toBe("thief");
  });

  test("Storyteller applies a Traveler choice through the fenced writer path and clears the request", async () => {
    await seed();
    await assertSucceeds(ref(alice, "travelerChoices/" + alice).set("thief"));

    let applied: string | null = null;
    await applyTravelerChoice(backend(st), code, alice, "thief", (playerId) => { applied = playerId; });

    expect(applied).toBe("p-alice");
    expect((await ref(st, "travelerChoices/" + alice).once("value")).exists()).toBe(false);
  });

  // FINAL SETUP INTEGRATION REVISION, Section 1: production Traveler-choice
  // processing must route through the same fenced writer authority every
  // other membership command uses. Before this revision,
  // StorytellerSession.tsx applied choices through its own raw connection --
  // authenticated as the Storyteller, but carrying none of the
  // writer/writeGuard fencing this collection's own ".write" rule requires
  // (only the child `$uid` rule lets the player write their own entry; only
  // the fenced writer rule at the parent lets the Storyteller clear it).
  // This proves that exact bug against real rules: the local side still
  // applies the choice (matching the described "locally applies a character
  // while failing to clear the request" symptom), but the remote clear is
  // rejected, never silently dropped.
  test("clearing a Traveler choice without the fenced writer's guard is rejected against real rules", async () => {
    await seed();
    await assertSucceeds(ref(alice, "travelerChoices/" + alice).set("thief"));
    const raw = new FirebaseRoomBackend(db(st) as unknown as Database);
    let applied: string | null = null;
    await expect(applyTravelerChoice(raw, code, alice, "thief", (playerId) => { applied = playerId; }))
      .rejects.toThrow();
    expect(applied).toBe("p-alice");
    expect((await ref(st, "travelerChoices/" + alice).once("value")).val()).toBe("thief");
  });

  test("a player may resubmit a different choice before the Storyteller applies it", async () => {
    await seed();
    await assertSucceeds(ref(alice, "travelerChoices/" + alice).set("thief"));
    await assertSucceeds(ref(alice, "travelerChoices/" + alice).set("scapegoat"));
    expect((await ref(st, "travelerChoices/" + alice).once("value")).val()).toBe("scapegoat");
  });

  test("a second writer is denied until expiry, then the old token is fenced", async () => {
    await seed();
    const raw = new FirebaseRoomBackend(db(st) as unknown as Database);
    const second = new SessionWriter(raw, code, "test-session");
    try {
      await expect(second.start()).rejects.toThrow(/Another Storyteller/);
      await env.withSecurityRulesDisabled(async ctx => { await ctx.database().ref(path("writer/expiresAt")).set(0); });
      await second.start();
      await second.set(path("storyteller/notes"), "new writer");
      await assertFails(backend(st).update({ [path("storyteller/notes")]: "stale writer" }));
      expect((await ref(st, "storyteller/notes").once("value")).val()).toBe("new writer");
    } finally { await second.dispose(); }
  });

  test("a fresh session can acquire its first writer and publish with no previous receipt", async () => {
    const raw = new FirebaseRoomBackend(db(st) as unknown as Database);
    await createLobby(raw, st, { codeGenerator: () => code });
    const metadata = (await ref(st, "session").once("value")).val();
    const writer = new SessionWriter(raw, code, metadata.id);
    try { await writer.start(); await writer.set(path("public"), { code, phase: "setup" }); }
    finally { await writer.dispose(); }
  });

  test.each([
    ["drunk", "chef", "good"],
    ["marionette", "washerwoman", "good"],
    ["lunatic", "imp", "evil"],
  ])("AUD-004: %s publishes only shown identity through the guarded writer", async (actual, shown, alignment) => {
    const raw = new FirebaseRoomBackend(db(st) as unknown as Database);
    await createLobby(raw, st, { codeGenerator: () => code });
    const metadata = (await ref(st, "session").once("value")).val();
    const writer = new SessionWriter(raw, code, metadata.id);
    const game: StorytellerLobbyRecord = {
      code, storytellerUid: st, scriptId: "tb", phase: "setup", day: 0,
      notes: "Storyteller only", bluffs: [], fabled: [], lorics: [], nightProgress: {}, history: [], informationDeliveries: [],
      rolePool: [], plannedPlayerCount: 1, plannedTravelerCount: 0, pendingPlayers: {}, seatOrder: ["p-alice"],
      // This test isolates identity delivery through the real writer/rules,
      // not Setup deal/reveal gating (covered elsewhere) -- record the
      // initial reveal directly so the Phase 9C.4 barrier only withholds on
      // incompleteness, exactly what this test exercises.
      setupRolesRevealed: true,
      players: { "p-alice": makeSTPlayer({ id: "p-alice", actualRole: actual!, shownRole: null,
        shownAlignment: "evil", stNotes: "hidden", behaviorMode: "custom" }) },
    };
    const publish = () => writeProjections({ backend: writer, code, stState: game,
      registry: buildRegistry(tbScript), online: {}, membership: { [alice]: "p-alice" } });
    try {
      await writer.start();
      await knockOnLobby(backend(alice), code, alice, "Alice");
      await seatPlayer(writer, code, alice, "p-alice", null);
      await publish();
      expect((await ref(alice, "player/p-alice").once("value")).val()).toBeNull();
      expect((await ref(st, "storyteller/players/p-alice/actualRole").once("value")).val()).toBe(actual);
      game.players["p-alice"]!.shownRole = shown!;
      game.players["p-alice"]!.shownAlignment = null;
      await publish();
      const self = (await ref(alice, "player/p-alice").once("value")).val();
      expect(self).toEqual({ shownRole: shown, shownAlignment: alignment });
      expect(JSON.stringify(self)).not.toContain(actual);
      await assertFails(ref(bob, "player/p-alice").once("value"));
      await assertFails(ref(alice, "storyteller").once("value"));
      await assertFails(ref(alice, "checkpoint").once("value"));
      await revokePlayerMembership(writer, code, "p-alice");
      await assertFails(ref(alice, "player/p-alice").once("value"));
      expect((await ref(st, "player/p-alice").once("value")).exists()).toBe(false);
    } finally { await writer.dispose(); }
  });

  // Phase 9C.4 (OPUS-004) — proves the setup all-or-none projection barrier
  // through the REAL writer, REAL enforced rules.json, and REAL live listeners
  // for two real authenticated players — not a unit-level projection check.
  test("OPUS-004: the setup all-or-none barrier holds through the real writer, enforced rules, and live listeners", async () => {
    const raw = new FirebaseRoomBackend(db(st) as unknown as Database);
    await createLobby(raw, st, { codeGenerator: () => code });
    const metadata = (await ref(st, "session").once("value")).val();
    const writer = new SessionWriter(raw, code, metadata.id);
    const game: StorytellerLobbyRecord = {
      code, storytellerUid: st, scriptId: "tb", phase: "setup", day: 0,
      notes: "Storyteller only", bluffs: [], fabled: [], lorics: [], nightProgress: {}, history: [], informationDeliveries: [],
      rolePool: [], plannedPlayerCount: 2, plannedTravelerCount: 0, pendingPlayers: {}, seatOrder: ["p-alice", "p-bob"],
      // This test isolates the completeness barrier, not Setup deal/reveal
      // gating -- record the initial reveal directly.
      setupRolesRevealed: true,
      players: {
        // Alice: concealed role, no shownRole yet — the negative-space case.
        "p-alice": makeSTPlayer({ id: "p-alice", seat: 0, actualRole: "lunatic",
          shownRole: null, shownAlignment: null, behaviorMode: "normal" }),
        // Bob: a normal, fully-configured ordinary identity.
        "p-bob": makeSTPlayer({ id: "p-bob", seat: 1, actualRole: "chef", shownRole: "chef" }),
      },
    };
    const publish = () => writeProjections({ backend: writer, code, stState: game,
      registry: buildRegistry(tbScript), online: {}, membership: { [alice]: "p-alice", [bob]: "p-bob" } });

    const aliceValues: unknown[] = [];
    const bobValues: unknown[] = [];
    const aliceRecord = ref(alice, "player/p-alice");
    const bobRecord = ref(bob, "player/p-bob");
    try {
      await writer.start();
      await knockOnLobby(backend(alice), code, alice, "Alice");
      await seatPlayer(writer, code, alice, "p-alice", null);
      await knockOnLobby(backend(bob), code, bob, "Bob");
      await seatPlayer(writer, code, bob, "p-bob", null);

      // Real live client subscriptions ("start both real player handshakes"),
      // using the same subscribe() boundary playerSync.ts builds on. Attached
      // once each player is seated (read-authorized) but still fully within
      // the barred window — before either record is ever published.
      aliceRecord.on("value", snap => aliceValues.push(snap.val()));
      bobRecord.on("value", snap => bobValues.push(snap.val()));
      await vi.waitFor(() => { if (!aliceValues.length) throw new Error("Alice's live listener has not fired yet"); });
      await vi.waitFor(() => { if (!bobValues.length) throw new Error("Bob's live listener has not fired yet"); });
      expect(aliceValues.at(-1)).toBeNull();
      expect(bobValues.at(-1)).toBeNull();

      // Publish while Alice's (concealed) perception is still unconfigured.
      // All-or-none: Bob's own otherwise-complete record must be withheld too.
      await publish();
      expect((await ref(alice, "player/p-alice").once("value")).val()).toBeNull();
      expect((await ref(bob, "player/p-bob").once("value")).val()).toBeNull();
      await assertFails(ref(alice, "player/p-bob").once("value"));
      await assertFails(ref(bob, "player/p-alice").once("value"));
      // Across the barred window, the live listeners never observed anything
      // but self === null.
      expect(aliceValues.every(v => v === null)).toBe(true);
      expect(bobValues.every(v => v === null)).toBe(true);

      // Configure the final concealed shown identity and publish once.
      game.players["p-alice"]!.shownRole = "imp";
      game.players["p-alice"]!.shownAlignment = null;
      await publish();

      const aliceSelf = { shownRole: "imp", shownAlignment: "evil" };
      const bobSelf = { shownRole: "chef", shownAlignment: "good" };
      expect((await ref(alice, "player/p-alice").once("value")).val()).toEqual(aliceSelf);
      expect((await ref(bob, "player/p-bob").once("value")).val()).toEqual(bobSelf);
      await assertFails(ref(alice, "player/p-bob").once("value"));
      await assertFails(ref(bob, "player/p-alice").once("value"));

      // The SAME live listeners, established during the barred window,
      // eventually converge to each player's own correct identity — proving
      // no Storyteller-paced state ever existed where one occupied ordinary
      // player had a published identity while the other stayed withheld.
      await vi.waitFor(() => { if (!aliceValues.length || aliceValues.at(-1) === null) throw new Error("Alice's live listener has not converged yet"); });
      await vi.waitFor(() => { if (!bobValues.length || bobValues.at(-1) === null) throw new Error("Bob's live listener has not converged yet"); });
      expect(aliceValues.at(-1)).toEqual(aliceSelf);
      expect(bobValues.at(-1)).toEqual(bobSelf);
    } finally {
      aliceRecord.off();
      bobRecord.off();
      await writer.dispose();
    }
  });

  test("AUD-027: preview stays private; explicit fake information delivery is guarded, isolated, and revocable", async () => {
    const store = useStorytellerStore;
    store.setState({ game: null, lobby: null, undoStack: [] });
    const raw = new FirebaseRoomBackend(db(st) as unknown as Database);
    await createLobby(raw, st, { codeGenerator: () => code });
    const metadata = (await ref(st, "session").once("value")).val();
    const writer = new SessionWriter(raw, code, metadata.id);
    store.getState().newGame("tb");
    store.getState().addPlayer("Alice");
    store.getState().addPlayer("Bob");
    const [id, other] = store.getState().game!.seatOrder as [string, string];
    store.getState().setLobby({ code, uid: st, sessionId: metadata.id, status: "live" });
    // Phase 9C.4: ordinary setup publication is all-or-none. Bob (other)
    // must have a complete identity too, or the barrier would withhold
    // Alice's own otherwise-complete record — unrelated to what this proves.
    store.getState().assignRole(other, "washerwoman");
    store.getState().setShownRole(other, "washerwoman");
    store.getState().assignRole(id, "lunatic");
    store.getState().setBehaviorMode(id, "fake_demon_behavior");
    store.getState().setShownRole(id, "imp");
    store.getState().setFakeMinions(id, [other]);
    store.getState().setBluffs(id, ["chef", "saint", "washerwoman"]);
    store.getState().setPrivateText(id, "Only Alice should receive this");
    // This test isolates private-packet delivery, not Setup deal/reveal
    // gating -- record the initial reveal directly.
    store.setState({ game: { ...store.getState().game!, setupRolesRevealed: true } });
    const reviewed = previewPrivatePacket(store.getState().game!.players[id]!, store.getState().game!, buildRegistry(tbScript));
    const preview = reviewed.payload;
    try {
      await writer.start();
      await knockOnLobby(backend(alice), code, alice, "Alice");
      await seatPlayer(writer, code, alice, id, null);
      await knockOnLobby(backend(bob), code, bob, "Bob");
      await seatPlayer(writer, code, bob, other, null);
      await writeProjections({ backend: writer, code, stState: store.getState().game!,
        registry: buildRegistry(tbScript), online: {}, membership: { [alice]: id, [bob]: other } });
      expect((await ref(alice, `player/${id}`).once("value")).val()).toEqual({ shownRole: "imp", shownAlignment: "evil" });
      await assertFails(ref(alice, `storyteller/players/${id}/privateInfo`).once("value"));
      await assertFails(ref(alice, "checkpoint").once("value"));
      await publishPrivatePacket(id, reviewed, writer);
      const payload = (await ref(alice, `player/${id}`).once("value")).val();
      expect(payload).toEqual(preview);
      expect(payload.minions).toEqual([{ id: other, name: "Bob", seat: 1 }]);
      for (const secret of ["actualRole", "actualAlignment", "lunatic", "behaviorMode", "stNotes", "packetPreview", "publishedPacket"])
        expect(JSON.stringify(payload)).not.toContain(secret);
      expect((await ref(st, `storyteller/players/${id}/actualRole`).once("value")).val()).toBe("lunatic");
      await assertFails(ref(bob, `player/${id}`).once("value"));
      await assertFails(ref(alice, `player/${id}/extraText`).set("forged delivery"));
      await assertFails(ref(alice, `storyteller/players/${id}/publishedPacket`).once("value"));
      await revokePlayerMembership(writer, code, id);
      await assertFails(ref(alice, `player/${id}`).once("value"));
      expect((await ref(st, `player/${id}`).once("value")).exists()).toBe(false);
    } finally {
      await writer.dispose();
      store.setState({ game: null, lobby: null, undoStack: [] });
    }
  });

  test("Phase 9B: Traveler truth is owner-only; public character and explicit Demon delivery survive exile until departure", async () => {
    const store = useStorytellerStore;
    store.setState({ game: null, lobby: null, undoStack: [] });
    const raw = new FirebaseRoomBackend(db(st) as unknown as Database);
    await createLobby(raw, st, { codeGenerator: () => code });
    const metadata = (await ref(st, "session").once("value")).val();
    const writer = new SessionWriter(raw, code, metadata.id);
    store.getState().newGame("tb"); store.getState().addPlayer("Traveler"); store.getState().addPlayer("Demon");
    const [id, other] = store.getState().game!.seatOrder as [string, string];
    // Phase 9 Setup finalization B4 revision: setIsTraveler refuses ordinary
    // -> Traveler once occupied ordinary would drop below 5 -- seed enough
    // extra ordinary players first (unrelated to this test's actual focus).
    // Each needs a real canonical actual role: travelerDemonInformation's
    // "complex setup" check treats any unassigned seat as disqualifying.
    for (const role of ["chef", "empath", "fortuneteller", "undertaker"]) {
      store.getState().addPlayer("Extra " + role);
      store.getState().assignRole(store.getState().game!.seatOrder.at(-1)!, role);
    }
    store.getState().setLobby({ code, uid: st, sessionId: metadata.id, status: "live" });
    store.getState().setIsTraveler(id, true); store.getState().assignRole(id, "thief");
    store.getState().setTravelerAlignment(id, "evil"); store.getState().assignRole(other, "imp");
    const flush = () => writeProjections({ backend: writer, code, stState: store.getState().game!,
      registry: buildRegistry(troubleBrewing), online: {}, membership: { [alice]: id, [bob]: other } });
    try {
      await writer.start();
      await knockOnLobby(backend(alice), code, alice, "Traveler"); await seatPlayer(writer, code, alice, id, null);
      await knockOnLobby(backend(bob), code, bob, "Demon"); await seatPlayer(writer, code, bob, other, null);
      await flush();
      const pub = (await ref(bob, `public/players/${id}`).once("value")).val();
      expect(pub.publicDisplayRole).toBe("thief"); expect(pub.actualAlignment).toBeUndefined();
      expect((await ref(alice, `player/${id}`).once("value")).val()).toEqual({ shownRole: "thief", shownAlignment: "evil" });
      await assertFails(ref(alice, `storyteller/players/${id}/actualAlignment`).once("value"));
      await assertFails(ref(alice, "checkpoint").once("value"));
      await assertFails(ref(alice, `storyteller/players/${id}/actualAlignment`).set("good"));
      store.getState().prepareTravelerDemon(id);
      const preview = previewPrivatePacket(store.getState().game!.players[id]!, store.getState().game!, buildRegistry(troubleBrewing));
      await publishPrivatePacket(id, preview, writer);
      expect((await ref(alice, `player/${id}/demon`).once("value")).val()).toEqual({ id: other, name: "Demon", seat: 1 });
      await assertFails(ref(bob, `player/${id}`).once("value"));
      store.getState().exileTraveler(id); await flush();
      expect((await ref(alice, `roster/${alice}`).once("value")).val()).toBe(id);
      expect((await ref(alice, `player/${id}`).once("value")).exists()).toBe(true);
      await revokePlayerMembership(writer, code, id);
      await assertFails(ref(alice, `player/${id}`).once("value"));
      await assertFails(ref(alice, "public").once("value"));
    } finally { await writer.dispose(); store.setState({ game: null, lobby: null, undoStack: [] }); }
  });

  test("ending atomically revokes all access and rejects stale projections and joins", async () => {
    await seed();
    await env.withSecurityRulesDisabled(async ctx => { await ctx.database().ref(path("writer/expiresAt")).set(0); });
    const raw = new FirebaseRoomBackend(db(st) as unknown as Database);
    const writer = new SessionWriter(raw, code, "test-session");
    try {
      await writer.start();
      await writer.close(["p-alice", "p-bob"]);
      expect((await ref(bob, "session/state").once("value")).val()).toBe("ended");
      expect((await ref(st, "roster").once("value")).exists()).toBe(false);
      await assertFails(ref(alice, "player/p-alice").once("value"));
      await assertFails(ref(bob, "joinRequests/" + bob).set("Bob"));
      await assertFails(raw.update({ [path("public")]: { phase: "day" }, [path("writeGuard")]: { token: writer.token, revision: 100 } }));
      await assertFails(raw.set(path("session/state"), "active"));
      await assertFails(raw.set(path("public"), { phase: "day" }));
    } finally { await writer.dispose(); }
  });

  test("writer fields deny other UIDs, malformed leases, and unguarded owner writes", async () => {
    await seed();
    await assertFails(ref(bob, "writer").set({ token: "attack", expiresAt: Date.now() + 1000 }));
    await assertFails(ref(st, "writer").set({ token: "fixture-writer", expiresAt: Date.now() + 100_000 }));
    await assertFails(ref(st, "public").set({ phase: "day" }));
    await assertFails(ref(st, "roster/" + bob).set("p-bob"));
  });

  test("an earlier revision cannot overwrite a later projection", async () => {
    await seed();
    await backend(st).set(path("public/day"), 1);
    await assertFails(db(st).ref().update({ [path("public/day")]: 0, [path("writeGuard")]: { token: "fixture-writer", revision: 1 } }));
    expect((await ref(st, "public/day").once("value")).val()).toBe(1);
  });

  // Phase 9C.2A.2A remediation, Finding H2: checkpoint identity is the
  // server writeGuard alone (never a serialized checkpoint comparison) —
  // sound only because the rules below make it so: a checkpoint write is
  // never accepted unless it is bundled, in the same multi-path update,
  // with a writeGuard revision that strictly exceeds the current one.
  test("H2: checkpoint cannot be written without a strictly advancing writeGuard revision, in the same update", async () => {
    await seed(); // seeds writeGuard at revision 0
    // No writeGuard at all in the write.
    await assertFails(ref(st, "checkpoint").set(JSON.stringify({ game: {}, roster: {} })));
    expect((await ref(st, "checkpoint").once("value")).exists()).toBe(false);
    // Bundled with a writeGuard revision that does not strictly exceed the
    // current one (0) is denied.
    await assertFails(db(st).ref().update({
      [path("checkpoint")]: JSON.stringify({ game: {}, roster: {} }),
      [path("writeGuard")]: { token: "fixture-writer", revision: 0 },
    }));
    expect((await ref(st, "checkpoint").once("value")).exists()).toBe(false);
    // Bundled with a strictly advancing revision succeeds — the exact
    // invariant Finding H2's checkpoint identity fix relies on: checkpoint
    // changed implies writeGuard strictly advanced.
    await assertSucceeds(db(st).ref().update({
      [path("checkpoint")]: JSON.stringify({ game: {}, roster: {} }),
      [path("writeGuard")]: { token: "fixture-writer", revision: 1 },
    }));
    expect((await ref(st, "checkpoint").once("value")).val()).toBe(JSON.stringify({ game: {}, roster: {} }));
    // Reusing the now-current revision (1) — not a NEW one — is denied too:
    // strictly greater, never merely different.
    await assertFails(db(st).ref().update({
      [path("checkpoint")]: JSON.stringify({ game: {}, roster: {}, notes: "different content, same revision" }),
      [path("writeGuard")]: { token: "fixture-writer", revision: 1 },
    }));
    expect((await ref(st, "checkpoint").once("value")).val()).toBe(JSON.stringify({ game: {}, roster: {} }));
  });
});

// Phase 9C.6 (OPUS-002): separate-device Public Display authorization.
// `displayAccess` (Storyteller-owned capability) and `displayMembers/{uid}`
// (a display's own enrollment) are exercised against the REAL enforced
// rules.json, using the real production publicDisplayAuth commands and a
// real SessionWriter wherever a Storyteller write is under test. Direct
// rule-boundary attacks (unfenced writes, non-advancing revisions, foreign
// writer tokens, malformed shapes) use explicit raw writes, mirroring the
// "H2" checkpoint-fencing tests above.
describe("Phase 9C.6 (OPUS-002): Public Display capability authorization", () => {
  const code = "DISP2345";
  const otherCode = "DISP9999";
  const st = "uid-st-display";
  const stOther = "uid-st-display-b";
  const alice = "uid-alice-display";
  const displayUid = "uid-display-1";
  const otherDisplayUid = "uid-display-2";
  const nonMember = "uid-nonmember-display";
  const sessionId = "test-session";
  const path = (c: string, suffix: string) => "lobbies/" + c + "/" + suffix;
  const db = (uid: string) => env.authenticatedContext(uid).database();
  const ref = (uid: string, suffix: string, c = code) => db(uid).ref(path(c, suffix));
  const rawBackendFor = (uid: string) => new FirebaseRoomBackend(db(uid) as unknown as Database);

  /** A fresh lobby with NO pre-existing `writer` lease (so a real
   * SessionWriter can acquire it cleanly) and no pre-existing `writeGuard`
   * (so a fresh capability write needs no revision to exceed). */
  async function seedLobby(c: string, owner: string, opts: { state?: "active" | "ended" } = {}) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref("lobbies/" + c).set({
        storytellerUid: owner,
        session: { version: 2, id: sessionId, state: opts.state ?? "active" },
        roster: { [alice]: "p-alice" },
        public: { code: c, scriptId: "tb", phase: "setup", day: 0 },
        player: { "p-alice": { shownRole: "chef", shownAlignment: "good" } },
        storyteller: { notes: "secret" },
        checkpoint: JSON.stringify({ game: {}, roster: {} }),
        joinRequests: {},
        presence: {},
      });
    });
  }

  /** A real, started SessionWriter for `owner` against the already-seeded
   * lobby — the actual production authority path ensurePublicDisplayAccess/
   * rotatePublicDisplayAccess must be invoked through. */
  async function realWriter(c: string, owner: string): Promise<SessionWriter> {
    const raw = rawBackendFor(owner);
    const session = await requireActiveSession(raw, c);
    const writer = new SessionWriter(raw, c, session.id);
    await writer.start();
    return writer;
  }

  async function authorizeDisplay(c: string, uid: string, token: string) {
    await authorizePublicDisplay(rawBackendFor(uid), c, uid, token);
  }

  /** Out-of-band inspection only (displayMembers has no read rule at all —
   * see PATH_AUDIT.md) — never used in place of the real enrollment write. */
  async function peekDisplayMember(c: string, uid: string): Promise<unknown> {
    // withSecurityRulesDisabled's own type is `Promise<void>` — it does not
    // propagate the callback's return value — so the read value is captured
    // via closure instead of `return`ed out of the callback.
    let value: unknown;
    await env.withSecurityRulesDisabled(async (ctx) => {
      value = (await ctx.database().ref(path(c, "displayMembers/" + uid)).once("value")).val();
    });
    return value;
  }

  test("closes the null===null hole: an unrelated authenticated UID and an unauthenticated client are both denied /public when no displayAccess/displayMembers exist", async () => {
    await seedLobby(code, st);
    await assertFails(ref(nonMember, "public").once("value"));
    const guest = env.unauthenticatedContext().database();
    await assertFails(guest.ref(path(code, "public")).once("value"));
  });

  test("Storyteller cannot write displayAccess directly, unfenced", async () => {
    await seedLobby(code, st);
    const token = generatePublicDisplayToken();
    await assertFails(ref(st, "displayAccess").set({ version: 1, sessionId, token }));
    expect((await ref(st, "displayAccess").once("value")).exists()).toBe(false);
  });

  test("a correctly fenced Storyteller write — the real ensurePublicDisplayAccess through a real SessionWriter — succeeds with the exact expected shape", async () => {
    await seedLobby(code, st);
    const writer = await realWriter(code, st);
    try {
      const token = await ensurePublicDisplayAccess(writer, code, sessionId);
      expect((await ref(st, "displayAccess").once("value")).val()).toEqual({ version: 1, sessionId, token });
    } finally { await writer.dispose(); }
  });

  test("a wrong/non-advancing writeGuard revision is denied", async () => {
    await seedLobby(code, st);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref(path(code, "writer")).set({ token: "fixture-writer", expiresAt: Date.now() + 30_000 });
      await ctx.database().ref(path(code, "writeGuard")).set({ token: "fixture-writer", revision: 3 });
    });
    const token = generatePublicDisplayToken();
    // Same revision as current (3): not strictly greater.
    await assertFails(db(st).ref().update({
      [path(code, "displayAccess")]: { version: 1, sessionId, token },
      [path(code, "writeGuard")]: { token: "fixture-writer", revision: 3 },
    }));
    // A LOWER revision is denied too.
    await assertFails(db(st).ref().update({
      [path(code, "displayAccess")]: { version: 1, sessionId, token },
      [path(code, "writeGuard")]: { token: "fixture-writer", revision: 2 },
    }));
    expect((await ref(st, "displayAccess").once("value")).exists()).toBe(false);
  });

  test("a foreign writer token is denied even with a strictly advancing revision", async () => {
    await seedLobby(code, st);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref(path(code, "writer")).set({ token: "real-writer-token", expiresAt: Date.now() + 30_000 });
      await ctx.database().ref(path(code, "writeGuard")).set({ token: "real-writer-token", revision: 1 });
    });
    const token = generatePublicDisplayToken();
    await assertFails(db(st).ref().update({
      [path(code, "displayAccess")]: { version: 1, sessionId, token },
      [path(code, "writeGuard")]: { token: "forged-token", revision: 2 },
    }));
    expect((await ref(st, "displayAccess").once("value")).exists()).toBe(false);
  });

  test("a malformed displayAccess shape/token is denied even when properly fenced", async () => {
    await seedLobby(code, st);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref(path(code, "writer")).set({ token: "real-writer-token", expiresAt: Date.now() + 30_000 });
    });
    let rev = 1;
    const fenced = (displayAccess: unknown) => db(st).ref().update({
      [path(code, "displayAccess")]: displayAccess,
      [path(code, "writeGuard")]: { token: "real-writer-token", revision: rev++ },
    });
    await assertFails(fenced({ version: 2, sessionId, token: generatePublicDisplayToken() })); // wrong version
    await assertFails(fenced({ version: 1, sessionId: "not-the-session", token: generatePublicDisplayToken() })); // wrong session
    await assertFails(fenced({ version: 1, sessionId: "", token: generatePublicDisplayToken() })); // empty session id
    await assertFails(fenced({ version: 1, sessionId, token: "too-short" })); // malformed token length
    await assertFails(fenced({ version: 1, sessionId, token: "+".repeat(43) })); // malformed token alphabet
    await assertFails(fenced({ version: 1, sessionId, token: generatePublicDisplayToken(), extra: "x" })); // unknown child
    await assertFails(fenced({ sessionId, token: generatePublicDisplayToken() })); // missing version
    expect((await ref(st, "displayAccess").once("value")).exists()).toBe(false);
  });

  test("a valid display capability lets the connecting UID create only its own displayMembers binding", async () => {
    await seedLobby(code, st);
    const writer = await realWriter(code, st);
    try {
      const token = await ensurePublicDisplayAccess(writer, code, sessionId);
      await authorizeDisplay(code, displayUid, token);
      expect(await peekDisplayMember(code, displayUid)).toBe(token);
    } finally { await writer.dispose(); }
  });

  test("an invalid token format is denied enrollment", async () => {
    await seedLobby(code, st);
    const writer = await realWriter(code, st);
    try {
      await ensurePublicDisplayAccess(writer, code, sessionId);
      await assertFails(ref(displayUid, "displayMembers/" + displayUid).set("not-a-valid-token"));
      await assertFails(ref(displayUid, "displayMembers/" + displayUid).set("a".repeat(42)));
      expect(await peekDisplayMember(code, displayUid)).toBeNull();
    } finally { await writer.dispose(); }
  });

  test("a stale/old token is denied after rotation", async () => {
    await seedLobby(code, st);
    const writer = await realWriter(code, st);
    try {
      const oldToken = await ensurePublicDisplayAccess(writer, code, sessionId);
      await rotatePublicDisplayAccess(writer, code, sessionId);
      await assertFails(ref(displayUid, "displayMembers/" + displayUid).set(oldToken));
    } finally { await writer.dispose(); }
  });

  test("a UID cannot enroll another UID's binding", async () => {
    await seedLobby(code, st);
    const writer = await realWriter(code, st);
    try {
      const token = await ensurePublicDisplayAccess(writer, code, sessionId);
      await assertFails(ref(displayUid, "displayMembers/" + otherDisplayUid).set(token));
      expect(await peekDisplayMember(code, otherDisplayUid)).toBeNull();
    } finally { await writer.dispose(); }
  });

  test("a parent/batch write to the entire displayMembers collection is denied", async () => {
    await seedLobby(code, st);
    const writer = await realWriter(code, st);
    try {
      const token = await ensurePublicDisplayAccess(writer, code, sessionId);
      await assertFails(ref(displayUid, "displayMembers").set({ [displayUid]: token }));
      expect(await peekDisplayMember(code, displayUid)).toBeNull();
    } finally { await writer.dispose(); }
  });

  test("a delete/null write through the enrollment rule is denied — isString() blocks it", async () => {
    await seedLobby(code, st);
    const writer = await realWriter(code, st);
    try {
      const token = await ensurePublicDisplayAccess(writer, code, sessionId);
      await authorizeDisplay(code, displayUid, token);
      await assertFails(ref(displayUid, "displayMembers/" + displayUid).remove());
      await assertFails(ref(displayUid, "displayMembers/" + displayUid).set(null));
      expect(await peekDisplayMember(code, displayUid)).toBe(token);
    } finally { await writer.dispose(); }
  });

  test("a capability from lobby A does not authorize enrollment in lobby B", async () => {
    await seedLobby(code, st);
    await seedLobby(otherCode, stOther);
    const writerA = await realWriter(code, st);
    try {
      const tokenA = await ensurePublicDisplayAccess(writerA, code, sessionId);
      await assertFails(db(displayUid).ref(path(otherCode, "displayMembers/" + displayUid)).set(tokenA));
      expect(await peekDisplayMember(otherCode, displayUid)).toBeNull();
    } finally { await writerA.dispose(); }
  });

  test("an ended session denies new enrollment", async () => {
    await seedLobby(code, st);
    const writer = await realWriter(code, st);
    let token: string;
    try { token = await ensurePublicDisplayAccess(writer, code, sessionId); }
    finally { await writer.dispose(); }
    await env.withSecurityRulesDisabled(async (ctx) => { await ctx.database().ref(path(code, "session/state")).set("ended"); });
    await assertFails(ref(displayUid, "displayMembers/" + displayUid).set(token));
    expect(await peekDisplayMember(code, displayUid)).toBeNull();
  });

  test("an authorized display UID can read /public; an unrelated authenticated UID remains denied", async () => {
    await seedLobby(code, st);
    const writer = await realWriter(code, st);
    try {
      const token = await ensurePublicDisplayAccess(writer, code, sessionId);
      await authorizeDisplay(code, displayUid, token);
      await assertSucceeds(ref(displayUid, "public").once("value"));
      expect((await ref(displayUid, "public").once("value")).val()).toMatchObject({ code });
      await assertFails(ref(nonMember, "public").once("value"));
    } finally { await writer.dispose(); }
  });

  test("an authorized display UID remains denied from every other private/security path, including another display's own binding", async () => {
    await seedLobby(code, st);
    const writer = await realWriter(code, st);
    try {
      const token = await ensurePublicDisplayAccess(writer, code, sessionId);
      await authorizeDisplay(code, displayUid, token);
      await authorizeDisplay(code, otherDisplayUid, token);
      await assertFails(ref(displayUid, "player/p-alice").once("value"));
      await assertFails(ref(displayUid, "player").once("value"));
      await assertFails(ref(displayUid, "storyteller").once("value"));
      await assertFails(ref(displayUid, "checkpoint").once("value"));
      await assertFails(ref(displayUid, "roster").once("value"));
      await assertFails(ref(displayUid, "joinRequests").once("value"));
      await assertFails(ref(displayUid, "presence").once("value"));
      await assertFails(ref(displayUid, "displayAccess").once("value"));
      await assertFails(ref(displayUid, "displayMembers").once("value"));
      await assertFails(ref(displayUid, "displayMembers/" + otherDisplayUid).once("value"));
    } finally { await writer.dispose(); }
  });

  test("display authorization cannot write the public projection, private player data, Storyteller data, or another security path", async () => {
    await seedLobby(code, st);
    const writer = await realWriter(code, st);
    try {
      const token = await ensurePublicDisplayAccess(writer, code, sessionId);
      await authorizeDisplay(code, displayUid, token);
      await assertFails(ref(displayUid, "public/day").set(99));
      await assertFails(ref(displayUid, "player/p-alice").set({ shownRole: "imp" }));
      await assertFails(ref(displayUid, "storyteller/notes").set("attack"));
      await assertFails(ref(displayUid, "displayAccess").set({ version: 1, sessionId, token: generatePublicDisplayToken() }));
      await assertFails(ref(displayUid, "displayMembers/" + otherDisplayUid).set(token));
      await assertFails(ref(displayUid, "roster/" + displayUid).set("p-hacked"));
    } finally { await writer.dispose(); }
  });

  test("token rotation immediately revokes the old display's /public access, without deleting the stale binding", async () => {
    await seedLobby(code, st);
    const writer = await realWriter(code, st);
    try {
      const oldToken = await ensurePublicDisplayAccess(writer, code, sessionId);
      await authorizeDisplay(code, displayUid, oldToken);
      await assertSucceeds(ref(displayUid, "public").once("value"));

      await rotatePublicDisplayAccess(writer, code, sessionId);

      await assertFails(ref(displayUid, "public").once("value"));
      expect(await peekDisplayMember(code, displayUid)).toBe(oldToken);
    } finally { await writer.dispose(); }
  });

  test("ending the session denies display /public access and denies new enrollment", async () => {
    await seedLobby(code, st);
    const writer = await realWriter(code, st);
    let token: string;
    try {
      token = await ensurePublicDisplayAccess(writer, code, sessionId);
      await authorizeDisplay(code, displayUid, token);
      await assertSucceeds(ref(displayUid, "public").once("value"));
    } finally { await writer.dispose(); }

    await env.withSecurityRulesDisabled(async (ctx) => { await ctx.database().ref(path(code, "session/state")).set("ended"); });

    await assertFails(ref(displayUid, "public").once("value"));
    await assertFails(ref(otherDisplayUid, "displayMembers/" + otherDisplayUid).set(token));
  });

  test("a multipath update combining a legal self-enrollment with an illegal write is rejected atomically", async () => {
    await seedLobby(code, st);
    const writer = await realWriter(code, st);
    try {
      const token = await ensurePublicDisplayAccess(writer, code, sessionId);
      await assertFails(db(displayUid).ref("lobbies/" + code).update({
        ["displayMembers/" + displayUid]: token,
        ["public/day"]: 42,
      }));
      expect(await peekDisplayMember(code, displayUid)).toBeNull();
      expect((await ref(st, "public/day").once("value")).val()).not.toBe(42);
    } finally { await writer.dispose(); }
  });

  test("a multipath/batch attempt to enroll multiple UIDs at once is rejected atomically", async () => {
    await seedLobby(code, st);
    const writer = await realWriter(code, st);
    try {
      const token = await ensurePublicDisplayAccess(writer, code, sessionId);
      await assertFails(db(displayUid).ref("lobbies/" + code).update({
        ["displayMembers/" + displayUid]: token,
        ["displayMembers/" + otherDisplayUid]: token,
      }));
      expect(await peekDisplayMember(code, displayUid)).toBeNull();
      expect(await peekDisplayMember(code, otherDisplayUid)).toBeNull();
    } finally { await writer.dispose(); }
  });
});

// ---------------------------------------------------------------------------
// Phase 9D.5 Proof E — writer replacement / stale-writer protection for a
// deliberately rich Phase 9 game, against the REAL Firebase RTDB emulator
// (never MemoryRoomBackend). Reuses the already-approved lease-fencing rule
// ("a second writer is denied until expiry, then the old token is fenced"
// above) and the real production writeProjections() chokepoint, to prove
// the rich game's structured domains -- History with Provenance,
// Information Delivery, structured Effects/Reminders, Traveler public
// character/private alignment/exile, and Storyteller-private notes --
// survive an actual writer-lease replacement enforced by real security
// rules, and that the stale (superseded) writer's own write is genuinely
// rejected by those rules rather than merely by client-side bookkeeping.
// ---------------------------------------------------------------------------
describe("Phase 9D.5 Proof E: writer replacement / stale-writer protection for a rich Phase 9 game (real emulator)", () => {
  const code = "RICH2345";
  const st = "uid-storyteller-rich";
  const path = (suffix: string) => "lobbies/" + code + "/" + suffix;
  const db = (uid: string) => env.authenticatedContext(uid).database();
  const ref = (uid: string, suffix: string) => db(uid).ref(path(suffix));

  test("a rich Phase 9 checkpoint survives real writer-lease replacement intact, and the stale writer's write is fenced by real security rules", async () => {
    useStorytellerStore.setState({
      game: null, lobby: null, undoStack: [], selectedPlayerId: null,
      localSeq: 0, sync: null, customScripts: {},
    });
    const handles = buildRichPhase9Game();
    const richGame = useStorytellerStore.getState().game!;

    const rawBackend = new FirebaseRoomBackend(db(st) as unknown as Database);
    await createLobby(rawBackend, st, { codeGenerator: () => code });
    const session = await requireActiveSession(rawBackend, code);
    const firstWriter = new SessionWriter(rawBackend, code, session.id);
    await firstWriter.start();

    // Publish the rich game through the real production projection
    // chokepoint against the real RTDB emulator -- never a hand-written
    // checkpoint blob.
    await writeProjections({
      backend: firstWriter, code, stState: { ...richGame, code, storytellerUid: st },
      registry: buildRegistry(troubleBrewing), online: {}, membership: {},
    });

    // A second writer is denied while the first's lease is still valid --
    // the already-approved lease-fencing rule, now guarding a real rich
    // checkpoint rather than a placeholder one.
    const secondWriter = new SessionWriter(rawBackend, code, session.id);
    await expect(secondWriter.start()).rejects.toThrow(/Another Storyteller/);

    // Force the lease to expire, then let the second writer legitimately
    // take over -- exactly the existing takeover reproduction above.
    await env.withSecurityRulesDisabled(async ctx => { await ctx.database().ref(path("writer/expiresAt")).set(0); });
    await secondWriter.start();

    // The stale (first) writer's own subsequent write is genuinely rejected
    // by real security rules (its writeGuard revision no longer matches) --
    // never merely prevented by this process's own bookkeeping.
    await expect(firstWriter.update({ [path("storyteller/notes")]: "STALE WRITE MUST BE REJECTED" })).rejects.toThrow();
    expect((await ref(st, "storyteller/notes").once("value")).val()).not.toBe("STALE WRITE MUST BE REJECTED");

    // The rich checkpoint the FIRST writer published before the takeover is
    // untouched by the rejected stale write, and correctly readable: every
    // Phase 9 structured domain survives the writer replacement intact and
    // unmixed.
    const rawCheckpoint = (await ref(st, "checkpoint").once("value")).val() as string;
    const parsed = JSON.parse(rawCheckpoint) as { game: StorytellerLobbyRecord };
    expect(parsed.game.history).toEqual(richGame.history);
    expect(parsed.game.history.length).toBeGreaterThan(0);
    expect(parsed.game.informationDeliveries).toEqual(richGame.informationDeliveries);
    expect(parsed.game.informationDeliveries.length).toBe(2);
    expect(parsed.game.players[handles.chefId]!.stNotes).toBe("SENTINEL-PRIVATE-CHEF-NOTE");
    expect(parsed.game.players[handles.travelerId]!.isTraveler).toBe(true);
    expect(parsed.game.players[handles.travelerId]!.actualAlignment).toBe("evil");
    expect(parsed.game.players[handles.travelerId]!.exiled).toBe(true);
    expect(parsed.game.players[handles.chefId]!.effects.some(e => e.type === "poisoned")).toBe(true);
    expect(parsed.game.players[handles.washerwomanId]!.effects.some(e => e.type === "protected")).toBe(true);
    expect(parsed.game.players[handles.deadOrdinaryId]!.alive).toBe(false);

    // The new (second) writer can legitimately write further, on top of the
    // still-intact rich checkpoint.
    await secondWriter.set(path("storyteller/notes"), "legitimate new writer");
    expect((await ref(st, "storyteller/notes").once("value")).val()).toBe("legitimate new writer");

    await firstWriter.dispose();
    await secondWriter.dispose();
  });
});
