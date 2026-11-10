// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BUILD_EMULATOR_HOST, EMULATOR_PORTS, localEmulatorHost } from "./emulator";

describe("local emulator harness switch (WP 4-1b)", () => {
  it("is off in every ordinary build and in tests", () => {
    expect(BUILD_EMULATOR_HOST).toBe("");
  });

  it("accepts only loopback hosts", () => {
    expect(localEmulatorHost("")).toBeNull();
    expect(localEmulatorHost("  ")).toBeNull();
    expect(localEmulatorHost("127.0.0.1")).toBe("127.0.0.1");
    expect(localEmulatorHost("localhost")).toBe("localhost");
    for (const host of ["0.0.0.0", "192.168.1.20", "example.com", "silverwick-hollow-default-rtdb.firebaseio.com"]) {
      expect(() => localEmulatorHost(host)).toThrow(/loopback/);
    }
  });

  it("uses the ports in firebase.harness.json", async () => {
    const { readFileSync } = await import("node:fs");
    const config = JSON.parse(readFileSync(new URL("../../firebase.harness.json", import.meta.url), "utf8"));
    expect(config.emulators.auth.port).toBe(EMULATOR_PORTS.auth);
    expect(config.emulators.database.port).toBe(EMULATOR_PORTS.database);
    expect(config.database[0]).toEqual({ instance: "silverwick-hollow-default-rtdb", rules: "src/firebase/rules.json" });
  });
});
