import { describe, it, expect, afterEach } from "vitest";
import {
  clearActiveBackend,
  getActiveBackend,
  getActiveUid,
  __setActiveBackendForTests,
} from "./session";
import { MemoryRoomBackend } from "@/test/memoryBackend";

afterEach(() => {
  // Always reset module state between tests.
  __setActiveBackendForTests(null, null);
});

describe("clearActiveBackend", () => {
  it("makes getActiveBackend() throw after a backend was set", () => {
    const b = new MemoryRoomBackend();
    __setActiveBackendForTests(b, "uid-test");

    // Verify both getters work before clearing.
    expect(getActiveBackend()).toBe(b);
    expect(getActiveUid()).toBe("uid-test");

    clearActiveBackend();

    expect(() => getActiveBackend()).toThrow(
      "No active Firebase backend"
    );
    expect(() => getActiveUid()).toThrow("Not authenticated");
  });

  it("is a no-op when no backend is set", () => {
    // Should not throw even when already null.
    expect(() => clearActiveBackend()).not.toThrow();
    expect(() => getActiveBackend()).toThrow("No active Firebase backend");
  });
});
