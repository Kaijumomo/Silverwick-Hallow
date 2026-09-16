// Phase 9C.6 (OPUS-002) unit suite for the Public Display capability module.
// MemoryRoomBackend-level tests exercise the pure decode/ensure/rotate/
// authorize logic in isolation; one SessionWriter-backed test proves the
// writer-acknowledgement invariant (guard may advance, game/localSeq/
// ackedGameSeq must not) without needing the Firebase emulator — see
// rules.spec.ts/contract.spec.ts for the real-rules/real-writer proofs.
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";
import { displayAccessPath, displayMemberPath } from "./paths";
import { useStorytellerStore } from "@/stores/storytellerStore";
import {
  DISPLAY_ACCESS_VERSION,
  PUBLIC_DISPLAY_TOKEN_LENGTH,
  PUBLIC_DISPLAY_TOKEN_PATTERN,
  PublicDisplayAuthError,
  authorizePublicDisplay,
  buildPublicDisplayLink,
  decodeDisplayAccess,
  ensurePublicDisplayAccess,
  generatePublicDisplayToken,
  isValidDisplayToken,
  parseDisplayTokenFromFragment,
  rotatePublicDisplayAccess,
} from "./publicDisplayAuth";

const code = "DISP2345";

async function setup() {
  const b = new MemoryRoomBackend();
  await createLobby(b, "storyteller-uid", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  return { b, sessionId: session.id };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generatePublicDisplayToken", () => {
  it("produces exactly 43 characters", () => {
    const token = generatePublicDisplayToken();
    expect(token).toHaveLength(PUBLIC_DISPLAY_TOKEN_LENGTH);
  });

  it("uses only the valid base64url alphabet", () => {
    const token = generatePublicDisplayToken();
    expect(token).toMatch(PUBLIC_DISPLAY_TOKEN_PATTERN);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("produces distinct capabilities on repeated generation", () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generatePublicDisplayToken()));
    expect(tokens.size).toBe(20);
  });

  it("draws from crypto.getRandomValues, never Math.random", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    const mathRandomSpy = vi.spyOn(Math, "random");
    generatePublicDisplayToken();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(mathRandomSpy).not.toHaveBeenCalled();
  });

  it("fails closed with a generic error when secure randomness is unavailable, never falling back to Math.random", () => {
    vi.stubGlobal("crypto", undefined);
    const mathRandomSpy = vi.spyOn(Math, "random");
    expect(() => generatePublicDisplayToken()).toThrow(PublicDisplayAuthError);
    expect(mathRandomSpy).not.toHaveBeenCalled();
  });

  it("the unavailable-randomness error never contains any token-shaped content", () => {
    vi.stubGlobal("crypto", undefined);
    try {
      generatePublicDisplayToken();
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PublicDisplayAuthError);
      expect((e as Error).message).not.toMatch(/[A-Za-z0-9_-]{43}/);
    }
  });
});

describe("isValidDisplayToken", () => {
  it("accepts a real generated token", () => {
    expect(isValidDisplayToken(generatePublicDisplayToken())).toBe(true);
  });
  it.each([
    ["too short", "a".repeat(42)],
    ["too long", "a".repeat(44)],
    ["invalid character +", "+".repeat(43)],
    ["invalid character /", "/".repeat(43)],
    ["invalid character space", " ".repeat(43)],
    ["not a string", 12345],
    ["null", null],
    ["undefined", undefined],
  ])("rejects %s", (_label, value) => {
    expect(isValidDisplayToken(value)).toBe(false);
  });
});

describe("decodeDisplayAccess", () => {
  const validToken = "A".repeat(43);

  it("accepts a valid version/session/token record", () => {
    const decoded = decodeDisplayAccess({ version: 1, sessionId: "s1", token: validToken });
    expect(decoded).toEqual({ version: 1, sessionId: "s1", token: validToken });
  });

  it("returns null for an absent record", () => {
    expect(decodeDisplayAccess(null)).toBeNull();
    expect(decodeDisplayAccess(undefined)).toBeNull();
  });

  it("rejects a malformed version", () => {
    expect(decodeDisplayAccess({ version: 2, sessionId: "s1", token: validToken })).toBeNull();
    expect(decodeDisplayAccess({ version: "1", sessionId: "s1", token: validToken })).toBeNull();
    expect(decodeDisplayAccess({ sessionId: "s1", token: validToken })).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(decodeDisplayAccess({ version: 1, sessionId: "s1", token: "a".repeat(42) })).toBeNull();
    expect(decodeDisplayAccess({ version: 1, sessionId: "s1", token: "not base64url!!" })).toBeNull();
    expect(decodeDisplayAccess({ version: 1, sessionId: "s1", token: 12345 })).toBeNull();
  });

  it("rejects an empty sessionId", () => {
    expect(decodeDisplayAccess({ version: 1, sessionId: "", token: validToken })).toBeNull();
  });

  it("rejects unknown/malformed records", () => {
    expect(decodeDisplayAccess("just a string")).toBeNull();
    expect(decodeDisplayAccess(42)).toBeNull();
    expect(decodeDisplayAccess([])).toBeNull();
    expect(decodeDisplayAccess({ version: 1, sessionId: "s1", token: validToken, extra: "field" })).toBeNull();
  });
});

