// FirebaseRoomBackend error attribution (Go Live hotfix): a failed request is
// tagged with its operation and path for developer diagnostics, without
// changing how the error settles, its identity, message or code.
import { describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ update: vi.fn(), get: vi.fn() }));
vi.mock("firebase/database", () => ({
  ref: (_db: unknown, path?: string) => ({ path }),
  update: sdk.update,
  get: sdk.get,
  set: vi.fn(), onValue: vi.fn(), onDisconnect: vi.fn(), runTransaction: vi.fn(),
}));
vi.mock("firebase/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase/auth", () => ({ getAuth: vi.fn(), signInAnonymously: vi.fn() }));

import { FirebaseRoomBackend } from "./firebaseBackend";
import { firebaseOperationOf } from "./lifecycle";

describe("FirebaseRoomBackend error attribution", () => {
  it("a synchronous SDK throw still surfaces as a rejection of the same error, now attributed", async () => {
    const thrown = new Error("Invalid priority type found: boolean");
    sdk.update.mockImplementation(() => { throw thrown; });
    const backend = new FirebaseRoomBackend({} as never);
    let result: Promise<void> | undefined;
    expect(() => { result = backend.update({ "lobbies/X/storyteller": 1 }); }).not.toThrow();
    await expect(result).rejects.toBe(thrown);
    expect(firebaseOperationOf(thrown)).toBe("update lobbies/X/storyteller");
  });

  it("an async rejection keeps its identity, message and code", async () => {
    const denied = Object.assign(new Error("Permission denied"), { code: "PERMISSION_DENIED" });
    sdk.get.mockRejectedValue(denied);
    const backend = new FirebaseRoomBackend({} as never);
    await expect(backend.get("lobbies/X/membershipRevocations")).rejects.toBe(denied);
    expect(denied.message).toBe("Permission denied");
    expect(denied.code).toBe("PERMISSION_DENIED");
    expect(firebaseOperationOf(denied)).toBe("get lobbies/X/membershipRevocations");
    expect(Object.keys(denied)).toEqual(["code"]);
  });
});
