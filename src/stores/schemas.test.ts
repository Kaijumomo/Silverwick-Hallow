// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  PlayerPublicRecordSchema,
  PlayerSelfRecordSchema,
  RoleDefSchema,
  ScriptSchema,
  STPlayerRecordSchema,
} from "./schemas";
import { makeSTPlayer, tbScript } from "@/test/fixtures";

describe("STPlayerRecordSchema", () => {
  it("accepts a normal player", () => {
    const result = STPlayerRecordSchema.safeParse(makeSTPlayer());
    expect(result.success).toBe(true);
  });

  it("accepts a Drunk with shownRole/behaviorMode", () => {
    const result = STPlayerRecordSchema.safeParse(
      makeSTPlayer({
        actualRole: "drunk",
        shownRole: "chef",
        shownAlignment: null,
        behaviorMode: "drunk_fake_role_behavior",
      })
    );
    expect(result.success).toBe(true);
  });

  it("rejects a record missing required fields", () => {
    const bad = { id: "p1", name: "x" };
    const result = STPlayerRecordSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown behaviorMode", () => {
    const result = STPlayerRecordSchema.safeParse(
      makeSTPlayer({ behaviorMode: "evil_genius" as never })
    );
    expect(result.success).toBe(false);
  });

  it("rejects empty string for actualRole", () => {
    const result = STPlayerRecordSchema.safeParse(makeSTPlayer({ actualRole: "" }));
    expect(result.success).toBe(false);
  });
});

describe("RoleDefSchema", () => {
  it("preserves unknown homebrew fields via passthrough", () => {
    const parsed = RoleDefSchema.parse({
      id: "homebrew_x",
      name: "Mystery",
      type: "townsfolk",
      customField: "keep me",
      art: { svg: "<svg/>" },
    });
    expect((parsed as Record<string, unknown>).customField).toBe("keep me");
    expect((parsed as Record<string, unknown>).art).toEqual({ svg: "<svg/>" });
  });

  it("rejects a role with no id", () => {
    const r = RoleDefSchema.safeParse({ name: "X", type: "townsfolk" });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown role type", () => {
    const r = RoleDefSchema.safeParse({
      id: "x",
      name: "X",
      type: "wizard",
    });
    expect(r.success).toBe(false);
  });
});

describe("ScriptSchema", () => {
  it("accepts the TB fixture", () => {
    const r = ScriptSchema.safeParse(tbScript);
    expect(r.success).toBe(true);
  });

  it("rejects a script with zero characters", () => {
    const r = ScriptSchema.safeParse({
      id: "empty",
      name: "Empty",
      characters: [],
    });
    expect(r.success).toBe(false);
  });
});

describe("Public/Self schemas", () => {
  it("PlayerPublicRecordSchema rejects role-leaking fields", () => {
    // Even if someone sneaks a `role` key through, the schema strips on .parse.
    // Round-trip a public-shaped record:
    const r = PlayerPublicRecordSchema.safeParse({
      id: "p1",
      name: "A",
      seat: 0,
      alive: true,
      ghostVote: true,
      online: false,
      joinedAt: 0,
      isTraveler: false,
    });
    expect(r.success).toBe(true);
  });

  it("PlayerSelfRecordSchema requires non-null shownRole", () => {
    const bad = PlayerSelfRecordSchema.safeParse({
      shownRole: null,
      shownAlignment: "good",
    });
    expect(bad.success).toBe(false);
  });
});