describe("ensurePublicDisplayAccess", () => {
  it("absent access: performs one fenced write and returns a fresh token", async () => {
    const { b, sessionId } = await setup();
    expect(await b.get(displayAccessPath(code))).toBeUndefined();

    const token = await ensurePublicDisplayAccess(b, code, sessionId);

    expect(isValidDisplayToken(token)).toBe(true);
    const stored = await b.get(displayAccessPath(code));
    expect(stored).toEqual({ version: DISPLAY_ACCESS_VERSION, sessionId, token });
  });

  it("valid current-session access is reused with ZERO writes", async () => {
    const { b, sessionId } = await setup();
    const first = await ensurePublicDisplayAccess(b, code, sessionId);
    const writesAfterFirst = b.writeLog.length;

    const second = await ensurePublicDisplayAccess(b, code, sessionId);

    expect(second).toBe(first);
    expect(b.writeLog.length).toBe(writesAfterFirst);
  });

  it("repeated ensure calls never advance writer guard/revision state", async () => {
    const { b, sessionId } = await setup();
    const writer = new SessionWriter(b, code, sessionId);
    try {
      await writer.start();
      const first = await ensurePublicDisplayAccess(writer, code, sessionId);
      const guardAfterFirst = await b.get(`lobbies/${code}/writeGuard`);

      const second = await ensurePublicDisplayAccess(writer, code, sessionId);
      const third = await ensurePublicDisplayAccess(writer, code, sessionId);

      expect(second).toBe(first);
      expect(third).toBe(first);
      expect(await b.get(`lobbies/${code}/writeGuard`)).toEqual(guardAfterFirst);
    } finally {
      await writer.dispose();
    }
  });

  it("malformed access is replaced with a fresh valid record", async () => {
    const { b, sessionId } = await setup();
    await b.set(displayAccessPath(code), { version: 2, sessionId, token: "garbage" });

    const token = await ensurePublicDisplayAccess(b, code, sessionId);

    expect(isValidDisplayToken(token)).toBe(true);
    expect(await b.get(displayAccessPath(code))).toEqual({ version: DISPLAY_ACCESS_VERSION, sessionId, token });
  });

  it("a session mismatch mints a NEW token — the old token is never preserved under the new session id", async () => {
    const { b, sessionId } = await setup();
    const originalToken = await ensurePublicDisplayAccess(b, code, sessionId);

    const otherSessionId = "a-different-session";
    const rotatedToken = await ensurePublicDisplayAccess(b, code, otherSessionId);

    expect(rotatedToken).not.toBe(originalToken);
    expect(await b.get(displayAccessPath(code))).toEqual({
      version: DISPLAY_ACCESS_VERSION,
      sessionId: otherSessionId,
      token: rotatedToken,
    });
  });

  it("runs through writer.runExclusive when the backend exposes it, rather than a second serialization mechanism", async () => {
    const { b, sessionId } = await setup();
    const writer = new SessionWriter(b, code, sessionId);
    try {
      await writer.start();
      let sawExclusive = false;
      const originalRunExclusive = writer.runExclusive.bind(writer);
      writer.runExclusive = (op) => { sawExclusive = true; return originalRunExclusive(op); };
      await ensurePublicDisplayAccess(writer, code, sessionId);
      expect(sawExclusive).toBe(true);
    } finally {
      await writer.dispose();
    }
  });
});

describe("rotatePublicDisplayAccess", () => {
  it("always writes a fresh token, even over a valid current-session record", async () => {
    const { b, sessionId } = await setup();
    const original = await ensurePublicDisplayAccess(b, code, sessionId);

    const rotated = await rotatePublicDisplayAccess(b, code, sessionId);

    expect(rotated).not.toBe(original);
    expect(await b.get(displayAccessPath(code))).toEqual({ version: DISPLAY_ACCESS_VERSION, sessionId, token: rotated });
  });

  it("advances ackedGuard through writer ack plumbing but never touches game, localSeq, undo, or ackedGameSeq", async () => {
    const { b, sessionId } = await setup();
    useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], sync: null, localSeq: 0 });
    useStorytellerStore.getState().ensureSyncScope(code, sessionId);
    const writer = new SessionWriter(b, code, sessionId);
    writer.onAttempt = guard => useStorytellerStore.getState().noteWriterAttempt(code, sessionId, guard);
    writer.onAck = guard => useStorytellerStore.getState().noteWriterAck(code, sessionId, guard);
    try {
      await writer.start();
      const gameBefore = useStorytellerStore.getState().game;
      const undoBefore = useStorytellerStore.getState().undoStack;
      const localSeqBefore = useStorytellerStore.getState().localSeq;
      const ackedGameSeqBefore = useStorytellerStore.getState().sync!.ackedGameSeq;

      const token = await rotatePublicDisplayAccess(writer, code, sessionId);

      expect(isValidDisplayToken(token)).toBe(true);
      expect(useStorytellerStore.getState().game).toBe(gameBefore);
      expect(useStorytellerStore.getState().undoStack).toBe(undoBefore);
      expect(useStorytellerStore.getState().localSeq).toBe(localSeqBefore);
      expect(useStorytellerStore.getState().sync!.ackedGameSeq).toBe(ackedGameSeqBefore);
      // The write DID genuinely go through the writer's guard plumbing.
      expect(useStorytellerStore.getState().sync!.ackedGuard).toEqual({ token: writer.token, revision: 1 });
    } finally {
      await writer.dispose();
      useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], sync: null, localSeq: 0 });
    }
  });

  it("does not enumerate or delete existing displayMembers bindings", async () => {
    const { b, sessionId } = await setup();
    const originalToken = await ensurePublicDisplayAccess(b, code, sessionId);
    await authorizePublicDisplay(b, code, "display-uid", originalToken);

    await rotatePublicDisplayAccess(b, code, sessionId);

    // The stale binding is left in place (revocation is enforced by the
    // rules comparing it against the NEW displayAccess token, not by
    // deleting it — see rules.spec.ts).
    expect(await b.get(displayMemberPath(code, "display-uid"))).toBe(originalToken);
  });
});

describe("authorizePublicDisplay", () => {
  it("writes the token to the caller's own displayMembers/{uid} binding", async () => {
    const { b, sessionId } = await setup();
    const token = await ensurePublicDisplayAccess(b, code, sessionId);

    await authorizePublicDisplay(b, code, "display-uid", token);

    expect(await b.get(displayMemberPath(code, "display-uid"))).toBe(token);
  });

  it("rejects a malformed token locally without writing anything", async () => {
    const { b } = await setup();
    const writesBefore = b.writeLog.length;

    await expect(authorizePublicDisplay(b, code, "display-uid", "not-a-valid-token")).rejects.toThrow(PublicDisplayAuthError);

    expect(b.writeLog.length).toBe(writesBefore);
    expect(await b.get(displayMemberPath(code, "display-uid"))).toBeUndefined();
  });

  it("never includes the token in a thrown error's message", async () => {
    const { b } = await setup();
    const suspiciousToken = "TOKEN-CONTENTS-SHOULD-NEVER-LEAK-000000000";
    try {
      await authorizePublicDisplay(b, code, "display-uid", suspiciousToken);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(suspiciousToken);
    }
  });
});

describe("parseDisplayTokenFromFragment", () => {
  it("extracts a valid token from a #displayToken= fragment", () => {
    const token = generatePublicDisplayToken();
    expect(parseDisplayTokenFromFragment(`#displayToken=${token}`)).toBe(token);
  });

  it("works without a leading #", () => {
    const token = generatePublicDisplayToken();
    expect(parseDisplayTokenFromFragment(`displayToken=${token}`)).toBe(token);
  });

  it.each([
    ["empty fragment", ""],
    ["bare hash", "#"],
    ["wrong key", `#other=${"a".repeat(43)}`],
    ["malformed token (too short)", "#displayToken=short"],
    ["malformed token (bad characters)", `#displayToken=${"+".repeat(43)}`],
    ["missing value", "#displayToken="],
  ])("returns null for %s", (_label, hash) => {
    expect(parseDisplayTokenFromFragment(hash)).toBeNull();
  });
});

describe("buildPublicDisplayLink", () => {
  it("places the token only in the fragment, never in the query string", () => {
    const token = generatePublicDisplayToken();
    const link = buildPublicDisplayLink({ origin: "https://example.com", pathname: "/app/" }, "ABCD1234", token);
    const url = new URL(link);
    expect(url.search).toBe("?display=public&code=ABCD1234");
    expect(url.search).not.toContain(token);
    expect(url.hash).toBe(`#displayToken=${token}`);
  });

  it("uses the given origin/path rather than a hardcoded hostname", () => {
    const token = generatePublicDisplayToken();
    const link = buildPublicDisplayLink({ origin: "https://my-deploy.example", pathname: "/silverwick/" }, "WXYZ9999", token);
    expect(link.startsWith("https://my-deploy.example/silverwick/")).toBe(true);
  });

  it("round-trips through parseDisplayTokenFromFragment", () => {
    const token = generatePublicDisplayToken();
    const link = buildPublicDisplayLink({ origin: "https://example.com", pathname: "/" }, "ABCD1234", token);
    const url = new URL(link);
    expect(parseDisplayTokenFromFragment(url.hash)).toBe(token);
  });
});
